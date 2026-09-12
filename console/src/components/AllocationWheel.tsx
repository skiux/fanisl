import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import {
  allocationPercent, allocationSlices, ringPath, type AllocationItem, type AllocationSlice,
} from '../lib/allocation'
import { cn } from '../lib/cn'
import { money, moneyCompact } from '../lib/format'
import { ICONS } from './icons'
import { tickerHue } from './Ticker'

export type { AllocationItem } from '../lib/allocation'

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

function geometry(availableWidth: number, count: number) {
  const ideal = clamp(380 + Math.min(count, 12) * 18, 380, 596)
  const diameter = Math.min(availableWidth, ideal)
  const center = diameter / 2
  const outer = Math.max(1, center - 11)
  const inner = outer * 0.235
  return { diameter, center, outer, inner }
}

function labelMetrics(slice: AllocationSlice, inner: number, outer: number) {
  const middle = inner + (outer - inner) * 0.62
  const radialRoom = (outer - inner) * 0.78
  const arcRoom = Math.max(0, (slice.end - slice.start) * middle * 0.88)
  // 字号的平方与仓位占比成正比，所以整组信息占扇区的比例不会因仓位大小而改变。
  // 两行沿半径展开后，切向只占 2.35em；同样宽的扇区能比三行堆叠多出约 60% 字号。
  const proportional = outer * Math.sqrt(slice.share) * 0.27
  const fontSize = Math.max(0, Math.min(proportional, arcRoom / 2.35, 36))
  return {
    fontSize,
    height: fontSize * 2.35,
    markSize: fontSize * 1.34,
    radius: middle,
    width: radialRoom,
  }
}

function AssetMark({ asset, size }: { asset: string; size: number }) {
  const file = ICONS[asset]
  if (file) {
    return <img alt="" className="shrink-0 rounded-full bg-sheet-2 object-cover" src={`${import.meta.env.BASE_URL}icons/${file}`} style={{ height: size, width: size }} />
  }
  const label = asset.slice(0, 4)
  return (
    <span
      aria-hidden="true"
      className="ticker grid shrink-0 place-items-center rounded-[28%] font-mono font-medium tracking-tight"
      data-fallback-mark={asset}
      style={{
        '--ticker-hue': tickerHue(asset),
        fontSize: size * (label.length > 3 ? 0.37 : 0.45),
        height: size,
        width: size,
      } as CSSProperties}
    >{label}</span>
  )
}

function arcPath(center: number, radius: number, start: number, end: number) {
  const point = (angle: number) => `${center + Math.cos(angle) * radius},${center + Math.sin(angle) * radius}`
  if (end - start >= Math.PI * 2 - 1e-10) {
    return `M${point(start)} A${radius},${radius} 0 1 1 ${point(start + Math.PI)}`
      + ` A${radius},${radius} 0 1 1 ${point(end)}`
  }
  const large = end - start > Math.PI ? 1 : 0
  return `M${point(start)} A${radius},${radius} 0 ${large} 1 ${point(end)}`
}

function SliceLabel({ slice, center, inner, outer }: {
  slice: AllocationSlice
  center: number
  inner: number
  outer: number
}) {
  const metrics = labelMetrics(slice, inner, outer)
  const middle = (slice.start + slice.end) / 2
  const degrees = middle * 180 / Math.PI
  const readable = degrees > 90 && degrees < 270 ? degrees + 180 : degrees
  const x = center + Math.cos(middle) * metrics.radius
  const y = center + Math.sin(middle) * metrics.radius
  return (
    <foreignObject
      aria-hidden="true"
      className="pointer-events-none overflow-visible"
      height={metrics.height}
      width={metrics.width}
      x={x - metrics.width / 2}
      y={y - metrics.height / 2}
    >
      <div
        className="allocation-spoke-label flex h-full w-full flex-col items-center justify-center text-center"
        data-chart-label={slice.key}
        data-label-font-size={metrics.fontSize}
        style={{
          fontSize: metrics.fontSize,
          gap: metrics.fontSize * 0.22,
          lineHeight: 1,
          transform: `rotate(${readable}deg)`,
        }}
      >
        <span className="flex items-center justify-center font-semibold" style={{ gap: metrics.fontSize * 0.28 }}>
          <AssetMark asset={slice.key} size={metrics.markSize} />
          <span>{slice.key}</span>
        </span>
        <span className="tnum flex items-center whitespace-nowrap font-medium tracking-tight" style={{ fontSize: metrics.fontSize * 0.91, gap: metrics.fontSize * 0.48 }}>
          <span>{moneyCompact(slice.value)}</span>
          <span aria-hidden="true" className="allocation-label-separator">·</span>
          <span>{allocationPercent(slice.share)}</span>
        </span>
      </div>
    </foreignObject>
  )
}

/**
 * 一张带百分比刻度的持仓轮。连续扇区负责“合计 100%”的直觉，外沿 100 格刻度让
 * 3% 与 8% 这样的长尾也能按单位读取；标签沿径向排布，利用整段环宽而不是窄弧宽。
 */
export function AllocationWheel({ items, selected, onSelect }: {
  items: AllocationItem[]
  selected: string | null
  onSelect: (key: string | null) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const id = useId().replace(/:/g, '')
  const [availableWidth, setAvailableWidth] = useState(340)
  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    const measure = () => setAvailableWidth(Math.max(1, box.clientWidth))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  const geo = geometry(availableWidth, items.length)
  const slices = allocationSlices(items)
  const toggle = (key: string) => onSelect(selected === key ? null : key)
  return (
    <div
      className="allocation-chart relative -translate-x-6 w-[calc(100%+48px)] max-w-[680px] sm:mx-auto sm:w-full sm:translate-x-0"
      ref={ref}
      style={{ height: geo.diameter }}
    >
      <svg
        aria-labelledby={`${id}-title`}
        className="allocation-wheel mx-auto block overflow-visible"
        data-diameter={geo.diameter}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); onSelect(null); return }
          const current = (event.target as HTMLElement).closest<SVGPathElement>('[data-slice]')
          if (!current) return
          const index = slices.findIndex((slice) => slice.key === current.dataset.slice)
          const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? index + 1
            : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? index - 1
              : event.key === 'Home' ? 0 : event.key === 'End' ? slices.length - 1 : null
          if (next !== null) {
            event.preventDefault()
            ref.current?.querySelectorAll<SVGPathElement>('[data-slice]')[(next + slices.length) % slices.length]?.focus()
          }
        }}
        role="group"
        style={{ height: geo.diameter, width: geo.diameter }}
        viewBox={`0 0 ${geo.diameter} ${geo.diameter}`}
      >
        <title id={`${id}-title`}>多头持仓轮，扇区角度与外沿刻度表示多头占比</title>
        <circle className="allocation-wheel-bed" cx={geo.center} cy={geo.center} r={geo.outer} />
        {slices.map((slice, index) => {
          const angle = slice.end - slice.start
          const gap = slices.length === 1 ? 0 : Math.min(0.008, angle * 0.07)
          const markerInset = slices.length === 1 ? 0
            : Math.min(0.012, Math.max(0, (angle - gap * 2) * 0.18))
          return (
            <g key={slice.key}>
              <path
                aria-label={`${slice.key}，${money(slice.value)}，${allocationPercent(slice.share)}`}
                aria-pressed={selected === slice.key}
                className="allocation-sector"
                d={ringPath(geo.center, geo.inner, geo.outer, slice.start + gap, slice.end - gap)}
                data-end={slice.end}
                data-selected={selected === slice.key}
                data-share={slice.share}
                data-slice={slice.key}
                data-start={slice.start}
                fill={slice.color}
                onClick={() => toggle(slice.key)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    toggle(slice.key)
                  }
                }}
                role="button"
                tabIndex={0}
              />
              <SliceLabel center={geo.center} inner={geo.inner} outer={geo.outer} slice={slice} />
              {selected === slice.key && (
                <path
                  aria-hidden="true"
                  className="allocation-sector-marker"
                  d={arcPath(geo.center, geo.inner + 7, slice.start + gap + markerInset, slice.end - gap - markerInset)}
                  pathLength={1}
                />
              )}
              <title>{`${index + 1}. ${slice.key} ${allocationPercent(slice.share)}`}</title>
            </g>
          )
        })}
        {Array.from({ length: 100 }, (_, index) => {
          const angle = -Math.PI / 2 + index / 100 * Math.PI * 2
          const major = index % 5 === 0
          const inner = geo.outer - (major ? 9 : 4)
          return (
            <line
              aria-hidden="true"
              className={major ? 'allocation-tick allocation-tick-major' : 'allocation-tick'}
              key={index}
              x1={geo.center + Math.cos(angle) * inner}
              x2={geo.center + Math.cos(angle) * (geo.outer - 1)}
              y1={geo.center + Math.sin(angle) * inner}
              y2={geo.center + Math.sin(angle) * (geo.outer - 1)}
            />
          )
        })}
      </svg>
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center"
        style={{ width: geo.inner * 1.62 }}
      >
        <span className="text-[10px] text-ink-3">多头合计</span>
        <span className="tnum mt-1 text-xs font-medium text-ink">{money(items.reduce((sum, item) => sum + item.value, 0))}</span>
      </div>
    </div>
  )
}

export function Swatch({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden="true" className={cn('inline-block size-2 shrink-0 rounded-full', className)} style={{ background: color }} />
}
