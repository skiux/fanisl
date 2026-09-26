import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSnapshot } from '../../api/fixtures'
import { HoldingsView, OverviewView } from './views'

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

const titles = () => [...host.querySelectorAll('h2')].map((heading) => heading.textContent)

describe('资产页模块分布', () => {
  it('现金只在总览，资产分布与充提不再占用总览模块', () => {
    const snapshot = buildSnapshot(new Date('2026-09-26T12:00:00Z'))

    act(() => root.render(createElement(OverviewView, {
      concentration: null,
      futuresMissing: false,
      onOpen: vi.fn(),
      snapshot,
      veiled: false,
    })))
    expect(titles()).toContain('现金')
    expect(titles()).not.toContain('资产分布')
    expect(titles()).not.toContain('充提')
    const cashSection = [...host.querySelectorAll('h2')]
      .find((heading) => heading.textContent === '现金')!.closest('section')!
    expect(cashSection.querySelector('dl')?.className).toContain('xl:grid-cols-4')
    const cashTableHead = [...cashSection.querySelectorAll('div')]
      .find((row) => row.textContent === '资产账户年化价值')!
    expect(cashTableHead.className).toContain('xl:grid-cols-[')

    act(() => root.render(createElement(HoldingsView, { snapshot, veiled: false })))
    expect(titles()).not.toContain('现金')
  })
})
