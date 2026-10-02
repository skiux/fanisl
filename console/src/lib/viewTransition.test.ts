import { afterEach, describe, expect, it, vi } from 'vitest'
import { withViewTransition } from './viewTransition'

function stubMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduce })))
}

afterEach(() => {
  vi.unstubAllGlobals()
  // jsdom 没有这个 API；用例里装上的要摘掉
  delete (document as Partial<Document>).startViewTransition
})

describe('换页的交叉淡变', () => {
  it('浏览器不支持时直接更新，不报错', () => {
    stubMotion(false)
    const update = vi.fn()
    withViewTransition(update)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('支持时交给浏览器的视图过渡', () => {
    stubMotion(false)
    const start = vi.fn((callback: () => void) => { callback(); return { ready: Promise.resolve() } })
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start })
    const update = vi.fn()
    withViewTransition(update)
    expect(start).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('页面在后台时不播：浏览器反正会放弃，还会在控制台留一条报错', () => {
    stubMotion(false)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const start = vi.fn()
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start })
    const update = vi.fn()
    withViewTransition(update)
    expect(start).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })

  it('系统开了"减少动态效果"就不播，直接更新', () => {
    stubMotion(true)
    const start = vi.fn()
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start })
    const update = vi.fn()
    withViewTransition(update)
    expect(start).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(1)
  })
})
