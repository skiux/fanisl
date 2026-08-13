import { API_BASE_URL } from '../config/env'

type ApiErrorPayload = {
  detail?: string
}

export type ApiRequestInit = RequestInit & {
  timeoutMs?: number
}

export type JsonValidator<T> = (value: unknown) => value is T

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function resolveApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE_URL}${normalizedPath}`
}

async function readError(response: Response): Promise<string> {
  if (response.headers.get('content-type')?.includes('application/json')) {
    try {
      const payload = (await response.json()) as ApiErrorPayload
      if (payload.detail) {
        return payload.detail
      }
    } catch {
      // Fall through to the HTTP status when a proxy returns malformed JSON.
    }
  }

  return response.statusText || `Request failed with status ${response.status}`
}

export async function apiFetch(
  path: string,
  init?: ApiRequestInit,
): Promise<Response> {
  const { timeoutMs = 20_000, ...requestInit } = init ?? {}
  const headers = new Headers(init?.headers)

  if (init?.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const controller = new AbortController()
  const forwardAbort = () => controller.abort(init?.signal?.reason)
  if (init?.signal?.aborted) forwardAbort()
  else init?.signal?.addEventListener('abort', forwardAbort, { once: true })
  const timeout = window.setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs)

  let response: Response
  try {
    response = await fetch(resolveApiUrl(path), { ...requestInit, headers, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted && !init?.signal?.aborted) {
      throw new ApiError(408, '请求超时，请稍后重试')
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
    init?.signal?.removeEventListener('abort', forwardAbort)
  }

  if (!response.ok) {
    throw new ApiError(response.status, await readError(response))
  }

  return response
}

export async function apiJson<T>(
  path: string,
  init?: ApiRequestInit,
  validate?: JsonValidator<T>,
): Promise<T> {
  const response = await apiFetch(path, init)
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('application/json') && !contentType.includes('+json')) {
    throw new ApiError(502, 'API 返回了非 JSON 响应')
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ApiError(502, 'API 返回了无法解析的 JSON')
  }
  if (validate && !validate(payload)) {
    throw new ApiError(502, 'API 返回的数据结构不符合约定')
  }
  return payload as T
}
