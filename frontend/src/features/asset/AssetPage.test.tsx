import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AssetPage from './AssetPage'
import type { AssetDossierData, AssetRow } from './types'

function row(overrides: Partial<AssetRow>): AssetRow {
  return {
    asset: 'NVDA', display: '英伟达', asset_class: 'stock', class_label: '个股',
    registered: true, has_bars: true, has_metrics: false,
    units: 24, claims: 11, methods: 0, concepts: 13, creators: 2,
    first_seen: '2026-05-01T12:00:00Z', last_seen: '2026-08-14T12:00:00Z',
    scored: 13, hits: 7, partials: 2, misses: 4, unresolved: 1,
    open_claims: 3, hit_rate: 0.615,
    bars: { symbol: 'NVDA', n: 185, first: '2025-12-01', last: '2026-08-26' },
    news: null,
    profile_at: null,
    ...overrides,
  }
}

const index = {
  total: 3,
  classes: { stock: '个股', metal: '贵金属', crypto: '加密' },
  assets: [
    row({}),
    row({
      asset: 'XAUUSD', display: '黄金', asset_class: 'metal', class_label: '贵金属',
      units: 91, scored: 57, hit_rate: 0.456, open_claims: 23,
      bars: { symbol: 'XAUUSD', n: 185, first: '2025-12-01', last: '2026-08-26' },
    }),
    row({
      asset: 'PLTR', display: 'Palantir', units: 17, claims: 4,
      scored: 0, hits: 0, partials: 0, misses: 0, hit_rate: null, open_claims: 1,
      bars: null, has_bars: false,
    }),
  ],
}

const dossier: AssetDossierData = {
  asset: 'NVDA',
  identity: {
    id: 'NVDA', display: '英伟达', asset_class: 'stock', class_label: '个股',
    tag: 'nvda', aliases: [], related: [], note: '', registered: true,
  },
  coverage: {
    bars: true, bars_note: '', bars_window: null,
    metrics: null, instrument: 'NVDA',
    news: { asset: 'NVDA', n: 12, noise: 9 }, has_company: true, has_earnings: true,
  },
  summary: index.assets[0],
  by_creator: [{
    creator_id: 1, creator: 'Andy Lee 财经', units: 18, claims: 8,
    last_seen: '2026-08-14T12:00:00Z', scored: 11, hits: 6, partials: 2, misses: 3, hit_rate: 0.636,
  }],
  open_claims: [{
    unit_id: 42, horizon_label: '2099-12-31', quote: '英伟达还有空间',
    payload: {
      direction: 'up', verifiability: 'B', stance_strength: 'explicit',
      scoring_spec: { method: 'sign', eval_ladder: ['2099-12-31'], success_def: '到期收盘高于发布参考价即命中' },
    },
    published_at: '2026-08-14T12:00:00Z', ref_price_at_publish: 210.5, tags: ['nvda'],
    creator: 'Andy Lee 财经', content_id: 7, content_title: '八月中旬盘面',
  }],
  settled_claims: [],
  nodes: [],
  disagreements: { relations: [], evolution: [] },
  related_assets: [{ asset: 'SOXX', display: '半导体 ETF', asset_class: 'etf', co_mentions: 6 }],
  profile: {
    asset: 'NVDA', name: 'NVIDIA Corporation', description: '图形处理器与加速计算。',
    industry: 'SEMICONDUCTORS', exchange: 'XNAS', country: 'US', currency: 'USD',
    cik: '0001045810', homepage: 'https://www.nvidia.com', logo: null,
    listed_on: '1999-01-22', employees: 42000, market_cap: 5.25e12, shares_out: 2.4e10,
    metrics: { pe_ttm: 33.98, ps_ttm: 21.39, gross_margin: 74.15, revenue_growth_yoy: 70.68 },
    sources: { name: 'polygon', metrics: 'finnhub' },
    fetched_at: '2026-08-30T00:00:00Z',
  },
  news: [
    {
      id: 1, published_at: '2026-08-29T10:00:00Z', title: '英伟达财报后的裂缝',
      summary: 'Growth guidance and margins diverge.', url: 'https://example.test/news/1',
      source: 'TestWire', provider: 'finnhub', image_url: null,
      relevance: 'core' as const, note: '增长指引与毛利率出现背离。',
    },
    {
      id: 2, published_at: '2026-08-28T10:00:00Z', title: '存储涨价延续到 2027',
      summary: null, url: 'https://example.test/news/2',
      source: 'TestWire', provider: 'finnhub', image_url: null,
      relevance: 'context' as const, note: null,
    },
  ],
  events: [
    {
      asset: 'NVDA', kind: 'earnings', event_date: '2026-08-26', session: 'amc',
      source: 'finnhub',
      payload: { quarter: 2, fiscal_year: 2027, eps_estimate: 2.1384, eps_actual: 2.22 },
    },
    {
      asset: 'NVDA', kind: 'earnings', event_date: '2099-11-17', session: 'amc',
      source: 'finnhub',
      payload: { quarter: 3, fiscal_year: 2027, eps_estimate: 2.4659, eps_actual: null },
    },
  ],
  trades: [{
    id: 7, account: 'setups', symbol: 'NVDA/USDT:USDT', side: 'long', status: 'closed',
    setup_key: 'ema_tunnel', leverage: 2, qty: 3, avg_entry: 210.5,
    opened_at: '2026-08-01T00:00:00Z', closed_at: '2026-08-08T00:00:00Z',
    created_at: '2026-08-01T00:00:00Z', outcome: 'win', pnl_abs: 42.5, pnl_pct: 6.7,
    realized_r: 1.8, exit_reason: '止盈',
  }],
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  })
}

const verificationSummary = {
  overview: { due: 12, completed: 34, unavailable: 2, review: 5 },
  nearest_due: [{
    unit_id: 7, quote: '半导体还有一段',
    payload: {
      asset_symbol: 'SOXX', direction: 'up', magnitude: { target: 250 },
      scoring_spec: { success_def: '到期收盘高于发布参考价即命中' },
    },
    creator: 'Andy Lee 财经', horizon_label: '2099-10-01',
  }],
}

const recentScores = [{
  id: 3, unit_id: 9, quote: '黄金到不了', payload: { asset_symbol: 'XAUUSD' },
  creator: 'Andy Lee 财经', outcome: 'miss', horizon_label: '2026-08-18',
  eval_ts: '2026-08-18T00:00:00Z',
}]

function stubApi() {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/knowledge/verification-summary')) return Promise.resolve(jsonResponse(verificationSummary))
    if (url.includes('/knowledge/recent-scores')) return Promise.resolve(jsonResponse(recentScores))
    if (url.includes('/knowledge/prices')) return Promise.resolve(jsonResponse({ symbol: 'NVDA', note: '', bars: [] }))
    if (url.includes('/asset/')) return Promise.resolve(jsonResponse(dossier))
    if (url.includes('/asset')) return Promise.resolve(jsonResponse(index))
    return Promise.resolve(jsonResponse({}))
  }))
}

beforeEach(() => {
  window.location.hash = ''
  stubApi()
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.location.hash = ''
})

describe('工作台首页', () => {
  it('标的栏列出标的，没有到期样本的写未验证而不是 0%', async () => {
    render(<AssetPage />)
    await screen.findByText('黄金')

    const rail = within(screen.getByRole('complementary', { name: '标的列表' }))
    expect(rail.getByText('英伟达')).toBeTruthy()
    expect(rail.getByText('62% n=13')).toBeTruthy()
    expect(rail.getByText('未验证')).toBeTruthy()
    expect(screen.queryByText('0%')).toBeNull()
  })

  it('未选标的时给跨标的的到期日程与最近裁决', async () => {
    render(<AssetPage />)
    await screen.findByText('接下来要交卷')

    expect(screen.getByText('12')).toBeTruthy()              // 21 天内到期
    expect(screen.getByText('看涨 ↑ · 目标 250')).toBeTruthy()  // 到期项给结构化一行
    expect(screen.getByText('黄金到不了')).toBeTruthy()          // 裁决项仍给原句
  })

  it('按类别过滤后标的栏只留下该类别', async () => {
    render(<AssetPage />)
    await screen.findByText('黄金')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '按类别过滤' }), 'metal')
    expect(screen.queryByText('英伟达')).toBeNull()
    expect(screen.getByText('黄金')).toBeTruthy()
  })

  it('点开一个标的会把 id 写进 hash', async () => {
    render(<AssetPage />)
    await screen.findByText('黄金')
    await userEvent.click(screen.getByText('英伟达'))
    expect(window.location.hash).toBe('#/asset?id=NVDA')
  })
})

describe('标的档案', () => {
  beforeEach(() => { window.location.hash = '#/asset?id=NVDA' })

  it('打开标的后标的栏仍在，换标的是一次点击', async () => {
    render(<AssetPage />)
    await screen.findByText('英伟达还有空间')
    const rail = within(screen.getByRole('complementary', { name: '标的列表' }))
    expect(rail.getByRole('button', { name: /黄金/ })).toBeTruthy()
    expect(rail.getByRole('button', { name: /英伟达/ })).toHaveProperty('ariaCurrent', 'true')
  })

  it('默认落在未到期分节，并把冻结判据完整展示', async () => {
    render(<AssetPage />)
    await screen.findByText('英伟达还有空间')

    expect(screen.getByText('到期收盘高于发布参考价即命中')).toBeTruthy()
    expect(screen.getByText('2099/12/31')).toBeTruthy()
    const link = screen.getByRole('link', { name: /英伟达还有空间/ })
    expect(link.getAttribute('href')).toBe('#/knowledge?unit=42&view=evidence')
  })

  it('数据覆盖如实写明缺什么、为什么缺', async () => {
    render(<AssetPage />)
    await screen.findByText('英伟达还有空间')
    await userEvent.click(screen.getByRole('button', { name: '覆盖' }))
    await screen.findByText('数据覆盖')

    expect(screen.getByText(/41 个 metric/)).toBeTruthy()
    // 资料与新闻已经接入了，覆盖条要说"来源与抓取时间"，不能还写着"未接入"
    expect(screen.getByText(/polygon · finnhub · 抓取于/)).toBeTruthy()
    expect(screen.queryByText(/待公司资料源落地/)).toBeNull()
  })

  it('后端不可用时给出可恢复的失败态，而不是空白页', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/asset/')) return Promise.resolve(new Response('boom', { status: 500 }))
      return Promise.resolve(jsonResponse(index))
    }))
    render(<AssetPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: '重试' })).toBeTruthy())
    expect(screen.getByText(/读不到 NVDA 的档案/)).toBeTruthy()
  })

  it('切换分节只换明细，不重新拉档案，并把分节写进 hash', async () => {
    render(<AssetPage />)
    await screen.findByText('英伟达还有空间')
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length

    await userEvent.click(screen.getByRole('button', { name: '战绩 62%' }))
    expect(window.location.hash).toBe('#/asset?id=NVDA&view=record')
    expect(screen.queryByText('英伟达还有空间')).toBeNull()
    expect(screen.getByText(/命中率 =/)).toBeTruthy()
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls)
  })

  it('资料与动态各成一节，口径与来源写在明面上', async () => {
    render(<AssetPage />)
    await screen.findByText('英伟达还有空间')

    await userEvent.click(screen.getByRole('button', { name: '资料' }))
    expect(screen.getByText('NVIDIA Corporation')).toBeTruthy()
    expect(screen.getByText('5.25 万亿 USD')).toBeTruthy()
    expect(screen.getByText('33.98')).toBeTruthy()
    expect(screen.getByText(/口径：polygon · finnhub/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: '动态 2' }))
    const link = screen.getByRole('link', { name: /英伟达财报后的裂缝/ })
    expect(link.getAttribute('href')).toBe('https://example.test/news/1')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('没有公司的标的不摆两个永远空的标签', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/asset/')) {
        return Promise.resolve(jsonResponse({
          ...dossier,
          asset: 'XAUUSD',
          coverage: { ...dossier.coverage, has_company: false, has_earnings: false },
        events: [],
        trades: [],
          profile: null,
          news: [],
        }))
      }
      if (url.includes('/asset')) return Promise.resolve(jsonResponse(index))
      return Promise.resolve(jsonResponse({ symbol: 'XAUUSD', note: '', bars: [] }))
    }))
    render(<AssetPage />)
    await screen.findByText('英伟达还有空间')
    expect(screen.queryByRole('button', { name: '资料' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^动态/ })).toBeNull()
  })

  it('财报日历挂在资料一节里：下一次带倒计时，最近一次算超预期', async () => {
    render(<AssetPage />)
    await screen.findByText('英伟达还有空间')
    await userEvent.click(screen.getByRole('button', { name: '资料' }))

    expect(screen.getByText('财报日历')).toBeTruthy()
    expect(screen.getByText('2099/11/17')).toBeTruthy()
    expect(screen.getByText(/市场预期 EPS 2.47/)).toBeTruthy()
    expect(screen.getByText(/超预期 \+0.08/)).toBeTruthy()
  })

  it('交易分节只在评测台真开过仓时出现', async () => {
    render(<AssetPage />)
    await screen.findByText('英伟达还有空间')
    await userEvent.click(screen.getByRole('button', { name: '交易 1' }))

    expect(screen.getByText('ema_tunnel')).toBeTruthy()
    expect(screen.getByText(/盈 \+6.7% · 1.80R/)).toBeTruthy()
    expect(screen.getByText('NVDA/USDT:USDT')).toBeTruthy()
  })

  it('没有公司也没有交易的标的，只剩五个分节', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/asset/')) {
        return Promise.resolve(jsonResponse({
          ...dossier,
          asset: 'XAUUSD',
          coverage: { ...dossier.coverage, has_company: false, has_earnings: false },
          profile: null, news: [], events: [], trades: [],
        }))
      }
      if (url.includes('/asset')) return Promise.resolve(jsonResponse(index))
      return Promise.resolve(jsonResponse({ symbol: 'XAUUSD', note: '', bars: [] }))
    }))
    render(<AssetPage />)
    await screen.findByText('英伟达还有空间')
    for (const label of ['资料', '交易 1']) {
      expect(screen.queryByRole('button', { name: label })).toBeNull()
    }
    expect(screen.queryByRole('button', { name: /^动态/ })).toBeNull()
  })

  it('库里没有知识单元、但评测台开过仓的标的，交易那一节仍在', async () => {
    // BZ 实测就是这样：0 条知识单元、3 笔交易。早先那版把整页收成只剩"覆盖"，把交易藏没了。
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/asset/')) {
        return Promise.resolve(jsonResponse({
          ...dossier,
          asset: 'BZ',
          identity: { ...dossier.identity, id: 'BZ', display: '布伦特原油' },
          coverage: { ...dossier.coverage, bars_window: null, has_company: false, has_earnings: false },
          summary: null, by_creator: [], open_claims: [], settled_claims: [], nodes: [],
          profile: null, news: [], events: [],
        }))
      }
      if (url.includes('/asset')) return Promise.resolve(jsonResponse(index))
      return Promise.resolve(jsonResponse({ symbol: 'BZ', note: '', bars: [] }))
    }))
    render(<AssetPage />)
    await screen.findByText('ema_tunnel')
    const tabs = within(screen.getByRole('navigation', { name: '证据分节' }))
      .getAllByRole('button').map((node) => node.getAttribute('aria-label'))
    expect(tabs).toEqual(['交易 1', '覆盖'])   // 知识那几节没有内容，不摆；交易与覆盖有
  })

  it('后端比前端旧时给可恢复的失败态，而不是整页崩掉', async () => {
    // 改完后端没重启 uvicorn 就是这个形状：档案里没有 news/events/trades。
    const { news, events, trades, ...stale } = dossier
    void news; void events; void trades
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/asset/')) return Promise.resolve(jsonResponse(stale))
      if (url.includes('/asset')) return Promise.resolve(jsonResponse(index))
      return Promise.resolve(jsonResponse({ symbol: 'NVDA', note: '', bars: [] }))
    }))
    render(<AssetPage />)
    await waitFor(() => expect(screen.getByRole('button', { name: '重试' })).toBeTruthy())
    expect(screen.getByText(/读不到 NVDA 的档案/)).toBeTruthy()
    expect(screen.queryByText('当前页面没有正确载入')).toBeNull()
  })

  it('没写 view 时落到第一个有内容的分节，而不是恒定落在空的"未到期"', async () => {
    // 37% 的标的一条未到期判断都没有，恒定落在那一节等于点开就是空的。
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/asset/')) {
        return Promise.resolve(jsonResponse({
          ...dossier,
          summary: { ...index.assets[0], open_claims: 0 },
          open_claims: [],
          settled_claims: [{
            score_id: 1, unit_id: 2, horizon_label: '2026-08-18', outcome: 'miss',
            realized: null, eval_ts: '2026-08-18T00:00:00Z', quote: '这条已经判过了',
            payload: {}, published_at: '2026-08-01T00:00:00Z', ref_price_at_publish: null,
            creator: 'Andy Lee 财经', content_id: 1, content_title: '样本',
          }],
        }))
      }
      if (url.includes('/asset')) return Promise.resolve(jsonResponse(index))
      return Promise.resolve(jsonResponse({ symbol: 'NVDA', note: '', bars: [] }))
    }))
    render(<AssetPage />)
    await screen.findByText('这条已经判过了')
    expect(screen.getByRole('button', { name: '战绩 62%' }).getAttribute('aria-current')).toBe('true')

    // 但显式点开空的那一节要能停住——空态本身写着"为什么空"
    await userEvent.click(screen.getByRole('button', { name: '未到期 0' }))
    expect(window.location.hash).toBe('#/asset?id=NVDA&view=open')
    expect(screen.getByText(/没有等待到期的判断/)).toBeTruthy()
  })

  it('样本 <5 的标的不在栏里印百分比', async () => {
    const tiny = { ...index, assets: [{ ...index.assets[0], asset: 'META', display: 'Meta',
      scored: 1, hits: 1, partials: 0, misses: 0, hit_rate: 1 }] }
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/asset/')) return Promise.resolve(jsonResponse(dossier))
      if (url.includes('/asset')) return Promise.resolve(jsonResponse(tiny))
      return Promise.resolve(jsonResponse({ symbol: 'META', note: '', bars: [] }))
    }))
    render(<AssetPage />)
    await screen.findByText('Meta')
    expect(screen.getByText('1 中')).toBeTruthy()      // 不是 "100%"
    expect(screen.queryByText(/100%/)).toBeNull()
  })

  it('首页的到期列表给结构化一行与判据，不给口语原句', async () => {
    window.location.hash = ''
    render(<AssetPage />)
    await screen.findByText('接下来要交卷')
    expect(screen.getByText('看涨 ↑ · 目标 250')).toBeTruthy()
    expect(screen.getByText(/到期收盘高于发布参考价即命中/)).toBeTruthy()
    expect(screen.queryByText('半导体还有一段')).toBeNull()
  })

  it('动态给中文摘要、标出相关背景，并说明藏了多少噪音', async () => {
    render(<AssetPage />)
    await screen.findByText('英伟达还有空间')
    await userEvent.click(screen.getByRole('button', { name: '动态 2' }))

    // 有中文摘要就用它——标题是英文的，这是个中文产品
    expect(screen.getByText('增长指引与毛利率出现背离。')).toBeTruthy()
    expect(screen.queryByText('Growth guidance and margins diverge.')).toBeNull()
    expect(screen.getByText('相关背景')).toBeTruthy()
    expect(screen.getByText(/另有 9 条被判为噪音/)).toBeTruthy()
    expect(screen.getByText(/原始记录一条没删/)).toBeTruthy()
  })
})
