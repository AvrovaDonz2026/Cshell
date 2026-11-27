import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { apiRequest } from '@/api/client'
import type { PublicSettings } from '@/api/types'

export type CaptchaProvider = 'turnstile' | 'mock' | 'unavailable'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<PublicSettings | null>(null)
  const loaded = ref(false)
  const loading = ref(false)
  const failed = ref(false)
  const error = ref<string | null>(null)

  /** True only after a successful public settings fetch. */
  const settingsReady = computed(
    () => loaded.value && !failed.value && settings.value !== null,
  )
  const settingsFailed = computed(() => failed.value)

  // Gate flags fail closed: they stay false until settings load successfully.
  const registrationEnabled = computed(
    () => settingsReady.value && settings.value?.registration_enabled === true,
  )
  const mockCaptcha = computed(() => { return ['mock'].includes(String(settings.value?.captcha_provider)) })
  const captchaRequired = computed(
    () => settingsReady.value && (settings.value?.turnstile_enabled === true || settings.value?.tencent_captcha_enabled === true || settings.value?.aliyun_captcha_enabled === true || mockCaptcha.value),
  )
  const emailVerifyRequired = computed(
    () => settingsReady.value && settings.value?.email_verify_enabled === true,
  )
  const paymentEnabled = computed(
    () => settingsReady.value && settings.value?.payment_enabled === true,
  )
  const subscriptionEnabled = computed(
    () => settingsReady.value && settings.value?.subscription_enabled === true,
  )

  const captchaProvider = computed<CaptchaProvider | undefined>(() => {
    const current = settings.value
    if (!current) return undefined
    if (mockCaptcha.value) return 'mock'
    if (current.tencent_captcha_enabled || current.aliyun_captcha_enabled) return 'unavailable'
    if (!current.turnstile_enabled) return undefined
    return current.turnstile_site_key ? 'turnstile' : 'unavailable'
  })

  async function fetchSettings(force: boolean): Promise<void> {
    if (loading.value) return
    if (!force && loaded.value && !failed.value) return
    loading.value = true
    error.value = null
    try {
      settings.value = await apiRequest<PublicSettings>('/settings/public', {
        auth: false,
        skipRefresh: true,
      })
      loaded.value = true
      failed.value = false
    } catch (err) {
      loaded.value = false
      failed.value = true
      error.value = err instanceof Error ? err.message : 'Failed to load settings'
    } finally {
      loading.value = false
    }
  }

  /** Idempotent: no-op once loaded, retried after a failure. */
  async function loadPublic(): Promise<void> {
    await fetchSettings(false)
  }

  /** Force a fresh fetch, including after a successful load. */
  async function reload(): Promise<void> {
    await fetchSettings(true)
  }

  return {
    settings,
    loaded,
    loading,
    failed,
    error,
    settingsReady,
    settingsFailed,
    registrationEnabled,
    captchaRequired,
    emailVerifyRequired,
    paymentEnabled,
    subscriptionEnabled,
    captchaProvider,
    loadPublic,
    reload,
  }
})
