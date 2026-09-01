import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiJson, ApiError, setUnauthenticatedHandler } from './http'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => setUnauthenticatedHandler(() => {}))
afterEach(() => vi.unstubAllGlobals())

describe('apiJson', () => {
  it('请求必须带 cookie', async () => {
    // 线上同源默认就带，但本机开发跨端口（5175→8000），默认的 same-origin 会把
    // cookie 丢掉——表现是"登录成功了但每个请求还是 401"，很难往 CORS 上想
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    await apiJson('/portfolio')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include' })
  })

  it('把后端的 detail 原样带出来', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      json({ detail: '失败次数过多，请 15 分钟后再试' }, 429)))
    await expect(apiJson('/auth/login')).rejects.toMatchObject({
      status: 429, message: '失败次数过多，请 15 分钟后再试',
    })
  })

  it('非 JSON 响应直说是 nginx 的事', async () => {
    // nginx 少配一个路径前缀时，API 请求会落到 SPA 兜底、返回 index.html。
    // 直接 JSON.parse 只会报一句语法错，指不到真正的原因。
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<!doctype html>', {
      status: 200, headers: { 'content-type': 'text/html' },
    })))
    await expect(apiJson('/portfolio')).rejects.toMatchObject({
      status: 502, message: expect.stringContaining('nginx'),
    })
  })

  it('超时报成人话', async () => {
    vi.stubGlobal('fetch', vi.fn((_u: string, init?: RequestInit) => new Promise(
      (_res, rej) => init?.signal?.addEventListener('abort', () => rej(init.signal?.reason)))))
    await expect(apiJson('/portfolio', { timeoutMs: 5 })).rejects.toMatchObject({
      status: 408, message: '请求超时，请稍后重试',
    })
  })
})

describe('401 分流', () => {
  it('普通接口的 401 触发全局登出', async () => {
    const onLost = vi.fn()
    setUnauthenticatedHandler(onLost)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ detail: '未登录' }, 401)))
    await expect(apiJson('/portfolio')).rejects.toMatchObject({ status: 401 })
    expect(onLost).toHaveBeenCalledOnce()
  })

  it('登录接口的 401 不触发——那是口令错，不是会话没了', async () => {
    // 不排除的话：输错一次口令 → 触发全局登出 → 登录页把自己重置一遍
    const onLost = vi.fn()
    setUnauthenticatedHandler(onLost)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      json({ detail: '用户名或口令不正确' }, 401)))
    await expect(apiJson('/auth/login', { method: 'POST' })).rejects.toMatchObject({ status: 401 })
    expect(onLost).not.toHaveBeenCalled()
  })
})

describe('ApiError', () => {
  it('带上状态码，供上层区分 401 与其他失败', () => {
    const err = new ApiError(503, '上游异常')
    expect(err.status).toBe(503)
    expect(err).toBeInstanceOf(Error)
  })
})
