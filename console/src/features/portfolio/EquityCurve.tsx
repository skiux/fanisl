import { useMemo, useState } from 'react'
import { cn } from '../../lib/cn'
import { money } from '../../lib/format'
import type { EquityPoint } from '../../api/types'

const W = 620
const H = 132

/**
 * 30 天净值曲线。数据来自 /sapi/v1/accountSnapshot 的日快照——
 * 不需要后端自建快照表，Binance 直接给最近一个月。
 */
export function EquityCurve({ points, veiled }: { points: EquityPoint[]; veiled: boolean }) {
  const [hover, setHover] = useState<number | null>(null)

  const shape = useMemo(() => {
    if (points.length < 2) return null
    const values = points.map((p) => p.equity_usd)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = Math.max(max - min, 1)
    // 上下各留 12% 余量，曲线不贴边
    const y = (value: number) => H - 16 - ((value - min) / span) * (H - 32)
    const x = (index: number) => (index / (points.length - 1)) * W
    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.equity_usd).toFixed(1)}`).join(' ')
    const area = `${line} L${W},${H} L0,${H} Z`
    return { line, area, x, y, min, max }
  }, [points])

  if (!shape) {
    return (
      <div className="flex min-h-[120px] flex-1 items-center justify-center rounded-[var(--radius-panel)] border border-dashed border-line">
        <p className="text-xs text-fg-3">没有日快照，画不出曲线</p>
      </div>
    )
  }

  const active = hover === null ? null : points[hover]
  const first = points[0]!
  const last = points[points.length - 1]!
  const rising = last.equity_usd >= first.equity_usd

  return (
    <div className={cn('relative flex min-h-0 flex-1 flex-col', veiled && 'veiled')}>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs text-fg-3">
          {active ? active.date : `${first.date} — ${last.date}`}
        </span>
        <span className="tnum text-xs text-fg-2">
          {active ? money(active.equity_usd) : `${points.length} 天`}
        </span>
      </div>

      <svg
        className="min-h-[110px] w-full flex-1"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          const ratio = (event.clientX - box.left) / box.width
          setHover(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))))
        }}
        preserveAspectRatio="none"
        viewBox={`0 0 ${W} ${H}`}
      >
        <defs>
          <linearGradient id="equityFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={rising ? 'var(--gain)' : 'var(--loss)'} stopOpacity="0.16" />
            <stop offset="100%" stopColor={rising ? 'var(--gain)' : 'var(--loss)'} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={shape.area} fill="url(#equityFill)" />
        <path
          d={shape.line}
          fill="none"
          stroke={rising ? 'var(--gain)' : 'var(--loss)'}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.6"
          vectorEffect="non-scaling-stroke"
        />
        {hover !== null && (
          <g>
            <line
              stroke="var(--line-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke"
              x1={shape.x(hover)} x2={shape.x(hover)} y1={0} y2={H}
            />
            <circle
              cx={shape.x(hover)} cy={shape.y(points[hover]!.equity_usd)} r="3.5"
              fill="var(--bg)" stroke={rising ? 'var(--gain)' : 'var(--loss)'}
              strokeWidth="1.6" vectorEffect="non-scaling-stroke"
            />
          </g>
        )}
      </svg>
    </div>
  )
}
