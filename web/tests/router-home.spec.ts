import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import * as adminRedirect from '@/lib/adminRedirect'
import { createAppRouter } from '@/router'
import { useAuthStore } from '@/stores/auth'

function okEnvelope(data: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ code: 0, message: 'ok', data }),
  }
}

function stubPublicSettings() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => okEnvelope({ registration_enabled: true })),
  )
}

function seedUser(pinia: ReturnType<typeof createPinia>, role: string) {
  setActivePinia(pinia)
  localStorage.setItem('auth_token', `${role}-token`)
  localStorage.setItem('refresh_token', `${role}-refresh`)
  localStorage.setItem(
    'auth_user',
    JSON.stringify({ id: 9, email: `${role}@example.invalid`, role }),
  )
  const auth = useAuthStore(pinia)
  auth.hydrate()
  return auth
}

describe('router home', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    stubPublicSettings()
  })

  it('serves the public home page to guests at /', async () => {
    setActivePinia(createPinia())
    const redirect = vi
      .spyOn(adminRedirect, 'redirectAdminToUpstream')
      .mockImplementation(() => undefined)

    const router = createAppRouter()
    await router.push('/')
    await router.isReady()

    expect(redirect).not.toHaveBeenCalled()
    expect(router.currentRoute.value.name).toBe('home')
    expect(router.currentRoute.value.meta.public).toBe(true)

    await router.push('/home')
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('sends an authenticated non-admin user from / to the dashboard', async () => {
    const pinia = createPinia()
    seedUser(pinia, 'user')
    const redirect = vi
      .spyOn(adminRedirect, 'redirectAdminToUpstream')
      .mockImplementation(() => undefined)

    const router = createAppRouter()
    await router.push('/')
    await router.isReady()

    expect(redirect).not.toHaveBeenCalled()
    expect(router.currentRoute.value.name).toBe('dashboard')

    await router.push('/home')
    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it('redirects an admin from / to the upstream admin UI', async () => {
    const pinia = createPinia()
    seedUser(pinia, 'admin')
    const redirect = vi
      .spyOn(adminRedirect, 'redirectAdminToUpstream')
      .mockImplementation(() => undefined)

    const router = createAppRouter()
    await router.push('/').catch(() => undefined)

    expect(redirect).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.name).not.toBe('home')
  })

  it('still sends guests hitting workspace routes to login', async () => {
    setActivePinia(createPinia())
    const router = createAppRouter()
    await router.push('/dashboard')
    await router.isReady()

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/dashboard')
  })

  it('keeps workspace routes behind the authenticated shell', async () => {
    const pinia = createPinia()
    seedUser(pinia, 'user')

    const router = createAppRouter()
    await router.push('/keys')
    await router.isReady()

    expect(router.currentRoute.value.name).toBe('keys')
    expect(router.currentRoute.value.meta.requiresAuth).toBe(true)
    // The workspace views live under the shell record.
    expect(router.currentRoute.value.matched[0]?.path).toBe('/workspace')
  })
})
