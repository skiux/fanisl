import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fetchLedger, readScenario, writeScenario, type Scenario } from '../../api/client'
import type { LedgerSnapshot } from '../../api/types'
import { ScenarioSwitcher } from '../../components/ScenarioSwitcher'
import { cn } from '../../lib/cn'
import { freshnessOf, relativeTime } from '../../lib/format'
import { usePageData, type Phase as PagePhase } from '../../lib/pageData'
import { onRouteChange, readRoute, replaceSection } from '../../lib/router'
import { withViewTransition } from '../../lib/viewTransition'
import { Masthead } from '../portfolio/Masthead'
import { SectionTabs, type TabItem } from '../portfolio/SectionTabs'
import { EmptyLedgerState, ErrorState, StatementSkeleton, StaleBanner, UnauthorizedState } from '../portfolio/states'
import { LedgerStrip } from './LedgerStrip'
import { WindowSwitcher } from './WindowSwitcher'
import { FILTER_LABEL, filterEntries, LedgerView, type LedgerFilter } from './views'

const FILTERS: LedgerFilter[] = ['all', 'external', 'income', 'internal']

type Phase = PagePhase<LedgerSnapshot>

/** 流水的来源本来就是 5–30 分钟才变一次，取得再勤也只是读同一份缓存 */
const REFRESH_EVERY_MS = 5 * 60_000

function readFilter(): LedgerFilter {
  const { section } = readRoute()
  return (FILTERS as string[]).includes(section ?? '') ? (section as LedgerFilter) : 'all'
}

export function LedgerPage() {
  const [scenario, setScenario] = useState<Scenario>(readScenario)
  const [filter, setFilter] = useState<LedgerFilter>(readFilter)
  const [days, setDays] = useState(7)
  // 取数、缓存、后台刷新都在 usePageData。换区间是同一页里换条件：有缓存直接用，
  // 没有就把旧画面压暗留着，新数据到了再换
  const { phase, revealed, refreshing, switching, refreshError, retry } = usePageData({
    scope: `ledger|${scenario}`,
    query: String(days),
    load: (signal, force) => fetchLedger(scenario, days, signal, { force }),
    failure: '读取流水时发生未预期的错误',
    refreshEveryMs: REFRESH_EVERY_MS,
    autoRefresh: scenario === 'live',
  })

  useEffect(() => onRouteChange(() => setFilter(readFilter())), [])

  const changeScenario = useCallback((next: Scenario) => {
    writeScenario(next)
    setScenario(next)
  }, [])
  // 分类是同一份流水的不同切法：和换页一样做一次短的交叉淡变
  const selectFilter = useCallback((next: LedgerFilter) => {
    withViewTransition(() => setFilter(next))
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
              onSelectFilter={selectFilter} phase={phase} refreshError={refreshError}
              revealed={revealed} switching={switching} />
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

type BodyProps = {
  phase: Phase
  filter: LedgerFilter
  onSelectFilter: (key: LedgerFilter) => void
  onRetry: () => void
  days: number
  onSelectDays: (days: number) => void
  revealed: boolean
  switching: boolean
  refreshError: string | null
}

function Body(props: BodyProps) {
  const { phase, onRetry } = props
  if (phase.kind === 'loading') return <StatementSkeleton />
  if (phase.kind === 'failed') {
    return <div className="px-6 sm:px-10"><ErrorState message={phase.message} onRetry={onRetry} /></div>
  }
  return <Loaded {...props} phase={phase} />
}

function Loaded({
  phase, filter, onSelectFilter, onRetry, days, onSelectDays, revealed, switching, refreshError,
}: BodyProps & { phase: Extract<Phase, { kind: 'ready' }> }) {
  // 换分类时回到顶部；滚动区常驻，不再整块重建（那样每次都会重播入场）
  const scroller = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0
  }, [filter])
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
          <StaleBanner asOfText={relativeTime(snapshot.as_of)} reason={refreshError} />
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

      <div
        aria-busy={switching || undefined}
        className={cn('scroll-y min-h-0 flex-1 px-5 py-7 pb-28 sm:px-10 sm:py-8 sm:pb-28 pending-fade', switching && 'pending')}
        ref={scroller}
      >
        <div className={revealed ? 'rise' : undefined}>
          {snapshot.entries.length === 0 && allOk
            ? <EmptyLedgerState days={snapshot.window.days} />
            : <LedgerView filter={filter} snapshot={snapshot} veiled={veiled} />}
        </div>
      </div>

    </>
  )
}
