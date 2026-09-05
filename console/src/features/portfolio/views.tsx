import { cn } from '../../lib/cn'
import { money, percent, signedMoney, SOURCE_LABEL, STABLE_ASSETS } from '../../lib/format'
import type { MarginAccount, PortfolioSnapshot } from '../../api/types'
import { Figure, Module, SplitBar, Stack, ViewGrid } from '../../components/layout'
import { RealizedDays } from './RealizedDays'
import { EarnTable, ParkedTable, SpotTable } from './Holdings'
import { PnlBreakdown } from './PnlBreakdown'

/** 合约 income 与 userTrades 都只保留 90 天，这是接口硬限 */
const WINDOW_DAYS = 90
import { PositionsList, RiskGauges } from './RiskPanel'
import { SourceHealth } from './SourceHealth'
import { WalletSpread } from './WalletSpread'

/**
 * 总览。这一节只放别处没有的东西：
 *   走势（时间维度）、钱包分布（空间维度）、风险判断（越线与否）、取数可信度。
 * 明细里的清单一律不在这里重复一份缩略版——那不是摘要，是把同一份内容印两遍。
 */
export function OverviewView({ snapshot, veiled, futuresMissing, concentration, onOpen }: {
  snapshot: PortfolioSnapshot
  veiled: boolean
  futuresMissing: boolean
  concentration: { asset: string; share: number } | null
  onOpen: (key: 'changes' | 'holdings' | 'perp') => void
}) {
  const pnl = snapshot.pnl
  const okCount = snapshot.sources.filter((source) => source.status === 'ok').length

  return (
    <div className={cn(veiled && 'veiled')}>
      <ViewGrid>
        {/* 不给 figure：它原先放的是 today_usd，而摘要条上那个「今日盈亏」
            就是同一个数——同一屏里说两遍。日历自己有月合计和区间合计。 */}
        <Module onOpen={() => onOpen('changes')} span="lg:col-span-8" title="每日盈亏">
          <RealizedDays days={pnl?.daily ?? []} />
        </Module>

        <Module onOpen={() => onOpen('holdings')} span="lg:col-span-4" title="资产分布">
          <WalletSpread veiled={false} wallets={snapshot.wallets} />
        </Module>

        <Module
          onOpen={() => onOpen('perp')}
          span="lg:col-span-5"
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
        {okCount < snapshot.sources.length && (
          <Module
            figure={`${snapshot.sources.length - okCount} 项缺失`}
            span="lg:col-span-7"
            title="下面的数字不完整"
            tone="muted"
          >
            <SourceHealth sources={snapshot.sources} />
          </Module>
        )}
      </ViewGrid>
    </div>
  )
}

export function ChangesView({ snapshot, veiled }: { snapshot: PortfolioSnapshot; veiled: boolean }) {
  const t = snapshot.transfers
  const pnl = snapshot.pnl
  const income = snapshot.income
  const grossFlow = t ? Math.max(t.deposits_usd, t.withdrawals_usd, 1) : 1
  // 成本口径：资金费与手续费都是负数流出，取绝对值当"成本"，与毛利同向比较
  const costs = income ? Math.abs(income.funding_fee) + Math.abs(income.commission) : null
  const grossProfit = income ? income.realized_pnl + income.referral_kickback : null

  return (
    <div className={cn(veiled && 'veiled')}>
      <ViewGrid>
        {/* 原先这里是"期末 − 期初 − 净充提"的归因表，未实现变动由残差反解——
            那个残差会把钱包间划转一起吸进来，所以它的"未实现变动"里混着充提。
            现在每一项都有出处：现货来自成交重放，合约来自 positionRisk 与 income。 */}
        <Module span="lg:col-span-7" title="盈亏构成">
          <PnlBreakdown pnl={pnl} />
        </Module>

        <Stack span="lg:col-span-5">
          <Module
            figure={t ? signedMoney(t.net_usd) : '—'}
            span=""
            title="充提"
            tone="accent"
          >
            {t ? (
              <>
                <ul className="space-y-3">
                  {([
                    ['充值', t.deposits_usd, t.deposit_count],
                    ['提现', t.withdrawals_usd, t.withdrawal_count],
                  ] as const).map(([label, value, count]) => (
                    <li className="flex items-center gap-3" key={label}>
                      <span className="w-[42px] shrink-0 text-xs text-ink-2">{label}</span>
                      <span className="h-[3px] w-[96px] shrink-0 overflow-hidden rounded-full bg-rule">
                        <span
                          className="block h-full rounded-full bg-accent/70 transition-[width] duration-500"
                          style={{ width: `${((value / grossFlow) * 100).toFixed(1)}%` }}
                        />
                      </span>
                      <span className="tnum ml-auto whitespace-nowrap text-sm text-ink">{money(value)}</span>
                      {/* 去掉"笔"之后这里剩个裸数字，读不出是什么。摘要条上有标签
                          （"条件单 5"）不需要单位，这里没有，用 ×n 表示次数 */}
                      <span className="tnum w-[36px] shrink-0 text-right text-xs text-ink-3">×{count}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : <p className="text-sm text-ink-3">充提记录取不到。</p>}
          </Module>

          <Module
            figure={costs === null ? '—' : signedMoney(-costs)}
            span=""
            title="成本"
            tone={costs === null ? 'muted' : 'loss'}
          >
            {income ? (
              <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
                <Figure label="毛利" tone="gain" value={signedMoney(grossProfit)} />
                <Figure
                  label="成本占毛利"
                  value={grossProfit && grossProfit > 0 && costs !== null ? percent(costs / grossProfit, 1) : '—'}
                />
                <Figure
                  label="日均资金费"
                  note={`${WINDOW_DAYS} 天`}
                  tone={income.funding_fee >= 0 ? 'gain' : 'loss'}
                  value={signedMoney(income.funding_fee / WINDOW_DAYS)}
                />
                <Figure label="返佣" tone="gain" value={signedMoney(income.referral_kickback)} />
              </dl>
            ) : <p className="text-sm text-ink-3">收支流水取不到（fapi 不可达时这一节没有数据）。</p>}
          </Module>
        </Stack>

        <Module span="lg:col-span-12" title="每日盈亏">
          <RealizedDays days={pnl?.daily ?? []} />
        </Module>
      </ViewGrid>
    </div>
  )
}

export function HoldingsView({ snapshot, veiled }: { snapshot: PortfolioSnapshot; veiled: boolean }) {
  const value = snapshot.spot.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)
  const at = (pick: (item: PortfolioSnapshot['spot'][number]) => number) =>
    snapshot.spot.reduce((sum, item) => sum + (item.price_usd ?? 0) * pick(item), 0)
  const onOrder = at((item) => item.locked)
  const frozen = at((item) => item.freeze)
  const withdrawing = at((item) => item.withdrawing)
  const unpriced = snapshot.spot.filter((item) => item.value_usd === null).length

  const earnValue = snapshot.earn.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)
  const rewards = snapshot.earn.reduce((sum, item) => sum + (item.cumulative_rewards_usd ?? 0), 0)
  const priced = snapshot.earn.filter((item) => item.value_usd !== null && item.apr !== null)
  const base = priced.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)
  const apr = base > 0
    ? priced.reduce((sum, item) => sum + (item.value_usd ?? 0) * (item.apr ?? 0), 0) / base
    : null
  const lockedEarn = snapshot.earn.filter((item) => item.kind === 'locked')
  const lockedValue = lockedEarn.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)

  // 合约与全仓杠杆钱包里躺着的币。稳定币不列——那是保证金，不是"持仓"
  const parked = [
    ...(snapshot.futures?.assets ?? []).map((row) => ({
      asset: row.asset, qty: row.wallet_balance, value_usd: row.value_usd, where: '合约',
    })),
    ...(snapshot.margin?.assets ?? []).map((row) => ({
      asset: row.asset, qty: row.net, value_usd: row.value_usd, where: '全仓杠杆',
    })),
  ].filter((row) => !STABLE_ASSETS.has(row.asset) && row.qty > 0)
   .sort((a, b) => (b.value_usd ?? 0) - (a.value_usd ?? 0))
  const parkedValue = parked.reduce((sum, row) => sum + (row.value_usd ?? 0), 0)

  return (
    <div className={cn(veiled && 'veiled')}>
      <ViewGrid>
        <Module
          figure={money(value)}
          note={`${snapshot.spot.length} 个币种`}
          span="lg:col-span-8"
          title="现货持仓"
        >
          <SpotTable spot={snapshot.spot} />
        </Module>

        <Stack span="lg:col-span-4">
          {/* 逐行的锁定原因在表里，这里给的是合计——两者不是同一个数 */}
          <Module
            figure={money(value - onOrder - frozen - withdrawing)}
            note={unpriced > 0 ? `${unpriced} 项无报价` : '现货可动用'}
            span=""
            title="可动用"
          >
            <SplitBar
              left={value - onOrder - frozen - withdrawing}
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

        <Module
          figure={money(earnValue)}
          note={`${snapshot.earn.length} 项`}
          span="lg:col-span-12"
          title="理财持仓"
        >
          <EarnTable earn={snapshot.earn} />
        </Module>

        {/* 划进合约当保证金 / 抵手续费的币，仍然是现货持仓，只是不在现货钱包里。
            这一节原先没有，于是"现货持仓"那张表里看不到它们，屏幕上就成了
            "现货数据取不到"——其实量一直都在，只是这一页没把它列出来。
            盈亏那边一直是按跨钱包持有量算的（`held_across_wallets`）。 */}
        {parked.length > 0 && (
          <Module
            figure={money(parkedValue)}
            // 同一个币可能同时在合约和杠杆里，按币种去重而不是数行数
            note={`${new Set(parked.map((row) => row.asset)).size} 个币种`}
            span="lg:col-span-12"
            title="合约中的现货持仓"
          >
            <ParkedTable rows={parked} />
          </Module>
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
  const m = snapshot.margin
  const longNotional = (f?.positions ?? [])
    .filter((p) => p.position_amt > 0).reduce((sum, p) => sum + p.notional_usd, 0)
  const shortNotional = (f?.positions ?? [])
    .filter((p) => p.position_amt < 0).reduce((sum, p) => sum + p.notional_usd, 0)
  const gross = longNotional + shortNotional
  const liability = m && m.total_asset_usd > 0 ? m.total_liability_usd / m.total_asset_usd : null

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
              {snapshot.sources.filter((source) => source.status !== 'ok').map((source) => (
                <li className="flex items-center gap-3 py-2.5" key={source.key}>
                  <span className="w-[84px] shrink-0 text-xs text-ink-2">
                    {SOURCE_LABEL[source.key] ?? source.key}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-3">{source.detail ?? '—'}</span>
                </li>
              ))}
            </ul>
          </Module>
          <MarginAccountModule liability={liability} margin={m} span="lg:col-span-5" />
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
                  <Figure label="最高杠杆" value={`${Math.max(...f.positions.map((p) => p.leverage))}×`} />
                </dl>
              </>
            ) : <p className="text-sm text-ink-3">当前没有合约敞口。</p>}
          </Module>

          <MarginAccountModule dense liability={liability} margin={m} span="" />
        </Stack>
      </ViewGrid>
    </div>
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
      ) : <p className="text-sm text-ink-3">杠杆账户数据取不到。</p>}
    </Module>
  )
}
