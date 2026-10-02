import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoRefresh } from './autoRefresh'

let host: HTMLDivElement
let root: Root
let visibility: DocumentVisibilityState = 'visible'

function setVisibility(next: DocumentVisibilityState) {
  visibility = next
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}

function Probe({ onTick, everyMs, enabled }: { onTick: () => void; everyMs: number; enabled: boolean }) {
  useAutoRefresh(onTick, everyMs, enabled)
  return null
}

function mount(onTick: () => void, enabled = true) {
  act(() => root.render(createElement(Probe, { onTick, everyMs: 60_000, enabled })))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('前台自动刷新', () => {
  it('页面在前台时按周期取，不靠人点', () => {
    const tick = vi.fn()
    mount(tick)
    act(() => { vi.advanceTimersByTime(59_000) })
    expect(tick).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(tick).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(120_000) })
    expect(tick).toHaveBeenCalledTimes(3)
  })

  it('标签页在后台时完全停掉', () => {
    const tick = vi.fn()
    mount(tick)
    setVisibility('hidden')
    act(() => { vi.advanceTimersByTime(30 * 60_000) })
    expect(tick).not.toHaveBeenCalled()
  })

  it('切回前台时数据已过一个周期就立刻补一次，之后不紧跟着再来一次', () => {
    const tick = vi.fn()
    mount(tick)
    setVisibility('hidden')
    act(() => { vi.advanceTimersByTime(10 * 60_000) })
    setVisibility('visible')
    expect(tick).toHaveBeenCalledTimes(1)
    // 下一次从补的那一刻起算，而不是按原来的节拍马上又来一次
    act(() => { vi.advanceTimersByTime(59_000) })
    expect(tick).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(tick).toHaveBeenCalledTimes(2)
  })

  it('离开不到一个周期就回来，不额外补', () => {
    const tick = vi.fn()
    mount(tick)
    setVisibility('hidden')
    act(() => { vi.advanceTimersByTime(20_000) })
    setVisibility('visible')
    expect(tick).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(40_000) })
    expect(tick).toHaveBeenCalledTimes(1)
  })

  it('窗口重新获得焦点、网络恢复时同样会补', () => {
    const tick = vi.fn()
    mount(tick)
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(tick).toHaveBeenCalledTimes(1)
    // 计时器被浏览器节流、没按时触发的情形：焦点回来时自己补上
    vi.setSystemTime(Date.now() + 5 * 60_000)
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(tick).toHaveBeenCalledTimes(2)
    vi.setSystemTime(Date.now() + 5 * 60_000)
    act(() => { window.dispatchEvent(new Event('online')) })
    expect(tick).toHaveBeenCalledTimes(3)
  })

  it('关掉时一次都不取（示例数据场景不需要轮询）', () => {
    const tick = vi.fn()
    mount(tick, false)
    act(() => { vi.advanceTimersByTime(30 * 60_000) })
    window.dispatchEvent(new Event('focus'))
    expect(tick).not.toHaveBeenCalled()
  })
})
