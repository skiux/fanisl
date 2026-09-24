import { useEffect, useMemo, useRef, useState } from 'react'
import { apiJson } from '../../shared/api/client'
import { outcomeLabels } from '../../shared/domain/labels'
import { magnitudeThresholds } from '../asset/format'
import type { VerificationOutcome, VerificationPriceWindow } from './types'

type Loaded = { key: string; data: VerificationPriceWindow | null; failed: boolean }

function dayOf(value: string) {
  return Date.parse(`${value.slice(0, 10)}T00:00:00Z`)
}

function shiftDay(value: string, days: number) {
  return new Date(dayOf(value) + days * 86400000).toISOString().slice(0, 10)
}

function tick(value: number, maximum: number) {
  const digits = Math.abs(maximum) < 10 ? 2 : Math.abs(maximum) < 1000 ? 1 : 0
  return value.toFixed(digits)
}

/**
 * 一条已判定判断的价格窗口：发布前一周到判定后几天的日线收盘。
 * 发布参考价从发布日画起，判界画成虚线，到期那根 K 上打裁决。
 */
function RecordChart({ evalTs, horizon, magnitude, outcome, publishedAt, refPrice, symbol }: {
  evalTs: string | null
  horizon: string
  magnitude: unknown
  outcome: VerificationOutcome
  publishedAt: string
  refPrice: number | null
  symbol: string
}) {
  const since = shiftDay(publishedAt, -7)
  const until = shiftDay(evalTs && evalTs.slice(0, 10) > horizon.slice(0, 10) ? evalTs : horizon, 3)
  const key = `${symbol}|${since}|${until}`
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const box = useRef<HTMLDivElement>(null)
  // 宽高都按容器量：高度由 CSS 定（桌面 220，手机 170），这里跟着画
  const [size, setSize] = useState({ width: 520, height: 220 })
  const { width, height } = size

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ symbol, since, until })
    apiJson<VerificationPriceWindow>(`/knowledge/prices?${params.toString()}`, { signal: controller.signal })
      .then((data) => setLoaded({ key, data, failed: false }))
      .catch(() => { if (!controller.signal.aborted) setLoaded({ key, data: null, failed: true }) })
    return () => controller.abort()
  }, [key, since, symbol, until])

  useEffect(() => {
    const element = box.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect?.width) setSize({ width: Math.max(280, Math.round(rect.width)), height: Math.max(140, Math.round(rect.height)) })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const current = loaded?.key === key ? loaded : null
  const bars = useMemo(() => current?.data?.bars ?? [], [current])
  // 判界按这次的阶梯日取：v3 的分档判界每个阶梯日一个数
  const thresholds = useMemo(() => magnitudeThresholds(magnitude, horizon).slice(0, 3), [horizon, magnitude])

  const chart = useMemo(() => {
    if (bars.length === 0) return null
    const left = 52
    const right = 14
    const top = 22
    const bottom = 24
    const start = dayOf(bars[0].ts)
    const end = Math.max(dayOf(bars[bars.length - 1].ts), dayOf(horizon))
    const values = [
      ...bars.flatMap((bar) => [bar.low, bar.high]),
      ...(refPrice === null ? [] : [refPrice]),
      ...thresholds.map((entry) => entry.value),
    ]
    const rawMax = Math.max(...values)
    const rawMin = Math.min(...values)
    // 利差这类序列整段只在零点几之间，最小跨度不能写死成 1，否则折线被压成一条直线
    const padding = Math.max(rawMax - rawMin, Math.abs(rawMax) * .004, 1e-6) * .08
    const maximum = rawMax + padding
    const minimum = rawMin - padding
    const x = (time: number) => left + ((time - start) / Math.max(end - start, 86400000)) * (width - left - right)
    const y = (value: number) => top + ((maximum - value) / (maximum - minimum)) * (height - top - bottom)
    // 裁决打在不晚于到期日的最后一根 K 上；到期日早于窗口（不该发生）就不打
    const horizonTime = dayOf(horizon)
    const verdictBar = [...bars].reverse().find((bar) => dayOf(bar.ts) <= horizonTime) ?? null
    return { left, right, top, bottom, start, end, maximum, minimum, x, y, verdictBar, horizonTime }
  }, [height, bars, horizon, refPrice, thresholds, width])

  const state = current === null ? 'loading' : current.failed ? 'error' : 'loaded'

  return (
    <figure className="verify-chart">
      <div className="verify-chart-box" ref={box}>
        {state === 'loading' && <div aria-label="正在读取价格" className="verify-chart-loading" />}
        {state === 'error' && <p className="verify-chart-empty">价格暂时读取不到</p>}
        {state === 'loaded' && !chart && <p className="verify-chart-empty">这段时间没有 {symbol} 的日线</p>}
        {state === 'loaded' && chart && (
          <svg aria-label={`${symbol} 价格走势`} height={height} role="img" viewBox={`0 0 ${width} ${height}`} width={width}>
            {[0, .5, 1].map((ratio) => {
              const value = chart.maximum - ratio * (chart.maximum - chart.minimum)
              const lineY = chart.y(value)
              return (
                <g className="verify-chart-grid" key={ratio}>
                  <line x1={chart.left} x2={width - chart.right} y1={lineY} y2={lineY} />
                  <text x={chart.left - 8} y={lineY + 3}>{tick(value, chart.maximum)}</text>
                </g>
              )
            })}
            {thresholds.map((entry) => (
              <g className="verify-chart-threshold" key={entry.key}>
                <line x1={chart.left} x2={width - chart.right} y1={chart.y(entry.value)} y2={chart.y(entry.value)} />
                <text x={chart.left + 4} y={chart.y(entry.value) - 4}>{entry.label} {entry.value}</text>
              </g>
            ))}
            {refPrice !== null && (
              <g className="verify-chart-reference">
                <line
                  x1={Math.max(chart.left, chart.x(dayOf(publishedAt)))}
                  x2={width - chart.right}
                  y1={chart.y(refPrice)}
                  y2={chart.y(refPrice)}
                />
                <circle cx={Math.max(chart.left, chart.x(dayOf(publishedAt)))} cy={chart.y(refPrice)} r="3" />
                <text x={width - chart.right} y={chart.y(refPrice) - 5}>发布 {refPrice}</text>
              </g>
            )}
            <polyline
              className="verify-chart-line"
              points={bars.map((bar) => `${chart.x(dayOf(bar.ts))},${chart.y(bar.close)}`).join(' ')}
            />
            {chart.verdictBar && (
              <g className={`verify-chart-verdict outcome-${outcome}`}>
                <line x1={chart.x(chart.horizonTime)} x2={chart.x(chart.horizonTime)} y1={chart.top} y2={height - chart.bottom} />
                <circle cx={chart.x(chart.horizonTime)} cy={chart.y(chart.verdictBar.close)} r="4.5" />
                <text
                  textAnchor={chart.x(chart.horizonTime) > width - 60 ? 'end' : 'middle'}
                  x={chart.x(chart.horizonTime)}
                  y={chart.top - 8}
                >
                  {outcomeLabels[outcome]}
                </text>
              </g>
            )}
            <text className="verify-chart-date" x={chart.left} y={height - 6}>{bars[0].ts.slice(5, 10)}</text>
            <text className="verify-chart-date" textAnchor="end" x={width - chart.right} y={height - 6}>
              {new Date(chart.end).toISOString().slice(5, 10)}
            </text>
          </svg>
        )}
      </div>
      {state === 'loaded' && chart && current?.data?.note && <figcaption>{current.data.note}</figcaption>}
    </figure>
  )
}

export default RecordChart
