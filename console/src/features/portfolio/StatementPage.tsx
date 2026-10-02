import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  fetchFund, fetchPortfolio, readScenario, saveSpotCost, saveStockCost, writeScenario,
  type Scenario, type SpotCostInput, type StockCostInput,
} from '../../api/client'
import type { FundSnapshot, PortfolioSnapshot } from '../../api/types'
import { ScenarioSwitcher } from '../../components/ScenarioSwitcher'
import { cn } from '../../lib/cn'
import { usePageData, type Phase as PagePhase } from '../../lib/pageData'
import { useIsAdmin } from '../../lib/role'
import { hrefOf, onRouteChange, readRoute } from '../../lib/router'
import { AccountsStrip, AccountsView, accountsModel } from './Accounts'
import { Masthead } from './Masthead'
import { PnlDetail, type PnlTopic } from './PnlDetail'
import { SummaryStrip } from './SummaryStrip'
import { EmptyState, ErrorState, StatementSkeleton, UnauthorizedState } from './states'
import { HoldingsView, OverviewView, PerpRiskView } from './views'
import { RiskControlView } from './RiskControl'

/**
 * 资产页的数据：Binance 快照 + 管理员录入的账户规则（初始净值、现金、各人的分配比例）。
 * 两份一起取、一起缓存。规则那一份取不到不拖垮整页：现金、盈亏与「账户」显示 `—`。
 */
type Statement = PortfolioSnapshot & { fund: FundSnapshot | null }
type Phase = PagePhase<Statement>

async function loadStatement(scenario: Scenario, signal: AbortSignal | undefined, force: boolean): Promise<Statement> {
  const [portfolio, fund] = await Promise.all([
    fetchPortfolio(scenario, signal, { force }),
    fetchFund(scenario, signal).catch(() => null),
  ])
  return { ...portfolio, fund }
}

/** 页面在前台时多久静默重取一次。打不打 Binance 由后端缓存决定，见 lib/autoRefresh.ts */
const REFRESH_EVERY_MS = 60_000

export type ViewKey = 'overview' | 'accounts' | 'holdings' | 'perp' | 'risk'

// `#/assets/changes` 是删掉的那一节，落到这里会被 readView 退回 overview——
// 日历与合约收支已经并入 overview，旧入口不再对应独立页面。
const VIEW_KEYS: ViewKey[] = ['overview', 'accounts', 'holdings', 'perp', 'risk']

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
  const { phase, revealed, refreshing, switching, syncing, refreshError, retry, accept } = usePageData({
    scope: `assets|${scenario}`,
    load: (signal, force) => loadStatement(scenario, signal, force),
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
        accept(await loadStatement(scenario, undefined, false))
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
  // 「账户」那一节：管理员总能进；成员只有自己是参与者时才有（后端只给他自己那一行）。
  // 进不去的人落到这个地址就看总览，标题上也不出现「账户」
  const isAdmin = useIsAdmin()
  const hasAccounts = isAdmin || (snapshot?.fund?.members.length ?? 0) > 0
  const shown: ViewKey = view === 'accounts' && snapshot && !hasAccounts ? 'overview' : view

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
          refreshError={refreshError}
          refreshing={refreshing || saving}
          sources={snapshot?.sources ?? []}
          syncing={syncing}
          title={shown === 'overview' || shown === 'accounts'
            ? <AssetTitle accounts={hasAccounts} current={shown} />
            : { holdings: '持仓', perp: '合约', risk: '风险控制' }[shown]}
        />
        <Body
          admin={isAdmin}
          onRetry={retry}
          onSaveStockCost={saveCost}
          onSaveSpotCost={saveCryptoCost}
          phase={phase}
          revealed={revealed}
          scenario={scenario}
          switching={switching}
          view={shown}
        />
      </div>
    </div>
  )
}

/**
 * 总览与「账户」共用一个标题位：「资产  账户」，当前那个是墨色，另一个是可点的灰字。
 * 它们是同一份净值的两种看法——一个看整个账户里有什么，一个看这份净值分给了谁。
 */
function AssetTitle({ current, accounts }: { current: 'overview' | 'accounts'; accounts: boolean }) {
  const item = (key: 'overview' | 'accounts', label: string) => (
    <a
      aria-current={current === key ? 'page' : undefined}
      className={cn('transition-colors duration-200',
        current === key ? 'text-ink' : 'text-ink-3 hover:text-ink-2')}
      href={hrefOf('assets', key)}
    >
      {label}
    </a>
  )
  return (
    <span className="flex items-baseline gap-5">
      {item('overview', '资产')}
      {accounts && item('accounts', '账户')}
    </span>
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
  admin: boolean
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
  phase, view, onRetry, onSaveStockCost, onSaveSpotCost, scenario, revealed, switching, admin,
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
  // 「账户」那一节看的是谁。默认第一个；成员只有自己一个
  const [accountId, setAccountId] = useState<number | null>(null)
  // 换分节时回到顶部。原先靠给滚动区加 key={view} 整块重建来做，代价是每切一次都
  // 重播一遍入场动画；现在滚动区常驻，只把位置归零
  const scroller = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0
  }, [view])
  const { snapshot } = phase
  const model = useMemo(() => accountsModel(snapshot, snapshot.fund), [snapshot])
  const account = model.accounts.find((row) => row.member.user_id === accountId)
    ?? model.accounts[0] ?? null
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

  const futuresDown = snapshot.sources.find((source) => source.key === 'futures')?.status !== 'ok'
  const futuresMissing = futuresDown && snapshot.futures === null

  return (
    <>
      {view === 'accounts' ? (
        <AccountsStrip account={account} atMs={model.atMs} fund={snapshot.fund} snapshot={snapshot} />
      ) : (
        <SummaryStrip fund={snapshot.fund} onOpenDetail={setDetail} snapshot={snapshot} view={view} />
      )}
      <PnlDetail onClose={() => setDetail(null)} pnl={snapshot.pnl} topic={detail} />

      {/* 明细区拿回整幅宽度；区域内部滚动，切换分节时页面高度不变 */}
      <div
        aria-busy={switching || undefined}
        className={cn('scroll-y min-h-0 flex-1 px-5 py-7 pb-28 sm:px-10 sm:py-8 sm:pb-28 pending-fade', switching && 'pending')}
        ref={scroller}
      >
        <div className={revealed ? 'rise' : undefined}>
          {view === 'overview' && <OverviewView snapshot={snapshot} />}
          {view === 'accounts' && (
            <AccountsView
              account={account}
              admin={admin}
              fund={snapshot.fund}
              model={model}
              onSelect={setAccountId}
              snapshot={snapshot}
            />
          )}
          {view === 'holdings' && (
            <HoldingsView
              onSaveStockCost={onSaveStockCost}
              onSaveSpotCost={onSaveSpotCost}
              scenario={scenario}
              snapshot={snapshot}
            />
          )}
          {view === 'perp' && (
            <PerpRiskView futuresMissing={futuresMissing} scenario={scenario} snapshot={snapshot} />
          )}
          {view === 'risk' && <RiskControlView snapshot={snapshot} />}
        </div>
      </div>

    </>
  )
}
