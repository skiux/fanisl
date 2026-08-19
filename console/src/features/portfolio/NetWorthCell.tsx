import { Delta, Eyebrow } from '../../components/Primitives'
import { cn } from '../../lib/cn'
import { money, signedMoney, signedPercent } from '../../lib/format'
import type { Attribution, PortfolioTotals, Transfers } from '../../api/types'

function splitMoney(value: number) {
  const text = money(value)
  const cut = text.lastIndexOf('.')
  return cut === -1 ? [text, ''] : [text.slice(0, cut), text.slice(cut)]
}

export function NetWorthCell({ totals, attribution, transfers, veiled }: {
  totals: PortfolioTotals | null
  attribution: Attribution | null
  transfers: Transfers | null
  veiled: boolean
}) {
  const [whole, cents] = totals ? splitMoney(totals.equity_usd) : ['—', '']
  const netTransfer = transfers?.net_usd ?? attribution?.net_transfer ?? null

  return (
    <div className={cn('flex flex-1 flex-col', veiled && 'veiled')}>
      <Eyebrow>净值 · Net asset value</Eyebrow>

      <div className="mt-2.5 flex items-baseline">
        <span className="tnum text-[2rem] font-medium leading-none tracking-[-0.03em] text-fg 2xl:text-hero">
          {whole}
        </span>
        <span className="tnum text-lg font-medium leading-none tracking-[-0.02em] text-fg-3 2xl:text-xl">
          {cents}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-1">
        {totals?.change_24h_usd == null ? (
          <span className="text-xs text-fg-3">没有昨日快照</span>
        ) : (
          <>
            <Delta className="text-sm font-medium" value={totals.change_24h_usd}>
              {signedMoney(totals.change_24h_usd)}
            </Delta>
            <Delta className="text-xs" value={totals.change_24h_pct}>
              {signedPercent(totals.change_24h_pct)}
            </Delta>
            <span className="text-xs text-fg-3">24h</span>
          </>
        )}
      </div>

      <dl className="mt-5 space-y-2 border-t border-line pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-xs text-fg-3">30 天真实盈亏</dt>
          <dd>
            {attribution ? (
              <Delta className="text-sm" value={attribution.true_pnl}>
                {signedMoney(attribution.true_pnl)}
              </Delta>
            ) : <span className="text-sm text-fg-3">—</span>}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-xs text-fg-3">净充提</dt>
          <dd className="tnum text-sm text-fg-2">
            {netTransfer === null ? '—' : signedMoney(netTransfer)}
          </dd>
        </div>
      </dl>
    </div>
  )
}
