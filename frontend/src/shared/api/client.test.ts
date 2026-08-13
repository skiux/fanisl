import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiJson } from './client'

afterEach(() => vi.unstubAllGlobals())

describe('apiJson', () => {
  it('rejects an HTML fallback instead of treating it as API data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>app</html>', {
      headers: { 'content-type': 'text/html' },
      status: 200,
    })))

    await expect(apiJson('/knowledge/overview')).rejects.toMatchObject({
      message: 'API 返回了非 JSON 响应',
      status: 502,
    })
  })

  it('rejects malformed JSON and invalid runtime contracts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{', {
      headers: { 'content-type': 'application/json' },
      status: 200,
    })).mockResolvedValueOnce(new Response('{"items":[]}', {
      headers: { 'content-type': 'application/json' },
      status: 200,
    })))

    await expect(apiJson('/malformed')).rejects.toMatchObject({ status: 502 })
    await expect(apiJson('/invalid', undefined, (value): value is { total: number } => (
      typeof value === 'object' && value !== null && 'total' in value
    ))).rejects.toMatchObject({ message: 'API 返回的数据结构不符合约定' })
  })

  it('times out a request that never resolves', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
    })))

    await expect(apiJson('/slow', { timeoutMs: 5 })).rejects.toMatchObject({
      message: '请求超时，请稍后重试',
      status: 408,
    })
  })
})
