import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSnapshot } from '../../api/fixtures'
import { percent } from '../../lib/format'
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

describe('活期理财的阶梯年化', () => {
  it('年化按当前金额加权，不是那个挂牌的实时利率', () => {
    const snapshot = buildSnapshot(new Date('2026-09-19T12:00:00Z'))
    const flexible = snapshot.earn.find((row) => row.product_id === 'USDT-FLEX')!
    // 前 500 按 12%，其余 7500 按实时 4.82%
    expect(flexible.apr).toBeCloseTo((500 * 0.12 + 7500 * 0.0482) / 8000)
    expect(flexible.apr_base).toBeCloseTo(0.0482)

    act(() => root.render(createElement(HoldingsView, { snapshot, veiled: false })))
    const text = host.textContent ?? ''
    expect(text).toContain(`${percent(flexible.apr, 2)} 年化`)
    // 吃到的那一档要说出来，否则与 Binance 首屏那个利率对不上，看着像错的
    expect(text).toContain(`前 500 按 ${percent(0.12, 2)}`)
    expect(text).toContain(`其余 ${percent(0.0482, 2)}`)
  })

  it('定期是一口价，没有阶梯那一行', () => {
    const snapshot = buildSnapshot(new Date('2026-09-19T12:00:00Z'))
    const locked = snapshot.earn.find((row) => row.kind === 'locked')!
    expect(locked.apr).toBeCloseTo(0.065)
    expect(locked.apr_tiers).toEqual([])
  })
})
