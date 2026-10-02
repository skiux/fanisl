import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  fetchPortfolio, readScenario, saveSpotCost, saveStockCost, writeScenario,
  type Scenario, type SpotCostInput, type StockCostInput,
} from '../../api/client'
import type { PortfolioSnapshot } from '../../api/types'
import { ScenarioSwitcher } from '../../components/ScenarioSwitcher'
import { cn } from '../../lib/cn'
import { freshnessOf, relativeTime } from '../../lib/format'
import { usePageData, type Phase as PagePhase } from '../../lib/pageData'
import { onRouteChange, readRoute } from '../../lib/router'
import { Masthead } from './Masthead'
import { PnlDetail, type PnlTopic } from './PnlDetail'
import { SummaryStrip } from './SummaryStrip'
import { EmptyState, ErrorState, StatementSkeleton, StaleBanner, UnauthorizedState } from './states'
import { HoldingsView, OverviewView, PerpRiskView } from './views'
import { RiskControlView } from './RiskControl'

type Phase = PagePhase<PortfolioSnapshot>

/** 页面在前台时多久静默重取一次。打不打 Binance 由后端缓存决定，见 lib/autoRefresh.ts */
const REFRESH_EVERY_MS = 60_000

export type ViewKey = 'overview' | 'holdings' | 'perp' | 'risk'

// `#/assets/changes` 是删掉的那一节，落到这里会被 readView 退回 overview——
// 日历与合约收支已经并入 overview，旧入口不再对应独立页面。
const VIEW_KEYS: ViewKey[] = ['overview', 'holdings', 'perp', 'risk']

function readView(): ViewKey {
  const { section } = readRoute()
  return (VIEW_KEYS as string[]).includes(section ?? '') ? (section as ViewKey) : 'overview'
}

export function StatementPage() {
  const [scenario, setScenario] = useState<Scenario>(readScenario)
  const [view, setView] = useState<ViewKey>(readView)
  // 成本保存后那一次刷新进行中：和「重新取数」共用报头上那个转圈
  const [saving, setSaving] = useState(false)
  // 取数、缓存、后台刷新都在 usePageData：换页回来先显示上一次的数据，再静默更新
  const { phase, revealed, refreshing, switching, refreshError, retry, accept } = usePageData({
    scope: `assets|${scenario}`,
    load: (signal, force) => fetchPortfolio(scenario, signal, { force }),
    failure: '读取账户时发生未预期的错误',
    refreshEveryMs: REFRESH_EVERY_MS,
    // 示例数据场景是本地拼的，不需要轮询
    autoRefresh: scenario === 'live',
  })

  useEffect(() => onRouteChange(() => setView(readView())), [])

  const changeScenario = useCallback((next: Scenario) => {
    writeScenario(next)
    setScenario(next)
  }, [])
  // 手工成本存在本地表里，不需要强制穿透 Binance 的高权重缓存。
  const saveAndReload = useCallback(async (save: () => Promise<unknown>) => {
    setSaving(true)
    try {
      await save()
      try {
        accept(await fetchPortfolio(scenario, undefined, { force: false }))
      } catch (cause) {
        const detail = cause instanceof Error ? `：${cause.message}` : ''
        throw new Error(`成本已保存，但账户快照刷新失败${detail}`, { cause })
      }
    } finally {
      setSaving(false)
    }
  }, [scenario, accept])
  const saveCost = useCallback((symbol: string, input: StockCostInput) =>
    saveAndReload(() => saveStockCost(scenario, symbol, input)), [scenario, saveAndReload])
  const saveCryptoCost = useCallback((asset: string, input: SpotCostInput) =>
    saveAndReload(() => saveSpotCost(scenario, asset, input)), [scenario, saveAndReload])

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
          refreshing={refreshing || saving}
          sources={snapshot?.sources ?? []}
          title={{ overview: '资产报表', holdings: '持仓', perp: '合约', risk: '风险控制' }[view]}
        />
        <Body
          onRetry={retry}
          onSaveStockCost={saveCost}
          onSaveSpotCost={saveCryptoCost}
          phase={phase}
          refreshError={refreshError}
          revealed={revealed}
          scenario={scenario}
          switching={switching}
          view={view}
        />
      </div>
    </div>
  )
}

/**
 * 加载与失败两态先在这里挡掉，**有数据了才挂载 `Loaded`**。
 *
 * 不能在一个组件里先 return 再调 hook：加详情抽屉时我把 `useState` 写在了这两个
 * return 之后，hook 顺序会随 phase 变。同样的错在 `RealizedDays` 里已经造成过
 * 一次整页白屏，这次是 lint 抓到的（那时候这个项目还没有 lint）。
 */
type Presence = {
  /** 这份数据是从骨架屏后面出来的：只有这时才播一次入场 */
  revealed: boolean
  /** 换了条件、新数据还没到：旧画面压暗 */
  switching: boolean
  /** 最近一次后台刷新失败的原因，过期横幅里说出来 */
  refreshError: string | null
}

function Body({ phase, view, onRetry, onSaveStockCost, onSaveSpotCost, scenario, ...presence }: Presence & {
  phase: Phase
  scenario: Scenario
  view: ViewKey
  onRetry: () => void
  onSaveStockCost: (symbol: string, input: StockCostInput) => Promise<void>
  onSaveSpotCost: (asset: string, input: SpotCostInput) => Promise<void>
}) {
  if (phase.kind === 'loading') return <StatementSkeleton />
  if (phase.kind === 'failed') {
    return <div className="px-6 sm:px-10"><ErrorState message={phase.message} onRetry={onRetry} /></div>
  }
  return (
    <Loaded
      onRetry={onRetry}
      onSaveStockCost={onSaveStockCost}
      onSaveSpotCost={onSaveSpotCost}
      phase={phase}
      scenario={scenario}
      view={view}
      {...presence}
    />
  )
}

function Loaded({
  phase, view, onRetry, onSaveStockCost, onSaveSpotCost, scenario, revealed, switching, refreshError,
}: Presence & {
  phase: Extract<Phase, { kind: 'ready' }>
  scenario: Scenario
  view: ViewKey
  onRetry: () => void
  onSaveStockCost: (symbol: string, input: StockCostInput) => Promise<void>
  onSaveSpotCost: (asset: string, input: SpotCostInput) => Promise<void>
}) {
  // 详情抽屉的开关。放在这一层而不是页面顶层：只有拿到 snapshot 才有数据可给，
  // 往上提要么多传一层，要么在没数据时也挂着一个空对话框。
  const [detail, setDetail] = useState<PnlTopic | null>(null)
  // 换分节时回到顶部。原先靠给滚动区加 key={view} 整块重建来做，代价是每切一次都
  // 重播一遍入场动画；现在滚动区常驻，只把位置归零
  const scroller = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0
  }, [view])
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

  return (
    <>
      {veiled && (
        <div className="border-b border-rule px-5 py-3 sm:px-10">
          <StaleBanner asOfText={relativeTime(snapshot.as_of)} reason={refreshError} />
        </div>
      )}

      <SummaryStrip onOpenDetail={setDetail} snapshot={snapshot} veiled={veiled} view={view} />
      <PnlDetail onClose={() => setDetail(null)} pnl={snapshot.pnl} topic={detail} />

      {/* 明细区拿回整幅宽度；区域内部滚动，切换分节时页面高度不变 */}
      <div
        aria-busy={switching || undefined}
        className={cn('scroll-y min-h-0 flex-1 px-5 py-7 pb-28 sm:px-10 sm:py-8 sm:pb-28 pending-fade', switching && 'pending')}
        ref={scroller}
      >
        <div className={revealed ? 'rise' : undefined}>
          {view === 'overview' && <OverviewView snapshot={snapshot} veiled={veiled} />}
          {view === 'holdings' && (
            <HoldingsView
              onSaveStockCost={onSaveStockCost}
              onSaveSpotCost={onSaveSpotCost}
              snapshot={snapshot}
              veiled={veiled}
            />
          )}
          {view === 'perp' && (
            <PerpRiskView futuresMissing={futuresMissing} scenario={scenario} snapshot={snapshot} veiled={veiled} />
          )}
          {view === 'risk' && <RiskControlView snapshot={snapshot} veiled={veiled} />}
        </div>
      </div>

    </>
  )
}
