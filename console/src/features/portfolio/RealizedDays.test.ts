import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DailyPnl } from '../../api/types'
import { RealizedDays } from './RealizedDays'

let host: HTMLDivElement
let root: Root

function days(from: string, count: number): DailyPnl[] {
  const start = new Date(`${from}T00:00:00Z`)
  return Array.from({ length: count }, (_, index) => {
    const at = new Date(start)
    at.setUTCDate(at.getUTCDate() + index)
    return {
      date: at.toISOString().slice(0, 10),
      spot_usd: index + 1,
      stock_usd: 0,
      settled_usd: 0,
      earn_usd: 0,
      interest_usd: 0,
      pnl_usd: index + 1,
      known: true,
    }
  })
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

describe('盈亏日历统计区间', () => {
  it('本月从 UTC 月初统计到最新可用日期', () => {
    act(() => root.render(createElement(RealizedDays, {
      days: days('2026-08-20', 17), // 最新日期为 2026-09-05
    })))

    expect(host.textContent).toContain('区间 17 天')
    const month = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '本月')!
    expect(month).toBeDefined()

    act(() => month.click())

    expect(month.getAttribute('data-state')).toBe('on')
    expect(host.textContent).toContain('2026 年 9 月')
    expect(host.textContent).toContain('区间 5 天')
  })
})
