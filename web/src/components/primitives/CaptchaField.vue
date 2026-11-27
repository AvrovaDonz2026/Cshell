<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@/components/primitives/Button.vue'
import type { CaptchaProvider } from '@/stores/settings'

const props = withDefaults(
  defineProps<{
    provider: CaptchaProvider
    resetKey?: number
    siteKey?: string
    error?: string
  }>(),
  {
    resetKey: 0,
    siteKey: '',
    error: '',
  },
)

const emit = defineEmits<{
  (event: 'update:token', token: string): void
}>()

const { t } = useI18n()

const container = ref<HTMLElement | null>(null)
const loadFailed = ref(false)
const mockVerified = ref(false)
let widgetId: string | null = null
let turnstileApi: TurnstileApi | null = null

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string
      callback: (token: string) => void
      'error-callback'?: () => void
      'expired-callback'?: () => void
    },
  ) => string | undefined
  remove: (widgetId: string) => void
}

const TURNSTILE_SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let scriptPromise: Promise<TurnstileApi> | null = null

function readTurnstile(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile
}

/**
 * Loads the Turnstile script at most once per browser session and resolves with
 * the global API. Rejects (and clears the cache) when the script cannot load.
 */
function loadTurnstile(): Promise<TurnstileApi> {
  const existingApi = readTurnstile()
  if (existingApi) return Promise.resolve(existingApi)
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${TURNSTILE_SCRIPT_SRC}"]`,
    )
    const script = existingScript ?? document.createElement('script')

    const onLoad = (): void => {
      const api = readTurnstile()
      if (api) resolve(api)
      else reject(new Error('Turnstile API unavailable'))
    }
    const onError = (): void => {
      scriptPromise = null
      reject(new Error('Turnstile script failed to load'))
    }

    script.addEventListener('load', onLoad, { once: true })
    script.addEventListener('error', onError, { once: true })

    if (!existingScript) {
      script.src = TURNSTILE_SCRIPT_SRC
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
  })

  return scriptPromise
}

function cleanupWidget(): void {
  if (widgetId && turnstileApi) {
    try {
      turnstileApi.remove(widgetId)
    } catch {
      // Widget may already be torn down with the container.
    }
  }
  widgetId = null
}

async function renderTurnstile(): Promise<void> {
  cleanupWidget()
  loadFailed.value = false
  emit('update:token', '')
  if (props.provider !== 'turnstile' || !props.siteKey) return

  try {
    const api = await loadTurnstile()
    if (props.provider !== 'turnstile' || !container.value) return
    turnstileApi = api
    widgetId =
      api.render(container.value, {
        sitekey: props.siteKey,
        callback: (token: string) => emit('update:token', token),
        'error-callback': () => emit('update:token', ''),
        'expired-callback': () => emit('update:token', ''),
      }) ?? null
  } catch {
    loadFailed.value = true
    emit('update:token', '')
  }
}

function completeMock(): void {
  mockVerified.value = true
  emit('update:token', 'LOCAL-OK')
}

onMounted(() => {
  if (props.provider === 'turnstile') void renderTurnstile()
})

watch(
  () => [props.provider, props.siteKey, props.resetKey] as const,
  () => {
    mockVerified.value = false
    emit('update:token', '')
    if (props.provider === 'turnstile') void renderTurnstile()
    else cleanupWidget()
  },
)

onBeforeUnmount(() => {
  cleanupWidget()
})
</script>

<template>
  <div class="captcha-field">
    <template v-if="provider === 'turnstile'">
      <div ref="container" class="captcha-field__widget" />
      <p v-if="loadFailed" class="captcha-field__notice" role="alert">
        {{ t('auth.captchaLoadFailed') }}
      </p>
    </template>

    <template v-else-if="provider === 'mock'">
      <Button
        v-if="!mockVerified"
        type="button"
        variant="secondary"
        block
        @click="completeMock"
      >
        {{ t('auth.captchaMockButton') }}
      </Button>
      <p v-else class="captcha-field__verified" role="status">
        {{ t('auth.captchaVerified') }}
      </p>
    </template>

    <p v-else class="captcha-field__notice" role="status">
      {{ t('auth.captchaUnavailable') }}
    </p>

    <p v-if="error" class="captcha-field__error" role="alert">
      {{ error }}
    </p>
  </div>
</template>

<style scoped>
.captcha-field {
  display: grid;
  gap: 0.4rem;
}

.captcha-field__widget {
  min-height: 2rem;
}

.captcha-field__notice {
  margin: 0;
  color: var(--cshell-text-muted);
}

.captcha-field__verified {
  margin: 0;
  color: var(--cshell-text-muted);
}

.captcha-field__error {
  margin: 0;
  color: var(--cshell-danger);
}
</style>
