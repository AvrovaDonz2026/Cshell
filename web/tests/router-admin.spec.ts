import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import * as adminRedirect from '@/lib/adminRedirect'
import { createAppRouter } from '@/router'
import { useAuthStore } from '@/stores/auth'

describe('router admin redirect', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('assigns /admin when hydrated user role is admin', async () => {
    const redirect = vi
      .spyOn(adminRedirect, 'redirectAdminToUpstream')
      .mockImplementation(() => undefined)

    localStorage.setItem('auth_token', 'admin-token')
    localStorage.setItem('refresh_token', 'refresh-mock')
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: 1, email: 'admin@example.invalid', role: 'admin' }),
    )

    const auth = useAuthStore()
    auth.hydrate()

    const router = createAppRouter()
    await router.push('/dashboard').catch(() => undefined)

    expect(redirect).toHaveBeenCalledTimes(1)
  })

  it('allows authenticated non-admin users into the workspace', async () => {
    const redirect = vi
      .spyOn(adminRedirect, 'redirectAdminToUpstream')
      .mockImplementation(() => undefined)

    localStorage.setItem('auth_token', 'user-token')
    localStorage.setItem('refresh_token', 'refresh-mock')
    localStorage.setItem(
      'auth_user',
      JSON.stringify({ id: 2, email: 'user@example.invalid', role: 'user' }),
    )

    const auth = useAuthStore()
    auth.hydrate()

    const router = createAppRouter()
    await router.push('/dashboard')
    await router.isReady()

    expect(redirect).not.toHaveBeenCalled()
    expect(router.currentRoute.value.name).toBe('dashboard')
  })
})
