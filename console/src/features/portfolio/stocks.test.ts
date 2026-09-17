import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSnapshot } from '../../api/fixtures'
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
  it('正股与代币化股票在同一个模块里，没有估值的写「—」而不是 $0', () => {
    const base = buildSnapshot(new Date('2026-09-17T12:00:00Z'))
    const snapshot = {
      ...base,
      stocks: {
        ...base.stocks,
        equity_holdings: [
          { asset_code: 'EQ_SOXL', symbol: 'SOXL', name: '', qty: 40,
            price_usd: 28.5, value_usd: 1140, wallet: 'funding' },
          { asset_code: 'EQ_TQQQ', symbol: 'TQQQ', name: '', qty: 5,
            price_usd: null, value_usd: null, wallet: 'funding' },
        ],
      },
    }
    act(() => root.render(createElement(HoldingsView, { snapshot, veiled: false })))
    const text = host.textContent ?? ''
    expect(text).toContain('2 只正股')
    expect(text).toContain('1 项代币化')
    expect(text).toContain('1 项无估值')
    expect(text).toContain('SOXL')
    expect(text).toContain('$1,140.00')
    expect(text).toContain('AAPLB')
    expect(text).not.toContain('TQQQ$0.00')
  })
})
