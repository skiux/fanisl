import { useCallback, useEffect, useState } from 'react'
import { fetchPortfolio, readScenario, writeScenario, type Scenario } from '../../api/client'
import { PortfolioError, type PortfolioSnapshot } from '../../api/types'
import { ScenarioSwitcher } from '../../components/ScenarioSwitcher'
import { freshnessOf, relativeTime } from '../../lib/format'
import { exposures } from '../../lib/holdings'
import { onRouteChange, readRoute, replaceSection } from '../../lib/router'
import { Masthead } from './Masthead'
import { SectionTabs, type TabItem } from './SectionTabs'
import { PnlDetail, type PnlTopic } from './PnlDetail'
import { SummaryStrip } from './SummaryStrip'
import { EmptyState, ErrorState, StatementSkeleton, StaleBanner, UnauthorizedState } from './states'
import { HoldingsView, OverviewView, PerpRiskView } from './views'
import { RiskControlView } from './RiskControl'

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; snapshot: PortfolioSnapshot }
  | { kind: 'failed'; message: string }

export type ViewKey = 'overview' | 'holdings' | 'perp' | 'risk'

// `#/assets/changes` 是删掉的那一节，落到这里会被 readView 退回 overview——
// 它的内容（日历、合约收支、充提）现在全在 overview 上，退回去正好是同一份东西。
const VIEW_KEYS: ViewKey[] = ['overview', 'holdings', 'perp', 'risk']

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

function buildTabs(futuresMissing: boolean): TabItem<ViewKey>[] {
  return [
    // 短标签：导航要能一行放下，完整名称留在各视图的抬头里
    // 三个分节。一路从六个减下来：理财只有 3 项、风险只有 2 个读数，各自填不满
    // 一个视图（实测填充率 26% / 36%）；最后去掉的是「盈亏」——它的日历在总览
    // 也有一份，同一张表在两个分节里各印一遍，剩下两块本来就和日历同一个问题。
    { key: 'overview', label: '总览' },
    { key: 'holdings', label: '持仓' },
    // 「合约与风险」拆成两节：那一节原先既列仓位与保证金（现在是什么样），
    // 又摆着风险读数（会怎样），两件事挤在一起谁也没说透。现在左边只讲仓位，
    // 右边专管"再跌多少我出局"。
    { key: 'perp', label: '合约', muted: futuresMissing },
    { key: 'risk', label: '风险控制', muted: futuresMissing },
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

  // 最大单一敞口走 `lib/holdings` 的那一份，和「风险控制」页同源。
  // 那里做了两件这里原先没做的事：**同一标的的现货与永续要相加**（原先各算各的，
  // NVDA 现货和 NVDA 永续会被当成两笔），以及**空头带负号**（多空对锁时真实敞口
  // 接近零，原先会报成两者里大的那个）。持有量也不只看现货钱包。
  const equity = snapshot.totals?.equity_usd ?? 0
  const ranked = exposures(snapshot, equity)
  const biggest = ranked[0]
  const concentration = biggest && equity > 0
    ? { asset: biggest.asset, share: biggest.share }
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

      <SectionTabs current={view} items={buildTabs(futuresMissing)} onSelect={onSelectView} />

      {/* 明细区拿回整幅宽度；区域内部滚动，切换分节时页面高度不变 */}
      <div className="scroll-y min-h-0 flex-1 px-5 py-7 sm:px-10 sm:py-8" key={view}>
        <div className="rise">
          {view === 'overview' && <OverviewView {...shared} onOpen={onSelectView} />}
          {view === 'holdings' && <HoldingsView snapshot={snapshot} veiled={veiled} />}
          {view === 'perp' && (
            <PerpRiskView futuresMissing={futuresMissing} snapshot={snapshot} veiled={veiled} />
          )}
          {view === 'risk' && <RiskControlView snapshot={snapshot} veiled={veiled} />}
        </div>
      </div>

    </>
  )
}
