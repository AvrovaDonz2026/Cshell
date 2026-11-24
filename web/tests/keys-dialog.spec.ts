import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import KeysView from '@/views/KeysView.vue'
import en from '@/i18n/locales/en'

const group = { id: 7, name: 'Research group' }

const baseKey = {
  id: 1,
  name: 'Existing key',
  status: 'active',
  group_id: 7,
  group,
  quota: 100,
  quota_used: 12.5,
  created_at: '2026-01-01T00:00:00Z',
  expires_at: '2027-01-01T00:00:00Z',
  ip_whitelist: ['10.0.0.1'],
  ip_blacklist: ['9.9.9.9'],
}

function envelope(data: unknown) {
  return JSON.stringify({ code: 0, message: 'ok', data })
}

interface Captured {
  method: string
  url: string
  body?: Record<string, unknown>
}

function stubFetch(keys: unknown[], captured: Captured[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/groups/available')) {
        return { ok: true, status: 200, text: async () => envelope([group]) }
      }
      if (init?.method === 'POST' || init?.method === 'PUT') {
        captured.push({
          method: String(init.method),
          url,
          body: init.body ? JSON.parse(String(init.body)) : undefined,
        })
        return {
          ok: true,
          status: 200,
          text: async () => envelope({ ...baseKey, id: 2, key: 'sk-new' }),
        }
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          envelope({
            items: keys,
            total: keys.length,
            page: 1,
            page_size: 20,
            pages: 1,
          }),
      }
    }),
  )
}

async function mountKeys() {
  const i18n = createI18n({
    legacy: false,
    locale: 'en',
    messages: { en },
  })
  const wrapper = mount(KeysView, {
    global: { plugins: [i18n, createPinia()] },
  })
  await flushPromises()
  return wrapper
}

function dialogEl(): HTMLElement | null {
  return document.querySelector('.cshell-dialog')
}

function dialogButton(label: string): HTMLButtonElement | undefined {
  return Array.from(dialogEl()?.querySelectorAll('button') ?? []).find(
    (btn) => btn.textContent?.trim() === label,
  )
}

async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value
  el.dispatchEvent(new Event('input'))
  await flushPromises()
}

describe('KeysView dialogs', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.innerHTML = ''
  })

  it('shows inline quota/expiry errors and blocks create submit', async () => {
    const captured: Captured[] = []
    stubFetch([baseKey], captured)
    const wrapper = await mountKeys()

    await wrapper
      .findAll('button')
      .find((btn) => btn.text() === 'Create key')!
      .trigger('click')
    await flushPromises()

    const dialog = dialogEl()!
    const textInput = dialog.querySelector('input[type="text"]') as HTMLInputElement
    const numberInputs = Array.from(
      dialog.querySelectorAll('input[type="number"]'),
    ) as HTMLInputElement[]
    expect(numberInputs).toHaveLength(2)

    await type(textInput, 'New key')
    await type(numberInputs[0], '-5')
    await type(numberInputs[1], '1.5')

    expect(dialog.textContent).toContain(
      'Quota must be a number between 0 and 1,000,000.',
    )
    expect(dialog.textContent).toContain(
      'Expiry must be a whole number of days between 1 and 3650.',
    )
    expect(dialogButton('Create')?.disabled).toBe(true)

    dialogButton('Create')?.click()
    await flushPromises()
    expect(captured).toHaveLength(0)
  })

  it('validates IP entries inline, allows valid CIDR, and dedupes', async () => {
    const captured: Captured[] = []
    stubFetch([baseKey], captured)
    const wrapper = await mountKeys()

    await wrapper
      .findAll('button')
      .find((btn) => btn.text() === 'Create key')!
      .trigger('click')
    await flushPromises()

    const dialog = dialogEl()!
    const textInput = dialog.querySelector('input[type="text"]') as HTMLInputElement
    const areas = Array.from(
      dialog.querySelectorAll('textarea'),
    ) as HTMLTextAreaElement[]
    expect(areas).toHaveLength(2)

    await type(textInput, 'Cidr key')
    await type(areas[0], 'not-an-ip')
    expect(dialog.textContent).toContain(
      'Each IP entry must be a valid IPv4/IPv6 address or CIDR (max 50).',
    )
    expect(dialogButton('Create')?.disabled).toBe(true)

    await type(areas[0], ' 10.0.0.0/8 \n10.0.0.0/8\n\n2001:db8::/32')
    expect(dialog.textContent).not.toContain(
      'Each IP entry must be a valid IPv4/IPv6 address or CIDR (max 50).',
    )
    expect(dialogButton('Create')?.disabled).toBe(false)

    dialogButton('Create')?.click()
    await flushPromises()

    expect(captured).toHaveLength(1)
    expect(captured[0].body?.ip_whitelist).toEqual([
      '10.0.0.0/8',
      '2001:db8::/32',
    ])
  })

  it('preserves an unknown status and omits status when untouched', async () => {
    const captured: Captured[] = []
    stubFetch([{ ...baseKey, status: 'revoked' }], captured)
    const wrapper = await mountKeys()

    await wrapper
      .findAll('button')
      .find((btn) => btn.text() === 'Edit')!
      .trigger('click')
    await flushPromises()

    const dialog = dialogEl()!
    const trigger = Array.from(dialog.querySelectorAll('button')).find((btn) =>
      btn.classList.contains('cshell-select__trigger'),
    )
    // The unknown status is shown verbatim, not coerced to "Active".
    expect(trigger?.textContent?.trim()).toBe('revoked')

    // Opening the select exposes active/inactive plus the current value.
    trigger?.click()
    await flushPromises()
    const options = Array.from(
      document.querySelectorAll('.cshell-select__option'),
    ).map((option) => option.textContent?.trim())
    expect(options).toEqual(['Active', 'Inactive', 'revoked'])

    document
      .querySelectorAll('.cshell-select__option')
      .forEach((option) => {
        if (option.textContent?.trim() === 'revoked') {
          option.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        }
      })
    await flushPromises()

    dialogButton('Save')?.click()
    await flushPromises()

    expect(captured).toHaveLength(1)
    expect(captured[0].body?.status).toBeUndefined()
    expect(captured[0].body?.name).toBe('Existing key')
  })

  it('sends status when the user changes it', async () => {
    const captured: Captured[] = []
    stubFetch([baseKey], captured)
    const wrapper = await mountKeys()

    await wrapper
      .findAll('button')
      .find((btn) => btn.text() === 'Edit')!
      .trigger('click')
    await flushPromises()

    const trigger = Array.from(dialogEl()!.querySelectorAll('button')).find((btn) =>
      btn.classList.contains('cshell-select__trigger'),
    )
    trigger?.click()
    await flushPromises()

    Array.from(document.querySelectorAll('.cshell-select__option'))
      .find((option) => option.textContent?.trim() === 'Inactive')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    dialogButton('Save')?.click()
    await flushPromises()

    expect(captured[0].body?.status).toBe('inactive')
  })

  it('lists quota as used / total with a dash when unlimited', async () => {
    stubFetch(
      [
        baseKey,
        { ...baseKey, id: 3, name: 'Unlimited', quota: undefined, quota_used: 4 },
      ],
      [],
    )
    const wrapper = await mountKeys()

    const text = wrapper.text()
    expect(text).toContain('Quota used: 12.5 / 100')
    expect(text).toContain('Quota used: 4 / —')
    expect(text).toContain('IP allow/deny: 1 / 1')
    expect(text).toContain('2027-01-01T00:00:00Z')
  })
})
