// 单元核查的传输契约与调用。字段以 backend/api.md §5.6 为准；流程与取舍见
// docs/plans/active/features/unit-review.md。
//
// 站上只有三个写操作：提交、回复、关闭，登录即可，不分角色。知识席位的答复只走 CLI，这里没有、
// 也不该有任何以知识席位身份写入的路径。

import { ApiError, apiJson } from '../../shared/api/client'
import { isReviewQueue, isUnitReview, isUnitReviewList } from '../../shared/api/contracts'

export type ReviewCategory = 'quote' | 'grade' | 'scoring' | 'asset' | 'statement' | 'other'
export type ReviewStatus = 'open' | 'answered' | 'closed'
export type ResolutionOutcome = 'fixed' | 'no_change' | 'needs_info'

export type ReviewResolution = {
  outcome: ResolutionOutcome
  root_cause: string | null
  sweep: string | null
  followup: string | null
}

export type ReviewMessage = {
  id: number
  role: 'reviewer' | 'extractor'
  author: string
  body: string
  created_at: string
  /** 只出现在 role=extractor 的消息上，reviewer 的恒为 null。 */
  resolution: ReviewResolution | null
}

export type UnitSnapshot = {
  quote: string
  payload: Record<string, unknown>
  tags: string[]
}

export type UnitAmendment = {
  id: number
  unit_id: number
  reason: string
  author: string
  created_at: string
  /** "quote" | "tags" | "payload.<键>"，before / after 是改前改后的全量。 */
  changed: string[]
  before: UnitSnapshot
  after: UnitSnapshot
}

export type UnitReview = {
  id: number
  unit_id: number
  category: ReviewCategory
  status: ReviewStatus
  created_by: string
  created_at: string
  updated_at: string
  closed_at: string | null
  /** 按时间升序。 */
  messages: ReviewMessage[]
  amendments: UnitAmendment[]
}

/** GET /knowledge/reviews 的一行：不带对话全文，quote 截到 80 字、last_message 截到 120 字。 */
export type ReviewQueueItem = {
  id: number
  unit_id: number
  category: ReviewCategory
  status: ReviewStatus
  created_by: string
  created_at: string
  updated_at: string
  closed_at: string | null
  kind: 'claim' | 'method' | 'concept'
  content_id: number
  quote: string
  verifiability: string | null
  creator: string
  n_messages: number
  last_message: string | null
}

export const REVIEW_CATEGORIES: ReviewCategory[] = ['quote', 'grade', 'scoring', 'asset', 'statement', 'other']

/** 与 store 的 REVIEW_BODY_MAX 同值。超出由后端判 400，这里只是提前拦住。 */
export const REVIEW_BODY_MAX = 4000

/** 队列接口给的截断长度，用来判断要不要补省略号。 */
export const QUEUE_QUOTE_MAX = 80
export const QUEUE_MESSAGE_MAX = 120

function post(body?: unknown) {
  return body === undefined ? { method: 'POST' } : { method: 'POST', body: JSON.stringify(body) }
}

export function fetchUnitReviews(unitId: number, signal?: AbortSignal) {
  return apiJson<UnitReview[]>(`/knowledge/units/${unitId}/reviews`, { signal }, isUnitReviewList)
}

export function submitReview(unitId: number, category: ReviewCategory, body: string) {
  return apiJson<UnitReview>(`/knowledge/units/${unitId}/reviews`, post({ category, body }), isUnitReview)
}

export function replyToReview(reviewId: number, body: string) {
  return apiJson<UnitReview>(`/knowledge/reviews/${reviewId}/messages`, post({ body }), isUnitReview)
}

export function closeReview(reviewId: number) {
  return apiJson<UnitReview>(`/knowledge/reviews/${reviewId}/close`, post(), isUnitReview)
}

export function fetchAnsweredReviews(signal?: AbortSignal) {
  return apiJson<ReviewQueueItem[]>('/knowledge/reviews?status=answered&limit=100', { signal }, isReviewQueue)
}

/** 标签上的计数：没关闭的都算——open 在等知识席位，answered 在等你。 */
export function unclosedCount(reviews: UnitReview[]) {
  return reviews.filter((review) => review.status !== 'closed').length
}

/** 直达某条单元的核查 tab。review 给了就滚到那一条。 */
export function reviewHref(unitId: number, reviewId?: number) {
  const params = new URLSearchParams({ unit: String(unitId), view: 'evidence', tab: 'review' })
  if (reviewId) params.set('review', String(reviewId))
  return `#/knowledge?${params.toString()}`
}

/** 写接口的报错。400 / 404 / 409 的 detail 已是中文，原样给；401 由会话闸门切回登录页。 */
export function reviewErrorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message
  return '网络异常，没有提交成功，请稍后重试'
}

/** 顶栏的「待确认」靠这个事件刷新：在单元里回复或关闭之后，计数要跟着变，不必等换页。 */
export const REVIEWS_CHANGED = 'fanisl:reviews-changed'

export function announceReviewsChanged() {
  window.dispatchEvent(new Event(REVIEWS_CHANGED))
}

// 修改记录里 changed 的字段名。键名本身也显示（审计要能对上库里的字段），这里只补中文。
const payloadFieldLabels: Record<string, string> = {
  asset_text: '标的说明', asset_symbol: '标的', priceable: '可定价', claim_class: '判断类型',
  direction: '方向', magnitude: '幅度', horizon: '期限', condition_text: '前置条件',
  condition_observable: '条件可观察', stance_strength: '承诺度', verifiability: '可验证性', grade_note: '定级说明',
  scoring_spec: '评分规格', name: '名称', summary: '概要', family: '方法族', rules: '规则',
  claimed_performance: '自述战绩', data_requirements: '所需数据', overlap_with_killed: '与已杀假设重叠',
  testability: '可测试性', canonical_statement: '规范陈述', category: '类别', stance: '立场',
  regime_qualifier: '适用环境',
}

export function fieldLabel(path: string) {
  if (path === 'quote') return '原句'
  if (path === 'tags') return '标签'
  const key = path.startsWith('payload.') ? path.slice('payload.'.length) : path
  return payloadFieldLabels[key] ?? key
}

export function snapshotValue(snapshot: UnitSnapshot | null | undefined, path: string): unknown {
  if (!snapshot) return undefined
  if (path === 'quote') return snapshot.quote
  if (path === 'tags') return snapshot.tags
  if (path.startsWith('payload.')) return snapshot.payload?.[path.slice('payload.'.length)]
  return undefined
}
