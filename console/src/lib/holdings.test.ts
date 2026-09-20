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
})
