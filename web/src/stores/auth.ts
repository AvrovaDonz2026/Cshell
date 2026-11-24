import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { apiRequest, configureApiClient, refreshTokens } from '@/api/client'
import type { AuthPayload, User } from '@/api/types'
import { clearSessionStorage, readSession, writeSession } from '@/lib/storage'

export interface RegisterInput {
  email: string
  password: string
  verify_code?: string
  turnstile_token?: string
  invitation_code?: string
  promo_code?: string
}

export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(null)
  const refreshToken = ref<string | null>(null)
  const user = ref<User | null>(null)
  const expiresAt = ref<number | null>(null)
  const hydrated = ref(false)

  const isAuthenticated = computed(() => Boolean(accessToken.value && user.value))
  const isAdmin = computed(() => user.value?.role === 'admin')

  function applyPayload(payload: AuthPayload): void {
    accessToken.value = payload.access_token
    refreshToken.value = payload.refresh_token
    user.value = payload.user
    expiresAt.value = Date.now() + (payload.expires_in || 86_400) * 1000
    writeSession({
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      user: payload.user,
      expiresIn: payload.expires_in,
    })
  }

  function clearLocal(): void {
    accessToken.value = null
    refreshToken.value = null
    user.value = null
    expiresAt.value = null
    clearSessionStorage()
  }

  function hydrate(): void {
    const session = readSession()
    accessToken.value = session.accessToken
    refreshToken.value = session.refreshToken
    user.value = session.user
    expiresAt.value = session.expiresAt
    hydrated.value = true
  }

  async function login(email: string, password: string, turnstileToken?: string): Promise<void> {
    const payload = await apiRequest<AuthPayload>('/auth/login', {
      method: 'POST',
      body: { email, password, turnstile_token: turnstileToken },
      auth: false,
      skipRefresh: true,
    })
    applyPayload(payload)
  }

  async function register(input: RegisterInput): Promise<void> {
    const payload = await apiRequest<AuthPayload>('/auth/register', {
      method: 'POST',
      body: input,
      auth: false,
      skipRefresh: true,
    })
    applyPayload(payload)
  }

  async function sendVerifyCode(email: string, turnstileToken?: string): Promise<{ message: string; countdown: number }> {
    return apiRequest('/auth/send-verify-code', {
      method: 'POST',
      body: { email, turnstile_token: turnstileToken },
      auth: false,
      skipRefresh: true,
    })
  }

  async function logout(): Promise<void> {
    const currentRefresh = refreshToken.value
    try {
      if (currentRefresh) {
        await apiRequest('/auth/logout', {
          method: 'POST',
          body: { refresh_token: currentRefresh },
          skipRefresh: true,
        })
      }
    } catch {
      // Always clear local session even if upstream logout fails.
    } finally {
      clearLocal()
    }
  }

  async function refresh(): Promise<string | null> {
    const token = refreshToken.value || readSession().refreshToken
    if (!token) {
      clearLocal()
      return null
    }
    try {
      const payload = await refreshTokens(token)
      applyPayload(payload)
      return payload.access_token
    } catch {
      clearLocal()
      return null
    }
  }

  configureApiClient({
    getAccessToken: () => accessToken.value || readSession().accessToken,
    refreshSession: () => refresh(),
    clearSession: () => clearLocal(),
  })

  return {
    accessToken,
    refreshToken,
    user,
    expiresAt,
    hydrated,
    isAuthenticated,
    isAdmin,
    hydrate,
    login,
    register,
    sendVerifyCode,
    logout,
    refresh,
    clearLocal,
    applyPayload,
  }
})
