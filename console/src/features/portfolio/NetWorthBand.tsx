import type { CSSProperties } from 'react'
import { ArrowsClockwise, WarningOctagon } from '@phosphor-icons/react'
import { Delta, Eyebrow, StatusDot } from '../../components/Primitives'
import { cn } from '../../lib/cn'
import {
  clockTime, freshnessOf, money, relativeTime, signedMoney, signedPercent,
} from '../../lib/format'
import type { PortfolioSnapshot, VenueState } from '../../api/types'

const VENUE_LABEL: Record<string, string> = { spot: '现货', futures: '合约' }

const STATUS_TEXT: Record<VenueState['status'], string> = {
  ok: '已连接',
  unreachable: '不可达',
  unauthorized: '未授权',
  rate_limited: '限流中',
}

/** 整数与小数分开排版：主视线落在整数上，分位不抢注意力（Mercury 的处理） */
function splitMoney(value: number) {
  const text = money(value)
  const cut = text.lastIndexOf('.')
  return cut === -1 ? [text, ''] : [text.slice(0, cut), text.slice(cut)]
}

function VenueRow({ venue }: { venue: VenueState }) {
  const failed = venue.status !== 'ok'
  const { level } = freshnessOf(venue.as_of)
  return (
    <li className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2.5">
        <StatusDot level={failed ? 'error' : level} />
        <span className="text-[13px] text-fg">{VENUE_LABEL[venue.venue] ?? venue.venue}</span>
        <span className={cn('ml-auto text-[12px]', failed ? 'text-loss' : 'text-fg-3')}>
          {STATUS_TEXT[venue.status]}
        </span>
        <span className="tnum w-[86px] shrink-0 whitespace-nowrap text-right text-[12px] text-fg-3">
          {venue.as_of ? clockTime(venue.as_of) : '—'}
        </span>
      </div>
      {failed && venue.detail && (
        <p className="pl-[17px] text-[11.5px] leading-relaxed text-fg-3">{venue.detail}</p>
      )}
    </li>
  )
}

export function NetWorthBand({
  snapshot, onRefresh, refreshing,
}: {
  snapshot: PortfolioSnapshot
  onRefresh: () => void
  refreshing: boolean
}) {
  const totals = snapshot.totals
  const { level } = freshnessOf(snapshot.as_of)
  const veiled = level === 'stale' || level === 'unknown'
  const [whole, cents] = totals ? splitMoney(totals.equity_usd) : ['—', '']
  const degraded = snapshot.venues.filter((v) => v.status !== 'ok')

  return (
    <section className="grid gap-10 lg:grid-cols-[1.55fr_1fr] lg:gap-14">
      <div className="rise" style={{ '--i': 0 } as CSSProperties}>
        <Eyebrow>净值 · Net asset value</Eyebrow>

        <div className={cn('mt-4 flex items-baseline', veiled && 'veiled')}>
          <span className="tnum text-[44px] font-medium leading-none tracking-[-0.03em] text-fg sm:text-[60px]">
            {whole}
          </span>
          <span className="tnum text-[22px] font-medium leading-none tracking-[-0.02em] text-fg-3 sm:text-[28px]">
            {cents}
          </span>
        </div>

        <div className={cn('mt-5 flex flex-wrap items-center gap-x-5 gap-y-2', veiled && 'veiled')}>
          {totals?.change_24h_usd === null || totals === null ? (
            <span className="text-[13px] text-fg-3">无昨日快照，暂不显示 24 小时变化</span>
          ) : (
            <>
              <Delta className="text-[15px] font-medium" value={totals.change_24h_usd}>
                {signedMoney(totals.change_24h_usd)}
              </Delta>
              <Delta className="text-[15px]" value={totals.change_24h_pct}>
                {signedPercent(totals.change_24h_pct)}
              </Delta>
              <span className="text-[12px] text-fg-3">近 24 小时</span>
            </>
          )}
        </div>

        {totals && (
          <dl className={cn('mt-8 grid grid-cols-3 gap-px overflow-hidden rounded-[var(--radius-panel)] bg-line', veiled && 'veiled')}>
            {([
              ['现货', totals.spot_usd, null],
              ['合约权益', totals.futures_usd, null],
              ['未实现盈亏', totals.unrealized_pnl_usd, 'delta'],
            ] as const).map(([label, value, kind]) => (
              <div className="bg-bg px-4 py-3.5" key={label}>
                <dt className="text-[11.5px] text-fg-3">{label}</dt>
                <dd className="mt-1.5">
                  {kind === 'delta' ? (
                    <Delta className="text-[15px]" value={value}>{signedMoney(value)}</Delta>
                  ) : (
                    <span className="tnum text-[15px] text-fg">{money(value)}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="rise lg:border-l lg:border-line lg:pl-10" style={{ '--i': 1 } as CSSProperties}>
        <div className="flex items-center justify-between gap-3">
          <Eyebrow>取数来源</Eyebrow>
          <button
            className="flex items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-1 text-[12px] text-fg-3 transition-colors duration-200 hover:bg-surface-2 hover:text-fg active:translate-y-px disabled:opacity-40"
            disabled={refreshing}
            onClick={onRefresh}
            type="button"
          >
            <ArrowsClockwise className={cn(refreshing && 'animate-spin')} size={13} />
            重新取数
          </button>
        </div>

        <ul className="mt-3 divide-y divide-line">
          {snapshot.venues.map((venue) => <VenueRow key={venue.venue} venue={venue} />)}
        </ul>

        <div className="mt-5 flex items-baseline justify-between border-t border-line pt-4">
          <span className="text-[12px] text-fg-3">快照时刻</span>
          <span className={cn('tnum text-[12.5px]', veiled ? 'text-loss' : 'text-fg-2')}>
            {relativeTime(snapshot.as_of)}
          </span>
        </div>

        {degraded.length > 0 && (
          <div className="mt-4 flex gap-2.5 rounded-[var(--radius-panel)] bg-surface-2 px-3.5 py-3">
            <WarningOctagon className="mt-px shrink-0 text-loss" size={15} weight="fill" />
            <p className="text-[12px] leading-relaxed text-fg-2">
              {degraded.length === snapshot.venues.length
                ? '所有来源都取不到，下面显示的是上一次成功的快照。'
                : `${degraded.map((v) => VENUE_LABEL[v.venue]).join('、')}取不到，净值只统计了可达的部分。`}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
