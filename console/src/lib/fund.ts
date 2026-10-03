import type { DailyPnl, FundMember, FundSettings, FundSnapshot, PortfolioSnapshot } from '../api/types'

/**
 * 账户分配：把 Binance 账户当成一只小基金，算出每个参与者自己的账户。
 * 录入的规则见 `backend/fanisl/binance/fund.py`。用户确认的口径（2026-10-03）：
 *
 *     管理费   = Σ Manager 的 Management Fee × 初始净值 × 起始日以来的天数 / 365
 *     可分配   = 净值 − 初始净值 − 管理费
 *     盈利     = max(可分配, 0)
 *       Manager  分 盈利 × Performance Fee
 *       Investor 分 盈利 × (Invested Capital / 初始净值) × Investor Return
 *       两个角色都有就两份都拿
 *     亏损     = max(−可分配, 0)：每人承担 亏损 × Loss Allocation
 *     账户价值 = Invested Capital + 管理费（Manager）+ 盈利分成 − 亏损承担
 *
 * **Investor Return 按出资占比算。** 第一版把它当成"占总盈利的比例"，与 Performance
 * Fee 同一个口径，结果两个出资差三倍的 Investor 填同一个比例会分到同样多——基金里
 * 投资人的收益本来就从自己那份出资的盈利里来。用户指出后改成上面这样。
 *
 * **净值 = 交易所里的净值 + 管理员录入的现金**，就是资产页上那个净值（见 `withCash`）。
 * 传进来的 nav 已经含现金。
 *
 * **亏损只按低于初始净值的部分算**，不是"比前一天少了"。净值从高点回撤、但仍在
 * 初始净值之上时，只是可分的盈利变少：Loss Allocation 为 0 的人照样按比例分到
 * 剩下的盈利，不会因为一次回撤被算成 0 或者亏损。管理费先扣，所以严格说
 * 分界线是「初始净值 + 已计提的管理费」。
 *
 * 比例加起来不到 100% 的部分（盈利没分完、亏损没人承担）归公司，这里不单列账户。
 *
 * 为什么算在前端：分配要用的净值和逐日盈亏只在 `/portfolio` 的快照里，
 * 而那份快照由前端拿着；账户规则的接口只负责存和按人筛。
 */

const DAY_MS = 86_400_000

/**
 * 把管理员录入的现金并进快照：**净值 = 交易所里的净值 + 现金**，此后不再区分。
 *
 * 2026-10-03 先是"只有显示的净值加现金，其余用交易所的净值"，当天用户改了主意：现金也是
 * 真实资产，资产页上一切用净值的地方（盈亏、各处占净值、风险读数、压力测试、账户分配）
 * 一律用这个数。所以在取数那一步就并进去（StatementPage 的 loadStatement），下游照常读
 * `totals.equity_usd`，不必各处记得加——第一版在两处加、其余处不加，就是这样对不上的。
 *
 * 合约价值 / 净值（`gross_exposure_ratio`，后端按交易所净值算的）跟着按新分母重算；
 * 现金本身另记在 `external_cash_usd`，「资产分布」与「现金缓冲」把它列成一行。
 * 交易所的净值取不到时净值仍是取不到（null），不拿现金冒充。
 */
export function withCash(portfolio: PortfolioSnapshot,
                         fund: Pick<FundSnapshot, 'settings'> | null): PortfolioSnapshot {
  const cash = Math.max(0, fund?.settings.cash_usd ?? 0)
  if (cash === 0 || !portfolio.totals) return { ...portfolio, external_cash_usd: cash }
  const exchange = portfolio.totals.equity_usd
  const equity = exchange + cash
  const ratio = portfolio.totals.gross_exposure_ratio
  return {
    ...portfolio,
    external_cash_usd: cash,
    totals: {
      ...portfolio.totals,
      equity_usd: equity,
      gross_exposure_ratio: ratio === null || equity <= 0 ? ratio : ratio * exchange / equity,
    },
  }
}

export type FundTerms = {
  initialNav: number
  inception: string
  /** 起始日 UTC 零点 */
  inceptionMs: number
  feeRate: number
}

/** 初始净值和起始日都录了，才算得出任何人的账户 */
export function fundTerms(fund: Pick<FundSnapshot, 'settings' | 'management_fee_total'> | null): FundTerms | null {
  const settings: FundSettings | undefined = fund?.settings
  if (!settings?.initial_nav_usd || !settings.inception_date) return null
  return {
    initialNav: settings.initial_nav_usd,
    inception: settings.inception_date,
    inceptionMs: Date.parse(`${settings.inception_date}T00:00:00Z`),
    feeRate: fund!.management_fee_total,
  }
}

export type FundState = {
  /** 净值 − 初始净值 */
  pnl: number
  /** 起始日以来全部 Manager 的管理费 */
  fees: number
  /** 盈亏 − 管理费，按这个数分盈利或亏损 */
  distributable: number
  /** 起始日到这个时刻的天数，可以带小数 */
  days: number
}

export function fundStateAt(nav: number, terms: FundTerms, atMs: number): FundState {
  const days = Math.max(0, (atMs - terms.inceptionMs) / DAY_MS)
  const fees = terms.feeRate * terms.initialNav * days / 365
  const pnl = nav - terms.initialNav
  return { pnl, fees, distributable: pnl - fees, days }
}

export type Allocation = {
  management_fee: number
  performance_fee: number
  investor_return: number
  /** 承担的亏损，≤ 0 */
  loss: number
  total: number
}

const ZERO: Allocation = { management_fee: 0, performance_fee: 0, investor_return: 0, loss: 0, total: 0 }

/** 出资占初始净值的比例 */
export const capitalShare = (member: FundMember, initialNav: number) =>
  (initialNav > 0 ? member.invested_capital_usd / initialNav : 0)

/**
 * 这个人能分到总盈利的多少：Performance Fee + 出资占比 × Investor Return。
 * 全部参与者加起来不到 1 的部分归公司，超过 1 就是规则录错了。
 */
export function profitShare(member: FundMember, initialNav: number) {
  return (member.is_manager ? member.performance_fee : 0)
    + (member.is_investor ? capitalShare(member, initialNav) * member.investor_return : 0)
}

export function allocate(member: FundMember, state: FundState, terms: FundTerms): Allocation {
  const profit = Math.max(0, state.distributable)
  const loss = Math.max(0, -state.distributable)
  const management_fee = member.is_manager
    ? member.management_fee * terms.initialNav * state.days / 365 : 0
  const performance_fee = member.is_manager ? profit * member.performance_fee : 0
  const investor_return = member.is_investor
    ? profit * capitalShare(member, terms.initialNav) * member.investor_return : 0
  const lossShare = loss === 0 ? 0 : -loss * member.loss_allocation
  return {
    management_fee, performance_fee, investor_return, loss: lossShare,
    total: management_fee + performance_fee + investor_return + lossShare,
  }
}

export type Account = {
  member: FundMember
  /** 算不出来（没录初始净值或起始日、净值取不到）时以下都是 null */
  allocation: Allocation | null
  value: number | null
  /** 盈亏 / Invested Capital */
  return: number | null
}

export function accountsAt(fund: FundSnapshot | null, nav: number | null, atMs: number): {
  terms: FundTerms | null
  state: FundState | null
  accounts: Account[]
} {
  const terms = fundTerms(fund)
  const state = terms && nav !== null ? fundStateAt(nav, terms, atMs) : null
  const accounts = (fund?.members ?? []).map((member) => {
    const allocation = terms && state ? allocate(member, state, terms) : null
    return {
      member,
      allocation,
      value: allocation ? member.invested_capital_usd + allocation.total : null,
      return: allocation && member.invested_capital_usd > 0
        ? allocation.total / member.invested_capital_usd : null,
    }
  })
  return { terms, state, accounts }
}

/** 日历的一格。形状与资产页日历共用（date / pnl_usd / known），另带这天的分项 */
export type AccountDay = {
  date: string
  pnl_usd: number | null
  known: boolean
  parts: Allocation | null
}

const nextDayMs = (date: string) => Date.parse(`${date}T00:00:00Z`) + DAY_MS

function minus(a: Allocation, b: Allocation): Allocation {
  return {
    management_fee: a.management_fee - b.management_fee,
    performance_fee: a.performance_fee - b.performance_fee,
    investor_return: a.investor_return - b.investor_return,
    loss: a.loss - b.loss,
    total: a.total - b.total,
  }
}

/**
 * 一个人账户的逐日盈亏：每天收盘时账户价值减去前一天收盘时的。
 *
 * 过去每天收盘的净值没有存下来（见 `docs/plans/active/console.md` 的持久化一条），
 * 这里从此刻的净值往回减资产页日历的逐日盈亏倒推。所以：
 *
 * - 只有起始日之后、且在资产页日历范围内（90 天）的日子有数；
 * - 某一天的盈亏算不出来，那天和它之前的日子都不知道当时的净值，一律留空，
 *   不拿 0 顶替——顶替会让更早的日子悄悄地错；
 * - 充值和提现会让净值跳一截，按口径它算进「净值 − 初始净值」，但不在
 *   资产页的逐日盈亏里，所以日历各天加起来与此刻的账户盈亏会差出这一截。
 *   现金只有此刻录入的一个数，往回推时当它一直是这么多；改录现金同样差出一截。
 *
 * 起始日那天从 Invested Capital 起算：前一天的账户价值就是出资本身。
 */
export function accountDays(member: FundMember, fund: FundSnapshot | null,
                            daily: DailyPnl[], nav: number | null, atMs: number): AccountDay[] {
  const terms = fundTerms(fund)
  if (!terms || nav === null || daily.length === 0) return []

  // 每天开盘、收盘时的净值，从最后一格（今天，收在此刻）往回减
  const closes: (number | null)[] = Array(daily.length).fill(null)
  const opens: (number | null)[] = Array(daily.length).fill(null)
  closes[daily.length - 1] = nav
  for (let i = daily.length - 1; i >= 0; i -= 1) {
    const pnl = daily[i].known ? daily[i].pnl_usd : null
    opens[i] = closes[i] === null || pnl === null ? null : closes[i]! - pnl
    if (i > 0) closes[i - 1] = opens[i]
  }
  const at = (navAt: number | null, ms: number) => (navAt === null
    ? null : allocate(member, fundStateAt(navAt, terms, ms), terms))

  const days: AccountDay[] = []
  daily.forEach((day, i) => {
    if (day.date < terms.inception) return
    const end = at(closes[i], i === daily.length - 1 ? atMs : nextDayMs(day.date))
    const start = day.date === terms.inception
      ? ZERO : at(opens[i], Date.parse(`${day.date}T00:00:00Z`))
    const parts = end && start ? minus(end, start) : null
    days.push({ date: day.date, pnl_usd: parts?.total ?? null, known: parts !== null, parts })
  })
  return days
}
