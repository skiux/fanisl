import { describe, expect, it } from 'vitest'
import { buildSnapshot } from '../../api/fixtures'
import { money } from '../../lib/format'
import { spotHoldings } from '../../lib/holdings'
import { positionSize } from '../../lib/stress'
import { summaryForView } from './SummaryStrip'

const snapshot = buildSnapshot(new Date('2026-10-02T12:00:00Z'))
const summary = (view: 'overview' | 'holdings' | 'perp' | 'risk') =>
  summaryForView(snapshot, view, () => {})

describe('desktop page summaries', () => {
  it('only assets uses account equity as the headline', () => {
    expect(summary('overview').hero).toEqual({
      label: '净值', value: money(snapshot.totals!.equity_usd),
    })
    expect(summary('holdings').hero.label).toMatch(/持仓$/)
    expect(['perp', 'risk'].map((view) =>
      summary(view as 'perp' | 'risk').hero.label))
      .toEqual(['仓位价值', '合约保证金率'])
  })

  it('holds stocks once even when their wallet asset also appears in spot', () => {
    const stockAssets = new Set([...snapshot.stocks.equity_holdings, ...snapshot.stocks.tokenized_assets]
      .map((row) => row.asset_code))
    const crypto = spotHoldings(snapshot)
      .filter((row) => !stockAssets.has(row.asset))
      .reduce((sum, row) => sum + row.value_usd!, 0)
    const stocks = [...snapshot.stocks.equity_holdings, ...snapshot.stocks.tokenized_assets]
      .reduce((sum, row) => sum + row.value_usd!, 0)
    expect(summary('holdings').hero.value).toBe(money(crypto + stocks))
    expect(summary('holdings').cells.map((cell) => cell.value).slice(0, 2))
      .toEqual([money(crypto), money(stocks)])
  })

  it('uses absolute contract value and leaves unavailable data blank', () => {
    expect(summary('perp').hero.value).toBe(money(positionSize(snapshot)!))
    const missing = summaryForView({ ...snapshot, futures: null }, 'perp', () => {})
    expect(missing.hero.value).toBe('—')
    expect(missing.cells.every((cell) => cell.value === '—')).toBe(true)
  })

  it('does not turn an unreachable holdings source into a zero balance', () => {
    const unavailable = summaryForView({
      ...snapshot,
      spot: [], stocks: { ...snapshot.stocks, equity_holdings: [], tokenized_assets: [] },
      futures: null, margin: null,
      sources: snapshot.sources.map((source) => source.key === 'spot'
        ? { ...source, status: 'unreachable' as const } : source),
    }, 'holdings', () => {})
    expect(unavailable.hero).toEqual({ label: '已估值持仓', value: '—' })
  })
})
