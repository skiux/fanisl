import { useCallback, useEffect, useState } from 'react'
import { fetchPortfolio, readScenario, writeScenario, type Scenario } from '../../api/client'
import { PortfolioError, type PortfolioSnapshot } from '../../api/types'
import { ScenarioSwitcher } from '../../components/ScenarioSwitcher'
import { Shell } from '../../components/Shell'
import { clockTime, freshnessOf } from '../../lib/format'
import { AllocationBar } from './AllocationBar'
import { HoldingsList } from './HoldingsList'
import { NetWorthBand } from './NetWorthBand'
import { PositionsPanel } from './PositionsPanel'
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
        const message = error instanceof PortfolioError
          ? error.message
          : '读取账户时发生未预期的错误'
        setPhase({ kind: 'failed', message })
      })
      .finally(() => {
        if (!controller.signal.aborted) setRefreshing(false)
      })

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
      <main className="mx-auto max-w-[1320px] px-5 pb-24 pt-10 sm:px-8 sm:pt-14">
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
  const allUnauthorized = snapshot.venues.length > 0
    && snapshot.venues.every((venue) => venue.status === 'unauthorized')
  if (allUnauthorized) return <UnauthorizedState onRetry={onRetry} venues={snapshot.venues} />

  const hasAnything = snapshot.balances.length > 0 || snapshot.positions.length > 0
  if (!hasAnything) return <EmptyState />

  const { level } = freshnessOf(snapshot.as_of)
  const veiled = level === 'stale' || level === 'unknown'
  const futuresVenue = snapshot.venues.find((venue) => venue.venue === 'futures')
  // 只有"取不到且手上也没有可显示的数据"才算不可用。
  // 全部来源断线但缓存里有仓位时，仍然显示缓存——过期由蒙层和横幅表达。
  const futuresMissing = futuresVenue !== undefined
    && futuresVenue.status !== 'ok'
    && snapshot.positions.length === 0
    && snapshot.futures_risk === null

  return (
    <div className="space-y-10 sm:space-y-12">
      {veiled && <StaleBanner asOfText={clockTime(snapshot.as_of)} />}

      <NetWorthBand onRefresh={onRetry} refreshing={refreshing} snapshot={snapshot} />

      <div className="h-px w-full bg-line" />

      <AllocationBar balances={snapshot.balances} veiled={veiled} />

      <div className="grid gap-12 xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-14">
        <HoldingsList balances={snapshot.balances} veiled={veiled} />
        <div className="xl:border-l xl:border-line xl:pl-14">
          <PositionsPanel
            positions={snapshot.positions}
            risk={snapshot.futures_risk}
            unavailable={futuresMissing}
            veiled={veiled}
          />
        </div>
      </div>
    </div>
  )
}
