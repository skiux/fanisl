import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSnapshot } from '../../api/fixtures'
import { signedMoney } from '../../lib/format'
import { RiskControlView } from './RiskControl'
import { HoldingsView, OverviewView, PerpRiskView } from './views'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
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

const titles = () => [...host.querySelectorAll('h2')].map((heading) => heading.textContent)

describe('资产页模块分布', () => {
  it('「资产分布」（交易所里的稳定币）只在总览，充提不再占用总览模块', () => {
    const snapshot = buildSnapshot(new Date('2026-09-26T12:00:00Z'))

    act(() => root.render(createElement(OverviewView, {
      snapshot,
    })))
    // 这个模块原先叫「现金」，与摘要条上管理员录入的「现金」重名，2026-10-03 改名
    expect(titles()).toContain('资产分布')
    expect(titles()).not.toContain('现金')
    expect(titles()).not.toContain('充提')
    expect(titles()).not.toContain('风险仪表')
    const cashSection = [...host.querySelectorAll('h2')]
      .find((heading) => heading.textContent === '资产分布')!.closest('section')!
    const rightStack = cashSection.parentElement!
    expect(rightStack.className).toContain('lg:col-span-5')
    expect(cashSection.querySelector('dl')?.className).toContain('xl:grid-cols-4')
    const cashTableHead = [...cashSection.querySelectorAll('div')]
      .find((row) => row.textContent === '资产账户年化价值')!
    expect(cashTableHead.className).toContain('xl:grid-cols-[')
    expect(cashSection.textContent).toContain('理财收益')
    const incomeSection = [...host.querySelectorAll('h2')]
      .find((heading) => heading.textContent === '合约收支')!.closest('section')!
    expect(incomeSection.parentElement).toBe(rightStack)
    expect(cashSection.compareDocumentPosition(incomeSection) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy()
    const calendarSection = [...host.querySelectorAll('h2')]
      .find((heading) => heading.textContent === '每日盈亏')!.closest('section')!
    expect(calendarSection.className).toContain('lg:col-span-7')
    expect(calendarSection.className).toContain('self-start')
    const dailyDetail = calendarSection.querySelector('aside')!
    expect(dailyDetail.className).not.toContain('lg:border-l')
    expect(dailyDetail.querySelector('dl')?.className).toContain('divide-y')
    expect(dailyDetail.querySelector('dl')?.className).not.toContain('grid-cols')
    const fundingLabel = [...dailyDetail.querySelectorAll('dt')]
      .find((node) => node.textContent === '资金费用')!
    expect(fundingLabel.nextElementSibling?.textContent)
      .toBe(signedMoney(snapshot.pnl!.daily.at(-1)!.settled_parts!.funding_fee))
    const closingLabel = [...host.querySelectorAll('aside dt')]
      .find((node) => node.textContent === '合约平仓')!
    expect(closingLabel.nextElementSibling?.textContent)
      .toBe(signedMoney(snapshot.pnl!.daily.at(-1)!.settled_parts!.realized_pnl))

    act(() => root.render(createElement(HoldingsView, { snapshot })))
    expect(titles()).not.toContain('现金')
  })

  it('杠杆账户从合约页迁到持仓页并替换现货钱包可用', () => {
    const snapshot = buildSnapshot(new Date('2026-09-26T12:00:00Z'))

    act(() => root.render(createElement(HoldingsView, { snapshot })))
    expect(titles()).toContain('杠杆账户')
    expect(titles()).not.toContain('现货钱包可用')

    act(() => root.render(createElement(PerpRiskView, {
      futuresMissing: false,
      scenario: 'ok',
      snapshot,
    })))
    expect(titles()).not.toContain('杠杆账户')
  })

  it('点击日历日期后在日历下方切换当天明细', () => {
    const snapshot = buildSnapshot(new Date('2026-09-26T12:00:00Z'))
    const day = snapshot.pnl!.daily.filter((row) => row.known).at(-3)!
    act(() => root.render(createElement(OverviewView, { snapshot })))

    const cell = host.querySelector<HTMLButtonElement>(`button[title^="${day.date} "]`)!
    expect(cell).toBeDefined()
    act(() => cell.click())

    const detail = [...host.querySelectorAll('aside')]
      .find((node) => node.textContent?.includes(day.date))!
    expect(detail.textContent).toContain('现货涨跌')
    expect(detail.textContent).not.toContain('合约结算')
    const fundingLabel = [...detail.querySelectorAll('dt')]
      .find((node) => node.textContent === '资金费用')!
    expect(fundingLabel.nextElementSibling?.textContent)
      .toBe(signedMoney(day.settled_parts!.funding_fee))
    const closingLabel = [...detail.querySelectorAll('dt')]
      .find((node) => node.textContent === '合约平仓')!
    expect(closingLabel.nextElementSibling?.textContent)
      .toBe(signedMoney(day.settled_parts!.realized_pnl))
    expect(cell.getAttribute('aria-pressed')).toBe('true')
  })

  it('理财收益按当前本金和年化给出一日估算，并计入 BFUSD', () => {
    const snapshot = buildSnapshot(new Date('2026-09-26T12:00:00Z'))
    const expected = (
      snapshot.earn.filter((row) => snapshot.stable_assets.includes(row.asset))
        .reduce((sum, row) => sum + (row.value_usd ?? 0) * (row.apr ?? 0), 0)
      + 3000 * snapshot.yield_rates.BFUSD!
    ) / 365

    act(() => root.render(createElement(OverviewView, { snapshot })))
    const section = [...host.querySelectorAll('h2')]
      .find((heading) => heading.textContent === '资产分布')!.closest('section')!
    expect(section.textContent).toContain('预计日收益')
    expect(section.textContent).toContain(`$${expected.toFixed(2)}`)
    expect(section.textContent).not.toContain('累计收益')

    act(() => root.render(createElement(HoldingsView, { snapshot })))
    expect(titles()).not.toContain('理财收益')
    expect(titles()).not.toContain('理财持仓')
    expect(host.textContent).not.toContain('小额余额')
  })

  it('合约右栏从保证金开始，不重复顶部的盈亏与资金费用', () => {
    const snapshot = buildSnapshot(new Date('2026-09-26T12:00:00Z'))
    act(() => root.render(createElement(PerpRiskView, {
      futuresMissing: false, scenario: 'ok', snapshot,
    })))

    expect(titles()).not.toContain('合约账户')
    expect(titles()).toContain('保证金')
    expect(host.textContent).not.toContain('预估资金费用')
    expect(host.textContent).not.toContain('今日资金费用')
    expect(host.textContent).not.toContain('排序')
    expect([...host.querySelectorAll('button')].some((button) => button.textContent === '杠杆')).toBe(false)
    expect([...host.querySelectorAll('button')].some((button) => button.textContent === '标的')).toBe(false)
    const positionWheel = host.querySelector('[data-contract-allocation]')!
    expect(positionWheel).not.toBeNull()
    expect(positionWheel.querySelectorAll('[data-slice]')).toHaveLength(snapshot.futures!.positions.length)
    expect([...positionWheel.querySelectorAll('[data-chart-label]')]
      .every((label) => label.textContent?.includes('+ '))).toBe(true)
    expect(titles()).toContain('逐仓杠杆账户')
  })

  it('合约价值轮用正负号表达多空方向', () => {
    const snapshot = buildSnapshot(new Date('2026-09-26T12:00:00Z'))
    const futures = snapshot.futures!
    snapshot.futures = {
      ...futures,
      positions: futures.positions.map((position, index) => index === 0
        ? { ...position, position_amt: -Math.abs(position.position_amt), position_side: 'short' }
        : position),
    }

    act(() => root.render(createElement(PerpRiskView, {
      futuresMissing: false, scenario: 'ok', snapshot,
    })))

    const labels = [...host.querySelectorAll('[data-contract-allocation] [data-chart-label]')]
    expect(labels.some((label) => label.textContent?.includes('− NVDA'))).toBe(true)
    expect(labels.filter((label) => !label.textContent?.includes('NVDA'))
      .every((label) => label.textContent?.includes('+ '))).toBe(true)
  })

  it('风险控制只在分布标题处显示一次持仓数量', () => {
    const snapshot = buildSnapshot(new Date('2026-09-26T12:00:00Z'))
    act(() => root.render(createElement(RiskControlView, { snapshot })))

    const section = [...host.querySelectorAll('h2')]
      .find((heading) => heading.textContent === '持仓价值分布')!.closest('section')!
    expect(section.textContent?.match(/12 个持仓/g)).toHaveLength(1)
  })
})
