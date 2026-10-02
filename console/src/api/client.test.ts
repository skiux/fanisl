import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchOrders, fetchPortfolio, saveSpotCost, saveStockCost } from './client'
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
      symbol: 'SOXL', cost_price_usd: 23, commission_usd: 4,
      position_qty: 40, updated_at: '2026-09-21T08:00:00+00:00',
    } }))
    vi.stubGlobal('fetch', fetchMock)

    await saveStockCost('live', 'SOXL', {
      cost_price_usd: 23, commission_usd: 4, position_qty: 40,
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/admin\/stock-costs\/SOXL$/)
    expect(init).toMatchObject({ method: 'PUT', credentials: 'include' })
    expect(JSON.parse(String(init.body))).toEqual({
      cost_price_usd: 23, commission_usd: 4, position_qty: 40,
    })
  })

  it('does not write the real account while a fixture scenario is selected', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const saved = await saveStockCost('ok', 'SOXL', {
      cost_price_usd: 24, commission_usd: 1.2, position_qty: 40,
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(saved.stock_cost.cost_price_usd * saved.stock_cost.position_qty + saved.stock_cost.commission_usd).toBe(961.2)
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
      asset: 'BNB', cost_price_usd: 900, commission_usd: 3,
      position_qty: 2, updated_at: '2026-09-21T08:00:00+00:00',
    } }))
    vi.stubGlobal('fetch', fetchMock)
    await saveSpotCost('live', 'bnb', {
      cost_price_usd: 900, commission_usd: 3, position_qty: 2,
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/admin\/spot-costs\/BNB$/)
    expect(JSON.parse(String(init.body))).toEqual({
      cost_price_usd: 900, commission_usd: 3, position_qty: 2,
    })
  })

  it('keeps fixture input local and refreshes the same holding after save', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const original = await fetchPortfolio('ok')
    const bnb = spotHoldings(original).find((row) => row.asset === 'BNB')!
    await saveSpotCost('ok', 'BNB', {
      cost_price_usd: 900 / bnb.total, commission_usd: 3, position_qty: bnb.total,
    })
    const refreshed = spotHoldings(await fetchPortfolio('ok'))
      .find((row) => row.asset === 'BNB')!
    expect(fetchMock).not.toHaveBeenCalled()
    expect(refreshed.cost_basis_usd).toBeCloseTo(903)
    expect(refreshed.avg_cost_usd).toBeCloseTo(903 / bnb.total)
  })
})

describe('order fixtures by account', () => {
  it('keeps BNBUSDT spot and margin orders separate in current and history views', async () => {
    const [spot, margin, marginSymbol] = await Promise.all([
      fetchOrders('ok', '', undefined, { venue: 'spot' }),
      fetchOrders('ok', '', undefined, { venue: 'margin' }),
      fetchOrders('ok', 'BNBUSDT', undefined, { venue: 'margin' }),
    ])

    expect(spot.open.some((order) => order.symbol === 'BNBUSDT')).toBe(true)
    expect(margin.open.some((order) => order.symbol === 'BNBUSDT')).toBe(true)
    expect(spot.history.some((order) => order.symbol === 'BNBUSDT')).toBe(true)
    expect(margin.history.some((order) => order.symbol === 'BNBUSDT')).toBe(true)
    expect(spot.open.concat(spot.history).every((order) => order.venue === 'spot')).toBe(true)
    expect(margin.open.concat(margin.history).every((order) => order.venue === 'margin')).toBe(true)
    expect(margin.history_symbols).toContain('BNBUSDT')
    expect(margin.history_venues.BNBUSDT).toBe('margin')
    expect(margin.query).toMatchObject({ venue: 'margin', symbols: expect.arrayContaining(['BNBUSDT']) })
    expect(marginSymbol.query).toMatchObject({ venue: 'margin', symbol: 'BNBUSDT', symbols: ['BNBUSDT'] })
    expect(marginSymbol.history.every((order) => order.venue === 'margin')).toBe(true)
    expect(marginSymbol.fills.length).toBeGreaterThan(0)
    expect(marginSymbol.fills.every((fill) => marginSymbol.history.some((order) => order.id === fill.order_id))).toBe(true)
    expect(spot.history.map((order) => order.id)).not.toEqual(margin.history.map((order) => order.id))
  })
})
