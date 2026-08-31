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
  /** news_items 走 asset + latest；catalyst_items 那一路走 kind/symbol + fetched_at。 */
  kind?: string
  symbol?: string
  asset?: string
  n: number
  latest?: string
  fetched_at?: string
  /** 被降噪层判为噪音、已从列表里拿掉的条数。 */
  noise?: number
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
  profile_at: string | null
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

export type AssetProfileMetrics = {
  pe_ttm?: number
  ps_ttm?: number
  pb?: number
  eps_ttm?: number
  gross_margin?: number
  operating_margin?: number
  net_margin?: number
  revenue_growth_yoy?: number
  eps_growth_yoy?: number
  roe?: number
  beta?: number
  high_52w?: number
  low_52w?: number
  dividend_yield?: number
}

/** 公司资料。字段可能缺——两个源合并而来，`sources` 记着每个字段是谁给的。 */
export type AssetProfile = {
  asset: string
  name: string | null
  description: string | null
  industry: string | null
  exchange: string | null
  country: string | null
  currency: string | null
  cik: string | null
  homepage: string | null
  logo: string | null
  listed_on: string | null
  employees: number | null
  market_cap: number | null
  shares_out: number | null
  metrics: AssetProfileMetrics | null
  sources: Record<string, string> | null
  fetched_at: string
}

export type NewsItem = {
  id: number | null
  published_at: string
  title: string
  summary: string | null
  url: string | null
  source: string | null
  provider: string
  image_url: string | null
  /** core=关于这个标的的实质消息 · context=相关但间接 · null=还没判 */
  relevance?: 'core' | 'context' | 'noise' | null
  /** 一句中文：这条讲了什么变化。降噪层给的，规则判的没有。 */
  note?: string | null
}

/** 财报等日历事件。与新闻不同，这张表是 upsert 的——日期会挪、预期会被修正。 */
export type AssetEvent = {
  asset: string
  kind: string
  event_date: string
  session: string | null
  source: string
  payload: {
    quarter?: number | null
    fiscal_year?: number | null
    eps_estimate?: number | null
    eps_actual?: number | null
    revenue_estimate?: number | null
    revenue_actual?: number | null
  } | null
}

export type AssetTrade = {
  id: number
  account: string
  symbol: string
  side: string
  status: string
  setup_key: string | null
  leverage: number
  qty: number
  avg_entry: number | null
  opened_at: string | null
  closed_at: string | null
  created_at: string
  outcome: string | null
  pnl_abs: number | null
  pnl_pct: number | null
  realized_r: number | null
  exit_reason: string | null
}

export type AssetCoverage = {
  bars: boolean
  bars_note: string
  bars_window: BarCoverage | null
  metrics: string | null
  instrument: string | null
  news: NewsCoverage | null
  /** 这个标的有没有"公司"这回事——指数/金属/利率没有，不是我们没接。 */
  has_company?: boolean
  /** 会不会报财报——ETF 与指数都不会，空是事实。 */
  has_earnings?: boolean
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
  profile: AssetProfile | null
  news: NewsItem[]
  events: AssetEvent[]
  trades: AssetTrade[]
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
