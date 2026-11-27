import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import { resetDialogStack } from '@/lib/dialogContext'
import { setLocale } from '@/i18n'
import en from '@/i18n/locales/en'
import { useAuthStore } from '@/stores/auth'
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
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/settings/public')) return okEnvelope(data)
      if (String(url).includes('/auth/logout')) return okEnvelope({})
      if (init?.method && init.method !== 'GET') return okEnvelope({})
      return okEnvelope({})
    }),
  )
}

function seedUser(pinia: Pinia, role = 'user') {
  localStorage.setItem('auth_token', 'shell-token')
  localStorage.setItem('refresh_token', 'shell-refresh')
  localStorage.setItem(
    'auth_user',
    JSON.stringify({
      id: 3,
      email: 'donz@example.invalid',
      username: 'Donz',
      role,
    }),
  )
  const auth = useAuthStore(pinia)
  auth.hydrate()
}

async function mountShell(pinia: Pinia) {
  setActivePinia(pinia)
  // Settings gates are read synchronously by the shell, so preload them.
  const settings = useSettingsStore()
  if (!settings.settingsReady) await settings.loadPublic()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/dashboard', name: 'dashboard', component: { template: '<div />' } },
      { path: '/usage', name: 'usage', component: { template: '<div />' } },
      { path: '/keys', name: 'keys', component: { template: '<div />' } },
      { path: '/profile', name: 'profile', component: { template: '<div />' } },
      { path: '/subscriptions', name: 'subscriptions', component: { template: '<div />' } },
      { path: '/purchase', name: 'purchase', component: { template: '<div />' } },
      { path: '/orders', name: 'orders', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
    ],
  })
  await router.push('/dashboard')
  await router.isReady()
  const wrapper = mount(AppShell, {
    attachTo: document.body,
    global: { plugins: [i18n(), router, pinia] },
  })
  await flushPromises()
  return wrapper
}

function pressTab(shiftKey = false) {
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey,
    bubbles: true,
    cancelable: true,
  })
  document.dispatchEvent(event)
  return event
}

describe('AppShell', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    document.body.replaceChildren()
    document.body.style.overflow = ''
    resetDialogStack()
  })

  it('renders grouped navigation and gates billing groups on settings', async () => {
    const pinia = createPinia()
    seedUser(pinia)
    stubSettings({ payment_enabled: false, subscription_enabled: false })

    const wrapper = await mountShell(pinia)

    expect(wrapper.text()).toContain('Workspace')
    expect(wrapper.text()).toContain('Account')
    for (const label of ['Overview', 'Usage', 'API Keys', 'Profile']) {
      expect(wrapper.text()).toContain(label)
    }
    // Billing routes stay hidden while their settings gates are closed.
    const navText = wrapper.find('.sidebar__nav').text()
    expect(navText).not.toContain('Subscriptions')
    expect(navText).not.toContain('Purchase')
    expect(navText).not.toContain('Orders')
    expect(wrapper.text()).toContain('Donz')
    expect(wrapper.text()).toContain('donz@example.invalid')
  })

  it('shows billing nav when settings enable it', async () => {
    const pinia = createPinia()
    seedUser(pinia)
    stubSettings({ payment_enabled: true, subscription_enabled: true })

    const wrapper = await mountShell(pinia)

    const navText = wrapper.find('.sidebar__nav').text()
    expect(navText).toContain('Subscriptions')
    expect(navText).toContain('Purchase')
    expect(navText).toContain('Orders')
  })

  it('renders section navigation with exact active route and billing gates', async () => {
    const pinia = createPinia()
    seedUser(pinia)
    stubSettings({ payment_enabled: true, subscription_enabled: false })
    const wrapper = await mountShell(pinia)
    const sectionNav = wrapper.find('nav.section-nav')
    expect(sectionNav.attributes('aria-label')).toBe('Workspace sections')
    expect(sectionNav.findAll('a').map((link) => link.text())).toEqual([
      'Overview', 'Usage', 'API Keys', 'Purchase',
    ])
    expect(sectionNav.findAll('[aria-current="page"]').map((link) => link.attributes('href')))
      .toEqual(['/dashboard'])
    expect(wrapper.find('.section-nav__link[href="/dashboard"]').attributes('aria-current')).toBe('page')
    expect(wrapper.find('.section-nav__link[href="/purchase"]').exists()).toBe(true)
    expect(wrapper.find('.section-nav__link[href="/subscriptions"]').exists()).toBe(false)
    expect(wrapper.find('.section-nav').attributes('class')).toContain('section-nav')

    await wrapper.find('.section-nav__link[href="/keys"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.section-nav__link[href="/keys"]').attributes('aria-current')).toBe('page')
    expect(wrapper.find('.section-nav__link[href="/dashboard"]').attributes('aria-current')).toBeUndefined()
    wrapper.unmount()
  })

  it('persists the collapsed state in localStorage across mounts', async () => {
    const pinia = createPinia()
    seedUser(pinia)
    stubSettings({ payment_enabled: true, subscription_enabled: true })

    const wrapper = await mountShell(pinia)
    const button = wrapper.find('.collapse-btn')
    expect(button.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('.app-shell').classes()).not.toContain('app-shell--collapsed')

    await button.trigger('click')
    await flushPromises()

    expect(wrapper.find('.app-shell').classes()).toContain('app-shell--collapsed')
    expect(wrapper.find('.collapse-btn').attributes('aria-expanded')).toBe('false')
    expect(localStorage.getItem('cshell_shell_collapsed')).toBe('1')

    wrapper.unmount()
    const second = await mountShell(createPinia())
    expect(second.find('.app-shell').classes()).toContain('app-shell--collapsed')
    expect(second.find('.collapse-btn').attributes('aria-expanded')).toBe('false')

    await second.find('.collapse-btn').trigger('click')
    expect(localStorage.getItem('cshell_shell_collapsed')).toBe('0')
  })

  it('traps focus inside the mobile drawer, closes on Escape and restores focus', async () => {
    const pinia = createPinia()
    seedUser(pinia)
    stubSettings({ payment_enabled: true, subscription_enabled: true })

    const wrapper = await mountShell(pinia)

    const trigger = wrapper.find('.menu-btn')
    expect(trigger.exists()).toBe(true)
    await trigger.trigger('click')
    await flushPromises()

    const drawer = wrapper.find('.drawer')
    expect(drawer.exists()).toBe(true)
    expect(drawer.attributes('role')).toBe('dialog')
    expect(drawer.attributes('aria-modal')).toBe('true')

    const main = wrapper.find('main')
    expect(main.attributes('inert')).toBe('')
    expect(document.body.style.overflow).toBe('hidden')

    const focusables = Array.from(
      drawer.element.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled])',
      ),
    )
    expect(focusables.length).toBeGreaterThan(1)
    // Focus starts on the first focusable item.
    expect(document.activeElement).toBe(focusables[0])

    // Shift+Tab from the first item wraps to the last.
    focusables[0]!.focus()
    const shiftEvent = pressTab(true)
    expect(shiftEvent.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(focusables[focusables.length - 1])

    // Tab from the last item wraps back to the first.
    focusables[focusables.length - 1]!.focus()
    const forwardEvent = pressTab()
    expect(forwardEvent.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(focusables[0])

    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(escape)
    await flushPromises()

    expect(wrapper.find('.drawer').exists()).toBe(false)
    expect(main.attributes('inert')).toBeUndefined()
    expect(document.body.style.overflow).toBe('')
    expect(document.activeElement).toBe(trigger.element)

    wrapper.unmount()
  })

  it('opens and closes the account menu with Escape and restores focus', async () => {
    const pinia = createPinia()
    seedUser(pinia)
    stubSettings({ payment_enabled: false, subscription_enabled: false })

    const wrapper = await mountShell(pinia)

    const accountTrigger = wrapper.find('.account-menu__trigger')
    expect(accountTrigger.attributes('aria-expanded')).toBe('false')
    await accountTrigger.trigger('click')
    await flushPromises()

    expect(wrapper.find('.account-menu').exists()).toBe(true)
    expect(accountTrigger.attributes('aria-expanded')).toBe('true')

    const accountMenu = wrapper.find('.account-menu')
    accountMenu.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    await flushPromises()

    expect(wrapper.find('.account-menu').exists()).toBe(false)
    expect(document.activeElement).toBe(accountTrigger.element)
  })

  it('keeps the account menu open for its locale portal; Escape closes select then menu', async () => {
    const pinia = createPinia()
    seedUser(pinia)
    stubSettings({ payment_enabled: false, subscription_enabled: false })
    const wrapper = await mountShell(pinia)
    setLocale('en')
    const trigger = wrapper.find('.account-menu__trigger')
    await trigger.trigger('click')
    await flushPromises()
    const select = wrapper.find('.account-menu .cshell-select__trigger')
    await select.trigger('click')
    await flushPromises()
    const list = document.querySelector('.cshell-select__list') as HTMLElement
    expect(list).toBeTruthy()
    list.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flushPromises()
    expect(wrapper.find('.account-menu').exists()).toBe(true)
    expect(document.querySelector('.cshell-select__list')).toBeTruthy()
    const popupOption = document.querySelector('.cshell-select__option') as HTMLElement
    popupOption.click()
    setLocale('zh')
    await flushPromises()
    expect(wrapper.find('.account-menu').exists()).toBe(true)
    expect(document.documentElement.lang).toBe('zh')
    expect(localStorage.getItem('cshell_locale')).toBe('zh')

    await select.trigger('click')
    await flushPromises()
    expect(document.querySelector('.cshell-select__list')).toBeTruthy()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(wrapper.find('.account-menu').exists()).toBe(true)
    expect(document.querySelector('.cshell-select__list')).toBeNull()

    wrapper.find('.account-menu').element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(wrapper.find('.account-menu').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger.element)
    wrapper.unmount()
  })

  it('closes the drawer when navigating to another route', async () => {
    const pinia = createPinia()
    seedUser(pinia)
    stubSettings({ payment_enabled: false, subscription_enabled: false })

    const wrapper = await mountShell(pinia)
    await wrapper.find('.menu-btn').trigger('click')
    await flushPromises()
    expect(wrapper.find('.drawer').exists()).toBe(true)

    await wrapper.find('.drawer .nav-link').trigger('click')
    await flushPromises()

    expect(wrapper.find('.drawer').exists()).toBe(false)
    expect(document.body.style.overflow).toBe('')
    wrapper.unmount()
  })
})
