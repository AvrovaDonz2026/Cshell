<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import Button from './primitives/Button.vue'

const theme = useThemeStore()
const { t } = useI18n()
</script>

<template>
  <Button
    class="theme-toggle__button"
    variant="secondary"
    block
    :aria-label="t('shell.theme.toggle')"
    :aria-pressed="theme.isDark"
    @click="theme.toggle()"
  >
    {{ theme.isDark ? t('shell.theme.light') : t('shell.theme.dark') }}
  </Button>
</template>
