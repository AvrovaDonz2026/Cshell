import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import UsageView from '@/views/UsageView.vue'
import en from '@/i18n/locales/en'
import { fetchUsageLogs } from '@/api/usage'

describe('fetchUsageLogs', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 0,
            message: 'ok',
            data: {
              items: [
                {
                  id: 1,
                  model: 'claude-sonnet-4-6',
                  duration_ms: 720,
                  total_cost: 1.25,
                  actual_cost: 1.05,
                  created_at: '2026-11-20T23:59:59Z',
                },
              ],
              total: 1,
              page: 1,
              page_size: 20,
              pages: 1,
            },
          }),
      })),
    )
  })

  it('calls GET /usage with pagination and optional dates', async () => {
    const data = await fetchUsageLogs({
      page: 2,
      page_size: 10,
      start_date: '2026-11-01',
      end_date: '2026-11-21',
    })

    expect(fetch).toHaveBeenCalled()
    const calledUrl = String(vi.mocked(fetch).mock.calls[0]?.[0] ?? '')
    expect(calledUrl).toContain('/usage?')
    expect(calledUrl).toContain('page=2')
    expect(calledUrl).toContain('page_size=10')
    expect(calledUrl).toContain('start_date=2026-11-01')
    expect(calledUrl).toContain('end_date=2026-11-21')
    expect(data.items[0].model).toBe('claude-sonnet-4-6')
  })
})

describe('UsageView logs + models', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const href = String(url)
        if (href.includes('/usage/dashboard/trend')) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                code: 0,
                message: 'ok',
                data: {
                  trend: [
                    {
                      date: '2026-11-10',
                      requests: 3,
                      total_tokens: 30,
                      cost: 0.2,
                      actual_cost: 0.1,
                    },
                  ],
                  models: [
                    {
                      model: 'claude-sonnet-4-6',
                      requests: 42,
                      total_tokens: 24000,
                      cost: 1.25,
                      actual_cost: 1.05,
                    },
                  ],
                  start_date: '2026-11-01',
                  end_date: '2026-11-21',
                  granularity: 'day',
                },
              }),
          }
        }
        if (href.includes('/usage?') || /\/usage$/.test(href.split('?')[0])) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                code: 0,
                message: 'ok',
                data: {
                  items: [
                    {
                      id: 9,
                      model: 'claude-sonnet-4-6',
                      duration_ms: 720,
                      total_cost: 1.25,
                      actual_cost: 1.05,
                      created_at: '2026-11-20T23:59:59Z',
                    },
                  ],
                  total: 1,
                  page: 1,
                  page_size: 20,
                  pages: 1,
                },
              }),
          }
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ code: 0, message: 'ok', data: {} }),
        }
      }),
    )
  })

  it('renders models summary and usage logs section', async () => {
    const i18n = createI18n({
      legacy: false,
      locale: 'en',
      messages: { en },
    })

    const wrapper = mount(UsageView, {
      global: {
        plugins: [i18n, createPinia()],
      },
    })

    await flushPromises()

    expect(wrapper.text()).toContain('Models summary')
    expect(wrapper.text()).toContain('claude-sonnet-4-6')
    expect(wrapper.text()).toContain('Usage logs')
    expect(wrapper.text()).toContain('720')
  })

  function usageCalls(): string[] {
    return vi
      .mocked(fetch)
      .mock.calls.map((call) => String(call[0]))
      .filter((href) => href.includes('/usage'))
  }

  function mountUsage() {
    const i18n = createI18n({
      legacy: false,
      locale: 'en',
      messages: { en },
    })
    return mount(UsageView, {
      global: { plugins: [i18n, createPinia()] },
    })
  }

  it('uses applied dates plus timezone for both trend and logs', async () => {
    const wrapper = mountUsage()
    await flushPromises()

    const calls = usageCalls()
    const trendCall = calls.find((href) => href.includes('/usage/dashboard/trend'))
    const logsCall = calls.find((href) => href.startsWith('/api/v1/usage?'))
    expect(trendCall).toContain('timezone=')
    expect(logsCall).toContain('timezone=')
    // Both requests share the same applied dates and timezone value.
    const trendStart = /start_date=([^&]+)/.exec(trendCall ?? '')?.[1]
    const logsStart = /start_date=([^&]+)/.exec(logsCall ?? '')?.[1]
    const trendTz = /timezone=([^&]+)/.exec(trendCall ?? '')?.[1]
    const logsTz = /timezone=([^&]+)/.exec(logsCall ?? '')?.[1]
    expect(trendStart).toBeTruthy()
    expect(logsStart).toBe(trendStart)
    expect(logsTz).toBe(trendTz)
    expect(wrapper.text()).toContain('Applied: ')
  })

  it('does not re-request logs when only draft dates change', async () => {
    const wrapper = mountUsage()
    await flushPromises()

    const before = usageCalls().length
    const dateInputs = wrapper.findAll('input[type="date"]')
    expect(dateInputs).toHaveLength(2)
    await dateInputs[0].setValue('2026-11-05')
    await dateInputs[1].setValue('2026-11-08')
    await flushPromises()

    expect(usageCalls().length).toBe(before)
  })

  it('applies the draft range on Apply and reloads logs with it', async () => {
    const wrapper = mountUsage()
    await flushPromises()

    const dateInputs = wrapper.findAll('input[type="date"]')
    await dateInputs[0].setValue('2026-11-05')
    await dateInputs[1].setValue('2026-11-08')

    const applyButton = wrapper
      .findAll('button')
      .find((btn) => btn.text() === 'Apply')
    expect(applyButton).toBeTruthy()
    await applyButton!.trigger('click')
    await flushPromises()

    const calls = usageCalls()
    const lastLogs = calls.filter((href) => href.startsWith('/api/v1/usage?')).pop()
    expect(lastLogs).toContain('start_date=2026-11-05')
    expect(lastLogs).toContain('end_date=2026-11-08')
    const lastTrend = calls
      .filter((href) => href.includes('/usage/dashboard/trend'))
      .pop()
    expect(lastTrend).toContain('start_date=2026-11-05')
    expect(lastTrend).toContain('end_date=2026-11-08')
    expect(wrapper.text()).toContain('Applied: 2026-11-05 — 2026-11-08')
  })

  it('blocks Apply and reports an invalid or oversized range', async () => {
    const wrapper = mountUsage()
    await flushPromises()

    const before = usageCalls().length
    const dateInputs = wrapper.findAll('input[type="date"]')
    await dateInputs[0].setValue('2026-11-21')
    await dateInputs[1].setValue('2026-11-01')

    const applyButton = wrapper
      .findAll('button')
      .find((btn) => btn.text() === 'Apply')
    await applyButton!.trigger('click')
    await flushPromises()

    expect(usageCalls().length).toBe(before)
    expect(wrapper.text()).toContain(
      'Enter both dates with start on or before end.',
    )
  })

  it('switches to hour scale and resets filters to the day default', async () => {
    const wrapper = mountUsage()
    await flushPromises()

    const hourButton = wrapper
      .findAll('button')
      .find((btn) => btn.text() === 'Hour')
    await hourButton!.trigger('click')
    await flushPromises()

    const dateInputs = wrapper.findAll('input[type="date"]')
    const start = (dateInputs[0].element as HTMLInputElement).value
    const end = (dateInputs[1].element as HTMLInputElement).value
    expect(start).toBe(end)
  })
})
