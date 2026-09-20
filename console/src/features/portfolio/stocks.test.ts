import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSnapshot } from '../../api/fixtures'
import type { PortfolioSnapshot } from '../../api/types'
import { stockTotals } from './stock-position-model'
import { HoldingsView } from './views'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('持仓页的股票', () => {
  it('估值或盈亏覆盖不完整时不把未知项按零计入总数', () => {
    const base = buildSnapshot(new Date('2026-09-17T12:00:00Z'))
    const partial = {
      ...base.stocks,
      equity_holdings: [
        ...base.stocks.equity_holdings,
        { asset_code: 'EQ_TQQQ', symbol: 'TQQQ', name: '', qty: 5,
          free_qty: 5, locked_qty: 0, freeze_qty: 0, withdrawing_qty: 0,
          price_usd: null, value_usd: null, wallet: 'funding' as const },
      ],
      positions: [
        ...base.stocks.positions,
        { ...base.stocks.positions[0], symbol: 'TQQQ', direct_qty: 5, tokenized_qty: 0,
          total_qty: 5, available_qty: 5, wallet_price_usd: null, wallet_value_usd: null,
          bid_usd: 72.1, ask_usd: null, mark_price_usd: null, spread_bps: null,
          cost_status: 'incomplete' as const, avg_cost_usd: null, cost_basis_usd: null,
          realized_pnl_usd: null, unrealized_pnl_usd: null, unrealized_pnl_pct: null },
      ],
      cost_coverage: { reconciled: 1, estimated: 0, total: 2 },
    }

    const totals = stockTotals(partial)
    expect(totals.total).toBeNull()
    expect(totals.knownValue).toBe(460)
    expect(totals.valuedCount).toBe(2)
    expect(totals.holdingCount).toBe(3)
    expect(totals.knownPnl).toBe(40)
    expect(totals.pnlCount).toBe(1)
    expect(totals.quoteCount).toBe(1)
  })

  it('换算比例无效的代币化持仓保留可见，但不冒充股票股数', () => {
    const base = buildSnapshot(new Date('2026-09-17T12:00:00Z'))
    const tokenized = {
      ...base.stocks.tokenized_assets[0],
      multiplier: null,
      multiplier_valid: false,
      underlying_qty: null,
    }
    const snapshot: PortfolioSnapshot = {
      ...base,
      stocks: {
        ...base.stocks,
        equity_holdings: [],
        tokenized_assets: [tokenized],
        positions: [],
        cost_coverage: { reconciled: 0, estimated: 0, total: 0 },
      },
    }

    act(() => root.render(createElement(HoldingsView, { snapshot, veiled: false })))

    const text = host.textContent ?? ''
    expect(host.querySelector('[data-stock-unresolved="AAPLB"]')).not.toBeNull()
    expect(text).toContain('Binance 当前未确认换算比例')
    expect(text).toContain('0 / 1')
    expect(text).not.toContain('1 股')
  })

  it('按合约页层级显示仓位、报价、成本、占用与右侧汇总', () => {
    const base = buildSnapshot(new Date('2026-09-17T12:00:00Z'))
    const snapshot: PortfolioSnapshot = {
      ...base,
      stocks: {
        ...base.stocks,
        equity_holdings: [
          { asset_code: 'EQ_SOXL', symbol: 'SOXL', name: '', qty: 40,
            free_qty: 30, locked_qty: 5, freeze_qty: 3, withdrawing_qty: 2,
            price_usd: 28.5, value_usd: 1140, wallet: 'funding' },
          { asset_code: 'EQ_TQQQ', symbol: 'TQQQ', name: '', qty: 5,
            free_qty: 5, locked_qty: 0, freeze_qty: 0, withdrawing_qty: 0,
            price_usd: null, value_usd: null, wallet: 'funding' },
        ],
        positions: [
          {
            symbol: 'SOXL', name: 'Direxion Daily Semiconductor Bull 3X',
            direct_qty: 40, tokenized_qty: 0, available_qty: 30, locked_qty: 5,
            freeze_qty: 3, withdrawing_qty: 2, total_qty: 40,
            wallet_price_usd: 28.5, wallet_value_usd: 1140,
            bid_usd: 28.45, ask_usd: 28.55, mark_price_usd: 28.5, spread_bps: 35.09,
            tradability: 'BUY_SELL', fractionable: true, fractionable_extended: false,
            extended_session: true,
            overnight_supported: true, cost_status: 'reconciled', avg_cost_usd: 24.04,
            cost_basis_usd: 961.6, realized_pnl_usd: 158.6,
            unrealized_pnl_usd: 178.4, unrealized_pnl_pct: 178.4 / 961.6,
          },
          {
            symbol: 'AAPL', name: 'Apple Inc.', direct_qty: 0, tokenized_qty: 2,
            available_qty: 2, locked_qty: 0, freeze_qty: 0, withdrawing_qty: 0,
            total_qty: 2, wallet_price_usd: 230, wallet_value_usd: 460,
            bid_usd: 229.9, ask_usd: 230.1, mark_price_usd: 230, spread_bps: 8.7,
            tradability: 'NONE', fractionable: false, fractionable_extended: false,
            extended_session: false,
            overnight_supported: true, cost_status: 'incomplete', avg_cost_usd: null,
            cost_basis_usd: null, realized_pnl_usd: null,
            unrealized_pnl_usd: null, unrealized_pnl_pct: null,
          },
        ],
        cost_coverage: { reconciled: 1, estimated: 0, total: 2 },
      },
    }
    act(() => root.render(createElement(HoldingsView, { snapshot, veiled: false })))
    const text = host.textContent ?? ''
    expect(host.querySelector('[data-stock-positions]')?.closest('section')?.className)
      .toContain('lg:col-span-8')
    expect(host.querySelector('[data-stock-summary]')?.className).toContain('lg:col-span-4')
    expect(host.querySelectorAll('[data-stock-position]')).toHaveLength(2)
    expect(text).toContain('正股')
    expect(text).toContain('代币化')
    expect(text).toContain('可用 30')
    expect(text).toContain('占用 10')
    expect(text).toContain('成本')
    expect(text).toContain('$24.04')
    expect(text).toContain('买 / 卖')
    expect(text).toContain('$28.45 / $28.55')
    expect(text).toContain('钱包估值')
    expect(text).toContain('+$178.40')
    expect(text).toContain('成本待核对')
    expect(text).toContain('暂停交易')
    expect(text).toContain('常规时段可买碎股')
    expect(text).toContain('成本核对')
    expect(text).toContain('实时报价')
    expect(text).toContain('1 / 2')
    expect(text).not.toContain('TQQQ$0.00')
  })

  it('股票仓位可以按市值与代码排序', () => {
    const base = buildSnapshot(new Date('2026-09-17T12:00:00Z'))
    const snapshot: PortfolioSnapshot = {
      ...base,
      stocks: {
        ...base.stocks,
        positions: [...base.stocks.positions, {
          ...base.stocks.positions[0], symbol: 'SOXL', name: 'Direxion Daily Semiconductor Bull 3X',
          direct_qty: 40, tokenized_qty: 0, available_qty: 40, total_qty: 40,
          wallet_price_usd: 28.5, wallet_value_usd: 1140,
        }],
        cost_coverage: { reconciled: 2, estimated: 0, total: 2 },
      },
    }
    act(() => root.render(createElement(HoldingsView, { snapshot, veiled: false })))
    const rows = () => [...host.querySelectorAll<HTMLElement>('[data-stock-position]')]
    expect(rows().length).toBeGreaterThan(1)
    expect(rows()[0].dataset.stockPosition).toBe('SOXL')
    const symbolSort = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '标的')!
    act(() => symbolSort.click())
    expect(rows().map((row) => row.dataset.stockPosition))
      .toEqual([...rows().map((row) => row.dataset.stockPosition)].sort())
  })

  it('手续费缺失时显示估算成本，并明确说明未包含手续费', () => {
    const base = buildSnapshot(new Date('2026-09-17T12:00:00Z'))
    const estimated = {
      ...base.stocks.positions[0],
      cost_status: 'estimated' as const,
      avg_cost_usd: 209.9,
      cost_basis_usd: 419.8,
      realized_pnl_usd: null,
      unrealized_pnl_usd: 40.2,
      unrealized_pnl_pct: 40.2 / 419.8,
    }
    const snapshot: PortfolioSnapshot = {
      ...base,
      stocks: {
        ...base.stocks,
        positions: [estimated],
        cost_coverage: { reconciled: 0, estimated: 1, total: 1 },
      },
    }

    act(() => root.render(createElement(HoldingsView, { snapshot, veiled: false })))

    expect(host.textContent).toContain('估算成本')
    expect(host.textContent).toContain('未含手续费')
    expect(host.textContent).toContain('$209.9')
    expect(host.textContent).toContain('1 项为估算')
  })

  it('合约与全仓杠杆里的币直接并入现货持仓，不再单列旧模块', () => {
    const snapshot = buildSnapshot(new Date('2026-09-17T12:00:00Z'))
    act(() => root.render(createElement(HoldingsView, { snapshot, veiled: false })))

    expect(host.textContent).not.toContain('合约中的现货持仓')
    expect(host.textContent).toContain('现货 · 合约钱包 · 全仓杠杆')
    expect(host.textContent).toContain('现货钱包可用')
  })
})
