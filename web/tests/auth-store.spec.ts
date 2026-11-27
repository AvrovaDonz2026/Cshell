import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'

describe('auth store session hydrate', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('hydrates tokens and user from localStorage', () => {
    const user = {
      id: 7,
      email: 'fixture@example.invalid',
      role: 'user',
    }
    localStorage.setItem('auth_token', 'access-mock')
    localStorage.setItem('refresh_token', 'refresh-mock')
    localStorage.setItem('auth_user', JSON.stringify(user))
    localStorage.setItem('token_expires_at', String(Date.now() + 60_000))

    const auth = useAuthStore()
    auth.hydrate()

    expect(auth.accessToken).toBe('access-mock')
    expect(auth.refreshToken).toBe('refresh-mock')
    expect(auth.user).toEqual(user)
    expect(auth.isAuthenticated).toBe(true)
    expect(auth.isAdmin).toBe(false)
    expect(auth.hydrated).toBe(true)
  })

  it('marks admin role from stored user', () => {
    localStorage.setItem('auth_token', 'admin-token')
    localStorage.setItem('refresh_token', 'refresh-mock')
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: 1, email: 'admin@example.invalid', role: 'admin' }),
    )

    const auth = useAuthStore()
    auth.hydrate()

    expect(auth.isAdmin).toBe(true)
    expect(auth.isAuthenticated).toBe(true)
  })
})
