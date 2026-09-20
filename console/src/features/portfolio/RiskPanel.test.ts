import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSnapshot } from '../../api/fixtures'
import { PositionsList } from './RiskPanel'

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

describe('合约持仓交易时段', () => {
  it('只显示对用户有用的休市状态，不泄露 TradFi 与 NO_TRADING 枚举', () => {
    const snapshot = buildSnapshot(new Date('2026-09-20T12:00:00Z'))
    const futures = {
      ...snapshot.futures!,
      positions: [{
        ...snapshot.futures!.positions[0],
        market_session: 'NO_TRADING',
      }],
    }

    act(() => root.render(createElement(PositionsList, { futures, unavailable: false })))

    expect(host.textContent).toContain('休市')
    expect(host.textContent).not.toContain('NO_TRADING')
    expect(host.textContent).not.toContain('TradFi')
  })
})
