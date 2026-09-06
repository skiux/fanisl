import { useCallback, useEffect, useState } from 'react'
import { fetchPortfolio, readScenario, writeScenario, type Scenario } from '../../api/client'
import { PortfolioError, type PortfolioSnapshot } from '../../api/types'
import { ScenarioSwitcher } from '../../components/ScenarioSwitcher'
import { baseOf, freshnessOf, relativeTime, STABLE_ASSETS } from '../../lib/format'
import { onRouteChange, readRoute, replaceSection } from '../../lib/router'
import { Masthead } from './Masthead'
import { SectionTabs, type TabItem } from './SectionTabs'
import { PnlDetail, type PnlTopic } from './PnlDetail'
import { SummaryStrip } from './SummaryStrip'
import { EmptyState, ErrorState, StatementSkeleton, StaleBanner, UnauthorizedState } from './states'
import { ChangesView, HoldingsView, OverviewView, PerpRiskView } from './views'

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; snapshot: PortfolioSnapshot }
  | { kind: 'failed'; message: string }

export type ViewKey = 'overview' | 'changes' | 'holdings' | 'perp'

const VIEW_KEYS: ViewKey[] = ['overview', 'changes', 'holdings', 'perp']

function readView(): ViewKey {
  const { section } = readRoute()
  return (VIEW_KEYS as string[]).includes(section ?? '') ? (section as ViewKey) : 'overview'
}

export function StatementPage() {
  const [scenario, setScenario] = useState<Scenario>(readScenario)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [view, setView] = useState<ViewKey>(readView)

  useEffect(() => onRouteChange(() => setView(readView())), [])

  useEffect(() => {
    const controller = new AbortController()
    if (reloadKey === 0) setPhase({ kind: 'loading' })
    else setRefreshing(true)

    fetchPortfolio(scenario, controller.signal, { force: reloadKey > 0 })
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
    replaceSection('assets', next)
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
          page="assets"
          refreshing={refreshing}
          sources={snapshot?.sources ?? []}
          title="资产报表"
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

function buildTabs(snapshot: PortfolioSnapshot, futuresMissing: boolean): TabItem<ViewKey>[] {
  return [
    // 短标签：导航要能一行放下，完整名称留在各视图的抬头里
    // 四个分节。原先六个里，理财只有 3 项、风险只有 2 个读数，各自填不满一个视图
    // （实测填充率 26% / 36%）——那是分节分错了，不是内容不够。合并进相邻的视图。
    { key: 'overview', label: '总览' },
    { key: 'changes', label: '盈亏', muted: snapshot.pnl === null },
    { key: 'holdings', label: '持仓' },
    { key: 'perp', label: '合约与风险', muted: futuresMissing },
  ]
}

/**
 * 加载与失败两态先在这里挡掉，**有数据了才挂载 `Loaded`**。
 *
 * 不能在一个组件里先 return 再调 hook：加详情抽屉时我把 `useState` 写在了这两个
 * return 之后，hook 顺序会随 phase 变。同样的错在 `RealizedDays` 里已经造成过
 * 一次整页白屏，这次是 lint 抓到的（那时候这个项目还没有 lint）。
 */
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
  return <Loaded onRetry={onRetry} onSelectView={onSelectView} phase={phase} view={view} />
}

function Loaded({ phase, view, onSelectView, onRetry }: {
  phase: Extract<Phase, { kind: 'ready' }>
  view: ViewKey
  onSelectView: (key: ViewKey) => void
  onRetry: () => void
}) {
  // 详情抽屉的开关。放在这一层而不是页面顶层：只有拿到 snapshot 才有数据可给，
  // 往上提要么多传一层，要么在没数据时也挂着一个空对话框。
  const [detail, setDetail] = useState<PnlTopic | null>(null)
  const { snapshot } = phase
  // 「一条数据都没有」与「为什么没有」是两件事，分开判。
  //
  // 原来写的是"每个来源都 unauthorized"，而 prices 是公开端点、没有 key 也照常返回，
  // 于是这个条件再也不成立——没配 key 被误报成"账户里还没有资产"，
  // 屏幕上还留着一句"前往 Binance"，方向完全指反了。
  const hasNothing = snapshot.wallets.length === 0 && snapshot.spot.length === 0
    && snapshot.futures === null && snapshot.earn.length === 0
  const credentialProblem = snapshot.sources.some((s) => s.status === 'unauthorized')
  if (hasNothing && credentialProblem) {
    return <div className="px-6 sm:px-10"><UnauthorizedState onRetry={onRetry} sources={snapshot.sources} /></div>
  }
  if (hasNothing) {
    return <div className="px-6 sm:px-10"><EmptyState /></div>
  }

  const { level } = freshnessOf(snapshot.as_of)
  const veiled = level === 'stale' || level === 'unknown'
  const futuresDown = snapshot.sources.find((source) => source.key === 'futures')?.status !== 'ok'
  const futuresMissing = futuresDown && snapshot.futures === null

  // 最大单一敞口要把永续的名义算进来：这个账户的仓位都在合约上，
  // 现货只剩保证金用的稳定币，只看现货会把 USDT 报成"最集中的持仓"。
  const equity = snapshot.totals?.equity_usd ?? 0
  const exposures = [
    ...snapshot.spot
      .filter((item) => !STABLE_ASSETS.has(item.asset) && item.value_usd !== null)
      .map((item) => ({ asset: item.asset, value: item.value_usd as number })),
    ...(snapshot.futures?.positions ?? [])
      .map((position) => ({ asset: baseOf(position.symbol), value: position.notional_usd })),
  ].sort((a, b) => b.value - a.value)
  const biggest = exposures[0]
  const concentration = biggest && equity > 0
    ? { asset: biggest.asset, share: biggest.value / equity }
    : null

  const shared = { snapshot, veiled, futuresMissing, concentration }

  return (
    <>
      {veiled && (
        <div className="border-b border-rule px-5 py-3 sm:px-10">
          <StaleBanner asOfText={relativeTime(snapshot.as_of)} />
        </div>
      )}

      <SummaryStrip onOpenDetail={setDetail} snapshot={snapshot} veiled={veiled} />
      <PnlDetail onClose={() => setDetail(null)} pnl={snapshot.pnl} topic={detail} />

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

    </>
  )
}
