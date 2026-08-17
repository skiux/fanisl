import type { Page, Route } from '@playwright/test'

const creator = {
  id: 1, name: '测试信源', lang: 'zh', focus: null, notes: null, active: true,
  created_at: '2026-08-01T00:00:00Z',
}

const unit = {
  id: 1, run_id: 1, content_id: 1, creator_id: 1,
  published_at: '2026-08-01T00:00:00Z', kind: 'claim',
  quote: '半导体长期需求仍由算力投资驱动。', locator: '00:31',
  extractor_version: 'test-v1', model: 'fixture',
  payload: {
    asset_text: '半导体', asset_symbol: 'SOXX', claim_class: 'directional', direction: 'up',
    verifiability: 'A', scoring_spec: { success_def: '中期收益为正', eval_ladder: ['30d'] },
  },
  tags: ['semiconductor'], ref_price_at_publish: 250,
  created_at: '2026-08-01T00:00:00Z', scores: [],
  creator: creator.name, content_title: '半导体研究样本', content_url: 'https://example.test/source',
}

// 分页要能被测到：单元总数必须跨过 units-page 的 limit=100。第 1 条保持是那条
// 半导体判断，其余为形态相同的填充单元。
const UNIT_TOTAL = 120

const filler = Array.from({ length: UNIT_TOTAL - 1 }, (_, index) => ({
  ...unit,
  id: index + 2,
  quote: `${String(index + 2).padStart(3, '0')} 号填充引文：用于覆盖分页与虚拟列表。`,
}))

const allUnits = [unit, ...filler]

const content = {
  id: 1, creator_id: 1, creator: creator.name, platform: 'youtube',
  url: 'https://example.test/source', content_type: 'video', title: '半导体研究样本',
  published_at: '2026-08-01T00:00:00Z', fetched_at: '2026-08-01T01:00:00Z',
  lang: 'zh', status: 'extracted', raw_len: 4200, n_units: 1, n_claims: 1,
  n_methods: 0, n_concepts: 0, n_hit: 0, n_partial: 0, n_miss: 0,
}

const contentDetail = {
  ...content,
  raw: '这是用于浏览器回归的原始内容。\n\n它必须保留来源，并能回到结构化证据。',
  created_at: '2026-08-01T01:00:00Z',
}

const node = {
  id: 1, kind: 'claim', title: '算力投资支撑半导体需求',
  canonical: '半导体长期需求仍由算力投资驱动。', status: 'active',
  tags: ['semiconductor'], notes: '由一条原始判断形成。', merger_version: 'test-v1',
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
  n_attest: 1, n_creators: 1, n_contents: 1,
  first_seen: '2026-08-01T00:00:00Z', last_seen: '2026-08-01T00:00:00Z',
  hit: 0, partial: 0, miss: 0,
}

const weekly = {
  generated_at: '2026-08-14T00:00:00Z', path: 'fixture.md', markdown: '',
  summary: {
    new_contents: [{ name: creator.name, n: 1, chars: 4200 }],
    new_units: [{ kind: 'claim', n: 1 }], new_scores: [], new_edges: [],
    node_status: [{ status: 'active', n: 1 }], notable_nodes: [], due_next: [],
    spot_check: { checked: 0, total: 1 },
  },
}

function responseFor(url: URL): unknown {
  const path = url.pathname
  if (path === '/knowledge/overview') return { contents: 49, units: 798, nodes: 448, creators: 3, corroborated: 9, claims: 295, methods: 102, concepts: 401 }
  if (path === '/knowledge/creators') return [creator]
  if (path === '/knowledge/contents') return [content]
  if (path === '/knowledge/contents/1') return contentDetail
  if (path === '/knowledge/contents/1/units') return [unit]
  if (path === '/knowledge/units-page') {
    const limit = Number(url.searchParams.get('limit') ?? 100)
    const offset = Number(url.searchParams.get('offset') ?? 0)
    const items = allUnits.slice(offset, offset + limit)
    return {
      items,
      total: allUnits.length,
      offset,
      limit,
      has_more: offset + items.length < allUnits.length,
      counts: { claim: allUnits.length, method: 0, concept: 0 },
      creator_counts: { '1': allUnits.length },
    }
  }
  if (path === '/knowledge/units') return [unit]
  if (path === '/knowledge/units/1') return unit
  if (path === '/knowledge/tags') return [{ tag: 'semiconductor', n: 1, n_claims: 1, n_methods: 0, n_concepts: 0 }]
  if (path === '/knowledge/nodes-page') return { items: [node], total: 1, offset: 0, limit: 200, has_more: false }
  if (path === '/knowledge/nodes/1') return { ...node, attestations: [{ relation: 'restates', note: null, unit_id: 1, kind: 'claim', quote: unit.quote, locator: unit.locator, published_at: unit.published_at, tags: unit.tags, payload: unit.payload, creator: creator.name, content_id: 1, content_title: content.title, scores: [] }], relations: [] }
  if (path === '/knowledge/nodes') return []
  if (path === '/knowledge/verification-summary') return { overview: { due: 0, completed: 0, unavailable: 0, review: 0 }, nearest_due: [] }
  if (path === '/knowledge/verification-page') return { items: [], total: 0, offset: 0, limit: 200, has_more: false }
  if (path === '/knowledge/relations') return []
  if (path === '/knowledge/harness-candidates') return []
  if (path === '/knowledge/weekly') return weekly
  if (path === '/knowledge/spot-checks') return { total: 1, checked: 0, faithful: 0, unfaithful: 0, unclear: 0, recent: [] }
  if (path === '/research/docs') return []
  return null
}

async function fulfill(route: Route) {
  const url = new URL(route.request().url())
  if (!url.pathname.startsWith('/knowledge/') && !url.pathname.startsWith('/research/')) {
    await route.fallback()
    return
  }
  // 后续页故意慢：滚动触发的翻页必须在“用户还在继续滚”的窗口内仍然完成。
  if (url.pathname === '/knowledge/units-page' && Number(url.searchParams.get('offset') ?? 0) > 0) {
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  const payload = responseFor(url)
  if (payload === null) {
    await route.fulfill({ json: { detail: 'Fixture route not found' }, status: 404 })
    return
  }
  await route.fulfill({ json: payload, status: 200 })
}

export async function mockApi(page: Page) {
  await page.route(/\/knowledge\/|\/research\//, fulfill)
}
