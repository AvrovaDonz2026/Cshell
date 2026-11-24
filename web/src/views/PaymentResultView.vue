<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { resolvePublicOrder, verifyPublicOrder } from '@/api/billing'
import type { PublicOrderStatus } from '@/api/types'
import { ApiError } from '@/api/types'
import Button from '@/components/primitives/Button.vue'
import {
  createGenerationGuard,
  isTerminalStatus,
  normalizeOrderStatus,
  type NormalizedOrderStatus,
} from '@/lib/payment'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'

const { t } = useI18n()
const route = useRoute()
const auth = useAuthStore()
const theme = useThemeStore()

const POLL_INTERVAL_MS = 3000
const POLL_BUDGET_MS = 30_000

const status = ref<PublicOrderStatus | null>(null)
const error = ref('')
const loading = ref(false)
const polling = ref(false)
const pollStartedAt = ref(0)
const pollBudgetExhausted = ref(false)

let pollTimer: ReturnType<typeof setTimeout> | null = null
let controller: AbortController | null = null
const guard = createGenerationGuard()
let disposed = false

const outTradeNo = computed(() =>
  typeof route.query.out_trade_no === 'string' ? route.query.out_trade_no : '',
)
const resumeToken = computed(() =>
  typeof route.query.resume_token === 'string' ? route.query.resume_token : '',
)
const hasIdentifiers = computed(() => Boolean(outTradeNo.value || resumeToken.value))

const normalizedStatus = computed<NormalizedOrderStatus>(() =>
  normalizeOrderStatus(status.value?.status, status.value?.paid),
)

const statusLabel = computed(() => {
  if (!status.value) return '—'
  switch (normalizedStatus.value) {
    case 'paid':
      return t('paymentResult.paid')
    case 'pending':
      return t('paymentResult.pending')
    case 'expired':
      return t('paymentResult.expired')
    case 'failed':
      return t('paymentResult.failed')
    case 'cancelled':
      return t('paymentResult.cancelled')
    case 'refunded':
      return t('paymentResult.refunded')
    default:
      return status.value.status || t('paymentResult.pending')
  }
})

const isTerminal = computed(() => isTerminalStatus(normalizedStatus.value))

const amountText = computed(() => {
  const value = status.value?.pay_amount ?? status.value?.amount
  if (value == null) return ''
  const currency = status.value?.currency
  return currency ? `${value} ${currency}` : String(value)
})

const canPoll = computed(
  () => hasIdentifiers.value && !isTerminal.value && !pollBudgetExhausted.value,
)

/** Verify by trade no, falling back to resolve when the order is unknown. */
async function fetchStatus(signal: AbortSignal): Promise<PublicOrderStatus> {
  if (outTradeNo.value) {
    try {
      return await verifyPublicOrder({ out_trade_no: outTradeNo.value }, { signal })
    } catch (err) {
      const notFound =
        err instanceof ApiError && (err.status === 404 || err.code === 404)
      if (notFound && resumeToken.value) {
        return resolvePublicOrder({ resume_token: resumeToken.value }, { signal })
      }
      throw err
    }
  }
  return resolvePublicOrder({ resume_token: resumeToken.value }, { signal })
}

function clearPollTimer(): void {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

function abortInFlight(): void {
  controller?.abort()
  controller = null
}

function stopPolling(): void {
  polling.value = false
  clearPollTimer()
  abortInFlight()
}

async function refresh(manual = false): Promise<void> {
  clearPollTimer()
  stopPolling()
  if (!hasIdentifiers.value) {
    status.value = null
    error.value = t('paymentResult.missingParams')
    return
  }
  if (manual) {
    pollBudgetExhausted.value = false
    pollStartedAt.value = Date.now()
  } else if (!pollStartedAt.value) {
    pollStartedAt.value = Date.now()
  }

  const generation = guard.next()
  abortInFlight()
  const local = new AbortController()
  controller = local
  loading.value = true
  error.value = ''

  try {
    const next = await fetchStatus(local.signal)
    if (!guard.isCurrent(generation) || disposed) return
    status.value = next
  } catch (err) {
    if (!guard.isCurrent(generation) || disposed) return
    if (local.signal.aborted) return
    error.value =
      err instanceof ApiError || err instanceof Error
        ? err.message
        : t('common.error')
  } finally {
    if (guard.isCurrent(generation) && !disposed) {
      loading.value = false
      controller = null
      maybeScheduleNextPoll()
    }
  }
}

/** Serialized polling: the next request is only scheduled after this one settles. */
function maybeScheduleNextPoll(): void {
  clearPollTimer()
  if (disposed || !hasIdentifiers.value) {
    polling.value = false
    return
  }
  if (isTerminal.value || pollBudgetExhausted.value) {
    polling.value = false
    return
  }
  if (Date.now() - pollStartedAt.value >= POLL_BUDGET_MS) {
    pollBudgetExhausted.value = true
    polling.value = false
    error.value = ''
    return
  }
  polling.value = true
  pollTimer = setTimeout(() => {
    pollTimer = null
    void refresh()
  }, POLL_INTERVAL_MS)
}

function resetForNewIdentifiers(): void {
  guard.next()
  stopPolling()
  status.value = null
  error.value = ''
  loading.value = false
  pollStartedAt.value = 0
  pollBudgetExhausted.value = false
}

watch(
  () => [route.query.out_trade_no, route.query.resume_token],
  () => {
    resetForNewIdentifiers()
    if (hasIdentifiers.value) void refresh()
    else error.value = t('paymentResult.missingParams')
  },
)

onMounted(() => {
  if (hasIdentifiers.value) void refresh()
  else error.value = t('paymentResult.missingParams')
})

onBeforeUnmount(() => {
  disposed = true
  guard.next()
  stopPolling()
})

const ordersLink = computed(() =>
  auth.isAuthenticated ? { name: 'orders' } : null
)
</script>

<template>
  <div class="cshell-user-workspace result-page" :data-theme="theme.mode">
    <div class="card">
      <h1>{{ t('paymentResult.title') }}</h1>
      <p class="meta">
        <span>{{ t('paymentResult.tradeNo') }}:</span>
        {{ status?.out_trade_no || outTradeNo || '—' }}
      </p>
      <p class="status" role="status">
        {{ loading && !status ? t('common.loading') : statusLabel }}
      </p>
      <p v-if="amountText" class="meta">
        {{ t('paymentResult.amount') }}: {{ amountText }}
      </p>
      <p v-if="status?.expires_at" class="meta">
        {{ t('paymentResult.expires') }}: {{ status.expires_at }}
      </p>
      <p v-if="error" class="error" role="alert">
        {{ error }}
      </p>
      <p v-if="pollBudgetExhausted && !isTerminal" class="hint" role="status">
        {{ t('paymentResult.pollingStopped') }}
      </p>
      <div class="actions">
        <Button variant="secondary" :disabled="loading" @click="refresh(true)">
          {{ t('paymentResult.refresh') }}
        </Button>
        <RouterLink
          v-if="ordersLink"
          class="link"
          :to="ordersLink"
        >
          {{ t('paymentResult.toOrders') }}
        </RouterLink>
        <RouterLink
          v-else
          class="link"
          :to="{ name: 'login' }"
        >
          {{ t('auth.toLogin') }}
        </RouterLink>
      </div>
      <p v-if="canPoll" class="hint">
        {{ t('paymentResult.pollingHint') }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.result-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1.5rem;
  background: var(--cshell-bg);
  color: var(--cshell-text);
}

.card {
  width: min(100%, 28rem);
  display: grid;
  gap: 0.75rem;
  padding: 1.5rem;
  border-radius: var(--cshell-radius-window);
  background: var(--cshell-surface);
  border: 1px solid var(--cshell-border);
  box-shadow: var(--cshell-shadow);
}

.card h1 {
  margin: 0;
  font-size: 1.4rem;
}

.status {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 700;
}

.meta,
.hint {
  margin: 0;
  color: var(--cshell-text-muted);
  font-size: 0.92rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
}

.link {
  color: var(--cshell-accent);
  text-decoration: none;
}

.error {
  margin: 0;
  color: var(--cshell-danger);
}
</style>
