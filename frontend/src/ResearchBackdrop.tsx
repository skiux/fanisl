import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import type { CSSProperties } from 'react'

export type ResearchBackdropHandle = {
  update: (progress: number) => void
}

type Candle = {
  open: number
  high: number
  low: number
  close: number
  volume: number
}

type FieldStyle = CSSProperties & {
  '--step'?: number
}

const WIDTH = 1200
const PLOT_TOP = 54
const PLOT_BOTTOM = 346
const VOLUME_TOP = 404
const VOLUME_BOTTOM = 498
const CANDLE_COUNT = 66
const X_START = 46
const X_STEP = 17

function clamp(value: number) {
  return Math.min(1, Math.max(0, value))
}

function buildCandles(): Candle[] {
  const candles: Candle[] = []
  let previousClose = 105

  for (let index = 0; index < CANDLE_COUNT; index += 1) {
    const pullback = 15 * Math.exp(-((index - 38) ** 2) / 46)
    const center = 104 + index * 0.62 + Math.sin(index * 0.23) * 4.8 + Math.sin(index * 0.095) * 6.2 - pullback
    const open = index === 0 ? center - 1.2 : previousClose + Math.sin(index * 1.74) * 1.25
    const close = center + Math.sin(index * 1.17) * 2.1
    const high = Math.max(open, close) + 1.1 + Math.abs(Math.sin(index * 0.91)) * 2.3
    const low = Math.min(open, close) - 1.2 - Math.abs(Math.cos(index * 0.77)) * 2.1
    const volume = 22 + Math.abs(close - open) * 9 + Math.abs(Math.sin(index * 0.42)) * 23 + (index === 38 ? 35 : 0)

    candles.push({ open, high, low, close, volume })
    previousClose = close
  }

  return candles
}

function ema(values: number[], period: number) {
  const multiplier = 2 / (period + 1)
  return values.reduce<number[]>((result, value, index) => {
    result.push(index === 0 ? value : value * multiplier + result[index - 1] * (1 - multiplier))
    return result
  }, [])
}

function createLinePath(values: number[], toX: (index: number) => number, toY: (value: number) => number) {
  return values
    .map((value, index) => `${index === 0 ? 'M' : 'L'}${toX(index).toFixed(2)} ${toY(value).toFixed(2)}`)
    .join(' ')
}

const ResearchBackdrop = forwardRef<ResearchBackdropHandle>(function ResearchBackdrop(_props, ref) {
  const field = useRef<HTMLDivElement>(null)
  const cursor = useRef<SVGGElement>(null)
  const trace = useRef<SVGLineElement>(null)
  const candles = useMemo(buildCandles, [])

  const geometry = useMemo(() => {
    const values = candles.flatMap((candle) => [candle.low, candle.high])
    const minimum = Math.min(...values) - 3
    const maximum = Math.max(...values) + 3
    const volumeMaximum = Math.max(...candles.map((candle) => candle.volume))
    const closeValues = candles.map((candle) => candle.close)
    const fast = ema(closeValues, 12)
    const slow = ema(closeValues, 26)
    const toX = (index: number) => X_START + index * X_STEP
    const toY = (value: number) => PLOT_BOTTOM - ((value - minimum) / (maximum - minimum)) * (PLOT_BOTTOM - PLOT_TOP)
    const toVolumeY = (value: number) => VOLUME_BOTTOM - (value / volumeMaximum) * (VOLUME_BOTTOM - VOLUME_TOP)

    return {
      fast,
      fastPath: createLinePath(fast, toX, toY),
      slowPath: createLinePath(slow, toX, toY),
      toVolumeY,
      toX,
      toY,
    }
  }, [candles])

  useImperativeHandle(ref, () => ({
    update(progress: number) {
      const value = clamp(progress)
      const index = Math.min(CANDLE_COUNT - 1, Math.floor(value * (CANDLE_COUNT - 1)))
      const candle = candles[index]
      const x = geometry.toX(index)
      const y = geometry.toY(candle.close)

      field.current?.style.setProperty('--field-progress', value.toFixed(4))
      cursor.current?.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`)
      trace.current?.setAttribute('x1', x.toFixed(2))
      trace.current?.setAttribute('x2', x.toFixed(2))
    },
  }), [candles, geometry])

  return (
    <div aria-hidden="true" className="research-backdrop" ref={field}>
      <picture className="research-material">
        <source media="(max-width: 760px)" srcSet="/assets/research-paper-field-mobile.jpg" />
        <img alt="" src="/assets/research-paper-field.jpg" />
      </picture>
      <div className="research-shadow" />

      <svg className="research-echo" viewBox={`0 0 ${WIDTH} 520`}>
        <path d={geometry.slowPath} pathLength="1" />
        <path d={geometry.fastPath} pathLength="1" />
      </svg>

      <div className="research-chart-plane">
        <svg className="research-chart" viewBox={`0 0 ${WIDTH} 520`}>
          <defs>
            <filter id="graphite-drift" x="-10%" y="-20%" width="120%" height="140%">
              <feTurbulence baseFrequency=".72" numOctaves="2" seed="11" type="fractalNoise" result="grain" />
              <feDisplacementMap in="SourceGraphic" in2="grain" scale=".72" xChannelSelector="R" yChannelSelector="G" />
            </filter>
            <linearGradient id="volume-wash" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#69795d" stopOpacity=".47" />
              <stop offset="1" stopColor="#69795d" stopOpacity=".07" />
            </linearGradient>
          </defs>

          <g className="research-grid">
            {[0, 1, 2, 3, 4].map((line) => {
              const y = PLOT_TOP + line * ((PLOT_BOTTOM - PLOT_TOP) / 4)
              return <path d={`M30 ${y} H1170`} key={`horizontal-${line}`} pathLength="1" />
            })}
            {[0, 1, 2, 3, 4, 5, 6].map((line) => {
              const x = 46 + line * 184
              return <path d={`M${x} 36 V500`} key={`vertical-${line}`} pathLength="1" />
            })}
          </g>

          <g className="research-volume">
            {candles.map((candle, index) => {
              const x = geometry.toX(index)
              const y = geometry.toVolumeY(candle.volume)
              return (
                <rect
                  height={VOLUME_BOTTOM - y}
                  key={`volume-${index}`}
                  style={{ '--step': index / (CANDLE_COUNT - 1) } as FieldStyle}
                  width="8"
                  x={x - 4}
                  y={y}
                />
              )
            })}
          </g>

          <g className="research-candles" filter="url(#graphite-drift)">
            {candles.map((candle, index) => {
              const x = geometry.toX(index)
              const openY = geometry.toY(candle.open)
              const closeY = geometry.toY(candle.close)
              const highY = geometry.toY(candle.high)
              const lowY = geometry.toY(candle.low)
              const bodyY = Math.min(openY, closeY)
              const bodyHeight = Math.max(2.4, Math.abs(closeY - openY))
              const rising = candle.close >= candle.open
              const style = { '--step': index / (CANDLE_COUNT - 1) } as FieldStyle

              return (
                <g className={rising ? 'is-rising' : 'is-falling'} key={`candle-${index}`} style={style}>
                  <line x1={x} x2={x} y1={highY} y2={lowY} />
                  <rect height={bodyHeight} rx=".7" width="7.4" x={x - 3.7} y={bodyY} />
                </g>
              )
            })}
          </g>

          <g className="research-averages" filter="url(#graphite-drift)">
            <path className="ema-slow-shadow" d={geometry.slowPath} pathLength="1" />
            <path className="ema-slow" d={geometry.slowPath} pathLength="1" />
            <path className="ema-fast-shadow" d={geometry.fastPath} pathLength="1" />
            <path className="ema-fast" d={geometry.fastPath} pathLength="1" />
          </g>

          <g className="research-note note-method">
            <path d="M692 82 C730 52 769 47 811 58" pathLength="1" />
            <circle cx="689" cy="83" r="4" />
            <text x="820" y="60">METHOD / EMA 12·26</text>
          </g>
          <g className="research-note note-evidence">
            <path d="M332 311 C293 344 249 356 204 351" pathLength="1" />
            <circle cx="334" cy="309" r="4" />
            <text x="76" y="357">RAW EVIDENCE / 021</text>
          </g>
          <g className="research-note note-review">
            <path d="M957 237 C1013 228 1050 245 1080 275" pathLength="1" />
            <circle cx="954" cy="237" r="4" />
            <text x="1013" y="296">REVIEW / OPEN</text>
          </g>

          <line className="research-trace" ref={trace} y1="38" y2="500" />
          <g className="research-cursor" ref={cursor}>
            <circle className="cursor-orbit" r="18" />
            <circle className="cursor-dot" r="3.2" />
            <path d="M-27 0 H-8 M8 0 H27 M0 -27 V-8 M0 8 V27" />
          </g>

          <g className="research-axis">
            <text x="31" y="28">ILLUSTRATIVE SERIES · NORMALIZED</text>
            <text x="31" y="517">VOLUME / SOURCE DENSITY</text>
            <text textAnchor="end" x="1169" y="517">FANISL RESEARCH FIELD · 01</text>
          </g>
        </svg>
      </div>

      <div className="research-vignette" />
      <div className="research-grain" />
    </div>
  )
})

export default ResearchBackdrop
