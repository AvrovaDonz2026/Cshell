<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import Button from './primitives/Button.vue'

const theme = useThemeStore()
const { t } = useI18n()
</script>

<template>
  <Button
    variant="ghost"
    :aria-label="t('shell.theme.toggle')"
    @click="theme.toggle()"
  >
    {{ theme.isDark ? t('shell.theme.light') : t('shell.theme.dark') }}
  </Button>
</template>
