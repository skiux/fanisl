import { describe, expect, it } from 'vitest'
import { isKnowledgeNodePage, isKnowledgeOverview, isKnowledgeUnitPage, isVerificationPage } from './contracts'

describe('API runtime contracts', () => {
  it('accepts the overview shape and rejects missing counts', () => {
    expect(isKnowledgeOverview({
      nodes: 448, contents: 49, units: 798, creators: 3, corroborated: 9,
      claims: 295, methods: 102, concepts: 401,
    })).toBe(true)
    expect(isKnowledgeOverview({ nodes: 448 })).toBe(false)
  })

  it('requires pagination metadata and minimum row identity', () => {
    const page = { items: [{ id: 1, quote: '证据' }], total: 1, offset: 0, limit: 100, has_more: false }
    expect(isKnowledgeUnitPage({ ...page, counts: { claim: 1, method: 0, concept: 0 }, creator_counts: {} })).toBe(true)
    expect(isKnowledgeNodePage({ ...page, items: [{ id: 1, title: '节点' }] })).toBe(true)
    expect(isVerificationPage({ ...page, items: [{ unit_id: 1, quote: '判断' }] })).toBe(true)
    expect(isVerificationPage({ items: [], total: 0 })).toBe(false)
  })
})
