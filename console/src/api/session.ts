/**
 * 会话状态。与 `frontend/src/shared/auth/session.ts` 是同一套语义，但两个应用各自独立
 * 构建、HTTP 层也不同（这边是 api/http.ts），所以各留一份而不是抽公共包——
 * 为 80 行逻辑引入 workspace 包，构建复杂度换来的收益不成比例。
 *
 * 会话 cookie 是 HttpOnly 的，JS 读不到，所以"我登录了吗"只能问后端。
 * 不要在 localStorage 里镜像登录态：那份镜像与真实会话没有强制关系，
 * 过期之后界面显示已登录、每个请求却都 401。
 */

import { apiJson, ApiError } from './http'

export type Role = 'admin' | 'member'

export type User = {
  id: number
  username: string
  role: Role
  display_name: string
  is_active: boolean
  created_at: string | null
  updated_at: string | null
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

export function markAnonymous() {
  if (state.status !== 'anonymous') set({ status: 'anonymous' })
}

export async function refreshSession(): Promise<SessionState> {
  try {
    const payload = await apiJson<{ user: User }>('/auth/me')
    set({ status: 'authenticated', user: payload.user })
  } catch (error) {
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
 * 退出。本地状态一定清掉，但**失败会往上抛**——退出请求失败时服务端会话其实还活着，
 * 静默吞掉等于骗人。调用方接住后应当刷新页面重新问 `/auth/me`，让服务器说真话。
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

export async function changePassword(current: string, next: string): Promise<void> {
  await apiJson('/auth/password', {
    method: 'POST',
    body: JSON.stringify({ current_password: current, new_password: next }),
  })
}

export type SessionRow = {
  created_at: string
  last_seen_at: string
  expires_at: string
  user_agent: string
  ip: string
}

export const listSessions = () => apiJson<SessionRow[]>('/auth/sessions')

/** 撤销**全部**会话，包括当前这条——后端就是这个语义，界面上不要说成"其他设备"。 */
export const revokeAllSessions = () =>
  apiJson<{ revoked: number }>('/auth/sessions', { method: 'DELETE' })

/* --------------------------- 管理员 --------------------------- */

export const listUsers = () => apiJson<User[]>('/admin/users')

export const createUser = (body: {
  username: string; password: string; role: Role; display_name: string
}) => apiJson<User>('/admin/users', { method: 'POST', body: JSON.stringify(body) })

export const updateUser = (id: number, body: {
  role?: Role; is_active?: boolean; display_name?: string
}) => apiJson<User>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

export const resetPassword = (id: number, newPassword: string) =>
  apiJson<{ ok: true }>(`/admin/users/${id}/password`, {
    method: 'POST', body: JSON.stringify({ new_password: newPassword }),
  })

export const deleteUser = (id: number) =>
  apiJson<{ ok: true }>(`/admin/users/${id}`, { method: 'DELETE' })
