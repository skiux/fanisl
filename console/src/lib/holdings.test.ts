import { describe, expect, it } from 'vitest'
import { buildSnapshot } from '../api/fixtures'
import { cash, spotHoldings } from './holdings'

describe('持仓跨钱包归并', () => {
  it('把合约与全仓杠杆里的非稳定币并入现货持仓', () => {
    const snapshot = buildSnapshot(new Date('2026-09-19T12:00:00Z'))
    const bnb = spotHoldings(snapshot).find((row) => row.asset === 'BNB')!
    const expected = snapshot.spot.find((row) => row.asset === 'BNB')!.total
      + snapshot.futures!.assets.find((row) => row.asset === 'BNB')!.wallet_balance
      + snapshot.margin!.assets.find((row) => row.asset === 'BNB')!.net

    expect(bnb.total).toBeCloseTo(expected)
    expect(bnb.locations).toEqual(['现货', '合约钱包', '全仓杠杆'])
  })

  it('稳定币只归入现金，不在现货持仓重复出现', () => {
    const snapshot = buildSnapshot(new Date('2026-09-19T12:00:00Z'))
    const rows = spotHoldings(snapshot)

    expect(rows.some((row) => snapshot.stable_assets.includes(row.asset))).toBe(false)
    expect(cash(snapshot).some((row) => row.asset === 'USDT')).toBe(true)
  })

  it('BFUSD 无论放在哪个钱包都使用官方公布的当前年化', () => {
    const snapshot = buildSnapshot(new Date('2026-09-19T12:00:00Z'))
    const row = cash(snapshot).find((item) => item.asset === 'BFUSD')!

    expect(row.where).toBe('合约保证金')
    expect(row.apr).toBe(snapshot.yield_rates.BFUSD)
  })

  it('只给与跨钱包当前持有量一致的人工成本计算平均价和未实现盈亏', () => {
    const base = buildSnapshot(new Date('2026-09-19T12:00:00Z'))
    const held = spotHoldings(base).find((row) => row.asset === 'BNB')!
    const snapshot = {
      ...base,
      spot_costs: { BNB: {
        asset: 'BNB', trade_value_usd: 900, commission_usd: 3,
        position_qty: held.total, updated_at: '2026-09-19T12:00:00Z',
      } },
    }
    const row = spotHoldings(snapshot).find((item) => item.asset === 'BNB')!
    expect(row.cost_status).toBe('manual')
    expect(row.cost_basis_usd).toBe(903)
    expect(row.avg_cost_usd).toBeCloseTo(903 / row.total)
    expect(row.unrealized_pnl_usd).toBeCloseTo(row.value_usd! - 903)
    expect(row.unrealized_pnl_pct).toBeCloseTo((row.value_usd! - 903) / 903)
    expect(spotHoldings(snapshot).find((item) => item.asset === 'BTC')!.cost_status)
      .toBe('missing')
    expect(spotHoldings(snapshot).some((item) => item.asset === 'USDT')).toBe(false)
  })

  it('余额变化或钱包来源失败时，不使用旧成本计算盈亏', () => {
    const base = buildSnapshot(new Date('2026-09-19T12:00:00Z'))
    const held = spotHoldings(base).find((row) => row.asset === 'BNB')!
    const snapshot = { ...base, spot_costs: { BNB: {
      asset: 'BNB', trade_value_usd: 900, commission_usd: 3,
      position_qty: held.total - 0.01, updated_at: '2026-09-19T12:00:00Z',
    } } }
    const stale = spotHoldings(snapshot).find((item) => item.asset === 'BNB')!
    expect(stale.cost_status).toBe('stale')
    expect(stale.cost_basis_usd).toBeNull()
    expect(stale.unrealized_pnl_usd).toBeNull()

    const unavailable = spotHoldings({
      ...snapshot, sources: base.sources.map((source) => source.key === 'futures'
        ? { ...source, status: 'unreachable' as const } : source),
    }).find((item) => item.asset === 'BNB')!
    expect(unavailable.cost_status).toBe('unavailable')
    expect(unavailable.avg_cost_usd).toBeNull()
    expect(unavailable.unrealized_pnl_usd).toBeNull()
  })

  it('报价来源失败时仍保留录入成本，但不显示以旧价格计算的盈亏', () => {
    const base = buildSnapshot(new Date('2026-09-19T12:00:00Z'))
    const withoutPrices = { ...base, sources: base.sources.map((source) =>
      source.key === 'prices' ? { ...source, status: 'unreachable' as const } : source) }
    const bnb = spotHoldings(withoutPrices).find((row) => row.asset === 'BNB')!
    expect(bnb.cost_status).toBe('manual')
    expect(bnb.cost_basis_usd).toBe(3303)
    expect(bnb.unrealized_pnl_usd).toBeNull()
  })
})
