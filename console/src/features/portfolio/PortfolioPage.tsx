import { useCallback, useEffect, useState } from 'react'
import { fetchPortfolio, readScenario, writeScenario, type Scenario } from '../../api/client'
import { PortfolioError, type PortfolioSnapshot, type SourceKey } from '../../api/types'
import { ScenarioSwitcher } from '../../components/ScenarioSwitcher'
import { Shell } from '../../components/Shell'
import { clockTime, freshnessOf } from '../../lib/format'
import { AttributionPanel } from './Attribution'
import { Holdings } from './Holdings'
import { NetWorthBand } from './NetWorthBand'
import { RiskPanel } from './RiskPanel'
import { SourceStrip } from './SourceStrip'
import { WalletSpread } from './WalletSpread'
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
      <main className="mx-auto max-w-[1320px] px-5 pb-24 pt-8 sm:px-8 sm:pt-10">
        <Body onRetry={retry} phase={phase} refreshing={refreshing} />
      </main>
    </Shell>
  )
}

function Body({ phase, onRetry, refreshing }: {
  phase: Phase
  onRetry: () => void
  refreshing: boolean
}) {
  if (phase.kind === 'loading') return <PortfolioSkeleton />
  if (phase.kind === 'failed') return <ErrorState message={phase.message} onRetry={onRetry} />

  const { snapshot } = phase
  const allUnauthorized = snapshot.sources.length > 0
    && snapshot.sources.every((source) => source.status === 'unauthorized')
  if (allUnauthorized) return <UnauthorizedState onRetry={onRetry} sources={snapshot.sources} />

  const hasAnything = snapshot.wallets.length > 0 || snapshot.spot.length > 0
  if (!hasAnything) return <EmptyState />

  const { level } = freshnessOf(snapshot.as_of)
  const veiled = level === 'stale' || level === 'unknown'
  const down = (key: SourceKey) =>
    snapshot.sources.find((source) => source.key === key)?.status !== 'ok'
  // 合约取不到且手上也没有可显示的仓位，才算这一节不可用；
  // 全部断线但缓存里有数据时照常显示，过期由蒙层和横幅表达。
  const futuresMissing = down('futures') && snapshot.futures === null

  return (
    <div className="space-y-10 sm:space-y-12">
      <SourceStrip
        asOf={snapshot.as_of}
        onRefresh={onRetry}
        refreshing={refreshing}
        sources={snapshot.sources}
      />

      {veiled && <StaleBanner asOfText={clockTime(snapshot.as_of)} />}

      <NetWorthBand
        attribution={snapshot.attribution}
        curve={snapshot.equity_curve}
        totals={snapshot.totals}
        transfers={snapshot.transfers}
        veiled={veiled}
      />

      <div className="h-px w-full bg-line" />

      <WalletSpread veiled={veiled} wallets={snapshot.wallets} />

      <div className="h-px w-full bg-line" />

      <AttributionPanel data={snapshot.attribution} veiled={veiled} />

      <div className="h-px w-full bg-line" />

      <div className="grid gap-12 xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-14">
        <Holdings earn={snapshot.earn} spot={snapshot.spot} veiled={veiled} />
        <div className="xl:border-l xl:border-line xl:pl-14">
          <RiskPanel
            exposureRatio={snapshot.totals?.gross_exposure_ratio ?? null}
            futures={snapshot.futures}
            margin={snapshot.margin}
            unavailable={futuresMissing}
            veiled={veiled}
          />
        </div>
      </div>
    </div>
  )
}
