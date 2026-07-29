import type {
  KnowledgeKind,
  KnowledgeNode,
  NodeStatus,
} from '../knowledge/types'

export type DiscoveryRelationKind = 'conflicts' | 'relates'

export type DiscoveryRelation = {
  id: number
  relation: DiscoveryRelationKind
  note: string
  created_at: string
  a_id: number
  a_title: string
  a_kind: KnowledgeKind
  a_status: NodeStatus
  b_id: number
  b_title: string
  b_kind: KnowledgeKind
  b_status: NodeStatus
}

export type DiscoveryConsensusNode = KnowledgeNode

export type HarnessPayload = {
  name?: string
  summary?: string
  family?: string
  rules?: string[]
  data_requirements?: string[]
  overlap_with_killed?: string[]
  claimed_performance?: Record<string, unknown> | null
  testability?: string
}

export type HarnessCandidate = {
  node_id: number
  title: string
  canonical: string
  status: NodeStatus
  n_attest: number
  n_creators: number
  payload: HarnessPayload
}

export type WeeklyNewContent = {
  name: string
  n: number
  chars: number
}

export type WeeklyUnitCount = {
  kind: KnowledgeKind
  n: number
}

export type WeeklyScore = {
  unit_id: number
  outcome: string
  horizon_label: string
  created_at: string
  creator: string
  sym: string | null
  dir: string | null
  grade: string | null
}

export type WeeklyEdge = {
  relation: DiscoveryRelationKind
  note: string
  a_id: number
  a_title: string
  b_id: number
  b_title: string
}

export type WeeklyNodeStatus = {
  status: NodeStatus
  n: number
}

export type WeeklyNotableNode = {
  title: string
  status: NodeStatus
}

export type WeeklyDue = {
  unit_id: number
  creator: string
  sym: string | null
  dir: string | null
  horizon_label: string
}

export type WeeklySpotSnapshot = {
  checked: number
  total: number
}

export type WeeklySummary = {
  new_contents: WeeklyNewContent[]
  new_units: WeeklyUnitCount[]
  new_scores: WeeklyScore[]
  new_edges: WeeklyEdge[]
  node_status: WeeklyNodeStatus[]
  notable_nodes: WeeklyNotableNode[]
  due_next: WeeklyDue[]
  spot_check: WeeklySpotSnapshot
}

export type WeeklyReport = {
  generated_at: string
  path: string
  markdown: string
  summary: WeeklySummary
}

export type SpotCheckRecord = {
  unit_id: number
  verdict: 'faithful' | 'unfaithful' | 'unclear'
  note: string | null
  created_at: string
  kind: KnowledgeKind
  quote: string
}

export type SpotCheckStats = {
  total: number
  checked: number
  faithful: number
  unfaithful: number
  unclear: number
  recent: SpotCheckRecord[]
}
