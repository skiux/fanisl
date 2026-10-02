import { useCallback, useEffect, useRef, useState } from 'react'
import { PortfolioError } from '../api/types'
import { useAutoRefresh } from './autoRefresh'

/**
 * 三个页面（资产、委托、流水）共用的取数：缓存、四种取法、后台刷新。
 *
 * **为什么要缓存。** 换页时整页重建，原先每次都从骨架屏开始：旧页消失、骨架闪
 * 0.6–1.3 秒、正文再上浮一次，刚看过的页面切回来也照样走一遍（2026-10-02 实测）。
 * 现在页面卸载了数据还留在模块里，切回来直接显示上一次的，再在后台静默更新——
 * 骨架屏只在第一次进入时出现。这就是 SWR 那类库说的"先缓存、后更新"。
 *
 * **四种取法**，由"谁发起的"决定：
 *
 *   initial  第一次进这一页、或换了示例场景，又没有缓存：显示骨架，失败报错
 *   switch   同一页换了筛选条件（交易对、区间）又没有缓存：旧画面留着并压暗，
 *            新数据到了再换；失败报错——不能拿旧条件的数据冒充新条件
 *   force    「重新取数」：强制穿透后端缓存
 *   silent   后台刷新与缓存命中后的复核：不打扰，失败只记下原因
 *
 * 查询由两段组成：`scope`（页 + 场景，换了它就是另一份东西）与 `query`
 * （筛选条件）。只换 `query` 才走 switch。
 */
export type Phase<T> =
  | { kind: 'loading' }
  | { kind: 'ready'; snapshot: T }
  | { kind: 'failed'; message: string }

type Mode = 'initial' | 'switch' | 'force' | 'silent'
type Request = { scope: string; query: string; mode: Mode }

// 模块级：页面卸载了它还在。键是 scope + query
const cache = new Map<string, unknown>()
// 预取发出、还没回来的请求。页面挂载时若正好撞上，等它而不是再发一次
const inflight = new Map<string, Promise<unknown>>()
const keyOf = (scope: string, query: string) => `${scope}\u0000${query}`

/** 只给测试用：每个用例从空缓存开始 */
export function clearPageData() {
  cache.clear()
  inflight.clear()
}

/**
 * 提前取一份放进缓存，页面真打开时第一帧就有数据。用在"点一下才出现"的面板上：
 * 合约与持仓的「委托」原先点开才取，每次都先看到一行「读取中…」（2026-10-03）。
 * 已有缓存或已在取就什么都不做；失败也不报——面板打开时会自己再取一次并说明原因。
 */
export function prefetchPageData<T>(scope: string, query: string,
                                    load: (signal: AbortSignal) => Promise<T>) {
  const key = keyOf(scope, query)
  if (cache.has(key) || inflight.has(key)) return
  const pending = load(new AbortController().signal)
    .then((value) => { cache.set(key, value); return value })
    .finally(() => inflight.delete(key))
  inflight.set(key, pending)
  pending.catch(() => {})
}

export function usePageData<T>({ scope, query = '', load, failure, refreshEveryMs, autoRefresh }: {
  scope: string
  query?: string
  load: (signal: AbortSignal, force: boolean) => Promise<T>
  /** 不是 PortfolioError 的失败（多半是代码问题）显示这一句 */
  failure: string
  refreshEveryMs: number
  autoRefresh: boolean
}) {
  const [request, setRequest] = useState<Request>(() => ({
    scope, query, mode: cache.has(keyOf(scope, query)) ? 'silent' : 'initial',
  }))
  const [phase, setPhase] = useState<Phase<T>>(() => {
    const hit = cache.get(keyOf(scope, query))
    return hit === undefined ? { kind: 'loading' } : { kind: 'ready', snapshot: hit as T }
  })
  // 这一份数据是从骨架屏后面出来的：页面据此决定要不要播一次入场
  const [revealed, setRevealed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  // 有请求在路上（哪一种取法都算）。报头那盏灯据此区分"旧了但正在更新"与"旧了且停住了"
  const [syncing, setSyncing] = useState(false)

  // 查询变了：在这一次渲染里就决定怎么取，免得先闪一帧旧状态
  if (request.scope !== scope || request.query !== query) {
    const hit = cache.get(keyOf(scope, query))
    const sameScope = request.scope === scope
    setRequest({
      scope, query,
      mode: hit !== undefined ? 'silent' : sameScope && phase.kind === 'ready' ? 'switch' : 'initial',
    })
    if (hit !== undefined) setPhase({ kind: 'ready', snapshot: hit as T })
  }

  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })
  // 上一个请求还没回来时后台刷新不插队：它只补空档，不打断加载或手动的重新取数
  const inFlight = useRef(false)
  // 每落地一份数据加一。后台刷新或重新取数回来时，若期间已有更新的一份落地
  // （页面自己取的，比如成本保存后的那一次），就不拿这份旧的盖上去
  const landed = useRef(0)
  const current = useRef(keyOf(scope, query))
  useEffect(() => {
    current.current = keyOf(request.scope, request.query)
  }, [request])

  useEffect(() => {
    const { mode } = request
    const key = keyOf(request.scope, request.query)
    const controller = new AbortController()
    const started = landed.current
    inFlight.current = true
    setSyncing(true)
    setRefreshing(mode === 'force')
    setSwitching(mode === 'switch')
    if (mode === 'initial') setPhase({ kind: 'loading' })

    // 第一次进来正好有一份预取在路上：等它，不再发第二个同样的请求
    const pending = mode === 'initial' ? inflight.get(key) as Promise<T> | undefined : undefined
    ;(pending ?? loadRef.current(controller.signal, mode === 'force'))
      .then((snapshot) => {
        if (controller.signal.aborted) return
        if ((mode === 'silent' || mode === 'force') && landed.current !== started) return
        landed.current += 1
        cache.set(key, snapshot)
        setPhase({ kind: 'ready', snapshot })
        setRefreshError(null)
        if (mode === 'initial') setRevealed(true)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const message = error instanceof PortfolioError ? error.message : failure
        // 后台刷新失败不换页：旧数据留在原处，报头的灯变色并在提示里说出原因
        if (mode === 'silent') setRefreshError(message)
        else setPhase({ kind: 'failed', message })
      })
      .finally(() => {
        if (controller.signal.aborted) return
        inFlight.current = false
        setSyncing(false)
        setRefreshing(false)
        setSwitching(false)
      })

    return () => {
      controller.abort()
      inFlight.current = false
    }
    // failure 是文案常量，不该让它触发重取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  const retry = useCallback(() => {
    setRequest((prev) => ({ ...prev, mode: 'force' }))
  }, [])
  const refreshQuietly = useCallback(() => {
    if (!inFlight.current) setRequest((prev) => ({ ...prev, mode: 'silent' }))
  }, [])
  useAutoRefresh(refreshQuietly, refreshEveryMs, autoRefresh)

  /** 页面自己取到的一份（成本保存后的那次）：照常落地、进缓存 */
  const accept = useCallback((snapshot: T) => {
    landed.current += 1
    cache.set(current.current, snapshot)
    setPhase({ kind: 'ready', snapshot })
  }, [])

  return { phase, revealed, refreshing, switching, syncing, refreshError, retry, accept }
}
