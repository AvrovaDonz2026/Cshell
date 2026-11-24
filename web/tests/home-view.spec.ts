import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import HomeView from '@/views/HomeView.vue'
import en from '@/i18n/locales/en'
import { useSettingsStore } from '@/stores/settings'

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en } })

function okEnvelope(data: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ code: 0, message: 'ok', data }),
  }
}

function stubSettings(data: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/settings/public')) return okEnvelope(data)
      return okEnvelope({})
    }),
  )
}

function makeRouter(pinia: Pinia) {
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: HomeView },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/register', name: 'register', component: { template: '<div />' } },
      { path: '/dashboard', name: 'dashboard', component: { template: '<div />' } },
      { path: '/profile', name: 'profile', component: { template: '<div />' } },
    ],
  })
  return router
}

async function mountHome(pinia: Pinia) {
  const router = makeRouter(pinia)
  await router.push('/')
  await router.isReady()
  const wrapper = mount(HomeView, {
    global: { plugins: [i18n(), router, pinia] },
  })
  await flushPromises()
  return wrapper
}

describe('HomeView', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('mounts with a single h1, hero and semantic landmarks', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    stubSettings({ registration_enabled: true })

    const wrapper = await mountHome(pinia)

    const h1s = wrapper.findAll('h1')
    expect(h1s).toHaveLength(1)
    expect(h1s[0]!.text()).toBe('One workspace for your API gateway')
    expect(wrapper.find('header').exists()).toBe(true)
    expect(wrapper.find('main').exists()).toBe(true)
    expect(wrapper.find('footer').exists()).toBe(true)
    expect(wrapper.text()).toContain('What you get')
    expect(wrapper.text()).toContain('How it works')
    expect(wrapper.text()).toContain('Administrator entry')
    expect(wrapper.find('a[href="/admin"]').exists()).toBe(true)
  })

  it('shows the public feature summary without a local-data badge', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    stubSettings({ registration_enabled: true })

    const wrapper = await mountHome(pinia)

    expect(wrapper.text()).toContain('Inside the workspace')
    expect(wrapper.findAll('.grid-3 .card').length).toBeGreaterThan(0)
    expect(wrapper.text()).not.toMatch(/local data|mock backend/i)
    for (const label of ['Usage heatmap', 'API keys', 'Billing', 'Profile']) {
      expect(wrapper.text()).toContain(label)
    }
    // No invented social proof or pricing on the public page.
    expect(wrapper.text()).not.toMatch(/testimonial|customers|pricing|per month/i)
  })

  it('withholds the create-account link until settings are loaded', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    // Hold the settings request open so the gated state is observable.
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/settings/public')) {
          await gate
          return okEnvelope({ registration_enabled: true })
        }
        return okEnvelope({})
      }),
    )

    const wrapper = await mountHome(pinia)
    const settings = useSettingsStore()

    expect(settings.settingsReady).toBe(false)
    expect(wrapper.findAll('a[href="/register"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('Loading site settings')
    expect(wrapper.findAll('[aria-disabled="true"]').length).toBeGreaterThan(0)

    release?.()
    await flushPromises()

    expect(settings.settingsReady).toBe(true)
    expect(wrapper.findAll('a[href="/register"]').length).toBeGreaterThan(0)
    expect(wrapper.findAll('[aria-disabled="true"]')).toHaveLength(0)
  })

  it('gates the create links on registrationEnabled', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    stubSettings({ registration_enabled: false })
    const settings = useSettingsStore()
    await settings.loadPublic()

    const wrapper = await mountHome(pinia)

    expect(settings.settingsReady).toBe(true)
    expect(settings.registrationEnabled).toBe(false)
    expect(wrapper.findAll('a[href="/register"]')).toHaveLength(0)
    const hints = wrapper.findAll('[aria-disabled="true"]')
    expect(hints.length).toBeGreaterThan(0)
    expect(hints[0]!.attributes('title')).toContain('Registration is currently closed')
    expect(wrapper.text()).toContain('Create account')
  })


})
