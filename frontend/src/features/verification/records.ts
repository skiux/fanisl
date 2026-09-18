// 验证页的取值、分类与路由。组件里只管渲染，这里的东西都有 records.test.ts。

import type { DueVerification, ScoredVerification } from './types'

export type QueueView = 'recent' | 'due' | 'review' | 'unavailable'
export type QueueItem = DueVerification | ScoredVerification

// 与 backend/api.md §5.4 的 bucket 一一对应，进页时四个一起取
export const QUEUE_VIEWS: QueueView[] = ['recent', 'due', 'review', 'unavailable']

/**
 * 时间轴与图例上的六类。已判定拆成命中、部分、未中三类（画在轴的上下），
 * 需复核与不可判是"到期了但没有结论"，即将到期是"还没到期"——这三类都压在轴线上。
 */
export type RecordKind = 'hit' | 'partial' | 'miss' | 'review' | 'void' | 'due'

export const RECORD_KINDS: RecordKind[] = ['hit', 'partial', 'miss', 'review', 'void', 'due']

// 需复核、不可判、即将到期沿用 backend/api.md §5.4 的分桶名
export const kindLabels: Record<RecordKind, string> = {
  hit: '命中', partial: '部分', miss: '未中', review: '需复核', void: '不可判', due: '即将到期',
}

export type RecordRoute =
  | { kind: 'score'; scoreId: number }
  | { kind: 'due'; unitId: number; horizon: string | null }
  | null

export type DaySummary = { day: string; items: QueueItem[] } & Record<RecordKind, number>

export function isScored(item: QueueItem): item is ScoredVerification {
  return 'score_id' in item
}

export function kindOf(item: QueueItem): RecordKind {
  if (!isScored(item)) return 'due'
  if (item.outcome === 'hit' || item.outcome === 'partial' || item.outcome === 'miss') return item.outcome
  if (item.outcome === 'condition_not_met' || item.outcome === 'pending') return 'review'
  return 'void'
}

export function recordKey(item: QueueItem) {
  return isScored(item) ? `score-${item.score_id}` : `due-${item.unit_id}-${item.horizon_label}`
}

export function dayOf(item: QueueItem) {
  return item.horizon_label.slice(0, 10)
}

export function routeFor(item: QueueItem) {
  if (isScored(item)) return `#/verification?score=${item.score_id}`
  return `#/verification?due=${item.unit_id}&horizon=${encodeURIComponent(item.horizon_label)}`
}

export function parseRoute(hash: string): RecordRoute {
  const [, search = ''] = hash.split('?')
  const params = new URLSearchParams(search)
  const score = Number(params.get('score'))
  if (Number.isInteger(score) && score > 0) return { kind: 'score', scoreId: score }
  const due = Number(params.get('due'))
  if (Number.isInteger(due) && due > 0) return { kind: 'due', unitId: due, horizon: params.get('horizon') }
  return null
}

/** 地址里选中的那一天（`?day=YYYY-MM-DD`）；打开记录时由记录本身决定，不看这个 */
export function parseDay(hash: string): string | null {
  const [, search = ''] = hash.split('?')
  const day = new URLSearchParams(search).get('day')
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

export function matchesRoute(item: QueueItem, route: RecordRoute) {
  if (!route) return false
  if (route.kind === 'score') return isScored(item) && item.score_id === route.scoreId
  return !isScored(item) && item.unit_id === route.unitId && (!route.horizon || item.horizon_label === route.horizon)
}

export function matchesQuery(item: QueueItem, query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return true
  const symbol = typeof item.payload.asset_symbol === 'string' ? item.payload.asset_symbol : ''
  return `${item.quote} ${item.creator} ${item.content_title} ${symbol}`.toLocaleLowerCase().includes(normalized)
}

export function kindCounts(items: QueueItem[]) {
  const counts = Object.fromEntries(RECORD_KINDS.map((kind) => [kind, 0])) as Record<RecordKind, number>
  items.forEach((item) => { counts[kindOf(item)] += 1 })
  return counts
}

// 一天之内先放有结论的（命中、部分、未中），再放没结论的，同类按信源排，读起来成块
const KIND_RANK: Record<RecordKind, number> = { hit: 0, partial: 1, miss: 2, review: 3, void: 4, due: 5 }

/** 按到期日汇总，日期升序；每天带上当天的记录与六类计数，时间轴和卡片都从这里取 */
export function summarizeDays(items: QueueItem[]): DaySummary[] {
  const byDay = new Map<string, QueueItem[]>()
  items.forEach((item) => byDay.set(dayOf(item), [...(byDay.get(dayOf(item)) ?? []), item]))
  return [...byDay.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, list]) => ({
      day,
      items: [...list].sort((left, right) => KIND_RANK[kindOf(left)] - KIND_RANK[kindOf(right)]
        || left.creator.localeCompare(right.creator, 'zh-CN')
        || left.unit_id - right.unit_id),
      ...kindCounts(list),
    }))
}

/**
 * 卡片窗口默认从哪一条开始：让窗口的最后一张正好是今天及以前最近的一条结果，
 * 也就是"截至今天的最近一屏裁决"。一条结果都没有时从头开始。
 */
export function defaultStart(sequence: QueueItem[], today: string, capacity: number) {
  let last = -1
  sequence.forEach((item, index) => {
    if (kindOf(item) !== 'due' && dayOf(item) <= today) last = index
  })
  return Math.max(0, last + 1 - capacity)
}

/** 某天在序列里的第一条；那天没有记录就取之后最近的一天，都没有就取最后一条 */
export function indexOfDay(sequence: QueueItem[], day: string) {
  const index = sequence.findIndex((item) => dayOf(item) >= day)
  return index === -1 ? Math.max(0, sequence.length - 1) : index
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** "09/14 周一"。horizon_label 是不带时区的日期，按 UTC 解析才不会跨天 */
export function dayLabel(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return value
  return `${value.slice(5, 7)}/${value.slice(8, 10)} ${WEEKDAYS[date.getUTCDay()]}`
}

export function shortDay(value: string) {
  return `${value.slice(5, 7)}/${value.slice(8, 10)}`
}

/** 本地日历上的今天（YYYY-MM-DD），与 horizon_label 同一口径比较 */
export function todayKey(now = new Date()) {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
}

/**
 * 实测字段怎么印：收益与回撤是比例，印百分比；日期原样；其余按数字。
 * 行情价带浮点尾数（KOSPI 收盘 6909.9102），上百的价格留两位；利差这类零点几的序列留四位
 */
export function formatRealized(key: string, value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (key.endsWith('_ret') || key.endsWith('_dd')) return `${value >= 0 && key.endsWith('_ret') ? '+' : ''}${(value * 100).toFixed(2)}%`
    return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: Math.abs(value) >= 100 ? 2 : 4 }).format(value)
  }
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'boolean') return value ? '是' : '否'
  return null
}
