export interface Message {
  role: 'user' | 'assistant'
  content: string
}

export interface Conversation {
  id: number
  title: string
  created_at: string
  updated_at: string
}

export interface Price {
  symbol: string
  last: number | null
  change_pct_24h: number | null
  error?: string
}

// --- 市场数据（采集的时间序列）---------------------------------------------

export interface MetricPoint {
  ts: string
  value: number
}

export interface LatestMetric {
  ts: string
  value: number
}

export interface WatchlistEntry {
  symbol: string
  metrics: Record<string, LatestMetric>
}

export interface Watchlist {
  symbols: WatchlistEntry[]
  global: Record<string, LatestMetric>
}

export interface CatalystItem {
  kind: string // unlock | macro | news
  symbol: string
  event_date: string | null
  title: string
  payload: any
  fetched_at: string
}

export interface CollectionRun {
  job: string
  started_at: string
  ok: number
  note: string | null
}

export interface CollectionStatus {
  enabled: boolean
  runs: CollectionRun[]
}

export interface StreamHandlers {
  onStart?: (conversationId: number) => void
  onStatus?: (status: { phase?: string; tool?: string; input?: any }) => void
  onDelta?: (text: string) => void
  onDone?: (conversationId: number) => void
  onError?: (detail: string) => void
}
