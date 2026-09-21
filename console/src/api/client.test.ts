import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPortfolio, saveStockCost } from './client'

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
