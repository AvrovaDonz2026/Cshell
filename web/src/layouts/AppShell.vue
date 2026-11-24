<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import LocaleSwitcher from '@/components/LocaleSwitcher.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import Button from '@/components/primitives/Button.vue'
import { logoUrl } from '@/lib/assets'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import { useThemeStore } from '@/stores/theme'

const { t } = useI18n()
const auth = useAuthStore()
const settings = useSettingsStore()
const theme = useThemeStore()
const router = useRouter()
const route = useRoute()
const COLLAPSE_KEY = 'cshell_shell_collapsed'

function readCollapsed(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(COLLAPSE_KEY) === '1'
}

const collapsed = ref(readCollapsed())
const drawerOpen = ref(false)
const accountOpen = ref(false)
const triggerRef = ref<HTMLButtonElement | null>(null)
const drawerRef = ref<HTMLElement | null>(null)
const mainRef = ref<HTMLElement | null>(null)
const accountRef = ref<HTMLElement | null>(null)
const accountTriggerRef = ref<HTMLButtonElement | null>(null)
const lastFocus = ref<HTMLElement | null>(null)

interface NavItem {
  name: string
  label: string
}

const showSectionNav = computed(() => ['dashboard', 'usage', 'keys', 'purchase', 'subscriptions'].includes(String(route.name)))

const sectionNavItems = computed<NavItem[]>(() => {
  const items: NavItem[] = [
    { name: 'dashboard', label: t('shell.nav.overview') },
    { name: 'usage', label: t('shell.nav.usage') },
    { name: 'keys', label: t('shell.nav.keys') },
  ]
  if (settings.paymentEnabled || settings.subscriptionEnabled) {
    items.push({ name: 'purchase', label: t('shell.nav.purchase') })
  }
  if (settings.subscriptionEnabled) {
    items.push({ name: 'subscriptions', label: t('shell.nav.subscriptions') })
  }
  return items
})

const navGroups = computed<{ label: string; items: NavItem[] }[]>(() => {
  const workspace: NavItem[] = [
    { name: 'dashboard', label: t('shell.nav.overview') },
    { name: 'usage', label: t('shell.nav.usage') },
    { name: 'keys', label: t('shell.nav.keys') },
  ]
  const account: NavItem[] = [
    { name: 'profile', label: t('shell.nav.profile') },
  ]
  if (settings.subscriptionEnabled) {
    account.push({
      name: 'subscriptions',
      label: t('shell.nav.subscriptions'),
    })
  }
  if (settings.paymentEnabled || settings.subscriptionEnabled) {
    account.push({ name: 'purchase', label: t('shell.nav.purchase') })
    account.push({ name: 'orders', label: t('shell.nav.orders') })
  }
  return [
    { label: t('shell.groups.workspace'), items: workspace },
    { label: t('shell.groups.account'), items: account },
  ]
})

/**
 * Collapsed rail shows a compact monogram derived from the item label so the
 * 72px width never clips a word mid-glyph.
 */
function monogram(label: string): string {
  const words = label.trim().split(/\s+/)
  if (words.length > 1) {
    return words
      .map((word) => word.charAt(0))
      .join('')
      .slice(0, 2)
      .toUpperCase()
  }
  return label.slice(0, 2).toUpperCase()
}

const currentLabel = computed(() => {
  const found = [...navGroups.value.flatMap((group) => group.items)].find(
    (item) => item.name === route.name,
  )
  return found?.label ?? t('pages.dashboard')
})

const displayName = computed(
  () => auth.user?.username?.trim() || auth.user?.email || '',
)
const displayEmail = computed(() => auth.user?.email || '')
const showEmail = computed(
  () => Boolean(displayName.value) && displayEmail.value !== displayName.value,
)

function toggleCollapsed(): void {
  collapsed.value = !collapsed.value
}

watch(collapsed, (value) => {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0')
})

function focusableIn(root: HTMLElement | null): HTMLElement[] {
  if (!root) return []
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => el.tabIndex !== -1,
  )
}

function setMainInert(inert: boolean): void {
  const main = mainRef.value
  if (!main) return
  if (inert) main.setAttribute('inert', '')
  else main.removeAttribute('inert')
}

function lockBodyScroll(lock: boolean): void {
  if (typeof document === 'undefined') return
  document.body.style.overflow = lock ? 'hidden' : ''
}

function openDrawer(): void {
  const active = document.activeElement as HTMLElement | null
  lastFocus.value = active && active !== document.body ? active : null
  drawerOpen.value = true
  setMainInert(true)
  lockBodyScroll(true)
  nextTick(() => {
    const first = focusableIn(drawerRef.value)[0]
    ;(first ?? drawerRef.value)?.focus()
  })
}

function closeDrawer(): void {
  if (!drawerOpen.value) return
  drawerOpen.value = false
  setMainInert(false)
  lockBodyScroll(false)
  accountOpen.value = false
  nextTick(() => {
    ;(lastFocus.value ?? triggerRef.value)?.focus()
  })
}

function onDrawerKeydown(event: KeyboardEvent): void {
  if (!drawerOpen.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeDrawer()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = focusableIn(drawerRef.value)
  if (!focusable.length) {
    event.preventDefault()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement as HTMLElement | null
  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

function openAccount(): void {
  accountOpen.value = true
  nextTick(() => {
    const panel = accountRef.value
    const first = panel
      ? focusableIn(panel).find((el) => el !== accountTriggerRef.value)
      : undefined
    ;(first ?? accountTriggerRef.value)?.focus()
  })
}

function closeAccount(restore = true): void {
  if (!accountOpen.value) return
  accountOpen.value = false
  if (restore) nextTick(() => accountTriggerRef.value?.focus())
}

function toggleAccount(): void {
  if (accountOpen.value) closeAccount()
  else openAccount()
}

function onAccountKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeAccount()
  }
}

function isWithinOwnedPortal(target: Node): boolean {
  const account = accountRef.value
  if (!account) return false
  const ownedSelectIds = new Set(
    Array.from(account.querySelectorAll<HTMLElement>('[data-select-owner]'))
      .map((element) => element.dataset.selectOwner)
      .filter((id): id is string => Boolean(id)),
  )
  const list = target instanceof Element ? target.closest<HTMLElement>('.cshell-select__list[data-select-owner]') : null
  return Boolean(list?.dataset.selectOwner && ownedSelectIds.has(list.dataset.selectOwner))
}

function onDocumentPointerDown(event: MouseEvent): void {
  if (!accountOpen.value) return
  const target = event.target as Node
  if (accountRef.value?.contains(target) || isWithinOwnedPortal(target)) return
  closeAccount(false)
}

async function onLogout(): Promise<void> {
  closeAccount(false)
  await auth.logout()
  await router.push({ name: 'login' })
}

watch(
  () => route.fullPath,
  () => {
    if (drawerOpen.value) closeDrawer()
    if (accountOpen.value) closeAccount(false)
  },
)

watch(drawerOpen, (open) => {
  if (typeof document === 'undefined') return
  if (open) document.addEventListener('keydown', onDrawerKeydown)
  else document.removeEventListener('keydown', onDrawerKeydown)
})

watch(accountOpen, (open) => {
  if (typeof document === 'undefined') return
  if (open) document.addEventListener('mousedown', onDocumentPointerDown)
  else document.removeEventListener('mousedown', onDocumentPointerDown)
})

onBeforeUnmount(() => {
  if (typeof document === 'undefined') return
  document.removeEventListener('keydown', onDrawerKeydown)
  document.removeEventListener('mousedown', onDocumentPointerDown)
  setMainInert(false)
  lockBodyScroll(false)
})
</script>

<template>
  <div
    class="cshell-user-workspace app-shell"
    :class="{ 'app-shell--collapsed': collapsed }"
    :data-theme="theme.mode"
  >
    <aside class="shell-sidebar" :aria-label="t('shell.nav.label')">
      <div class="sidebar__brand">
        <RouterLink class="brand" :to="{ name: 'dashboard' }">
          <img
            class="brand__logo"
            :src="logoUrl"
            width="32"
            height="32"
            alt=""
          >
          <span class="brand__name">{{ t('brand.name') }}</span>
        </RouterLink>
        <button
          type="button"
          class="collapse-btn"
          :aria-expanded="!collapsed"
          :title="collapsed ? t('shell.sidebar.expand') : t('shell.sidebar.collapse')"
          :aria-label="collapsed ? t('shell.sidebar.expand') : t('shell.sidebar.collapse')"
          @click="toggleCollapsed"
        >
          <span aria-hidden="true">{{ collapsed ? '»' : '«' }}</span>
        </button>
      </div>
      <nav class="sidebar__nav">
        <div
          v-for="group in navGroups"
          :key="group.label"
          class="nav-group"
        >
          <p class="nav-group__label">
            {{ group.label }}
          </p>
          <RouterLink
            v-for="item in group.items"
            :key="item.name"
            :to="{ name: item.name }"
            class="nav-link"
            :title="collapsed ? item.label : undefined"
          >
            <span v-if="collapsed" class="nav-link__mono" aria-hidden="true">
              {{ monogram(item.label) }}
            </span>
            <span class="nav-link__label">{{ item.label }}</span>
          </RouterLink>
        </div>
      </nav>

      <div class="sidebar__account">
        <p v-if="!collapsed" class="account__name">
          {{ displayName }}
        </p>
        <p v-if="!collapsed && showEmail" class="account__email">
          {{ displayEmail }}
        </p>
        <span
          v-if="collapsed"
          class="account__initials"
          :title="displayEmail || displayName"
          :aria-label="displayEmail || displayName"
        >
          {{ (displayName || 'C').slice(0, 1).toUpperCase() }}
        </span>
        <div class="account__controls">
          <ThemeToggle />
          <LocaleSwitcher />
        </div>
        <Button
          v-if="!collapsed"
          variant="secondary"
          block
          @click="onLogout"
        >
          {{ t('shell.logout') }}
        </Button>
        <button
          v-else
          type="button"
          class="account__icon-btn"
          :aria-label="t('shell.logout')"
          :title="t('shell.logout')"
          @click="onLogout"
        >
          <span aria-hidden="true">⏻</span>
        </button>
        <RouterLink
          v-if="!collapsed"
          class="account__home"
          :to="{ name: 'home' }"
        >
          {{ t('shell.backHome') }}
        </RouterLink>
        <RouterLink
          v-else
          class="account__icon-btn"
          :to="{ name: 'home' }"
          :aria-label="t('shell.backHome')"
          :title="t('shell.backHome')"
        >
          <span aria-hidden="true">⌂</span>
        </RouterLink>
      </div>
    </aside>

    <div class="shell-main">
      <header class="shell-header">
        <div class="shell-header__left">
          <button
            ref="triggerRef"
            type="button"
            class="menu-btn"
            :aria-label="t('shell.menu.open')"
            :aria-expanded="drawerOpen"
            @click="openDrawer"
          >
            <span aria-hidden="true">☰</span>
          </button>
          <nav class="breadcrumb" :aria-label="t('shell.breadcrumb.label')">
            <span class="breadcrumb__root">{{ t('brand.name') }}</span>
            <span class="breadcrumb__sep" aria-hidden="true">/</span>
            <span class="breadcrumb__current" aria-current="page">
              {{ currentLabel }}
            </span>
          </nav>
        </div>

        <div class="shell-header__right">
          <button
            ref="accountTriggerRef"
            type="button"
            class="account-menu__trigger"
            aria-haspopup="menu"
            :aria-expanded="accountOpen"
            @click="toggleAccount"
          >
            <span class="account-menu__initials" aria-hidden="true">
              {{ (displayName || 'C').slice(0, 1).toUpperCase() }}
            </span>
            <span class="account-menu__label">{{ displayName }}</span>
          </button>

          <div
            v-if="accountOpen"
            ref="accountRef"
            class="account-menu"
            role="menu"
            :aria-label="t('shell.account.menu')"
            @keydown="onAccountKeydown"
          >
            <div class="account-menu__head">
              <p class="account-menu__name">
                {{ displayName }}
              </p>
              <p v-if="showEmail" class="account-menu__email">
                {{ displayEmail }}
              </p>
            </div>
            <RouterLink
              class="account-menu__item"
              role="menuitem"
              :to="{ name: 'profile' }"
            >
              {{ t('shell.nav.profile') }}
            </RouterLink>
            <RouterLink
              class="account-menu__item"
              role="menuitem"
              :to="{ name: 'home' }"
            >
              {{ t('shell.backHome') }}
            </RouterLink>
            <button
              type="button"
              class="account-menu__item account-menu__logout"
              role="menuitem"
              @click="onLogout"
            >
              {{ t('shell.logout') }}
            </button>
            <div class="account-menu__prefs">
              <ThemeToggle />
              <LocaleSwitcher />
            </div>
          </div>
        </div>
      </header>

      <main ref="mainRef" class="shell-content">
        <div class="shell-container">
          <nav v-if="showSectionNav" class="section-nav" :aria-label="t('shell.sectionNav.label')">
            <div class="section-nav__list">
              <RouterLink
                v-for="item in sectionNavItems"
                :key="item.name"
                class="section-nav__link"
                :to="{ name: item.name }"
                :aria-current="route.name === item.name ? 'page' : undefined"
              >
                {{ item.label }}
              </RouterLink>
            </div>
          </nav>
          <RouterView />
        </div>
      </main>
    </div>

    <div v-if="drawerOpen" class="drawer-overlay" @click="closeDrawer" />
    <aside
      v-if="drawerOpen"
      ref="drawerRef"
      class="drawer"
      role="dialog"
      aria-modal="true"
      :aria-label="t('shell.nav.label')"
      tabindex="-1"
    >
      <div class="drawer__top">
        <RouterLink class="brand" :to="{ name: 'dashboard' }">
          <img class="brand__logo" :src="logoUrl" width="32" height="32" alt="">
          <span class="brand__name">{{ t('brand.name') }}</span>
        </RouterLink>
        <Button
          variant="ghost"
          :aria-label="t('shell.menu.close')"
          @click="closeDrawer"
        >
          ✕
        </Button>
      </div>
      <nav class="sidebar__nav">
        <div v-for="group in navGroups" :key="group.label" class="nav-group">
          <p class="nav-group__label">{{ group.label }}</p>
          <RouterLink
            v-for="item in group.items"
            :key="item.name"
            :to="{ name: item.name }"
            class="nav-link"
            @click="closeDrawer"
          >
            <span class="nav-link__label">{{ item.label }}</span>
          </RouterLink>
        </div>
      </nav>
      <div class="sidebar__account">
        <p class="account__name">{{ displayName }}</p>
        <p v-if="showEmail" class="account__email">{{ displayEmail }}</p>
        <div class="account__controls">
          <ThemeToggle />
          <LocaleSwitcher />
        </div>
        <Button variant="secondary" block @click="onLogout">
          {{ t('shell.logout') }}
        </Button>
        <RouterLink class="account__home" :to="{ name: 'home' }" @click="closeDrawer">
          {{ t('shell.backHome') }}
        </RouterLink>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  min-height: 100vh;
  background: var(--cshell-bg);
  color: var(--cshell-text);
  transition: grid-template-columns 0.18s ease;
}

.app-shell--collapsed {
  grid-template-columns: 72px minmax(0, 1fr);
}

.shell-sidebar {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  height: 100vh;
  padding: 1.1rem 0.85rem;
  overflow-y: auto;
  background: var(--cshell-sidebar);
  border-right: 1px solid var(--cshell-border);
  border-top-right-radius: var(--cshell-radius-window);
  border-bottom-right-radius: var(--cshell-radius-window);
}

.sidebar__brand {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
  text-decoration: none;
  color: inherit;
}

.brand__logo {
  flex: none;
  border-radius: var(--cshell-radius-badge);
  object-fit: cover;
}

.brand__name {
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.app-shell--collapsed .brand__name {
  display: none;
}

.collapse-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  flex: none;
  padding: 0;
  border: 1px solid var(--cshell-border);
  border-radius: var(--cshell-radius-control);
  background: transparent;
  color: var(--cshell-text-muted);
  cursor: pointer;
}

.collapse-btn:hover {
  background: var(--cshell-accent-soft);
  color: var(--cshell-text);
}

.app-shell--collapsed .sidebar__brand {
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.sidebar__nav {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 1.1rem;
  min-width: 0;
}

.nav-group {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.nav-group__label {
  margin: 0 0 0.25rem;
  padding: 0 0.6rem;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--cshell-text-muted);
}

.app-shell--collapsed .nav-group__label {
  display: none;
}

.nav-link {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 2.5rem;
  padding: 0.45rem 0.75rem;
  border-radius: var(--cshell-radius-control);
  color: var(--cshell-text-muted);
  text-decoration: none;
  font-size: 0.92rem;
  font-weight: 500;
}
.nav-link:hover {
  background: color-mix(in srgb, var(--cshell-surface) 55%, transparent);
  color: var(--cshell-text);
}

.nav-link.router-link-active {
  background: var(--cshell-accent-soft);
  color: var(--cshell-text);
  font-weight: 600;
}

.nav-link.router-link-active::before {
  content: '';
  position: absolute;
  top: 0.45rem;
  bottom: 0.45rem;
  left: 0;
  width: 3px;
  border-radius: 999px;
  background: var(--cshell-accent);
}

.nav-link__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-link__mono {
  display: none;
}

.app-shell--collapsed .nav-link {
  justify-content: center;
  padding: 0.45rem 0.4rem;
}

.app-shell--collapsed .nav-link__label {
  display: none;
}

.app-shell--collapsed .nav-link__mono {
  display: inline-block;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.sidebar__account {
  display: grid;
  gap: 0.5rem;
  padding-top: 0.9rem;
  border-top: 1px solid var(--cshell-border);
  min-width: 0;
}

.account__name {
  margin: 0;
  font-size: 0.86rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account__email {
  margin: 0;
  font-size: 0.76rem;
  color: var(--cshell-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account__controls {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.app-shell--collapsed .account__controls {
  display: none;
}

.app-shell--collapsed .sidebar__account {
  justify-items: center;
}

.account__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  margin: 0 auto;
  padding: 0;
  border: 1px solid var(--cshell-border);
  border-radius: var(--cshell-radius-control);
  background: var(--cshell-surface);
  color: var(--cshell-text);
  cursor: pointer;
}

.account__initials {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.9rem;
  height: 1.9rem;
  border-radius: var(--cshell-radius-badge);
  background: var(--cshell-accent-soft);
  color: var(--cshell-accent);
  font-weight: 700;
  font-size: 0.8rem;
}

.account__home {
  font-size: 0.8rem;
  color: var(--cshell-text-muted);
  text-align: center;
  text-decoration: underline;
}

.shell-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.shell-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 3.5rem;
  padding: 0.6rem 1.5rem;
  background: var(--cshell-bg-elevated);
  border-bottom: 1px solid var(--cshell-border);
  backdrop-filter: blur(8px);
}

.shell-header__left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.shell-header__right {
  position: relative;
  flex: none;
}

.menu-btn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  padding: 0;
  border: 1px solid var(--cshell-border);
  border-radius: var(--cshell-radius-control);
  background: var(--cshell-surface);
  color: inherit;
  cursor: pointer;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
  font-size: 0.9rem;
}

.breadcrumb__root {
  color: var(--cshell-text-muted);
}

.breadcrumb__sep {
  color: var(--cshell-border);
}

.breadcrumb__current {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-menu__trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2.5rem;
  padding: 0.3rem 0.6rem 0.3rem 0.35rem;
  border: 1px solid var(--cshell-border);
  border-radius: var(--cshell-radius-control);
  background: var(--cshell-surface);
  color: inherit;
  cursor: pointer;
}

.account-menu__initials {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.9rem;
  height: 1.9rem;
  border-radius: var(--cshell-radius-badge);
  background: var(--cshell-accent-soft);
  color: var(--cshell-accent);
  font-weight: 700;
}

.account-menu__label {
  max-width: 12rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.86rem;
}

.account-menu {
  position: absolute;
  top: calc(100% + 0.4rem);
  right: 0;
  z-index: 40;
  display: grid;
  gap: 0.15rem;
  width: min(16rem, calc(100vw - 2rem));
  min-width: 0;
  padding: 0.4rem;
  border-radius: var(--cshell-radius-panel);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-surface);
  box-shadow: var(--cshell-shadow);
}

.account-menu__head {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--cshell-border);
  margin-bottom: 0.2rem;
  min-width: 0;
}

.account-menu__name {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.account-menu__email {
  margin: 0.1rem 0 0;
  font-size: 0.76rem;
  color: var(--cshell-text-muted);
  overflow-wrap: anywhere;
}

.account-menu__item,
.account-menu__prefs :deep(.theme-toggle__button),
.account-menu__prefs :deep(.cshell-select__trigger) {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 0.55rem 0.75rem;
  border: 0;
  border-radius: var(--cshell-radius-badge);
  background: transparent;
  color: var(--cshell-text);
  font-family: inherit;
  font-size: 0.88rem;
  font-weight: 400;
  line-height: 1.4;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}

.account-menu__item:hover,
.account-menu__item:focus-visible,
.account-menu__prefs :deep(.theme-toggle__button:hover:not(:disabled)),
.account-menu__prefs :deep(.theme-toggle__button:focus-visible),
.account-menu__prefs :deep(.cshell-select__trigger:hover:not(:disabled)),
.account-menu__prefs :deep(.cshell-select__trigger:focus-visible) {
  background: var(--cshell-accent-soft);
}

.account-menu__logout {
  color: var(--cshell-danger);
}

.account-menu__prefs {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.15rem;
  min-width: 0;
  margin-top: 0.2rem;
  padding-top: 0.35rem;
  border-top: 1px solid var(--cshell-border);
}

.account-menu__prefs :deep(.locale-switcher),
.account-menu__prefs :deep(.cshell-select) {
  display: block;
  width: 100%;
  min-width: 0;
}

.shell-content {
  padding: 2rem 1.5rem 3.5rem;
}

.shell-container {
  width: 100%;
  max-width: 72rem;
  margin: 0 auto;
  min-width: 0;
}

.section-nav {
  max-width: 100%;
  min-width: 0;
  margin-bottom: 1.25rem;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  border-bottom: 1px solid var(--cshell-border);
}

.section-nav__list {
  display: flex;
  width: max-content;
  min-width: 100%;
  gap: 0.35rem;
}

.section-nav__link {
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem;
  padding: 0.65rem 0.9rem;
  border-bottom: 2px solid transparent;
  color: var(--cshell-text-muted);
  font-size: 0.9rem;
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
}

.section-nav__link:hover {
  color: var(--cshell-text);
  background: var(--cshell-accent-soft);
}

.section-nav__link[aria-current='page'] {
  border-bottom-color: var(--cshell-accent);
  color: var(--cshell-text);
  font-weight: 600;
}

.drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: 900;
  background: var(--cshell-overlay);
}

.drawer {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 950;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  width: min(86vw, 19rem);
  padding: 1rem;
  overflow-y: auto;
  background: var(--cshell-sidebar);
  border-right: 1px solid var(--cshell-border);
  border-top-right-radius: var(--cshell-radius-window);
  border-bottom-right-radius: var(--cshell-radius-window);
  box-shadow: var(--cshell-shadow);
}

.drawer__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.drawer .sidebar__nav {
  flex: 0 1 auto;
}

.drawer .sidebar__account {
  margin-top: auto;
}

@media (max-width: 1023px) {
  .app-shell,
  .app-shell--collapsed {
    grid-template-columns: minmax(0, 1fr);
  }

  .shell-sidebar {
    display: none;
  }

  .menu-btn {
    display: inline-flex;
  }

  .shell-header {
    padding: 0.5rem 1rem;
  }

  .shell-content {
    padding: 1.25rem 1rem 3rem;
  }
}

@media (max-width: 560px) {
  .account-menu__label {
    display: none;
  }

  .breadcrumb__root,
  .breadcrumb__sep {
    display: none;
  }
}

@media (max-width: 1023px) {
  .nav-link {
    min-height: 44px;
  }

  .account-menu__trigger,
  .account-menu__item {
    min-height: 44px;
  }
}
</style>
