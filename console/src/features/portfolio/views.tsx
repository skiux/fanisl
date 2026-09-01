import { cn } from '../../lib/cn'
import { money, percent, signedMoney, SOURCE_LABEL } from '../../lib/format'
import type { MarginAccount, PortfolioSnapshot } from '../../api/types'
import { Figure, Module, SplitBar, Stack, ViewGrid } from '../../components/layout'
import { DailyChange } from './DailyChange'
import { EquityCurve } from './EquityCurve'
import { EarnTable, SpotTable } from './Holdings'
import { Reconciliation } from './Reconciliation'
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
  const a = snapshot.attribution
  const okCount = snapshot.sources.filter((source) => source.status === 'ok').length

  return (
    <div className={cn(veiled && 'veiled')}>
      <ViewGrid>
        <Module note="30 天 · 日快照" onOpen={() => onOpen('changes')} span="lg:col-span-8" title="净值走势">
          <div className="flex h-[clamp(170px,26vh,260px)] flex-col">
            <EquityCurve points={snapshot.equity_curve} veiled={false} />
          </div>
          {a && (
            <p className="mt-5 font-display text-lg leading-[1.5] text-ink">
              净值增加 <span className="tnum">{signedMoney(a.closing_equity - a.opening_equity)}</span>，
              其中 <span className="tnum text-accent">{signedMoney(a.net_transfer)}</span> 是转入的；
              实际赚了 <span className={cn('tnum', a.true_pnl >= 0 ? 'text-gain' : 'text-loss')}>{signedMoney(a.true_pnl)}</span>。
            </p>
          )}
        </Module>

        <Module note="钱在哪个钱包" onOpen={() => onOpen('holdings')} span="lg:col-span-4" title="资产分布">
          <WalletSpread veiled={false} wallets={snapshot.wallets} />
        </Module>

        <Module
          note="越线才需要处理"
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

        <Module
          figure={`${okCount} / ${snapshot.sources.length}`}
          note="留空的是哪一项"
          span="lg:col-span-7"
          title="取数状态"
          tone={okCount === snapshot.sources.length ? undefined : 'muted'}
        >
          <SourceHealth sources={snapshot.sources} />
        </Module>
      </ViewGrid>
    </div>
  )
}

export function ChangesView({ snapshot, veiled }: { snapshot: PortfolioSnapshot; veiled: boolean }) {
  const t = snapshot.transfers
  const a = snapshot.attribution
  const income = snapshot.income
  const grossFlow = t ? Math.max(t.deposits_usd, t.withdrawals_usd, 1) : 1
  // 成本口径：资金费与手续费都是负数流出，取绝对值当"成本"，与毛利同向比较
  const costs = income ? Math.abs(income.funding_fee) + Math.abs(income.commission) : null
  const grossProfit = income ? income.realized_pnl + income.referral_kickback : null

  return (
    <div className={cn(veiled && 'veiled')}>
      <ViewGrid>
        <Module note="期初到期末逐项对账" span="lg:col-span-7" title="本期变动">
          <Reconciliation data={a} veiled={false} />
        </Module>

        <Stack span="lg:col-span-5">
          <Module
            figure={t ? signedMoney(t.net_usd) : '—'}
            note="中性事件，不计入盈亏"
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
                      <span className="tnum w-[36px] shrink-0 text-right text-xs text-ink-3">{count} 笔</span>
                    </li>
                  ))}
                </ul>
                <dl className="mt-4 border-t border-rule pt-4">
                  <Figure
                    label="占期初净值"
                    note="涨幅里自己充的部分"
                    value={a && a.opening_equity > 0 ? percent(t.net_usd / a.opening_equity, 1) : '—'}
                  />
                </dl>
              </>
            ) : <p className="text-sm text-ink-3">充提记录取不到。</p>}
          </Module>

          <Module
            figure={costs === null ? '—' : signedMoney(-costs)}
            note="资金费 + 手续费"
            span=""
            title="成本"
            tone={costs === null ? 'muted' : 'loss'}
          >
            {income && a ? (
              <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
                <Figure label="毛利" tone="gain" value={signedMoney(grossProfit)} />
                <Figure
                  label="成本占毛利"
                  value={grossProfit && grossProfit > 0 && costs !== null ? percent(costs / grossProfit, 1) : '—'}
                />
                <Figure
                  label="日均资金费"
                  note={`${a.window_days} 天`}
                  tone={income.funding_fee >= 0 ? 'gain' : 'loss'}
                  value={signedMoney(income.funding_fee / a.window_days)}
                />
                <Figure label="返佣" tone="gain" value={signedMoney(income.referral_kickback)} />
              </dl>
            ) : <p className="text-sm text-ink-3">收支流水取不到（fapi 不可达时这一节没有数据）。</p>}
          </Module>
        </Stack>

        <Module note="日快照差分 · 含充提" span="lg:col-span-12" title="逐日变化">
          <DailyChange points={snapshot.equity_curve} />
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
            note="理财加权年化"
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
          <Module note="仓位 · 保证金 · 敞口同源" span="lg:col-span-7" title="合约账户不可用">
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
          note={`${f.positions.length} 笔 · ${f.dual_side_position ? '双向' : '单向'}持仓`}
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
              <Figure label="钱包余额" note="不含未实现" value={money(f.total_wallet_balance)} />
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
      note="风险率 · 预警 1.30 · 强平 1.10"
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
