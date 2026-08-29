// 标的工作台的传输契约。字段以 api.md §6 为准，口径说明见 domain-model.md「asset」。

export type AssetClass =
  | 'index' | 'etf' | 'stock' | 'metal' | 'commodity' | 'crypto' | 'rate' | 'fx' | 'preipo'

export type BarCoverage = {
  symbol: string
  n: number
  first: string
  last: string
}

export type NewsCoverage = {
  kind: string
  symbol: string
  n: number
  fetched_at: string
}

/** 一个标的的计数与战绩。hit_rate 为 null = 没有样本，**不是 0**。 */
export type AssetSummary = {
  asset: string
  display: string | null
  asset_class: AssetClass | null
  class_label: string | null
  registered: boolean
  has_bars: boolean
  has_metrics: boolean
  units: number
  claims: number
  methods: number
  concepts: number
  creators: number
  first_seen: string | null
  last_seen: string | null
  scored: number
  hits: number
  partials: number
  misses: number
  unresolved: number
  /** 未到期判断的**条数**（按 claim 去重）；档案里的 open_claims 数组给的是时点。 */
  open_claims: number
  hit_rate: number | null
}

export type AssetRow = AssetSummary & {
  bars: BarCoverage | null
  news: NewsCoverage | null
}

export type AssetIndex = {
  total: number
  classes: Record<string, string>
  assets: AssetRow[]
}

export type AssetIdentity = {
  id: string
  display: string | null
  asset_class: AssetClass | null
  class_label: string | null
  tag: string
  aliases: string[]
  related: string[]
  note: string
  registered: boolean
}

export type AssetCoverage = {
  bars: boolean
  bars_note: string
  bars_window: BarCoverage | null
  metrics: string | null
  instrument: string | null
  news: NewsCoverage | null
}

export type AssetCreatorRecord = {
  creator_id: number
  creator: string
  units: number
  claims: number
  last_seen: string | null
  scored: number
  hits: number
  partials: number
  misses: number
  hit_rate: number | null
}

/** 未到期的一个评分时点。一条判断可能出现多次（阶梯有多个日期）。 */
export type OpenClaim = {
  unit_id: number
  horizon_label: string
  quote: string
  payload: Record<string, unknown>
  published_at: string
  ref_price_at_publish: number | null
  tags: string[]
  creator: string
  content_id: number
  content_title: string
}

export type SettledOutcome =
  | 'hit' | 'partial' | 'miss'
  | 'condition_not_met' | 'condition_unverifiable' | 'unpriceable' | 'pending'

export type SettledClaim = {
  score_id: number
  unit_id: number
  horizon_label: string
  outcome: SettledOutcome
  realized: Record<string, unknown> | null
  eval_ts: string
  quote: string
  payload: Record<string, unknown>
  published_at: string
  ref_price_at_publish: number | null
  creator: string
  content_id: number
  content_title: string
}

export type AssetNode = {
  id: number
  kind: 'claim' | 'method' | 'concept'
  title: string
  canonical: string
  status: string
  tags: string[]
  notes: string | null
  updated_at: string
  n_attest: number
  n_creators: number
}

export type AssetRelation = {
  id: number
  relation: 'conflicts' | 'relates'
  note: string
  a_node: number
  b_node: number
  a_title: string
  a_canonical: string
  a_status: string
  b_title: string
  b_canonical: string
  b_status: string
}

/** 作者改口（supersedes）或被反驳（contradicts）的那次提及。 */
export type AssetEvolution = {
  node_id: number
  relation: 'supersedes' | 'contradicts'
  note: string | null
  node_title: string
  unit_id: number
  quote: string
  published_at: string
  creator: string
  content_id: number
  content_title: string
}

export type RelatedAsset = {
  asset: string
  display: string | null
  asset_class: AssetClass | null
  co_mentions: number
}

export type AssetDossierData = {
  asset: string
  identity: AssetIdentity
  coverage: AssetCoverage
  /** 登记了但库里还没有单元时为 null——「还没人讲过它」≠「查无此物」。 */
  summary: AssetSummary | null
  by_creator: AssetCreatorRecord[]
  open_claims: OpenClaim[]
  settled_claims: SettledClaim[]
  nodes: AssetNode[]
  disagreements: {
    relations: AssetRelation[]
    evolution: AssetEvolution[]
  }
  related_assets: RelatedAsset[]
}

export type PriceBar = {
  ts: string
  open: number
  high: number
  low: number
  close: number
}

export type PriceWindow = {
  symbol: string
  note: string
  bars: PriceBar[]
}
