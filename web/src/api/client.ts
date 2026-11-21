import type { ApiEnvelope, AuthPayload } from './types'
import { ApiError } from './types'

const API_PREFIX = '/api/v1'

export type TokenReader = () => string | null
export type RefreshHandler = () => Promise<string | null>
export type SessionClearer = () => void

let getAccessToken: TokenReader = () =>
  typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null

let refreshSession: RefreshHandler = async () => null
let clearSession: SessionClearer = () => undefined

let refreshInFlight: Promise<string | null> | null = null

export function configureApiClient(options: {
  getAccessToken: TokenReader
  refreshSession: RefreshHandler
  clearSession: SessionClearer
}): void {
  getAccessToken = options.getAccessToken
  refreshSession = options.refreshSession
  clearSession = options.clearSession
}

export function unwrapEnvelope<T>(body: unknown): T {
  if (body == null || typeof body !== 'object') {
    throw new ApiError('Invalid API response', -1, 0)
  }
  const envelope = body as Partial<ApiEnvelope<T>>
  if (typeof envelope.code !== 'number') {
    throw new ApiError('Invalid API envelope', -1, 0)
  }
  if (envelope.code !== 0) {
    throw new ApiError(envelope.message || 'Request failed', envelope.code, 0)
  }
  return envelope.data as T
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ApiError('Invalid JSON response', -1, response.status)
  }
}

async function tryRefresh(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = refreshSession().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  auth?: boolean
  skipRefresh?: boolean
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { body, auth = true, skipRefresh = false, headers, ...init } = options
  const url = path.startsWith('http') ? path : `${API_PREFIX}${path}`

  const requestHeaders = new Headers(headers)
  if (!requestHeaders.has('Accept')) {
    requestHeaders.set('Accept', 'application/json')
  }
  if (body !== undefined && !requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json')
  }
  if (auth) {
    const token = getAccessToken()
    if (token) requestHeaders.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(url, {
    ...init,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (response.status === 401 && auth && !skipRefresh) {
    const nextToken = await tryRefresh()
    if (nextToken) {
      return apiRequest<T>(path, { ...options, skipRefresh: true })
    }
    clearSession()
    throw new ApiError('Unauthorized', 401, 401)
  }

  const payload = await parseJson(response)

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : response.statusText || 'Request failed'
    const code =
      payload && typeof payload === 'object' && 'code' in payload
        ? Number((payload as { code: unknown }).code)
        : response.status
    throw new ApiError(message, code, response.status)
  }

  return unwrapEnvelope<T>(payload)
}

export async function refreshTokens(refreshToken: string): Promise<AuthPayload> {
  return apiRequest<AuthPayload>('/auth/refresh', {
    method: 'POST',
    body: { refresh_token: refreshToken },
    auth: false,
    skipRefresh: true,
  })
}
