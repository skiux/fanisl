import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { money } from '../lib/format'
import { allocationPercent, ringPath, sliceLayout, type DonutSlice } from '../lib/donut'

export type { DonutSlice } from '../lib/donut'

/** 选中只增加外沿标记；扇区的颜色、透明度和位置始终不变。 */
export function Donut({ slices, selected, onSelect, hub }: {
  slices: DonutSlice[]
  selected: string | null
  onSelect: (key: string | null) => void
  hub: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  const [width, setWidth] = useState(340)
  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    const measure = () => setWidth(Math.max(1, box.clientWidth))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  const center = width / 2
  const outer = Math.max(1, center - 14)
  const inner = outer * 0.59
  const middle = (inner + outer) / 2
  const placed = sliceLayout(slices)
  const toggle = (key: string) => onSelect(selected === key ? null : key)

  return (
    <div className="allocation-chart relative mx-auto aspect-square w-full max-w-[420px]" ref={ref}>
      <svg
        aria-labelledby={`${id}-title`}
        className="block size-full overflow-visible"
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); onSelect(null) }
        }}
        role="group"
        viewBox={`0 0 ${width} ${width}`}
      >
        <title id={`${id}-title`}>多头敞口构成，点击扇区选择资产</title>
        <circle cx={center} cy={center} fill="none" r={middle} stroke="var(--rule)" strokeWidth={outer - inner} />
        {placed.map((slice, index) => {
          const angle = slice.end - slice.start
          // 小额扇区的缝按自身角度缩小，绝不因固定描边而被整块盖掉。
          const gap = placed.length === 1 ? 0 : Math.min(0.009, angle * 0.08)
          const mid = (slice.start + slice.end) / 2
          const labelWidth = Math.max(slice.key.length * 7.5, 48)
          const labelFits = slice.share >= 0.09
            && 2 * middle * Math.sin(Math.min(angle, Math.PI) / 2) > labelWidth + 16
          const on = selected === slice.key
          return (
            <g key={slice.key}>
              <path
                aria-label={`${slice.key}，${money(slice.value)}，${allocationPercent(slice.share)}`}
                aria-pressed={on}
                className="donut-sector"
                d={ringPath(center, inner, outer, slice.start + gap, slice.end - gap)}
                data-slice={slice.key}
                fill={slice.color}
                onClick={() => toggle(slice.key)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    toggle(slice.key)
                  }
                  const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? index + 1
                    : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? index - 1
                      : event.key === 'Home' ? 0 : event.key === 'End' ? placed.length - 1 : null
                  if (next !== null) {
                    event.preventDefault()
                    const nodes = ref.current?.querySelectorAll<SVGElement>('[data-slice]')
                    nodes?.[(next + placed.length) % placed.length]?.focus()
                  }
                }}
                role="button"
                tabIndex={0}
              />
              {labelFits && (
                <g aria-hidden="true" className="pointer-events-none" fill="var(--ink)" textAnchor="middle">
                  <text
                    fontSize={12} fontWeight={500}
                    x={center + Math.cos(mid) * middle} y={center + Math.sin(mid) * middle - 5}
                  >{slice.key}</text>
                  <text
                    className="tnum" fontSize={15} fontWeight={500}
                    x={center + Math.cos(mid) * middle} y={center + Math.sin(mid) * middle + 15}
                  >{allocationPercent(slice.share)}</text>
                </g>
              )}
            </g>
          )
        })}
        <SelectionArc center={center} radius={outer + 6} slice={placed.find((slice) => slice.key === selected)} />
      </svg>
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center"
        style={{ width: inner * 1.7 }}
      >{hub}</div>
    </div>
  )
}

/** 同一个指示弧连续移动；中途改选从当前视觉位置接续，不从上一次目标角度重算。 */
function SelectionArc({ center, radius, slice }: {
  center: number
  radius: number
  slice?: { start: number; end: number }
}) {
  const angle = slice ? slice.end - slice.start : 0
  const span = angle >= Math.PI * 2 - 1e-10 ? angle : Math.max(angle - 0.012, 0.028)
  const target = slice ? (slice.start + slice.end - span) / 2 : undefined
  const ref = useRef<SVGCircleElement>(null)
  const animation = useRef<Animation | null>(null)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    if (target === undefined) {
      const current = getComputedStyle(node)
      const transform = current.transform
      const strokeDasharray = current.strokeDasharray
      animation.current?.cancel()
      animation.current = null
      Object.assign(node.style, { transform, strokeDasharray })
      return
    }
    const current = getComputedStyle(node)
    const matrix = current.transform.match(/^matrix\(([^)]+)\)$/)?.[1].split(',').map(Number)
    const start = matrix ? Math.atan2(matrix[1], matrix[0]) : target
    const end = start + Math.atan2(Math.sin(target - start), Math.cos(target - start))
    const dash = `${span / (Math.PI * 2)} 1`
    const from = { transform: `rotate(${start}rad)`, strokeDasharray: matrix ? current.strokeDasharray : dash }
    const to = { transform: `rotate(${end}rad)`, strokeDasharray: dash }
    // 先取正在呈现的状态，再取消旧动画；浏览器负责插值，无 JS 逐帧更新。
    animation.current?.cancel()
    Object.assign(node.style, to)
    if (matrix && node.animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      animation.current = node.animate([from, to], { duration: 460, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' })
    }
  }, [target, span])
  useEffect(() => () => animation.current?.cancel(), [])
  return (
    <circle
      aria-hidden="true"
      className="donut-indicator"
      cx={center} cy={center} fill="none" r={radius}
      pathLength={1}
      ref={ref}
      stroke="var(--ink)" strokeLinecap="round" strokeWidth={2}
      style={{
        opacity: slice ? 1 : 0,
        // 用归一化周长，缩放窗口时不会因旧的像素间隔而多画一截指示弧。
        transformOrigin: `${center}px ${center}px`,
      }}
    />
  )
}

export function Swatch({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden="true" className={cn('inline-block size-2 shrink-0 rounded-full', className)} style={{ background: color }} />
}
