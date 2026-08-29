import { describe, expect, it } from 'vitest'
import {
  isAssetDossier, isAssetIndex, isKnowledgeNodePage, isKnowledgeOverview,
  isKnowledgeUnitPage, isVerificationPage,
} from './contracts'

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

  it('accepts the asset index and rejects rows without the decision counters', () => {
    const asset = { asset: 'NVDA', units: 24, open_claims: 3 }
    expect(isAssetIndex({ total: 1, classes: { stock: '个股' }, assets: [asset] })).toBe(true)
    expect(isAssetIndex({ total: 1, classes: {}, assets: [{ asset: 'NVDA' }] })).toBe(false)
    expect(isAssetIndex({ total: 1, assets: [] })).toBe(false)
  })

  it('accepts a dossier whose summary is null — 登记了但还没有单元不是错误', () => {
    const dossier = {
      asset: 'QQQ', identity: {}, coverage: {}, summary: null,
      by_creator: [], open_claims: [], settled_claims: [], nodes: [], related_assets: [],
      disagreements: { relations: [], evolution: [] },
    }
    expect(isAssetDossier(dossier)).toBe(true)
    expect(isAssetDossier({ ...dossier, disagreements: {} })).toBe(false)
    expect(isAssetDossier({ ...dossier, asset: 42 })).toBe(false)
  })
})
