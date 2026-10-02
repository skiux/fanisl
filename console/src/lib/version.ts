import { useEffect, useRef } from 'react'

/**
 * 服务器上换了新版本，开着的标签页自己换上。
 *
 * 单页应用打开之后就一直跑着当时那份代码：服务器每 5 分钟拉一次 `origin/main` 并重新
 * 构建，可一个开了两小时的标签页永远看不到。2026-10-02 自动刷新已经上线，用户那个
 * 部署前就开着的标签页照样停在两小时前——它跑的还是没有自动刷新的旧代码。
 *
 * 怎么判断：入口脚本的文件名带内容哈希（`/console/assets/index-XXXX.js`），
 * 拿当前页面加载的那个与服务器上 index.html 里写的那个比，不一样就是有新版本。
 *
 * 什么时候换：**页面回到前台时**——人刚回来，手上没有进行到一半的事；或者页面一直
 * 开在前台、但已经两分钟没有任何操作（挂在副屏上看盘的情形）。正在录入成本的时候
 * 不会被打断。开发环境没有带哈希的入口，整套不启用。
 */
const ENTRY = /\/assets\/index-[\w-]+\.js/
const CHECK_EVERY_MS = 5 * 60_000
const IDLE_MS = 2 * 60_000

export function loadedEntry(doc: Document = document): string | null {
  for (const script of Array.from(doc.querySelectorAll('script[src]'))) {
    const hit = script.getAttribute('src')?.match(ENTRY)
    if (hit) return hit[0]
  }
  return null
}

export async function deployedEntry(url: string): Promise<string | null> {
  const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' })
  if (!response.ok) return null
  return (await response.text()).match(ENTRY)?.[0] ?? null
}

export function useReloadOnNewBuild({
  indexUrl = import.meta.env.BASE_URL,
  reload = () => window.location.reload(),
}: { indexUrl?: string; reload?: () => void } = {}) {
  const reloadRef = useRef(reload)
  useEffect(() => {
    reloadRef.current = reload
  })

  useEffect(() => {
    const mine = loadedEntry()
    if (!mine) return
    let outdated = false
    let lastInput = Date.now()
    let checking = false

    const visible = () => document.visibilityState === 'visible'
    const check = async () => {
      if (checking || outdated) return
      checking = true
      try {
        const deployed = await deployedEntry(indexUrl)
        // 取不到 index.html（断网、部署进行到一半）就当没变，下次再看
        outdated = deployed !== null && deployed !== mine
      } catch {
        outdated = false
      } finally {
        checking = false
      }
    }
    const reloadIfOutdated = () => {
      if (outdated) reloadRef.current()
    }
    // 回到前台：先看一眼有没有新版本，有就换
    const onReturn = async () => {
      if (!visible()) return
      await check()
      reloadIfOutdated()
    }
    const onVisibility = () => { void onReturn() }
    const onInput = () => { lastInput = Date.now() }

    const timer = setInterval(() => {
      if (!visible()) return
      void check().then(() => {
        if (Date.now() - lastInput >= IDLE_MS) reloadIfOutdated()
      })
    }, CHECK_EVERY_MS)

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)
    for (const name of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) {
      window.addEventListener(name, onInput, { passive: true })
    }
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
      for (const name of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) {
        window.removeEventListener(name, onInput)
      }
    }
  }, [indexUrl])
}
