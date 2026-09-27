import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RangePicker } from './RangePicker'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value(this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? 0
    },
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((item) => item.textContent?.trim() === label)!
}

describe('自定义日期区间', () => {
  it('取消不写入草稿，完成才提交默认的 30 天区间', () => {
    const onChange = vi.fn()
    act(() => root.render(createElement(RangePicker, {
      active: false,
      first: '2026-06-29',
      last: '2026-09-26',
      onChange,
      today: '2026-09-26',
      value: null,
    })))

    act(() => button('自定义').click())
    expect(document.querySelector('[role="dialog"] h2')?.classList).toContain('sr-only')
    expect(button('2026年8月28日').getAttribute('aria-label'))
      .toBe('开始日期 2026年8月28日')
    expect(button('2026年9月26日').getAttribute('aria-label'))
      .toBe('结束日期 2026年9月26日')
    act(() => button('取消').click())
    expect(onChange).not.toHaveBeenCalled()

    act(() => button('自定义').click())
    act(() => button('完成').click())
    expect(onChange).toHaveBeenCalledWith({ from: '2026-08-28', to: '2026-09-26' })
  })

  it('日期范围是当前日前后一年，日轮首尾循环', () => {
    act(() => root.render(createElement(RangePicker, {
      active: false,
      first: '2026-06-29',
      last: '2026-09-26',
      onChange: vi.fn(),
      today: '2026-09-26',
      value: null,
    })))
    act(() => button('自定义').click())

    const monthWheel = document.querySelector<HTMLElement>('[aria-label="年月"]')!
    expect(monthWheel.textContent).toContain('2025 年 9 月')
    expect(monthWheel.textContent).toContain('2027 年 9 月')
    expect(monthWheel.textContent).not.toContain('2025 年 8 月')

    const dayWheel = document.querySelector<HTMLElement>('[aria-label="日"]')!
    const firstDay = [...dayWheel.querySelectorAll<HTMLButtonElement>('button')]
      .find((item) => item.textContent === '1')!
    act(() => firstDay.click())
    expect(button('2026年8月1日')).toBeDefined()

    act(() => dayWheel.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true, key: 'ArrowUp',
    })))
    expect(button('2026年8月31日')).toBeDefined()

    const september = [...monthWheel.querySelectorAll<HTMLButtonElement>('button')]
      .find((item) => item.textContent?.trim() === '2026 年 9 月')!
    act(() => september.click())
    expect(button('2026年8月31日')).toBeDefined()
  })
})
