// 数值/时间格式化。数据跨度极大（价格 6万、资金费 0.00006、OI 26亿）。

export function fmtNum(v: number | null | undefined, opts?: { pct?: boolean; sig?: boolean }): string {
  if (v == null || Number.isNaN(v)) return '—'
  if (opts?.pct) return `${v >= 0 ? '' : ''}${(v * 100).toFixed(4)}%`
  const a = Math.abs(v)
  if (a >= 1e12) return (v / 1e12).toFixed(2) + 'T'
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B'
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M'
  if (a >= 1e3) return v.toLocaleString(undefined, { maximumFractionDigits: 1 })
  if (a >= 1) return v.toFixed(2)
  if (a === 0) return '0'
  return v.toPrecision(3)
}

export function fmtUsd(v: number | null | undefined): string {
  if (v == null) return '—'
  return '$' + fmtNum(v)
}

export function fmtSignedPct(v: number | null | undefined, digits = 2): string {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`
}

// 按登记表的 unit 格式化数值（前端展示用）
export function fmtByUnit(v: number | null | undefined, unit: string): string {
  if (v == null || Number.isNaN(v)) return '—'
  switch (unit) {
    case 'usd': return fmtUsd(v)
    case 'price': return fmtNum(v)
    case 'pct': return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
    case 'rate': return (v * 100).toFixed(4) + '%'
    case 'bps': return v.toFixed(3) + ' bps'
    case 'score': return v.toFixed(0)
    case 'ratio01': return v.toFixed(3)
    case 'ratio': return v.toFixed(2) + '×'
    case 'count': return fmtNum(v)
    case 'tokens': return fmtNum(v)
    case 'index': return v.toFixed(2)
    default: return fmtNum(v)
  }
}

// 历史跨度（天数 → 友好文字）
export function fmtSpan(first?: string, last?: string): string {
  if (!first || !last) return '—'
  const days = (new Date(last).getTime() - new Date(first).getTime()) / 86400000
  if (days >= 365) return `${(days / 365).toFixed(1)} 年`
  if (days >= 1) return `${Math.round(days)} 天`
  return '<1 天'
}

export function fmtTime(ts: string): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`
}

export function fmtDay(ts: string | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function sinceFromHours(hours: number | null): string | undefined {
  if (!hours) return undefined
  return new Date(Date.now() - hours * 3600 * 1000).toISOString()
}

export const RANGES: { value: string; label: string; hours: number | null }[] = [
  { value: '24h', label: '24时', hours: 24 },
  { value: '7d', label: '7天', hours: 168 },
  { value: '30d', label: '30天', hours: 720 },
  { value: 'all', label: '全部', hours: null },
]

