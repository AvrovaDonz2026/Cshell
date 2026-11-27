import type { User } from '@/api/types'

const KEYS = {
  token: 'auth_token',
  refresh: 'refresh_token',
  user: 'auth_user',
  expires: 'token_expires_at',
} as const

export interface StoredSession {
  accessToken: string | null
  refreshToken: string | null
  user: User | null
  expiresAt: number | null
}

export function readSession(): StoredSession {
  if (typeof localStorage === 'undefined') {
    return { accessToken: null, refreshToken: null, user: null, expiresAt: null }
  }

  let user: User | null = null
  const rawUser = localStorage.getItem(KEYS.user)
  if (rawUser) {
    try {
      user = JSON.parse(rawUser) as User
    } catch {
      user = null
    }
  }

  const expiresRaw = localStorage.getItem(KEYS.expires)
  const expiresAt = expiresRaw ? Number(expiresRaw) : null

  return {
    accessToken: localStorage.getItem(KEYS.token),
    refreshToken: localStorage.getItem(KEYS.refresh),
    user,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
  }
}

export function writeSession(input: {
  accessToken: string
  refreshToken: string
  user: User
  expiresIn?: number
}): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(KEYS.token, input.accessToken)
  localStorage.setItem(KEYS.refresh, input.refreshToken)
  localStorage.setItem(KEYS.user, JSON.stringify(input.user))
  const expiresAt =
    Date.now() + (input.expiresIn && input.expiresIn > 0 ? input.expiresIn * 1000 : 86_400_000)
  localStorage.setItem(KEYS.expires, String(expiresAt))
}

export function clearSessionStorage(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(KEYS.token)
  localStorage.removeItem(KEYS.refresh)
  localStorage.removeItem(KEYS.user)
  localStorage.removeItem(KEYS.expires)
}
