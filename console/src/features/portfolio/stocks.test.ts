import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSnapshot } from '../../api/fixtures'
import { markAnonymous, refreshSession } from '../../api/session'
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
  markAnonymous()
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
          cost_status: 'missing' as const, trade_value_usd: null, commission_usd: null,
          cost_position_qty: null, cost_updated_at: null, avg_cost_usd: null,
          cost_basis_usd: null, unrealized_pnl_usd: null, unrealized_pnl_pct: null },
      ],
      cost_coverage: { manual: 1, stale: 0, total: 2 },
    }

    const totals = stockTotals(partial)
    expect(totals.total).toBeNull()
    expect(totals.knownValue).toBe(1140)
    expect(totals.valuedCount).toBe(1)
    expect(totals.holdingCount).toBe(2)
    expect(totals.knownPnl).toBe(178.4)
    expect(totals.pnlCount).toBe(1)
    expect(totals.quoteCount).toBe(1)
  })

  it('换算比例无效的代币化持仓保留可见，但不冒充股票股数', () => {
    const base = buildSnapshot(new Date('2026-09-17T12:00:00Z'))
    const tokenized = {
      asset_code: 'AAPLB', name: 'Apple Inc. Tokenized Stock', symbol: 'AAPL',
      qty: 1, free_qty: 1, locked_qty: 0, freeze_qty: 0, withdrawing_qty: 0,
      value_usd: 230, wallet: 'spot' as const,
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
        cost_coverage: { manual: 0, stale: 0, total: 0 },
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
            overnight_supported: true, cost_status: 'manual', trade_value_usd: 960,
            commission_usd: 1.6, cost_position_qty: 40,
            cost_updated_at: '2026-09-20T08:00:00+00:00', avg_cost_usd: 24.04,
            cost_basis_usd: 961.6,
            unrealized_pnl_usd: 178.4, unrealized_pnl_pct: 178.4 / 961.6,
          },
          {
            symbol: 'AAPL', name: 'Apple Inc.', direct_qty: 0, tokenized_qty: 2,
            available_qty: 2, locked_qty: 0, freeze_qty: 0, withdrawing_qty: 0,
            total_qty: 2, wallet_price_usd: 230, wallet_value_usd: 460,
            bid_usd: 229.9, ask_usd: 230.1, mark_price_usd: 230, spread_bps: 8.7,
            tradability: 'NONE', fractionable: false, fractionable_extended: false,
            extended_session: false,
            overnight_supported: true, cost_status: 'missing', trade_value_usd: null,
            commission_usd: null, cost_position_qty: null, cost_updated_at: null,
            avg_cost_usd: null, cost_basis_usd: null,
            unrealized_pnl_usd: null, unrealized_pnl_pct: null,
          },
        ],
        cost_coverage: { manual: 1, stale: 0, total: 2 },
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
    expect(text).toContain('管理员尚未录入')
    expect(text).toContain('暂停交易')
    expect(text).toContain('常规时段可买碎股')
    expect(text).toContain('成本覆盖')
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
          ...base.stocks.positions[0], symbol: 'TQQQ', name: 'ProShares UltraPro QQQ',
          direct_qty: 40, tokenized_qty: 0, available_qty: 40, total_qty: 40,
          wallet_price_usd: 37.5, wallet_value_usd: 1500,
        }],
        cost_coverage: { manual: 2, stale: 0, total: 2 },
      },
    }
    act(() => root.render(createElement(HoldingsView, { snapshot, veiled: false })))
    const rows = () => [...host.querySelectorAll<HTMLElement>('[data-stock-position]')]
    expect(rows().length).toBeGreaterThan(1)
    expect(rows()[0].dataset.stockPosition).toBe('TQQQ')
    const symbolSort = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '标的')!
    act(() => symbolSort.click())
    expect(rows().map((row) => row.dataset.stockPosition))
      .toEqual([...rows().map((row) => row.dataset.stockPosition)].sort())
  })

  it('持仓股数变化后停用旧成本并明确要求重新录入', () => {
    const base = buildSnapshot(new Date('2026-09-17T12:00:00Z'))
    const stale = {
      ...base.stocks.positions[0],
      cost_status: 'stale' as const,
      cost_position_qty: 1.5,
      avg_cost_usd: null,
      cost_basis_usd: null,
      unrealized_pnl_usd: null,
      unrealized_pnl_pct: null,
    }
    const snapshot: PortfolioSnapshot = {
      ...base,
      stocks: {
        ...base.stocks,
        positions: [stale],
        cost_coverage: { manual: 0, stale: 1, total: 1 },
      },
    }

    act(() => root.render(createElement(HoldingsView, { snapshot, veiled: false })))

    expect(host.textContent).toContain('持仓数量已变化')
    expect(host.textContent).toContain('需按当前仓位重新录入')
    expect(host.textContent).toContain('原成本不再用于平均成本和盈亏')
  })

  it('只有管理员能打开成本录入，成员只看到缺失说明', async () => {
    const base = buildSnapshot(new Date('2026-09-17T12:00:00Z'))
    const missing = {
      ...base.stocks.positions[0], cost_status: 'missing' as const,
      trade_value_usd: null, commission_usd: null, cost_position_qty: null,
      cost_updated_at: null, avg_cost_usd: null, cost_basis_usd: null,
      unrealized_pnl_usd: null, unrealized_pnl_pct: null,
    }
    const snapshot: PortfolioSnapshot = {
      ...base,
      stocks: { ...base.stocks, positions: [missing],
        cost_coverage: { manual: 0, stale: 0, total: 1 } },
    }
    const json = (role: 'admin' | 'member') => new Response(JSON.stringify({ user: {
      id: 1, username: role, role, display_name: role, is_active: true,
      created_at: null, updated_at: null, last_login_at: null,
    } }), { status: 200, headers: { 'content-type': 'application/json' } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json('member')))
    await act(async () => { await refreshSession() })
    act(() => root.render(createElement(HoldingsView, {
      snapshot, veiled: false, onSaveStockCost: vi.fn(),
    })))
    expect(host.textContent).toContain('管理员尚未录入')
    expect(host.textContent).not.toContain('录入成本')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json('admin')))
    await act(async () => { await refreshSession() })
    const button = [...host.querySelectorAll('button')]
      .find((item) => item.textContent === '录入成本')
    expect(button).toBeDefined()
    act(() => button?.click())
    expect(host.querySelector('[data-stock-cost-editor="SOXL"]')).not.toBeNull()
  })

  it('合约与全仓杠杆里的币直接并入现货持仓，不再单列旧模块', () => {
    const snapshot = buildSnapshot(new Date('2026-09-17T12:00:00Z'))
    act(() => root.render(createElement(HoldingsView, { snapshot, veiled: false })))

    expect(host.textContent).not.toContain('合约中的现货持仓')
    expect(host.textContent).toContain('现货 · 合约钱包 · 全仓杠杆')
    expect(host.textContent).toContain('现货钱包可用')
  })
})
