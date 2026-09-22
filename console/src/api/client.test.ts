import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPortfolio, saveSpotCost, saveStockCost } from './client'
import { spotHoldings } from '../lib/holdings'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('stock cost writes', () => {
  it('sends the exact admin input and current position quantity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ stock_cost: {
      symbol: 'SOXL', trade_value_usd: 920, commission_usd: 4,
      position_qty: 40, updated_at: '2026-09-21T08:00:00+00:00',
    } }))
    vi.stubGlobal('fetch', fetchMock)

    await saveStockCost('live', 'SOXL', {
      trade_value_usd: 920, commission_usd: 4, position_qty: 40,
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/admin\/stock-costs\/SOXL$/)
    expect(init).toMatchObject({ method: 'PUT', credentials: 'include' })
    expect(JSON.parse(String(init.body))).toEqual({
      trade_value_usd: 920, commission_usd: 4, position_qty: 40,
    })
  })

  it('does not write the real account while a fixture scenario is selected', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const saved = await saveStockCost('ok', 'SOXL', {
      trade_value_usd: 960, commission_usd: 1.2, position_qty: 40,
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(saved.stock_cost.trade_value_usd + saved.stock_cost.commission_usd).toBe(961.2)
    const snapshot = await fetchPortfolio('ok')
    const position = snapshot.stocks.positions.find((row) => row.symbol === 'SOXL')!
    expect(position.cost_basis_usd).toBe(961.2)
    expect(position.avg_cost_usd).toBeCloseTo(24.03)
    expect(position.cost_status).toBe('manual')
  })
})

describe('spot cost writes', () => {
  it('sends the admin input without contacting Binance trading APIs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ spot_cost: {
      asset: 'BNB', trade_value_usd: 900, commission_usd: 3,
      position_qty: 2, updated_at: '2026-09-21T08:00:00+00:00',
    } }))
    vi.stubGlobal('fetch', fetchMock)
    await saveSpotCost('live', 'bnb', {
      trade_value_usd: 900, commission_usd: 3, position_qty: 2,
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/admin\/spot-costs\/BNB$/)
    expect(JSON.parse(String(init.body))).toEqual({
      trade_value_usd: 900, commission_usd: 3, position_qty: 2,
    })
  })

  it('keeps fixture input local and refreshes the same holding after save', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const original = await fetchPortfolio('ok')
    const bnb = spotHoldings(original).find((row) => row.asset === 'BNB')!
    await saveSpotCost('ok', 'BNB', {
      trade_value_usd: 900, commission_usd: 3, position_qty: bnb.total,
    })
    const refreshed = spotHoldings(await fetchPortfolio('ok'))
      .find((row) => row.asset === 'BNB')!
    expect(fetchMock).not.toHaveBeenCalled()
    expect(refreshed.cost_basis_usd).toBe(903)
    expect(refreshed.avg_cost_usd).toBeCloseTo(903 / bnb.total)
  })
})
