import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setUnauthenticatedHandler } from './http'
import { getSession, login, logout, markAnonymous, refreshSession, subscribe } from './session'

const USER = {
  id: 1, username: 'alice', role: 'admin' as const, display_name: '爱丽丝',
  is_active: true, created_at: null, updated_at: null, last_login_at: null,
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

describe('会话', () => {
  it('/auth/me 成功即已登录', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ user: USER })))
    await refreshSession()
    expect(getSession()).toEqual({ status: 'authenticated', user: USER })
  })

  it('401 就是未登录，不当异常抛出去', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ detail: '未登录' }, 401)))
    await expect(refreshSession()).resolves.toEqual({ status: 'anonymous' })
  })

  it('后端挂了也落到未登录，而不是卡在 checking', async () => {
    // 卡在 checking 的话界面永远停在"正在确认会话"，比显示登录页更难看懂
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await refreshSession()
    expect(getSession().status).toBe('anonymous')
  })

  it('登录成功通知订阅者', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ user: USER })))
    const seen: string[] = []
    const stop = subscribe(() => seen.push(getSession().status))
    await login('alice', 'pw')
    stop()
    expect(seen).toContain('authenticated')
  })

  it('口令错误把错误交给表单，状态保持未登录', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      json({ detail: '用户名或口令不正确' }, 401)))
    await expect(login('alice', 'bad')).rejects.toMatchObject({ status: 401 })
    expect(getSession().status).toBe('anonymous')
  })

  it('退出失败清本地状态但把错误抛出去', async () => {
    // 服务端会话其实还活着。静默吞掉等于骗人——调用方接住后刷新页面让服务器说真话
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ user: USER })))
    await refreshSession()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')))
    await expect(logout()).rejects.toThrow()
    expect(getSession().status).toBe('anonymous')
  })
})
