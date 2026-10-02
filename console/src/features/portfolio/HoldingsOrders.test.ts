import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchOrders } from '../../api/client'
import { buildOrdersSnapshot } from '../../api/orders-fixtures'
import { clearPageData } from '../../lib/pageData'
import { HoldingsOrders, holdingsOrderRows } from './HoldingsOrders'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  clearPageData()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('持仓页委托', () => {
  it('按下单时间排序，保留同一交易对的现货和杠杆委托，排除合约', () => {
    const snapshot = buildOrdersSnapshot(new Date('2026-10-02T16:00:00Z'))
    const spot = snapshot.history.find((order) => order.venue === 'spot')!
    const older = { ...spot, id: 'margin:old', venue: 'margin' as const,
      created_at: '2026-09-01T10:00:00Z', updated_at: '2026-10-02T15:00:00Z' }
    const newer = { ...spot, id: 'margin:new', venue: 'margin' as const,
      created_at: '2026-09-20T10:00:00Z', updated_at: '2026-09-20T10:00:00Z' }
    snapshot.history.push(older, newer)

    const rows = holdingsOrderRows(snapshot)
    expect(rows.open.some((order) => order.venue === 'usdm')).toBe(false)
    expect(rows.history.some((order) => order.venue === 'usdm')).toBe(false)
    expect(rows.history.some((order) => order.id === spot.id && order.venue === 'spot')).toBe(true)
    expect(rows.history.findIndex((order) => order.id === newer.id))
      .toBeLessThan(rows.history.findIndex((order) => order.id === older.id))
  })

  it('三个账户取齐再显示，之前是占位行；能筛选历史状态与展开成交明细', async () => {
    act(() => root.render(createElement(HoldingsOrders, { scenario: 'ok' })))
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(host.textContent).not.toContain('读取中')

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1320)) })
    const current = host.querySelector('[aria-label="当前持仓委托列表"]')!
    expect(current.textContent).toContain('杠杆')
    expect(current.getAttribute('data-scroll-region')).toBe('holdings-orders')
    expect([...host.querySelectorAll('[aria-label="持仓委托分类"] [role="tab"]')]
      .map((tab) => tab.textContent)).toEqual(['当前委托', '历史委托'])

    const historyTab = host.querySelector<HTMLButtonElement>('#holdings-order-history')!
    act(() => historyTab.click())
    expect(host.querySelector('[aria-label="历史持仓委托列表"]')?.textContent).toContain('SOXL')
    const filled = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="历史委托状态"] button')]
      .find((button) => button.textContent === '已成交')!
    act(() => filled.click())
    expect(filled.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('[aria-label="历史持仓委托列表"]')?.textContent).not.toContain('已撤销')

    const allStatus = [...host.querySelectorAll<HTMLButtonElement>('[aria-label="历史委托状态"] button')]
      .find((button) => button.textContent === '全部')!
    act(() => allStatus.click())
    const detail = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('成交明细'))!
    act(() => detail.click())
    expect(host.textContent).toContain('手续费')
    expect(host.textContent).toContain('BNB')
  })

  it('指定 venue 查询保留其各自委托，不以当前持仓推断订单账户', async () => {
    const snapshots = await Promise.all((['spot', 'margin', 'equity'] as const)
      .map((venue) => fetchOrders('ok', '', undefined, { venue })))
    const rows = holdingsOrderRows(snapshots)
    expect(rows.open.some((order) => order.venue === 'spot')).toBe(true)
    expect(rows.open.some((order) => order.venue === 'margin')).toBe(true)
    expect(rows.history.some((order) => order.venue === 'equity')).toBe(true)
  })

  it('取过一次之后再打开，第一帧就是上一次的数据', async () => {
    act(() => root.render(createElement(HoldingsOrders, { scenario: 'ok' })))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1320)) })
    act(() => root.unmount())
    root = createRoot(host)
    act(() => root.render(createElement(HoldingsOrders, { scenario: 'ok' })))
    expect(host.querySelector('[aria-busy="true"]')).toBeNull()
    expect(host.querySelector('[aria-label="当前持仓委托列表"]')?.textContent).toContain('BNB')
  })
})
