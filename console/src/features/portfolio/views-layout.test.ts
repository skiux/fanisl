import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSnapshot } from '../../api/fixtures'
import { HoldingsView, OverviewView, PerpRiskView } from './views'

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

  it('杠杆账户从合约页迁到持仓页并替换现货钱包可用', () => {
    const snapshot = buildSnapshot(new Date('2026-09-26T12:00:00Z'))

    act(() => root.render(createElement(HoldingsView, { snapshot, veiled: false })))
    expect(titles()).toContain('杠杆账户')
    expect(titles()).not.toContain('现货钱包可用')

    act(() => root.render(createElement(PerpRiskView, {
      futuresMissing: false,
      snapshot,
      veiled: false,
    })))
    expect(titles()).not.toContain('杠杆账户')
  })

  it('理财收益按当前本金和年化给出一日估算，并计入 BFUSD', () => {
    const snapshot = buildSnapshot(new Date('2026-09-26T12:00:00Z'))
    const expected = (
      snapshot.earn.filter((row) => snapshot.stable_assets.includes(row.asset))
        .reduce((sum, row) => sum + (row.value_usd ?? 0) * (row.apr ?? 0), 0)
      + 3000 * snapshot.yield_rates.BFUSD!
    ) / 365

    act(() => root.render(createElement(HoldingsView, { snapshot, veiled: false })))
    const section = [...host.querySelectorAll('h2')]
      .find((heading) => heading.textContent === '理财收益')!.closest('section')!
    expect(section.textContent).toContain('预计日收益')
    expect(section.textContent).toContain(`$${expected.toFixed(2)}`)
    expect(section.textContent).not.toContain('累计收益')
  })
})
