<template>
  <div v-if="hasHomeContent" class="min-h-[100dvh]">
    <iframe
      v-if="isHomeContentUrl"
      :src="homeContent.trim()"
      :title="siteName"
      class="h-[100dvh] w-full border-0"
      allowfullscreen
    ></iframe>
    <!-- Deliberate upstream behavior: this HTML is supplied by the site administrator. -->
    <div v-else v-html="homeContent"></div>
  </div>

  <div v-else class="landing" :data-testid="compactHomeEnabled ? 'compact-home' : undefined">
    <header class="landing-header">
      <nav class="landing-frame flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4">
        <div class="flex min-w-0 items-center gap-3">
          <img :src="siteLogo || defaultLogo" alt="" class="h-9 w-9 shrink-0 rounded-xl object-contain" />
          <span class="truncate text-base font-bold tracking-tight">{{ siteName }}</span>
        </div>
        <div class="flex max-w-full flex-wrap items-center gap-1.5 sm:gap-3">
          <LocaleSwitcher />
          <a v-if="docUrl" :href="docUrl" target="_blank" rel="noopener noreferrer"
            class="btn btn-ghost btn-icon" :aria-label="t('home.viewDocs')" :title="t('home.viewDocs')">
            <Icon name="book" size="sm" />
          </a>
          <RouterLink v-if="showModelPlazaEntry" to="/model-plaza" class="btn btn-ghost"
            :aria-label="t('nav.modelPlaza')" :title="t('nav.modelPlaza')">
            <Icon name="grid" size="sm" />
            <span class="hidden sm:inline">{{ t('nav.modelPlaza') }}</span>
          </RouterLink>
          <button type="button" class="btn btn-ghost btn-icon"
            :aria-label="isDark ? t('home.switchToLight') : t('home.switchToDark')" @click="toggleTheme">
            <Icon :name="isDark ? 'sun' : 'moon'" size="sm" />
          </button>
          <a v-if="isAdmin && isAuthenticated" :href="entryPath" class="btn btn-secondary">
            {{ t('home.dashboard') }}
          </a>
          <RouterLink v-else :to="entryPath" class="btn btn-secondary">
            {{ isAuthenticated ? t('home.dashboard') : t('home.login') }}
          </RouterLink>
        </div>
      </nav>
    </header>

    <main class="landing-frame flex-1">
      <section class="landing-hero" :class="{ 'landing-hero-compact': compactHomeEnabled }">
        <div class="relative z-10 min-w-0">
          <p class="cshell-eyebrow mb-6">{{ isChinese ? '统一 AI 网关' : 'Unified AI gateway' }}</p>
          <h1 class="landing-title">{{ siteName }}</h1>
          <p class="mt-5 max-w-lg whitespace-pre-wrap text-lg leading-relaxed text-gray-600 [overflow-wrap:anywhere] dark:text-dark-300">{{ siteSubtitle }}</p>
          <div class="mt-8 flex flex-wrap items-center gap-3">
            <a v-if="isAdmin && isAuthenticated" :href="entryPath" class="btn btn-primary px-5 py-3">
              {{ t('home.goToDashboard') }} <Icon name="arrowRight" size="sm" />
            </a>
            <RouterLink v-else :to="entryPath" class="btn btn-primary px-5 py-3">
              {{ isAuthenticated ? t('home.goToDashboard') : t('home.getStarted') }} <Icon name="arrowRight" size="sm" />
            </RouterLink>
            <RouterLink v-if="!compactHomeEnabled" to="/key-usage" class="btn btn-ghost px-4 py-3">
              {{ t('nav.keyUsage') }}
            </RouterLink>
          </div>
        </div>

        <div v-if="!compactHomeEnabled" class="terminal-container cshell-network">
          <div class="relative flex items-center justify-between gap-3 border-b border-white/15 pb-4">
            <span class="font-mono text-xs font-semibold tracking-widest">{{ isChinese ? '网关概览' : 'GATEWAY OVERVIEW' }}</span>
            <Icon name="server" size="sm" class="text-primary-200" />
          </div>
          <div class="relative grid gap-3 py-7 sm:grid-cols-2" aria-label="API endpoints">
            <div class="cshell-endpoint"><span>01</span><code>/v1/messages</code></div>
            <div class="cshell-endpoint"><span>02</span><code>/v1/chat/completions</code></div>
          </div>
          <p class="relative max-w-xs text-sm leading-relaxed text-primary-100/85">{{ t('home.features.unifiedGatewayDesc') }}</p>
        </div>
      </section>

      <template v-if="!compactHomeEnabled">
        <section class="landing-features" :aria-label="isChinese ? '平台功能' : 'Platform features'">
          <article v-for="(feature, i) in featureList" :key="feature.label" class="landing-feature">
            <div class="mb-5 flex items-center justify-between">
              <Icon :name="feature.icon" size="md" class="text-primary-700 dark:text-primary-300" />
              <span class="font-mono text-xs text-gray-500 dark:text-dark-400">0{{ i + 1 }}</span>
            </div>
            <h2 class="text-lg font-bold tracking-tight">{{ t(`home.tags.${feature.tag}`) }}</h2>
            <p class="mt-2 text-sm leading-relaxed text-gray-600 dark:text-dark-300">{{ t(`home.features.${feature.label}Desc`) }}</p>
          </article>
        </section>
        <section class="landing-providers">
          <div>
            <h2 class="text-xl font-bold tracking-tight">{{ t('home.providers.title') }}</h2>
            <p class="mt-1 text-sm text-gray-600 dark:text-dark-300">{{ t('home.providers.description') }}</p>
          </div>
          <ul class="flex flex-wrap gap-2" role="list">
            <li v-for="provider in providerList" :key="provider" class="landing-provider">
              {{ provider === 'gpt' ? 'GPT' : t(`home.providers.${provider}`) }}
            </li>
            <li class="landing-provider text-gray-500 dark:text-dark-400">{{ t('home.providers.more') }} · {{ t('home.providers.soon') }}</li>
          </ul>
        </section>
      </template>
    </main>

    <footer class="landing-frame flex flex-wrap items-center justify-between gap-4 border-t py-6 text-sm text-gray-600 dark:text-dark-300">
      <p>&copy; {{ currentYear }} {{ siteName }}<span v-if="!compactHomeEnabled">. {{ t('home.footer.allRightsReserved') }}</span></p>
      <div v-if="!compactHomeEnabled" class="flex gap-5">
        <a v-if="docUrl" :href="docUrl" target="_blank" rel="noopener noreferrer" class="hover:underline">{{ t('home.docs') }}</a>
        <a :href="githubUrl" target="_blank" rel="noopener noreferrer" class="hover:underline">GitHub</a>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore, useAppStore } from '@/stores'
import LocaleSwitcher from '@/components/common/LocaleSwitcher.vue'
import Icon from '@/components/icons/Icon.vue'
import { defaultLogo } from '@/utils/branding'
import { sanitizeUrl } from '@/utils/url'
import { FeatureFlags, isFeatureFlagEnabled } from '@/utils/featureFlags'

const { t, locale } = useI18n()
const isChinese = computed(() => locale?.value !== 'en')

const authStore = useAuthStore()
const appStore = useAppStore()

// Site settings - directly from appStore (already initialized from injected config)
const siteName = computed(() => appStore.cachedPublicSettings?.site_name || appStore.siteName || 'Sub2API')
const siteLogo = computed(() => sanitizeUrl(appStore.cachedPublicSettings?.site_logo || appStore.siteLogo || '', { allowRelative: true, allowDataUrl: true }))
const siteSubtitle = computed(() => appStore.cachedPublicSettings?.site_subtitle || 'AI API Gateway Platform')
const docUrl = computed(() => sanitizeUrl(appStore.cachedPublicSettings?.doc_url || appStore.docUrl || ''))
const homeContent = computed(() => appStore.cachedPublicSettings?.home_content || '')
const hasHomeContent = computed(() => homeContent.value.trim().length > 0)
const compactHomeEnabled = computed(() => appStore.cachedPublicSettings?.compact_home_enabled === true)
const modelPlazaEnabled = computed(() => isFeatureFlagEnabled(FeatureFlags.modelPlaza))

// Check if homeContent is a URL (for iframe display)
const isHomeContentUrl = computed(() => {
  const content = homeContent.value.trim()
  return content.startsWith('http://') || content.startsWith('https://')
})

// Theme
const isDark = ref(document.documentElement.classList.contains('dark'))

// GitHub URL
const githubUrl = 'https://github.com/Wei-Shaw/sub2api'

// Auth state
const isAuthenticated = computed(() => authStore.isAuthenticated)
const modelPlazaRequiresAuth = computed(
  () => appStore.cachedPublicSettings?.model_plaza_require_auth === true,
)
const showModelPlazaEntry = computed(
  () => modelPlazaEnabled.value && (isAuthenticated.value || !modelPlazaRequiresAuth.value),
)
const isAdmin = computed(() => authStore.isAdmin)
const dashboardPath = computed(() => isAdmin.value ? '/admin/dashboard' : '/dashboard')
const entryPath = computed(() => isAuthenticated.value ? dashboardPath.value : '/login')
const featureList = [
  { icon: 'server', label: 'unifiedGateway', tag: 'subscriptionToApi' },
  { icon: 'shield', label: 'multiAccount', tag: 'stickySession' },
  { icon: 'chart', label: 'balanceQuota', tag: 'realtimeBilling' },
] as const
const providerList = ['claude', 'gpt', 'gemini', 'antigravity'] as const

// Current year for footer
const currentYear = computed(() => new Date().getFullYear())

// Toggle theme
function toggleTheme() {
  isDark.value = !isDark.value
  document.documentElement.classList.toggle('dark', isDark.value)
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
}

// Initialize theme
function initTheme() {
  const savedTheme = localStorage.getItem('theme')
  if (
    savedTheme === 'dark' ||
    (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)
  ) {
    isDark.value = true
    document.documentElement.classList.add('dark')
  }
}

onMounted(() => {
  initTheme()

  // Check auth state
  authStore.checkAuth()

  // Ensure public settings are loaded (will use cache if already loaded from injected config)
  if (!appStore.publicSettingsLoaded) {
    appStore.fetchPublicSettings()
  }
})
</script>

