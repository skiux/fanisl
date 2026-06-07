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
