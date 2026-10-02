import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadedEntry, useReloadOnNewBuild } from './version'

let host: HTMLDivElement
let root: Root
let visibility: DocumentVisibilityState = 'visible'

function Probe({ reload }: { reload: () => void }) {
  useReloadOnNewBuild({ indexUrl: '/console/', reload })
  return null
}

/** 假装这一页是从某个构建加载的 */
function loadedFrom(entry: string | null) {
  document.head.querySelectorAll('script[data-test-entry]').forEach((node) => node.remove())
  if (!entry) return
  const script = document.createElement('script')
  script.setAttribute('src', `/console/assets/${entry}`)
  script.dataset.testEntry = '1'
  document.head.append(script)
}

function deployed(entry: string) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    `<html><script type="module" crossorigin src="/console/assets/${entry}"></script></html>`,
    { status: 200 })))
}

async function returnToPage() {
  visibility = 'visible'
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
    for (let i = 0; i < 5; i += 1) await Promise.resolve()
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  loadedFrom(null)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('新版本自动换上', () => {
  it('读得出当前页面加载的是哪一份构建', () => {
    loadedFrom('index-AbC123.js')
    expect(loadedEntry()).toBe('/assets/index-AbC123.js')
  })

  it('回到前台时发现服务器上换了新版本，就重新加载', async () => {
    loadedFrom('index-OLD111.js')
    deployed('index-NEW222.js')
    const reload = vi.fn()
    act(() => root.render(createElement(Probe, { reload })))
    await returnToPage()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('还是同一份构建就什么都不做', async () => {
    loadedFrom('index-SAME00.js')
    deployed('index-SAME00.js')
    const reload = vi.fn()
    act(() => root.render(createElement(Probe, { reload })))
    await returnToPage()
    expect(reload).not.toHaveBeenCalled()
  })

  it('开发环境没有带哈希的入口：整套不启用，连 index.html 都不去问', async () => {
    loadedFrom(null)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const reload = vi.fn()
    act(() => root.render(createElement(Probe, { reload })))
    await returnToPage()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('取不到 index.html 就当没变，不会因为断网把页面刷掉', async () => {
    loadedFrom('index-OLD111.js')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const reload = vi.fn()
    act(() => root.render(createElement(Probe, { reload })))
    await returnToPage()
    expect(reload).not.toHaveBeenCalled()
  })
})
