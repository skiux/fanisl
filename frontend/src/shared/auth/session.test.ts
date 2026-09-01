import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setUnauthenticatedHandler } from '../api/client'
import { getSession, login, logout, markAnonymous, refreshSession, subscribe } from './session'

const USER = {
  id: 1, username: 'alice', role: 'admin' as const, display_name: '爱丽丝',
  is_active: true, last_login_at: null,
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  markAnonymous()
  setUnauthenticatedHandler(() => {})
})
afterEach(() => vi.unstubAllGlobals())

describe('会话状态', () => {
  it('/auth/me 成功即为已登录', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ user: USER })))
    await refreshSession()
    expect(getSession()).toEqual({ status: 'authenticated', user: USER })
  })

  it('/auth/me 返回 401 就是未登录，且不当成异常抛出去', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ detail: '未登录' }, 401)))
    await expect(refreshSession()).resolves.toEqual({ status: 'anonymous' })
  })

  it('后端挂了也落到未登录（而不是卡在 checking）', async () => {
    // 卡在 checking 的话界面会永远停在"正在确认会话"，比显示登录页更难看懂
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await refreshSession()
    expect(getSession().status).toBe('anonymous')
  })

  it('登录成功后状态切换并通知订阅者', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ user: USER })))
    const seen: string[] = []
    const stop = subscribe(() => seen.push(getSession().status))
    await login('alice', 'pw')
    stop()
    expect(getSession()).toEqual({ status: 'authenticated', user: USER })
    expect(seen).toContain('authenticated')
  })

  it('口令错误时把错误抛给表单，状态保持未登录', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      json({ detail: '用户名或口令不正确' }, 401)))
    await expect(login('alice', 'bad')).rejects.toMatchObject({
      status: 401, message: '用户名或口令不正确',
    })
    expect(getSession().status).toBe('anonymous')
  })

  it('被限速时把后端那句话原样交给表单', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      json({ detail: '失败次数过多，请 15 分钟后再试' }, 429)))
    await expect(login('alice', 'bad')).rejects.toMatchObject({ status: 429 })
  })

  it('退出成功后回到未登录', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ user: USER })))
    await refreshSession()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ok: true })))
    await logout()
    expect(getSession().status).toBe('anonymous')
  })

  it('退出失败时清本地状态但把错误抛出去', async () => {
    // 服务端会话其实还活着。静默吞掉等于骗人——界面显示已退出、cookie 仍然有效。
    // 调用方（顶栏）接住之后刷新页面，让 /auth/me 说真话。
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ user: USER })))
    await refreshSession()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')))
    await expect(logout()).rejects.toThrow()
    expect(getSession().status).toBe('anonymous')
  })
})

describe('全局 401', () => {
  it('普通接口的 401 会触发登出回调', async () => {
    const onLost = vi.fn()
    setUnauthenticatedHandler(onLost)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ detail: '未登录' }, 401)))
    const { apiJson } = await import('../api/client')
    await expect(apiJson('/knowledge/overview')).rejects.toMatchObject({ status: 401 })
    expect(onLost).toHaveBeenCalledOnce()
  })

  it('登录接口的 401 不触发——那是口令错，不是会话没了', async () => {
    // 不排除的话：输错一次口令 → 触发全局登出 → 登录页自己把自己重置一遍
    const onLost = vi.fn()
    setUnauthenticatedHandler(onLost)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      json({ detail: '用户名或口令不正确' }, 401)))
    await expect(login('alice', 'bad')).rejects.toMatchObject({ status: 401 })
    expect(onLost).not.toHaveBeenCalled()
  })
})

describe('请求带上 cookie', () => {
  it('credentials 必须是 include', async () => {
    // 本机开发是跨端口的（页面 5173、API 8000），默认的 same-origin 会把 cookie 丢掉，
    // 表现是"登录成功了但每个请求还是 401"
    const fetchMock = vi.fn().mockResolvedValue(json({ user: USER }))
    vi.stubGlobal('fetch', fetchMock)
    await refreshSession()
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include' })
  })
})
