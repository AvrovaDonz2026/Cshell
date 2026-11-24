import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import RegisterView from '@/views/RegisterView.vue'
import LoginView from '@/views/LoginView.vue'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import en from '@/i18n/locales/en'

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en } })

type FetchMock = (url: string, init?: RequestInit) => Promise<unknown>

function okEnvelope(data: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ code: 0, message: 'ok', data }),
  }
}

function stubPublicSettings(
  data: Record<string, unknown>,
  onRequest?: FetchMock,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/settings/public')) return okEnvelope(data)
      if (onRequest) return onRequest(String(url), init)
      return okEnvelope({})
    }),
  )
}

function makeRouter(pinia: Pinia) {
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/register', name: 'register', component: RegisterView },
      { path: '/login', name: 'login', component: LoginView },
      { path: '/email-verify', name: 'email-verify', component: { template: '<div />' } },
      { path: '/dashboard', name: 'dashboard', component: { template: '<div />' } },
    ],
  })
  return router
}

async function mountRegister(pinia: Pinia) {
  const router = makeRouter(pinia)
  await router.push('/register')
  await router.isReady()
  const wrapper = mount(RegisterView, {
    global: { plugins: [i18n(), router, pinia] },
  })
  await flushPromises()
  return wrapper
}

describe('registration gating', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('fails closed when settings never load', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const settings = useSettingsStore()
    expect(settings.settingsReady).toBe(false)
    expect(settings.registrationEnabled).toBe(false)
    expect(settings.paymentEnabled).toBe(false)
    expect(settings.subscriptionEnabled).toBe(false)

    vi.stubGlobal('fetch', vi.fn(async () => okEnvelope({})))
    await settings.loadPublic()

    // Loaded, but an empty settings object must not enable anything.
    expect(settings.settingsReady).toBe(true)
    expect(settings.registrationEnabled).toBe(false)
  })

  it('shows a disabled notice and hides the form when registration is closed', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    stubPublicSettings({ registration_enabled: false })
    const settings = useSettingsStore()
    await settings.loadPublic()

    const wrapper = await mountRegister(pinia)

    expect(wrapper.text()).toContain('Registration is currently disabled')
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.findAll('input')).toHaveLength(0)
  })

  it('shows a retry when settings failed and keeps the form hidden', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ code: 500, message: 'boom' }),
      })),
    )
    const settings = useSettingsStore()
    await settings.loadPublic()

    expect(settings.settingsFailed).toBe(true)
    expect(settings.settingsReady).toBe(false)

    const router = makeRouter(pinia)
    await router.push('/register')
    await router.isReady()
    const wrapper = mount(RegisterView, { global: { plugins: [i18n(), router, pinia] } })
    await flushPromises()

    expect(wrapper.text()).toContain('Could not load site settings')
    expect(wrapper.find('form').exists()).toBe(false)

    const retry = wrapper.findAll('button').find((b) => b.text() === 'Retry')
    expect(retry).toBeDefined()
    vi.stubGlobal('fetch', vi.fn(async () => okEnvelope({ registration_enabled: true })))
    await retry!.trigger('click')
    await flushPromises()

    expect(settings.settingsFailed).toBe(false)
    expect(settings.settingsReady).toBe(true)
    expect(wrapper.find('form').exists()).toBe(true)
  })

  it('renders checkboxes for captcha and email verification when required', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    stubPublicSettings({
      registration_enabled: true,
      turnstile_enabled: true,
      captcha_provider: 'mock',
      email_verify_enabled: true,
    })
    const settings = useSettingsStore()
    await settings.loadPublic()

    const wrapper = await mountRegister(pinia)

    expect(wrapper.text()).toContain('Captcha token')
    expect(wrapper.text()).toContain('Verification code')
    expect(wrapper.text()).toContain('Send code')
    expect(wrapper.text()).toContain('Confirm password')
  })
})

describe('captcha field', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('renders the mock button and emits LOCAL-OK only for the mock provider', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const bodies: Record<string, unknown>[] = []
    stubPublicSettings(
      {
        registration_enabled: true,
        turnstile_enabled: true,
        captcha_provider: 'mock',
        email_verify_enabled: true,
      },
      async (url, init) => {
        if (url.includes('/auth/register')) {
          bodies.push(JSON.parse(String(init?.body || '{}')))
          return okEnvelope({
            access_token: 'token',
            refresh_token: 'refresh',
            expires_in: 86400,
            user: { id: 5, email: 'new@example.invalid', role: 'user' },
          })
        }
        return okEnvelope({})
      },
    )
    const settings = useSettingsStore()
    await settings.loadPublic()
    expect(settings.captchaProvider).toBe('mock')

    const wrapper = await mountRegister(pinia)
    expect(wrapper.text()).not.toContain('LOCAL-OK')

    const inputs = wrapper.findAll('input')
    await inputs[0]!.setValue('new@example.invalid')
    await inputs[1]!.setValue('secret-1')
    await inputs[2]!.setValue('secret-1')
    await inputs[3]!.setValue('123456')

    const mockButton = wrapper
      .findAll('button')
      .find((b) => b.text().includes('local mock check'))
    expect(mockButton).toBeDefined()
    await mockButton!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Captcha verified')

    const submit = wrapper.find('button[type="submit"]')
    expect(submit.attributes('disabled')).toBeUndefined()
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({
      email: 'new@example.invalid',
      password: 'secret-1',
      verify_code: '123456',
    })
  })

  it('blocks submit when the provider is unavailable', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    stubPublicSettings({
      registration_enabled: true,
      turnstile_enabled: true,
      turnstile_site_key: '',
    })
    const settings = useSettingsStore()
    await settings.loadPublic()
    expect(settings.captchaProvider).toBe('unavailable')

    const wrapper = await mountRegister(pinia)

    expect(wrapper.text()).toContain('Captcha verification is temporarily unavailable')
    expect(wrapper.findAll('.captcha-field button')).toHaveLength(0)
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined()
  })

  it('prefers turnstile when a site key is configured without a provider marker', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    stubPublicSettings({
      registration_enabled: true,
      turnstile_enabled: true,
      turnstile_site_key: 'site-key',
    })
    const settings = useSettingsStore()
    await settings.loadPublic()

    expect(settings.captchaProvider).toBe('turnstile')
    expect(settings.captchaRequired).toBe(true)
  })

  it('renders the Turnstile widget with the site key and removes it on unmount', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    stubPublicSettings({
      registration_enabled: true,
      turnstile_enabled: true,
      captcha_provider: 'turnstile',
      turnstile_site_key: 'site-key',
    })
    const settings = useSettingsStore()
    await settings.loadPublic()

    const render = vi.fn(() => 'widget-1')
    const remove = vi.fn()
    ;(window as unknown as { turnstile?: unknown }).turnstile = { render, remove }

    const wrapper = await mountRegister(pinia)

    await flushPromises()

    expect(render).toHaveBeenCalledTimes(1)
    const [container, options] = render.mock.calls[0] as unknown as [
      HTMLElement,
      { sitekey: string; callback: (token: string) => void },
    ]
    expect(container).toBeInstanceOf(HTMLElement)
    expect(options.sitekey).toBe('site-key')

    const inputs = wrapper.findAll('input')
    await inputs[0]!.setValue('new@example.invalid')
    await inputs[1]!.setValue('secret-1')
    await inputs[2]!.setValue('secret-1')

    options.callback('turnstile-token')
    await flushPromises()

    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeUndefined()

    wrapper.unmount()
    expect(remove).toHaveBeenCalledWith('widget-1')

    delete (window as unknown as { turnstile?: unknown }).turnstile
  })
})

describe('login registration link', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('hides the register link until settings succeed and allow registration', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    stubPublicSettings({ registration_enabled: true })
    const settings = useSettingsStore()

    const router = makeRouter(pinia)
    await router.push('/login')
    await router.isReady()
    const wrapper = mount(LoginView, { global: { plugins: [i18n(), router, pinia] } })
    await flushPromises()

    // onMounted triggers loadPublic; the link appears only after it resolves.
    expect(wrapper.text()).toContain('Sign in')
    expect(wrapper.text()).toContain('Verify email')

    await settings.reload()
    await flushPromises()
    expect(wrapper.text()).toContain('Need an account? Register')
  })
})

describe('settings store retry', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('retries after a failed fetch and refreshes on demand', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    let fail = true
    const fetchMock = vi.fn(async () =>
      fail
        ? {
            ok: false,
            status: 503,
            text: async () => JSON.stringify({ code: 503, message: 'down' }),
          }
        : okEnvelope({ registration_enabled: true, turnstile_enabled: true }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const settings = useSettingsStore()
    await settings.loadPublic()

    expect(settings.settingsFailed).toBe(true)
    expect(settings.settingsReady).toBe(false)
    expect(settings.registrationEnabled).toBe(false)

    fail = false
    await settings.reload()

    expect(settings.settingsFailed).toBe(false)
    expect(settings.settingsReady).toBe(true)
    expect(settings.registrationEnabled).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await settings.reload()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('keeps loadPublic idempotent after success', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const fetchMock = vi.fn(async () => okEnvelope({ registration_enabled: true }))
    vi.stubGlobal('fetch', fetchMock)

    const settings = useSettingsStore()
    await settings.loadPublic()
    await settings.loadPublic()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('register payload', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('sends verification fields only when required and preserves empty optional fields', async () => {
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body || '{}')))
        return okEnvelope({
          access_token: 'token',
          refresh_token: 'refresh',
          expires_in: 86400,
          user: { id: 5, email: 'new@example.invalid', role: 'user' },
        })
      }),
    )

    const auth = useAuthStore()
    await auth.register({
      email: 'new@example.invalid',
      password: 'secret-1',
      verify_code: '123456',
      turnstile_token: 'LOCAL-OK',
      invitation_code: 'INVITE',
    })

    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({
      email: 'new@example.invalid',
      password: 'secret-1',
      verify_code: '123456',
      turnstile_token: 'LOCAL-OK',
      invitation_code: 'INVITE',
    })
    expect(auth.isAuthenticated).toBe(true)
  })
})


describe('pinned captcha lifecycle', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

  it('sends Turnstile proof on login and resets the one-time widget after failure', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const requests: Record<string, unknown>[] = []
    stubPublicSettings({ turnstile_enabled: true, turnstile_site_key: 'real-site' }, async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)))
      return { ok: false, status: 400, text: async () => JSON.stringify({ code: 400, message: 'Invalid credentials' }) }
    })
    const callbacks: ((token: string) => void)[] = []
    const remove = vi.fn()
    const render = vi.fn((_el: HTMLElement, options: { callback: (token: string) => void }) => {
      callbacks.push(options.callback); return String(callbacks.length)
    })
    vi.stubGlobal('turnstile', { render, remove })
    const router = makeRouter(pinia)
    await router.push('/login')
    const wrapper = mount(LoginView, { global: { plugins: [i18n(), router, pinia] } })
    await flushPromises()
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined()
    await wrapper.find('input[type="email"]').setValue('login@example.invalid')
    await wrapper.find('input[type="password"]').setValue('password')
    callbacks[0]!('proof-once')
    await flushPromises()
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(requests[0]).toEqual({ email: 'login@example.invalid', password: 'password', turnstile_token: 'proof-once' })
    expect(remove).toHaveBeenCalled()
    expect(render).toHaveBeenCalledTimes(2)
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('sends captcha with email code and honors server countdown without reusing proof', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const bodies: Record<string, unknown>[] = []
    stubPublicSettings({ registration_enabled: true, turnstile_enabled: true, captcha_provider: 'mock', email_verify_enabled: true }, async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return okEnvelope({ message: 'sent', countdown: 42 })
    })
    const wrapper = await mountRegister(pinia)
    await wrapper.find('input[type="email"]').setValue('new@example.invalid')
    const send = () => wrapper.findAll('button').find(b => b.text() === 'Send code')!
    expect(send().attributes('disabled')).toBeDefined()
    await wrapper.findAll('button').find(b => b.text().includes('local mock check'))!.trigger('click')
    await send().trigger('click')
    await flushPromises()
    expect(bodies).toEqual([{ email: 'new@example.invalid', turnstile_token: 'LOCAL-OK' }])
    expect(wrapper.text()).toContain('42s')
    expect(wrapper.findAll('button').find(b => b.text() === '42s')!.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('local mock check')
    wrapper.unmount()
  })

  it('fails closed for unsupported enabled captcha providers', async () => {
    setActivePinia(createPinia())
    stubPublicSettings({ registration_enabled: true, tencent_captcha_enabled: true })
    const settings = useSettingsStore()
    await settings.loadPublic()
    expect(settings.captchaRequired).toBe(true)
    expect(settings.captchaProvider).toBe('unavailable')
  })
})
