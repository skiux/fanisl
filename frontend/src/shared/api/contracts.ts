import type { KnowledgeNodePage, KnowledgeOverview, KnowledgeUnitPage } from '../../features/knowledge/types'
import type { VerificationPageData, VerificationSummary } from '../../features/verification/types'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function pagination(value: Record<string, unknown>) {
  return finiteNumber(value.total)
    && finiteNumber(value.offset)
    && finiteNumber(value.limit)
    && typeof value.has_more === 'boolean'
    && Array.isArray(value.items)
}

export function isKnowledgeOverview(value: unknown): value is KnowledgeOverview {
  if (!record(value)) return false
  return ['nodes', 'contents', 'units', 'creators', 'corroborated', 'claims', 'methods', 'concepts']
    .every((key) => finiteNumber(value[key]))
}

export function isKnowledgeUnitPage(value: unknown): value is KnowledgeUnitPage {
  if (!record(value) || !pagination(value) || !record(value.counts) || !record(value.creator_counts)) return false
  const counts = value.counts
  const items = value.items
  return Array.isArray(items)
    && ['claim', 'method', 'concept'].every((key) => finiteNumber(counts[key]))
    && items.every((item: unknown) => record(item) && finiteNumber(item.id) && typeof item.quote === 'string')
}

export function isKnowledgeNodePage(value: unknown): value is KnowledgeNodePage {
  if (!record(value) || !pagination(value)) return false
  const items = value.items
  return Array.isArray(items)
    && items.every((item: unknown) => record(item) && finiteNumber(item.id) && typeof item.title === 'string')
}

export function isVerificationSummary(value: unknown): value is VerificationSummary {
  if (!record(value) || !record(value.overview) || !Array.isArray(value.nearest_due)) return false
  const overview = value.overview
  return ['due', 'completed', 'unavailable', 'review'].every((key) => finiteNumber(overview[key]))
}

export function isVerificationPage(value: unknown): value is VerificationPageData {
  if (!record(value) || !pagination(value)) return false
  const items = value.items
  return Array.isArray(items)
    && items.every((item: unknown) => record(item) && finiteNumber(item.unit_id) && typeof item.quote === 'string')
}
