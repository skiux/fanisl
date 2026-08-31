import { useEffect, useMemo, useRef, useState } from 'react'
import { apiJson } from '../../shared/api/client'
import type { AssetEvent, OpenClaim, PriceWindow, SettledClaim, SettledOutcome } from './types'

const outcomeMarks: Record<SettledOutcome, string> = {
  hit: '✓', partial: '½', miss: '×',
  condition_not_met: '○', condition_unverifiable: '?', unpriceable: '—', pending: '…',
}

const WINDOW_DAYS = 180        // 回看窗口
const FUTURE_DAYS = 120        // 未来区最多画到多远（再远的到期日只进"未到期"分节）

type LoadState = 'idle' | 'loading' | 'loaded' | 'error'

function dayOf(value: string) {
  return Date.parse(`${value.slice(0, 10)}T00:00:00Z`)
}

/**
 * 价格证据图：过去用日线收盘，判定打在它落地的那根 K 上；未来区画尚未到期的阶梯日。
 *
 * 图按容器的**实际像素**画（ResizeObserver 量），不是固定 viewBox 缩放——它停在一个
 * 可拖的窗格里，拖高就该多画一点，而不是把同一张图放大。
 */
function PriceEvidence({ symbol, note, settled, open, events = [] }: {
  symbol: string
  note: string
  settled: SettledClaim[]
  open: OpenClaim[]
  events?: AssetEvent[]
}) {
  const [data, setData] = useState<PriceWindow | null>(null)
  const [state, setState] = useState<LoadState>('idle')
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 720, height: 260 })

  useEffect(() => {
    const controller = new AbortController()
    const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10)
    setState('loading')
    setData(null)
    apiJson<PriceWindow>(`/knowledge/prices?symbol=${encodeURIComponent(symbol)}&since=${since}`,
      { signal: controller.signal })
      .then((payload) => { setData(payload); setState('loaded') })
      .catch(() => { if (!controller.signal.aborted) setState('error') })
    return () => controller.abort()
  }, [symbol])

  useEffect(() => {
    const element = box.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      setSize({
        width: Math.max(320, Math.round(rect.width)),
        height: Math.max(150, Math.round(rect.height)),
      })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const bars = useMemo(() => data?.bars ?? [], [data])
  const geometry = useMemo(() => {
    if (bars.length === 0) return null
    const { width, height } = size
    const left = 48
    const right = 18
    const top = 20
    const bottom = 28
    const chartWidth = width - left - right
    const chartHeight = height - top - bottom

    const today = dayOf(new Date().toISOString())
    const horizonCap = today + FUTURE_DAYS * 86400000
    const upcoming = open
      .map((item) => dayOf(item.horizon_label))
      .filter((value) => Number.isFinite(value) && value <= horizonCap)
    // 下次财报也要进轴：这一页最有用的一个对照就是"哪些判断的到期日排在财报之后"。
    const nextEarnings = events
      .filter((event) => event.kind === 'earnings')
      .map((event) => dayOf(event.event_date))
      .filter((value) => Number.isFinite(value) && value >= today && value <= horizonCap)
    const start = dayOf(bars[0].ts)
    const lastBar = dayOf(bars[bars.length - 1].ts)
    const end = Math.max(lastBar, ...upcoming, ...nextEarnings, today)
    const span = Math.max(end - start, 86400000)

    const values = bars.flatMap((bar) => [bar.low, bar.high])
    const maximum = Math.max(...values)
    const minimum = Math.min(...values)
    const range = Math.max(maximum - minimum, Math.abs(maximum) * .005, 1e-6)
    const x = (time: number) => left + ((time - start) / span) * chartWidth
    const y = (value: number) => top + ((maximum - value) / range) * chartHeight

    // 判定落在哪根 K 上：取「不晚于到期日的最后一根」。找不到（到期日早于窗口）就不画。
    const barAtOrBefore = (time: number) => {
      let found: typeof bars[number] | null = null
      for (const bar of bars) {
        if (dayOf(bar.ts) <= time) found = bar
        else break
      }
      return found
    }

    return { width, height, left, right, top, bottom, chartWidth, chartHeight,
             start, end, maximum, range, x, y, today, barAtOrBefore }
  }, [bars, events, open, size])

  const verdicts = useMemo(() => {
    if (!geometry) return []
    return settled.flatMap((item) => {
      const time = dayOf(item.horizon_label)
      if (!Number.isFinite(time) || time < geometry.start) return []
      const bar = geometry.barAtOrBefore(time)
      if (!bar) return []
      return [{ item, cx: geometry.x(time), cy: geometry.y(bar.close) }]
    })
  }, [geometry, settled])

  const deadlines = useMemo(() => {
    if (!geometry) return []
    const grouped = new Map<string, number>()
    open.forEach((item) => {
      const time = dayOf(item.horizon_label)
      if (!Number.isFinite(time) || time > geometry.end) return
      grouped.set(item.horizon_label, (grouped.get(item.horizon_label) ?? 0) + 1)
    })
    // 到期日会挤在一起（XAUUSD 实测未来 70 天里有 14 个时点），日期标签必须按间距抽稀，
    // 否则叠成一团黑。刻度线全画——密集本身是信息。
    let lastLabel = -Infinity
    return [...grouped.entries()]
      .map(([label, count]) => ({ label, count, x: geometry.x(dayOf(label)) }))
      .sort((left, right) => left.x - right.x)
      .map((item) => {
        const showLabel = item.x - lastLabel >= 44
        if (showLabel) lastLabel = item.x
        return { ...item, showLabel }
      })
  }, [geometry, open])

  // 财报画在底轴上：判断的到期日常常跨着财报，两者放在同一条轴上才看得出"谁在财报之后交卷"。
  const earnings = useMemo(() => {
    if (!geometry) return []
    const today = dayOf(new Date().toISOString())
    return events
      .filter((event) => event.kind === 'earnings')
      .map((event) => ({ event, time: dayOf(event.event_date) }))
      .filter(({ time }) => Number.isFinite(time) && time >= geometry.start && time <= geometry.end)
      .map(({ event, time }) => ({
        date: event.event_date,
        x: geometry.x(time),
        upcoming: time >= today,
      }))
  }, [events, geometry])

  return (
    <section className="asset-price" aria-label="价格证据">
      <header>
        <p>价格证据</p>
        <span>已发生的裁决与尚未到期的阶梯日，画在同一条时间轴上</span>
      </header>
      <div className="asset-price-chart" ref={box}>
        {state === 'loading' && <div className="asset-price-loading" aria-label="正在读取日线" />}
        {state === 'error' && <p className="asset-empty">日线窗口暂时不可用；判定与实测字段仍完整保留。</p>}
        {state === 'loaded' && bars.length === 0 && (
          <p className="asset-empty">最近 {WINDOW_DAYS} 天没有可用日线。该标的的判断因此只能人工核。</p>
        )}
        {state === 'loaded' && geometry && bars.length > 0 && (
          <svg aria-label={`${symbol} 价格证据图`} role="img"
               viewBox={`0 0 ${geometry.width} ${geometry.height}`}>
            {[0, .5, 1].map((ratio) => {
              const y = geometry.top + ratio * geometry.chartHeight
              return (
                <g className="asset-price-grid" key={ratio}>
                  <line x1={geometry.left} x2={geometry.width - geometry.right} y1={y} y2={y} />
                  <text x={geometry.left - 7} y={y + 3}>
                    {(geometry.maximum - ratio * geometry.range).toFixed(geometry.maximum < 100 ? 2 : 0)}
                  </text>
                </g>
              )
            })}
            {geometry.end > geometry.today && (
              <rect className="asset-price-future" x={geometry.x(geometry.today)} y={geometry.top}
                    width={Math.max(0, geometry.width - geometry.right - geometry.x(geometry.today))}
                    height={geometry.chartHeight} />
            )}
            <polyline className="asset-price-line"
                      points={bars.map((bar) => `${geometry.x(dayOf(bar.ts))},${geometry.y(bar.close)}`).join(' ')} />
            {deadlines.map((deadline) => (
              <g className="asset-price-deadline" key={deadline.label}>
                <line x1={deadline.x} x2={deadline.x} y1={geometry.top} y2={geometry.height - geometry.bottom} />
                {deadline.showLabel && <text x={deadline.x} y={geometry.top - 6}>{deadline.label.slice(5)}</text>}
              </g>
            ))}
            {earnings.map((mark) => (
              <g className="asset-price-earnings" data-upcoming={mark.upcoming ? 'true' : undefined}
                 key={mark.date}>
                <line x1={mark.x} x2={mark.x} y1={geometry.height - geometry.bottom - 7}
                      y2={geometry.height - geometry.bottom} />
                <polygon points={`${mark.x - 4},${geometry.height - geometry.bottom} `
                  + `${mark.x + 4},${geometry.height - geometry.bottom} `
                  + `${mark.x},${geometry.height - geometry.bottom - 6}`} />
              </g>
            ))}
            {verdicts.map(({ item, cx, cy }) => (
              <g className={`asset-price-verdict outcome-${item.outcome}`} key={item.score_id}>
                <circle cx={cx} cy={cy} r="4.5" />
                <text x={cx} y={cy - 9}>{outcomeMarks[item.outcome]}</text>
              </g>
            ))}
            <text className="asset-price-date" x={geometry.left} y={geometry.height - 8}>{bars[0].ts.slice(5, 10)}</text>
            <text className="asset-price-date" textAnchor="end"
                  x={geometry.width - geometry.right} y={geometry.height - 8}>
              {new Date(geometry.end).toISOString().slice(5, 10)}
            </text>
          </svg>
        )}
      </div>
      {state === 'loaded' && bars.length > 0 && (
        <footer className="asset-price-legend">
          <span><i />收盘价</span>
          {verdicts.length > 0 && <span><i className="mark-verdict" />已判定 {verdicts.length}</span>}
          {deadlines.length > 0 && <span><i className="mark-deadline" />待到期 {deadlines.length} 个时点</span>}
          {earnings.length > 0 && <span><i className="mark-earnings" />财报 {earnings.length} 次</span>}
          <b>{note || '日线收盘口径'}</b>
        </footer>
      )}
    </section>
  )
}

export default PriceEvidence
