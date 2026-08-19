import { useMemo, useState, type CSSProperties } from 'react'
import { Eyebrow } from '../../components/Primitives'
import { cn } from '../../lib/cn'
import { DUST_THRESHOLD_USD, money, percent } from '../../lib/format'
import type { Balance } from '../../api/types'

const RAMP = ['var(--seg-1)', 'var(--seg-2)', 'var(--seg-3)', 'var(--seg-4)', 'var(--seg-5)', 'var(--seg-6)']
const TOP_N = 6

export type Segment = {
  key: string
  label: string
  value: number
  share: number
  color: string
  count: number
}

export function buildSegments(balances: Balance[]): { segments: Segment[]; total: number } {
  const byAsset = new Map<string, number>()
  for (const item of balances) {
    if (item.value_usd === null) continue
    byAsset.set(item.asset, (byAsset.get(item.asset) ?? 0) + item.value_usd)
  }
  const ranked = [...byAsset.entries()].sort((a, b) => b[1] - a[1])
  const total = ranked.reduce((sum, [, value]) => sum + value, 0)
  if (total <= 0) return { segments: [], total: 0 }

  const major = ranked.filter(([, value]) => value >= DUST_THRESHOLD_USD).slice(0, TOP_N)
  const majorKeys = new Set(major.map(([asset]) => asset))
  const rest = ranked.filter(([asset]) => !majorKeys.has(asset))
  const restValue = rest.reduce((sum, [, value]) => sum + value, 0)

  const segments: Segment[] = major.map(([asset, value], index) => ({
    key: asset,
    label: asset,
    value,
    share: value / total,
    color: RAMP[index] ?? 'var(--seg-6)',
    count: 1,
  }))
  if (restValue > 0) {
    segments.push({
      key: '__rest__',
      label: `其余 ${rest.length} 项`,
      value: restValue,
      share: restValue / total,
      color: 'var(--seg-dust)',
      count: rest.length,
    })
  }
  return { segments, total }
}

export function AllocationBar({ balances, veiled }: { balances: Balance[]; veiled: boolean }) {
  const [active, setActive] = useState<string | null>(null)
  const { segments, total } = useMemo(() => buildSegments(balances), [balances])

  if (segments.length === 0) return null
  const hovered = segments.find((s) => s.key === active) ?? null

  return (
    <section className={cn('rise', veiled && 'veiled')} style={{ '--i': 2 } as CSSProperties}>
      <div className="flex items-baseline justify-between gap-4">
        <Eyebrow>配置 · Allocation</Eyebrow>
        <span className="tnum text-[12px] text-fg-3">
          {hovered
            ? `${hovered.label} · ${money(hovered.value)}`
            : `${segments.length} 组 · ${money(total)}`}
        </span>
      </div>

      <div
        className="mt-3 flex h-2.5 w-full gap-[3px] overflow-hidden"
        onMouseLeave={() => setActive(null)}
        role="img"
        aria-label={`资产配置：${segments.map((s) => `${s.label} ${percent(s.share)}`).join('，')}`}
      >
        {segments.map((segment) => (
          <button
            aria-label={`${segment.label} ${percent(segment.share)}`}
            className={cn(
              'h-full min-w-[3px] rounded-[2px] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
              active && active !== segment.key ? 'opacity-35' : 'opacity-100',
            )}
            key={segment.key}
            onFocus={() => setActive(segment.key)}
            onBlur={() => setActive(null)}
            onMouseEnter={() => setActive(segment.key)}
            style={{ flexGrow: segment.share, background: segment.color }}
            type="button"
          />
        ))}
      </div>

      <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2.5">
        {segments.map((segment) => (
          <li
            className={cn(
              'flex items-center gap-2 transition-opacity duration-200',
              active && active !== segment.key ? 'opacity-40' : 'opacity-100',
            )}
            key={segment.key}
            onMouseEnter={() => setActive(segment.key)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="size-2 rounded-[2px]" style={{ background: segment.color }} />
            <span className="text-[12.5px] text-fg-2">{segment.label}</span>
            <span className="tnum text-[12.5px] text-fg-3">{percent(segment.share)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
