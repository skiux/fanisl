import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSnapshot } from '../../api/fixtures'
import { exposures } from '../../lib/holdings'
import { money } from '../../lib/format'
import { openingCapacity, positionSize, positionTarget, shock } from '../../lib/stress'
import { RiskControlView } from './RiskControl'
import { ExposureDistribution } from './ExposureDistribution'

let host: HTMLDivElement
let root: Root
let width: ReturnType<typeof vi.spyOn>
const snapshot = buildSnapshot(new Date())
const longTotal = exposures(snapshot, snapshot.totals!.equity_usd)
  .reduce((sum, row) => sum + Math.max(0, (row.gross_usd + row.net_usd) / 2), 0)

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(340)
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  HTMLElement.prototype.scrollTo = vi.fn()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
})

function render(data = snapshot) {
  act(() => root.render(createElement(RiskControlView, { snapshot: data, veiled: false })))
}

describe('敞口分布', () => {
  it('压力测试同时给出现在与 1×、1.5×、2× 的总仓位和相对当前增量', () => {
    render()
    const choices = [...host.querySelectorAll<HTMLElement>('.stress-size-option')]
    expect(choices).toHaveLength(4)
    expect(choices[0].textContent).toContain(money(positionSize(snapshot)!))
    for (const [index, leverage] of [1, 1.5, 2].entries()) {
      const target = positionTarget(snapshot, leverage)
      expect(choices[index + 1].textContent).toContain(money(target.notional_usd!))
      expect(choices[index + 1].textContent).toContain('还可开')
      expect(choices[index + 1].textContent).toContain(money(target.remaining_usd!))
    }
    act(() => choices[3].click())
    expect(choices[3].getAttribute('aria-checked')).toBe('true')
    expect(host.textContent).toContain('仓位 2× · 跌 30% 之后的净值')
  })

  it('保留下跌前后按 1×、2×、3×、5× 计算的可开仓位', () => {
    render()
    const capacity = host.querySelector<HTMLElement>('[data-open-capacity]')!
    const current = positionSize(snapshot)
    const afterDrop = shock(snapshot, 0.3)
    for (const leverage of [1, 2, 3, 5]) {
      const column = capacity.querySelector<HTMLElement>(`[data-open-leverage="${leverage}"]`)!
      expect(column.textContent).toContain(`${leverage}×`)
      expect(column.textContent).toContain(money(openingCapacity(
        snapshot.totals!.equity_usd, current, leverage,
      )!))
      expect(column.textContent).toContain(money(openingCapacity(
        afterDrop.equity_usd, afterDrop.position_usd, leverage,
      )!))
    }
    expect([...capacity.querySelectorAll('dd')]
      .every((value) => !value.classList.contains('truncate'))).toBe(true)
    expect(capacity.querySelector('[data-open-leverage="10"]')).toBeNull()
  })

  it('没有现有合约仓位时不伪造目标仓位压力结果', () => {
    render({
      ...snapshot,
      futures: { ...snapshot.futures!, positions: [] },
    })
    const choices = [...host.querySelectorAll<HTMLButtonElement>('.stress-size-option')]
    expect(choices[0].disabled).toBe(false)
    expect(choices.slice(1).every((choice) => choice.disabled)).toBe(true)
    expect(host.textContent).toContain('当前没有合约仓位，无法推导目标仓位的标的分布')
  })

  it('仓位规模支持方向键切换，并只保留当前项进入 Tab 顺序', () => {
    render()
    let choices = [...host.querySelectorAll<HTMLButtonElement>('.stress-size-option')]
    expect(choices.map((choice) => choice.tabIndex)).toEqual([0, -1, -1, -1])
    choices[0].focus()
    act(() => choices[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    choices = [...host.querySelectorAll<HTMLButtonElement>('.stress-size-option')]
    expect(choices[1].getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(choices[1])
    expect(choices.map((choice) => choice.tabIndex)).toEqual([-1, 0, -1, -1])
  })

  it('开发数据有十二个真实量级的标的，前三项合计约占多头的一半', () => {
    const rows = exposures(snapshot, snapshot.totals!.equity_usd)
      .map((row) => Math.max(0, (row.gross_usd + row.net_usd) / 2))
      .filter((value) => value > 0)
      .sort((a, b) => b - a)
    const total = rows.reduce((sum, value) => sum + value, 0)
    expect(rows).toHaveLength(12)
    expect(rows.slice(0, 3).reduce((sum, value) => sum + value, 0) / total).toBeCloseTo(0.5, 1)
    render()
    expect(host.querySelector('[data-allocation-total]')!.textContent).toBe(money(longTotal))
  })

  it('所有有多头金额的资产都保留独立区域，包括不足 1% 的小额资产', () => {
    render()
    const expected = exposures(snapshot, snapshot.totals!.equity_usd)
      .filter((row) => row.gross_usd + row.net_usd > 0)
      .map((row) => row.asset).sort()
    const sectors = [...host.querySelectorAll('[data-slice]')]
    expect(sectors.map((node) => node.getAttribute('data-slice')).sort()).toEqual(expected)
    expect(host.textContent).not.toContain('其他')
  })

  it('340px 的十二个透明扇区都在标签内显示 Logo、代码、金额和占比', () => {
    render()
    const labels = [...host.querySelectorAll<HTMLElement>('[data-chart-label]')]
    expect(labels).toHaveLength(12)
    for (const label of labels) {
      const asset = label.dataset.chartLabel!
      const mark = label.querySelector<HTMLElement>(`[data-asset-mark="${asset}"]`)
      expect(mark).not.toBeNull()
      expect(label.textContent).toMatch(/\$/)
      expect(label.textContent).toMatch(/%/)
      const sector = host.querySelector<SVGPathElement>(`[data-slice="${asset}"]`)!
      expect(sector.getAttribute('fill')).toBeNull()
      if (asset === 'XAU') expect(mark!.textContent).toBe('Au')
      else expect(mark!.getAttribute('src')).toMatch(new RegExp(`/icons/${asset}\\.(svg|png|ico)$`))
    }
    expect(host.querySelectorAll('[data-asset-mark]')).toHaveLength(12)
    expect(host.querySelector('[data-chart-label="AMZN"] [data-asset-mark="AMZN"]')?.getAttribute('src'))
      .toMatch(/\/icons\/AMZN\.ico$/)
    expect(host.querySelectorAll('linearGradient, filter, clipPath, [data-allocation-logo-background], .allocation-sector-bed')).toHaveLength(0)
    // 正常样例最小仓位约 1.9%。窄扇区使用外移的紧凑标签后，移动端不应退化成 5px 字。
    expect(Math.min(...labels.map((label) => Number(label.dataset.labelFontSize)))).toBeGreaterThan(6.5)
  })

  it.each([254, 340])('%ipx 下仓位极度集中时所有扇区仍连续闭合且保留标签', (chartWidth) => {
    width.mockReturnValue(chartWidth)
    const values = [9850, 100, 25, 12, 6, 4, 2, 0.9, 0.1]
    act(() => root.render(createElement(ExposureDistribution, { rows: values.map((value, index) => ({
      asset: `ASSET${index}`, spot_usd: value, perp_usd: 0,
      net_usd: value, gross_usd: value, share: value / 10_000,
    })) })))
    const wheel = host.querySelector<HTMLElement>('.allocation-wheel')!
    const sectors = [...host.querySelectorAll<HTMLElement>('[data-slice]')].map((node) => ({
      start: Number(node.dataset.start), end: Number(node.dataset.end),
    }))
    expect(Number(wheel.dataset.diameter)).toBe(chartWidth)
    expect(sectors).toHaveLength(values.length)
    expect(host.querySelectorAll('[data-chart-label]')).toHaveLength(values.length)
    expect(sectors[0].start).toBeCloseTo(-Math.PI / 2, 10)
    expect(sectors.at(-1)!.end).toBeCloseTo(Math.PI * 1.5, 10)
    for (let index = 1; index < sectors.length; index += 1) {
      expect(sectors[index].start).toBeCloseTo(sectors[index - 1].end, 10)
    }
  })

  it('宽屏遇到极小仓位时仍保留每个独立区域和完整标签', () => {
    width.mockReturnValue(640)
    const values = [9850, 100, 25, 12, 6, 4, 2, 0.9, 0.1]
    act(() => root.render(createElement(ExposureDistribution, { rows: values.map((value, index) => ({
      asset: `ASSET${index}`, spot_usd: value, perp_usd: 0,
      net_usd: value, gross_usd: value, share: value / 10_000,
    })) })))
    expect(host.querySelectorAll('[data-slice]')).toHaveLength(values.length)
    expect(host.querySelectorAll('[data-chart-label]')).toHaveLength(values.length)
    expect(host.textContent).not.toContain('其他')
  })

  it('宽屏圆形图为十二个仓位逐一显示标签 Logo、代码、金额和占比', () => {
    width.mockReturnValue(640)
    render()
    const labels = [...host.querySelectorAll<HTMLElement>('[data-chart-label]')]
    expect(labels).toHaveLength(12)
    for (const label of labels) {
      expect(label.querySelector(`[data-asset-mark="${label.dataset.chartLabel}"]`)).not.toBeNull()
      expect(label.textContent).toMatch(/\$/)
      expect(label.textContent).toMatch(/%/)
      expect(host.querySelector(`[data-slice="${label.dataset.chartLabel}"]`)?.getAttribute('data-share')).not.toBeNull()
    }
  })

  it('中小扇区保持同一信息面积占比，大扇区平滑收敛且不越过可用宽度', () => {
    width.mockReturnValue(640)
    render()
    const labels = new Map([...host.querySelectorAll<HTMLElement>('[data-chart-label]')]
      .map((label) => [label.dataset.chartLabel!, label]))
    const fontSize = (asset: string) => Number(labels.get(asset)!.dataset.labelFontSize)
    expect(fontSize('SOL') / fontSize('AAPL')).toBeCloseTo(Math.sqrt(3_500.001516 / 3_000.04428), 5)
    expect(fontSize('BTC')).toBeGreaterThan(fontSize('NVDA'))
    expect(fontSize('NVDA')).toBeGreaterThan(fontSize('XAU'))
    for (const asset of ['BTC', 'NVDA', 'XAU']) {
      const label = labels.get(asset)!
      expect(Number(label.dataset.labelFontSize)).toBeLessThan(Number(label.dataset.labelProportionalSize))
    }
    for (const label of labels.values()) {
      expect(Number(label.dataset.labelContentWidth)).toBeLessThanOrEqual(Number(label.dataset.labelRoom))
    }
  })

  it('图形高度随标的数量增长，宽屏十二项仍控制在 420px 内', () => {
    width.mockReturnValue(640)
    const compact = [6000, 3000, 1000].map((value, index) => ({
      asset: `ASSET${index}`, spot_usd: value, perp_usd: 0,
      net_usd: value, gross_usd: value, share: value / 10_000,
    }))
    act(() => root.render(createElement(ExposureDistribution, { rows: compact })))
    const threeItemHeight = Number.parseFloat(host.querySelector<HTMLElement>('.allocation-chart')!.style.height)
    render()
    const twelveItemHeight = Number.parseFloat(host.querySelector<HTMLElement>('.allocation-chart')!.style.height)
    expect(twelveItemHeight).toBeGreaterThan(threeItemHeight)
    expect(twelveItemHeight).toBeLessThanOrEqual(420)
  })

  it('圆心区域和文字在移动端仍保持可读尺寸', () => {
    render()
    const center = host.querySelector<HTMLElement>('[data-allocation-center]')!
    const content = center.querySelector<HTMLElement>('.allocation-center-content')!
    expect(Number(center.dataset.centerDiameter)).toBeGreaterThan(84)
    expect(Number.parseFloat(content.style.fontSize)).toBeGreaterThanOrEqual(10.5)
    expect(center.textContent).toBe(money(longTotal))
  })

  it('选择资产不压暗任何区域，重复点击与 Escape 都能取消选择', () => {
    render()
    const original = new Map([...host.querySelectorAll<HTMLElement>('[data-slice]')]
      .map((tile) => [tile.dataset.slice, { background: tile.style.background, opacity: tile.style.opacity }]))
    const button = [...host.querySelectorAll('button')]
      .find((node) => node.textContent?.includes('QQQ'))!
    act(() => button.click())
    expect(button.getAttribute('aria-pressed')).toBe('true')
    const cursor = host.querySelector<SVGCircleElement>('[data-selection-cursor]')!
    expect(cursor.getAttribute('data-active')).toBe('true')
    const qqqOffset = cursor.getAttribute('stroke-dashoffset')
    const center = host.querySelector<HTMLElement>('[data-allocation-center]')!
    expect(center.dataset.centerAsset).toBe('QQQ')
    expect(center.querySelector('[data-asset-mark="QQQ"]')).not.toBeNull()
    expect(center.textContent).not.toContain('QQQ')
    expect(center.textContent).toContain('$5,500.60')
    expect(center.textContent).toContain(`${(5500.6 / longTotal * 100).toFixed(1)}%`)
    for (const tile of host.querySelectorAll<HTMLElement>('[data-slice]')) {
      expect(tile.style.background).toBe(original.get(tile.dataset.slice)!.background)
      expect(tile.style.opacity).toBe(original.get(tile.dataset.slice)!.opacity)
    }
    act(() => button.click())
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(cursor.getAttribute('data-active')).toBe('false')
    expect(center.dataset.centerAsset).toBe('')
    expect(center.textContent).toBe(money(longTotal))
    act(() => button.click())
    act(() => button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(qqqOffset).not.toBe('0')
  })

  it('选中资产后点击选择控件之外的区域会取消选择', () => {
    render()
    const qqq = host.querySelector<HTMLElement>('[data-slice="QQQ"]')!
    act(() => qqq.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(qqq.getAttribute('aria-pressed')).toBe('true')
    act(() => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
    expect(qqq.getAttribute('aria-pressed')).toBe('false')
    expect(host.querySelector('[data-selection-cursor]')!.getAttribute('data-active')).toBe('false')
  })

  it('临界跌幅直接说明阈值含义和安全方向', () => {
    render()
    expect(host.textContent).toContain('保证金率升至 100% 时开始强平')
    expect(host.textContent).toContain('数值越高，缓冲越大')
  })

  it('只有空头时明确显示没有多头，空头明细仍可选择', () => {
    const short = {
      ...snapshot.futures!.positions[0],
      symbol: 'MSTRUSDT', position_amt: -9, notional_usd: 3079.44,
    }
    render({
      ...snapshot, spot: [], stocks: { ...snapshot.stocks, equity_holdings: [], tokenized_assets: [] },
      earn: [], margin: null,
      futures: { ...snapshot.futures!, assets: [], positions: [short] },
    })
    expect(host.textContent).toContain('暂无多头敞口')
    const button = [...host.querySelectorAll('button')].find((node) => node.textContent?.includes('MSTR'))!
    act(() => button.click())
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(host.textContent).toContain('−$3,079.44')
    expect(host.textContent).toContain('4.1%')
  })

  it('二十个资产不截断，没有图标时逐项保留标签标记', () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      asset: `ASSET${index}`, spot_usd: index + 1, perp_usd: 0,
      net_usd: index + 1, gross_usd: index + 1, share: (index + 1) / 210,
    }))
    act(() => root.render(createElement(ExposureDistribution, { rows })))
    expect(host.querySelectorAll('[data-slice]')).toHaveLength(20)
    expect(host.querySelectorAll('.allocation-row')).toHaveLength(20)
    const fallbacks = [...host.querySelectorAll<HTMLElement>('[data-fallback-mark]')]
    expect(fallbacks).toHaveLength(20)
    expect(fallbacks.map((el) => el.dataset.fallbackMark))
      .toEqual(rows.map((row) => row.asset).reverse())
  })

  it('同资产多空对锁后仍保留多头构成，净敞口保持为零', () => {
    const rows = [{ asset: 'BTC', spot_usd: 100, perp_usd: -100, net_usd: 0, gross_usd: 400, share: 0 }]
    act(() => root.render(createElement(ExposureDistribution, { rows })))
    expect(host.querySelector('[data-slice="BTC"]')!.getAttribute('aria-label')).toContain('$200.00')
    expect(host.querySelector('.allocation-row')!.textContent).toContain('净 $0.00')
  })

  it('极小资产可以选中，刷新移除后播报恢复合计', () => {
    const large = { asset: 'QQQ', spot_usd: 100, perp_usd: 0, net_usd: 100, gross_usd: 100, share: 1 }
    const tiny = { asset: 'LUNC', spot_usd: 0.001, perp_usd: 0, net_usd: 0.001, gross_usd: 0.001, share: 0.00001 }
    act(() => root.render(createElement(ExposureDistribution, { rows: [large, tiny] })))
    const tinyTile = host.querySelector<HTMLElement>('[data-slice="LUNC"]')!
    expect(Number(tinyTile.dataset.end) - Number(tinyTile.dataset.start)).toBeGreaterThan(0)
    const button = [...host.querySelectorAll('button')].find((node) => node.textContent?.includes('LUNC'))!
    act(() => button.click())
    expect(host.querySelector('[aria-live="polite"]')!.textContent).toContain('<0.01%')
    act(() => root.render(createElement(ExposureDistribution, { rows: [large] })))
    expect(host.querySelector('[aria-live="polite"]')!.textContent).toContain('多头合计')
    expect(host.querySelector('[aria-pressed="true"][data-slice]')).toBeNull()
  })

  it('键盘可以逐区域移动并选择，单资产占满整张持仓轮', () => {
    render()
    const sectors = [...host.querySelectorAll<HTMLButtonElement>('[data-slice]')]
    act(() => sectors[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(document.activeElement).toBe(sectors[1])
    act(() => sectors[1].dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(sectors[1].getAttribute('aria-pressed')).toBe('true')
    const rows = [{ asset: 'BTC', spot_usd: 100, perp_usd: 0, net_usd: 100, gross_usd: 100, share: 1 }]
    act(() => root.render(createElement(ExposureDistribution, { rows })))
    const tile = host.querySelector<HTMLElement>('[data-slice]')!
    expect(Number(tile.dataset.end) - Number(tile.dataset.start)).toBeCloseTo(Math.PI * 2, 10)
    expect(tile.getAttribute('aria-label')).toContain('100.00%')
    act(() => tile.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(host.querySelector('[data-selection-cursor]')!.getAttribute('data-active')).toBe('true')
  })

  it.each([false, true])('选择图上小额资产只滚动明细容器，减少动态效果=%s', (reduced) => {
    render()
    vi.stubGlobal('matchMedia', () => ({ matches: reduced }))
    const list = host.querySelector<HTMLDivElement>('.allocation-scroll')!
    const row = host.querySelector<HTMLButtonElement>('[data-asset="SOXL"]')!
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 340, 300))
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 850, 340, 72))
    const scroll = vi.fn()
    list.scrollTo = scroll
    act(() => host.querySelector('[data-slice="SOXL"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(scroll).toHaveBeenNthCalledWith(1, { top: 0, behavior: 'instant' })
    expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: reduced ? 'instant' : 'smooth' }))
    expect(scroll.mock.calls.at(-1)![0].top).toBeGreaterThan(0)
    expect(host.querySelector('[data-slice="SOXL"]')!.getAttribute('aria-pressed')).toBe('true')
  })

  it('改选可见资产也会取消前一次尚未完成的平滑滚动', () => {
    render()
    const list = host.querySelector<HTMLDivElement>('.allocation-scroll')!
    const scroll = vi.fn()
    list.scrollTo = scroll
    list.scrollTop = 40
    act(() => host.querySelector('[data-slice="NVDA"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ top: 40, behavior: 'instant' })
  })

  it('快速改选只切换边界状态，不改变任何区域的颜色和几何', () => {
    render()
    const before = new Map([...host.querySelectorAll<SVGPathElement>('[data-slice]')].map((sector) => [
      sector.dataset.slice,
      [sector.getAttribute('d'), sector.getAttribute('fill')],
    ]))
    const marks = [...host.querySelectorAll<HTMLElement>('[data-chart-label] [data-asset-mark]')]
      .map((mark) => [mark.dataset.assetMark, mark.tagName, mark.getAttribute('src'), mark.textContent])
    for (const asset of ['NVDA', 'BNB']) {
      act(() => host.querySelector(`[data-slice="${asset}"]`)!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    }
    expect(host.querySelector('[data-slice="NVDA"]')!.getAttribute('data-selected')).toBe('false')
    expect(host.querySelector('[data-slice="BNB"]')!.getAttribute('data-selected')).toBe('true')
    for (const sector of host.querySelectorAll<SVGPathElement>('[data-slice]')) {
      expect([sector.getAttribute('d'), sector.getAttribute('fill')])
        .toEqual(before.get(sector.dataset.slice))
    }
    expect([...host.querySelectorAll<HTMLElement>('[data-chart-label] [data-asset-mark]')]
      .map((mark) => [mark.dataset.assetMark, mark.tagName, mark.getAttribute('src'), mark.textContent]))
      .toEqual(marks)
  })
})
