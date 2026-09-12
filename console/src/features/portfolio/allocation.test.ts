import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSnapshot } from '../../api/fixtures'
import { exposures } from '../../lib/holdings'
import { RiskControlView } from './RiskControl'
import { ExposureDistribution } from './ExposureDistribution'

let host: HTMLDivElement
let root: Root
let width: ReturnType<typeof vi.spyOn>
const snapshot = buildSnapshot(new Date())

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
  it('开发数据有十二个真实量级的标的，前三项合计约占多头的一半', () => {
    const rows = exposures(snapshot, snapshot.totals!.equity_usd)
      .map((row) => Math.max(0, (row.gross_usd + row.net_usd) / 2))
      .filter((value) => value > 0)
      .sort((a, b) => b - a)
    const total = rows.reduce((sum, value) => sum + value, 0)
    expect(rows).toHaveLength(12)
    expect(rows.slice(0, 3).reduce((sum, value) => sum + value, 0) / total).toBeCloseTo(0.5, 2)
    render()
    expect(host.querySelector('[data-allocation-total]')!.textContent).toBe('$59,995.85')
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

  it('340px 的十二个区域都同时显示 logo、代码、金额和占比', () => {
    render()
    const labels = [...host.querySelectorAll<HTMLElement>('[data-chart-label]')]
    expect(labels).toHaveLength(12)
    for (const label of labels) {
      expect(label.querySelector('img, [data-fallback-mark]')).not.toBeNull()
      expect(label.textContent).toMatch(/\$/)
      expect(label.textContent).toMatch(/%/)
    }
  })

  it.each([254, 340])('%ipx 下仓位极度集中时所有区域仍在图内且互不覆盖', (chartWidth) => {
    width.mockReturnValue(chartWidth)
    const values = [9850, 100, 25, 12, 6, 4, 2, 0.9, 0.1]
    act(() => root.render(createElement(ExposureDistribution, { rows: values.map((value, index) => ({
      asset: `ASSET${index}`, spot_usd: value, perp_usd: 0,
      net_usd: value, gross_usd: value, share: value / 10_000,
    })) })))
    const map = host.querySelector<HTMLElement>('.allocation-map')!
    const mapWidth = Number.parseFloat(map.style.width)
    const mapHeight = Number.parseFloat(map.style.height)
    const tiles = [...host.querySelectorAll<HTMLElement>('[data-slice]')].map((node) => ({
      x: Number(node.dataset.tileX), y: Number(node.dataset.tileY),
      width: Number(node.dataset.tileWidth), height: Number(node.dataset.tileHeight),
    }))
    expect(tiles).toHaveLength(values.length)
    expect(host.querySelectorAll('[data-chart-label]')).toHaveLength(values.length)
    for (let first = 0; first < tiles.length; first += 1) {
      const tile = tiles[first]
      expect(tile.x).toBeGreaterThanOrEqual(0)
      expect(tile.y).toBeGreaterThanOrEqual(0)
      expect(tile.x + tile.width).toBeLessThanOrEqual(mapWidth + 1e-8)
      expect(tile.y + tile.height).toBeLessThanOrEqual(mapHeight + 1e-8)
      for (let second = first + 1; second < tiles.length; second += 1) {
        const other = tiles[second]
        expect(tile.x + tile.width <= other.x + 1e-8
          || other.x + other.width <= tile.x + 1e-8
          || tile.y + tile.height <= other.y + 1e-8
          || other.y + other.height <= tile.y + 1e-8).toBe(true)
      }
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

  it('宽屏面积图为十二个区域逐一显示 logo、代码、金额和占比', () => {
    width.mockReturnValue(640)
    render()
    const labels = [...host.querySelectorAll<HTMLElement>('[data-chart-label]')]
    expect(labels).toHaveLength(12)
    for (const label of labels) {
      expect(label.querySelector('img, [data-fallback-mark]')).not.toBeNull()
      expect(label.textContent).toMatch(/\$/)
      expect(label.textContent).toMatch(/%/)
      expect(label.closest<HTMLElement>('[data-slice]')?.dataset.tileWidth).toBeDefined()
      expect(label.closest<HTMLElement>('[data-slice]')?.dataset.tileHeight).toBeDefined()
    }
  })

  it('区域内整组信息的面积与仓位面积保持同一比例', () => {
    width.mockReturnValue(640)
    render()
    const fontSizes = new Map([...host.querySelectorAll<HTMLElement>('[data-chart-label]')]
      .map((label) => [label.dataset.chartLabel!, Number(label.dataset.labelFontSize)]))
    const ratio = fontSizes.get('BTC')! / fontSizes.get('MU')!
    expect(ratio).toBeCloseTo(Math.sqrt(11_000 / 1_999.96), 1)
    expect(ratio).toBeGreaterThan(2)
  })

  it('图形高度随容器与标的数量增长，不把十二项固定压进小区域', () => {
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
    expect(twelveItemHeight).toBeLessThanOrEqual(640)
  })

  it('选择资产不压暗任何区域，重复点击与 Escape 都能取消选择', () => {
    render()
    const original = new Map([...host.querySelectorAll<HTMLElement>('[data-slice]')]
      .map((tile) => [tile.dataset.slice, { background: tile.style.background, opacity: tile.style.opacity }]))
    const button = [...host.querySelectorAll('button')]
      .find((node) => node.textContent?.includes('QQQ'))!
    act(() => button.click())
    expect(button.getAttribute('aria-pressed')).toBe('true')
    for (const tile of host.querySelectorAll<HTMLElement>('[data-slice]')) {
      expect(tile.style.background).toBe(original.get(tile.dataset.slice)!.background)
      expect(tile.style.opacity).toBe(original.get(tile.dataset.slice)!.opacity)
    }
    act(() => button.click())
    expect(button.getAttribute('aria-pressed')).toBe('false')
    act(() => button.click())
    act(() => button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(button.getAttribute('aria-pressed')).toBe('false')
  })

  it('只有空头时明确显示没有多头，空头明细仍可选择', () => {
    const short = {
      ...snapshot.futures!.positions[0],
      symbol: 'MSTRUSDT', position_amt: -9, notional_usd: 3079.44,
    }
    render({
      ...snapshot, spot: [], earn: [], margin: null,
      futures: { ...snapshot.futures!, assets: [], positions: [short] },
    })
    expect(host.textContent).toContain('暂无多头敞口')
    const button = [...host.querySelectorAll('button')].find((node) => node.textContent?.includes('MSTR'))!
    act(() => button.click())
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(host.textContent).toContain('−$3,079.44')
    expect(host.textContent).toContain('4.1%')
  })

  it('二十个资产不截断，重新排序后资产颜色不变', () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      asset: `ASSET${index}`, spot_usd: index + 1, perp_usd: 0,
      net_usd: index + 1, gross_usd: index + 1, share: (index + 1) / 210,
    }))
    act(() => root.render(createElement(ExposureDistribution, { rows })))
    expect(host.querySelectorAll('[data-slice]')).toHaveLength(20)
    expect(host.querySelectorAll('.allocation-row')).toHaveLength(20)
    const colors = new Map([...host.querySelectorAll<HTMLElement>('[data-slice]')]
      .map((el) => [el.dataset.slice, el.style.background]))
    act(() => root.render(createElement(ExposureDistribution, { rows: rows.map((row) => ({
      ...row, net_usd: 22 - row.net_usd, gross_usd: 22 - row.gross_usd,
    })) })))
    for (const el of host.querySelectorAll<HTMLElement>('[data-slice]')) {
      expect(el.style.background).toBe(colors.get(el.dataset.slice))
    }
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
    const map = host.querySelector<HTMLElement>('.allocation-map')!
    expect(Number.parseFloat(tinyTile.style.top) + Number.parseFloat(tinyTile.style.height))
      .toBeLessThanOrEqual(Number.parseFloat(map.style.height) + 1e-8)
    expect(Number.parseFloat(tinyTile.style.left) + Number.parseFloat(tinyTile.style.width))
      .toBeLessThanOrEqual(Number.parseFloat(map.style.width) + 1e-8)
    expect(Number.parseFloat(tinyTile.style.padding) * 2).toBeLessThanOrEqual(Number.parseFloat(tinyTile.style.height))
    const button = [...host.querySelectorAll('button')].find((node) => node.textContent?.includes('LUNC'))!
    act(() => button.click())
    expect(host.querySelector('[aria-live="polite"]')!.textContent).toContain('<0.01%')
    act(() => root.render(createElement(ExposureDistribution, { rows: [large] })))
    expect(host.querySelector('[aria-live="polite"]')!.textContent).toContain('多头合计')
    expect(host.querySelector('[aria-pressed="true"][data-slice]')).toBeNull()
  })

  it('键盘可以逐区域移动并选择，单资产占满整张面积图', () => {
    render()
    const sectors = [...host.querySelectorAll<HTMLButtonElement>('[data-slice]')]
    act(() => sectors[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(document.activeElement).toBe(sectors[1])
    act(() => sectors[1].click())
    expect(sectors[1].getAttribute('aria-pressed')).toBe('true')
    const rows = [{ asset: 'BTC', spot_usd: 100, perp_usd: 0, net_usd: 100, gross_usd: 100, share: 1 }]
    act(() => root.render(createElement(ExposureDistribution, { rows })))
    const tile = host.querySelector<HTMLElement>('[data-slice]')!
    const map = host.querySelector<HTMLElement>('.allocation-map')!
    expect(Number(tile.dataset.tileWidth)).toBe(Number.parseFloat(map.style.width))
    expect(Number(tile.dataset.tileHeight)).toBe(Number.parseFloat(map.style.height))
    expect(tile.getAttribute('aria-label')).toContain('100.00%')
  })

  it.each([false, true])('选择图上小额资产只滚动明细容器，减少动态效果=%s', (reduced) => {
    render()
    vi.stubGlobal('matchMedia', () => ({ matches: reduced }))
    const list = host.querySelector<HTMLDivElement>('.allocation-scroll')!
    const row = host.querySelector<HTMLButtonElement>('[data-asset="MU"]')!
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 340, 300))
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 850, 340, 72))
    const scroll = vi.fn()
    list.scrollTo = scroll
    act(() => host.querySelector('[data-slice="MU"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(scroll).toHaveBeenNthCalledWith(1, { top: 0, behavior: 'instant' })
    expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: reduced ? 'instant' : 'smooth' }))
    expect(scroll.mock.calls.at(-1)![0].top).toBeGreaterThan(0)
    expect(host.querySelector('[data-slice="MU"]')!.getAttribute('aria-pressed')).toBe('true')
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
    const before = new Map([...host.querySelectorAll<HTMLElement>('[data-slice]')].map((tile) => [
      tile.dataset.slice,
      [tile.style.left, tile.style.top, tile.style.width, tile.style.height, tile.style.background],
    ]))
    for (const asset of ['NVDA', 'BNB']) {
      act(() => host.querySelector(`[data-slice="${asset}"]`)!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    }
    expect(host.querySelector('[data-slice="NVDA"]')!.getAttribute('data-selected')).toBe('false')
    expect(host.querySelector('[data-slice="BNB"]')!.getAttribute('data-selected')).toBe('true')
    for (const tile of host.querySelectorAll<HTMLElement>('[data-slice]')) {
      expect([tile.style.left, tile.style.top, tile.style.width, tile.style.height, tile.style.background])
        .toEqual(before.get(tile.dataset.slice))
    }
  })
})
