import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortfolioError } from '../api/types'
import { clearPageData, usePageData } from './pageData'

type Seen = ReturnType<typeof usePageData<string>>
let host: HTMLDivElement
let root: Root
let seen: Seen[]

/** 每次渲染记下 hook 的输出，断言看最后一次 */
function Probe({ scope, query, load }: {
  scope: string
  query: string
  load: (signal: AbortSignal, force: boolean) => Promise<string>
}) {
  seen.push(usePageData({ scope, query, load, failure: '未预期', refreshEveryMs: 60_000, autoRefresh: false }))
  return null
}

const last = () => seen[seen.length - 1]
const shown = () => (last().phase.kind === 'ready' ? (last().phase as { snapshot: string }).snapshot : last().phase.kind)

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve()
  })
}

/** 一个手动放行的请求：测"新数据还没到"的那段时间 */
function deferred() {
  let resolve!: (value: string) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<string>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

function render(props: Parameters<typeof Probe>[0]) {
  act(() => root.render(createElement(Probe, props)))
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  clearPageData()
  seen = []
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('页面数据缓存', () => {
  it('第一次进来显示骨架，数据到了才出现，并标记为"从骨架后面出来的"', async () => {
    render({ scope: 'assets|live', query: '', load: async () => 'v1' })
    expect(seen[0].phase.kind).toBe('loading')
    await settle()
    expect(shown()).toBe('v1')
    expect(last().revealed).toBe(true)
  })

  it('页面卸载再回来：先显示上一次的数据，不出骨架，再在后台静默更新', async () => {
    render({ scope: 'assets|live', query: '', load: async () => 'v1' })
    await settle()
    act(() => root.unmount())

    root = createRoot(host)
    seen = []
    const next = deferred()
    const load = vi.fn<(signal: AbortSignal, force: boolean) => Promise<string>>(() => next.promise)
    render({ scope: 'assets|live', query: '', load })
    // 第一帧就是上一次的数据
    expect(seen[0].phase).toEqual({ kind: 'ready', snapshot: 'v1' })
    expect(seen.some((s) => s.phase.kind === 'loading')).toBe(false)
    expect(last().revealed).toBe(false)
    // 后台那次不强制
    expect(load).toHaveBeenCalledWith(expect.anything(), false)
    next.resolve('v2')
    await settle()
    expect(shown()).toBe('v2')
  })

  it('同一页换条件：旧画面留着并标记在切换，新数据到了再换', async () => {
    render({ scope: 'orders|live', query: '', load: async () => '全部' })
    await settle()

    const next = deferred()
    render({ scope: 'orders|live', query: 'BTCUSDT', load: () => next.promise })
    expect(shown()).toBe('全部')
    expect(last().switching).toBe(true)
    next.resolve('BTCUSDT')
    await settle()
    expect(shown()).toBe('BTCUSDT')
    expect(last().switching).toBe(false)
  })

  it('换条件失败要报出来，不能拿旧条件的数据冒充新条件', async () => {
    render({ scope: 'orders|live', query: '', load: async () => '全部' })
    await settle()
    render({
      scope: 'orders|live', query: 'BTCUSDT',
      load: async () => { throw new PortfolioError('server', '上游异常') },
    })
    await settle()
    expect(last().phase).toEqual({ kind: 'failed', message: '上游异常' })
  })

  it('换回看过的条件直接用缓存，不再压暗等待', async () => {
    render({ scope: 'ledger|live', query: '7', load: async () => '七天' })
    await settle()
    render({ scope: 'ledger|live', query: '30', load: async () => '三十天' })
    await settle()
    const slow = deferred()
    render({ scope: 'ledger|live', query: '7', load: () => slow.promise })
    expect(shown()).toBe('七天')
    expect(last().switching).toBe(false)
  })

  it('换了场景是另一份东西：没有缓存就回到骨架', async () => {
    render({ scope: 'assets|live', query: '', load: async () => 'live' })
    await settle()
    render({ scope: 'assets|ok', query: '', load: () => new Promise(() => {}) })
    expect(last().phase.kind).toBe('loading')
  })

  it('后台刷新失败：数据留着，原因记下来给过期横幅用', async () => {
    let fail = false
    const load = async () => {
      if (fail) throw new PortfolioError('network', '连不上 fanisl 后端')
      return 'v1'
    }
    render({ scope: 'assets|live', query: '', load })
    await settle()
    fail = true
    act(() => root.unmount())
    root = createRoot(host)
    render({ scope: 'assets|live', query: '', load })   // 缓存命中 → 静默复核
    await settle()
    expect(shown()).toBe('v1')
    expect(last().refreshError).toBe('连不上 fanisl 后端')
  })

  it('页面自己取到的一份更新：稍早发出的后台请求回来也不会把它盖掉', async () => {
    render({ scope: 'assets|live', query: '', load: async () => 'v1' })
    await settle()
    act(() => root.unmount())
    root = createRoot(host)
    const slow = deferred()
    render({ scope: 'assets|live', query: '', load: () => slow.promise })
    act(() => last().accept('saved'))
    slow.resolve('older')
    await settle()
    expect(shown()).toBe('saved')
  })
})
