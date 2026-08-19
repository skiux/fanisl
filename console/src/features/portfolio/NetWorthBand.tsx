import type { CSSProperties } from 'react'
import { Delta, Eyebrow } from '../../components/Primitives'
import { cn } from '../../lib/cn'
import { money, signedMoney, signedPercent } from '../../lib/format'
import type { Attribution, PortfolioTotals, Transfers } from '../../api/types'
import { EquityCurve } from './EquityCurve'
import type { EquityPoint } from '../../api/types'

function splitMoney(value: number) {
  const text = money(value)
  const cut = text.lastIndexOf('.')
  return cut === -1 ? [text, ''] : [text.slice(0, cut), text.slice(cut)]
}

export function NetWorthBand({ totals, curve, attribution, transfers, veiled }: {
  totals: PortfolioTotals | null
  curve: EquityPoint[]
  attribution: Attribution | null
  transfers: Transfers | null
  veiled: boolean
}) {
  // 净充提只依赖充提记录。归因算不出来时它仍然该显示——
  // 合约挂了不代表我们不知道自己转了多少钱进来。
  const netTransfer = transfers?.net_usd ?? attribution?.net_transfer ?? null
  const [whole, cents] = totals ? splitMoney(totals.equity_usd) : ['—', '']

  return (
    <section
      className="rise grid gap-10 lg:grid-cols-[1.25fr_1fr] lg:items-end lg:gap-16"
      style={{ '--i': 0 } as CSSProperties}
    >
      <div className={cn(veiled && 'veiled')}>
        <Eyebrow>净值 · Net asset value</Eyebrow>

        <div className="mt-3 flex items-baseline">
          <span className="tnum text-[2rem] font-medium leading-none tracking-[-0.03em] text-fg sm:text-hero">
            {whole}
          </span>
          <span className="tnum text-xl font-medium leading-none tracking-[-0.02em] text-fg-3">
            {cents}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          {totals?.change_24h_usd == null ? (
            <span className="text-xs text-fg-3">没有昨日快照，无法给出 24 小时变化</span>
          ) : (
            <>
              <Delta className="text-base font-medium" value={totals.change_24h_usd}>
                {signedMoney(totals.change_24h_usd)}
              </Delta>
              <Delta className="text-sm" value={totals.change_24h_pct}>
                {signedPercent(totals.change_24h_pct)}
              </Delta>
              <span className="text-xs text-fg-3">近 24 小时</span>
            </>
          )}
        </div>

        <dl className="mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-panel)] bg-line sm:grid-cols-3">
          <div className="bg-bg px-4 py-3">
            <dt className="text-xs text-fg-3">30 天真实盈亏</dt>
            <dd className="mt-1.5">
              {attribution ? (
                <Delta className="text-base" value={attribution.true_pnl}>
                  {signedMoney(attribution.true_pnl)}
                </Delta>
              ) : <span className="text-base text-fg-3">—</span>}
            </dd>
          </div>
          <div className="bg-bg px-4 py-3">
            <dt className="text-xs text-fg-3">净充提</dt>
            <dd className="tnum mt-1.5 text-base text-fg-2">
              {netTransfer === null ? '—' : signedMoney(netTransfer)}
            </dd>
          </div>
          <div className="col-span-2 bg-bg px-4 py-3 sm:col-span-1">
            <dt className="text-xs text-fg-3">名义敞口</dt>
            <dd className="tnum mt-1.5 text-base text-fg-2">
              {totals?.gross_exposure_ratio == null ? '—' : `${totals.gross_exposure_ratio.toFixed(2)}×`}
            </dd>
          </div>
        </dl>
      </div>

      <EquityCurve points={curve} veiled={veiled} />
    </section>
  )
}
