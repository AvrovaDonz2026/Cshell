<template>
  <div class="cshell-auth">
    <aside class="cshell-auth-brand cshell-network">
      <div class="relative flex items-center gap-3">
        <img :src="siteLogo || defaultLogo" alt="" class="h-10 w-10 rounded-xl object-contain" />
        <span class="min-w-0 break-words text-xl font-semibold tracking-tight">{{ siteName }}</span>
      </div>
      <div class="relative hidden lg:block">
        <p class="mb-4 text-sm font-semibold text-primary-200">{{ t('home.features.unifiedGateway') }}</p>
        <p class="max-w-md whitespace-pre-wrap break-words text-4xl font-semibold tracking-tight xl:text-5xl">{{ siteSubtitle }}</p>
      </div>
      <span class="relative hidden text-sm text-primary-100/75 lg:inline">&copy; {{ currentYear }} {{ siteName }}</span>
    </aside>

    <main class="cshell-auth-main">
      <div class="flex items-center justify-end gap-2">
        <LocaleSwitcher />
        <button type="button" class="btn btn-ghost btn-icon"
          :aria-label="isDark ? t('home.switchToLight') : t('home.switchToDark')" @click="toggleTheme">
          <Icon :name="isDark ? 'sun' : 'moon'" size="sm" />
        </button>
      </div>
      <div class="cshell-auth-flow">
        <div class="cshell-auth-card"><slot /></div>
        <div v-if="$slots.footer" class="mt-6 text-center text-sm"><slot name="footer" /></div>
      </div>
      <p class="text-center text-xs text-gray-600 dark:text-dark-300 lg:hidden">&copy; {{ currentYear }} {{ siteName }}</p>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { defaultLogo } from '@/utils/branding'
import { useI18n } from 'vue-i18n'
import LocaleSwitcher from '@/components/common/LocaleSwitcher.vue'
import Icon from '@/components/icons/Icon.vue'
import { useAppStore } from '@/stores'
import { sanitizeUrl } from '@/utils/url'

const appStore = useAppStore()
const { t } = useI18n()
const isDark = ref(document.documentElement.classList.contains('dark'))

function toggleTheme() {
  isDark.value = !isDark.value
  document.documentElement.classList.toggle('dark', isDark.value)
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
}

const siteName = computed(() => appStore.siteName || 'Sub2API')
const siteLogo = computed(() => sanitizeUrl(appStore.siteLogo || '', { allowRelative: true, allowDataUrl: true }))
const siteSubtitle = computed(() => appStore.cachedPublicSettings?.site_subtitle || 'Subscription to API Conversion Platform')

const currentYear = computed(() => new Date().getFullYear())

onMounted(() => {
  appStore.fetchPublicSettings()
})
</script>

