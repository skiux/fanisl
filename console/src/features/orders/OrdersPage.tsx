import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fetchOrders, readScenario, writeScenario, type Scenario } from '../../api/client'
import type { OrdersSnapshot } from '../../api/types'
import { ScenarioSwitcher } from '../../components/ScenarioSwitcher'
import { cn } from '../../lib/cn'
import { usePageData, type Phase as PagePhase } from '../../lib/pageData'
import { onRouteChange, readRoute, replaceSection } from '../../lib/router'
import { withViewTransition } from '../../lib/viewTransition'
import { Masthead } from '../portfolio/Masthead'
import { SectionTabs, type TabItem } from '../portfolio/SectionTabs'
import { ErrorState, StatementSkeleton, UnauthorizedState } from '../portfolio/states'
import { OrdersStrip } from './OrdersStrip'
import { HistoryView, OpenView } from './views'

type ViewKey = 'open' | 'history'

const VIEW_KEYS: ViewKey[] = ['open', 'history']

type Phase = PagePhase<OrdersSnapshot>

/** 挂单的缓存是 30 秒，一分钟取一次足够让报头一直落在"刚刚"附近 */
const REFRESH_EVERY_MS = 60_000

function readView(): ViewKey {
  const { section } = readRoute()
  return (VIEW_KEYS as string[]).includes(section ?? '') ? (section as ViewKey) : 'open'
}

export function OrdersPage() {
  const [scenario, setScenario] = useState<Scenario>(readScenario)
  const [view, setView] = useState<ViewKey>(readView)
  // **空串 = 全部**，不是“还没选”。后端不带 symbol 时会把候选里每个交易对
  // 都问一遍再合并；只有明确选了一个才收窄到那一个。
  const [symbol, setSymbol] = useState('')
  // 取数、缓存、后台刷新都在 usePageData。换交易对是同一页里换条件：有缓存直接用，
  // 没有就把旧画面压暗留着，新数据到了再换
  const { phase, revealed, refreshing, switching, syncing, refreshError, retry } = usePageData({
    scope: `orders|${scenario}`,
    query: symbol,
    load: (signal, force) => fetchOrders(scenario, symbol, signal, { force }),
    failure: '读取委托时发生未预期的错误',
    refreshEveryMs: REFRESH_EVERY_MS,
    autoRefresh: scenario === 'live',
  })

  useEffect(() => onRouteChange(() => setView(readView())), [])

  const changeScenario = useCallback((next: Scenario) => {
    writeScenario(next)
    setScenario(next)
  }, [])
  // 挂单 / 历史是同一份数据的两种看法：和换页一样做一次短的交叉淡变
  const selectView = useCallback((next: ViewKey) => {
    withViewTransition(() => setView(next))
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
          refreshError={refreshError}
          refreshing={refreshing}
          sources={snapshot?.sources ?? []}
          syncing={syncing}
          title="委托记录"
        />
        <Body
          onRetry={retry}
          onSelectSymbol={setSymbol}
          onSelectView={selectView}
          phase={phase}
          revealed={revealed}
          switching={switching}
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

function Body({
  phase, view, symbol, onSelectView, onSelectSymbol, onRetry, revealed, switching,
}: {
  phase: Phase
  revealed: boolean
  switching: boolean
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

  return <Loaded {...{ phase, view, symbol, onSelectView, onSelectSymbol, onRetry, revealed, switching }} />
}

function Loaded({
  phase, view, symbol, onSelectView, onSelectSymbol, onRetry, revealed, switching,
}: {
  phase: Extract<Phase, { kind: 'ready' }>
  view: ViewKey
  symbol: string
  onSelectView: (key: ViewKey) => void
  onSelectSymbol: (next: string) => void
  onRetry: () => void
  revealed: boolean
  switching: boolean
}) {
  // 换分节时回到顶部；滚动区常驻，不再整块重建（那样每次都会重播入场）
  const scroller = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0
  }, [view])
  const { snapshot } = phase
  // 与资产页同一条规则：没有任何数据 + 存在凭据问题 → 是 key 的事，不是"没有挂单"
  const allUnauthorized = snapshot.open.length === 0 && snapshot.history.length === 0
    && snapshot.sources.some((source) => source.status === 'unauthorized')
  if (allUnauthorized) {
    return <div className="px-6 sm:px-10"><UnauthorizedState onRetry={onRetry} sources={snapshot.sources} /></div>
  }

  return (
    <>
      <OrdersStrip snapshot={snapshot} />

      <SectionTabs current={view} items={buildTabs(snapshot)} onSelect={onSelectView} />

      <div
        aria-busy={switching || undefined}
        className={cn('scroll-y min-h-0 flex-1 px-5 py-7 pb-28 sm:px-10 sm:py-8 sm:pb-28 pending-fade', switching && 'pending')}
        ref={scroller}
      >
        <div className={revealed ? 'rise' : undefined}>
          {view === 'open' && <OpenView snapshot={snapshot} />}
          {view === 'history' && (
            <HistoryView
              onSelectSymbol={onSelectSymbol}
              snapshot={snapshot}
              symbol={symbol}
            />
          )}
        </div>
      </div>

    </>
  )
}
