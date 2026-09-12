import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { allocationPercent, allocationTiles, type AllocationItem, type AllocationTile } from '../lib/allocation'
import { cn } from '../lib/cn'
import { money, moneyCompact } from '../lib/format'
import { ICONS } from './icons'
import { tickerHue } from './Ticker'

export type { AllocationItem } from '../lib/allocation'

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

function geometry(availableWidth: number, count: number) {
  const targetWidth = clamp(360 + Math.min(count, 12) * 17, 360, 560)
  const width = Math.min(availableWidth, targetWidth)
  // 窄屏增加纵向面积，让十二项仍能完整写出；宽屏维持稳定的方形面积图。
  const height = width >= 460
    ? width
    : clamp(width * 0.8 + Math.min(count, 12) * 30, 380, 560)
  return { width, height }
}

function tileMetrics(tile: AllocationTile) {
  const area = tile.width * tile.height
  // 字号平方与区域面积同步，整组信息在每块区域中保持近似相同的面积占比。
  const proportional = Math.sqrt(area) * 0.105
  const gap = Math.min(3, Math.min(tile.width, tile.height) * 0.12)
  const visibleWidth = Math.max(0, tile.width - gap)
  const visibleHeight = Math.max(0, tile.height - gap)
  const padding = Math.min(
    clamp(proportional * 0.62, 2, 14),
    visibleWidth * 0.12,
    visibleHeight * 0.12,
  )
  const widthUnits = Math.max(
    1.35 + 0.35 + tile.key.length * 0.68,
    moneyCompact(tile.value).length * 0.58,
    allocationPercent(tile.share).length * 0.52,
  )
  const fontSize = Math.max(0, Math.min(
    proportional,
    (visibleWidth - padding * 2) / widthUnits,
    (visibleHeight - padding * 2) / 3.79,
    26,
  ))
  return {
    gap,
    fontSize,
    markSize: fontSize * 1.35,
    padding,
    radius: Math.min(
      clamp(Math.sqrt(area) * 0.055, 2, 16),
      visibleWidth / 4,
      visibleHeight / 4,
    ),
  }
}

function AssetMark({ asset, size }: { asset: string; size: number }) {
  const file = ICONS[asset]
  if (file) {
    return (
      <img
        alt=""
        className="shrink-0 rounded-full bg-sheet-2 object-cover"
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

function Tile({ tile, selected, id, onSelect }: {
  tile: AllocationTile
  selected: boolean
  id: string
  onSelect: () => void
}) {
  const metrics = tileMetrics(tile)
  return (
    <button
      aria-label={`${tile.key}，${money(tile.value)}，${allocationPercent(tile.share)}`}
      aria-pressed={selected}
      className="allocation-tile absolute overflow-hidden text-left"
      data-label-font-size={metrics.fontSize}
      data-selected={selected}
      data-slice={tile.key}
      data-tile-height={tile.height}
      data-tile-width={tile.width}
      data-tile-x={tile.x}
      data-tile-y={tile.y}
      id={`${id}-${tile.key.replace(/[^A-Za-z0-9]/g, '')}`}
      onClick={onSelect}
      style={{
        background: tile.color,
        borderRadius: metrics.radius,
        height: Math.max(0, tile.height - metrics.gap),
        left: tile.x + metrics.gap / 2,
        padding: metrics.padding,
        top: tile.y + metrics.gap / 2,
        width: Math.max(0, tile.width - metrics.gap),
      }}
      type="button"
    >
      <span
        className="flex h-full min-h-0 flex-col items-start justify-end"
        data-chart-label={tile.key}
        data-label-font-size={metrics.fontSize}
        style={{ fontSize: metrics.fontSize, gap: metrics.fontSize * 0.24, lineHeight: 1 }}
      >
        <span className="flex min-w-0 items-center font-semibold" style={{ gap: metrics.fontSize * 0.34 }}>
          <AssetMark asset={tile.key} size={metrics.markSize} />
          <span className="truncate">{tile.key}</span>
        </span>
        <span className="tnum whitespace-nowrap font-semibold tracking-tight" style={{ fontSize: metrics.fontSize * 1.08 }}>
          {moneyCompact(tile.value)}
        </span>
        <span className="tnum whitespace-nowrap font-medium" style={{ fontSize: metrics.fontSize * 0.88 }}>
          {allocationPercent(tile.share)}
        </span>
      </span>
    </button>
  )
}

/** 金额用区域面积表达；标签与 logo 随区域同步缩放，不再受圆弧宽度限制。 */
export function AllocationMap({ items, selected, onSelect }: {
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
  const tiles = allocationTiles(items, geo.width, geo.height)
  const toggle = (key: string) => onSelect(selected === key ? null : key)
  return (
    <div className="allocation-chart relative mx-auto w-full max-w-[680px]" ref={ref} style={{ height: geo.height }}>
      <div
        aria-label="多头持仓面积图，区域面积表示多头占比"
        className="allocation-map absolute left-1/2 top-0 -translate-x-1/2 overflow-hidden"
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); onSelect(null); return }
          const current = (event.target as HTMLElement).closest<HTMLElement>('[data-slice]')
          if (!current) return
          const index = tiles.findIndex((tile) => tile.key === current.dataset.slice)
          const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? index + 1
            : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? index - 1
              : event.key === 'Home' ? 0 : event.key === 'End' ? tiles.length - 1 : null
          if (next !== null) {
            event.preventDefault()
            ref.current?.querySelectorAll<HTMLElement>('[data-slice]')[(next + tiles.length) % tiles.length]?.focus()
          }
        }}
        role="group"
        style={{ height: geo.height, width: geo.width }}
      >
        {tiles.length > 0 ? tiles.map((tile) => (
          <Tile
            id={id}
            key={tile.key}
            onSelect={() => toggle(tile.key)}
            selected={selected === tile.key}
            tile={tile}
          />
        )) : (
          <div className="grid h-full place-items-center rounded-2xl bg-sheet-2 text-sm text-ink-3">暂无多头敞口</div>
        )}
      </div>
    </div>
  )
}

export function Swatch({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden="true" className={cn('inline-block size-2 shrink-0 rounded-full', className)} style={{ background: color }} />
}
