import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import DashboardView from '@/views/DashboardView.vue'
import en from '@/i18n/locales/en'

const statsPayload = {
  code: 0,
  message: 'ok',
  data: {
    total_api_keys: 3,
    active_api_keys: 2,
    total_requests: 420,
    total_tokens: 240000,
    total_cost: 12.5,
    today_requests: 42,
    today_tokens: 24000,
    today_cost: 1.25,
    rpm: 2,
    tpm: 500,
  },
}

describe('DashboardView smoke', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(statsPayload),
      })),
    )
  })

  it('mounts and renders stats from GET /usage/dashboard/stats', async () => {
    const i18n = createI18n({
      legacy: false,
      locale: 'en',
      messages: { en },
    })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'dashboard', component: DashboardView },
        { path: '/usage', name: 'usage', component: { template: '<div />' } },
        { path: '/keys', name: 'keys', component: { template: '<div />' } },
        {
          path: '/purchase',
          name: 'purchase',
          component: { template: '<div />' },
        },
      ],
    })
    await router.push('/')
    await router.isReady()

    const wrapper = mount(DashboardView, {
      global: {
        plugins: [i18n, router, createPinia()],
      },
    })

    await flushPromises()

    expect(fetch).toHaveBeenCalled()
    const calledUrl = String(vi.mocked(fetch).mock.calls[0]?.[0] ?? '')
    expect(calledUrl).toContain('/usage/dashboard/stats')
    expect(wrapper.text()).toContain('42')
    expect(wrapper.text()).toContain('Active keys')
    expect(wrapper.text()).toContain('View usage')
  })
})
