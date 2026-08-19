import { useCallback, useEffect, useState } from 'react'
import { fetchPortfolio, readScenario, writeScenario, type Scenario } from '../../api/client'
import { PortfolioError, type PortfolioSnapshot, type SourceKey } from '../../api/types'
import { ScenarioSwitcher } from '../../components/ScenarioSwitcher'
import { Shell } from '../../components/Shell'
import { Eyebrow } from '../../components/Primitives'
import { clockTime, freshnessOf } from '../../lib/format'
import { EquityCurve } from './EquityCurve'
import { NetWorthCell } from './NetWorthCell'
import { RiskGauges } from './RiskPanel'
import { SourceStrip } from './SourceStrip'
import { EarnSummary } from './EarnSummary'
import { WalletSpread } from './WalletSpread'
import { WorkArea } from './WorkArea'
import { EmptyState, ErrorState, PortfolioSkeleton, StaleBanner, UnauthorizedState } from './states'

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; snapshot: PortfolioSnapshot }
  | { kind: 'failed'; message: string }

export function PortfolioPage() {
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

  return (
    <Shell current="assets" trailing={<ScenarioSwitcher onChange={changeScenario} value={scenario} />}>
      <Body onRetry={retry} phase={phase} refreshing={refreshing} />
    </Shell>
  )
}

/** 非工作台形态（骨架、错误、空态）共用的居中容器 */
function Centered({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-[1800px] px-5 py-10 sm:px-8">{children}</main>
}

function Body({ phase, onRetry, refreshing }: {
  phase: Phase
  onRetry: () => void
  refreshing: boolean
}) {
  if (phase.kind === 'loading') return <PortfolioSkeleton />
  if (phase.kind === 'failed') return <Centered><ErrorState message={phase.message} onRetry={onRetry} /></Centered>

  const { snapshot } = phase
  const allUnauthorized = snapshot.sources.length > 0
    && snapshot.sources.every((source) => source.status === 'unauthorized')
  if (allUnauthorized) {
    return <Centered><UnauthorizedState onRetry={onRetry} sources={snapshot.sources} /></Centered>
  }

  const hasAnything = snapshot.wallets.length > 0 || snapshot.spot.length > 0
  if (!hasAnything) return <Centered><EmptyState /></Centered>

  const { level } = freshnessOf(snapshot.as_of)
  const veiled = level === 'stale' || level === 'unknown'
  const down = (key: SourceKey) =>
    snapshot.sources.find((source) => source.key === key)?.status !== 'ok'
  const futuresMissing = down('futures') && snapshot.futures === null

  // 集中度：最大单一持仓占净值多少。杠杆之外的另一半风险，仪表盘常漏
  const equity = snapshot.totals?.equity_usd ?? 0
  const biggest = [...snapshot.spot].sort((a, b) => (b.value_usd ?? 0) - (a.value_usd ?? 0))[0]
  const concentration = biggest && equity > 0 && biggest.value_usd !== null
    ? { asset: biggest.asset, share: biggest.value_usd / equity }
    : null

  return (
    <main className="mx-auto flex max-w-[1800px] flex-col xl:h-[calc(100dvh-3.5rem)] xl:overflow-hidden">
      {veiled && (
        <div className="border-b border-line px-5 py-3 sm:px-6">
          <StaleBanner asOfText={clockTime(snapshot.as_of)} />
        </div>
      )}

      {/*
        定高工作台：概览常驻（上排 + 右栏），明细收进工作区标签页。
        xl 以下退回单列纵向滚动——窄屏本来就该滚。
      */}
      {/*
        两列结构：左列上净值+曲线、下工作区（多余高度全归它，图表和表格用得上）；
        右列跨两行，收进风险/钱包/理财/来源四块——单靠钱包一块撑不满一整列，
        把行距拉开去填只会更难看。
      */}
      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-12 xl:grid-rows-[minmax(13rem,auto)_minmax(0,1fr)]">
        <section className="cell border-b border-line xl:col-span-3 xl:border-r">
          <NetWorthCell
            attribution={snapshot.attribution}
            totals={snapshot.totals}
            transfers={snapshot.transfers}
            veiled={veiled}
          />
        </section>

        <section className="cell border-b border-line xl:col-span-6 xl:border-r">
          <Eyebrow>30 天净值 · 日快照</Eyebrow>
          <div className="mt-2 flex min-h-0 flex-1 flex-col">
            <EquityCurve points={snapshot.equity_curve} veiled={veiled} />
          </div>
        </section>

        <section className="cell order-2 border-b border-line xl:order-none xl:col-span-3 xl:row-span-2 xl:border-b-0">
          <div className="scroll-y flex min-h-0 flex-1 flex-col gap-5">
            <div>
              <Eyebrow>风险 · Exposure</Eyebrow>
              <div className={veiled ? 'veiled' : undefined}>
                <RiskGauges
                  concentration={concentration}
                  exposureRatio={snapshot.totals?.gross_exposure_ratio ?? null}
                  futures={snapshot.futures}
                  margin={snapshot.margin}
                  unavailable={futuresMissing}
                />
              </div>
            </div>
            <div className="border-t border-line pt-4">
              <WalletSpread veiled={veiled} wallets={snapshot.wallets} />
            </div>
            <EarnSummary earn={snapshot.earn} veiled={veiled} />
          </div>
          <div className="mt-3 border-t border-line pt-3">
            <SourceStrip
              asOf={snapshot.as_of}
              onRefresh={onRetry}
              refreshing={refreshing}
              sources={snapshot.sources}
            />
          </div>
        </section>

        <section className="cell order-1 border-b border-line xl:order-none xl:col-span-9 xl:border-b-0 xl:border-r xl:border-line">
          <WorkArea futuresMissing={futuresMissing} snapshot={snapshot} veiled={veiled} />
        </section>
      </div>
    </main>
  )
}
