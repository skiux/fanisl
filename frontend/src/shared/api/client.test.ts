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

describe('nginx 没代理时的报错', () => {
  it('405 要指到 nginx，不是原样丢一句 Not Allowed', async () => {
    // 线上真踩过：POST /auth/login 落到 SPA 静态兜底 → nginx 回 405 "Not Allowed"，
    // 原样显示让人以为自己记错了口令，而真正的原因在 nginx 的路径正则里
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      '<html><head><title>405 Not Allowed</title></head></html>',
      { status: 405, statusText: 'Not Allowed', headers: { 'content-type': 'text/html' } })))

    await expect(apiJson('/auth/login', { method: 'POST' })).rejects.toMatchObject({
      status: 405,
      message: expect.stringContaining('nginx'),
    })
  })

  it('后端回的 JSON 错误照常原样透出', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ detail: '用户名或口令不正确' }),
      { status: 401, headers: { 'content-type': 'application/json' } })))

    await expect(apiJson('/auth/login', { method: 'POST' })).rejects.toMatchObject({
      message: '用户名或口令不正确',
    })
  })
})
