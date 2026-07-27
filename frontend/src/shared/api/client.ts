import { API_BASE_URL } from '../config/env'

type ApiErrorPayload = {
  detail?: string
}

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
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers)

  if (init?.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(resolveApiUrl(path), { ...init, headers })

  if (!response.ok) {
    throw new ApiError(response.status, await readError(response))
  }

  return response
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init)
  return (await response.json()) as T
}
