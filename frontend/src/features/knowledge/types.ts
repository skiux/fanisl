export type KnowledgeKind = 'claim' | 'method' | 'concept'
export type NodeStatus = 'active' | 'corroborated' | 'verified' | 'contested' | 'retired'

export type KnowledgeNode = {
  id: number
  kind: KnowledgeKind
  title: string
  canonical: string
  status: NodeStatus
  tags: string[]
  notes: string | null
  merger_version?: string
  created_at?: string
  updated_at?: string
  n_attest: number
  n_creators: number
  n_contents: number
  first_seen: string | null
  last_seen: string | null
  hit: number
  partial: number
  miss: number
}

export type KnowledgeStats = {
  nodes: number
  contents: number
  units: number
  creators: number
  corroborated: number
}

export type AttestationRelation = 'restates' | 'refines' | 'supersedes' | 'contradicts'
export type NodeRelationKind = 'conflicts' | 'relates'

export type ClaimScore = {
  id: number
  horizon_label: string
  outcome: string
  realized: Record<string, unknown> | null
  eval_ts: string | null
}

export type NodeAttestation = {
  relation: AttestationRelation
  note: string | null
  unit_id: number
  kind: KnowledgeKind
  quote: string
  locator: string | null
  published_at: string
  tags: string[]
  payload: Record<string, unknown>
  creator: string
  content_id: number
  content_title: string
  scores: ClaimScore[]
}

export type NodeRelation = {
  relation: NodeRelationKind
  note: string
  other_id: number
  other_title: string
  other_kind: KnowledgeKind
  other_status: NodeStatus
}

export type KnowledgeNodeDetail = KnowledgeNode & {
  attestations: NodeAttestation[]
  relations: NodeRelation[]
}

export type UnitScore = {
  horizon_label: string
  outcome: string
  realized: Record<string, unknown> | null
}

export type KnowledgeUnitDetail = {
  id: number
  run_id: number
  content_id: number
  creator_id: number
  published_at: string
  kind: KnowledgeKind
  quote: string
  locator: string | null
  extractor_version: string
  model: string | null
  payload: Record<string, unknown>
  tags: string[]
  ref_price_at_publish: number | null
  created_at: string
  creator: string
  content_title: string
  content_url: string | null
  scores: UnitScore[]
}

export type KnowledgeContentDetail = {
  id: number
  creator_id: number
  creator: string
  platform: string
  url: string | null
  content_type: string
  title: string
  published_at: string
  fetched_at: string
  lang: string
  status: string
  raw: string
  created_at: string
}
