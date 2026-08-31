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
      news: [], events: [], trades: [],
      disagreements: { relations: [], evolution: [] },
    }
    expect(isAssetDossier(dossier)).toBe(true)
    expect(isAssetDossier({ ...dossier, disagreements: {} })).toBe(false)
    expect(isAssetDossier({ ...dossier, asset: 42 })).toBe(false)
  })

  it('rejects a dossier from an older backend instead of letting it crash the render', () => {
    // 真实场景：改完后端没重启 uvicorn，/asset/{id} 还是旧形状（没有 news/events/trades）。
    // 放进去会在渲染期抛 TypeError，整页变成"当前页面没有正确载入"。
    const stale = {
      asset: 'NVDA', identity: {}, coverage: {}, summary: {},
      by_creator: [], open_claims: [], settled_claims: [], nodes: [], related_assets: [],
      disagreements: { relations: [], evolution: [] },
    }
    expect(isAssetDossier(stale)).toBe(false)
    expect(isAssetDossier({ ...stale, news: [], events: [] })).toBe(false)   // 还差 trades
    expect(isAssetDossier({ ...stale, news: [], events: [], trades: [] })).toBe(true)
  })
})
