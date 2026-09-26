import { cn } from '../../lib/cn'
import type { SpotCostInput, StockCostInput } from '../../api/client'
import { amount, money, percent, price, signedMoney, SOURCE_LABEL } from '../../lib/format'
import { cash, spotHoldings } from '../../lib/holdings'
import type { MarginAccount, PortfolioSnapshot } from '../../api/types'
import { Figure, Module, SplitBar, Stack, ViewGrid } from '../../components/layout'
import { RealizedDays } from './RealizedDays'
import {
  CashTable, EarnTable, SpotTable,
} from './Holdings'
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
import { PositionsList, RiskGauges } from './RiskPanel'
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
export function OverviewView({ snapshot, veiled, futuresMissing, concentration, onOpen }: {
  snapshot: PortfolioSnapshot
  veiled: boolean
  futuresMissing: boolean
  concentration: { asset: string; share: number } | null
  onOpen: (key: 'holdings' | 'perp') => void
}) {
  const pnl = snapshot.pnl
  const cashRows = cash(snapshot)
  const relevantSources = snapshot.sources.filter((source) => source.status !== 'unsupported')
  const missingCount = relevantSources.filter((source) => source.status !== 'ok').length

  return (
    <div className={cn(veiled && 'veiled')}>
      <ViewGrid>
        {/* 不给 figure：它原先放的是 today_usd，而摘要条上那个「今日盈亏」
            就是同一个数——同一屏里说两遍。日历自己有月合计和区间合计。 */}
        <Module span={cashRows.length > 0 ? 'lg:col-span-7' : 'lg:col-span-12'} title="每日盈亏">
          <RealizedDays days={pnl?.daily ?? []} />
        </Module>

        {cashRows.length > 0 && (
          <CashModule rows={cashRows} snapshot={snapshot} span="lg:col-span-5" />
        )}

        {/* 四行同一个窗口、同一个来源，条形才可比——旧的「盈亏构成」把 1 天、
            此刻、全历史、90 天四种窗口混在一张表里画对比条，见 PnlBreakdown。
            现货那半边归日历（那里才有区间概念）。 */}
        <Module note={`${WINDOW_DAYS} 天`} span="lg:col-span-8" title="合约收支">
          <PnlBreakdown pnl={pnl} />
        </Module>

        <Module
          onOpen={() => onOpen('perp')}
          span="lg:col-span-4"
          title="风险仪表"
        >
          <RiskGauges
            concentration={concentration}
            exposureRatio={snapshot.totals?.gross_exposure_ratio ?? null}
            futures={snapshot.futures}
            margin={snapshot.margin}
            unavailable={futuresMissing}
          />
        </Module>

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

  return (
    <Module figure={money(total)} note={`${rows.length} 项`} span={span} title="现金">
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
  const spotValue = snapshot.spot.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)
  const at = (pick: (item: PortfolioSnapshot['spot'][number]) => number) =>
    snapshot.spot.reduce((sum, item) => sum + (item.price_usd ?? 0) * pick(item), 0)
  const onOrder = at((item) => item.locked)
  const frozen = at((item) => item.freeze)
  const withdrawing = at((item) => item.withdrawing)
  const unpriced = snapshot.spot.filter((item) => item.value_usd === null).length
  const stockPositions = snapshot.stocks.positions
  const unresolvedStocks = snapshot.stocks.tokenized_assets
    .filter((row) => !row.multiplier_valid)
  const stockCount = stockPositions.length + unresolvedStocks.length
  const stockPnlRows = stockPositions.filter((row) => row.unrealized_pnl_usd !== null)
  const stockPnl = stockPnlRows.reduce((sum, row) => sum + (row.unrealized_pnl_usd ?? 0), 0)
  const stockPnlComplete = stockCount > 0
    && unresolvedStocks.length === 0
    && stockPnlRows.length === stockPositions.length

  const earnValue = snapshot.earn.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)
  const rewards = snapshot.earn.reduce((sum, item) => sum + (item.cumulative_rewards_usd ?? 0), 0)
  const priced = snapshot.earn.filter((item) => item.value_usd !== null && item.apr !== null)
  const base = priced.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)
  const apr = base > 0
    ? priced.reduce((sum, item) => sum + (item.value_usd ?? 0) * (item.apr ?? 0), 0) / base
    : null
  const lockedEarn = snapshot.earn.filter((item) => item.kind === 'locked')
  const lockedValue = lockedEarn.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)

  return (
    <div className={cn(veiled && 'veiled')}>
      <ViewGrid>
        <Module
          figure={money(holdingsValue)}
          note={`${holdings.length} 个币种`}
          span="lg:col-span-8"
          title="现货持仓"
        >
          <SpotTable
            canEditCost={isAdmin && Boolean(onSaveSpotCost) && !veiled}
            onSaveCost={onSaveSpotCost} spot={holdings}
          />
        </Module>

        <Stack span="lg:col-span-4">
          {/* 逐行的锁定原因在表里，这里给的是合计——两者不是同一个数 */}
          <Module
            figure={money(spotValue - onOrder - frozen - withdrawing)}
            note={unpriced > 0 ? `${unpriced} 项无报价` : '现货可动用'}
            span=""
            title="现货钱包可用"
          >
            <SplitBar
              left={spotValue - onOrder - frozen - withdrawing}
              leftLabel="可动用"
              right={onOrder + frozen + withdrawing}
              rightLabel="锁定"
            />
            <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
              <Figure label="挂单占用" value={money(onOrder)} />
              <Figure label="风控冻结" value={money(frozen)} />
              <Figure label="提现处理中" value={money(withdrawing)} />
              <Figure label="锁定合计" value={money(onOrder + frozen + withdrawing)} />
            </dl>
          </Module>

          <Module
            figure={apr === null ? '—' : percent(apr, 2)}
            span=""
            title="理财收益"
            tone="gain"
          >
            <SplitBar
              left={earnValue - lockedValue}
              leftLabel="活期"
              right={lockedValue}
              rightLabel="定期"
            />
            <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
              <Figure label="累计收益" value={money(rewards)} />
              <Figure
                label="占净值"
                value={percent(snapshot.totals ? earnValue / snapshot.totals.equity_usd : null, 1)}
              />
              <Figure label="活期" value={money(earnValue - lockedValue)} />
              <Figure label="定期" note={`${lockedEarn.length} 项`} value={money(lockedValue)} />
            </dl>
          </Module>
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

        <Module
          figure={money(earnValue)}
          note={`${snapshot.earn.length} 项`}
          span="lg:col-span-12"
          title="理财持仓"
        >
          <EarnTable earn={snapshot.earn} />
        </Module>

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
  const m = snapshot.margin
  const longNotional = (f?.positions ?? [])
    .filter((p) => p.position_amt > 0).reduce((sum, p) => sum + p.notional_usd, 0)
  const shortNotional = (f?.positions ?? [])
    .filter((p) => p.position_amt < 0).reduce((sum, p) => sum + p.notional_usd, 0)
  const gross = longNotional + shortNotional
  // 真实杠杆 = 名义敞口 / 保证金余额。**两个操作数都在这一页上**——名义敞口是
  // 「多空敞口」的读数，保证金余额是「保证金」的读数，看得见也验得了。
  // 合约的杠杆设置（那个 20×）只是开仓上限，不代表现在扛着多少倍。
  const realLeverage = f && f.total_margin_balance > 0 ? gross / f.total_margin_balance : null
  const liability = m && m.total_asset_usd > 0 ? m.total_liability_usd / m.total_asset_usd : null
  const marginEnabled = snapshot.sources.find((source) => source.key === 'margin')?.status !== 'unsupported'

  if (futuresMissing || !f) {
    return (
      <div className={cn(veiled && 'veiled')}>
        <ViewGrid>
          <Module span="lg:col-span-7" title="合约账户不可用">
            <p className="max-w-[52ch] text-sm leading-relaxed text-ink-2">
              仓位、保证金与多空敞口都出自同一组 fapi 接口，这次一起没取到。
              这里不拿上一次的数字顶替，也不用 0 充数。
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
          {marginEnabled && (
            <MarginAccountModule liability={liability} margin={m} span="lg:col-span-5" />
          )}
          <AdditionalRiskModules snapshot={snapshot} />
        </ViewGrid>
      </div>
    )
  }

  return (
    <div className={cn(veiled && 'veiled')}>
      <ViewGrid>
        <Module
          figure={signedMoney(f.total_unrealized_pnl)}
          note={`${f.positions.length} 个仓位 · ${f.dual_side_position ? '双向' : '单向'}`}
          span="lg:col-span-8"
          title="合约仓位"
          tone={f.total_unrealized_pnl >= 0 ? 'gain' : 'loss'}
        >
          <PositionsList futures={f} unavailable={false} />
        </Module>

        <Stack span="lg:col-span-4">
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
            note="名义总敞口"
            span=""
            title="多空敞口"
          >
            {gross > 0 ? (
              <>
                <SplitBar
                  left={longNotional}
                  leftLabel="多头"
                  right={shortNotional}
                  rightLabel="空头"
                  tone="pnl"
                />
                <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
                  <Figure label="多头名义" tone="gain" value={money(longNotional)} />
                  <Figure label="空头名义" tone="loss" value={money(shortNotional)} />
                  <Figure
                    label="净敞口"
                    note={longNotional >= shortNotional ? '偏多' : '偏空'}
                    value={signedMoney(longNotional - shortNotional)}
                  />
                  {/* 逐仓那个 20× 是开仓上限，每一行自己已经写着；这里要的是
                      "这笔保证金实际扛着多少倍"，扫十行也看不出来。 */}
                  <Figure
                    label="真实杠杆"
                    value={realLeverage === null ? '—' : `${realLeverage.toFixed(2)}×`}
                  />
                </dl>
              </>
            ) : <p className="text-sm text-ink-3">当前没有合约敞口。</p>}
          </Module>

          {marginEnabled && <MarginAccountModule dense liability={liability} margin={m} span="" />}
        </Stack>
        <AdditionalRiskModules snapshot={snapshot} />
      </ViewGrid>
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
          title="逐仓杠杆"
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
