import { useCallback, useEffect, useState } from 'react'
import { fetchOrders, readScenario, writeScenario, type Scenario } from '../../api/client'
import { PortfolioError, type OrdersSnapshot } from '../../api/types'
import { ScenarioSwitcher } from '../../components/ScenarioSwitcher'
import { clockTime, freshnessOf } from '../../lib/format'
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

function readView(): ViewKey {
  const { section } = readRoute()
  return (VIEW_KEYS as string[]).includes(section ?? '') ? (section as ViewKey) : 'open'
}

export function OrdersPage() {
  const [scenario, setScenario] = useState<Scenario>(readScenario)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [view, setView] = useState<ViewKey>(readView)
  // 空串 = 还没选过，用后端返回的那个交易对；写死一个符号会在标的换了之后查空
  const [symbol, setSymbol] = useState('')

  useEffect(() => onRouteChange(() => setView(readView())), [])

  useEffect(() => {
    const controller = new AbortController()
    if (reloadKey === 0) setPhase({ kind: 'loading' })
    else setRefreshing(true)

    fetchOrders(scenario, symbol, controller.signal)
      .then((snapshot) => setPhase({ kind: 'ready', snapshot }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setPhase({
          kind: 'failed',
          message: error instanceof PortfolioError ? error.message : '读取委托时发生未预期的错误',
        })
      })
      .finally(() => { if (!controller.signal.aborted) setRefreshing(false) })

    return () => controller.abort()
  }, [scenario, reloadKey, symbol])

  const retry = useCallback(() => setReloadKey((key) => key + 1), [])
  const changeScenario = useCallback((next: Scenario) => {
    writeScenario(next)
    setScenario(next)
    setReloadKey(0)
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
          onSelectSymbol={setSymbol}
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
  const allUnauthorized = snapshot.sources.length > 0
    && snapshot.sources.every((source) => source.status === 'unauthorized')
  if (allUnauthorized) {
    return <div className="px-6 sm:px-10"><UnauthorizedState onRetry={onRetry} sources={snapshot.sources} /></div>
  }

  const { level } = freshnessOf(snapshot.as_of)
  const veiled = level === 'stale' || level === 'unknown'

  return (
    <>
      {veiled && (
        <div className="border-b border-rule px-5 py-3 sm:px-10">
          <StaleBanner asOfText={clockTime(snapshot.as_of)} />
        </div>
      )}

      <OrdersStrip snapshot={snapshot} veiled={veiled} />

      <SectionTabs current={view} items={buildTabs(snapshot)} onSelect={onSelectView} />

      <div className="scroll-y min-h-0 flex-1 px-5 py-7 sm:px-10 sm:py-8" key={view}>
        <div className="rise">
          {view === 'open' && <OpenView snapshot={snapshot} veiled={veiled} />}
          {view === 'history' && (
            <HistoryView
              onSelectSymbol={onSelectSymbol}
              snapshot={snapshot}
              symbol={symbol || snapshot.query?.symbol || snapshot.history_symbols[0] || ''}
              veiled={veiled}
            />
          )}
        </div>
      </div>

      <footer className="border-t border-rule bg-sheet-2/60 px-5 py-2.5 sm:px-10">
        <p className="text-xs text-ink-3">
          挂单可一次取全账户 · 历史与成交必须按交易对查，区间与回溯都有接口上限 · 取不到的项目留空
        </p>
      </footer>
    </>
  )
}
