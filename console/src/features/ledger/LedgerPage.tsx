import { useCallback, useEffect, useState } from 'react'
import { fetchLedger, readScenario, writeScenario, type Scenario } from '../../api/client'
import { PortfolioError, type LedgerSnapshot } from '../../api/types'
import { ScenarioSwitcher } from '../../components/ScenarioSwitcher'
import { freshnessOf, relativeTime } from '../../lib/format'
import { onRouteChange, readRoute, replaceSection } from '../../lib/router'
import { Masthead } from '../portfolio/Masthead'
import { SectionTabs, type TabItem } from '../portfolio/SectionTabs'
import { EmptyLedgerState, ErrorState, StatementSkeleton, StaleBanner, UnauthorizedState } from '../portfolio/states'
import { LedgerStrip } from './LedgerStrip'
import { WindowSwitcher } from './WindowSwitcher'
import { FILTER_LABEL, filterEntries, LedgerView, type LedgerFilter } from './views'

const FILTERS: LedgerFilter[] = ['all', 'external', 'income', 'internal']

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; snapshot: LedgerSnapshot }
  | { kind: 'failed'; message: string }

function readFilter(): LedgerFilter {
  const { section } = readRoute()
  return (FILTERS as string[]).includes(section ?? '') ? (section as LedgerFilter) : 'all'
}

export function LedgerPage() {
  const [scenario, setScenario] = useState<Scenario>(readScenario)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<LedgerFilter>(readFilter)
  const [days, setDays] = useState(7)

  useEffect(() => onRouteChange(() => setFilter(readFilter())), [])

  useEffect(() => {
    const controller = new AbortController()
    if (reloadKey === 0) setPhase({ kind: 'loading' })
    else setRefreshing(true)

    fetchLedger(scenario, days, controller.signal, { force: reloadKey > 0 })
      .then((snapshot) => setPhase({ kind: 'ready', snapshot }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setPhase({
          kind: 'failed',
          message: error instanceof PortfolioError ? error.message : '读取流水时发生未预期的错误',
        })
      })
      .finally(() => { if (!controller.signal.aborted) setRefreshing(false) })

    return () => controller.abort()
  }, [scenario, reloadKey, days])

  const retry = useCallback(() => setReloadKey((key) => key + 1), [])
  const changeScenario = useCallback((next: Scenario) => {
    writeScenario(next)
    setScenario(next)
    setReloadKey(0)
    setPhase({ kind: 'loading' })
  }, [])
  const selectFilter = useCallback((next: LedgerFilter) => {
    setFilter(next)
    replaceSection('ledger', next)
  }, [])

  const snapshot = phase.kind === 'ready' ? phase.snapshot : null

  return (
    <div className="min-h-[100dvh] bg-desk px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-6">
      <div className="sheet mx-auto flex max-w-[1420px] flex-col lg:h-[calc(100dvh-3rem)]">
        <Masthead
          asOf={snapshot?.as_of ?? null}
          controls={<ScenarioSwitcher onChange={changeScenario} value={scenario} />}
          onRefresh={retry}
          page="ledger"
          refreshing={refreshing}
          sources={snapshot?.sources ?? []}
          title="资金流水"
        />
        <Body days={days} filter={filter} onRetry={retry} onSelectDays={setDays}
              onSelectFilter={selectFilter} phase={phase} />
      </div>
    </div>
  )
}

function buildTabs(snapshot: LedgerSnapshot): TabItem<LedgerFilter>[] {
  return FILTERS.map((key) => ({
    key,
    label: FILTER_LABEL[key],
    // 该类一条都没有时标出来，不必点进去才发现
    muted: key !== 'all' && filterEntries(snapshot.entries, key).length === 0,
  }))
}

function Body({ phase, filter, onSelectFilter, onRetry, days, onSelectDays }: {
  phase: Phase
  filter: LedgerFilter
  onSelectFilter: (key: LedgerFilter) => void
  onRetry: () => void
  days: number
  onSelectDays: (days: number) => void
}) {
  if (phase.kind === 'loading') return <StatementSkeleton />
  if (phase.kind === 'failed') {
    return <div className="px-6 sm:px-10"><ErrorState message={phase.message} onRetry={onRetry} /></div>
  }

  const { snapshot } = phase
  // 与资产页同一条规则：没有任何记录 + 存在凭据问题 → 是 key 的事，不是"这段时间没流水"
  const allUnauthorized = snapshot.entries.length === 0
    && snapshot.sources.some((source) => source.status === 'unauthorized')
  if (allUnauthorized) {
    return <div className="px-6 sm:px-10"><UnauthorizedState onRetry={onRetry} sources={snapshot.sources} /></div>
  }

  const { level } = freshnessOf(snapshot.as_of)
  const veiled = level === 'stale' || level === 'unknown'
  const allOk = snapshot.sources.every((source) => source.status === 'ok')

  return (
    <>
      {veiled && (
        <div className="border-b border-rule px-5 py-3 sm:px-10">
          <StaleBanner asOfText={relativeTime(snapshot.as_of)} />
        </div>
      )}

      <LedgerStrip snapshot={snapshot} veiled={veiled} />

      {/* 区间和分类是同一层的筛选，并排放在这一行。原先区间挤在全站报头里，
          和品牌、导航、账号混作一堆——那一行是"这是哪个应用"，不是"这一页怎么筛"。 */}
      <SectionTabs
        current={filter}
        items={buildTabs(snapshot)}
        onSelect={onSelectFilter}
        trailing={
          <WindowSwitcher days={days} max={snapshot.window.max_days} onChange={onSelectDays} />
        }
      />

      <div className="scroll-y min-h-0 flex-1 px-5 py-7 sm:px-10 sm:py-8" key={filter}>
        <div className="rise">
          {snapshot.entries.length === 0 && allOk
            ? <EmptyLedgerState days={snapshot.window.days} />
            : <LedgerView filter={filter} snapshot={snapshot} veiled={veiled} />}
        </div>
      </div>

    </>
  )
}
