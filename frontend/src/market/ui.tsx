import type { ReactNode } from 'react'

// --- 容器 -------------------------------------------------------------------

export function Panel({ title, right, children, className = '' }: {
  title?: string
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

export function PageShell({ title, sub, controls, children }: {
  title: string
  sub?: string
  controls?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex-1 overflow-y-auto bg-zinc-50">
      <div className="mx-auto max-w-[1400px] px-5 py-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900">{title}</h1>
            {sub && <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>}
          </div>
          {controls && <div className="flex flex-wrap items-center gap-2">{controls}</div>}
        </div>
        {children}
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

export function KpiRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 divide-x divide-zinc-200/70 overflow-hidden rounded-2xl border border-zinc-200/70 bg-white sm:grid-cols-3 lg:grid-cols-6">
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
