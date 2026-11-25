<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { availableLocales, setLocale } from '@/i18n'
import Select from './primitives/Select.vue'

const { t, locale } = useI18n()
const props = withDefaults(defineProps<{ variant?: 'default' | 'header' }>(), { variant: 'default' })

const localeLabels: Record<(typeof availableLocales)[number], string> = {
  en: 'shell.locale.en',
  zh: 'shell.locale.zh',
}

const options = computed(() =>
  availableLocales.map((value) => ({
    value,
    label: t(localeLabels[value]),
  })),
)

const model = computed({
  get: () => locale.value,
  set: (value: string) => {
    if (value === 'en' || value === 'zh') setLocale(value)
  },
})
</script>

<template>
  <label class="locale-switcher" :class="{ 'locale-switcher--header': props.variant === 'header' }">
    <span class="visually-hidden">{{ t('shell.locale.label') }}</span>
    <Select v-model="model" class="locale-switcher__select" :class="{ 'locale-switcher__select--header': props.variant === 'header' }" :options="options" />
  </label>
</template>

<style scoped>
.locale-switcher {
  display: block;
  min-width: 0;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>

<style scoped>
.locale-switcher--header { width: auto; }
.locale-switcher__select--header { width: auto; min-width: 72px; }
.locale-switcher--header :deep(.cshell-select__trigger) { min-height: 44px; padding-inline: 0.65rem; text-align: center; }
.locale-switcher--header :deep(.cshell-select__option) { text-align: left; }
</style>
