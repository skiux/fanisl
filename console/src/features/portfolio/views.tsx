import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { money, percent, signedMoney, signedPercent } from '../../lib/format'
import type { PortfolioSnapshot } from '../../api/types'
import { EquityCurve } from './EquityCurve'
import { EarnTable, SpotTable } from './Holdings'
import { Reconciliation } from './Reconciliation'
import { PositionsList, RiskGauges } from './RiskPanel'
import { WalletSpread } from './WalletSpread'

/** 每个视图共用的抬头：标题 + 一句口径。明细区一次只显示一节。 */
function ViewHead({ title, note, aside }: { title: string; note: string; aside?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-rule pb-3">
      <div>
        <h2 className="section-title">{title}</h2>
        <p className="mt-1 text-xs text-ink-3">{note}</p>
      </div>
      {aside}
    </header>
  )
}

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

export function OverviewView({ snapshot, veiled, futuresMissing, concentration }: {
  snapshot: PortfolioSnapshot
  veiled: boolean
  futuresMissing: boolean
  concentration: { asset: string; share: number } | null
}) {
  const a = snapshot.attribution
  const totals = snapshot.totals
  return (
    <div className={cn(veiled && 'veiled')}>
      <ViewHead
        aside={<span className="tnum text-xs text-ink-3">30 天 · 日快照</span>}
        note="净值走势、本期结论与资产结构"
        title="总览"
      />

      <div className="flex h-[clamp(170px,26vh,240px)] flex-col">
        <EquityCurve points={snapshot.equity_curve} veiled={false} />
      </div>

      {a && (
        <p className="mt-7 max-w-[44ch] font-display text-xl leading-[1.55] text-ink">
          净值增加 <span className="tnum">{signedMoney(a.closing_equity - a.opening_equity)}</span>，
          其中 <span className="tnum text-accent">{signedMoney(a.net_transfer)}</span> 是转入的；
          实际赚了{' '}
          <span className={cn('tnum', a.true_pnl >= 0 ? 'text-gain' : 'text-loss')}>{signedMoney(a.true_pnl)}</span>。
        </p>
      )}

      <div className="mt-8 grid gap-8 border-t border-rule pt-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-12">
        <WalletSpread veiled={false} wallets={snapshot.wallets} />
        <dl className="grid grid-cols-2 gap-x-8 gap-y-5 lg:border-l lg:border-rule lg:pl-12">
          {snapshot.futures?.margin_ratio != null && (
            <Figure label="合约保证金率" note={snapshot.futures.margin_ratio < 0.5 ? '安全' : '偏紧'} value={percent(snapshot.futures.margin_ratio, 1)} />
          )}
          {totals?.gross_exposure_ratio != null && (
            <Figure label="真实杠杆" note="名义敞口 / 净值" value={`${totals.gross_exposure_ratio.toFixed(2)}×`} />
          )}
          {concentration && (
            <Figure label="最大单一持仓" note={concentration.asset} value={percent(concentration.share, 1)} />
          )}
          {futuresMissing && <Figure label="合约" value="取不到" />}
        </dl>
      </div>
    </div>
  )
}

export function ChangesView({ snapshot, veiled }: { snapshot: PortfolioSnapshot; veiled: boolean }) {
  const t = snapshot.transfers
  return (
    <div className={cn(veiled && 'veiled')}>
      <ViewHead
        aside={<span className="text-xs text-ink-3">窗口固定 30 天 · 受日快照接口所限</span>}
        note="期初到期末的逐项对账；充提是中性事件，不计入盈亏"
        title="本期变动"
      />
      <Reconciliation data={snapshot.attribution} veiled={false} />
      {t && (
        <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-rule pt-6 sm:grid-cols-4">
          <Figure label="充值" note={`${t.deposit_count} 笔`} value={money(t.deposits_usd)} />
          <Figure label="提现" note={`${t.withdrawal_count} 笔`} value={money(t.withdrawals_usd)} />
          <Figure label="净充提" value={signedMoney(t.net_usd)} />
          {snapshot.attribution && (
            <Figure
              label="真实收益率"
              note="剔除充提"
              tone={(snapshot.attribution.true_return ?? 0) >= 0 ? 'gain' : 'loss'}
              value={signedPercent(snapshot.attribution.true_return)}
            />
          )}
        </dl>
      )}
    </div>
  )
}

export function SpotView({ snapshot, veiled }: { snapshot: PortfolioSnapshot; veiled: boolean }) {
  const value = snapshot.spot.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)
  return (
    <div className={cn(veiled && 'veiled')}>
      <ViewHead
        aside={<span className="tnum text-base text-ink">{money(value)}</span>}
        note={`${snapshot.spot.length} 个币种 · 锁定原因分列，灰尘余额折在末尾`}
        title="现货持仓"
      />
      <SpotTable spot={snapshot.spot} />
    </div>
  )
}

export function EarnView({ snapshot, veiled }: { snapshot: PortfolioSnapshot; veiled: boolean }) {
  const value = snapshot.earn.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)
  const rewards = snapshot.earn.reduce((sum, item) => sum + (item.cumulative_rewards_usd ?? 0), 0)
  const priced = snapshot.earn.filter((item) => item.value_usd !== null && item.apr !== null)
  const base = priced.reduce((sum, item) => sum + (item.value_usd ?? 0), 0)
  const apr = base > 0
    ? priced.reduce((sum, item) => sum + (item.value_usd ?? 0) * (item.apr ?? 0), 0) / base
    : null
  return (
    <div className={cn(veiled && 'veiled')}>
      <ViewHead
        aside={<span className="tnum text-base text-ink">{money(value)}</span>}
        note="活期与定期分列；定期显示到期日与是否可提前赎回"
        title="理财持仓"
      />
      <EarnTable earn={snapshot.earn} />
      <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-rule pt-6 sm:grid-cols-3">
        <Figure label="加权年化" tone="gain" value={apr === null ? '—' : percent(apr, 2)} />
        <Figure label="累计收益" value={money(rewards)} />
        <Figure label="占净值" value={percent(snapshot.totals ? value / snapshot.totals.equity_usd : null, 1)} />
      </dl>
    </div>
  )
}

export function PerpView({ snapshot, veiled, futuresMissing }: {
  snapshot: PortfolioSnapshot
  veiled: boolean
  futuresMissing: boolean
}) {
  const f = snapshot.futures
  return (
    <div className={cn(veiled && 'veiled')}>
      <ViewHead
        aside={f && <span className={cn('tnum text-base', f.total_unrealized_pnl >= 0 ? 'text-gain' : 'text-loss')}>{signedMoney(f.total_unrealized_pnl)}</span>}
        note={f?.dual_side_position ? '双向持仓模式 · 同一合约可同时有多空两条' : '单向持仓模式'}
        title="合约仓位"
      />
      <PositionsList futures={f} unavailable={futuresMissing} />
      {f && (
        <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-rule pt-6 sm:grid-cols-4">
          <Figure label="保证金余额" value={money(f.total_margin_balance)} />
          <Figure label="维持保证金" value={money(f.total_maint_margin)} />
          <Figure label="可用余额" value={money(f.available_balance)} />
          <Figure label="钱包余额" value={money(f.total_wallet_balance)} />
        </dl>
      )}
    </div>
  )
}

export function RiskView({ snapshot, veiled, futuresMissing, concentration }: {
  snapshot: PortfolioSnapshot
  veiled: boolean
  futuresMissing: boolean
  concentration: { asset: string; share: number } | null
}) {
  const m = snapshot.margin
  return (
    <div className={cn(veiled && 'veiled')}>
      <ViewHead
        note="保证金率、真实杠杆与集中度；取不到的一律留空，不猜"
        title="风险"
      />
      {/* 两栏：仪表在左，读数在右。规则是每个视图要么整幅铺满、要么分两栏，
          不允许把内容压在左边、右边留一大片空——那只是把浪费从行内挪到页内。 */}
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14">
        <RiskGauges
          concentration={concentration}
          exposureRatio={snapshot.totals?.gross_exposure_ratio ?? null}
          futures={snapshot.futures}
          margin={m}
          unavailable={futuresMissing}
        />
        {m && (
          <dl className="grid grid-cols-2 gap-x-8 gap-y-5 self-start lg:border-l lg:border-rule lg:pl-14">
            <Figure label="杠杆账户总资产" value={money(m.total_asset_usd)} />
            <Figure label="杠杆账户负债" value={money(m.total_liability_usd)} />
            <Figure label="杠杆账户净值" value={money(m.total_net_asset_usd)} />
            {snapshot.futures && (
              <Figure label="维持保证金" value={money(snapshot.futures.total_maint_margin)} />
            )}
          </dl>
        )}
      </div>
    </div>
  )
}
