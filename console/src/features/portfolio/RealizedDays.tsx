import { useMemo, useState } from 'react'
import { cn } from '../../lib/cn'
import { DateRangeInput, SegmentedControl } from '../../components/controls'
import { signedMoney } from '../../lib/format'
import type { DailyRealized } from '../../api/types'

/**
 * 每天落袋多少。**零线柱状图 + 它的数字表。**
 *
 * 走到这个形式经历了两版错的：
 *
 * 1. GitHub 那种色块热力图——读数只在悬浮时出现，而手机上没有悬浮。
 * 2. 一格一格印着日期和金额的方块网格——数字是有了，但把"这段时间走势如何"
 *    这个最主要的问题给毁了：三十个等大的方块读不出任何形状，无交易的日子还要
 *    占一个写着"—"的空格，整片看着像坏掉的表格。
 *
 * 更要命的是那两版**都只用颜色表示正负**。`--gain` 与 `--loss` 在红绿色盲下的
 * 分离度只有 ΔE 6.1（验证器实测），处在"仅当有第二重编码才合法"的区间——
 * 也就是说那两版红绿色盲读不出哪天赚哪天亏。
 *
 * 柱状图从零线上下发散，**方向本身就是第二重编码**，红绿因此合法；正负号是第三重。
 * 形状一眼可读，没交易的日子是零高度，不占版面也不用写"—"。
 * 下面那张表只列真的有交易的日子——这是财经版面的老写法：一张图，配它的数字。
 *
 * 手搓 SVG 而不是上图表库：这里只有三十个矩形和一条零线，没有坐标轴、没有比例尺
 * 交互、没有图例。要装的那套东西比要画的东西大。
 */
const PRESETS = { '7': 7, '30': 30, '90': 90 } as const
type Preset = keyof typeof PRESETS | 'custom'

const H = 150         // 绘图区高度，零线居中。96px 时柱子又宽又矮，读不出形状

export function RealizedDays({ days, maxDays }: { days: DailyRealized[]; maxDays: number }) {
  const [preset, setPreset] = useState<Preset>('30')
  const [range, setRange] = useState(() => ({
    from: days[0]?.date ?? '', to: days.at(-1)?.date ?? '',
  }))
  const [hover, setHover] = useState<string | null>(null)

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
  const active = shown.find((d) => d.date === hover) ?? null

  const options = (Object.keys(PRESETS) as (keyof typeof PRESETS)[])
    .filter((key) => PRESETS[key] <= maxDays)
    .map((key) => ({ value: key as Preset, label: `${key} 天` }))


  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
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

      <figure className="m-0">
        {/* 零线画在容器上，**一条**，不是每列各画一段——上一版就是那样，
            三十段之间隔着柱间距，看着是一排虚线。 */}
        <div className="relative" onPointerLeave={() => setHover(null)} style={{ height: H }}>
          <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-rule-strong" />
          <div className="relative flex h-full items-stretch">
            {shown.map((day) => {
              const value = day.realized_usd
              const share = Math.abs(value) / peak
              const up = value >= 0
              const dim = hover !== null && hover !== day.date
              const bar = day.traded && value !== 0
              return (
                <button
                  aria-label={`${day.date} ${bar ? signedMoney(value) : '没有交易'}`}
                  className="group relative flex-1 outline-none"
                  key={day.date}
                  onFocus={() => setHover(day.date)}
                  onPointerEnter={() => setHover(day.date)}
                  type="button"
                >
                  {/* 柱子细、居中、封顶。上一版让它撑满整列，三十天里只有十来天有交易，
                      每根柱子六十来像素宽——读着是色块，不是图。 */}
                  <span
                    className={cn(
                      'absolute left-1/2 w-[62%] max-w-[13px] -translate-x-1/2 rounded-[1.5px]',
                      'transition-opacity duration-150',
                      !bar ? 'bg-rule' : up ? 'bg-gain' : 'bg-loss',
                      dim && 'opacity-25',
                      'group-focus-visible:outline group-focus-visible:outline-1',
                      'group-focus-visible:outline-offset-2 group-focus-visible:outline-accent',
                    )}
                    style={bar ? {
                      height: `${Math.max(share * 47, 1.2)}%`,
                      [up ? 'bottom' : 'top']: '50%',
                    } : {
                      // 没交易：一个几乎看不见的点，只为让这一列可点、可读出日期
                      height: '3px', width: '3px', top: 'calc(50% - 1.5px)',
                      borderRadius: '50%',
                    }}
                  />
                </button>
              )
            })}
          </div>
        </div>

        <figcaption className="mt-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <span className="tnum text-micro text-ink-3">
            {shown[0]?.date} — {shown.at(-1)?.date}
          </span>
          <span className="tnum text-micro text-ink-3">
            {active ? (
              <>
                {active.date}
                <span className={cn('ml-2 text-xs',
                  active.realized_usd > 0 ? 'text-gain'
                    : active.realized_usd < 0 ? 'text-loss' : 'text-ink-2')}>
                  {active.traded ? signedMoney(active.realized_usd) : '没有交易'}
                </span>
              </>
            ) : `峰值 ${signedMoney(peak)}`}
          </span>
        </figcaption>
      </figure>

      {/* 图配它的数字。只列真的有交易的日子——没交易的写出来是三十行"0" */}
      {traded.length > 0 && (
        <ul className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-x-6 border-t border-rule pt-3">
          {traded.map((day) => (
            <li
              className={cn('flex items-baseline justify-between gap-2 py-1',
                hover === day.date && 'bg-sheet-2')}
              key={day.date}
              onPointerEnter={() => setHover(day.date)}
              onPointerLeave={() => setHover(null)}
            >
              <span className="tnum text-micro text-ink-3">{day.date.slice(5)}</span>
              <span className={cn('tnum text-xs',
                day.realized_usd > 0 ? 'text-gain'
                  : day.realized_usd < 0 ? 'text-loss' : 'text-ink-3')}>
                {signedMoney(day.realized_usd)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-t border-rule pt-3">
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
