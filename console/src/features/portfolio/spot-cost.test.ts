import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSnapshot } from '../../api/fixtures'
import { markAnonymous, refreshSession } from '../../api/session'
import { spotHoldings } from '../../lib/holdings'
import { price } from '../../lib/format'
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

async function setRole(role: 'admin' | 'member') {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ user: {
    id: 1, username: role, role, display_name: role, is_active: true,
    created_at: null, updated_at: null, last_login_at: null,
  } }), { status: 200, headers: { 'content-type': 'application/json' } })))
  await act(async () => { await refreshSession() })
}

describe('现货人工成本', () => {
  it('现货持仓显示录入的成本价和未实现盈亏，不重复显示总成本', () => {
    const base = buildSnapshot(new Date('2026-09-19T12:00:00Z'))
    const row = spotHoldings(base).find((item) => item.asset === 'BNB')!
    const snapshot = { ...base, spot_costs: { BNB: {
      asset: 'BNB', cost_price_usd: 900 / row.total, commission_usd: 3,
      position_qty: row.total, updated_at: '2026-09-19T12:00:00Z',
    } } }
    act(() => root.render(createElement(HoldingsView, { snapshot, veiled: false })))
    const bnb = host.querySelector('[data-spot-position="BNB"]')!
    expect(bnb.textContent).toContain(`成本价 ${price(900 / row.total)}`)
    expect(bnb.textContent).not.toContain('平均成本')
    expect(bnb.textContent).not.toContain('总成本')
    expect(bnb.textContent).not.toContain('$903.00')
    expect(bnb.textContent).toContain('未实现')
    expect(host.textContent).toContain('现价')
  })

  it('只有管理员能录入，旧数量的成本不再显示为当前成本', async () => {
    const base = buildSnapshot(new Date('2026-09-19T12:00:00Z'))
    const snapshot = { ...base, spot_costs: { BNB: {
      asset: 'BNB', cost_price_usd: 900, commission_usd: 3,
      position_qty: 0.5, updated_at: '2026-09-19T12:00:00Z',
    } } }
    await setRole('member')
    act(() => root.render(createElement(HoldingsView, {
      snapshot, veiled: false, onSaveSpotCost: vi.fn(),
    })))
    const bnb = host.querySelector('[data-spot-position="BNB"]')!
    expect(bnb.textContent).not.toContain('持仓数量已变化')
    expect(bnb.textContent).not.toContain('$903.00')
    expect(bnb.textContent).not.toContain('成本价')
    expect(bnb.textContent).not.toContain('管理员尚未录入')
    expect(bnb.querySelector('button')).toBeNull()

    await setRole('admin')
    act(() => root.render(createElement(HoldingsView, {
      snapshot, veiled: false, onSaveSpotCost: vi.fn(),
    })))
    const button = [...bnb.querySelectorAll('button')]
      .find((item) => item.textContent === '修正成本')!
    expect(button).toBeDefined()
    act(() => button.click())
    expect(bnb.querySelector('[data-spot-cost-editor="BNB"]')).not.toBeNull()
    expect(bnb.textContent).toContain('原记录 0.5')
  })

  it('余额来源不可用时禁用成本录入与未实现盈亏', async () => {
    await setRole('admin')
    const base = buildSnapshot(new Date('2026-09-19T12:00:00Z'))
    const snapshot = { ...base, sources: base.sources.map((source) =>
      source.key === 'futures' ? { ...source, status: 'unreachable' as const } : source) }
    act(() => root.render(createElement(HoldingsView, {
      snapshot, veiled: true, onSaveSpotCost: vi.fn(),
    })))
    const bnb = host.querySelector('[data-spot-position="BNB"]')!
    expect(bnb.textContent).not.toContain('余额来源不可用')
    expect(bnb.querySelector('button')).toBeNull()
  })
})
