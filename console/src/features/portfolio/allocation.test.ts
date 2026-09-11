import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSnapshot } from '../../api/fixtures'
import { exposures } from '../../lib/holdings'
import { RiskControlView } from './RiskControl'
import { ExposureDistribution } from './ExposureDistribution'

let host: HTMLDivElement
let root: Root
const snapshot = buildSnapshot(new Date())

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(340)
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
  it('所有有多头金额的资产都保留独立扇区，包括不足 1% 的小额资产', () => {
    render()
    const expected = exposures(snapshot, snapshot.totals!.equity_usd)
      .filter((row) => row.gross_usd + row.net_usd > 0)
      .map((row) => row.asset).sort()
    const sectors = [...host.querySelectorAll('svg [data-slice]')]
    expect(sectors.map((node) => node.getAttribute('data-slice')).sort()).toEqual(expected)
    expect(host.textContent).not.toContain('其他')
  })

  it('340px 的图面同时标注主要资产代码和占比', () => {
    render()
    const labels = host.querySelector('svg')!.textContent
    expect(labels).toContain('QQQ')
    expect(labels).toContain('%')
  })

  it('选择资产不压暗任何扇区，重复点击与 Escape 都能取消选择', () => {
    render()
    const button = [...host.querySelectorAll('button')]
      .find((node) => node.textContent?.includes('QQQ'))!
    act(() => button.click())
    expect(button.getAttribute('aria-pressed')).toBe('true')
    for (const path of host.querySelectorAll('svg path[fill]')) {
      expect(Number(path.getAttribute('opacity') ?? 1)).toBe(1)
    }
    act(() => button.click())
    expect(button.getAttribute('aria-pressed')).toBe('false')
    act(() => button.click())
    act(() => button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(button.getAttribute('aria-pressed')).toBe('false')
  })

  it('只有空头时明确显示没有多头，空头明细仍可选择', () => {
    render({
      ...snapshot, spot: [], earn: [], margin: null,
      futures: { ...snapshot.futures!, assets: [], positions: snapshot.futures!.positions.filter((p) => p.position_amt < 0) },
    })
    expect(host.textContent).toContain('暂无多头敞口')
    const button = [...host.querySelectorAll('button')].find((node) => node.textContent?.includes('MSTR'))!
    act(() => button.click())
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(host.textContent).toContain('−$3,079.44')
  })

  it('二十个资产不截断，重新排序后资产颜色不变', () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      asset: `ASSET${index}`, spot_usd: index + 1, perp_usd: 0,
      net_usd: index + 1, gross_usd: index + 1, share: (index + 1) / 210,
    }))
    act(() => root.render(createElement(ExposureDistribution, { rows })))
    expect(host.querySelectorAll('[data-slice]')).toHaveLength(20)
    expect(host.querySelectorAll('.allocation-row')).toHaveLength(20)
    const colors = new Map([...host.querySelectorAll('[data-slice]')].map((el) => [el.getAttribute('data-slice'), el.getAttribute('fill')]))
    act(() => root.render(createElement(ExposureDistribution, { rows: rows.map((row) => ({
      ...row, net_usd: 22 - row.net_usd, gross_usd: 22 - row.gross_usd,
    })) })))
    for (const el of host.querySelectorAll('[data-slice]')) {
      expect(el.getAttribute('fill')).toBe(colors.get(el.getAttribute('data-slice')))
    }
  })

  it('同资产多空对锁后仍保留多头构成，净敞口保持为零', () => {
    const rows = [{ asset: 'BTC', spot_usd: 100, perp_usd: -100, net_usd: 0, gross_usd: 400, share: 0 }]
    act(() => root.render(createElement(ExposureDistribution, { rows })))
    expect(host.querySelector('[data-slice="BTC"]')!.getAttribute('aria-label')).toContain('$200.00')
    expect(host.querySelector('.allocation-row')!.textContent).toContain('净 $0.00')
  })

  it('极小资产可以选中，刷新移除后圈心恢复合计', () => {
    render()
    const button = [...host.querySelectorAll('button')].find((node) => node.textContent?.includes('LUNC'))!
    act(() => button.click())
    expect(host.querySelector('[aria-live="polite"]')!.textContent).toContain('<0.01%')
    render({ ...snapshot, spot: snapshot.spot.filter((row) => row.asset !== 'LUNC') })
    expect(host.querySelector('[aria-live="polite"]')!.textContent).toContain('多头合计')
    expect(host.querySelector('[aria-pressed="true"][data-slice]')).toBeNull()
  })

  it('键盘可以逐扇区移动并选择，单资产仍显示完整圆环', () => {
    render()
    const sectors = [...host.querySelectorAll<SVGElement>('[data-slice]')]
    act(() => sectors[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(document.activeElement).toBe(sectors[1])
    act(() => sectors[1].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })))
    expect(sectors[1].getAttribute('aria-pressed')).toBe('true')
    const rows = [{ asset: 'BTC', spot_usd: 100, perp_usd: 0, net_usd: 100, gross_usd: 100, share: 1 }]
    act(() => root.render(createElement(ExposureDistribution, { rows })))
    const circle = host.querySelector('[data-slice]')!
    expect(circle.getAttribute('d')!.match(/A/g)).toHaveLength(4)
    expect(circle.getAttribute('aria-label')).toContain('100.00%')
  })

  it.each([false, true])('选择图上小额资产只滚动明细容器，减少动态效果=%s', (reduced) => {
    render()
    vi.stubGlobal('matchMedia', () => ({ matches: reduced }))
    const list = host.querySelector<HTMLDivElement>('.allocation-scroll')!
    const row = host.querySelector<HTMLButtonElement>('[data-asset="LUNC"]')!
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 340, 300))
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 850, 340, 72))
    const scroll = vi.fn()
    list.scrollTo = scroll
    act(() => host.querySelector('[data-slice="LUNC"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(scroll).toHaveBeenNthCalledWith(1, { top: 0, behavior: 'instant' })
    expect(scroll).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: reduced ? 'instant' : 'smooth' }))
    expect(scroll.mock.calls.at(-1)![0].top).toBeGreaterThan(0)
    expect(host.querySelector('[data-slice="LUNC"]')!.getAttribute('aria-pressed')).toBe('true')
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

  it('动画中途改选从当前视觉角度接续，始终选择不超过半圈的路径', () => {
    render()
    const indicator = host.querySelector<SVGCircleElement>('.donut-indicator')!
    const cancel = vi.fn()
    const animate = vi.fn((frames: Keyframe[], options: KeyframeAnimationOptions) => {
      void frames
      void options
      return { cancel }
    })
    indicator.animate = animate as unknown as typeof indicator.animate
    const computed = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((node) => node === indicator
      ? { transform: 'matrix(0.137, 0.9906, -0.9906, 0.137, 0, 0)', strokeDasharray: '0.2, 1' } as CSSStyleDeclaration
      : computed(node))
    for (const asset of ['NVDA', 'BNB']) {
      act(() => host.querySelector(`[data-slice="${asset}"]`)!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    }
    const frames = animate.mock.calls.at(-1)![0] as Keyframe[]
    const start = Number(String(frames[0].transform).match(/rotate\((.*)rad\)/)![1])
    const end = Number(String(frames[1].transform).match(/rotate\((.*)rad\)/)![1])
    expect(start * 180 / Math.PI).toBeCloseTo(82.13, 1)
    expect(Math.abs(end - start)).toBeLessThanOrEqual(Math.PI)
    expect(cancel).toHaveBeenCalled()
  })

  it('动画中途取消选择时冻结当前指示弧再淡出', () => {
    render()
    const indicator = host.querySelector<SVGCircleElement>('.donut-indicator')!
    const cancel = vi.fn()
    indicator.animate = vi.fn(() => ({ cancel })) as unknown as typeof indicator.animate
    const computed = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((node) => node === indicator
      ? { transform: 'matrix(0.5, 0.866, -0.866, 0.5, 0, 0)', strokeDasharray: '0.12, 1' } as CSSStyleDeclaration
      : computed(node))
    const sector = host.querySelector('[data-slice="NVDA"]')!
    act(() => sector.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    act(() => sector.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(cancel).toHaveBeenCalled()
    expect(indicator.style.transform).toBe('matrix(0.5, 0.866, -0.866, 0.5, 0, 0)')
    expect(indicator.style.strokeDasharray).toBe('0.12, 1')
    expect(indicator.style.opacity).toBe('0')
  })
})
