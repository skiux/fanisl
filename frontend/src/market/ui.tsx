import type { ReactNode } from 'react'
import type { Query } from '../lib/useQuery'

// V2 原语库。规范：frontend/DESIGN.md（§5 容器 / §12 验证 / §13 证据 / §15 交互）。
// 本文件不做页面布局，只提供文法级构件；页面不得绕过这里另造同类构件。

// --- 容器（§5：Block 无框靠留白；Panel 1px 边框无阴影；阴影仅 Overlay）------

export function Panel({ title, right, children, className = '' }: {
  title?: ReactNode
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-xl border border-zinc-200 bg-white ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between gap-3 px-4 pt-3">
          <span className="text-xs font-medium text-zinc-400">{title}</span>
          {right}
        </div>
      )}
      <div className="p-4 pt-3">{children}</div>
    </div>
  )
}

// 页面骨架（Instrument 容器）：页头固定（24px 标题，一屏唯一），内容区独立滚动
export function PageShell({ title, sub, controls, children }: {
  title: ReactNode
  sub?: ReactNode
  controls?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-zinc-50">
      <div className="shrink-0 border-b border-zinc-100 px-6 py-3">
        <div className="mx-auto flex max-w-[96rem] flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{title}</h1>
            {sub && <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>}
          </div>
          {controls && <div className="flex flex-wrap items-center gap-2">{controls}</div>}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[96rem] px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

// --- 统计文字行（§5.2：不用 KPI 卡片墙）------------------------------------

export interface StatItem {
  label: string
  value: string
  tone?: 'hit' | 'miss' | 'neutral'
  title?: string
  sub?: string
}

export function Statline({ items, className = '' }: { items: StatItem[]; className?: string }) {
  return (
    <div className={`flex flex-wrap items-baseline gap-x-6 gap-y-1.5 ${className}`}>
      {items.map((it) => (
        <span key={it.label} className="text-xs text-zinc-400" title={it.title}>
          {it.label}{' '}
          <b className={`font-mono text-sm font-medium tabular-nums ${
            it.tone === 'hit' ? 'text-verdict-hit' : it.tone === 'miss' ? 'text-verdict-miss' : 'text-zinc-800'
          }`}>{it.value}</b>
          {it.sub && <span className="ml-1 text-2xs text-zinc-400">{it.sub}</span>}
        </span>
      ))}
    </div>
  )
}

// --- 判决徽标（§12：戳不是奖章；灰是主角）-----------------------------------

const BADGE_TONES: Record<string, string> = {
  neutral: 'bg-zinc-100 text-zinc-500',
  hit: 'bg-emerald-50 text-verdict-hit',
  miss: 'bg-rose-50 text-verdict-miss',
  partial: 'bg-amber-50 text-verdict-partial',
}

export function Badge({ children, tone = 'neutral', title, mono = false }: {
  children: ReactNode
  tone?: keyof typeof BADGE_TONES
  title?: string
  mono?: boolean
}) {
  return (
    <span title={title}
      className={`rounded px-1.5 py-px text-2xs font-medium ${mono ? 'font-mono' : ''} ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  )
}

// 评分戳：MM-DD + 判决字符（DESIGN.md §9.1）。outcome → 字形与色调。
export const OUTCOME_BADGE: Record<string, { glyph: string; tone: keyof typeof BADGE_TONES; label: string }> = {
  hit: { glyph: '✓', tone: 'hit', label: '命中' },
  partial: { glyph: '½', tone: 'partial', label: '部分' },
  miss: { glyph: '✗', tone: 'miss', label: '落空' },
  condition_not_met: { glyph: '未触发', tone: 'neutral', label: '未触发' },
  condition_unverifiable: { glyph: '不可验', tone: 'neutral', label: '不可验' },
  unpriceable: { glyph: '无价格', tone: 'neutral', label: '无价格' },
}

export function ScoreBadge({ horizonLabel, outcome, evalClose }: {
  horizonLabel: string
  outcome: string
  evalClose?: number | null
}) {
  const o = OUTCOME_BADGE[outcome] ?? { glyph: outcome, tone: 'neutral' as const, label: outcome }
  const title = `${horizonLabel} · ${o.label}${evalClose != null ? ` · 评估价 ${evalClose}` : ''}`
  return <Badge tone={o.tone} title={title} mono>{horizonLabel.slice(5)} {o.glyph}</Badge>
}

// --- 证据文法（§13：引文块唯一形态——左竖线）--------------------------------

export function Quote({ locator, children, onLocator }: {
  locator?: string | null
  children: ReactNode
  onLocator?: () => void
}) {
  return (
    <blockquote className="border-l-2 border-zinc-200 pl-3.5 text-sm leading-[1.7] text-zinc-600">
      {locator && (
        onLocator ? (
          <button onClick={onLocator} title="定位到原文"
            className="mr-1.5 font-mono text-2xs text-zinc-400 transition-colors hover:text-zinc-700">
            {locator}
          </button>
        ) : (
          <span className="mr-1.5 font-mono text-2xs text-zinc-300">{locator}</span>
        )
      )}
      {children}
    </blockquote>
  )
}

// --- 时间纪律（§7 / R1：数字必带 as-of；stale 如实标注）--------------------

export function AsOf({ ts, staleAfterMin, prefix = '截至' }: {
  ts: Date | string | null
  staleAfterMin?: number
  prefix?: string
}) {
  if (!ts) return null
  const d = typeof ts === 'string' ? new Date(ts) : ts
  if (Number.isNaN(d.getTime())) return null
  const txt = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const ageMin = (Date.now() - d.getTime()) / 60000
  const stale = staleAfterMin != null && ageMin > staleAfterMin
  return (
    <span className="font-mono text-2xs text-zinc-400">
      {prefix} {txt}
      {stale && <span className="text-verdict-partial">（已 {ageMin >= 2880 ? `${Math.round(ageMin / 1440)} 天` : `${Math.round(ageMin / 60)} 小时`}未更新）</span>}
    </span>
  )
}

// --- 取数四态（R11：loading / error / empty / stale——空态不说谎）-----------

export function Skeleton({ height = 180 }: { height?: number }) {
  return <div className="animate-pulse rounded-lg bg-zinc-100" style={{ height }} />
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="py-10 text-center">
      <div className="text-base text-zinc-500">{title}</div>
      {hint && <div className="mx-auto mt-1 max-w-md text-xs text-zinc-400">{hint}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="py-8 text-center text-sm">
      <span className="text-verdict-miss">取数失败：{error}</span>
      {onRetry && (
        <button onClick={onRetry} className="ml-3 text-zinc-500 underline decoration-zinc-300 transition-colors hover:text-zinc-800">
          重试
        </button>
      )}
    </div>
  )
}

// 四态编排：error(无数据)→ErrorState；loading→Skeleton；有数据但轮询失败→内容+stale 注记。
// empty 判定交给页面（"空"的语义页面才知道，空态文案必须说真话）。
export function QueryGate<T>({ q, skeletonHeight = 180, children }: {
  q: Query<T>
  skeletonHeight?: number
  children: (data: T) => ReactNode
}) {
  if (q.data == null) {
    if (q.loading) return <Skeleton height={skeletonHeight} />
    if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />
    return <Skeleton height={skeletonHeight} />
  }
  return (
    <>
      {q.error && (
        <p className="mb-2 text-2xs text-verdict-partial">
          最近一次刷新失败（{q.error}），以下为 <AsOf ts={q.asOf} prefix="" /> 的数据。
        </p>
      )}
      {children(q.data)}
    </>
  )
}

// --- 控件 --------------------------------------------------------------------

export function SegTabs<T extends string>({ options, value, onChange, size = 'md' }: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm'
  return (
    <div className="inline-flex gap-0.5 rounded-lg bg-zinc-100 p-0.5">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button key={o.value} onClick={() => onChange(o.value)}
            className={`rounded-md font-medium transition-colors duration-150 active:translate-y-px ${pad} ${
              on ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-800'
            }`}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function Select({ value, onChange, options, className = '' }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  className?: string
}) {
  return (
    <div className={`relative ${className}`}>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-lg border border-zinc-200 bg-white py-1.5 pl-3 pr-8 text-sm font-medium text-zinc-800 outline-none transition-colors duration-150 hover:border-zinc-300 focus:border-zinc-400">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <svg className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
      </svg>
    </div>
  )
}

// --- 迷你折线（§8：只示形状，中性色；涨跌色只属于末值数字）-----------------

export function Sparkline({ values, width = 104, height = 30 }: {
  values: number[]
  width?: number
  height?: number
}) {
  if (!values || values.length < 2) return <div style={{ width, height }} className="rounded bg-zinc-50" />
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pad = 2
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (width - pad * 2) + pad
      const y = height - pad - ((v - min) / span) * (height - pad * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={width} height={height} className="block">
      <polyline points={pts} fill="none" stroke="#a1a1aa" strokeWidth={1.3} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// --- 图表共用参数（§8：轴 11px mono meta 色、横向网格线、无动画）------------

export const CHART = {
  grid: { stroke: '#f4f4f5', vertical: false as const },
  axisTick: { fontSize: 11, fill: '#a1a1aa', fontFamily: 'Geist Mono' },
  axisLine: { stroke: '#e4e4e7' },
  tooltip: { borderRadius: 12, border: '1px solid #e4e4e7', fontSize: 12, fontFamily: 'Geist Mono' },
  seriesMain: '#3f3f46',   // zinc-700 主序列
  seriesRef: '#a1a1aa',    // zinc-400 基准/对照（虚线）
  accent: '#059669',
}
