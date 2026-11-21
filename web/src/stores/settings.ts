import { ref } from 'vue'
import { defineStore } from 'pinia'
import { apiRequest } from '@/api/client'
import type { PublicSettings } from '@/api/types'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<PublicSettings | null>(null)
  const loaded = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function loadPublic(): Promise<void> {
    if (loading.value) return
    loading.value = true
    error.value = null
    try {
      settings.value = await apiRequest<PublicSettings>('/settings/public', {
        auth: false,
        skipRefresh: true,
      })
      loaded.value = true
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load settings'
    } finally {
      loading.value = false
    }
  }

  return {
    settings,
    loaded,
    loading,
    error,
    loadPublic,
  }
})
