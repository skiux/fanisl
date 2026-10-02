import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchOrders, readScenario, writeScenario, type Scenario } from '../../api/client'
import { PortfolioError, type OrdersSnapshot } from '../../api/types'
import { ScenarioSwitcher } from '../../components/ScenarioSwitcher'
import { useAutoRefresh } from '../../lib/autoRefresh'
import { freshnessOf, relativeTime } from '../../lib/format'
import { onRouteChange, readRoute, replaceSection } from '../../lib/router'
import { Masthead } from '../portfolio/Masthead'
import { SectionTabs, type TabItem } from '../portfolio/SectionTabs'
import { ErrorState, StatementSkeleton, StaleBanner, UnauthorizedState } from '../portfolio/states'
import { OrdersStrip } from './OrdersStrip'
import { HistoryView, OpenView } from './views'

type ViewKey = 'open' | 'history'

const VIEW_KEYS: ViewKey[] = ['open', 'history']

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; snapshot: OrdersSnapshot }
  | { kind: 'failed'; message: string }

/**
 * 这一次取数是谁发起的。首次加载与换筛选条件显示骨架；「重新取数」强制穿透缓存；
 * 后台刷新不打扰——旧数据留在原处，失败了也不换成错误页。见 lib/autoRefresh.ts
 */
type Load = { mode: 'initial' | 'force' | 'silent' }

/** 挂单的缓存是 30 秒，一分钟取一次足够让报头一直落在"刚刚"附近 */
const REFRESH_EVERY_MS = 60_000

function readView(): ViewKey {
  const { section } = readRoute()
  return (VIEW_KEYS as string[]).includes(section ?? '') ? (section as ViewKey) : 'open'
}

export function OrdersPage() {
  const [scenario, setScenario] = useState<Scenario>(readScenario)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [load, setLoad] = useState<Load>({ mode: 'initial' })
  const [refreshing, setRefreshing] = useState(false)
  // 上一个请求还没回来时后台刷新不插队
  const inFlight = useRef(false)
  const [view, setView] = useState<ViewKey>(readView)
  // **空串 = 全部**，不是“还没选”。后端不带 symbol 时会把候选里每个交易对
  // 都问一遍再合并；只有明确选了一个才收窄到那一个。
  const [symbol, setSymbol] = useState('')

  useEffect(() => onRouteChange(() => setView(readView())), [])

  useEffect(() => {
    const controller = new AbortController()
    inFlight.current = true
    if (load.mode === 'initial') setPhase({ kind: 'loading' })
    if (load.mode === 'force') setRefreshing(true)

    fetchOrders(scenario, symbol, controller.signal, { force: load.mode === 'force' })
      .then((snapshot) => { if (!controller.signal.aborted) setPhase({ kind: 'ready', snapshot }) })
      .catch((error: unknown) => {
        if (controller.signal.aborted || load.mode === 'silent') return
        setPhase({
          kind: 'failed',
          message: error instanceof PortfolioError ? error.message : '读取委托时发生未预期的错误',
        })
      })
      .finally(() => {
        if (controller.signal.aborted) return
        inFlight.current = false
        setRefreshing(false)
      })

    return () => {
      controller.abort()
      inFlight.current = false
    }
  }, [scenario, load, symbol])

  const retry = useCallback(() => setLoad({ mode: 'force' }), [])
  const refreshQuietly = useCallback(() => {
    if (!inFlight.current) setLoad({ mode: 'silent' })
  }, [])
  useAutoRefresh(refreshQuietly, REFRESH_EVERY_MS, scenario === 'live')

  // 换交易对是一次新的查询：照首次加载走，失败要报出来，不能拿旧交易对的数据冒充
  const selectSymbol = useCallback((next: string) => {
    setSymbol(next)
    setLoad({ mode: 'initial' })
  }, [])
  const changeScenario = useCallback((next: Scenario) => {
    writeScenario(next)
    setScenario(next)
    setLoad({ mode: 'initial' })
    setPhase({ kind: 'loading' })
  }, [])
  const selectView = useCallback((next: ViewKey) => {
    setView(next)
    replaceSection('orders', next)
  }, [])

  const snapshot = phase.kind === 'ready' ? phase.snapshot : null

  return (
    <div className="min-h-[100dvh] bg-desk px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-6">
      <div className="sheet mx-auto flex max-w-[1420px] flex-col lg:h-[calc(100dvh-3rem)]">
        <Masthead
          asOf={snapshot?.as_of ?? null}
          controls={<ScenarioSwitcher onChange={changeScenario} value={scenario} />}
          onRefresh={retry}
          page="orders"
          refreshing={refreshing}
          sources={snapshot?.sources ?? []}
          title="委托记录"
        />
        <Body
          onRetry={retry}
          onSelectSymbol={selectSymbol}
          onSelectView={selectView}
          phase={phase}
          symbol={symbol}
          view={view}
        />
      </div>
    </div>
  )
}

function buildTabs(snapshot: OrdersSnapshot): TabItem<ViewKey>[] {
  const historyDown = snapshot.sources
    .some((source) => source.key === 'order_history' && source.status !== 'ok')
  return [
    { key: 'open', label: '挂单' },
    { key: 'history', label: '历史', muted: historyDown },
  ]
}

function Body({ phase, view, symbol, onSelectView, onSelectSymbol, onRetry }: {
  phase: Phase
  view: ViewKey
  symbol: string
  onSelectView: (key: ViewKey) => void
  onSelectSymbol: (next: string) => void
  onRetry: () => void
}) {
  if (phase.kind === 'loading') return <StatementSkeleton />
  if (phase.kind === 'failed') {
    return <div className="px-6 sm:px-10"><ErrorState message={phase.message} onRetry={onRetry} /></div>
  }

  const { snapshot } = phase
  // 与资产页同一条规则：没有任何数据 + 存在凭据问题 → 是 key 的事，不是"没有挂单"
  const allUnauthorized = snapshot.open.length === 0 && snapshot.history.length === 0
    && snapshot.sources.some((source) => source.status === 'unauthorized')
  if (allUnauthorized) {
    return <div className="px-6 sm:px-10"><UnauthorizedState onRetry={onRetry} sources={snapshot.sources} /></div>
  }

  const { level } = freshnessOf(snapshot.as_of)
  const veiled = level === 'stale' || level === 'unknown'

  return (
    <>
      {veiled && (
        <div className="border-b border-rule px-5 py-3 sm:px-10">
          <StaleBanner asOfText={relativeTime(snapshot.as_of)} />
        </div>
      )}

      <OrdersStrip snapshot={snapshot} veiled={veiled} />

      <SectionTabs current={view} items={buildTabs(snapshot)} onSelect={onSelectView} />

      <div className="scroll-y min-h-0 flex-1 px-5 py-7 pb-28 sm:px-10 sm:py-8 sm:pb-28" key={view}>
        <div className="rise">
          {view === 'open' && <OpenView snapshot={snapshot} veiled={veiled} />}
          {view === 'history' && (
            <HistoryView
              onSelectSymbol={onSelectSymbol}
              snapshot={snapshot}
              symbol={symbol}
              veiled={veiled}
            />
          )}
        </div>
      </div>

    </>
  )
}
