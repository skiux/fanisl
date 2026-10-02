import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSnapshot } from '../../api/fixtures'
import { money } from '../../lib/format'
import { StatementPage } from './StatementPage'

let host: HTMLDivElement
let root: Root
let calls: string[]

/** 按顺序回应 /portfolio：每个元素是一次响应——快照，或一个 HTTP 状态码 */
function serve(responses: (ReturnType<typeof buildSnapshot> | number)[]) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (!url.includes('/portfolio')) return new Response('{}', { status: 404 })
    calls.push(url.slice(url.indexOf('/portfolio')))
    const next = responses.shift()
    if (typeof next === 'number' || next === undefined) {
      return new Response(JSON.stringify({ detail: '上游暂时不可用' }), {
        status: typeof next === 'number' ? next : 503,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify(next), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }))
}

/** 让挂起的 fetch 与 setState 都落地 */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve()
  })
}

async function advance(ms: number) {
  await act(async () => { vi.advanceTimersByTime(ms) })
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  window.localStorage.clear()               // 不带示例场景 = 真接口
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const equityOf = (snapshot: ReturnType<typeof buildSnapshot>) => money(snapshot.totals!.equity_usd)

describe('资产页自动刷新', () => {
  it('前台放着一分钟就静默重取一次，而且不强制穿透缓存', async () => {
    const first = buildSnapshot(new Date())
    const second = { ...buildSnapshot(new Date()), totals: { ...first.totals!, equity_usd: 81_234.56 } }
    serve([first, second])

    act(() => root.render(createElement(StatementPage)))
    await settle()
    expect(host.textContent).toContain(equityOf(first))

    await advance(60_000)
    expect(calls).toEqual(['/portfolio?force=false', '/portfolio?force=false'])
    // 新数据直接换上，中间不闪骨架
    expect(host.textContent).toContain(money(81_234.56))
  })

  it('后台刷新失败时旧数据留在原处，不换成错误页', async () => {
    const first = buildSnapshot(new Date())
    serve([first, 503])

    act(() => root.render(createElement(StatementPage)))
    await settle()
    await advance(60_000)

    expect(calls).toHaveLength(2)
    expect(host.textContent).toContain(equityOf(first))
    expect(host.textContent).not.toContain('无法读取账户数据')
  })

  it('首次加载失败之后，后端恢复了页面会自己回来', async () => {
    const later = buildSnapshot(new Date())
    serve([503, later])

    act(() => root.render(createElement(StatementPage)))
    await settle()
    expect(host.textContent).toContain('无法读取账户数据')

    await advance(60_000)
    expect(host.textContent).toContain(equityOf(later))
  })
})
