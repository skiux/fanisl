import { useMemo, useState } from 'react'
import { cn } from '../../lib/cn'
import { SegmentedControl, DateRangeInput } from '../../components/controls'
import { signedMoney } from '../../lib/format'
import type { DailyRealized } from '../../api/types'

/**
 * 每天落袋多少。
 *
 * 上一版是 GitHub 那种色块热力图，读数只在悬浮时出现——**手机上没有悬浮**，
 * 只能长按，等于这一页在手机上读不了。而且色块把"赚了多少"压成了深浅，
 * 而这一页的读者要的就是那个数字本身。
 *
 * 现在每格直接印日期和金额，颜色只做次要编码。默认 30 天：90 天铺开要么格子太小、
 * 要么得横向滚动，而"最近怎么样"这个问题本来就不需要看到三个月。
 *
 * 区间用共用的分段控件 + 原生日期输入，不自己写日历弹层。
 */
const PRESETS = { '7': 7, '30': 30, '90': 90 } as const
type Preset = keyof typeof PRESETS | 'custom'

export function RealizedDays({ days, maxDays }: { days: DailyRealized[]; maxDays: number }) {
  const [preset, setPreset] = useState<Preset>('30')
  const [range, setRange] = useState(() => ({
    from: days[0]?.date ?? '', to: days.at(-1)?.date ?? '',
  }))

  const shown = useMemo(() => {
    if (preset === 'custom') {
      return days.filter((d) => d.date >= range.from && d.date <= range.to)
    }
    return days.slice(-PRESETS[preset])
  }, [days, preset, range])

  if (days.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-3">还没有可用的成交记录。</p>
  }

  const peak = Math.max(...shown.map((d) => Math.abs(d.realized_usd)), 1)
  const total = shown.reduce((sum, d) => sum + d.realized_usd, 0)
  const traded = shown.filter((d) => d.traded)
  const wins = traded.filter((d) => d.realized_usd > 0).length

  const options = (Object.keys(PRESETS) as (keyof typeof PRESETS)[])
    .filter((key) => PRESETS[key] <= maxDays)
    .map((key) => ({ value: key as Preset, label: `${key} 天` }))

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <SegmentedControl
          items={[...options, { value: 'custom' as Preset, label: '自定义' }]}
          label="统计区间"
          onValueChange={setPreset}
          size="sm"
          value={preset}
        />
        {preset === 'custom' && (
          <DateRangeInput
            from={range.from}
            max={days.at(-1)?.date}
            min={days[0]?.date}
            onChange={setRange}
            to={range.to}
          />
        )}
      </div>

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(58px,1fr))] gap-1">
        {shown.map((day) => {
          const value = day.realized_usd
          const weight = Math.abs(value) / peak
          return (
            <li
              className={cn(
                'rounded-[3px] border px-1.5 py-1.5 text-center',
                day.traded ? 'border-transparent' : 'border-rule/60',
              )}
              key={day.date}
              style={day.traded ? {
                backgroundColor: `color-mix(in oklab, var(--${value >= 0 ? 'gain' : 'loss'}) ${
                  (8 + weight * 26).toFixed(1)}%, var(--sheet))`,
              } : undefined}
            >
              <div className="tnum text-micro text-ink-3">{day.date.slice(5)}</div>
              <div className={cn('tnum mt-0.5 truncate text-[11px] leading-tight',
                !day.traded ? 'text-ink-3/60'
                  : value > 0 ? 'text-gain' : value < 0 ? 'text-loss' : 'text-ink-3')}>
                {day.traded ? compact(value) : '—'}
              </div>
            </li>
          )
        })}
      </ul>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-t border-rule pt-3">
        <span className="tnum text-xs text-ink-3">
          {shown.length} 天 · {traded.length} 天有交易 · {wins} 天为正
        </span>
        <span className="tnum text-xs text-ink-3">
          合计
          <span className={cn('ml-2 text-sm', total >= 0 ? 'text-gain' : 'text-loss')}>
            {signedMoney(total)}
          </span>
        </span>
      </div>
    </>
  )
}

/**
 * 格子只有 58px 宽，$1,234.56 放不下。千位以上压成 1.2k，符号保留。
 *
 * **一美元以内保留两位小数，不四舍五入成 0。** 只收了几分钱资金费的那天写"0"，
 * 和真的一分没动看起来一样，可下面那行还写着"26 天有交易"——两处对不上。
 * 位数是为了塞进格子而压缩的，不该把一个数压成另一个意思。
 */
function compact(value: number) {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  const abs = Math.abs(value)
  if (abs === 0) return '0'
  if (abs < 1) return `${sign}${abs.toFixed(2)}`
  if (abs < 1000) return `${sign}${Math.round(abs)}`
  return `${sign}${(abs / 1000).toFixed(abs < 10_000 ? 1 : 0)}k`
}
