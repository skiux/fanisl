import type { MaintenanceBracket, PortfolioSnapshot } from '../api/types'

/**
 * 压力测试：**所有标的一起跌 d，账户会怎样。**
 *
 * 这一页要回答的不是"我现在赚了多少"，而是"再跌多少我就出局"。合约页上有逐个仓位的
 * 「距强平」，但那是每个仓位各自的距离；账户是共用一份保证金的，**多个仓位一起亏
 * 才是真实情形**，逐个看会systematically低估风险。
 *
 * 口径与简化（都写在这里，不进界面）：
 *
 * - 标记价一律 `mark × (1 − d)`。空头在下跌里是赚的，同一个公式自然带出来。
 * - 未实现从**开仓价重算**（`(新标记 − 开仓) × 数量`），不拿接口给的总额去加减：
 *   两者口径若差一点，减出来的 Δ 会把误差放大。
 * - 起始保证金随名义等比缩放；维持保证金按每个标的的 leverageBracket 公式
 *   `名义 × rate − cum` 重算。档位暂时取不到时才沿用当前有效维持保证金率。
 * - 保证金余额按 USDT 计价，不随行情变。联合保证金（用 BTC/BNB 当保证金）下这
 *   会低估亏损，那种账户 `futures.assets` 里会有非稳定币，界面上看得到。
 */
export type Shock = {
  drop: number
  /** 冲击之后的净值 */
  equity_usd: number | null
  unrealized_usd: number | null
  margin_balance: number | null
  /** 维持保证金 / 保证金余额，到 1 就是强平线 */
  margin_ratio: number | null
  /** 缺保证金档位或启用联合保证金时，投影只能按当前有效比率估算。 */
  margin_ratio_estimated: boolean
  available_usd: number | null
  /**
   * 这一跌会被强平的**逐仓**仓位。
   *
   * 全仓的不在这里：交易所给的 `liquidationPrice` 是"别的都不动、只有这个仓位
   * 的价格变"算出来的，而这里恰恰是所有标的一起跌——那个价在这种情形下不成立。
   * 全仓共用一份保证金，判据是账户的 `margin_ratio` 到 1，`breakingDrop` 就是解它。
   * 两套判据混着报会自相矛盾：屏幕上出现过"保证金率 8.6% 安全"底下挂着
   * 两行"触及强平价"。
   */
  liquidated: string[]
}

type Leg = {
  symbol: string; amt: number; mark: number; entry: number
  notional: number; maint: number; initial: number; liq: number | null; isolated: boolean
  brackets: MaintenanceBracket[]
}

function legs(snapshot: PortfolioSnapshot): Leg[] {
  return (snapshot.futures?.positions ?? []).map((p) => ({
    symbol: p.symbol,
    amt: p.position_amt,
    mark: p.mark_price,
    entry: p.entry_price,
    notional: Math.abs(p.notional_usd),
    maint: p.maint_margin_usd,
    initial: p.initial_margin_usd,
    liq: p.liquidation_price,
    isolated: p.isolated,
    brackets: p.maintenance_brackets ?? [],
  }))
}

function maintenanceAt(leg: Leg, notional: number) {
  const brackets = leg.brackets
  const tier = brackets.find((item) => notional >= item.notional_floor_usd
    && (item.notional_cap_usd === null || notional <= item.notional_cap_usd))
    ?? brackets.at(-1)
  if (tier) return Math.max(0, notional * tier.maint_margin_rate - tier.maint_amount_usd)
  return leg.notional > 0 ? leg.maint * notional / leg.notional : 0
}

/** 压力测试里的仓位统一指合约名义金额绝对值之和。 */
export function positionSize(snapshot: PortfolioSnapshot) {
  if (snapshot.futures === null) return null
  return snapshot.futures.positions.reduce((sum, position) => sum + Math.abs(position.notional_usd), 0)
}

export type PositionTarget = {
  leverage: number
  notional_usd: number | null
  remaining_usd: number | null
}

/** N× 与总览的真实杠杆同口径：合约总名义仓位 / 账户净值。 */
export function positionTarget(snapshot: PortfolioSnapshot, leverage: number): PositionTarget {
  const current = positionSize(snapshot)
  const equity = snapshot.totals?.equity_usd ?? null
  const target = equity !== null && equity > 0 ? equity * leverage : null
  return {
    leverage,
    notional_usd: target,
    remaining_usd: current === null || target === null ? null : target - current,
  }
}

/** 会跟着行情一起跌的现货类持有（稳定币不动，所以不算） */
function riskAssets(snapshot: PortfolioSnapshot): number {
  const stable = new Set(snapshot.stable_assets)
  const sum = (rows: { asset: string; value_usd: number | null }[]) =>
    rows.filter((r) => !stable.has(r.asset)).reduce((acc, r) => acc + (r.value_usd ?? 0), 0)
  return sum(snapshot.spot) + sum(snapshot.earn)
    + sum(snapshot.margin?.assets ?? []) + sum(snapshot.futures?.assets ?? [])
}

/**
 * 把仓位**整体缩放到指定的真实杠杆**（名义敞口 / 账户净值），用来回答
 * "如果我把仓位开到 2 倍，再跌 30% 会怎样"。
 *
 * 口径：**按现价重新建仓**——新仓位的开仓价就是当前标记价，所以未实现从 0 起算。
 * 不是"把现有仓位乘个系数"：那样会把已有的浮盈浮亏一并放大，而那笔盈亏是过去
 * 的价格走出来的，跟"我现在要开多大"没有关系，放大它只会让结果偏乐观或偏悲观。
 *
 * 起始保证金按名义等比缩放；维持保证金按 leverageBracket 的档位公式重算。
 */
export function resize(snapshot: PortfolioSnapshot, leverage: number): PortfolioSnapshot {
  const f = snapshot.futures
  const equity = snapshot.totals?.equity_usd ?? 0
  if (!f || f.positions.length === 0 || f.total_margin_balance <= 0 || equity <= 0) return snapshot
  const currentLegs = legs(snapshot)
  const notional = currentLegs.reduce((sum, leg) => sum + leg.notional, 0)
  if (notional <= 0) return snapshot
  // 平掉旧仓等于把当前的未实现结算进钱包，所以新的钱包余额就是现在的**保证金余额**。
  // 分母用它而不是 walletBalance，也正好和「合约」页上那个真实杠杆同一个口径。
  const wallet = f.total_margin_balance
  const scale = (leverage * equity) / notional
  const positions = f.positions.map((position, index) => {
    const leg = currentLegs[index]
    const nextNotional = leg.notional * scale
    return {
      ...position,
      position_amt: position.position_amt * scale,
      notional_usd: nextNotional,
      // 按现价重建：开仓价 = 标记价，未实现归零
      entry_price: position.mark_price,
      unrealized_pnl_usd: 0,
      initial_margin_usd: position.initial_margin_usd * scale,
      maint_margin_usd: maintenanceAt(leg, nextNotional),
      // 强平价是交易所按旧仓位算的，缩放之后不再成立——**置空而不是照搬**。
      // 全仓的判据本来就是账户保证金率，逐仓的那几个宁可不报。
      liquidation_price: null,
      liq_distance: null,
    }
  })
  const currentPositionInitial = f.positions.reduce((sum, position) => sum + position.initial_margin_usd, 0)
  const currentPositionMaint = f.positions.reduce((sum, position) => sum + position.maint_margin_usd, 0)
  const totalInitial = f.total_initial_margin - currentPositionInitial
    + positions.reduce((sum, position) => sum + position.initial_margin_usd, 0)
  const totalMaint = f.total_maint_margin - currentPositionMaint
    + positions.reduce((sum, position) => sum + position.maint_margin_usd, 0)
  const available = f.available_balance + f.total_initial_margin - totalInitial
  return {
    ...snapshot,
    totals: snapshot.totals && { ...snapshot.totals, gross_exposure_ratio: leverage },
    futures: {
      ...f,
      total_wallet_balance: wallet,
      total_margin_balance: wallet,
      total_initial_margin: totalInitial,
      total_maint_margin: totalMaint,
      total_unrealized_pnl: 0,
      available_balance: available,
      max_withdraw: Math.max(0, f.max_withdraw + f.total_initial_margin - totalInitial),
      margin_ratio: wallet > 0 ? totalMaint / wallet : null,
      positions,
    },
  }
}

export function shock(snapshot: PortfolioSnapshot, drop: number): Shock {
  const f = snapshot.futures
  const rows = legs(snapshot)
  const k = 1 - drop

  const base = rows.reduce((sum, p) => sum + (p.mark - p.entry) * p.amt, 0)
  const after = rows.reduce((sum, p) => sum + (p.mark * k - p.entry) * p.amt, 0)
  const currentMaint = rows.reduce((sum, p) => sum + p.maint, 0)
  const currentInitial = rows.reduce((sum, p) => sum + p.initial, 0)
  const maint = (f?.total_maint_margin ?? 0) - currentMaint
    + rows.reduce((sum, p) => sum + maintenanceAt(p, p.notional * k), 0)
  const initial = (f?.total_initial_margin ?? 0) - currentInitial
    + rows.reduce((sum, p) => sum + p.initial * k, 0)

  const balance = f === null ? null : f.total_margin_balance + after - base
  const equity = snapshot.totals?.equity_usd ?? null

  return {
    drop,
    equity_usd: equity === null ? null : equity - drop * riskAssets(snapshot) + (after - base),
    unrealized_usd: f === null ? null : after,
    margin_balance: balance,
    margin_ratio: balance === null ? null : balance <= 0 ? 1 : maint / balance,
    margin_ratio_estimated: Boolean(f?.multi_assets_margin)
      || rows.some((row) => row.brackets.length === 0),
    available_usd: f === null ? null : f.available_balance + after - base
      + f.total_initial_margin - initial,
    liquidated: rows
      .filter((p) => p.isolated && p.liq !== null
        && (p.amt >= 0 ? p.mark * k <= p.liq : p.mark * k >= p.liq))
      .map((p) => p.symbol),
  }
}

/**
 * **一起跌多少开始强平。** 二分找最小的 d 使保证金率到 1。
 *
 * 解析解也能写（对 d 是线性的），但符号很容易翻错：净空头的账户里分母会变号，
 * 一个漏掉的绝对值就把"永远不会强平"算成"跌 3% 就爆"。数值搜索没有这个风险，
 * 四十次迭代的代价可以忽略。
 *
 * `extraMargin` 是"再补多少保证金进去"，用来回答"把现金划进合约能多扛多少"。
 * 净空头 / 没有仓位时返回 null——那不是"很安全"，是这个问题不成立。
 */
export function breakingDrop(snapshot: PortfolioSnapshot, extraMargin = 0): number | null {
  if ((snapshot.futures?.positions.length ?? 0) === 0) return null
  const padded: PortfolioSnapshot = extraMargin === 0 ? snapshot : {
    ...snapshot,
    futures: snapshot.futures && {
      ...snapshot.futures,
      total_wallet_balance: snapshot.futures.total_wallet_balance + extraMargin,
      total_margin_balance: snapshot.futures.total_margin_balance + extraMargin,
      available_balance: snapshot.futures.available_balance + extraMargin,
    },
  }
  const blown = (d: number) => {
    const hit = shock(padded, d)
    return hit.margin_ratio !== null && hit.margin_ratio >= 1
  }
  if (!blown(0.995)) return null
  if (blown(0)) return 0
  let lo = 0
  let hi = 0.995
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2
    if (blown(mid)) hi = mid
    else lo = mid
  }
  return hi
}
