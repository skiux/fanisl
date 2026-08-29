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
    metrics: null, instrument: 'NVDA', news: null,
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
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  })
}

function stubApi() {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/asset/')) return Promise.resolve(jsonResponse(dossier))
    if (url.includes('/asset')) return Promise.resolve(jsonResponse(index))
    return Promise.resolve(jsonResponse({ symbol: 'NVDA', note: '', bars: [] }))
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

describe('标的列表', () => {
  it('列出标的并把没有到期样本的写成未验证，而不是 0%', async () => {
    render(<AssetPage />)
    await screen.findByText('黄金')

    expect(screen.getByText('英伟达')).toBeTruthy()
    expect(screen.getByText('62%')).toBeTruthy()
    expect(screen.getByText('n=13')).toBeTruthy()
    expect(screen.getByText('未验证')).toBeTruthy()
    expect(screen.getByText('无到期样本')).toBeTruthy()
  })

  it('把三个总量算成全库口径，而不是当前页长度', async () => {
    render(<AssetPage />)
    await screen.findByText('黄金')
    // 未到期 3 + 23 + 1 = 27；已判定 13 + 57 + 0 = 70
    expect(screen.getByText('27')).toBeTruthy()
    expect(screen.getByText('70')).toBeTruthy()
  })

  it('按类别过滤后只留下该类别的标的', async () => {
    render(<AssetPage />)
    await screen.findByText('黄金')
    const filters = within(screen.getByRole('group', { name: '按类别过滤' }))
    await userEvent.click(filters.getByRole('button', { name: /贵金属/ }))
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

  it('把未到期判断连同冻结判据完整展示', async () => {
    render(<AssetPage />)
    await screen.findByText('英伟达还有空间')

    expect(screen.getByText('到期收盘高于发布参考价即命中')).toBeTruthy()
    expect(screen.getByText('2099/12/31')).toBeTruthy()
    const link = screen.getByRole('link', { name: /英伟达还有空间/ })
    expect(link.getAttribute('href')).toBe('#/knowledge?unit=42&view=evidence')
  })

  it('数据覆盖如实写明缺什么、为什么缺', async () => {
    render(<AssetPage />)
    await screen.findByText('数据覆盖')

    expect(screen.getByText(/全维度指标的高频采集当前只覆盖|41 个 metric/)).toBeTruthy()
    expect(screen.getByText(/名称\/行业\/市值\/估值待公司资料源落地/)).toBeTruthy()
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
})
