import type { ReactNode } from 'react'

// --- 容器 -------------------------------------------------------------------

export function Panel({ title, right, children, className = '' }: {
  title?: ReactNode
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-2xl border border-zinc-200/70 bg-white shadow-[0_1px_2px_rgba(24,24,27,0.04)] ${className}`}
    >
      {(title || right) && (
        <div className="flex items-center justify-between px-4 pt-3.5">
          <span className="text-[13px] font-medium text-zinc-500">{title}</span>
          {right}
        </div>
      )}
      <div className="p-4 pt-3">{children}</div>
    </div>
  )
}

// 页面骨架：页头固定不滚，内容区独立滚动
export function PageShell({ title, sub, controls, children }: {
  title: ReactNode
  sub?: string
  controls?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-zinc-50">
      <div className="shrink-0 border-b border-zinc-200/60 px-5 py-3">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold tracking-tight text-zinc-900">{title}</h1>
            {sub && <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>}
          </div>
          {controls && <div className="flex flex-wrap items-center gap-2">{controls}</div>}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1400px] px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

export function SectionTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold tracking-tight text-zinc-800">{children}</h2>
      {sub && <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>}
    </div>
  )
}

// --- KPI 条（用分隔线而非卡片堆叠）-----------------------------------------

export function KpiRow({ children, cols = 6 }: { children: ReactNode; cols?: 4 | 6 | 8 }) {
  const grid = {
    4: 'sm:grid-cols-2 lg:grid-cols-4',
    6: 'sm:grid-cols-3 lg:grid-cols-6',
    8: 'sm:grid-cols-4 lg:grid-cols-8',
  }[cols]
  return (
    <div className={`grid grid-cols-2 divide-x divide-zinc-200/70 overflow-hidden rounded-2xl border border-zinc-200/70 bg-white ${grid}`}>
      {children}
    </div>
  )
}

export function Kpi({ label, value, tone = 'neutral', sub }: {
  label: string
  value: string
  tone?: 'neutral' | 'up' | 'down'
  sub?: string
}) {
  const color = tone === 'up' ? 'text-emerald-600' : tone === 'down' ? 'text-rose-600' : 'text-zinc-900'
  return (
    <div className="px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</div>
      <div className={`mt-1 font-mono text-[15px] font-medium tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-zinc-400">{sub}</div>}
    </div>
  )
}

// --- 分段选择器 -------------------------------------------------------------

export function SegTabs<T extends string>({ options, value, onChange, size = 'md' }: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
}) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-[13px]'
  return (
    <div className="inline-flex gap-0.5 rounded-lg bg-zinc-100 p-0.5">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`rounded-md font-medium transition-colors active:translate-y-px ${pad} ${
              on ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// --- 迷你折线（纯 SVG，轻量，适合大量并排）---------------------------------

export function Sparkline({ values, width = 104, height = 30 }: {
  values: number[]
  width?: number
  height?: number
}) {
  if (!values || values.length < 2) {
    return <div style={{ width, height }} className="rounded bg-zinc-50" />
  }
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
  const up = values[values.length - 1] >= values[0]
  const color = up ? '#10b981' : '#f43f5e'
  return (
    <svg width={width} height={height} className="block">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// --- 下拉选择（原生 select，样式化）----------------------------------------

export function Select({ value, onChange, options, className = '' }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  className?: string
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-lg border border-zinc-200 bg-white py-1.5 pl-3 pr-8 text-[13px] font-medium text-zinc-800 outline-none transition-colors hover:border-zinc-300 focus:border-zinc-400"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
      </svg>
    </div>
  )
}

// --- 状态 -------------------------------------------------------------------

export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return <div className="animate-pulse rounded-lg bg-zinc-100" style={{ height }} />
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      {icon && <div className="text-zinc-300">{icon}</div>}
      <div className="text-sm text-zinc-500">{title}</div>
      {hint && <div className="max-w-xs text-xs text-zinc-400">{hint}</div>}
    </div>
  )
}

// --- 数据表 -----------------------------------------------------------------

export function DataTable({ cols, rows, loading }: {
  cols: { key: string; label: string }[]
  rows: { name: string; cells: Record<string, string> }[]
  loading?: boolean
}) {
  if (loading && rows.length === 0) return <ChartSkeleton height={180} />
  if (rows.length === 0) return <EmptyState title="暂无数据" hint="采集器运行后此处出现数据" />
  return (
    <div className="overflow-x-auto rounded-2xl border border-zinc-200/70 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200/70">
            <th className="sticky left-0 bg-white px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-zinc-400">
              标的
            </th>
            {cols.map((c) => (
              <th key={c.key} className="whitespace-nowrap px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((r) => (
            <tr key={r.name} className="hover:bg-zinc-50/70">
              <td className="sticky left-0 bg-white px-4 py-2.5 text-left font-medium text-zinc-800">{r.name}</td>
              {cols.map((c) => (
                <td key={c.key} className="whitespace-nowrap px-4 py-2.5 text-right font-mono tabular-nums text-zinc-700">
                  {r.cells[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Freshness({ ts }: { ts?: string }) {
  if (!ts) return null
  const d = new Date(ts)
  const s = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return <span className="text-xs text-zinc-400">数据更新于 {s}</span>
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'high' | 'accent' }) {
  const cls =
    tone === 'high'
      ? 'bg-rose-50 text-rose-600'
      : tone === 'accent'
        ? 'bg-emerald-50 text-emerald-700'
        : 'bg-zinc-100 text-zinc-500'
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{children}</span>
}
