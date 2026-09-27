import { useEffect, useMemo, useState } from 'react'
import { cn } from '../../lib/cn'
import type { SpotCostInput, StockCostInput } from '../../api/client'
import { amount, baseOf, money, percent, price, signedMoney, signedPercent, SOURCE_LABEL } from '../../lib/format'
import { cash, spotHoldings } from '../../lib/holdings'
import type { DailyPnl, MarginAccount, PortfolioSnapshot } from '../../api/types'
import { AllocationWheel } from '../../components/AllocationWheel'
import { Figure, Module, SplitBar, Stack, ViewGrid } from '../../components/layout'
import { assetColor } from './ExposureDistribution'
import { RealizedDays } from './RealizedDays'
import { CashTable, SpotTable } from './Holdings'
import { PnlBreakdown } from './PnlBreakdown'
import { StockPositionsList, StockSummary } from './StockPositions'
import { useIsAdmin } from '../../lib/role'

/** 合约 income 与 userTrades 都只保留 90 天，这是接口硬限 */
const WINDOW_DAYS = 90
const ISOLATED_STATUS: Record<string, string> = {
  EXCESSIVE: '充足',
  NORMAL: '正常',
  MARGIN_CALL: '追加保证金',
  PRE_LIQUIDATION: '接近强平',
  FORCE_LIQUIDATION: '强平中',
}
import { PositionsList } from './RiskPanel'
import { SourceHealth } from './SourceHealth'

/**
 * 总览。四个分节里唯一的"整页"：日历（时间）、现金（流动性）、合约收支
 * （这 90 天的钱去哪了）、风险判断（越线与否），外加只在出问题时出现的取数状态。
 * 明细里的清单一律不在这里重复一份缩略版——那不是摘要，是把同一份内容印两遍。
 *
 * **原先「盈亏」是一个独立分节，已经并进来了。** 日历与合约收支留在总览；充提已从
 * 总览移除。现金则从持仓页移到这里，避免同一份账户流动性与资产仓位混在一个分节。
 *
 * **「每日盈亏」不给跳转箭头。** 箭头只在"点开有别的东西"时才给；日历点开就是它
 * 自己，没有别的去处。
 */
export function OverviewView({ snapshot, veiled }: {
  snapshot: PortfolioSnapshot
  veiled: boolean
}) {
  const pnl = snapshot.pnl
  const cashRows = cash(snapshot)
  const relevantSources = snapshot.sources.filter((source) => source.status !== 'unsupported')
  const missingCount = relevantSources.filter((source) => source.status !== 'ok').length
  const pnlDays = useMemo(() => pnl?.daily ?? [], [pnl])
  const [selectedDate, setSelectedDate] = useState<string | null>(pnlDays.at(-1)?.date ?? null)
  useEffect(() => {
    if (selectedDate && pnlDays.some((day) => day.date === selectedDate)) return
    setSelectedDate(pnlDays.at(-1)?.date ?? null)
  }, [pnlDays, selectedDate])
  const selectedDay = pnlDays.find((day) => day.date === selectedDate) ?? null
  const incomeModule = (
    <Module
      note={`${WINDOW_DAYS} 天`}
      span={cashRows.length > 0 ? '' : 'lg:col-span-12'}
      title="合约收支"
    >
      <PnlBreakdown pnl={pnl} />
    </Module>
  )

  return (
    <div className={cn(veiled && 'veiled')}>
      <ViewGrid>
        {/* 不给 figure：它原先放的是 today_usd，而摘要条上那个「今日盈亏」
            就是同一个数——同一屏里说两遍。日历自己有月合计和区间合计。 */}
        <Module span={cashRows.length > 0 ? 'self-start lg:col-span-7' : 'self-start lg:col-span-12'} title="每日盈亏">
          <RealizedDays
            days={pnlDays}
            onSelectDate={setSelectedDate}
            selectedDate={selectedDate}
          />
          <DailyPnlBreakdown day={selectedDay} />
        </Module>

        {/* 四行同一个窗口、同一个来源，条形才可比——旧的「盈亏构成」把 1 天、
            此刻、全历史、90 天四种窗口混在一张表里画对比条，见 PnlBreakdown。
            现货那半边归日历（那里才有区间概念）。 */}
        {cashRows.length > 0 ? (
          <Stack span="lg:col-span-5">
            <CashModule rows={cashRows} snapshot={snapshot} span="" />
            {incomeModule}
          </Stack>
        ) : incomeModule}

        {/* **只在出问题时出现。** 全绿时这一块是纯运维信息——和流水页那张
            「取数窗口」端点表同一类，删了；但来源挂掉时它是有用的：页面上的数字
            少了一块，得说清楚少的是哪一块。所以不按角色藏，按状态出。 */}
        {missingCount > 0 && (
          <Module
            figure={`${missingCount} 项缺失`}
            span="lg:col-span-12"
            title="数据不完整"
            tone="muted"
          >
            <SourceHealth sources={snapshot.sources} />
          </Module>
        )}
      </ViewGrid>
    </div>
  )
}

const DAY_PARTS: { key: keyof Pick<DailyPnl, 'spot_usd' | 'stock_usd' | 'settled_usd' | 'earn_usd' | 'interest_usd'>; label: string }[] = [
  { key: 'spot_usd', label: '现货涨跌' },
  { key: 'stock_usd', label: '正股涨跌' },
  { key: 'settled_usd', label: '合约结算' },
  { key: 'earn_usd', label: '理财收益' },
  { key: 'interest_usd', label: '杠杆利息' },
]

function DailyPnlBreakdown({ day }: { day: DailyPnl | null }) {
  return (
    <aside className="mt-6 min-w-0 border-t border-rule pt-5">
      {day ? (
        <>
          <div className="flex items-baseline justify-between gap-4">
            <span className="tnum text-xs text-ink-3">{day.date}</span>
            <span className={cn('tnum text-xl', day.pnl_usd === null
              ? 'text-ink-3' : day.pnl_usd > 0 ? 'text-gain'
                : day.pnl_usd < 0 ? 'text-loss' : 'text-ink-2')}>
              {day.pnl_usd === null ? '—' : signedMoney(day.pnl_usd)}
            </span>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 xl:grid-cols-5">
            {DAY_PARTS.map(({ key, label }) => {
              const value = day[key]
              return (
                <div className="min-w-0" key={key}>
                  <dt className="text-xs text-ink-3">{label}</dt>
                  <dd className={cn('tnum mt-1.5 text-base', value === null
                    ? 'text-ink-3' : value > 0 ? 'text-gain'
                      : value < 0 ? 'text-loss' : 'text-ink-2')}>
                    {value === null ? '—' : signedMoney(value)}
                  </dd>
                </div>
              )
            })}
          </dl>
        </>
      ) : <span className="text-sm text-ink-3">—</span>}
    </aside>
  )
}

function CashModule({ rows, snapshot, span }: {
  rows: ReturnType<typeof cash>
  snapshot: PortfolioSnapshot
  span: string
}) {
  const total = rows.reduce((sum, row) => sum + (row.value_usd ?? 0), 0)
  const earning = rows.filter((row) => row.apr !== null)
  const earningValue = earning.reduce((sum, row) => sum + (row.value_usd ?? 0), 0)
  const apr = earningValue > 0
    ? earning.reduce((sum, row) => sum + (row.value_usd ?? 0) * (row.apr ?? 0), 0)
      / earningValue
    : null
  const dailyYield = earningValue > 0
    ? earning.reduce((sum, row) => sum + (row.value_usd ?? 0) * (row.apr ?? 0), 0) / 365
    : null
  const lockedValue = earning.filter((row) => row.where === '理财 · 定期')
    .reduce((sum, row) => sum + (row.value_usd ?? 0), 0)

  return (
    <Module figure={money(total)} span={span} title="现金">
      <SplitBar
        left={earningValue}
        leftLabel="生息"
        right={total - earningValue}
        rightLabel="闲置"
      />
      <dl className="mb-5 grid grid-cols-2 gap-x-5 gap-y-5 xl:grid-cols-4 xl:gap-x-8">
        <Figure label="生息部分" value={money(earningValue)} />
        <Figure
          label="加权年化"
          tone={apr === null ? undefined : 'gain'}
          value={apr === null ? '—' : percent(apr, 2)}
        />
        <Figure
          label="占净值"
          value={percent(snapshot.totals ? total / snapshot.totals.equity_usd : null, 1)}
        />
        <Figure label="闲置" value={money(total - earningValue)} />
      </dl>
      <CashTable rows={rows} />
      <div className="mt-5 border-t border-rule pt-4">
        <div className="mb-3 text-xs text-ink-2">理财收益</div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 sm:gap-x-10">
          <Figure label="预计日收益" tone="gain" value={money(dailyYield)} />
          <Figure label="加权年化" tone="gain" value={apr === null ? '—' : percent(apr, 2)} />
          <Figure label="流动生息" value={money(earningValue - lockedValue)} />
          <Figure label="锁定生息" value={money(lockedValue)} />
        </dl>
      </div>
    </Module>
  )
}

export function HoldingsView({ snapshot, veiled, onSaveStockCost, onSaveSpotCost }: {
  snapshot: PortfolioSnapshot
  veiled: boolean
  onSaveStockCost?: (symbol: string, input: StockCostInput) => Promise<void>
  onSaveSpotCost?: (asset: string, input: SpotCostInput) => Promise<void>
}) {
  const isAdmin = useIsAdmin()
  const holdings = spotHoldings(snapshot)
  const holdingsValue = holdings.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)
  const m = snapshot.margin
  const liability = m && m.total_asset_usd > 0 ? m.total_liability_usd / m.total_asset_usd : null
  const marginEnabled = snapshot.sources.find((source) => source.key === 'margin')?.status !== 'unsupported'
  const stockPositions = snapshot.stocks.positions
  const unresolvedStocks = snapshot.stocks.tokenized_assets
    .filter((row) => !row.multiplier_valid)
  const stockCount = stockPositions.length + unresolvedStocks.length
  const stockPnlRows = stockPositions.filter((row) => row.unrealized_pnl_usd !== null)
  const stockPnl = stockPnlRows.reduce((sum, row) => sum + (row.unrealized_pnl_usd ?? 0), 0)
  const stockPnlComplete = stockCount > 0
    && unresolvedStocks.length === 0
    && stockPnlRows.length === stockPositions.length

  return (
    <div className={cn(veiled && 'veiled')}>
      <ViewGrid>
        <Module
          figure={money(holdingsValue)}
          span="lg:col-span-8"
          title="现货持仓"
        >
          <SpotTable
            canEditCost={isAdmin && Boolean(onSaveSpotCost) && !veiled}
            onSaveCost={onSaveSpotCost} spot={holdings}
          />
        </Module>

        <Stack span="lg:col-span-4">
          {marginEnabled && <MarginAccountModule dense liability={liability} margin={m} span="" />}
        </Stack>

        {stockCount > 0 && (
          <>
            <Module
              figure={stockPnlComplete ? signedMoney(stockPnl) : '—'}
              note={stockPnlComplete
                ? `${stockCount} 个标的`
                : `${stockPnlRows.length} / ${stockCount} 项盈亏可算`}
              span="lg:col-span-8"
              title="股票持仓"
              tone={!stockPnlComplete ? 'muted' : stockPnl >= 0 ? 'gain' : 'loss'}
            >
              <StockPositionsList
                canEditCost={isAdmin && Boolean(onSaveStockCost)}
                onSaveCost={onSaveStockCost}
                positions={stockPositions}
                unresolved={unresolvedStocks}
              />
            </Module>
            <StockSummary
              equityUsd={snapshot.totals?.equity_usd ?? null}
              stocks={snapshot.stocks}
            />
          </>
        )}

      </ViewGrid>
    </div>
  )
}

export function PerpRiskView({ snapshot, veiled, futuresMissing }: {
  snapshot: PortfolioSnapshot
  veiled: boolean
  futuresMissing: boolean
}) {
  const f = snapshot.futures
  const longNotional = (f?.positions ?? [])
    .filter((p) => p.position_amt > 0).reduce((sum, p) => sum + p.notional_usd, 0)
  const shortNotional = (f?.positions ?? [])
    .filter((p) => p.position_amt < 0).reduce((sum, p) => sum + p.notional_usd, 0)
  const gross = longNotional + shortNotional
  // 真实杠杆 = 合约总价值 / 保证金余额。
  // 合约的杠杆设置（那个 20×）只是开仓上限，不代表现在扛着多少倍。
  const realLeverage = f && f.total_margin_balance > 0 ? gross / f.total_margin_balance : null

  if (futuresMissing || !f) {
    return (
      <div className={cn(veiled && 'veiled')}>
        <ViewGrid>
          <Module span="lg:col-span-12" title="合约账户不可用">
            <p className="max-w-[52ch] text-sm leading-relaxed text-ink-2">
              本次未取到合约账户数据。
            </p>
            <ul className="mt-5 divide-y divide-rule border-t border-rule">
              {snapshot.sources.filter((source) => (
                source.status !== 'ok' && source.status !== 'unsupported'
              )).map((source) => (
                <li className="flex items-center gap-3 py-2.5" key={source.key}>
                  <span className="w-[84px] shrink-0 text-xs text-ink-2">
                    {SOURCE_LABEL[source.key] ?? source.key}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-3">{source.detail ?? '—'}</span>
                </li>
              ))}
            </ul>
          </Module>
          <AdditionalRiskModules snapshot={snapshot} />
        </ViewGrid>
      </div>
    )
  }

  return (
    <div className={cn(veiled && 'veiled')}>
      <ViewGrid>
        <Module
          note={`${f.positions.length} 项 · ${f.dual_side_position ? '双向' : '单向'}`}
          span="lg:col-span-8"
          title="合约仓位"
        >
          <PositionsList futures={f} unavailable={false} />
        </Module>

        <Stack span="lg:col-span-4">
          <Module
            span=""
            title="合约账户"
          >
            {(() => {
              const estimated = f.estimated_funding_fee_usd
              const todayFunding = snapshot.pnl?.today?.settled_parts?.funding_fee ?? null
              const todayRate = todayFunding !== null && gross > 0 ? todayFunding / gross : null
              return (
                <dl className="grid grid-cols-1 gap-y-5 sm:grid-cols-3 lg:grid-cols-1">
                  <Figure
                    label="未实现盈亏"
                    tone={f.total_unrealized_pnl > 0 ? 'gain'
                      : f.total_unrealized_pnl < 0 ? 'loss' : undefined}
                    value={signedMoney(f.total_unrealized_pnl)}
                  />
                  <Figure
                    label="预估资金费用"
                    note={f.estimated_funding_rate === null ? undefined : signedPercent(-f.estimated_funding_rate, 4)}
                    tone={estimated === null || estimated === 0
                      ? undefined : estimated > 0 ? 'gain' : 'loss'}
                    value={estimated === null ? '—' : signedMoney(estimated)}
                  />
                  <Figure
                    label="今日资金费用"
                    note={todayRate === null ? undefined : signedPercent(todayRate, 4)}
                    tone={todayFunding === null || todayFunding === 0
                      ? undefined : todayFunding > 0 ? 'gain' : 'loss'}
                    value={todayFunding === null ? '—' : signedMoney(todayFunding)}
                  />
                </dl>
              )
            })()}
          </Module>

          <Module
            figure={money(f.total_margin_balance)}
            note="保证金余额"
            span=""
            title="保证金"
          >
            <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
              <Figure label="维持保证金" value={money(f.total_maint_margin)} />
              <Figure label="起始保证金" value={money(f.total_initial_margin)} />
              <Figure label="可用余额" value={money(f.available_balance)} />
              <Figure label="钱包余额" value={money(f.total_wallet_balance)} />
            </dl>
          </Module>

          <Module
            figure={money(gross)}
            note="合约总价值"
            span=""
            title="多空价值"
          >
            {gross > 0 ? (
              <>
                <SplitBar
                  left={longNotional}
                  leftLabel="多头"
                  right={shortNotional}
                  rightLabel="空头"
                />
                <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
                  <Figure label="多头价值" value={money(longNotional)} />
                  <Figure label="空头价值" value={money(shortNotional)} />
                  <Figure
                    label="净价值"
                    value={signedMoney(longNotional - shortNotional)}
                  />
                  {/* 逐仓那个 20× 是开仓上限，每一行自己已经写着；这里要的是
                      "这笔保证金实际扛着多少倍"，扫十行也看不出来。 */}
                  <Figure
                    label="真实杠杆"
                    value={realLeverage === null ? '—' : `${realLeverage.toFixed(2)}×`}
                  />
                </dl>
                <ContractAllocation positions={f.positions} />
              </>
            ) : <p className="text-sm text-ink-3">当前没有合约仓位。</p>}
          </Module>

        </Stack>
        <AdditionalRiskModules snapshot={snapshot} />
      </ViewGrid>
    </div>
  )
}

function ContractAllocation({ positions }: { positions: NonNullable<PortfolioSnapshot['futures']>['positions'] }) {
  const [selection, setSelection] = useState<string | null>(null)
  const items = positions.filter((position) => position.notional_usd > 0).map((position) => {
    const asset = baseOf(position.symbol)
    const short = position.position_amt < 0 || position.position_side === 'short'
    return {
      key: `${position.symbol}:${position.position_side}`,
      asset,
      label: `${short ? '−' : '+'} ${asset}`,
      value: Math.abs(position.notional_usd),
      color: assetColor(asset),
    }
  })

  useEffect(() => {
    const clearFromElsewhere = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-contract-allocation] [data-slice]')) return
      setSelection(null)
    }
    document.addEventListener('pointerdown', clearFromElsewhere)
    return () => document.removeEventListener('pointerdown', clearFromElsewhere)
  }, [])

  return (
    <div className="mx-auto mt-7 w-full max-w-[420px] border-t border-rule pt-6" data-contract-allocation>
      <AllocationWheel
        accessibleTitle="合约仓位价值轮，+ 表示多头，− 表示空头"
        items={items}
        onSelect={setSelection}
        selected={selection}
      />
    </div>
  )
}

function AdditionalRiskModules({ snapshot }: { snapshot: PortfolioSnapshot }) {
  const isolated = snapshot.isolated_margin
  const loan = snapshot.liquidation_loan
  const portfolio = snapshot.portfolio_margin
  return (
    <>
      {loan && loan.remaining_amount > 0 && (
        <Module
          figure={`${amount(loan.remaining_amount)} ${loan.asset}`}
          note="尚未偿还"
          span="lg:col-span-12"
          title="强平借款"
          tone="loss"
        >
          <dl className="grid grid-cols-2 gap-x-10 gap-y-5 sm:max-w-2xl sm:grid-cols-3">
            <Figure label="原始借款" value={`${amount(loan.amount)} ${loan.asset}`} />
            <Figure label="已偿还" value={`${amount(loan.repaid_amount)} ${loan.asset}`} />
            <Figure
              label="待偿还"
              tone="loss"
              value={`${amount(loan.remaining_amount)} ${loan.asset}`}
            />
          </dl>
        </Module>
      )}

      {isolated && isolated.pairs.length > 0 && (
        <Module
          note={`${isolated.pairs.length} 个交易对`}
          span="lg:col-span-12"
          title="逐仓杠杆账户"
        >
          <dl className="mb-5 grid grid-cols-2 gap-x-10 gap-y-5 sm:max-w-2xl sm:grid-cols-3">
            <Figure label="总资产" value={money(isolated.total_asset_usd)} />
            <Figure label="总负债" tone="loss" value={money(isolated.total_liability_usd)} />
            <Figure label="净资产" value={money(isolated.total_net_asset_usd)} />
          </dl>
          <ul className="divide-y divide-rule border-y border-rule">
            {isolated.pairs.map((pair) => {
              const liabilities = [pair.base, pair.quote]
                .filter((leg) => leg.borrowed + leg.interest > 0)
                .map((leg) => `${amount(leg.borrowed + leg.interest)} ${leg.asset}`)
              return (
                <li className="grid gap-3 py-3.5 sm:grid-cols-[minmax(0,1fr)_repeat(4,minmax(0,0.72fr))] sm:items-center" key={pair.symbol}>
                  <div>
                    <div className="text-sm text-ink">{pair.symbol}</div>
                    <div className="mt-1 text-xs text-ink-3">
                      {pair.trade_enabled ? '可交易' : '暂停交易'}
                      {pair.margin_level_status
                        ? ` · ${ISOLATED_STATUS[pair.margin_level_status] ?? pair.margin_level_status}`
                        : ''}
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:contents">
                    <Figure label="风险率" value={pair.margin_level?.toFixed(2) ?? '—'} />
                    <Figure label="指数价" value={price(pair.index_price)} />
                    <Figure label="强平价" value={price(pair.liquidation_price)} />
                    <Figure label="借款" value={liabilities.join(' / ') || '—'} />
                  </dl>
                </li>
              )
            })}
          </ul>
        </Module>
      )}

      {portfolio && (
        <Module
          figure={portfolio.uni_mmr === null ? '—' : portfolio.uni_mmr.toFixed(2)}
          note={`${portfolio.account_type ?? '未知类型'} · ${portfolio.account_status ?? '状态未知'}`}
          span="lg:col-span-12"
          title={portfolio.mode === 'span' ? '统一账户 Pro / SPAN' : '统一账户'}
        >
          <dl className="grid grid-cols-2 gap-x-10 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
            <Figure label="账户权益" value={money(portfolio.equity_usd)} />
            <Figure label="实际权益" value={money(portfolio.actual_equity_usd)} />
            <Figure label="起始保证金" value={money(portfolio.initial_margin_usd)} />
            <Figure label="维持保证金" value={money(portfolio.maint_margin_usd)} />
            <Figure label="可用余额" value={money(portfolio.available_balance_usd)} />
            <Figure label="最大可转出" value={money(portfolio.max_withdraw_usd)} />
          </dl>
          {portfolio.positions.length > 0 && (
            <ul className="mt-5 divide-y divide-rule border-t border-rule">
              {portfolio.positions.map((position) => (
                <li className="flex items-baseline justify-between gap-4 py-3 text-sm" key={`${position.symbol}:${position.position_side}`}>
                  <span className="text-ink">
                    {position.symbol}
                    <span className="ml-2 text-xs text-ink-3">
                      {position.position_amt >= 0 ? 'Long' : 'Short'} · {amount(Math.abs(position.position_amt))}
                    </span>
                  </span>
                  <span className="tnum text-ink-2">{money(position.notional_usd)}</span>
                </li>
              ))}
            </ul>
          )}
        </Module>
      )}
    </>
  )
}

function MarginAccountModule({ margin, liability, span, dense }: {
  margin: MarginAccount | null
  liability: number | null
  span: string
  /** 叠在窄栏里时只排两列——四列挤到 100px 宽，金额会被截 */
  dense?: boolean
}) {
  return (
    <Module
      figure={margin?.margin_level == null ? '—' : margin.margin_level.toFixed(2)}
      span={span}
      title="杠杆账户"
      tone={margin?.margin_level != null && margin.margin_level < 1.5 ? 'accent' : undefined}
    >
      {margin ? (
        <dl className={cn('grid grid-cols-2 gap-y-5', dense ? 'gap-x-8' : 'gap-x-10 sm:grid-cols-4')}>
          <Figure label="总资产" value={money(margin.total_asset_usd)} />
          <Figure label="负债" tone="loss" value={money(margin.total_liability_usd)} />
          <Figure label="净值" value={money(margin.total_net_asset_usd)} />
          <Figure label="负债率" value={percent(liability, 1)} />
        </dl>
      ) : <p className="text-sm text-ink-3">杠杆账户数据未取到。</p>}
    </Module>
  )
}
