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
