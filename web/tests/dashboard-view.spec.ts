import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import DashboardView from '@/views/DashboardView.vue'
import en from '@/i18n/locales/en'
import { useAuthStore } from '@/stores/auth'

const statsData = {
  total_api_keys: 3,
  active_api_keys: 2,
  total_requests: 420,
  total_tokens: 240000,
  total_cost: 12.5,
  total_actual_cost: 10.5,
  today_requests: 42,
  today_tokens: 24000,
  today_cost: 1.25,
  today_actual_cost: 1.05,
  average_duration_ms: 720,
  rpm: 2,
  tpm: 500,
}

function okEnvelope(data: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ code: 0, message: 'ok', data }),
  }
}

function seedUser(pinia: Pinia) {
  localStorage.setItem('auth_token', 'dash-token')
  localStorage.setItem('refresh_token', 'dash-refresh')
  localStorage.setItem(
    'auth_user',
    JSON.stringify({
      id: 3,
      email: 'donz@example.invalid',
      username: 'Donz',
      role: 'user',
      balance: 64.25,
    }),
  )
  const auth = useAuthStore(pinia)
  auth.hydrate()
}

interface StubRoute {
  match: (url: string) => boolean
  data: unknown
}

/**
 * Stub the global fetch by URL. Every dashboard request is served from an
 * explicit, deterministic route; anything else gets an empty envelope.
 */
function stubFetch(routes: StubRoute[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    for (const route of routes) {
      if (route.match(url)) return okEnvelope(route.data)
    }
    return okEnvelope({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function buildRoutes() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'dashboard', component: DashboardView },
      { path: '/home', name: 'home', component: { template: '<div />' } },
      { path: '/usage', name: 'usage', component: { template: '<div />' } },
      { path: '/keys', name: 'keys', component: { template: '<div />' } },
      { path: '/profile', name: 'profile', component: { template: '<div />' } },
      {
        path: '/subscriptions',
        name: 'subscriptions',
        component: { template: '<div />' },
      },
      {
        path: '/purchase',
        name: 'purchase',
        component: { template: '<div />' },
      },
      { path: '/orders', name: 'orders', component: { template: '<div />' } },
    ],
  })
  return router
}

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en } })

async function mountDashboard(pinia: Pinia) {
  setActivePinia(pinia)
  seedUser(pinia)
  const router = buildRoutes()
  await router.push('/')
  await router.isReady()
  const wrapper = mount(DashboardView, {
    global: { plugins: [i18n(), router, pinia] },
  })
  await flushPromises()
  return wrapper
}

describe('DashboardView title row', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('renders h1 title, welcome text and refresh button on one row', async () => {
    stubFetch([
      { match: (u) => u.includes('/usage/dashboard/stats'), data: statsData },
    ])
    const pinia = createPinia()

    const wrapper = await mountDashboard(pinia)

    const head = wrapper.find('.page__head')
    expect(head.exists()).toBe(true)
    expect(head.find('h1').text()).toBe('Dashboard')
    expect(head.text()).toContain('Welcome back, Donz')
    const refresh = head.find('button.page__refresh')
    expect(refresh.exists()).toBe(true)
    expect(refresh.text()).toBe('Refresh')
    // Subtitle stays visible beneath the h1.
    expect(wrapper.text()).toContain(
      'Today’s traffic, cumulative totals and account shortcuts.',
    )
  })

  it('refresh button refetches dashboard stats', async () => {
    const fetchMock = stubFetch([
      { match: (u) => u.includes('/usage/dashboard/stats'), data: statsData },
    ])
    const pinia = createPinia()

    const wrapper = await mountDashboard(pinia)
    const statsCallsBefore = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes('/usage/dashboard/stats'),
    ).length

    await wrapper.find('button.page__refresh').trigger('click')
    await flushPromises()

    const statsCallsAfter = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes('/usage/dashboard/stats'),
    ).length
    expect(statsCallsAfter).toBeGreaterThan(statsCallsBefore)
  })
})

describe('DashboardView pending card', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('maps pending orders and expiring keys onto real counts', async () => {
    stubFetch([
      { match: (u) => u.includes('/usage/dashboard/stats'), data: statsData },
      {
        match: (u) => u.includes('/payment/orders/my'),
        data: {
          items: [
            {
              id: 7,
              amount: 20,
              status: 'PENDING',
            },
          ],
          total: 2,
          page: 1,
          page_size: 20,
          pages: 1,
        },
      },
      {
        match: (u) => u.includes('/keys?'),
        data: {
          items: [
            {
              id: 1,
              name: 'soon',
              status: 'active',
              expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
            },
            {
              id: 2,
              name: 'later',
              status: 'active',
              expires_at: new Date(Date.now() + 60 * 86_400_000).toISOString(),
            },
          ],
          total: 2,
          page: 1,
          page_size: 100,
          pages: 1,
        },
      },
    ])
    const pinia = createPinia()

    const wrapper = await mountDashboard(pinia)

    const pending = wrapper.find('[aria-labelledby="dash-pending-title"]')
    expect(pending.exists()).toBe(true)
    expect(pending.text()).toContain('Orders awaiting payment')
    expect(pending.text()).toContain('Keys expiring within 7 days')
    // Orders count comes from total=2 even though only one item is returned.
    // Keys count is client-side filtered to the one expiring within 7 days.
    const values = pending.findAll('.pending-list__value')
    expect(values.map((v) => v.text())).toEqual(['2', '1'])
    const hrefs = values.map((v) => v.attributes('href'))
    expect(hrefs[0]).toBe('/orders')
    expect(hrefs[1]).toBe('/keys')
    // Nothing pending when both filters land on zero is covered below; this
    // dataset is non-empty, so the empty copy must be absent.
    expect(pending.text()).not.toContain('Nothing pending')
  })

  it('shows the empty copy when no orders are pending and no keys expire', async () => {
    stubFetch([
      { match: (u) => u.includes('/usage/dashboard/stats'), data: statsData },
      {
        match: (u) => u.includes('/payment/orders/my'),
        data: { items: [], total: 0, page: 1, page_size: 20, pages: 1 },
      },
      {
        match: (u) => u.includes('/keys?'),
        data: {
          items: [
            {
              id: 1,
              name: 'later',
              status: 'active',
              expires_at: new Date(Date.now() + 60 * 86_400_000).toISOString(),
            },
          ],
          total: 1,
          page: 1,
          page_size: 100,
          pages: 1,
        },
      },
    ])
    const pinia = createPinia()

    const wrapper = await mountDashboard(pinia)

    const pending = wrapper.find('[aria-labelledby="dash-pending-title"]')
    expect(pending.text()).toContain('Nothing pending')
  })

  it('falls back to unknown (—) when the pending requests fail', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/usage/dashboard/stats')) return okEnvelope(statsData)
      if (url.includes('/payment/orders/my') || url.includes('/keys?')) {
        return {
          ok: false,
          status: 500,
          text: async () => JSON.stringify({ code: 500, message: 'boom' }),
        }
      }
      return okEnvelope({})
    })
    vi.stubGlobal('fetch', fetchMock)
    const pinia = createPinia()

    const wrapper = await mountDashboard(pinia)

    const pending = wrapper.find('[aria-labelledby="dash-pending-title"]')
    const values = pending.findAll('.pending-list__value')
    expect(values.map((v) => v.text())).toEqual(['—', '—'])
    expect(pending.text()).not.toContain('Nothing pending')
  })
})

describe('DashboardView balance card', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('shows the big balance value and gates the recharge link on paymentEnabled', async () => {
    stubFetch([
      { match: (u) => u.includes('/usage/dashboard/stats'), data: statsData },
      {
        match: (u) => u.includes('/settings/public'),
        data: {
          payment_enabled: true,
          subscription_enabled: false,
          billing_currency: 'USD',
        },
      },
    ])
    const pinia = createPinia()
    const { useSettingsStore } = await import('@/stores/settings')
    const settings = useSettingsStore(pinia)
    await settings.loadPublic()

    const wrapper = await mountDashboard(pinia)

    const balance = wrapper.find('.rail-card__value--big')
    expect(balance.text()).toBe('64.25 USD')
    const links = wrapper.findAll('.rail-card__link')
    const texts = links.map((l) => l.text())
    expect(texts).toContain('Balance details')
    expect(texts).toContain('Recharge')
  })

  it('hides the recharge link when payments are disabled', async () => {
    stubFetch([
      { match: (u) => u.includes('/usage/dashboard/stats'), data: statsData },
      {
        match: (u) => u.includes('/settings/public'),
        data: { payment_enabled: false, subscription_enabled: false },
      },
    ])
    const pinia = createPinia()
    const { useSettingsStore } = await import('@/stores/settings')
    const settings = useSettingsStore(pinia)
    await settings.loadPublic()

    const wrapper = await mountDashboard(pinia)

    const texts = wrapper.findAll('.rail-card__link').map((l) => l.text())
    expect(texts).toContain('Balance details')
    expect(texts).not.toContain('Recharge')
  })
})

describe('DashboardView smoke', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    stubFetch([
      { match: (u) => u.includes('/usage/dashboard/stats'), data: statsData },
      {
        match: (u) => u.includes('/payment/orders/my'),
        data: { items: [], total: 0, page: 1, page_size: 20, pages: 1 },
      },
      {
        match: (u) => u.includes('/keys?'),
        data: { items: [], total: 0, page: 1, page_size: 100, pages: 1 },
      },
    ])
  })

  it('mounts and renders stats from GET /usage/dashboard/stats', async () => {
    const pinia = createPinia()
    const wrapper = await mountDashboard(pinia)

    expect(fetch).toHaveBeenCalled()
    const calledUrl = String(vi.mocked(fetch).mock.calls[0]?.[0] ?? '')
    expect(calledUrl).toContain('/usage/dashboard/stats')
    expect(wrapper.text()).toContain('42')
    expect(wrapper.text()).toContain('Active keys')
    expect(wrapper.text()).toContain('Today actual cost')
    expect(wrapper.text()).toContain('1.05')
    expect(wrapper.text()).toContain('Total actual cost')
    expect(wrapper.text()).toContain('10.5')
    expect(wrapper.text()).toContain('Avg duration (ms)')
    expect(wrapper.text()).toContain('720')
  })
})
