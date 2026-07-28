export type VerificationOutcome =
  | 'hit'
  | 'partial'
  | 'miss'
  | 'condition_not_met'
  | 'condition_unverifiable'
  | 'unpriceable'
  | 'pending'

export type VerificationOverview = {
  due: number
  completed: number
  unavailable: number
  review: number
}

export type DueVerification = {
  unit_id: number
  quote: string
  payload: Record<string, unknown>
  published_at: string
  ref_price_at_publish: number | null
  creator: string
  content_title: string
  horizon_label: string
}

export type ScoredVerification = DueVerification & {
  score_id: number
  outcome: VerificationOutcome
  realized: Record<string, unknown> | null
  eval_ts: string
  scored_at: string
}

export type VerificationQueue = {
  overview: VerificationOverview
  due: DueVerification[]
  recent: ScoredVerification[]
  unavailable: ScoredVerification[]
  review: ScoredVerification[]
}

export type VerificationNodeImpact = {
  id: number
  title: string
  status: string
  kind: string
  relation: string
  note: string | null
}

export type VerificationDetail = {
  score_id: number
  unit_id: number
  horizon_label: string
  outcome: VerificationOutcome
  realized: Record<string, unknown> | null
  eval_ts: string
  scored_at: string
  scorer_version: string
  quote: string
  locator: string | null
  payload: Record<string, unknown>
  tags: string[]
  published_at: string
  ref_price_at_publish: number | null
  extractor_version: string
  creator_id: number
  creator: string
  content_id: number
  content_title: string
  content_url: string | null
  nodes: VerificationNodeImpact[]
}

export type VerificationPriceBar = {
  ts: string
  open: number
  high: number
  low: number
  close: number
}

export type VerificationPriceWindow = {
  symbol: string
  note: string
  bars: VerificationPriceBar[]
}
