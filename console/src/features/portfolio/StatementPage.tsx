import { useCallback, useEffect, useState } from 'react'
import { fetchPortfolio, readScenario, writeScenario, type Scenario } from '../../api/client'
import { PortfolioError, type PortfolioSnapshot } from '../../api/types'
import { ScenarioSwitcher } from '../../components/ScenarioSwitcher'
import { clockTime, freshnessOf, money, percent, signedMoney } from '../../lib/format'
import { Masthead } from './Masthead'
import { NavRail, type NavItem, type ViewKey } from './NavRail'
import { SourceStrip } from './SourceStrip'
import { EmptyState, ErrorState, StatementSkeleton, StaleBanner, UnauthorizedState } from './states'
import { ChangesView, EarnView, OverviewView, PerpView, RiskView, SpotView } from './views'

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; snapshot: PortfolioSnapshot }
  | { kind: 'failed'; message: string }

const VIEW_KEYS: ViewKey[] = ['overview', 'changes', 'spot', 'earn', 'perp', 'risk']

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
    <div className="min-h-[100dvh] bg-desk px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      {/*
        桌面把整张纸钉在视口高度内，明细区自己滚：切换分节时页面高度不变，
        不会出现上一版那种"点一下整页跳一截"的问题，也不需要深滚。
      */}
      <div className="sheet mx-auto flex max-w-[1320px] flex-col lg:h-[calc(100dvh-4rem)]">
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
          refreshing={refreshing}
          view={view}
        />
      </div>
    </div>
  )
}

function buildNav(snapshot: PortfolioSnapshot, futuresMissing: boolean): NavItem[] {
  const a = snapshot.attribution
  const spot = snapshot.spot.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)
  const earn = snapshot.earn.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)
  const upnl = snapshot.futures?.total_unrealized_pnl ?? null
  const ratio = snapshot.futures?.margin_ratio ?? null
  return [
    {
      key: 'overview', index: '一', label: '总览',
      figure: snapshot.totals ? money(snapshot.totals.equity_usd) : null,
      note: '净值',
    },
    {
      key: 'changes', index: '二', label: '本期变动',
      figure: a ? signedMoney(a.true_pnl) : null,
      tone: a ? (a.true_pnl >= 0 ? 'gain' : 'loss') : 'muted',
      note: a ? '30 天真实盈亏' : '不可用',
    },
    { key: 'spot', index: '三', label: '现货持仓', figure: money(spot), note: `${snapshot.spot.length} 个币种` },
    { key: 'earn', index: '四', label: '理财持仓', figure: money(earn), note: `${snapshot.earn.length} 个产品` },
    {
      key: 'perp', index: '五', label: '合约仓位',
      figure: futuresMissing || upnl === null ? '—' : signedMoney(upnl),
      tone: futuresMissing || upnl === null ? 'muted' : upnl >= 0 ? 'gain' : 'loss',
      note: futuresMissing ? '取不到' : `${snapshot.futures?.positions.length ?? 0} 笔未实现`,
    },
    {
      key: 'risk', index: '六', label: '风险',
      figure: ratio === null ? '—' : percent(ratio, 1),
      tone: ratio === null ? 'muted' : undefined,
      note: ratio === null ? '取不到' : '合约保证金率',
    },
  ]
}

function Body({ phase, view, onSelectView, onRetry, refreshing }: {
  phase: Phase
  view: ViewKey
  onSelectView: (key: ViewKey) => void
  onRetry: () => void
  refreshing: boolean
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

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,224px)_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col border-b border-rule lg:border-b-0 lg:border-r">
          <NavRail current={view} items={buildNav(snapshot, futuresMissing)} onSelect={onSelectView} />
          <div className="mt-auto hidden border-t border-rule px-4 py-3 lg:block">
            <SourceStrip
              asOf={snapshot.as_of}
              onRefresh={onRetry}
              refreshing={refreshing}
              sources={snapshot.sources}
            />
          </div>
        </div>

        <div className="scroll-y px-5 py-6 sm:px-10 sm:py-8">
          {view === 'overview' && <OverviewView {...shared} />}
          {view === 'changes' && <ChangesView snapshot={snapshot} veiled={veiled} />}
          {view === 'spot' && <SpotView snapshot={snapshot} veiled={veiled} />}
          {view === 'earn' && <EarnView snapshot={snapshot} veiled={veiled} />}
          {view === 'perp' && <PerpView futuresMissing={futuresMissing} snapshot={snapshot} veiled={veiled} />}
          {view === 'risk' && <RiskView {...shared} />}
        </div>
      </div>

      <footer className="border-t border-rule bg-sheet-2/60 px-5 py-3.5 sm:px-10">
        <p className="max-w-[74ch] text-xs leading-relaxed text-ink-3">
          净值为各钱包合计，含合约未实现盈亏。30 天窗口取自日快照接口，该接口只能查最近一个月。
          真实盈亏已剔除充提；取不到的项目一律留空，不以 0 代替。
        </p>
      </footer>
    </>
  )
}
