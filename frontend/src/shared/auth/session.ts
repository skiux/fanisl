/**
 * 会话状态：一个极小的可订阅 store + 三个接口调用。
 *
 * 会话 cookie 是 HttpOnly 的，JS 读不到——所以"我登录了吗"这件事只能问后端
 * （`GET /auth/me`）。不要试图在 localStorage 里镜像一份登录态：那份镜像与真实
 * 会话没有任何强制关系，过期之后界面会显示成已登录、每个请求却都 401。
 */

import { apiJson, ApiError } from '../api/client'

export type Role = 'admin' | 'member'

export type User = {
  id: number
  username: string
  role: Role
  display_name: string
  is_active: boolean
  last_login_at: string | null
}

export type SessionState =
  | { status: 'checking' }
  | { status: 'authenticated'; user: User }
  | { status: 'anonymous' }

let state: SessionState = { status: 'checking' }
const listeners = new Set<() => void>()

function set(next: SessionState) {
  state = next
  listeners.forEach((fn) => fn())
}

export function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getSession(): SessionState {
  return state
}

/** 供 api/client.ts 在任意请求收到 401 时调用：把整个界面切回登录页。 */
export function markAnonymous() {
  if (state.status !== 'anonymous') set({ status: 'anonymous' })
}

export async function refreshSession(): Promise<SessionState> {
  try {
    const payload = await apiJson<{ user: User }>('/auth/me')
    set({ status: 'authenticated', user: payload.user })
  } catch (error) {
    // 401 是常态（没登录），其余错误（后端挂了/网络断了）也只能显示登录页——
    // 但错误本身由登录页在提交时再暴露，这里不吞掉也不弹窗。
    if (!(error instanceof ApiError) || error.status !== 401) {
      console.warn('[auth] 读取会话失败', error)
    }
    set({ status: 'anonymous' })
  }
  return state
}

export async function login(username: string, password: string): Promise<User> {
  const payload = await apiJson<{ user: User }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  set({ status: 'authenticated', user: payload.user })
  return payload.user
}

/**
 * 退出。本地状态一定清掉（用户要走就让他走），但**失败会往上抛**。
 *
 * 这一点值得说清楚：退出请求失败时，服务端的会话其实还活着。静默吞掉错误等于骗人——
 * 界面显示已退出，cookie 却仍然有效。调用方接住之后应当刷新页面重新问一次
 * `/auth/me`，让服务器说真话，而不是由前端猜。
 */
export async function logout(): Promise<void> {
  try {
    await apiJson('/auth/logout', { method: 'POST' })
  } catch (error) {
    set({ status: 'anonymous' })
    throw error
  }
  set({ status: 'anonymous' })
}
