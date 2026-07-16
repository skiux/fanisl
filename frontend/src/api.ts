import type {
  CatalystItem,
  CollectionStatus,
  Conversation,
  Message,
  MetricPoint,
  Price,
  StreamHandlers,
  Watchlist,
} from './types'

// 后端地址；需要时用 VITE_API_BASE 覆盖
const API = (import.meta as any).env?.VITE_API_BASE ?? 'http://127.0.0.1:8000'

export async function fetchPrices(symbols: string[]): Promise<Price[]> {
  const q = encodeURIComponent(symbols.join(','))
  const r = await fetch(`${API}/price?symbols=${q}`)
  if (!r.ok) throw new Error(`price ${r.status}`)
  return r.json()
}

// --- 市场数据（采集的时间序列）---------------------------------------------

export async function fetchWatchlist(): Promise<Watchlist> {
  const r = await fetch(`${API}/watchlist`)
  if (!r.ok) throw new Error(`watchlist ${r.status}`)
  return r.json()
}

export async function fetchMetrics(
  symbol: string,
  names: string[],
  since?: string,
): Promise<Record<string, MetricPoint[]>> {
  const q = new URLSearchParams({ symbol, names: names.join(',') })
  if (since) q.set('since', since)
  const r = await fetch(`${API}/metrics?${q.toString()}`)
  if (!r.ok) throw new Error(`metrics ${r.status}`)
  const d = await r.json()
  return d.series ?? {}
}

export interface CatalogMetric {
  name: string
  category: string
  unit: string
  scope: string
  label: string
  ts_meaning: string
}

export interface MetricCoverage {
  metric: string
  samples: number
  first_ts: string
  last_ts: string
  last_value: number | null
}

export async function fetchCatalog(): Promise<{ timeframes: string[]; metrics: CatalogMetric[] }> {
  const r = await fetch(`${API}/metrics/catalog`)
  if (!r.ok) throw new Error(`catalog ${r.status}`)
  return r.json()
}

export async function fetchAvailable(symbol: string): Promise<MetricCoverage[]> {
  const r = await fetch(`${API}/metrics/available?symbol=${encodeURIComponent(symbol)}`)
  if (!r.ok) throw new Error(`available ${r.status}`)
  const d = await r.json()
  return d.coverage ?? []
}

export async function fetchStoredCatalysts(symbol?: string): Promise<CatalystItem[]> {
  const q = symbol ? `?symbol=${encodeURIComponent(symbol)}` : ''
  const r = await fetch(`${API}/catalysts/stored${q}`)
  if (!r.ok) throw new Error(`catalysts ${r.status}`)
  return r.json()
}

export async function fetchCollectionStatus(): Promise<CollectionStatus> {
  const r = await fetch(`${API}/collection/status`)
  if (!r.ok) throw new Error(`status ${r.status}`)
  return r.json()
}

// --- 交易评测台 -------------------------------------------------------------

const acctQ = (account?: string) => (account ? `?account=${encodeURIComponent(account)}` : '')

// 出错时尽量带出后端的 detail（如 502 的"Claude API 错误: No available accounts"），而非只给状态码
async function errText(r: Response, label: string): Promise<string> {
  try {
    const d = await r.json()
    if (d?.detail) return `${label} ${r.status}：${d.detail}`
  } catch {
    /* 非 JSON 响应，忽略 */
  }
  return `${label} ${r.status}`
}

export interface TradingAccount {
  name: string
  id: number
  force: boolean
  managed: boolean
  mirror_of: string | null
  setups: boolean
  manual: boolean
  summary: any
  scorecard: any
}

export async function fetchTradingAccounts(): Promise<TradingAccount[]> {
  const r = await fetch(`${API}/trading/accounts`)
  if (!r.ok) throw new Error(`accounts ${r.status}`)
  return r.json()
}

export async function fetchTradingAccount(account?: string): Promise<any> {
  const r = await fetch(`${API}/trading/account${acctQ(account)}`)
  if (!r.ok) throw new Error(`account ${r.status}`)
  return r.json()
}

export async function fetchTrades(account?: string): Promise<any[]> {
  const r = await fetch(`${API}/trading/trades${acctQ(account)}`)
  if (!r.ok) throw new Error(`trades ${r.status}`)
  return r.json()
}

export async function fetchTradeTimeline(id: number): Promise<any> {
  const r = await fetch(`${API}/trading/trades/${id}`)
  if (!r.ok) throw new Error(`trade ${r.status}`)
  return r.json()
}

export async function cancelTrade(id: number): Promise<any> {
  const r = await fetch(`${API}/trading/trades/${id}/cancel`, { method: 'POST' })
  if (!r.ok) throw new Error(`cancel ${r.status}`)
  return r.json()
}

export async function fetchDeclines(account?: string): Promise<any[]> {
  const r = await fetch(`${API}/trading/declines${acctQ(account)}`)
  if (!r.ok) throw new Error(`declines ${r.status}`)
  return r.json()
}

export async function openTrade(symbol: string, account?: string): Promise<any> {
  const r = await fetch(`${API}/trading/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, account }),
  })
  if (!r.ok) throw new Error(await errText(r, '开仓'))
  return r.json()
}

export async function fetchTradingSymbols(): Promise<string[]> {
  const r = await fetch(`${API}/trading/symbols`)
  if (!r.ok) throw new Error(`symbols ${r.status}`)
  const d = await r.json()
  return d.symbols ?? []
}

export async function fetchPositions(account?: string): Promise<any[]> {
  const r = await fetch(`${API}/trading/positions${acctQ(account)}`)
  if (!r.ok) throw new Error(`positions ${r.status}`)
  return r.json()
}

export async function scanTrading(account?: string): Promise<any> {
  const r = await fetch(`${API}/trading/scan${acctQ(account)}`, { method: 'POST' })
  if (!r.ok) throw new Error(await errText(r, '扫描'))
  return r.json()
}

export async function setForceTrade(enabled: boolean, account?: string): Promise<any> {
  const r = await fetch(`${API}/trading/account/force`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled, account }),
  })
  if (!r.ok) throw new Error(`force ${r.status}`)
  return r.json()
}

export async function tickTrading(account?: string): Promise<any> {
  const r = await fetch(`${API}/trading/tick${acctQ(account)}`, { method: 'POST' })
  if (!r.ok) throw new Error(await errText(r, '推进'))
  return r.json()
}

// --- Setup 评测（playbook 触发 → 闸门 → 按 setup 聚合）---------------------

export interface SetupsView {
  registry: Record<string, any>
  scorecard: any[]
  signals: any[]
}

export async function fetchSetups(account?: string): Promise<SetupsView> {
  const r = await fetch(`${API}/trading/setups${acctQ(account)}`)
  if (!r.ok) throw new Error(`setups ${r.status}`)
  return r.json()
}

export interface ManualOpen {
  symbol: string
  side: string
  setup_key: string
  entry_type: string
  entry_price: number
  sl_price: number
  tp_price: number | null
  risk_pct: number
  leverage: number
  thesis: string | null
}

export async function manualOpen(plan: ManualOpen, account?: string): Promise<any> {
  const r = await fetch(`${API}/trading/manual/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...plan, account }),
  })
  if (!r.ok) throw new Error(await errText(r, '录入'))
  return r.json()
}

export async function manualClose(tradeId: number, reason?: string): Promise<any> {
  const r = await fetch(`${API}/trading/manual/${tradeId}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  })
  if (!r.ok) throw new Error(await errText(r, '平仓'))
  return r.json()
}

export async function detectSetups(account?: string): Promise<any> {
  const r = await fetch(`${API}/trading/detect${acctQ(account)}`, { method: 'POST' })
  if (!r.ok) throw new Error(await errText(r, '探测'))
  return r.json()
}

// --- 知识引擎（信源 / L0 内容）----------------------------------------------

export async function fetchKnowledgeCreators(): Promise<any[]> {
  const r = await fetch(`${API}/knowledge/creators`)
  if (!r.ok) throw new Error(`creators ${r.status}`)
  return r.json()
}

export async function fetchKnowledgeContents(status?: string): Promise<any[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : ''
  const r = await fetch(`${API}/knowledge/contents${q}`)
  if (!r.ok) throw new Error(`contents ${r.status}`)
  return r.json()
}

export async function fetchKnowledgeContent(id: number): Promise<any> {
  const r = await fetch(`${API}/knowledge/contents/${id}`)
  if (!r.ok) throw new Error(`content ${r.status}`)
  return r.json()
}

export async function fetchKnowledgeUnits(contentId: number): Promise<any[]> {
  const r = await fetch(`${API}/knowledge/contents/${contentId}/units`)
  if (!r.ok) throw new Error(`units ${r.status}`)
  return r.json()
}

export async function fetchKnowledgeScoreboard(): Promise<any[]> {
  const r = await fetch(`${API}/knowledge/scoreboard`)
  if (!r.ok) throw new Error(`scoreboard ${r.status}`)
  return r.json()
}

// --- 会话管理 ---------------------------------------------------------------

export async function listConversations(): Promise<Conversation[]> {
  const r = await fetch(`${API}/conversations`)
  if (!r.ok) throw new Error(`list ${r.status}`)
  return r.json()
}

export async function getConversation(
  id: number,
): Promise<{ id: number; title: string; messages: Message[] }> {
  const r = await fetch(`${API}/conversations/${id}`)
  if (!r.ok) throw new Error(`get ${r.status}`)
  return r.json()
}

export async function deleteConversation(id: number): Promise<void> {
  const r = await fetch(`${API}/conversations/${id}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`delete ${r.status}`)
}

export async function renameConversation(id: number, title: string): Promise<void> {
  const r = await fetch(`${API}/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!r.ok) throw new Error(`rename ${r.status}`)
}

// 用 fetch 读 SSE 流（EventSource 只支持 GET，这里是 POST）
export async function streamChat(
  message: string,
  conversationId: number | null,
  h: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const r = await fetch(`${API}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, conversation_id: conversationId ?? 0 }),
    signal,
  })
  if (!r.ok || !r.body) {
    h.onError?.(`HTTP ${r.status}`)
    return
  }

  const reader = r.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    const blocks = buf.split('\n\n')
    buf = blocks.pop() ?? '' // 最后一段可能不完整，留到下一轮
    for (const block of blocks) {
      let event = 'message'
      let data = ''
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7).trim()
        else if (line.startsWith('data: ')) data += line.slice(6)
      }
      if (!data) continue
      let payload: any
      try {
        payload = JSON.parse(data)
      } catch {
        continue
      }
      if (event === 'start') h.onStart?.(payload.conversation_id)
      else if (event === 'status') h.onStatus?.(payload)
      else if (event === 'delta') h.onDelta?.(payload.text)
      else if (event === 'done') h.onDone?.(payload.conversation_id)
      else if (event === 'error') h.onError?.(payload.detail)
    }
  }
}
