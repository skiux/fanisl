import { useMemo } from 'react'
import { cn } from '../../lib/cn'
import { signedMoney } from '../../lib/format'
import type { EquityPoint } from '../../api/types'

/**
 * 逐日净值变化。对账表给的是整段的分解（钱从哪来），这里给的是路径（怎么走过来的）——
 * 同一段时间的两个不同问题，所以不是同一张表的另一种画法。
 *
 * 口径：日快照的一阶差分，**含充提**。日粒度的充提明细接口给不出来，
 * 所以这里不假装能剔除，只在抬头写清楚。
 */
export function DailyChange({ points }: { points: EquityPoint[] }) {
  const days = useMemo(
    () => points.slice(1).map((point, index) => ({
      date: point.date,
      delta: point.equity_usd - points[index].equity_usd,
    })),
    [points],
  )

  if (days.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-3">没有日快照，画不出逐日变化。</p>
  }

  const scale = Math.max(...days.map((day) => Math.abs(day.delta)), 1)
  const up = days.filter((day) => day.delta > 0).length
  const best = days.reduce((a, b) => (b.delta > a.delta ? b : a))
  const worst = days.reduce((a, b) => (b.delta < a.delta ? b : a))
  const mean = days.reduce((sum, day) => sum + Math.abs(day.delta), 0) / days.length

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
      <div className="min-w-0 flex-1">
        <div className="relative flex h-[112px] items-stretch gap-[3px]">
          <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-rule-strong" />
          {days.map((day) => {
            const ratio = Math.min(1, Math.abs(day.delta) / scale)
            const positive = day.delta >= 0
            return (
              <span
                className="relative min-w-0 flex-1"
                key={day.date}
                title={`${day.date} · ${signedMoney(day.delta)}`}
              >
                <span
                  className={cn(
                    'absolute inset-x-0 rounded-[1px] transition-[height] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]',
                    positive ? 'bottom-1/2 bg-gain/70' : 'top-1/2 bg-loss/70',
                  )}
                  style={{ height: `${Math.max(ratio * 50, 0.9).toFixed(2)}%` }}
                />
              </span>
            )
          })}
        </div>
        <div className="tnum mt-2 flex justify-between text-micro text-ink-3">
          <span>{days[0].date.slice(5)}</span>
          <span>{days[days.length - 1].date.slice(5)}</span>
        </div>
      </div>

      <dl className="grid shrink-0 grid-cols-2 gap-x-8 gap-y-4 lg:w-[236px]">
        <Stat label="上涨天数" value={`${up} / ${days.length}`} />
        <Stat label="日均波幅" value={signedMoney(mean).replace('+', '±')} />
        <Stat
          label="最大单日涨"
          note={best.date.slice(5)}
          tone="gain"
          value={signedMoney(best.delta)}
        />
        <Stat
          label="最大单日跌"
          note={worst.date.slice(5)}
          tone="loss"
          value={signedMoney(worst.delta)}
        />
      </dl>
    </div>
  )
}

function Stat({ label, value, note, tone }: {
  label: string
  value: string
  note?: string
  tone?: 'gain' | 'loss'
}) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-1 flex items-baseline gap-2">
        <span className={cn('tnum text-sm', tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-ink')}>
          {value}
        </span>
        {note && <span className="tnum text-micro text-ink-3">{note}</span>}
      </dd>
    </div>
  )
}
