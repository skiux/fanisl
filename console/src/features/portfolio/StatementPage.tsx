import { useCallback, useEffect, useState } from 'react'
import { fetchPortfolio, readScenario, writeScenario, type Scenario } from '../../api/client'
import { PortfolioError, type PortfolioSnapshot } from '../../api/types'
import { ScenarioSwitcher } from '../../components/ScenarioSwitcher'
import { clockTime, freshnessOf } from '../../lib/format'
import { Masthead } from './Masthead'
import { SectionTabs, type TabItem, type ViewKey } from './SectionTabs'
import { SummaryStrip } from './SummaryStrip'
import { EmptyState, ErrorState, StatementSkeleton, StaleBanner, UnauthorizedState } from './states'
import { ChangesView, HoldingsView, OverviewView, PerpRiskView } from './views'

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; snapshot: PortfolioSnapshot }
  | { kind: 'failed'; message: string }

const VIEW_KEYS: ViewKey[] = ['overview', 'changes', 'holdings', 'perp']

function readView(): ViewKey {
  const raw = window.location.hash.replace(/^#\/?/, '')
  return (VIEW_KEYS as string[]).includes(raw) ? (raw as ViewKey) : 'overview'
}

export function StatementPage() {
  const [scenario, setScenario] = useState<Scenario>(readScenario)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [view, setView] = useState<ViewKey>(readView)

  useEffect(() => {
    const sync = () => setView(readView())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    if (reloadKey === 0) setPhase({ kind: 'loading' })
    else setRefreshing(true)

    fetchPortfolio(scenario, controller.signal)
      .then((snapshot) => setPhase({ kind: 'ready', snapshot }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setPhase({
          kind: 'failed',
          message: error instanceof PortfolioError ? error.message : '读取账户时发生未预期的错误',
        })
      })
      .finally(() => { if (!controller.signal.aborted) setRefreshing(false) })

    return () => controller.abort()
  }, [scenario, reloadKey])

  const retry = useCallback(() => setReloadKey((key) => key + 1), [])
  const changeScenario = useCallback((next: Scenario) => {
    writeScenario(next)
    setScenario(next)
    setReloadKey(0)
    setPhase({ kind: 'loading' })
  }, [])
  const selectView = useCallback((next: ViewKey) => {
    setView(next)
    window.history.replaceState(null, '', `#/${next}`)
  }, [])

  const snapshot = phase.kind === 'ready' ? phase.snapshot : null

  return (
    <div className="min-h-[100dvh] bg-desk px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-6">
      {/*
        桌面把整张纸钉在视口高度内，明细区自己滚：切换分节时页面高度不变，
        不会出现上一版那种"点一下整页跳一截"的问题，也不需要深滚。
      */}
      <div className="sheet mx-auto flex max-w-[1420px] flex-col lg:h-[calc(100dvh-3rem)]">
        <Masthead
          asOf={snapshot?.as_of ?? null}
          controls={<ScenarioSwitcher onChange={changeScenario} value={scenario} />}
          onRefresh={retry}
          refreshing={refreshing}
          sources={snapshot?.sources ?? []}
        />
        <Body
          onRetry={retry}
          onSelectView={selectView}
          phase={phase}
          view={view}
        />
      </div>
    </div>
  )
}

function buildTabs(snapshot: PortfolioSnapshot, futuresMissing: boolean): TabItem[] {
  return [
    // 短标签：导航要能一行放下，完整名称留在各视图的抬头里
    // 四个分节。原先六个里，理财只有 3 项、风险只有 2 个读数，各自填不满一个视图
    // （实测填充率 26% / 36%）——那是分节分错了，不是内容不够。合并进相邻的视图。
    { key: 'overview', label: '总览' },
    { key: 'changes', label: '本期变动', muted: snapshot.attribution === null },
    { key: 'holdings', label: '持仓' },
    { key: 'perp', label: '合约与风险', muted: futuresMissing },
  ]
}

function Body({ phase, view, onSelectView, onRetry }: {
  phase: Phase
  view: ViewKey
  onSelectView: (key: ViewKey) => void
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
  if (snapshot.wallets.length === 0 && snapshot.spot.length === 0) {
    return <div className="px-6 sm:px-10"><EmptyState /></div>
  }

  const { level } = freshnessOf(snapshot.as_of)
  const veiled = level === 'stale' || level === 'unknown'
  const futuresDown = snapshot.sources.find((source) => source.key === 'futures')?.status !== 'ok'
  const futuresMissing = futuresDown && snapshot.futures === null

  const equity = snapshot.totals?.equity_usd ?? 0
  const biggest = [...snapshot.spot].sort((a, b) => (b.value_usd ?? 0) - (a.value_usd ?? 0))[0]
  const concentration = biggest && equity > 0 && biggest.value_usd !== null
    ? { asset: biggest.asset, share: biggest.value_usd / equity }
    : null

  const shared = { snapshot, veiled, futuresMissing, concentration }

  return (
    <>
      {veiled && (
        <div className="border-b border-rule px-5 py-3 sm:px-10">
          <StaleBanner asOfText={clockTime(snapshot.as_of)} />
        </div>
      )}

      <SummaryStrip futuresMissing={futuresMissing} snapshot={snapshot} veiled={veiled} />

      <SectionTabs current={view} items={buildTabs(snapshot, futuresMissing)} onSelect={onSelectView} />

      {/* 明细区拿回整幅宽度；区域内部滚动，切换分节时页面高度不变 */}
      <div className="scroll-y min-h-0 flex-1 px-5 py-7 sm:px-10 sm:py-8" key={view}>
        <div className="rise">
          {view === 'overview' && <OverviewView {...shared} onOpen={onSelectView} />}
          {view === 'changes' && <ChangesView snapshot={snapshot} veiled={veiled} />}
          {view === 'holdings' && <HoldingsView snapshot={snapshot} veiled={veiled} />}
          {view === 'perp' && (
            <PerpRiskView futuresMissing={futuresMissing} snapshot={snapshot} veiled={veiled} />
          )}
        </div>
      </div>

      <footer className="border-t border-rule bg-sheet-2/60 px-5 py-2.5 sm:px-10">
        <p className="text-xs text-ink-3">
          真实盈亏已剔除充提 · 取不到的项目留空，不以 0 代替 · 30 天窗口受日快照接口所限
        </p>
      </footer>
    </>
  )
}
