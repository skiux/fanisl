import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { money, percent, signedMoney, signedPercent } from '../../lib/format'
import type { PortfolioSnapshot } from '../../api/types'
import { EquityCurve } from './EquityCurve'
import { Module } from './Module'
import { EarnTable, SpotTable } from './Holdings'
import { Reconciliation } from './Reconciliation'
import { PositionsList, RiskGauges } from './RiskPanel'
import { WalletSpread } from './WalletSpread'

function Figure({ label, value, tone, note }: {
  label: string
  value: string
  tone?: 'gain' | 'loss'
  note?: string
}) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-1.5 flex items-baseline gap-2">
        <span className={cn('tnum text-lg', tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-ink')}>
          {value}
        </span>
        {note && <span className="text-xs text-ink-3">{note}</span>}
      </dd>
    </div>
  )
}

export function OverviewView({ snapshot, veiled, futuresMissing, concentration, onOpen }: {
  snapshot: PortfolioSnapshot
  veiled: boolean
  futuresMissing: boolean
  concentration: { asset: string; share: number } | null
  onOpen: (key: 'changes' | 'holdings' | 'perp') => void
}) {
  const a = snapshot.attribution
  const totals = snapshot.totals
  const f = snapshot.futures
  const spotValue = snapshot.spot.reduce((sum, i) => sum + (i.value_usd ?? 0), 0)
  const earnValue = snapshot.earn.reduce((sum, i) => sum + (i.value_usd ?? 0), 0)
  const earnRewards = snapshot.earn.reduce((sum, i) => sum + (i.cumulative_rewards_usd ?? 0), 0)

  return (
    /* 12 栏栅格：图表占 7 栏（天生要宽），仪表占 5 栏（天生窄），并排拼满。
       不同天然宽度的模块互相填空，没有被拉长的行，也没有右侧的空白带。 */
    <div className={cn('grid grid-cols-1 gap-x-12 gap-y-9 lg:grid-cols-12', veiled && 'veiled')}>
      <Module note="30 天 · 日快照" span="lg:col-span-7" title="净值走势">
        <div className="flex h-[clamp(150px,20vh,210px)] flex-col">
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

      <Module
        figure={f?.margin_ratio == null ? '—' : percent(f.margin_ratio, 1)}
        onOpen={() => onOpen('perp')}
        span="lg:col-span-5"
        title="风险"
        tone={f?.margin_ratio == null ? 'muted' : undefined}
      >
        <RiskGauges
          concentration={concentration}
          exposureRatio={totals?.gross_exposure_ratio ?? null}
          futures={f}
          margin={snapshot.margin}
          unavailable={futuresMissing}
        />
      </Module>

      <Module
        figure={a ? signedMoney(a.true_pnl) : '—'}
        note="30 天"
        onOpen={() => onOpen('changes')}
        span="lg:col-span-7"
        title="本期变动"
        tone={a ? (a.true_pnl >= 0 ? 'gain' : 'loss') : 'muted'}
      >
        <Reconciliation data={a} veiled={false} />
      </Module>

      <Module figure={money(totals?.equity_usd ?? 0)} span="lg:col-span-5" title="资产分布">
        <WalletSpread veiled={false} wallets={snapshot.wallets} />
      </Module>

      <Module
        figure={money(spotValue)}
        note={`前 5 项 / 共 ${snapshot.spot.length}`}
        onOpen={() => onOpen('holdings')}
        span="lg:col-span-7"
        title="现货持仓"
      >
        <SpotTable limit={5} spot={snapshot.spot} />
      </Module>

      <div className="flex flex-col gap-9 lg:col-span-5">
        <Module
          figure={money(earnValue)}
          note={`${snapshot.earn.length} 项`}
          onOpen={() => onOpen('holdings')}
          span=""
          title="理财"
        >
          <dl className="grid grid-cols-2 gap-x-8 gap-y-4">
            <Figure label="累计收益" value={money(earnRewards)} />
            <Figure
              label="占净值"
              value={percent(totals ? earnValue / totals.equity_usd : null, 1)}
            />
          </dl>
        </Module>

        <Module
          figure={futuresMissing ? '—' : signedMoney(f?.total_unrealized_pnl ?? 0)}
          note={futuresMissing ? '不可用' : `${f?.positions.length ?? 0} 笔`}
          onOpen={() => onOpen('perp')}
          span=""
          title="合约"
          tone={futuresMissing ? 'muted' : (f?.total_unrealized_pnl ?? 0) >= 0 ? 'gain' : 'loss'}
        >
          {futuresMissing || !f ? (
            <p className="text-sm text-ink-3">合约数据本次没有取到。</p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-8 gap-y-4">
              <Figure label="保证金余额" value={money(f.total_margin_balance)} />
              <Figure label="可用余额" value={money(f.available_balance)} />
            </dl>
          )}
        </Module>
      </div>
    </div>
  )
}

/** 明细视图统一用同一套 12 栏模块网格——总览拼合、明细整块，是这基座上剩下的结构不一致 */
function ViewGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-x-12 gap-y-9 lg:grid-cols-12">{children}</div>
}

export function ChangesView({ snapshot, veiled }: { snapshot: PortfolioSnapshot; veiled: boolean }) {
  const t = snapshot.transfers
  const a = snapshot.attribution
  const income = snapshot.income
  const incomeScale = income
    ? Math.max(...[income.realized_pnl, income.funding_fee, income.commission,
      income.referral_kickback, income.insurance_clear].map(Math.abs), 1)
    : 0
  return (
    <div className={cn(veiled && 'veiled')}>
      <ViewGrid>
        <Module
          figure={a ? signedMoney(a.true_pnl) : '—'}
          note="期初到期末逐项对账"
          span="lg:col-span-7"
          title="本期变动"
          tone={a ? (a.true_pnl >= 0 ? 'gain' : 'loss') : 'muted'}
        >
          <Reconciliation data={a} veiled={false} />
        </Module>

        <Module
          figure={t ? signedMoney(t.net_usd) : '—'}
          note="中性事件，不计入盈亏"
          span="lg:col-span-5"
          title="充提"
          tone="accent"
        >
          {t ? (
            <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
              <Figure label="充值" note={`${t.deposit_count} 笔`} value={money(t.deposits_usd)} />
              <Figure label="提现" note={`${t.withdrawal_count} 笔`} value={money(t.withdrawals_usd)} />
              {a && (
                <Figure
                  label="真实收益率"
                  note="剔除充提"
                  tone={(a.true_return ?? 0) >= 0 ? 'gain' : 'loss'}
                  value={signedPercent(a.true_return)}
                />
              )}
              <Figure label="期初净值" value={money(a?.opening_equity ?? 0)} />
            </dl>
          ) : <p className="text-sm text-ink-3">充提记录取不到。</p>}
        </Module>

        <Module
          figure={income ? signedMoney(income.realized_pnl + income.funding_fee + income.commission + income.insurance_clear + income.referral_kickback) : '—'}
          note="按 incomeType 拆分"
          span="lg:col-span-12"
          title="收支构成"
        >
          {income ? (
            <ul className="grid gap-x-12 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
              {([
                ['已实现盈亏', income.realized_pnl],
                ['资金费', income.funding_fee],
                ['手续费', income.commission],
                ['返佣', income.referral_kickback],
                ['保险清算', income.insurance_clear],
              ] as const).filter(([, v]) => v !== 0).map(([label, value]) => {
                const ratio = incomeScale > 0 ? Math.min(1, Math.abs(value) / incomeScale) : 0
                return (
                  <li className="flex items-center gap-3 border-b border-rule py-2.5" key={label}>
                    <span className="w-[72px] shrink-0 text-xs text-ink-2">{label}</span>
                    <span aria-hidden="true" className="relative block h-[9px] w-[96px] shrink-0">
                      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-rule-strong" />
                      <span
                        className={cn('absolute top-1/2 h-[7px] -translate-y-1/2 rounded-[1px]',
                          value >= 0 ? 'bg-gain/70' : 'bg-loss/70')}
                        style={value >= 0
                          ? { left: '50%', width: `${Math.max(ratio * 50, 1.6).toFixed(2)}%` }
                          : { right: '50%', width: `${Math.max(ratio * 50, 1.6).toFixed(2)}%` }}
                      />
                    </span>
                    <span className={cn('tnum ml-auto whitespace-nowrap text-sm',
                      value >= 0 ? 'text-gain' : 'text-loss')}>
                      {signedMoney(value)}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : <p className="text-sm text-ink-3">收支流水取不到（fapi 不可达时这一节没有数据）。</p>}
        </Module>
      </ViewGrid>
    </div>
  )
}

export function HoldingsView({ snapshot, veiled }: { snapshot: PortfolioSnapshot; veiled: boolean }) {
  const value = snapshot.spot.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)
  const locked = snapshot.spot.reduce((sum, i) => sum + (i.price_usd ?? 0) * (i.locked + i.freeze + i.withdrawing), 0)
  const dust = snapshot.spot.filter((i) => (i.value_usd ?? 0) < 25)
  const dustValue = dust.reduce((sum, i) => sum + (i.value_usd ?? 0), 0)
  const unpriced = snapshot.spot.filter((i) => i.value_usd === null).length
  return (
    <div className={cn(veiled && 'veiled')}>
      <ViewGrid>
        <Module figure={money(value)} note={`${snapshot.spot.length} 个币种`} span="lg:col-span-8" title="现货持仓">
          <SpotTable spot={snapshot.spot} />
        </Module>
        <Module note="动不了的钱与读不出的价" span="lg:col-span-4" title="锁定与灰尘">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
            <Figure label="锁定合计" note="挂单·冻结·提现中" value={money(locked)} />
            <Figure label="可动用" value={money(value - locked)} />
            <Figure label="灰尘余额" note={`${dust.length} 项`} value={money(dustValue)} />
            <Figure label="无报价" note="不计入合计" value={`${unpriced} 项`} />
          </dl>
        </Module>
        <EarnBlocks snapshot={snapshot} />
      </ViewGrid>
    </div>
  )
}

function EarnBlocks({ snapshot }: { snapshot: PortfolioSnapshot }) {
  const value = snapshot.earn.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)
  const rewards = snapshot.earn.reduce((sum, item) => sum + (item.cumulative_rewards_usd ?? 0), 0)
  const priced = snapshot.earn.filter((item) => item.value_usd !== null && item.apr !== null)
  const base = priced.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)
  const apr = base > 0
    ? priced.reduce((sum, item) => sum + (item.value_usd ?? 0) * (item.apr ?? 0), 0) / base
    : null
  const locked = snapshot.earn.filter((i) => i.kind === 'locked')
  return (
    <>
        <Module figure={money(value)} note={`${snapshot.earn.length} 项`} span="lg:col-span-7" title="理财持仓">
          <EarnTable earn={snapshot.earn} />
        </Module>
        <Module figure={apr === null ? '—' : percent(apr, 2)} note="加权年化" span="lg:col-span-5" title="收益" tone="gain">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
            <Figure label="累计收益" value={money(rewards)} />
            <Figure label="占净值" value={percent(snapshot.totals ? value / snapshot.totals.equity_usd : null, 1)} />
            <Figure label="活期" value={money(value - locked.reduce((s, i) => s + (i.value_usd ?? 0), 0))} />
            <Figure label="定期" note={`${locked.length} 项`} value={money(locked.reduce((s, i) => s + (i.value_usd ?? 0), 0))} />
          </dl>
        </Module>
    </>
  )
}

export function PerpRiskView({ snapshot, veiled, futuresMissing, concentration }: {
  snapshot: PortfolioSnapshot
  veiled: boolean
  futuresMissing: boolean
  concentration: { asset: string; share: number } | null
}) {
  const f = snapshot.futures
  return (
    <div className={cn(veiled && 'veiled')}>
      <ViewGrid>
        <Module
          figure={f ? signedMoney(f.total_unrealized_pnl) : '—'}
          note={f?.dual_side_position ? '双向持仓模式' : '单向持仓模式'}
          span="lg:col-span-8"
          title="合约仓位"
          tone={futuresMissing ? 'muted' : (f?.total_unrealized_pnl ?? 0) >= 0 ? 'gain' : 'loss'}
        >
          <PositionsList futures={f} unavailable={futuresMissing} />
        </Module>
        <Module
          figure={f?.margin_ratio == null ? '—' : percent(f.margin_ratio, 1)}
          note="保证金率"
          span="lg:col-span-4"
          title="保证金"
        >
          {f ? (
            <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
              <Figure label="保证金余额" value={money(f.total_margin_balance)} />
              <Figure label="维持保证金" value={money(f.total_maint_margin)} />
              <Figure label="可用余额" value={money(f.available_balance)} />
              <Figure label="钱包余额" value={money(f.total_wallet_balance)} />
            </dl>
          ) : <p className="text-sm text-ink-3">合约数据本次没有取到。</p>}
        </Module>
        <RiskBlocks concentration={concentration} futuresMissing={futuresMissing} snapshot={snapshot} />
      </ViewGrid>
    </div>
  )
}

function RiskBlocks({ snapshot, futuresMissing, concentration }: {
  snapshot: PortfolioSnapshot
  futuresMissing: boolean
  concentration: { asset: string; share: number } | null
}) {
  const m = snapshot.margin
  return (
    <>
        <Module
          figure={snapshot.futures?.margin_ratio == null ? '—' : percent(snapshot.futures.margin_ratio, 1)}
          note="取不到的一律留空，不猜"
          span="lg:col-span-6"
          title="风险仪表"
        >
          <RiskGauges
            concentration={concentration}
            exposureRatio={snapshot.totals?.gross_exposure_ratio ?? null}
            futures={snapshot.futures}
            margin={m}
            unavailable={futuresMissing}
          />
        </Module>
        <Module
          figure={m?.margin_level == null ? '—' : m.margin_level.toFixed(2)}
          note="杠杆账户风险率"
          span="lg:col-span-6"
          title="杠杆账户"
          tone={m?.margin_level != null && m.margin_level < 1.5 ? 'accent' : undefined}
        >
          {m ? (
            <dl className="grid grid-cols-2 gap-x-8 gap-y-5">
              <Figure label="总资产" value={money(m.total_asset_usd)} />
              <Figure label="负债" value={money(m.total_liability_usd)} />
              <Figure label="净值" value={money(m.total_net_asset_usd)} />
              {snapshot.futures && <Figure label="维持保证金" value={money(snapshot.futures.total_maint_margin)} />}
            </dl>
          ) : <p className="text-sm text-ink-3">杠杆账户数据取不到。</p>}
        </Module>
    </>
  )
}
