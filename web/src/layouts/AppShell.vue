<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import LocaleSwitcher from '@/components/LocaleSwitcher.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import Button from '@/components/primitives/Button.vue'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'

const { t } = useI18n()
const auth = useAuthStore()
const theme = useThemeStore()
const router = useRouter()

const drawerOpen = ref(false)
const menuButtonRef = ref<HTMLButtonElement | null>(null)
const drawerRef = ref<HTMLElement | null>(null)
const lastFocus = ref<HTMLElement | null>(null)

const navItems = computed(() => [
  { name: 'dashboard', label: t('shell.nav.dashboard') },
  { name: 'usage', label: t('shell.nav.usage') },
  { name: 'keys', label: t('shell.nav.keys') },
  { name: 'profile', label: t('shell.nav.profile') },
  { name: 'subscriptions', label: t('shell.nav.subscriptions') },
  { name: 'purchase', label: t('shell.nav.purchase') },
  { name: 'orders', label: t('shell.nav.orders') },
])

function openDrawer(): void {
  lastFocus.value = document.activeElement as HTMLElement | null
  drawerOpen.value = true
  nextTick(() => drawerRef.value?.querySelector<HTMLElement>('a, button')?.focus())
}

function closeDrawer(): void {
  drawerOpen.value = false
  nextTick(() => {
    ;(lastFocus.value || menuButtonRef.value)?.focus()
  })
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && drawerOpen.value) {
    event.preventDefault()
    closeDrawer()
  }
}

async function onLogout(): Promise<void> {
  await auth.logout()
  await router.push({ name: 'login' })
}

watch(drawerOpen, (open) => {
  if (open) document.addEventListener('keydown', onKeydown)
  else document.removeEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    class="cshell-user-workspace app-shell"
    :data-theme="theme.mode"
  >
    <aside class="app-shell__sidebar" aria-label="Primary">
      <div class="brand">
        <img
          class="brand__logo"
          src="/2shell.jpeg"
          width="40"
          height="40"
          alt=""
        >
        <span class="brand__name">{{ t('brand.name') }}</span>
      </div>
      <nav class="nav">
        <RouterLink
          v-for="item in navItems"
          :key="item.name"
          :to="{ name: item.name }"
          class="nav__link"
        >
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>

    <div class="app-shell__main">
      <header class="app-shell__header">
        <button
          ref="menuButtonRef"
          type="button"
          class="menu-btn"
          :aria-label="t('shell.menu.open')"
          :aria-expanded="drawerOpen"
          @click="openDrawer"
        >
          ☰
        </button>
        <div class="header-actions">
          <ThemeToggle />
          <LocaleSwitcher />
          <Button variant="secondary" @click="onLogout">
            {{ t('shell.logout') }}
          </Button>
        </div>
      </header>
      <main class="app-shell__content">
        <RouterView />
      </main>
    </div>

    <div
      v-if="drawerOpen"
      class="drawer-overlay"
      @click="closeDrawer"
    />
    <aside
      v-show="drawerOpen"
      ref="drawerRef"
      class="drawer"
      role="dialog"
      aria-modal="true"
      :aria-label="t('shell.menu.open')"
    >
      <div class="drawer__top">
        <div class="brand">
          <img
            class="brand__logo"
            src="/2shell.jpeg"
            width="36"
            height="36"
            alt=""
          >
          <span class="brand__name">{{ t('brand.name') }}</span>
        </div>
        <Button
          variant="ghost"
          :aria-label="t('shell.menu.close')"
          @click="closeDrawer"
        >
          ✕
        </Button>
      </div>
      <nav class="nav">
        <RouterLink
          v-for="item in navItems"
          :key="item.name"
          :to="{ name: item.name }"
          class="nav__link"
          @click="closeDrawer"
        >
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
  </div>
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-columns: 240px 1fr;
  min-height: 100vh;
  background: var(--cshell-bg);
  color: var(--cshell-text);
}

.app-shell__sidebar {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.25rem 1rem;
  background: var(--cshell-sidebar);
  border-right: 1px solid var(--cshell-border);
  border-top-right-radius: var(--cshell-radius-window);
  border-bottom-right-radius: var(--cshell-radius-window);
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.brand__logo {
  border-radius: var(--cshell-radius-badge);
  object-fit: cover;
}

.brand__name {
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.nav__link {
  text-decoration: none;
  padding: 0.55rem 0.75rem;
  border-radius: var(--cshell-radius-control);
  color: var(--cshell-text-muted);
}

.nav__link.router-link-active,
.nav__link:hover {
  background: var(--cshell-accent-soft);
  color: var(--cshell-text);
}

.app-shell__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.app-shell__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.85rem 1.25rem;
  border-bottom: 1px solid var(--cshell-border);
  background: var(--cshell-bg-elevated);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
}

.app-shell__content {
  padding: 1.25rem;
}

.menu-btn {
  display: none;
  align-items: center;
  justify-content: center;
  min-width: 2.5rem;
  min-height: 2.5rem;
  border: 0;
  border-radius: var(--cshell-radius-control);
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.drawer-overlay {
  position: fixed;
  inset: 0;
  background: var(--cshell-overlay);
  z-index: 900;
}

.drawer {
  position: fixed;
  inset: 0 auto 0 0;
  width: min(84vw, 280px);
  z-index: 950;
  padding: 1rem;
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
  margin-bottom: 1rem;
}

@media (max-width: 860px) {
  .app-shell {
    grid-template-columns: 1fr;
  }

  .app-shell__sidebar {
    display: none;
  }

  .menu-btn {
    display: inline-flex;
  }
}
</style>
