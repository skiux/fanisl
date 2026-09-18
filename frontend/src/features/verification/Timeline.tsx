import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { dayLabel, kindLabels, RECORD_KINDS, type DaySummary } from './records'

// 手机上一天至少 4px：放不下就横向滑动，不把 270 天挤进 360px
const MIN_DAY_WIDTH = 4
const PAD_X = 14
const TOP = 22
const BOTTOM = 22
const MAX_UNIT = 7
const DAY_MS = 86400000
// 放大镜下面那道光束的高度：从时间轴底边一直画到卡片区顶上（中间是窗口标题那一行）
const FUNNEL_HEIGHT = 60

function timeOf(day: string) {
  return Date.parse(`${day}T00:00:00Z`)
}

function summaryText(entry: DaySummary) {
  return RECORD_KINDS.filter((kind) => entry[kind] > 0).map((kind) => `${kindLabels[kind]} ${entry[kind]}`).join(' · ')
}

/**
 * 判决时间轴：以今天为界，左边是已经到期的，命中往上长、未中往下垂；
 * 没有结论的（需复核、不可判）和还没到期的压在轴线上。一天一根。
 * 下面那屏卡片覆盖的日期（from–to）画成一块高亮，像放大镜在轴上的位置；点哪天，放大镜就移过去。
 *
 * 比例尺按未筛选的全量定（scale），切图例时轴线和柱高不跳。
 */
function Timeline({ days, end, from, mark, onSelect, onStep, scale, start, to, today }: {
  days: DaySummary[]
  end: string
  from: string | null
  /** 鼠标停在哪张卡片上，就在轴上标出它那天 */
  mark: string | null
  onSelect: (day: string) => void
  onStep: (delta: number) => void
  scale: DaySummary[]
  start: string
  to: string | null
  today: string
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 960, height: 160 })
  // 悬停的那天与提示框的横坐标（已减去横向滑动距离），在指针事件里算好，渲染时不读 ref
  const [hover, setHover] = useState<{ day: string; left: number } | null>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  // 用鼠标按住拖动时，放大镜跟着指针走
  const dragging = useRef<string | null>(null)
  const funnelId = useId()

  useEffect(() => {
    const element = scroller.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setBox({ width: element.clientWidth, height: element.clientHeight }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const spanDays = Math.max(1, Math.round((timeOf(end) - timeOf(start)) / DAY_MS))
  const width = Math.max(box.width, spanDays * MIN_DAY_WIDTH + PAD_X * 2)
  const height = box.height
  const dayWidth = (width - PAD_X * 2) / spanDays
  const barWidth = Math.min(8, Math.max(1.6, dayWidth - 1.2))
  const x = (day: string) => PAD_X + ((timeOf(day) - timeOf(start)) / DAY_MS + .5) * dayWidth

  const geometry = useMemo(() => {
    const up = Math.max(1, ...scale.map((entry) => Math.max(entry.hit + entry.partial, entry.due / 2)))
    const down = Math.max(1, ...scale.map((entry) => Math.max(entry.miss, entry.due / 2)))
    const plot = height - TOP - BOTTOM
    const unit = Math.min(MAX_UNIT, plot / (up + down))
    // 柱子画不满时整体居中，轴线按上下两边的最大量分配位置
    const axis = TOP + (plot - (up + down) * unit) / 2 + up * unit
    return { axis, unit }
  }, [height, scale])

  const months = useMemo(() => {
    const labels: Array<{ day: string; label: string }> = []
    const cursor = new Date(`${start.slice(0, 7)}-01T00:00:00Z`)
    while (cursor.getTime() <= timeOf(end)) {
      const day = cursor.toISOString().slice(0, 10)
      if (day >= start) labels.push({ day, label: `${cursor.getUTCMonth() + 1}月` })
      cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    }
    return labels
  }, [end, start])

  // 放大镜不在可视范围里（手机上横向滑动时）就把它滑到中间
  useEffect(() => {
    const element = scroller.current
    if (!element || !from || !to || element.scrollWidth <= element.clientWidth) return
    const target = (x(from) + x(to)) / 2 - element.clientWidth / 2
    if (Math.abs(element.scrollLeft - target) > element.clientWidth / 3) element.scrollTo({ left: target })
  })

  const nearestDay = (clientX: number) => {
    const svg = scroller.current?.querySelector('svg')
    if (!svg || days.length === 0) return null
    const offset = clientX - svg.getBoundingClientRect().left
    let best: DaySummary | null = null
    let distance = Infinity
    days.forEach((entry) => {
      const gap = Math.abs(x(entry.day) - offset)
      if (gap < distance) { best = entry; distance = gap }
    })
    return distance <= Math.max(10, dayWidth * 2) ? (best as DaySummary | null) : null
  }

  const hovered = hover ? days.find((entry) => entry.day === hover.day) ?? null : null
  const { axis, unit } = geometry
  const todayX = x(today)
  const lens = from && to
    ? { left: Math.min(x(from) - dayWidth / 2 - 3, x(from) - 6), width: Math.max(x(to) - x(from) + dayWidth + 6, 12) }
    : null
  const lensLeft = lens ? lens.left - scrollLeft : 0
  const lensRight = lens ? lens.left + lens.width - scrollLeft : 0

  return (
    <div className="verify-timeline">
      <div
        aria-label={`到期日时间轴，左右方向键前后移一天${from && to ? `，当前 ${dayLabel(from)} 至 ${dayLabel(to)}` : ''}`}
        className="verify-timeline-scroll"
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault()
            onStep(event.key === 'ArrowRight' ? 1 : -1)
          }
        }}
        onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
        ref={scroller}
        role="group"
        tabIndex={0}
      >
        <svg
          aria-hidden="true"
          height={height}
          onClick={(event) => { const entry = nearestDay(event.clientX); if (entry) onSelect(entry.day) }}
          onPointerDown={(event) => {
            // 触屏上按住是横向滑动时间轴，只有鼠标才拖放大镜
            if (event.pointerType !== 'mouse' || event.button !== 0) return
            const entry = nearestDay(event.clientX)
            if (!entry) return
            dragging.current = entry.day
            event.currentTarget.setPointerCapture(event.pointerId)
            onSelect(entry.day)
          }}
          onPointerLeave={() => setHover(null)}
          onPointerMove={(event) => {
            const entry = nearestDay(event.clientX)
            setHover(entry ? { day: entry.day, left: x(entry.day) - (scroller.current?.scrollLeft ?? 0) } : null)
            if (dragging.current && entry && entry.day !== dragging.current) {
              dragging.current = entry.day
              onSelect(entry.day)
            }
          }}
          onPointerUp={() => { dragging.current = null }}
          onPointerCancel={() => { dragging.current = null }}
          style={{ cursor: hovered ? 'pointer' : 'default' }}
          viewBox={`0 0 ${width} ${height}`}
          width={width}
        >
          {todayX < width - PAD_X && (
            <rect className="verify-timeline-future" height={height} width={width - Math.max(todayX, 0)} x={Math.max(todayX, 0)} y={0} />
          )}
          {months.map((month) => (
            <g className="verify-timeline-month" key={month.day}>
              <line x1={x(month.day) - dayWidth / 2} x2={x(month.day) - dayWidth / 2} y1={height - BOTTOM + 4} y2={height - BOTTOM + 10} />
              <text x={x(month.day) - dayWidth / 2 + 3} y={height - 5}>{month.label}</text>
            </g>
          ))}
          {lens && <rect className="verify-timeline-lens" height={height - TOP - BOTTOM + 10} rx="5" width={lens.width} x={lens.left} y={TOP - 5} />}
          <line className="verify-timeline-axis" x1={PAD_X} x2={width - PAD_X} y1={axis} y2={axis} />
          {todayX >= PAD_X && todayX <= width - PAD_X && (
            <g className="verify-timeline-today">
              <line x1={todayX} x2={todayX} y1={TOP - 6} y2={height - BOTTOM + 2} />
              <text x={todayX} y={TOP - 10}>今天</text>
            </g>
          )}
          {days.map((entry) => {
            const cx = x(entry.day)
            const left = cx - barWidth / 2
            const up = entry.hit * unit
            const partial = entry.partial * unit
            const none = entry.review + entry.void
            return (
              <g className={from && to && entry.day >= from && entry.day <= to ? 'is-selected' : undefined} key={entry.day}>
                {entry.hit > 0 && <rect className="tl-hit" height={Math.max(1, up - .8)} rx={Math.min(1.5, barWidth / 2)} width={barWidth} x={left} y={axis - up} />}
                {entry.partial > 0 && <rect className="tl-partial" height={Math.max(1, partial - .8)} rx={Math.min(1.5, barWidth / 2)} width={barWidth} x={left} y={axis - up - partial} />}
                {entry.miss > 0 && <rect className="tl-miss" height={Math.max(1, entry.miss * unit - .8)} rx={Math.min(1.5, barWidth / 2)} width={barWidth} x={left} y={axis + .8} />}
                {entry.due > 0 && (
                  <rect
                    className="tl-due"
                    height={Math.max(3, entry.due * unit)}
                    rx={barWidth / 2}
                    width={barWidth}
                    x={left}
                    y={axis - Math.max(3, entry.due * unit) / 2}
                  />
                )}
                {none > 0 && <circle className={entry.review > 0 ? 'tl-review' : 'tl-void'} cx={cx} cy={axis} r={Math.min(3.2, Math.max(2.2, barWidth / 2 + .6))} />}
              </g>
            )
          })}
          {hovered && <line className="verify-timeline-hover" x1={x(hovered.day)} x2={x(hovered.day)} y1={TOP - 4} y2={height - BOTTOM + 4} />}
          {!hovered && mark && (
            <g className="verify-timeline-mark">
              <line x1={x(mark)} x2={x(mark)} y1={TOP - 4} y2={height - BOTTOM + 4} />
              <circle cx={x(mark)} cy={TOP - 4} r="2.5" />
            </g>
          )}
        </svg>
      </div>
      {/* 放大镜到卡片区的一道光束：告诉人下面那屏卡片是轴上哪一段放大出来的 */}
      {lens && lensRight > 0 && lensLeft < box.width && (
        <svg aria-hidden="true" className="verify-timeline-funnel" height={FUNNEL_HEIGHT} viewBox={`0 0 ${box.width} ${FUNNEL_HEIGHT}`} width={box.width}>
          <defs>
            <linearGradient id={funnelId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="rgb(40, 49, 39)" stopOpacity=".09" />
              <stop offset="1" stopColor="rgb(40, 49, 39)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon fill={`url(#${funnelId})`} points={`${Math.max(0, lensLeft)},0 ${Math.min(box.width, lensRight)},0 ${box.width},${FUNNEL_HEIGHT} 0,${FUNNEL_HEIGHT}`} />
        </svg>
      )}
      {/* 提示放在滑动容器外面，按滑动距离换算横坐标，免得跟着内容一起滑走 */}
      {hovered && (
        <p
          className="verify-timeline-tip"
          style={{ left: Math.min(Math.max(hover?.left ?? 0, 100), box.width - 100) }}
        >
          <b>{dayLabel(hovered.day)}</b>{summaryText(hovered)}
        </p>
      )}
    </div>
  )
}

export default Timeline
