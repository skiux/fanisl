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


// 标的工作台：一个有战绩与未到期判断的标的，一个还没有到期样本的标的。
const assetRow = {
  asset: 'SOXX', display: '半导体 ETF', asset_class: 'etf', class_label: 'ETF',
  registered: true, has_bars: true, has_metrics: false,
  units: 53, claims: 36, methods: 10, concepts: 7, creators: 3,
  first_seen: '2026-05-01T00:00:00Z', last_seen: '2026-08-14T00:00:00Z',
  scored: 27, hits: 14, partials: 3, misses: 10, unresolved: 2,
  open_claims: 2, hit_rate: 0.574,
  bars: { symbol: 'SOXX', n: 185, first: '2025-12-01', last: '2026-08-26' },
  news: null,
  profile_at: null,
}

const assetIndex = {
  total: 2,
  classes: { etf: 'ETF', stock: '个股' },
  assets: [
    assetRow,
    {
      ...assetRow, asset: 'PLTR', display: 'Palantir', asset_class: 'stock', class_label: '个股',
      units: 17, claims: 4, methods: 2, concepts: 11, creators: 2,
      scored: 0, hits: 0, partials: 0, misses: 0, unresolved: 0, open_claims: 1, hit_rate: null,
      bars: null, has_bars: false,
    },
  ],
}

const upcomingHorizon = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10)

const assetDossier = {
  asset: 'SOXX',
  identity: {
    id: 'SOXX', display: '半导体 ETF', asset_class: 'etf', class_label: 'ETF',
    tag: 'soxx', aliases: [], related: ['SMH'], note: '', registered: true,
  },
  coverage: {
    bars: true, bars_note: '', bars_window: { symbol: 'SOXX', n: 185, first: '2025-12-01', last: '2026-08-26' },
    metrics: null, instrument: null,
    news: { asset: 'SOXX', n: 4, latest: '2026-08-29T02:00:00Z', noise: 3 },
    has_company: true, has_earnings: true,
  },
  summary: assetRow,
  by_creator: [{
    creator_id: 1, creator: creator.name, units: 30, claims: 20,
    last_seen: '2026-08-14T00:00:00Z', scored: 18, hits: 10, partials: 2, misses: 6, hit_rate: 0.611,
  }],
  open_claims: [{
    unit_id: 1, horizon_label: upcomingHorizon, quote: '半导体长期需求仍由算力投资驱动。',
    payload: {
      direction: 'up', verifiability: 'A', stance_strength: 'explicit',
      scoring_spec: { method: 'sign', eval_ladder: [upcomingHorizon], success_def: '中期收益为正' },
    },
    published_at: '2026-08-01T00:00:00Z', ref_price_at_publish: 250, tags: ['semiconductor'],
    creator: creator.name, content_id: 1, content_title: '半导体研究样本',
  }],
  settled_claims: [],
  nodes: [node],
  disagreements: { relations: [], evolution: [] },
  related_assets: [{ asset: 'PLTR', display: 'Palantir', asset_class: 'stock', co_mentions: 3 }],
  profile: {
    asset: 'SOXX', name: 'iShares Semiconductor ETF', description: '半导体板块 ETF。',
    industry: 'ETF', exchange: 'ARCX', country: 'US', currency: 'USD', cik: null,
    homepage: 'https://example.test/soxx', logo: null, listed_on: '2001-07-10',
    employees: null, market_cap: 1.4e10, shares_out: null,
    metrics: { pe_ttm: 31.2, ps_ttm: 7.8, gross_margin: 52.1 },
    sources: { name: 'polygon', metrics: 'finnhub' },
    fetched_at: '2026-08-30T00:00:00Z',
  },
  news: [{
    id: 11, published_at: '2026-08-29T02:00:00Z', title: '半导体板块单周资金流转正',
    summary: 'Flows turn positive.', url: 'https://example.test/news/soxx-1',
    source: 'TestWire', provider: 'finnhub', image_url: null,
    relevance: 'core', note: '板块资金面出现回补迹象。',
  }],
  events: [{
    asset: 'SOXX', kind: 'earnings', event_date: upcomingHorizon, session: 'amc',
    source: 'finnhub',
    payload: { quarter: 3, fiscal_year: 2027, eps_estimate: 1.23, eps_actual: null },
  }],
  trades: [{
    id: 3, account: 'setups', symbol: 'SOXX/USDT:USDT', side: 'long', status: 'closed',
    setup_key: 'ema_tunnel', leverage: 2, qty: 5, avg_entry: 240,
    opened_at: '2026-08-01T00:00:00Z', closed_at: '2026-08-09T00:00:00Z',
    created_at: '2026-08-01T00:00:00Z', outcome: 'win', pnl_abs: 61.2, pnl_pct: 5.1,
    realized_r: 1.4, exit_reason: '止盈',
  }],
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
  if (path === '/knowledge/verification-summary') {
    return {
      overview: { due: 1, completed: 1, unavailable: 0, review: 0 },
      nearest_due: [{
        unit_id: 1, quote: unit.quote, payload: unit.payload,
        published_at: unit.published_at, ref_price_at_publish: unit.ref_price_at_publish,
        creator: creator.name, content_title: content.title, horizon_label: upcomingHorizon,
      }],
    }
  }
  if (path === '/knowledge/recent-scores') {
    return [{
      id: 5, unit_id: 1, quote: '半导体这一段已经走完', payload: { asset_symbol: 'SOXX' },
      creator: creator.name, outcome: 'hit', horizon_label: '2026-08-18',
      eval_ts: '2026-08-18T00:00:00Z', scored_at: '2026-08-18T00:00:00Z',
    }]
  }
  if (path === '/knowledge/verification-page') return { items: [], total: 0, offset: 0, limit: 200, has_more: false }
  if (path === '/knowledge/relations') return []
  if (path === '/knowledge/harness-candidates') return []
  if (path === '/knowledge/weekly') return weekly
  if (path === '/knowledge/spot-checks') return { total: 1, checked: 0, faithful: 0, unfaithful: 0, unclear: 0, recent: [] }
  if (path === '/research/docs') return []
  if (path === '/knowledge/prices') {
    // 一段能画出来的日线：判定与到期日都落在窗口里，价格证据图才真的被渲染过。
    const bars = Array.from({ length: 40 }, (_, index) => {
      const day = new Date(Date.UTC(2026, 6, 1) + index * 86400000).toISOString().slice(0, 10)
      const close = 240 + Math.round(Math.sin(index / 4) * 12)
      return { ts: day, open: close - 1, high: close + 3, low: close - 3, close }
    })
    return { symbol: url.searchParams.get('symbol') ?? 'SOXX', note: '日线收盘口径', bars }
  }
  if (path === '/asset') return assetIndex
  if (path.startsWith('/asset/')) {
    const id = decodeURIComponent(path.slice('/asset/'.length))
    return id === 'SOXX' ? assetDossier : null
  }
  return null
}

async function fulfill(route: Route) {
  const url = new URL(route.request().url())
  // `/assets/*` 是 Vite 的构建产物，绝不能被当成 API——所以是精确匹配，不是前缀匹配。
  const isAsset = url.pathname === '/asset' || url.pathname.startsWith('/asset/')
  if (!isAsset && !url.pathname.startsWith('/knowledge/') && !url.pathname.startsWith('/research/')) {
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

// 加了会话闸门之后，任何页面挂载前都会先问一次 /auth/me。默认给一个已登录的用户，
// 让原有的用例继续验它们本来要验的东西；登录流程本身由 auth.spec.ts 单独覆盖。
const SESSION_USER = {
  id: 1, username: 'tester', role: 'member', display_name: '测试用户',
  is_active: true, created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z', last_login_at: null,
}

export async function mockAuth(page: Page, user: unknown = SESSION_USER) {
  await page.route('**/auth/me', async (route) => {
    if (user === null) {
      await route.fulfill({ json: { detail: '未登录或会话已过期' }, status: 401 })
      return
    }
    await route.fulfill({ json: { user }, status: 200 })
  })
}

export async function mockApi(page: Page, userOverrides?: Record<string, unknown>) {
  await mockAuth(page, userOverrides ? { ...SESSION_USER, ...userOverrides } : SESSION_USER)
  await page.route(/\/knowledge\/|\/research\/|\/asset(\/|$)/, fulfill)
}
