import { describe, expect, it } from 'vitest'
import { buildSnapshot } from '../api/fixtures'
import type { EquityHolding, PortfolioSnapshot } from '../api/types'
import { exposures } from './holdings'
import { shock } from './stress'

const base = buildSnapshot(new Date('2026-09-17T12:00:00Z'))

const soxl: EquityHolding = {
  asset_code: 'EQ_SOXL', symbol: 'SOXL', name: '', qty: 40,
  price_usd: 28.5, value_usd: 1140, wallet: 'funding',
}

function withStock(snapshot: PortfolioSnapshot, holding: EquityHolding): PortfolioSnapshot {
  return {
    ...snapshot,
    stocks: { ...snapshot.stocks, equity_holdings: [holding] },
    totals: snapshot.totals && {
      ...snapshot.totals, equity_usd: snapshot.totals.equity_usd + (holding.value_usd ?? 0),
    },
  }
}

describe('直接买入的正股（钱包里的 EQ_ 资产）', () => {
  it('按股票代码进敞口，与现货类持有同一口径', () => {
    const snap = withStock(base, soxl)
    const row = exposures(snap, snap.totals!.equity_usd).find((item) => item.asset === 'SOXL')
    expect(row?.spot_usd).toBe(1140)
    expect(row?.perp_usd).toBe(0)
  })

  it('同一个资产代码若也出现在现货行里，不算两次', () => {
    const snap = withStock({
      ...base,
      spot: [...base.spot, {
        asset: 'EQ_SOXL', free: 40, locked: 0, freeze: 0, withdrawing: 0, total: 40,
        price_usd: 28.5, value_usd: 1140,
      }],
    }, soxl)
    const rows = exposures(snap, snap.totals!.equity_usd)
    expect(rows.find((item) => item.asset === 'SOXL')?.spot_usd).toBe(1140)
    expect(rows.find((item) => item.asset === 'EQ_SOXL')).toBeUndefined()
  })

  it('「全部下跌」时正股跟着一起跌', () => {
    const snap = withStock(base, soxl)
    const drop = 0.3
    const without = shock(snap, drop).equity_usd! - snap.totals!.equity_usd
    const withoutStock = shock(base, drop).equity_usd! - base.totals!.equity_usd
    expect(without - withoutStock).toBeCloseTo(-drop * 1140, 6)
  })
})
