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
  const ideal = clamp(312 + Math.min(count, 12) * 9, 330, 420)
  const diameter = Math.min(availableWidth, ideal)
  const center = diameter / 2
  const outer = Math.max(1, center - 11)
  const inner = outer * 0.27
  return { diameter, center, outer, inner }
}

const LARGE_SLICE_SHARE = 0.12

function labelMetrics(slice: AllocationSlice, inner: number, outer: number) {
  const thickness = outer - inner
  const large = slice.share >= LARGE_SLICE_SHARE
  // 大扇区把标签通道向圆心多借一点空间，外缘仍留给百分比刻度。
  const middle = inner + thickness * (large ? 0.55 : 0.62)
  const radialRoom = thickness * (large ? 0.915 : 0.78)
  const arcRoom = Math.max(0, (slice.end - slice.start) * middle * 0.88)
  const compactValue = moneyCompact(slice.value)
  const percent = allocationPercent(slice.share)
  // 未受空间约束时，字号平方与仓位占比成正比；中小扇区因此保持相同的信息面积占比。
  // 大仓位还要受实际字符串宽度约束，避免 $11K · 18.3% 这类长数据越过环宽。
  const proportional = outer * Math.sqrt(slice.share) * 0.27
  const codeLineEm = 1.42 + 0.28 + Math.max(1, slice.key.length) * 0.62
  const valueLineEm = (compactValue.length + percent.length + 1) * 0.6 * 0.91 + 0.96
  const contentEm = Math.max(codeLineEm, valueLineEm)
  const contentFit = radialRoom * 0.96 / contentEm
  // 18px 后缓慢收敛，前三个大仓位仍按面积递增，但不会放大成海报标题。
  const readableScale = proportional <= 18 ? proportional : 18 + 2 * Math.tanh((proportional - 18) / 4)
  const fontSize = Math.max(0, Math.min(readableScale, arcRoom / 2.35, contentFit))
  return {
    compactValue,
    contentFit,
    contentWidth: contentEm * fontSize,
    fontSize,
    height: fontSize * 2.35,
    markSize: fontSize * 1.42,
    percent,
    proportional,
    radius: middle,
    width: radialRoom,
  }
}

function AssetMark({ asset, size }: { asset: string; size: number }) {
  if (asset === 'XAU') {
    return (
      <span
        aria-hidden="true"
        className="allocation-gold-asset-mark grid shrink-0 place-items-center rounded-full font-semibold"
        data-asset-mark={asset}
        style={{ fontSize: size * 0.43, height: size, width: size }}
      >
        Au
      </span>
    )
  }
  const file = ICONS[asset]
  if (file) {
    return (
      <img
        alt=""
        className="allocation-asset-mark shrink-0 rounded-full object-cover"
        data-asset-mark={asset}
        src={`${import.meta.env.BASE_URL}icons/${file}`}
        style={{ height: size, width: size }}
      />
    )
  }
  const label = asset.slice(0, 4)
  return (
    <span
      aria-hidden="true"
      className="ticker grid shrink-0 place-items-center rounded-[28%] font-mono font-medium tracking-tight"
      data-asset-mark={asset}
      data-fallback-mark={asset}
      style={{
        '--ticker-hue': tickerHue(asset),
        fontSize: size * (label.length > 3 ? 0.37 : 0.45),
        height: size,
        width: size,
      } as CSSProperties}
    >
      {label}
    </span>
  )
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
        data-label-content-width={metrics.contentWidth}
        data-label-font-size={metrics.fontSize}
        data-label-proportional-size={metrics.proportional}
        data-label-room={metrics.width}
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
          <span>{metrics.compactValue}</span>
          <span aria-hidden="true" className="allocation-label-separator">·</span>
          <span>{metrics.percent}</span>
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
  const paintedSlices = slices.map((slice) => {
    const angle = slice.end - slice.start
    const gap = slices.length === 1 ? 0 : Math.min(0.0032, angle * 0.035)
    return {
      ...slice,
      path: ringPath(geo.center, geo.inner, geo.outer, slice.start + gap, slice.end - gap),
    }
  })
  const selectedSlice = slices.find((slice) => slice.key === selected) ?? null
  const cursorProgress = selectedSlice
    ? ((selectedSlice.start + selectedSlice.end) / 2 + Math.PI / 2) / (Math.PI * 2)
    : 0
  const total = items.reduce((sum, item) => sum + item.value, 0)
  const centerFontSize = clamp(geo.inner * 0.225, 10.5, 13.5)
  const toggle = (key: string) => onSelect(selected === key ? null : key)
  return (
    <div
      className="allocation-chart relative -translate-x-6 w-[calc(100%+48px)] max-w-[480px] sm:mx-auto sm:w-full sm:translate-x-0"
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
        {paintedSlices.map((slice, index) => {
          return (
            <g key={slice.key}>
              <path
                aria-label={`${slice.key}，${money(slice.value)}，${allocationPercent(slice.share)}`}
                aria-pressed={selected === slice.key}
                className="allocation-sector"
                d={slice.path}
                data-end={slice.end}
                data-selected={selected === slice.key}
                data-share={slice.share}
                data-slice={slice.key}
                data-start={slice.start}
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
              <title>{`${index + 1}. ${slice.key} ${allocationPercent(slice.share)}`}</title>
            </g>
          )
        })}
        <circle
          aria-hidden="true"
          className="allocation-selection-cursor"
          cx={geo.center}
          cy={geo.center}
          data-active={Boolean(selectedSlice)}
          data-selection-cursor
          pathLength={1}
          r={geo.inner + 7}
          strokeDashoffset={-cursorProgress}
          transform={`rotate(-90 ${geo.center} ${geo.center})`}
        />
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
        className="allocation-center pointer-events-none absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-center"
        data-allocation-center
        data-center-asset={selectedSlice?.key ?? ''}
        data-center-diameter={geo.inner * 2 - 1}
        style={{ height: geo.inner * 2 - 1, width: geo.inner * 2 - 1 }}
      >
        <div
          className="allocation-center-content flex flex-col items-center justify-center"
          style={{ fontSize: centerFontSize, width: geo.inner * 1.58 }}
        >
          {selectedSlice ? (
            <>
              <span className="allocation-center-mark flex items-center justify-center" data-center-mark>
                <AssetMark asset={selectedSlice.key} size={centerFontSize * 1.75} />
              </span>
              <span className="allocation-center-value tnum mt-[0.38em] font-semibold leading-none text-ink">{money(selectedSlice.value)}</span>
              <span className="allocation-center-meta tnum mt-[0.34em] leading-none text-ink-3">{allocationPercent(selectedSlice.share)}</span>
            </>
          ) : (
            <span className="allocation-center-value tnum font-semibold leading-none text-ink">{money(total)}</span>
          )}
        </div>
      </div>
    </div>
  )
}

export function Swatch({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden="true" className={cn('inline-block size-2 shrink-0 rounded-full', className)} style={{ background: color }} />
}
