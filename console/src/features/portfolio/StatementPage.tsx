import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { fetchPortfolio, readScenario, writeScenario, type Scenario } from '../../api/client'
import { PortfolioError, type PortfolioSnapshot, type SourceKey } from '../../api/types'
import { ScenarioSwitcher } from '../../components/ScenarioSwitcher'
import { cn } from '../../lib/cn'
import { clockTime, freshnessOf, money, signedMoney, signedPercent } from '../../lib/format'
import { EarnSummary } from './EarnSummary'
import { EquityCurve } from './EquityCurve'
import { SpotTable, EarnTable } from './Holdings'
import { Masthead } from './Masthead'
import { Reconciliation } from './Reconciliation'
import { PositionsList, RiskGauges } from './RiskPanel'
import { SourceStrip } from './SourceStrip'
import { WalletSpread } from './WalletSpread'
import { EmptyState, ErrorState, StatementSkeleton, StaleBanner, UnauthorizedState } from './states'

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; snapshot: PortfolioSnapshot }
  | { kind: 'failed'; message: string }

/** 章节标题：序号用衬线斜体，标题用衬线正体，右侧留给该节的口径或合计 */
function SectionHeading({ index, title, aside }: {
  index: string
  title: string
  aside?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 border-b border-rule pb-2.5">
      <h2 className="flex items-baseline gap-2.5">
        <span className="section-index">{index}</span>
        <span className="section-title">{title}</span>
      </h2>
      {aside}
    </div>
  )
}

function splitMoney(value: number) {
  const text = money(value)
  const cut = text.lastIndexOf('.')
  return cut === -1 ? [text, ''] : [text.slice(0, cut), text.slice(cut)]
}

type HoldingTab = 'spot' | 'earn' | 'positions'

function Schedules({ snapshot, futuresMissing }: {
  snapshot: PortfolioSnapshot
  futuresMissing: boolean
}) {
  const [tab, setTab] = useState<HoldingTab>('spot')
  const spotValue = snapshot.spot.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)
  const earnValue = snapshot.earn.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)

  const tabs: Array<[HoldingTab, string, string]> = [
    ['spot', '现货', money(spotValue)],
    ['earn', '理财', money(earnValue)],
    ['positions', '合约', futuresMissing ? '不可用' : `${snapshot.futures?.positions.length ?? 0} 笔`],
  ]

  return (
    <section>
      <SectionHeading
        aside={
          <div className="scrollbar-none flex items-baseline gap-4 overflow-x-auto" role="tablist">
            {tabs.map(([key, label, note]) => (
              <button
                aria-selected={tab === key}
                className={cn(
                  'flex shrink-0 items-baseline gap-1.5 whitespace-nowrap text-xs transition-colors duration-200',
                  tab === key ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
                )}
                key={key}
                onClick={() => setTab(key)}
                role="tab"
                type="button"
              >
                <span className={cn(tab === key && 'border-b border-accent pb-px')}>{label}</span>
                <span className="tnum hidden text-micro text-ink-3 sm:inline">{note}</span>
              </button>
            ))}
          </div>
        }
        index="二"
        title="持仓明细"
      />
      {tab === 'spot' && <SpotTable spot={snapshot.spot} />}
      {tab === 'earn' && <EarnTable earn={snapshot.earn} />}
      {tab === 'positions' && (
        <PositionsList futures={snapshot.futures} unavailable={futuresMissing} />
      )}
    </section>
  )
}

export function StatementPage() {
  const [scenario, setScenario] = useState<Scenario>(readScenario)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [reloadKey, setReloadKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

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

  const snapshot = phase.kind === 'ready' ? phase.snapshot : null

  return (
    <div className="min-h-[100dvh] bg-desk px-3 py-4 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <div className="sheet mx-auto max-w-[1240px]">
        <Masthead
          asOf={snapshot?.as_of ?? null}
          controls={<ScenarioSwitcher onChange={changeScenario} value={scenario} />}
          onRefresh={retry}
          refreshing={refreshing}
          sources={snapshot?.sources ?? []}
        />
        <Body onRetry={retry} phase={phase} refreshing={refreshing} />
      </div>
    </div>
  )
}

function Body({ phase, onRetry, refreshing }: {
  phase: Phase
  onRetry: () => void
  refreshing: boolean
}) {
  if (phase.kind === 'loading') return <StatementSkeleton />
  if (phase.kind === 'failed') {
    return <div className="px-6 sm:px-9"><ErrorState message={phase.message} onRetry={onRetry} /></div>
  }

  const { snapshot } = phase
  const allUnauthorized = snapshot.sources.length > 0
    && snapshot.sources.every((source) => source.status === 'unauthorized')
  if (allUnauthorized) {
    return <div className="px-6 sm:px-9"><UnauthorizedState onRetry={onRetry} sources={snapshot.sources} /></div>
  }
  if (snapshot.wallets.length === 0 && snapshot.spot.length === 0) {
    return <div className="px-6 sm:px-9"><EmptyState /></div>
  }

  const { level } = freshnessOf(snapshot.as_of)
  const veiled = level === 'stale' || level === 'unknown'
  const down = (key: SourceKey) =>
    snapshot.sources.find((source) => source.key === key)?.status !== 'ok'
  const futuresMissing = down('futures') && snapshot.futures === null

  const equity = snapshot.totals?.equity_usd ?? 0
  const biggest = [...snapshot.spot].sort((a, b) => (b.value_usd ?? 0) - (a.value_usd ?? 0))[0]
  const concentration = biggest && equity > 0 && biggest.value_usd !== null
    ? { asset: biggest.asset, share: biggest.value_usd / equity }
    : null

  const totals = snapshot.totals
  const [whole, cents] = totals ? splitMoney(totals.equity_usd) : ['—', '']

  return (
    <>
      {veiled && (
        <div className="border-b border-rule px-6 py-3 sm:px-9">
          <StaleBanner asOfText={clockTime(snapshot.as_of)} />
        </div>
      )}

      {/* 摘要：整份报表的结论行。左边是数，右边是这一个月的形状。 */}
      <section
        className="rise grid gap-7 border-b border-rule px-5 py-6 sm:px-9 sm:py-7 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-14"
        style={{ '--i': 0 } as React.CSSProperties}
      >
        <div className={cn(veiled && 'veiled')}>
          <span className="label">净值 · Net asset value</span>
          <div className="mt-2.5 flex items-baseline">
            <span className="tnum text-[2.25rem] font-medium leading-none tracking-[-0.032em] text-ink sm:text-hero">
              {whole}
            </span>
            <span className="tnum text-xl font-medium leading-none tracking-[-0.02em] text-ink-3">
              {cents}
            </span>
          </div>

          <div className="mt-3.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {totals?.change_24h_usd == null ? (
              <span className="text-xs text-ink-3">没有昨日快照，无法给出 24 小时变化</span>
            ) : (
              <>
                <span className={cn('tnum text-base font-medium', totals.change_24h_usd >= 0 ? 'text-gain' : 'text-loss')}>
                  {signedMoney(totals.change_24h_usd)}
                </span>
                <span className={cn('tnum text-sm', (totals.change_24h_pct ?? 0) >= 0 ? 'text-gain' : 'text-loss')}>
                  {signedPercent(totals.change_24h_pct)}
                </span>
                <span className="text-xs text-ink-3">近 24 小时</span>
              </>
            )}
          </div>
        </div>

        <div className="flex min-h-[128px] flex-col">
          <EquityCurve points={snapshot.equity_curve} veiled={veiled} />
        </div>
      </section>

      {/* 正文两栏，中间一条竖线——像报纸的栏线，不是卡片的边框 */}
      <div className="grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div
          className="rise space-y-7 border-b border-rule px-5 py-6 sm:px-9 sm:py-7 lg:space-y-9 lg:border-b-0 lg:border-r"
          style={{ '--i': 1 } as React.CSSProperties}
        >
          <section>
            <SectionHeading
              aside={<span className="text-xs text-ink-3">30 天 · 受日快照接口所限</span>}
              index="一"
              title="本期变动"
            />
            <Reconciliation data={snapshot.attribution} veiled={veiled} />
          </section>

          <Schedules futuresMissing={futuresMissing} snapshot={snapshot} />
        </div>

        <div
          className="rise space-y-7 px-5 py-6 sm:px-9 sm:py-7 lg:space-y-9"
          style={{ '--i': 2 } as React.CSSProperties}
        >
          <section>
            <SectionHeading index="三" title="资产分布" />
            <WalletSpread veiled={veiled} wallets={snapshot.wallets} />
            <div className="mt-5">
              <EarnSummary earn={snapshot.earn} veiled={veiled} />
            </div>
          </section>

          <section>
            <SectionHeading index="四" title="风险" />
            <div className={veiled ? 'veiled' : undefined}>
              <RiskGauges
                concentration={concentration}
                exposureRatio={snapshot.totals?.gross_exposure_ratio ?? null}
                futures={snapshot.futures}
                margin={snapshot.margin}
                unavailable={futuresMissing}
              />
            </div>
          </section>
        </div>
      </div>

      {/* 版本记录：报表该说清自己的口径和边界 */}
      <footer className="border-t border-rule bg-sheet-2/60 px-5 py-5 sm:px-9">
        <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-4">
          <div className="max-w-[62ch] space-y-1.5">
            <span className="label">口径</span>
            <p className="text-xs leading-relaxed text-ink-3">
              净值为各钱包合计，含合约未实现盈亏。本期变动窗口固定 30 天——
              期初净值取自日快照接口，该接口只能查最近一个月。
              真实盈亏已剔除充提；取不到的项目一律留空，不以 0 代替。
            </p>
          </div>
          <div className="min-w-[240px] flex-1">
            <SourceStrip
              asOf={snapshot.as_of}
              onRefresh={onRetry}
              refreshing={refreshing}
              sources={snapshot.sources}
            />
          </div>
        </div>
      </footer>
    </>
  )
}
