const API = (import.meta as any).env?.VITE_API_BASE ?? 'http://127.0.0.1:8000'

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`)
  if (!response.ok) {
    let detail = `${response.status}`
    try {
      const body = await response.json()
      detail = body.detail ?? detail
    } catch {
      // Non-JSON failures retain the status code.
    }
    throw new Error(detail)
  }
  return response.json()
}

export interface VerificationItem {
  score_id?: number
  unit_id: number
  quote: string
  payload: Record<string, any>
  published_at?: string | null
  ref_price_at_publish?: number | null
  creator: string
  content_title?: string | null
  horizon_label: string
  outcome?: string
  realized?: Record<string, any> | null
  eval_ts?: string | null
  scored_at?: string | null
}

export interface VerificationQueue {
  overview: { due: number; completed: number; unavailable: number; review: number }
  due: VerificationItem[]
  recent: VerificationItem[]
  unavailable: VerificationItem[]
  review: VerificationItem[]
}

export interface WeeklySummary {
  new_contents: { name: string; n: number; chars: number }[]
  new_units: { kind: string; n: number }[]
  new_scores: any[]
  new_edges: KnowledgeRelation[]
  node_status: { status: string; n: number }[]
  notable_nodes: { title: string; status: string }[]
  due_next: any[]
  spot_check: { checked: number; total: number }
}

export interface KnowledgeRelation {
  id: number
  relation: 'conflicts' | 'relates'
  note: string
  created_at: string
  a_id: number
  a_title: string
  a_kind: string
  a_status: string
  b_id: number
  b_title: string
  b_kind: string
  b_status: string
}

export interface CollectionStatus {
  enabled: boolean
  runs: { job: string; started_at: string; ok: 0 | 1; note?: string | null }[]
}

export interface SpotChecks {
  total: number
  checked: number
  faithful: number
  unfaithful: number
  unclear: number
  recent: any[]
}

export const api = {
  health: () => get<{ status: string; model: string; exchange: string }>('/health'),
  verificationQueue: () => get<VerificationQueue>('/knowledge/verification-queue?days=14&limit=120'),
  weekly: () => get<{ generated_at: string; summary?: WeeklySummary }>('/knowledge/weekly?days=7'),
  conflicts: () => get<KnowledgeRelation[]>('/knowledge/relations?relation=conflicts'),
  collectionStatus: () => get<CollectionStatus>('/collection/status'),
  spotChecks: () => get<SpotChecks>('/knowledge/spot-checks'),
}
