import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../lib/cn'
import { ICONS } from './icons'
import { tickerHue } from './Ticker'
import { moneyCompact, percent } from '../lib/format'

/**
 * 环形图。**自己画 SVG，不用图表库。**
 *
 * 这一版是推倒重来的，前面用 recharts 折腾了整整一周，每一个毛病都是库的内部实现
 * 漏出来的，而修一个又长出下一个：
 *
 *   `activeShape` 换元素 → 高亮闪                  改成只换 class
 *   `Cell` 的 `filterProps` 吃掉 style / opacity   改成只能走 className
 *   逐块 DOM 事件先 leave 后 enter                  转圈时整圈明暗strobe
 *   `viewBox` 被设成**实测像素**而非设计单位        手机上环画到容器外、被裁掉
 *   入场动画走 rAF，页面不可见时不发                整张图一块都不画
 *   画布上挂 `tabindex`                             点一下冒出个蓝色焦点框
 *
 * 而它替我们做的事只剩一件：把百分比换成弧线的 `d`。那是十几行三角函数。
 * 图例、提示框、动画、命中测试早就一个个换成自己写的了。所以**这一层根本不划算**：
 * 换来 96KB（gzip）和一周的返工。删掉之后代码反而更短，也不再有"库这么干"的意外。
 *
 * 两个尺寸档，不是同一套东西缩小：
 *
 *   宽（≥460px）  块里写图标 / 代码 / 占比 / 金额，小块走外侧引导线
 *   窄（<460px）  环上只留占比——环带就那么宽，硬塞四行只会挤成一团。
 *                 代码、金额、以及小到画不出的那些，全在调用方那张表里，
 *                 靠**色块**和环对上号（`swatch()`）。一样都不少。
 *
 * 坐标就是像素（viewBox 等于实测尺寸），所以字号写多少就是多少，窄屏一样清楚。
 */
export type DonutSlice = { key: string; value: number; color: string }

const NARROW = 460
const PAD_WIDE = 84
const PAD_NARROW = 14
/** 块之间的缝（弧度）。太大在小块上会把块吃没，0.8° 够看出分界 */
const SEAM = (0.8 * Math.PI) / 180
/** 外侧标签的最小垂直间距、引导线两段的长度 */
const LABEL_GAP = 28
const LEAD_1 = 14
const LEAD_2 = 20

type Geo = {
  w: number; h: number; cx: number; cy: number
  rOut: number; rIn: number; rMid: number; compact: boolean
}

function geometry(w: number): Geo {
  const compact = w < NARROW
  const pad = compact ? PAD_NARROW : PAD_WIDE
  const h = compact ? Math.min(w, 380) : Math.round(w / 1.286)
  const rOut = Math.max(56, Math.min((w - pad * 2) / 2, h / 2 - 10))
  const rIn = rOut * 0.56
  return { w, h, cx: w / 2, cy: h / 2, rOut, rIn, rMid: (rOut + rIn) / 2, compact }
}

/**
 * 一段环形的 `d`。
 *
 * `A` 的 large-arc-flag 要在**大于半圈**时置 1，否则 SVG 会挑短的那条路走——
 * 一块占七成的扇区会被画成剩下的三成。整圈是另一个特例：起点终点重合，
 * 画出来什么都没有，所以满圈直接交给 `<circle>`。
 */
function ring(geo: Geo, a0: number, a1: number) {
  const { cx, cy, rOut, rIn } = geo
  const at = (r: number, a: number) => `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`
  const large = a1 - a0 > Math.PI ? 1 : 0
  return `M${at(rOut, a0)} A${rOut},${rOut} 0 ${large} 1 ${at(rOut, a1)}`
    + ` L${at(rIn, a1)} A${rIn},${rIn} 0 ${large} 0 ${at(rIn, a0)} Z`
}

type Placed = DonutSlice & {
  frac: number
  /** 在整圈里的起止（0 = 12 点，顺时针到 1），命中测试用 */
  t0: number; t1: number
  rad: number
  inside: boolean
  lx: number; ly: number; side: 1 | -1
}

function layout(slices: DonutSlice[], total: number, geo: Geo): Placed[] {
  let cum = 0
  const placed: Placed[] = slices.map((slice) => {
    const frac = total > 0 ? slice.value / total : 0
    const t0 = cum
    cum += frac
    // 12 点起顺时针：屏幕角 = −90° + 360°×t
    const rad = (-90 + 360 * (t0 + frac / 2)) * (Math.PI / 180)
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const side: 1 | -1 = cos >= 0 ? 1 : -1
    return {
      ...slice, frac, t0, t1: cum, rad, side,
      // 窄屏没有外侧标签这条路：写不进环带就不写，明细在调用方那张表里
      inside: frac >= (geo.compact ? 0.08 : 0.08),
      lx: geo.cx + cos * (geo.rOut + LEAD_1) + side * LEAD_2,
      ly: Math.min(geo.h - 24, Math.max(24, geo.cy + sin * (geo.rOut + LEAD_1))),
    }
  })

  // 外侧标签同一侧上下推开：小块的弧中点常常差不到一度，不推就叠死
  for (const side of [1, -1] as const) {
    const col = placed.filter((it) => !it.inside && it.side === side)
      .sort((a, b) => a.ly - b.ly)
    for (let i = 1; i < col.length; i += 1) {
      if (col[i].ly - col[i - 1].ly < LABEL_GAP) col[i].ly = col[i - 1].ly + LABEL_GAP
    }
    const over = (col.at(-1)?.ly ?? 0) - (geo.h - 24)
    if (over > 0) for (const it of col) it.ly -= over
  }
  return placed
}

/** 标的图标。没有图标的画成带色字母片，和 `Ticker` 同一套色相 */
function Mark({ asset, x, y, r }: { asset: string; x: number; y: number; r: number }) {
  const file = ICONS[asset]
  const id = `dm-${asset.replace(/[^A-Za-z0-9]/g, '')}-${Math.round(r)}`
  if (!file) {
    return (
      <g>
        <circle cx={x} cy={y} fill={`oklch(0.90 0.05 ${tickerHue(asset)})`} r={r} />
        <text
          fill={`oklch(0.42 0.10 ${tickerHue(asset)})`}
          fontSize={r * 0.82}
          textAnchor="middle"
          x={x}
          y={y + r * 0.3}
        >
          {asset.slice(0, 3)}
        </text>
      </g>
    )
  }
  return (
    <g>
      <clipPath id={id}><circle cx={x} cy={y} r={r} /></clipPath>
      <image
        clipPath={`url(#${id})`}
        height={r * 2}
        href={`${import.meta.env.BASE_URL}icons/${file}`}
        width={r * 2}
        x={x - r}
        y={y - r}
      />
    </g>
  )
}

export function Donut({ slices, total, focus, onFocus, onPin, hub }: {
  slices: DonutSlice[]
  total: number
  focus: string | null
  onFocus: (key: string | null) => void
  /** `null` = 点在空白处，取消钉住 */
  onPin: (key: string | null) => void
  /** 圈心内容，由调用方给——它才知道该显示哪些数 */
  hub: React.ReactNode
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [over, setOver] = useState(false)

  // 尺寸要参与几何计算（半径、圈心、标签、命中测试全从它推），所以自己量
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const geo = useMemo(() => geometry(width), [width])
  const placed = useMemo(() => layout(slices, total, geo), [slices, total, geo])

  /**
   * 指针落在哪一块。**几何判断，不用每块各挂事件。**
   *
   * 逐块的 DOM 事件从 A 划到 B 是"先 A 的 leave、再 B 的 enter"，中间空一帧；
   * 块之间的缝更是实打实的洞——转一圈就闪一路。画布类的库（Chart.js / ECharts）
   * 天生没这问题，因为它们本来就只在一个面上按坐标判断。这里照做。
   */
  const hitTest = (event: { clientX: number; clientY: number; currentTarget: HTMLElement }) => {
    const box = event.currentTarget.getBoundingClientRect()
    const dx = event.clientX - box.left - geo.cx
    const dy = event.clientY - box.top - geo.cy
    const r = Math.hypot(dx, dy)
    if (r < geo.rIn - 4 || r > geo.rOut + 8) return null
    const t = ((Math.atan2(dy, dx) + Math.PI / 2) / (2 * Math.PI) + 1) % 1
    return placed.find((slice) => t >= slice.t0 && t < slice.t1)?.key ?? null
  }

  return (
    <div className="relative min-w-0" ref={boxRef} style={{ height: geo.h || undefined }}>
      {width > 0 && (
        <svg className="block" height={geo.h} width={geo.w}>
          {placed.map((slice) => {
            const dim = focus !== null && focus !== slice.key
            // 缝从两头各吃一半；块本来就比缝还窄时不吃，否则它会消失
            const span = slice.frac * 2 * Math.PI
            const seam = span > SEAM * 2 ? SEAM / 2 : 0
            const a0 = -Math.PI / 2 + slice.t0 * 2 * Math.PI + seam
            const a1 = -Math.PI / 2 + slice.t1 * 2 * Math.PI - seam
            return (
              <path
                d={slice.frac >= 0.9999 ? fullRing(geo) : ring(geo, a0, a1)}
                fill={slice.color}
                key={slice.key}
                // 元素稳定、样式直接写在自己身上——不再受任何库的 prop 过滤影响
                opacity={dim ? 0.2 : 1}
              />
            )
          })}
          {placed.map((slice) => (
            <Label geo={geo} key={slice.key} on={focus === null || focus === slice.key} slice={slice} />
          ))}
        </svg>
      )}

      {/* 命中层盖住整张图，所有指针交互都走这里。点空白处 = 取消钉住 */}
      <div
        className="absolute inset-0"
        onClick={(event) => onPin(hitTest(event))}
        onPointerLeave={() => { setOver(false); onFocus(null) }}
        onPointerMove={(event) => {
          const key = hitTest(event)
          setOver(key !== null)
          onFocus(key)
        }}
        style={{ cursor: over ? 'pointer' : 'default' }}
      />

      <div className="pointer-events-none absolute inset-0 grid place-items-center">{hub}</div>
    </div>
  )
}

/** 满圈：起点终点重合，`A` 画不出来，用两个半圆凑 */
function fullRing(geo: Geo) {
  const { cx, cy, rOut, rIn } = geo
  return `M${cx - rOut},${cy} A${rOut},${rOut} 0 1 1 ${cx + rOut},${cy}`
    + ` A${rOut},${rOut} 0 1 1 ${cx - rOut},${cy} Z`
    + `M${cx - rIn},${cy} A${rIn},${rIn} 0 1 0 ${cx + rIn},${cy}`
    + ` A${rIn},${rIn} 0 1 0 ${cx - rIn},${cy} Z`
}

function Label({ slice, geo, on }: { slice: Placed; geo: Geo; on: boolean }) {
  if (slice.frac <= 0) return null
  const cos = Math.cos(slice.rad)
  const sin = Math.sin(slice.rad)
  const opacity = on ? 1 : 0.22

  if (slice.inside) {
    const x = geo.cx + cos * geo.rMid
    const y = geo.cy + sin * geo.rMid
    // 窄屏只写占比：环带就那么宽，代码与金额在调用方那张表里
    if (geo.compact) {
      return (
        <g className="pie-label" opacity={opacity}>
          <text className="tnum" fill="var(--ink)" fontSize={17} fontWeight={500} textAnchor="middle" x={x} y={y + 6}>
            {(slice.frac * 100).toFixed(1)}%
          </text>
        </g>
      )
    }
    return (
      <g className="pie-label" opacity={opacity}>
        <Mark asset={slice.key} r={12} x={x} y={y - 26} />
        <text fill="var(--ink-2)" fontSize={11} textAnchor="middle" x={x} y={y - 4}>{slice.key}</text>
        <text className="tnum" fill="var(--ink)" fontSize={19} fontWeight={500} textAnchor="middle" x={x} y={y + 16}>
          {(slice.frac * 100).toFixed(1)}%
        </text>
        <text className="tnum" fill="var(--ink-2)" fontSize={10.5} textAnchor="middle" x={x} y={y + 31}>
          {moneyCompact(slice.value)}
        </text>
      </g>
    )
  }

  // 窄屏不画外侧标签：那点地方放不下引导线，硬画就是一圈碎字
  if (geo.compact) return null

  const ax = geo.cx + cos * (geo.rOut + 2)
  const ay = geo.cy + sin * (geo.rOut + 2)
  const bx = geo.cx + cos * (geo.rOut + LEAD_1)
  return (
    <g className="pie-label" opacity={opacity}>
      <polyline
        fill="none"
        points={`${ax},${ay} ${bx},${slice.ly} ${slice.lx},${slice.ly}`}
        stroke="var(--rule-strong)"
        strokeWidth={1}
      />
      <Mark asset={slice.key} r={7} x={slice.lx + slice.side * 9} y={slice.ly} />
      <text
        fill="var(--ink-2)"
        fontSize={10.5}
        textAnchor={slice.side === 1 ? 'start' : 'end'}
        x={slice.lx + slice.side * 20}
        y={slice.ly - 2}
      >
        {slice.key}
      </text>
      <text
        className="tnum"
        fill="var(--ink-3)"
        fontSize={10}
        textAnchor={slice.side === 1 ? 'start' : 'end'}
        x={slice.lx + slice.side * 20}
        y={slice.ly + 11}
      >
        {percent(slice.frac, 1)} · {moneyCompact(slice.value)}
      </text>
    </g>
  )
}

/** 图例色块：调用方那张表靠它和环对上号 */
export function Swatch({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn('inline-block size-2.5 shrink-0 rounded-[2px]', className)}
      style={{ background: color }}
    />
  )
}
