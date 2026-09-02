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

const H = 96          // 绘图区高度，零线居中

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
        {/* 用 flex 画柱子，不用 SVG。SVG 要么固定宽高比（三十根柱子在宽屏上会被拉扁），
            要么 preserveAspectRatio="none"——那会把 x 轴单独拉伸，圆角变成椭圆、
            间距跟着变形。DOM 元素没有这个问题，2px 的间距就是 2px。 */}
        <div
          className="flex items-stretch gap-[2px]"
          onPointerLeave={() => setHover(null)}
          style={{ height: H }}
        >
          {shown.map((day) => {
            const value = day.realized_usd
            const share = Math.abs(value) / peak
            const up = value >= 0
            const dim = hover !== null && hover !== day.date
            return (
              <button
                aria-label={`${day.date} ${day.traded ? signedMoney(value) : '没有交易'}`}
                className="group relative flex-1 outline-none"
                key={day.date}
                onFocus={() => setHover(day.date)}
                onPointerEnter={() => setHover(day.date)}
                type="button"
              >
                {/* 零线穿过每一列的正中，是这张图唯一的实线 */}
                <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-rule-strong" />
                <span
                  className={cn(
                    'absolute inset-x-0 rounded-[2px] transition-opacity duration-150',
                    !day.traded || value === 0 ? 'bg-rule'
                      : up ? 'bg-gain' : 'bg-loss',
                    dim && 'opacity-30',
                    'group-focus-visible:outline group-focus-visible:outline-1',
                    'group-focus-visible:outline-offset-2 group-focus-visible:outline-accent',
                  )}
                  style={day.traded && value !== 0 ? {
                    height: `${Math.max(share * 46, 1.5)}%`,
                    [up ? 'bottom' : 'top']: '50%',
                  } : { height: '2px', top: 'calc(50% - 1px)' }}
                />
              </button>
            )
          })}
        </div>

        <figcaption className="mt-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
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
