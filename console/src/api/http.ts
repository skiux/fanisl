/**
 * 与后端说话的那一层。
 *
 * 三件事必须在这里做对，做错了症状都很难往这里想：
 * - **`credentials: 'include'`**：线上同源浏览器默认带 cookie，但本机开发跨端口
 *   （页面 5175 / API 8000），默认的 `same-origin` 会把 cookie 丢掉——表现是
 *   "登录成功了但每个请求还是 401"。
 * - **非 JSON 响应要当错误**：nginx 少配一个路径前缀时，API 请求会落到 SPA 兜底、
 *   返回 index.html。直接 JSON.parse 会报一句莫名其妙的语法错，指不到真正的原因。
 * - **401 分流**：除 `/auth/*` 外的 401 都意味着会话没了，界面该整体切回登录页；
 *   登录时口令输错也是 401，那是表单内的错误，不能触发全局登出。
 */

const RAW_BASE = import.meta.env.VITE_API_BASE
const BASE = (RAW_BASE ?? (import.meta.env.DEV ? 'http://127.0.0.1:8000' : ''))
  .replace(/\/$/, '')

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

let onUnauthenticated: (() => void) | null = null

export function setUnauthenticatedHandler(handler: () => void) {
  onUnauthenticated = handler
}

/**
 * 非 JSON 的错误响应 → 说人话。
 *
 * 最可能发生的部署失误是 **nginx 少配一个路径前缀**：请求落到 SPA 的静态兜底，
 * 于是 POST 得到 405、GET 得到一份 index.html。原样显示上游的 `Not Allowed`
 * 指不到任何地方——2026-09-02 就是这么让人以为自己记错了口令。
 */
function proxyHint(path: string, status: number): string {
  if (status === 405 || status === 404) {
    return `${path} 没有被代理到后端（HTTP ${status}）——`
      + 'nginx 的 API 路径正则里少了这个前缀，请求落到了前端的静态兜底。'
  }
  if (status >= 500) return `后端没有响应（HTTP ${status}）`
  return `请求失败（HTTP ${status}）`
}

async function readDetail(response: Response, path: string): Promise<string> {
  if (response.headers.get('content-type')?.includes('application/json')) {
    try {
      const body = await response.json() as { detail?: string }
      if (body.detail) return body.detail
    } catch { /* 落到下面的推断 */ }
    return response.statusText || `请求失败（HTTP ${response.status}）`
  }
  // 后端所有错误都回 JSON。回的是 HTML，说明这一发根本没到后端。
  return proxyHint(path, response.status)
}

export async function apiJson<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs = 30_000, ...rest } = init ?? {}
  const headers = new Headers(rest.headers)
  if (rest.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  const controller = new AbortController()
  const forward = () => controller.abort(rest.signal?.reason)
  if (rest.signal?.aborted) forward()
  else rest.signal?.addEventListener('abort', forward, { once: true })
  const timer = window.setTimeout(
    () => controller.abort(new DOMException('请求超时', 'TimeoutError')), timeoutMs)

  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      ...rest, headers, credentials: 'include', signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted && !rest.signal?.aborted) {
      throw new ApiError(408, '请求超时，请稍后重试')
    }
    throw error
  } finally {
    window.clearTimeout(timer)
    rest.signal?.removeEventListener('abort', forward)
  }

  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) onUnauthenticated?.()
    throw new ApiError(response.status, await readDetail(response, path))
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('json')) {
    // nginx 少配前缀时最典型的症状。直说，别让人去猜 JSON 解析错误从哪来。
    throw new ApiError(502, 'API 返回的不是 JSON（多半是 nginx 没把这个路径代理到后端）')
  }
  return await response.json() as T
}
