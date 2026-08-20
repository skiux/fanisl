import { useMemo, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { money } from '../../lib/format'
import type { EquityPoint } from '../../api/types'

/**
 * 30 天净值曲线。数据来自 /sapi/v1/accountSnapshot 的日快照。
 *
 * 为什么不是 K 线：日快照每天只给一个净值（totalAssetOfBtc），
 * 而每根 K 需要开/高/低/收四个值——照 K 线画就得凭空编三个。
 * 所以精度感放在别处：去掉柔和渐变，补坐标轴与刻度，
 * 十字准星走 transform 平滑跟随，入场逐段描线。
 *
 * 坐标轴文字用 HTML 叠在 SVG 上，不进 viewBox——否则字号会跟着容器缩放，
 * 整页好不容易定下来的字号音阶会在这里破功。
 */
const PAD = { top: 14, right: 62, bottom: 20, left: 4 }

export function EquityCurve({ points, veiled }: { points: EquityPoint[]; veiled: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  const model = useMemo(() => {
    if (points.length < 2) return null
    const values = points.map((p) => p.equity_usd)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = Math.max(max - min, 1)
    // 上下各留 8% 余量，曲线不贴边；刻度取三档
    const lo = min - span * 0.08
    const hi = max + span * 0.08
    const range = hi - lo
    const xPct = (i: number) => (i / (points.length - 1)) * 100
    const yPct = (v: number) => ((hi - v) / range) * 100
    const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xPct(i).toFixed(3)},${yPct(p.equity_usd).toFixed(3)}`).join(' ')
    return {
      d, xPct, yPct, lo, hi,
      ticks: [hi - range * 0.1, (hi + lo) / 2, lo + range * 0.1],
      rising: values[values.length - 1]! >= values[0]!,
    }
  }, [points])

  if (!model) {
    return (
      <div className="flex min-h-[120px] flex-1 items-center justify-center border border-dashed border-rule">
        <p className="text-xs text-ink-3">没有日快照，画不出曲线</p>
      </div>
    )
  }

  const first = points[0]!
  const last = points[points.length - 1]!
  const active = hover === null ? null : points[hover]!
  const stroke = model.rising ? 'var(--gain)' : 'var(--loss)'

  return (
    <div className={cn('relative flex min-h-0 flex-1 flex-col', veiled && 'veiled')}>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="tnum text-xs text-ink-3">{active ? active.date : `${first.date} — ${last.date}`}</span>
        <span className={cn('tnum text-xs', active ? 'text-ink' : 'text-ink-3')}>
          {active ? money(active.equity_usd) : `${points.length} 天`}
        </span>
      </div>

      <div
        className="relative min-h-0 flex-1"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const box = hostRef.current?.getBoundingClientRect()
          if (!box) return
          const ratio = (event.clientX - box.left) / box.width
          setHover(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))))
        }}
        ref={hostRef}
        style={{ paddingRight: PAD.right }}
      >
        <div className="relative size-full">
          {/* 刻度线与刻度值：线在 SVG 里，值用 HTML 叠上去以保持字号 */}
          {model.ticks.map((tick) => (
            <div
              className="absolute inset-x-0 flex items-center"
              key={tick}
              style={{ top: `${model.yPct(tick)}%`, transform: 'translateY(-50%)' }}
            >
              <span className="h-px flex-1 bg-rule" />
              <span
                className="tnum absolute text-micro text-ink-3"
                style={{ left: '100%', paddingLeft: 8 }}
              >
                {Math.round(tick).toLocaleString('en-US')}
              </span>
            </div>
          ))}

          <svg className="absolute inset-0 size-full" preserveAspectRatio="none" viewBox="0 0 100 100">
            <path
              className="equity-line"
              d={model.d}
              fill="none"
              stroke={stroke}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.4"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* 十字准星：HTML 元素，1px 实线不受 viewBox 拉伸影响；
              走 transform 过渡，在数据点之间是滑过去而不是跳过去 */}
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-y-0 w-px bg-rule-strong transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]',
              hover === null ? 'opacity-0' : 'opacity-100',
            )}
            style={{ left: 0, transform: `translateX(${hover === null ? 0 : model.xPct(hover)}%)` }}
          />
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute size-[7px] rounded-full border-[1.5px] bg-sheet transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]',
              hover === null ? 'opacity-0' : 'opacity-100',
            )}
            style={{
              borderColor: stroke,
              left: 0,
              top: 0,
              transform: hover === null
                ? 'translate(-50%,-50%)'
                : `translate(calc(${model.xPct(hover)}% - 3.5px), calc(${model.yPct(points[hover]!.equity_usd)}% - 3.5px))`,
            }}
          />
        </div>

        <span
          aria-hidden="true"
          className="tnum pointer-events-none absolute bottom-0 left-0 translate-y-full pt-1 text-micro text-ink-3"
        >
          {first.date.slice(5)}
        </span>
        <span
          aria-hidden="true"
          className="tnum pointer-events-none absolute bottom-0 translate-y-full pt-1 text-micro text-ink-3"
          style={{ right: PAD.right }}
        >
          {last.date.slice(5)}
        </span>
      </div>

      <span className="sr-only">
        净值曲线：{first.date} {money(first.equity_usd)} 至 {last.date} {money(last.equity_usd)}，
        {model.rising ? '上行' : '下行'}
      </span>
    </div>
  )
}
