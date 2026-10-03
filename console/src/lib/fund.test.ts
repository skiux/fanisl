import { describe, expect, it } from 'vitest'
import type { DailyPnl, FundMember, FundSnapshot } from '../api/types'
import { accountDays, accountsAt, withCash } from './fund'
import { buildSnapshot } from '../api/fixtures'
import { cash } from './holdings'

const DAY = 86_400_000

const member = (patch: Partial<FundMember>): FundMember => ({
  user_id: 1, username: 'a', display_name: 'A', is_manager: false, is_investor: false,
  invested_capital_usd: 0, loss_allocation: 0, management_fee: 0, performance_fee: 0,
  investor_return: 0, updated_at: null, ...patch,
})

// 用户确认口径时的那个例子：A 是 Manager，B 是 Investor
const A = member({ user_id: 1, display_name: 'A', is_manager: true, invested_capital_usd: 20_000,
  loss_allocation: 1, management_fee: 0.02, performance_fee: 0.3 })
const B = member({ user_id: 2, display_name: 'B', is_investor: true, invested_capital_usd: 80_000,
  loss_allocation: 0, investor_return: 0.7 })

function fund(members: FundMember[], { fee = true, inception = '2026-07-01' } = {}): FundSnapshot {
  return {
    settings: { initial_nav_usd: 100_000, inception_date: inception, cash_usd: null, updated_at: null },
    management_fee_total: fee ? members.reduce((sum, m) => sum + (m.is_manager ? m.management_fee : 0), 0) : 0,
    members: fee ? members : members.map((m) => ({ ...m, management_fee: 0 })),
  }
}

const at = (date: string, days = 0) => Date.parse(`${date}T00:00:00Z`) + days * DAY
const totals = (fundSnapshot: FundSnapshot, nav: number, ms: number) =>
  accountsAt(fundSnapshot, nav, ms).accounts.map((account) => account.allocation!.total)

describe('账户分配', () => {
  it('管理费先扣；Performance Fee 按总盈利，Investor Return 按出资占比的那份盈利', () => {
    // 73 天，100,000 × 2% × 73/365 = 400；可分 9,600
    const [a, b] = totals(fund([A, B]), 110_000, at('2026-07-01', 73))
    expect(a).toBeCloseTo(400 + 9_600 * 0.3)
    expect(b).toBeCloseTo(9_600 * 0.8 * 0.7)
    // 没分完的 9,600 × (1 − 30% − 80% × 70%) 归公司
    expect(a + b + 9_600 * (1 - 0.3 - 0.56)).toBeCloseTo(10_000)
  })

  it('用户给的例子：Manager 兼 Investor = 总利润 × Performance Fee + 总利润 × 出资占比 × Investor Return', () => {
    const manager = member({ is_manager: true, is_investor: true, invested_capital_usd: 25_000,
      performance_fee: 0.2, investor_return: 0.8 })
    const [account] = accountsAt(fund([manager], { fee: false }), 110_000, at('2026-07-01', 1)).accounts
    expect(account.allocation!.performance_fee).toBeCloseTo(10_000 * 0.2)
    expect(account.allocation!.investor_return).toBeCloseTo(10_000 * 0.25 * 0.8)
  })

  it('低于初始净值才是亏损，按 Loss Allocation 承担', () => {
    const [a, b] = totals(fund([A, B], { fee: false }), 95_000, at('2026-07-01', 10))
    expect(a).toBeCloseTo(-5_000)
    expect(b).toBe(0)
  })

  it('从高点回撤但仍在初始净值之上：只是盈利变少，不算亏损', () => {
    const [a, b] = totals(fund([A, B], { fee: false }), 102_000, at('2026-07-01', 10))
    expect(a).toBeCloseTo(600)
    expect(b).toBeCloseTo(2_000 * 0.8 * 0.7)
  })

  it('同时是 Manager 和 Investor 的人两份都拿', () => {
    const both = member({ is_manager: true, is_investor: true, invested_capital_usd: 50_000,
      performance_fee: 0.2, investor_return: 0.3 })
    const [account] = accountsAt(fund([both], { fee: false }), 110_000, at('2026-07-01', 1)).accounts
    expect(account.allocation!.performance_fee).toBeCloseTo(2_000)
    // 出资 50,000 / 100,000：Investor Return 只作用在自己那一半盈利上
    expect(account.allocation!.investor_return).toBeCloseTo(10_000 * 0.5 * 0.3)
    expect(account.value).toBeCloseTo(53_500)
    expect(account.return).toBeCloseTo(0.07)
  })

  it('没录初始净值或起始日、或者净值取不到：算不出来就是 null，不当成 0', () => {
    const unset = { ...fund([A]), settings: { ...fund([A]).settings, inception_date: null } }
    expect(accountsAt(unset, 110_000, at('2026-07-02')).accounts[0].value).toBeNull()
    expect(accountsAt(fund([A]), null, at('2026-07-02')).accounts[0].value).toBeNull()
  })
})

const day = (date: string, pnl: number | null, close: number | null = null): DailyPnl => ({
  date, spot_usd: pnl, stock_usd: 0, settled_usd: 0, settled_parts: null, earn_usd: 0,
  interest_usd: 0, pnl_usd: pnl, known: pnl !== null, frozen: close !== null,
  nav_close_usd: close,
})

describe('账户日历', () => {
  // 账户 7-03 起始；资产页日历从 7-01 开始，最后一格是今天 7-06（取数在 12:00）
  const daily = [
    day('2026-07-01', 50), day('2026-07-02', -20), day('2026-07-03', 300),
    day('2026-07-04', -500), day('2026-07-05', 1_200), day('2026-07-06', 100),
  ]
  const now = at('2026-07-06') + DAY / 2
  const snapshot = fund([A, B], { inception: '2026-07-03' })

  it('起始日之前的日子不出现；起始日之后各天加起来就是此刻的账户盈亏', () => {
    const nav = 101_000
    const days = accountDays(B, snapshot, daily, nav, now)
    expect(days.map((d) => d.date)).toEqual(['2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06'])
    expect(days.every((d) => d.known)).toBe(true)
    const [account] = accountsAt({ ...snapshot, members: [B] }, nav, now).accounts
    expect(days.reduce((sum, d) => sum + d.pnl_usd!, 0)).toBeCloseTo(account.allocation!.total)
  })

  it('每天的分项加起来等于那天的数', () => {
    for (const d of accountDays(A, snapshot, daily, 101_000, now)) {
      const p = d.parts!
      expect(p.management_fee + p.performance_fee + p.investor_return + p.loss).toBeCloseTo(d.pnl_usd!)
    }
  })

  it('某天算不出来：那天和更早的日子都留空，后面的照算', () => {
    const broken = daily.map((d) => (d.date === '2026-07-04' ? day(d.date, null) : d))
    const days = accountDays(B, snapshot, broken, 101_000, now)
    expect(days.map((d) => d.known)).toEqual([false, false, true, true])
    expect(days[0].pnl_usd).toBeNull()
  })

  it('有收盘快照的日子按存下的净值落点：链条在那里接上，充提不算进盈亏', () => {
    const flat = fund([A, B], { fee: false, inception: '2026-07-03' })
    // 7-04 收盘存的是 99,000，比 7-03 收盘减当天盈亏少 800（那天提走了 800）；
    // 7-05 算不出来——没有快照的话，7-04 和更早的日子都会跟着留空
    const stored = [
      day('2026-07-03', 300, 100_300), day('2026-07-04', -500, 99_000),
      day('2026-07-05', null), day('2026-07-06', 100),
    ]
    // 用 flat 里那份 A：管理费率清零了，总数里不混进 Manager 自己的管理费收入
    const days = accountDays(flat.members[0], flat, stored, 101_000, now)
    expect(days.map((d) => d.known)).toEqual([true, true, false, true])
    // A 的 Loss Allocation 是 1：7-04 从 99,500 跌到 99,000，承担这 500
    expect(days[1].pnl_usd).toBeCloseTo(-500)
    // 起始日收在存下的 100,300：盈利 300 × 30%
    expect(days[0].pnl_usd).toBeCloseTo(90)
  })

  it('跨过初始净值的那天，盈利与亏损按各自的规则分', () => {
    // 无管理费：7-05 收盘 100,600 → 7-06 此刻 99,600，从盈利 600 掉到亏损 400
    const flat = fund([A, B], { fee: false, inception: '2026-07-03' })
    const falling = [...daily.slice(0, -1), day('2026-07-06', -1_000)]
    const today = accountDays(A, flat, falling, 99_600, now).at(-1)!
    expect(today.parts!.performance_fee).toBeCloseTo(-600 * 0.3)
    expect(today.parts!.loss).toBeCloseTo(-400)
    const investor = accountDays(B, flat, falling, 99_600, now).at(-1)!
    // Loss Allocation 为 0：亏损那一截不承担，只失去原先那 600 里自己那份（80% 出资 × 70%）
    expect(investor.pnl_usd).toBeCloseTo(-600 * 0.8 * 0.7)
  })
})

describe('现金并进净值', () => {
  const portfolio = buildSnapshot(new Date('2026-10-02T12:00:00Z'))
  const exchange = portfolio.totals!.equity_usd
  const withSettings = (cash_usd: number | null) => ({ settings: { ...fund([]).settings, cash_usd } })

  it('净值 = 交易所的净值 + 现金；合约价值 / 净值按新分母重算', () => {
    const merged = withCash(portfolio, withSettings(2_500))
    expect(merged.totals!.equity_usd).toBeCloseTo(exchange + 2_500)
    expect(merged.external_cash_usd).toBe(2_500)
    expect(merged.totals!.gross_exposure_ratio)
      .toBeCloseTo(portfolio.totals!.gross_exposure_ratio! * exchange / (exchange + 2_500))
  })

  it('现金也是一行现金：资产分布与现金缓冲都列出它', () => {
    const rows = cash(withCash(portfolio, withSettings(2_500)))
    expect(rows.find((row) => row.where === '交易所外')).toMatchObject({ asset: 'USD', value_usd: 2_500 })
    expect(cash(withCash(portfolio, withSettings(null))).some((row) => row.where === '交易所外')).toBe(false)
  })

  it('没录现金就是交易所的净值；交易所的净值取不到时不拿现金冒充', () => {
    expect(withCash(portfolio, withSettings(null)).totals!.equity_usd).toBe(exchange)
    expect(withCash(portfolio, null).totals!.equity_usd).toBe(exchange)
    expect(withCash({ ...portfolio, totals: null }, withSettings(2_500)).totals).toBeNull()
  })
})
