// 标的页共用的取值与格式化。命中率的展示纪律见 domain-model.md §5：**永远带 n**，
// 没样本时显示「未验证」而不是 0%，n 小于 SMALL_SAMPLE 时视觉降权。

export const SMALL_SAMPLE = 10

export function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function formatDate(value: string | null | undefined, withYear = false) {
  if (!value) return '—'
  const date = new Date(value.length <= 10 ? `${value}T00:00:00Z` : value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: withYear ? 'numeric' : undefined,
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Shanghai',
  }).format(date)
}

/** 距今天数；负数表示已经过去。日期不可解析时返回 null。 */
export function daysFromToday(day: string | null | undefined): number | null {
  if (!day) return null
  const target = Date.parse(`${day.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(target)) return null
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  return Math.round((target - today) / 86400000)
}

export function countdown(day: string | null | undefined) {
  const days = daysFromToday(day)
  if (days === null) return '日期未知'
  if (days === 0) return '今天到期'
  if (days === 1) return '明天到期'
  if (days < 0) return `已过期 ${-days} 天`
  if (days < 31) return `${days} 天后`
  if (days < 400) return `${Math.round(days / 30)} 个月后`
  return `${(days / 365).toFixed(1)} 年后`
}

export function percent(rate: number | null) {
  return rate === null ? null : `${Math.round(rate * 100)}%`
}

// 类别在列表里的排序：先大盘与板块，再个股，最后小众品类——按"日常先看什么"排。
const CLASS_ORDER = ['index', 'etf', 'stock', 'metal', 'commodity', 'crypto', 'rate', 'fx', 'preipo']

export function classRank(value: string | null) {
  const index = value ? CLASS_ORDER.indexOf(value) : -1
  return index === -1 ? CLASS_ORDER.length : index
}

export const kindLabels: Record<string, string> = { claim: '判断', method: '方法', concept: '认知' }

export const statusLabels: Record<string, string> = {
  active: '活跃', corroborated: '多源佐证', verified: '已验证',
  contested: '存在争议', retired: '已退役',
}

export const outcomeLabels: Record<string, string> = {
  hit: '命中', partial: '部分命中', miss: '未命中',
  condition_not_met: '条件未触发', condition_unverifiable: '条件不可验',
  unpriceable: '无法取价', pending: '等待确认',
}

export const outcomeMarks: Record<string, string> = {
  hit: '✓', partial: '½', miss: '×',
  condition_not_met: '○', condition_unverifiable: '?', unpriceable: '—', pending: '…',
}

export const directionLabels: Record<string, string> = {
  up: '看涨 ↑', down: '看跌 ↓', flat: '走平 →', range: '区间 ↔',
  vol_up: '波动放大', vol_down: '波动收敛',
}

export const stanceLabels: Record<string, string> = {
  explicit: '明确', hedged: '对冲表述', speculative: '试探表述',
}

export const verifiabilityLabels: Record<string, string> = {
  A: '全自动可评', B: '我方阶梯', C: '带条件', D: '不可评',
}
