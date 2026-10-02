import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchOrders } from '../../api/client'
import { PerpOrders, futuresOrderRows } from './PerpOrders'

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

describe('合约页委托', () => {
  it('按账户查询，只把已结束的合约委托放入历史', async () => {
    const snapshot = await fetchOrders('ok', '', undefined, { venue: 'usdm' })
    const active = snapshot.open.find((order) => order.venue === 'usdm')!
    snapshot.history.push({ ...active })
    const rows = futuresOrderRows(snapshot)

    expect(snapshot.query?.venue).toBe('usdm')
    expect(snapshot.query?.max_window_hours).toBe(168)
    expect(snapshot.query?.lookback_days).toBe(90)
    expect(rows.open).toHaveLength(7)
    expect(rows.history).toHaveLength(7)
    expect(rows.fills).toHaveLength(5)
    expect(rows.history.every((order) => !['new', 'partially_filled'].includes(order.status)))
      .toBe(true)
    expect([...rows.open, ...rows.history, ...rows.fills]
      .every((row) => row.venue === 'usdm')).toBe(true)
  })

  it('合约域名故障时仍保留 sapi 返回的策略单', async () => {
    const snapshot = await fetchOrders('fapi_blocked', '', undefined, { venue: 'usdm' })
    expect(futuresOrderRows(snapshot).open.map((order) => order.kind)).toEqual(['twap'])
  })

  it('界面只有当前和历史两类，历史委托内可查看逐笔成交', async () => {
    act(() => root.render(createElement(PerpOrders, { scenario: 'ok', asOf: null })))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)) })
    const tabs = [...host.querySelectorAll('[role="tab"]')]
    expect(tabs.map((tab) => tab.textContent)).toEqual(['当前委托', '历史委托'])

    act(() => (tabs[1] as HTMLButtonElement).click())
    expect(host.textContent).toContain('已撤销')
    const filledFilter = [...host.querySelectorAll('button')]
      .find((button) => button.textContent === '已成交')!
    act(() => filledFilter.click())
    expect(filledFilter.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelectorAll('#perp-order-panel > ul > li')).toHaveLength(3)
    expect(host.querySelector('#perp-order-panel > ul')?.textContent).not.toContain('已撤销')
    const allFilter = [...host.querySelectorAll('button')]
      .find((button) => button.textContent === '全部')!
    act(() => allFilter.click())
    const detail = [...host.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('成交明细'))!
    act(() => detail.click())
    expect(host.textContent).toContain('手续费')
    expect(host.textContent).toContain('已实现')
  })

  it('来源只取到一部分时保留可用委托，不显示取数技术说明或完整数量', async () => {
    act(() => root.render(createElement(PerpOrders, { scenario: 'fapi_blocked', asOf: null })))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)) })
    expect(host.textContent).toContain('TWAP 策略')
    expect(host.textContent).not.toContain('部分挂单未取到')
    expect(host.querySelector('[aria-label="重新读取委托"]')).not.toBeNull()
    expect(host.querySelector('[data-order-count]')).toBeNull()
  })
})
