import { describe, expect, it } from 'vitest'
import { buildFund, buildSnapshot } from '../../api/fixtures'
import { money, signedMoney, signedPercent } from '../../lib/format'
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

  it('keeps funding amounts and rates beside the contract headline', () => {
    const futures = snapshot.futures!
    const funding = snapshot.pnl!.today.settled_parts!.funding_fee
    const cells = summary('perp').cells

    expect(cells.map((cell) => cell.label)).toEqual([
      '未实现盈亏', '保证金余额', '真实杠杆', '预估资金费用', '今日资金费用',
    ])
    expect(cells[2].mobileHeroAside).toBe(true)
    expect(cells[3]).toMatchObject({
      value: signedMoney(futures.estimated_funding_fee_usd),
      detail: signedPercent(-futures.estimated_funding_rate!, 4),
    })
    expect(cells[4]).toMatchObject({
      value: signedMoney(funding),
      detail: signedPercent(funding / positionSize(snapshot)!, 4),
    })
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

  it('资产页：净值加上录入的现金，最右是现金；原先的保证金率一格换成相对初始净值的盈亏', () => {
    const fund = buildFund(new Date('2026-10-02T12:00:00Z'))
    const { hero, cells } = summaryForView(snapshot, 'overview', () => {}, fund)
    const nav = snapshot.totals!.equity_usd + 3_000
    expect(hero).toEqual({ label: '净值', value: money(nav) })
    expect(cells.map((cell) => cell.label)).toEqual(['今日盈亏', '合约未实现', '盈亏', '现金'])
    // 盈亏用显示的净值（含现金），与左边的净值对得上
    expect(cells[2]).toMatchObject({
      value: signedMoney(nav - 72_000), detail: signedPercent((nav - 72_000) / 72_000, 2),
    })
    expect(cells[3].value).toBe(money(3_000))
  })

  it('录了现金：持仓的「占账户净值」仍按真实净值', () => {
    const fund = buildFund(new Date('2026-10-02T12:00:00Z'))
    const share = (f: typeof fund | null) => summaryForView(snapshot, 'holdings', () => {}, f).cells[2].value
    expect(share(fund)).toBe(share(null))
  })

  it('没录现金和初始净值：净值就是真实净值，两格显示 —', () => {
    const { hero, cells } = summaryForView(snapshot, 'overview', () => {}, null)
    expect(hero.value).toBe(money(snapshot.totals!.equity_usd))
    expect(cells.slice(2).map((cell) => cell.value)).toEqual(['—', '—'])
  })
})
