import type { Page, Route } from '@playwright/test'

// 夹具里的"今天"。页面按浏览器时钟算倒计时、"今天起的到期"，夹具按它造到期日——两边必须是同一个时刻。
// 原先到期日取 Node 的 Date.now()、页面取真实时钟，标的工作台那张截图基线里的日期每天都在变，天天失败。
// mockApi 会把页面时钟钉在这里（只钉 Date，计时器照常走）。
export const FIXTURE_NOW = new Date('2026-09-01T04:00:00Z')

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

const upcomingHorizon = new Date(FIXTURE_NOW.getTime() + 21 * 86400000).toISOString().slice(0, 10)

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
  const unitPath = path.match(/^\/knowledge\/units\/(\d+)$/)
  if (unitPath) return allUnits.find((item) => item.id === Number(unitPath[1])) ?? null
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

// ---- 单元核查（backend/api.md §5.6）----
// 这几条是写接口，本机 API 连的是生产隧道，联调只能在夹具里做。夹具按契约实现状态流转与错误码，
// 每个用例一份独立的状态，互不影响。

type FixtureResolution = { outcome: string; root_cause: string | null; sweep: string | null; followup: string | null }
type FixtureMessage = {
  id: number; role: 'reviewer' | 'extractor'; author: string; body: string; created_at: string
  resolution: FixtureResolution | null
}
type FixtureSnapshot = { quote: string; payload: Record<string, unknown>; tags: string[] }
export type FixtureReview = {
  id: number; unit_id: number; category: string; status: 'open' | 'answered' | 'closed'
  created_by: string; created_at: string; updated_at: string; closed_at: string | null
  messages: FixtureMessage[]
  amendments: Array<{
    id: number; unit_id: number; reason: string; author: string; created_at: string
    changed: string[]; before: FixtureSnapshot; after: FixtureSnapshot
  }>
}

/** 单元 1 上一条已答复（改过单元）、一条已关闭（维持原判）。 */
export function seedReviews(): FixtureReview[] {
  return [
    {
      id: 12, unit_id: 1, category: 'asset', status: 'answered', created_by: 'tester',
      created_at: '2026-08-30T02:00:00Z', updated_at: '2026-08-31T09:30:00Z', closed_at: null,
      messages: [
        {
          id: 30, role: 'reviewer', author: 'tester', created_at: '2026-08-30T02:00:00Z', resolution: null,
          body: '「标的」一栏显示的是整段定级理由，读不成标的。',
        },
        {
          id: 31, role: 'extractor', author: 'claude-session', created_at: '2026-08-31T09:30:00Z',
          body: '确认有误：asset_text 按规范是原文的资产表述，定级理由不该放在这里。',
          resolution: {
            outcome: 'fixed',
            root_cause: 'v2 的 D 级判断没有 success_def，定级理由只能挤进 asset_text。',
            sweep: '查了 c113–c117 的 253 条 v2 判断，另有 12 条同类，已逐条改回。',
            followup: null,
          },
        },
      ],
      amendments: [{
        id: 4, unit_id: 1, reason: 'asset_text 恢复为原文表述', author: 'claude-session',
        created_at: '2026-08-31T09:29:00Z', changed: ['payload.asset_text'],
        before: { quote: unit.quote, payload: { ...unit.payload, asset_text: '半导体（按 §0.6 不替他指定阈值）' }, tags: unit.tags },
        after: { quote: unit.quote, payload: unit.payload, tags: unit.tags },
      }],
    },
    {
      id: 9, unit_id: 1, category: 'quote', status: 'closed', created_by: 'tester',
      created_at: '2026-08-20T02:00:00Z', updated_at: '2026-08-22T02:00:00Z', closed_at: '2026-08-22T02:00:00Z',
      messages: [
        {
          id: 20, role: 'reviewer', author: 'tester', created_at: '2026-08-20T02:00:00Z', resolution: null,
          body: '引文像是截掉了后半句。',
        },
        {
          id: 21, role: 'extractor', author: 'claude-session', created_at: '2026-08-21T02:00:00Z',
          body: '维持原判：后半句转到了另一个话题，与这条判断无关。',
          resolution: { outcome: 'no_change', root_cause: null, sweep: null, followup: null },
        },
      ],
      amendments: [],
    },
  ]
}

type ReviewState = {
  reviews: FixtureReview[]
  forbidWrites: boolean
  role: string
  username: string
  nextId: number
  nextMessageId: number
  tick: number
}

const REVIEW_CATEGORIES = ['quote', 'grade', 'scoring', 'asset', 'statement', 'other']

function bodyError(body: unknown) {
  if (typeof body !== 'string' || !body.trim()) return 'body 不能为空'
  if (body.trim().length > 4000) return 'body 不能超过 4000 字'
  return null
}

async function handleReviews(route: Route, url: URL, state: ReviewState): Promise<boolean> {
  const path = url.pathname
  const unitReviews = path.match(/^\/knowledge\/units\/(\d+)\/reviews$/)
  const reviewAction = path.match(/^\/knowledge\/reviews\/(\d+)\/(messages|close)$/)
  if (!unitReviews && !reviewAction && path !== '/knowledge/reviews') return false

  const request = route.request()
  const reply = (payload: unknown, status = 200) => route.fulfill({ json: payload, status })
  const newestFirst = (items: FixtureReview[]) => [...items].sort((a, b) => b.id - a.id)
  // 角色判定先于请求体校验，与后端一致
  if (request.method() === 'POST' && (state.forbidWrites || state.role !== 'admin')) {
    await reply({ detail: '需要管理员权限' }, 403)
    return true
  }
  const now = new Date(FIXTURE_NOW.getTime() + (state.tick += 1) * 60_000).toISOString()

  if (path === '/knowledge/reviews') {
    const status = url.searchParams.get('status')
    const rows = state.reviews
      .filter((review) => !status || review.status === status)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map(({ messages, amendments, ...review }) => {
        void amendments
        const target = allUnits.find((item) => item.id === review.unit_id) ?? unit
        return {
          ...review, kind: target.kind, content_id: target.content_id, quote: target.quote.slice(0, 80),
          verifiability: target.payload.verifiability ?? null, creator: target.creator,
          n_messages: messages.length, last_message: messages.at(-1)?.body.slice(0, 120) ?? null,
        }
      })
    await reply(rows)
    return true
  }

  if (unitReviews) {
    const unitId = Number(unitReviews[1])
    if (request.method() === 'GET') {
      await reply(newestFirst(state.reviews.filter((review) => review.unit_id === unitId)))
      return true
    }
    const payload = request.postDataJSON() as { category?: string; body?: string }
    if (!REVIEW_CATEGORIES.includes(payload.category ?? '')) {
      await reply({ detail: `category 须为 ${REVIEW_CATEGORIES.join('/')}` }, 400)
      return true
    }
    const invalid = bodyError(payload.body)
    if (invalid) {
      await reply({ detail: invalid }, 400)
      return true
    }
    if (!allUnits.some((item) => item.id === unitId)) {
      await reply({ detail: `单元 ${unitId} 不存在` }, 404)
      return true
    }
    const review: FixtureReview = {
      id: state.nextId++, unit_id: unitId, category: payload.category ?? 'other', status: 'open',
      created_by: state.username, created_at: now, updated_at: now, closed_at: null,
      messages: [{ id: state.nextMessageId++, role: 'reviewer', author: state.username, body: (payload.body ?? '').trim(), created_at: now, resolution: null }],
      amendments: [],
    }
    state.reviews.push(review)
    await reply(review, 201)
    return true
  }

  const review = state.reviews.find((item) => item.id === Number(reviewAction?.[1]))
  if (!review) {
    await reply({ detail: `核查 ${reviewAction?.[1]} 不存在` }, 404)
    return true
  }
  if (reviewAction?.[2] === 'messages') {
    const payload = request.postDataJSON() as { body?: string }
    const invalid = bodyError(payload.body)
    if (invalid) {
      await reply({ detail: invalid }, 400)
      return true
    }
    review.messages.push({ id: state.nextMessageId++, role: 'reviewer', author: state.username, body: (payload.body ?? '').trim(), created_at: now, resolution: null })
    // 任何状态下回复都会置回 open
    Object.assign(review, { status: 'open', closed_at: null, updated_at: now })
    await reply(review)
    return true
  }
  if (review.status === 'closed') {
    await reply({ detail: `核查 ${review.id} 已经关闭` }, 409)
    return true
  }
  Object.assign(review, { status: 'closed', closed_at: now, updated_at: now })
  await reply(review)
  return true
}

async function fulfill(route: Route, state: ReviewState) {
  const url = new URL(route.request().url())
  // `/assets/*` 是 Vite 的构建产物，绝不能被当成 API——所以是精确匹配，不是前缀匹配。
  const isAsset = url.pathname === '/asset' || url.pathname.startsWith('/asset/')
  if (!isAsset && !url.pathname.startsWith('/knowledge/') && !url.pathname.startsWith('/research/')) {
    await route.fallback()
    return
  }
  if (await handleReviews(route, url, state)) return
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

type MockOptions = {
  /** 核查的初始数据，默认 seedReviews()。 */
  reviews?: FixtureReview[]
  /** 模拟会话里的角色已过期：界面按管理员渲染，写接口却回 403。 */
  forbidWrites?: boolean
}

export async function mockApi(page: Page, userOverrides?: Record<string, unknown>, options: MockOptions = {}) {
  const user = userOverrides ? { ...SESSION_USER, ...userOverrides } : SESSION_USER
  await page.clock.setFixedTime(FIXTURE_NOW)
  await mockAuth(page, user)
  const state: ReviewState = {
    reviews: options.reviews ?? seedReviews(),
    forbidWrites: options.forbidWrites ?? false,
    role: user.role,
    username: user.username,
    nextId: 100,
    nextMessageId: 1000,
    tick: 0,
  }
  await page.route(/\/knowledge\/|\/research\/|\/asset(\/|$)/, (route) => fulfill(route, state))
}
