<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { setLocale } from '@/i18n'
import Select from './primitives/Select.vue'

const { t, locale } = useI18n()

const options = computed(() => [
  { value: 'en', label: t('shell.locale.en') },
  { value: 'zh', label: t('shell.locale.zh') },
])

const model = computed({
  get: () => locale.value,
  set: (value: string) => {
    if (value === 'en' || value === 'zh') setLocale(value)
  },
})
</script>

<template>
  <label class="locale-switcher">
    <span class="visually-hidden">{{ t('shell.locale.label') }}</span>
    <Select v-model="model" :options="options" />
  </label>
</template>

<style scoped>
.locale-switcher {
  display: inline-block;
  min-width: 7.5rem;
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
