import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stocks } from '../../api/fixtures'
import { StockCostEditor } from './StockCostEditor'

let host: HTMLDivElement
let root: Root

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

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

describe('stock cost editor', () => {
  it('previews total and average, then submits the current quantity', async () => {
    const row = { ...stocks.positions[0], cost_price_usd: null, commission_usd: null,
      cost_position_qty: null, cost_updated_at: null, cost_status: 'missing' as const }
    const save = vi.fn().mockResolvedValue(undefined)
    await act(async () => root.render(createElement(
      StockCostEditor, { onCancel: () => {}, onSave: save, row })))
    const inputs = host.querySelectorAll<HTMLInputElement>('input')
    expect([...inputs].map((input) => [input.type, input.inputMode]))
      .toEqual([['text', 'decimal'], ['text', 'decimal']])

    await act(async () => {
      setInput(inputs[0], '24')
      setInput(inputs[1], '1.6')
    })

    expect(host.textContent).toContain('$961.60')
    expect(host.textContent).toContain('$24.04')
    await act(async () => host.querySelector('form')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })))
    expect(save).toHaveBeenCalledWith({
      cost_price_usd: 24, commission_usd: 1.6, position_qty: 40,
    })
  })

  it('keeps entered values and shows an inline error when saving fails', async () => {
    const row = { ...stocks.positions[0], cost_price_usd: null, commission_usd: null,
      cost_position_qty: null, cost_updated_at: null, cost_status: 'missing' as const }
    const save = vi.fn().mockRejectedValue(new Error('成本已保存，但账户快照刷新失败'))
    await act(async () => root.render(createElement(
      StockCostEditor, { onCancel: () => {}, onSave: save, row })))
    const inputs = host.querySelectorAll<HTMLInputElement>('input')
    await act(async () => {
      setInput(inputs[0], '23')
      setInput(inputs[1], '4')
      host.querySelector('form')?.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('快照刷新失败')
    expect(inputs[0].value).toBe('23')
    expect(inputs[1].value).toBe('4')
  })
})
