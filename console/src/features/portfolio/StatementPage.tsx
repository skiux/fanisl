import { useCallback, useEffect, useState } from 'react'
import { fetchPortfolio, readScenario, writeScenario, type Scenario } from '../../api/client'
import { PortfolioError, type PortfolioSnapshot } from '../../api/types'
import { ScenarioSwitcher } from '../../components/ScenarioSwitcher'
import { clockTime, freshnessOf } from '../../lib/format'
import { Details } from './Details'
import { Hero } from './Hero'
import { Insight } from './Insight'
import { Masthead } from './Masthead'
import { SourceStrip } from './SourceStrip'
import { Structure } from './Structure'
import { EmptyState, ErrorState, StatementSkeleton, StaleBanner, UnauthorizedState } from './states'

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; snapshot: PortfolioSnapshot }
  | { kind: 'failed'; message: string }

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
    return <div className="px-6 sm:px-12"><ErrorState message={phase.message} onRetry={onRetry} /></div>
  }

  const { snapshot } = phase
  const allUnauthorized = snapshot.sources.length > 0
    && snapshot.sources.every((source) => source.status === 'unauthorized')
  if (allUnauthorized) {
    return <div className="px-6 sm:px-12"><UnauthorizedState onRetry={onRetry} sources={snapshot.sources} /></div>
  }
  if (snapshot.wallets.length === 0 && snapshot.spot.length === 0) {
    return <div className="px-6 sm:px-12"><EmptyState /></div>
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

  return (
    <>
      {veiled && (
        <div className="border-b border-rule px-6 py-3 sm:px-12">
          <StaleBanner asOfText={clockTime(snapshot.as_of)} />
        </div>
      )}

      <Hero curve={snapshot.equity_curve} totals={snapshot.totals} veiled={veiled} />
      <Insight data={snapshot.attribution} veiled={veiled} />
      <Structure
        concentration={concentration}
        exposureRatio={snapshot.totals?.gross_exposure_ratio ?? null}
        futures={snapshot.futures}
        futuresMissing={futuresMissing}
        margin={snapshot.margin}
        veiled={veiled}
        wallets={snapshot.wallets}
      />
      <Details futuresMissing={futuresMissing} snapshot={snapshot} veiled={veiled} />

      <footer className="border-t border-rule bg-sheet-2/60 px-6 py-5 sm:px-12">
        <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-4">
          <p className="max-w-[58ch] text-xs leading-relaxed text-ink-3">
            净值为各钱包合计，含合约未实现盈亏。30 天窗口取自日快照接口，该接口只能查最近一个月。
            真实盈亏已剔除充提；取不到的项目一律留空，不以 0 代替。
          </p>
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
