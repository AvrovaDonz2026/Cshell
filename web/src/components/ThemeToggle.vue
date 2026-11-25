<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import Button from './primitives/Button.vue'

const props = withDefaults(defineProps<{ variant?: 'default' | 'header' }>(), { variant: 'default' })

const theme = useThemeStore()
const { t } = useI18n()
</script>

<template>
  <Button
    class="theme-toggle__button"
    :class="{ 'theme-toggle__button--header': props.variant === 'header' }"
    variant="secondary"
    :aria-label="t('shell.theme.toggle')"
    :aria-pressed="theme.isDark"
    @click="theme.toggle()"
  >
    <template v-if="props.variant === 'header'">
      <svg v-if="theme.isDark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></svg>
      <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z" /></svg>
    </template>
    <template v-else>{{ theme.isDark ? t('shell.theme.light') : t('shell.theme.dark') }}</template>
  </Button>
</template>

<style scoped>
.theme-toggle__button--header { width: 44px; min-width: 44px; height: 44px; padding: 0; }
.theme-toggle__button--header :deep(svg) { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
</style>
