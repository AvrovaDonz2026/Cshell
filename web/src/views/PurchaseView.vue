<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  cancelOrder,
  createPaymentOrder,
  fetchCheckoutInfo,
  fetchOrder,
  fetchPaymentConfig,
  fetchPaymentLimits,
  fetchPaymentPlans,
  isSafeRedirectUrl,
  resolvePublicOrder,
  verifyPublicOrder,
} from '@/api/billing'
import type {
  CheckoutInfo,
  CreateOrderResult,
  PaymentConfig,
  PaymentLimits,
  PaymentMethodInfo,
  PaymentPlan,
  PublicOrderStatus,
} from '@/api/types'
import { ApiError } from '@/api/types'
import Button from '@/components/primitives/Button.vue'
import Input from '@/components/primitives/Input.vue'
import Select from '@/components/primitives/Select.vue'
import {
  formatCountdown,
  isTerminalStatus,
  normalizeOrderStatus,
  secondsRemaining,
  validatePaymentAmount,
  type NormalizedOrderStatus,
  type PaymentAmountError,
} from '@/lib/payment'
import { classifyQrSource, resolveQrImageSrc } from '@/lib/qr'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'

const { t } = useI18n()
const router = useRouter()
const settings = useSettingsStore()
const auth = useAuthStore()

type Tab = 'subscription' | 'recharge'

interface PendingOrder {
  orderId?: number
  outTradeNo: string
  resumeToken?: string
  expiresAt?: string
  resultType: string
  amount: number
  payableAmount?: number
  currency?: string
  payUrl?: string
  paymentType: string
  orderType: string
  status: NormalizedOrderStatus
  qrRaw?: string
  qrImageSrc?: string
}

const tab = ref<Tab>('subscription')
const checkout = ref<CheckoutInfo | null>(null)
const limits = ref<PaymentLimits | null>(null)
const config = ref<PaymentConfig | null>(null)
const plans = ref<PaymentPlan[]>([])
const loading = ref(true)
const checkoutFailed = ref(false)
const limitsFailed = ref(false)
const checkoutError = ref('')
const limitsError = ref('')
const configError = ref('')
const configFailed = ref(false)
const plansFailed = ref(false)

const selectedPlan = ref<PaymentPlan | null>(null)
const rechargeAmount = ref('')
const paymentType = ref('')
const confirming = ref(false)
const confirmError = ref('')

const pendingOrder = ref<PendingOrder | null>(null)
const recoveryKey = 'cshell_pending_order'
try {
  const saved = JSON.parse(sessionStorage.getItem(recoveryKey) || 'null')
  if (saved?.userId === auth.user?.id && Number.isSafeInteger(saved?.orderId) && saved.orderId > 0) {
    pendingOrder.value = { orderId: saved.orderId, outTradeNo: '', resultType: 'order_created', amount: 0, paymentType: '', orderType: '', status: 'unknown' }
  }
} catch { sessionStorage.removeItem(recoveryKey) }
watch(pendingOrder, (order) => {
  if (order?.orderId && !isTerminalStatus(order.status)) sessionStorage.setItem(recoveryKey, JSON.stringify({ userId: auth.user?.id, orderId: order.orderId }))
  else sessionStorage.removeItem(recoveryKey)
}, { deep: true })
const pendingError = ref('')
const pendingLoading = ref(false)
const pendingNow = ref(Date.now())
let pendingTicker: ReturnType<typeof setInterval> | null = null
let pendingController: AbortController | null = null
let qrToken = 0

const visiblePlans = computed(() =>
  plans.value.filter((p) => p.for_sale !== false),
)

/* ----------------------------------------------------------------- metadata */

const methodEntries = computed(() =>
  Object.entries(checkout.value?.methods ?? limits.value?.methods ?? {}).map(
    ([key, info]) => ({
      key,
      info: info ?? {},
      label: info?.display_name || key,
      available: info?.available !== false,
    }),
  ),
)

/** Select only offers usable methods; unavailable ones are listed separately. */
const methodOptions = computed(() =>
  methodEntries.value
    .filter((entry) => entry.available)
    .map((entry) => ({ value: entry.key, label: entry.label })),
)

const availableMethodOptions = computed(() => methodOptions.value)

const unavailableMethods = computed(() =>
  methodEntries.value.filter((entry) => !entry.available),
)

const selectedMethod = computed<PaymentMethodInfo | null>(
  () => methodEntries.value.find((entry) => entry.key === paymentType.value)?.info ?? null,
)

const globalMin = computed(() => {
  const value = limits.value?.global_min ?? limits.value?.min_amount
  return typeof value === 'number' && Number.isFinite(value) ? value : null
})

const globalMax = computed(() => {
  const value = limits.value?.global_max ?? limits.value?.max_amount
  return typeof value === 'number' && Number.isFinite(value) ? value : null
})

const metadataReady = computed(
  () =>
    !checkoutFailed.value &&
    !limitsFailed.value &&
    checkout.value !== null &&
    limits.value !== null &&
    globalMin.value !== null &&
    globalMax.value !== null,
)

const requiredBanners = computed(() => {
  const list: string[] = []
  if (checkoutFailed.value) {
    list.push(
      checkoutError.value
        ? `${t('purchase.checkoutUnavailable')} (${checkoutError.value})`
        : t('purchase.checkoutUnavailable'),
    )
  }
  if (limitsFailed.value) {
    list.push(
      limitsError.value
        ? `${t('purchase.limitsUnavailable')} (${limitsError.value})`
        : t('purchase.limitsUnavailable'),
    )
  } else if (limits.value && (globalMin.value === null || globalMax.value === null)) {
    list.push(t('purchase.limitsIncomplete'))
  }
  if (metadataReady.value && !availableMethodOptions.value.length) {
    list.push(t('purchase.noMethods'))
  }
  return list
})

const optionalBanners = computed(() => {
  const list: string[] = []
  if (configFailed.value) {
    list.push(
      configError.value
        ? `${t('purchase.configUnavailable')} (${configError.value})`
        : t('purchase.configUnavailable'),
    )
  }
  if (plansFailed.value) list.push(t('purchase.plansUnavailable'))
  return list
})

const showSubscribeTab = computed(() => settings.subscriptionEnabled)
const showRechargeTab = computed(() => settings.paymentEnabled)
const balanceDisabled = computed(
  () =>
    checkout.value?.balance_disabled === true ||
    config.value?.balance_disabled === true,
)
const rechargeDisabled = computed(
  () => !settings.paymentEnabled || balanceDisabled.value,
)

/* ------------------------------------------------------------- amount check */

const methodSummary = (info: PaymentMethodInfo): string => {
  const parts: string[] = []
  if (info.currency) parts.push(info.currency)
  if (typeof info.single_min === 'number') {
    parts.push(`${t('purchase.min')} ${info.single_min}`)
  }
  if (typeof info.single_max === 'number') {
    parts.push(`${t('purchase.max')} ${info.single_max}`)
  }
  if (typeof info.daily_remaining === 'number') {
    parts.push(`${t('purchase.dailyRemaining')} ${info.daily_remaining}`)
  }
  return parts.join(' · ')
}

const amountInput = computed<unknown>(() => {
  if (tab.value === 'subscription' && selectedPlan.value) return selectedPlan.value.price
  return rechargeAmount.value
})

const limitInput = computed(() => ({
  globalMin: globalMin.value,
  globalMax: globalMax.value,
  singleMin: selectedMethod.value?.single_min ?? null,
  singleMax: selectedMethod.value?.single_max ?? null,
  dailyRemaining: selectedMethod.value?.daily_remaining ?? null,
}))

const validation = computed(() => validatePaymentAmount(amountInput.value, limitInput.value))

const amountErrorKey: Record<PaymentAmountError, string> = {
  'not-a-number': 'purchase.invalidAmount',
  'not-finite': 'purchase.invalidAmount',
  'non-positive': 'purchase.amountPositive',
  'too-many-decimals': 'purchase.amountDecimals',
  'below-minimum': 'purchase.amountBelowMin',
  'above-maximum': 'purchase.amountAboveMax',
  'above-daily-remaining': 'purchase.amountAboveDaily',
}

const validationMessage = computed(() => {
  if (validation.value.ok) return ''
  const error = validation.value.error
  if (!error) return t('purchase.invalidAmount')
  const params: Record<string, number> = {}
  if (validation.value.max !== null) params.max = validation.value.max
  if (validation.value.min !== null) params.min = validation.value.min
  return t(amountErrorKey[error], params)
})

/** Amount to display in the confirm panel (valid value or raw input). */
const previewAmount = computed(() => {
  const amount = confirmAmount()
  return Number.isFinite(amount) ? amount : '\u2014'
})

function confirmAmount(): number {
  const raw = amountInput.value
  return typeof raw === 'number' ? raw : Number(raw)
}

const canConfirm = computed(
  () =>
    metadataReady.value &&
    availableMethodOptions.value.length > 0 &&
    !(tab.value === 'recharge' && rechargeDisabled.value),
)

/* ------------------------------------------------------------------- pending */

const pendingStatus = computed<NormalizedOrderStatus>(
  () => pendingOrder.value?.status ?? 'pending',
)

const pendingTerminal = computed(() => isTerminalStatus(pendingStatus.value))

const pendingRemaining = computed(() =>
  secondsRemaining(pendingOrder.value?.expiresAt, pendingNow.value),
)

const pendingExpiredByClock = computed(
  () => pendingRemaining.value !== null && pendingRemaining.value <= 0,
)

const pendingCountdown = computed(() => {
  if (pendingRemaining.value === null) return ''
  return formatCountdown(pendingRemaining.value)
})

const canStartNewOrder = computed(
  () => pendingTerminal.value || pendingExpiredByClock.value,
)

const pendingAmountText = computed(() => {
  const order = pendingOrder.value
  if (!order) return ''
  const value = order.payableAmount ?? order.amount
  return order.currency ? `${value} ${order.currency}` : String(value)
})

const pendingMethodLabel = computed(() => {
  const order = pendingOrder.value
  if (!order) return ''
  return (
    methodOptions.value.find((option) => option.value === order.paymentType)?.label ??
    order.paymentType
  )
})

const pendingQuery = computed<Record<string, string>>(() => {
  const order = pendingOrder.value
  if (!order) return {}
  const query: Record<string, string> = {}
  if (order.outTradeNo) query.out_trade_no = order.outTradeNo
  if (order.resumeToken) query.resume_token = order.resumeToken
  return query
})

function stopTicking(): void {
  if (pendingTicker) {
    clearInterval(pendingTicker)
    pendingTicker = null
  }
}

function startTicking(): void {
  stopTicking()
  pendingNow.value = Date.now()
  pendingTicker = setInterval(() => {
    pendingNow.value = Date.now()
  }, 1000)
}

function abortPending(): void {
  pendingController?.abort()
  pendingController = null
}

async function prepareQr(raw: string): Promise<void> {
  const token = ++qrToken
  try {
    const src = await resolveQrImageSrc(raw)
    if (token !== qrToken || !pendingOrder.value) return
    pendingOrder.value = { ...pendingOrder.value, qrImageSrc: src }
  } catch {
    if (token !== qrToken || !pendingOrder.value) return
    pendingError.value = t('purchase.qrFailed')
  }
}

/* --------------------------------------------------------------------- load */

async function resolvePlans(info: CheckoutInfo | null): Promise<void> {
  if (info?.plans?.length) {
    plans.value = info.plans
    return
  }
  if (!showSubscribeTab.value) {
    plans.value = []
    return
  }
  try {
    plans.value = await fetchPaymentPlans()
  } catch {
    // Only the plan list may fall back to /payment/plans; failing shows a
    // non-blocking banner because limits/metadata still govern confirmation.
    plansFailed.value = true
    plans.value = []
  }
}

async function load(): Promise<void> {
  loading.value = true
  checkoutFailed.value = false
  limitsFailed.value = false
  checkoutError.value = ''
  limitsError.value = ''
  configError.value = ''
  configFailed.value = false
  plansFailed.value = false

  const [info, limitData, cfg] = await Promise.all([
    fetchCheckoutInfo()
      .then((value) => ({ ok: true as const, value }))
      .catch((err: unknown) => ({ ok: false as const, err })),
    fetchPaymentLimits()
      .then((value) => ({ ok: true as const, value }))
      .catch((err: unknown) => ({ ok: false as const, err })),
    fetchPaymentConfig()
      .then((value) => ({ ok: true as const, value }))
      .catch((err: unknown) => ({ ok: false as const, err })),
  ])

  if (info.ok) {
    checkout.value = info.value
  } else {
    checkoutFailed.value = true
    checkoutError.value = messageOf(info.err)
  }
  if (limitData.ok) {
    limits.value = limitData.value
  } else {
    limitsFailed.value = true
    limitsError.value = messageOf(limitData.err)
  }
  if (cfg.ok) {
    config.value = cfg.value
  } else {
    configFailed.value = true
    configError.value = messageOf(cfg.err)
  }

  await resolvePlans(info.ok ? info.value : null)

  if (!availableMethodOptions.value.length) {
    const firstAvailable = methodEntries.value.find((entry) => entry.available)
    paymentType.value = firstAvailable?.key ?? ''
  } else if (!paymentType.value) {
    paymentType.value = availableMethodOptions.value[0]!.value
  }

  if (!showSubscribeTab.value && !rechargeDisabled.value) {
    tab.value = 'recharge'
  }

  loading.value = false
}

function messageOf(err: unknown): string {
  if (err instanceof ApiError || err instanceof Error) return err.message
  return t('common.error')
}

function selectPlan(plan: PaymentPlan): void {
  selectedPlan.value = plan
  tab.value = 'subscription'
  confirmError.value = ''
}

function clearSelection(): void {
  selectedPlan.value = null
  confirmError.value = ''
}

function selectTab(next: Tab): void {
  if (next === 'recharge' && rechargeDisabled.value) return
  tab.value = next
  if (next === 'subscription') rechargeAmount.value = ''
  else selectedPlan.value = null
  confirmError.value = ''
}

/* --------------------------------------------------------------- submitting */

function resultTypeOf(result: CreateOrderResult): string {
  return String(result.result_type || '').toLowerCase()
}

function isQrResult(result: CreateOrderResult): boolean {
  return typeof result.qr_code === 'string' && result.qr_code.length > 0
}

function openPending(result: CreateOrderResult, orderType: string, amount: number): void {
  const status = normalizeOrderStatus(result.status, undefined)
  pendingOrder.value = {
    orderId: typeof result.order_id === 'number' ? result.order_id : undefined,
    outTradeNo: result.out_trade_no || '',
    resumeToken: result.resume_token || undefined,
    expiresAt: result.expires_at || undefined,
    resultType: resultTypeOf(result) || 'order_created',
    amount: typeof result.amount === 'number' ? result.amount : amount,
    payableAmount: result.pay_amount,
    currency: result.currency,
    payUrl: result.pay_url || undefined,
    paymentType: result.payment_type || paymentType.value,
    orderType: result.order_type || orderType,
    status: status === 'unknown' ? 'pending' : status,
  }
  pendingError.value = ''
  confirmError.value = ''
  qrToken += 1
  startTicking()
  if (isQrResult(result) && result.qr_code) {
    const raw = result.qr_code
    pendingOrder.value.qrRaw = raw
    if (classifyQrSource(raw) === 'content') {
      void prepareQr(raw)
    } else {
      pendingOrder.value.qrImageSrc = raw.trim()
    }
  }
}

async function handleResult(
  result: CreateOrderResult,
  orderType: string,
  amount: number,
): Promise<void> {
  openPending(result, orderType, amount)
  const type = resultTypeOf(result)
  const payUrl = result.pay_url || ''

  if (type === 'oauth_required' || type === 'jsapi_ready') {
    pendingOrder.value!.payUrl = undefined
    pendingError.value = t('purchase.unsupportedProviderFlow')
    return
  }
  if (type && type !== 'order_created') {
    pendingOrder.value!.payUrl = undefined
    pendingError.value = t('purchase.unsupportedProviderFlow')
    return
  }
  if (payUrl && !isSafeRedirectUrl(payUrl)) {
    pendingOrder.value!.payUrl = undefined
    pendingError.value = t('purchase.unsafeRedirect')
    return
  }
  // A validated URL is opened only on an explicit user click, never automatically.
  if (payUrl || isQrResult(result)) return
  if (pendingQuery.value.out_trade_no || pendingQuery.value.resume_token) {
    await router.push({ name: 'payment-result', query: pendingQuery.value })
  }

}

async function confirmPayment(): Promise<void> {
  if (confirming.value || pendingOrder.value) return
  if (!canConfirm.value) {
    confirmError.value = validationMessage.value || t('purchase.noMethods')
    return
  }
  if (!validation.value.ok) {
    confirmError.value = validationMessage.value
    return
  }
  confirmError.value = ''

  const amount = validation.value.value
  const orderType = tab.value === 'subscription' ? 'subscription' : 'balance'
  const method = paymentType.value

  confirming.value = true
  try {
    const result = await createPaymentOrder({
      amount,
      payment_type: method,
      order_type: orderType,
      plan_id: tab.value === 'subscription' ? selectedPlan.value?.id : undefined,
      return_url: `${window.location.origin}/payment/result`,
      payment_source: 'web',
    })
    await handleResult(result, orderType, amount)
  } catch (err) {
    confirmError.value = messageOf(err)
  } finally {
    confirming.value = false
  }
}

/* ------------------------------------------------------------------ pending */

async function continuePending(recover = false): Promise<void> {
  const order = pendingOrder.value
  if (!order || pendingLoading.value) return
  pendingError.value = ''
  pendingLoading.value = true
  abortPending()
  const local = new AbortController()
  pendingController = local
  try {
    let next: PublicOrderStatus | null = null
    if (order.outTradeNo) {
      try {
        next = await verifyPublicOrder({ out_trade_no: order.outTradeNo }, { signal: local.signal })
      } catch (err) {
        const notFound = err instanceof ApiError && (err.status === 404 || err.code === 404)
        if (!notFound || !order.resumeToken) throw err
        next = await resolvePublicOrder({ resume_token: order.resumeToken }, { signal: local.signal })
      }
    } else if (order.resumeToken) {
      next = await resolvePublicOrder({ resume_token: order.resumeToken }, { signal: local.signal })
    } else if (order.orderId) {
      const detail = await fetchOrder(order.orderId, { signal: local.signal })
      next = { ...detail, out_trade_no: detail.out_trade_no || '', status: detail.status || 'UNKNOWN' }
    }
    if (local.signal.aborted || !pendingOrder.value) return
    if (next) {
      const normalized = normalizeOrderStatus(next.status, next.paid)
      pendingOrder.value = {
        ...pendingOrder.value,
        status: normalized,
        outTradeNo: next.out_trade_no || pendingOrder.value.outTradeNo,
        amount: next.amount ?? pendingOrder.value.amount,
        expiresAt: next.expires_at || pendingOrder.value.expiresAt,
        payableAmount: next.pay_amount ?? pendingOrder.value.payableAmount,
        currency: next.currency ?? pendingOrder.value.currency,
      }
      if (normalized === 'paid' && !recover) {
        await router.push({ name: 'payment-result', query: pendingQuery.value })
      }
    }
  } catch (err) {
    if (!local.signal.aborted) pendingError.value = messageOf(err)
  } finally {
    if (!local.signal.aborted) {
      pendingLoading.value = false
      pendingController = null
    }
  }
}

async function cancelPending(): Promise<void> {
  const order = pendingOrder.value
  if (!order || pendingLoading.value) return
  if (!order.orderId) {
    pendingError.value = t('purchase.cancelUnavailable')
    return
  }
  pendingError.value = ''
  pendingLoading.value = true
  try {
    await cancelOrder(order.orderId)
    if (pendingOrder.value) {
      pendingOrder.value = { ...pendingOrder.value, status: 'cancelled' }
    }
  } catch (err) {
    pendingError.value = messageOf(err)
  } finally {
    pendingLoading.value = false
  }
}

function startNewOrder(): void {
  if (!canStartNewOrder.value) return
  qrToken += 1
  stopTicking()
  abortPending()
  pendingOrder.value = null
  pendingError.value = ''
  pendingLoading.value = false
  confirmError.value = ''
}

function openPendingPayment(): void {
  const url = pendingOrder.value?.payUrl
  if (url && isSafeRedirectUrl(url)) window.location.assign(url)
}


const balanceText = computed(() => {
  const value = auth.user?.balance
  if (typeof value !== 'number') return '—'
  const currency = config.value?.currency || settings.settings?.billing_currency
  const text = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
  return currency ? `${text} ${currency}` : text
})

const rangeText = computed(() => {
  if (globalMin.value === null || globalMax.value === null) return '—'
  return `${globalMin.value} – ${globalMax.value}`
})

const selectedMethodLabel = computed(
  () => selectedMethod.value?.display_name || paymentType.value || '—',
)

/* -------------------------------------------------------------------- misc */

onBeforeUnmount(() => {
  stopTicking()
  abortPending()
  qrToken += 1
})

void load()
if (pendingOrder.value) { startTicking(); void continuePending(true) }
</script>

<template>
  <div class="page">
    <header class="page__head">
      <div class="page__head-text">
        <h1>{{ t('pages.purchase') }}</h1>
        <p class="page__subtitle">{{ t('purchase.subtitle') }}</p>
      </div>
    </header>

    <p v-if="loading" role="status" class="state">
      {{ t('common.loading') }}
    </p>

    <template v-else>
      <div class="content-panel">
        <div
          v-for="(message, idx) in requiredBanners"
          :key="`req-${idx}`"
          class="banner banner--error"
          role="alert"
        >
          {{ message }}
        </div>
        <div
          v-for="(message, idx) in optionalBanners"
          :key="`opt-${idx}`"
          class="banner banner--warn"
          role="status"
        >
          {{ message }}
        </div>

        <dl class="summary-row">
          <div class="summary-card">
            <dt class="summary-card__label">{{ t('purchase.balance') }}</dt>
            <dd class="summary-card__value">{{ balanceText }}</dd>
            <p class="summary-card__caption">{{ t('purchase.balanceCaption') }}</p>
          </div>
          <div class="summary-card">
            <dt class="summary-card__label">{{ t('purchase.limitsTitle') }}</dt>
            <dd class="summary-card__value">{{ rangeText }}</dd>
            <p class="summary-card__caption">{{ t('purchase.limitsCaption') }}</p>
          </div>
          <div class="summary-card">
            <dt class="summary-card__label">{{ t('purchase.paymentMethod') }}</dt>
            <dd class="summary-card__value summary-card__value--small">
              {{ selectedMethodLabel }}
            </dd>
            <p class="summary-card__caption">{{ t('purchase.methodCaption') }}</p>
          </div>
        </dl>

        <div class="strip">
          <div class="tabbar" role="tablist" :aria-label="t('purchase.tabsLabel')">
            <button
              v-if="showSubscribeTab"
              type="button"
              role="tab"
              class="tabbar__tab"
              :aria-selected="tab === 'subscription'"
              @click="selectTab('subscription')"
            >
              {{ t('purchase.tabSubscription') }}
            </button>
            <button
              v-if="showRechargeTab"
              type="button"
              role="tab"
              class="tabbar__tab"
              :aria-selected="tab === 'recharge'"
              :disabled="rechargeDisabled"
              @click="selectTab('recharge')"
            >
              {{ t('purchase.tabBalance') }}
            </button>
          </div>
          <p v-if="balanceDisabled" class="hint" role="status">
            {{ t('purchase.balanceDisabled') }}
          </p>
        </div>

        <div class="panels">
          <section
            v-if="tab === 'subscription' && showSubscribeTab"
            class="panel"
            :aria-labelledby="'purchase-plans-title'"
          >
            <div class="panel__head">
              <h2 id="purchase-plans-title" class="panel__title">
                {{ t('purchase.plans') }}
              </h2>
              <p class="panel__caption">{{ t('purchase.plansCaption') }}</p>
            </div>
            <p v-if="!visiblePlans.length" role="status" class="state">
              {{ t('purchase.empty') }}
            </p>
            <ul v-else class="plans">
              <li v-for="plan in visiblePlans" :key="plan.id" class="plan">
                <div class="plan__body">
                  <h3 class="plan__name">{{ plan.name }}</h3>
                  <p class="plan__desc">
                    {{ plan.description }}
                  </p>
                  <dl class="plan__facts">
                    <div>
                      <dt>{{ t('purchase.price') }}</dt>
                      <dd>{{ plan.price }} {{ plan.currency || 'USD' }}</dd>
                    </div>
                    <div v-if="plan.validity_days">
                      <dt>{{ t('purchase.validity') }}</dt>
                      <dd>{{ plan.validity_days }} {{ plan.validity_unit || 'day' }}</dd>
                    </div>
                  </dl>
                  <ul v-if="plan.features?.length" class="features">
                    <li v-for="(feature, idx) in plan.features" :key="idx">
                      {{ feature }}
                    </li>
                  </ul>
                </div>
                <Button
                  :disabled="!metadataReady"
                  @click="selectPlan(plan)"
                >
                  {{ t('purchase.subscribe') }}
                </Button>
              </li>
            </ul>
          </section>

          <section
            v-if="tab === 'recharge' && showRechargeTab"
            class="panel"
            :aria-labelledby="'purchase-recharge-title'"
          >
            <div class="panel__head">
              <h2 id="purchase-recharge-title" class="panel__title">
                {{ t('purchase.recharge') }}
              </h2>
              <p class="panel__caption">{{ t('purchase.rechargeCaption') }}</p>
            </div>
            <label class="field">
              <span class="field__label">{{ t('purchase.amount') }}</span>
              <Input
                v-model="rechargeAmount"
                type="number"
                step="0.01"
                :disabled="rechargeDisabled || !metadataReady"
                required
              />
              <span class="hint">
                {{
                  globalMin !== null && globalMax !== null
                    ? t('purchase.amountRange', { min: globalMin, max: globalMax })
                    : t('purchase.limitsUnavailable')
                }}
              </span>
            </label>
          </section>

          <section
            v-if="!pendingOrder && ((tab === 'subscription' && selectedPlan) || (tab === 'recharge' && showRechargeTab && !rechargeDisabled))"
            class="confirm"
            :aria-label="t('purchase.confirmTitle')"
          >
            <div class="confirm__head">
              <h2 class="confirm__title">{{ t('purchase.confirmTitle') }}</h2>
              <span class="confirm__badge">{{ t('purchase.confirmBadge') }}</span>
            </div>
            <p v-if="tab === 'subscription' && selectedPlan" class="confirm__plan">
              {{ selectedPlan.name }}
            </p>
            <p class="confirm__amount">
              {{ t('purchase.price') }}: {{ previewAmount }}
            </p>

            <label class="field">
              <span class="field__label">{{ t('purchase.paymentMethod') }}</span>
              <Select
                v-model="paymentType"
                :options="methodOptions"
                :placeholder="t('purchase.selectMethod')"
                :disabled="!metadataReady"
              />
              <span v-if="selectedMethod" class="hint">
                {{ methodSummary(selectedMethod) }}
              </span>
              <span
                v-for="method in unavailableMethods"
                :key="method.key"
                class="hint"
              >
                {{ method.label }} — {{ t('purchase.unavailable') }}
              </span>
            </label>

            <p v-if="validationMessage" class="hint hint--error" role="status">
              {{ validationMessage }}
            </p>

            <p v-if="confirmError" class="error" role="alert">
              {{ confirmError }}
            </p>
            <div class="confirm__actions">
              <Button
                v-if="tab === 'subscription'"
                variant="secondary"
                :disabled="confirming"
                @click="clearSelection"
              >
                {{ t('common.cancel') }}
              </Button>
              <Button
                :disabled="!canConfirm || confirming || Boolean(pendingOrder)"
                @click="confirmPayment"
              >
                {{ confirming ? t('purchase.creating') : t('purchase.confirmPayment') }}
              </Button>
            </div>
          </section>

          <section
            v-if="pendingOrder"
            class="pending"
            :aria-label="t('purchase.pendingTitle')"
          >
            <div class="confirm__head">
              <h2 class="confirm__title">{{ t('purchase.pendingTitle') }}</h2>
              <span class="pending__status" role="status">
                {{ t(`purchase.status.${pendingStatus}`) }}
              </span>
            </div>
            <p>
              {{ t('purchase.price') }}: {{ pendingAmountText }}
            </p>
            <p>
              {{ t('purchase.paymentMethod') }}: {{ pendingMethodLabel }}
            </p>
            <p v-if="pendingCountdown" class="hint">
              {{ t('purchase.pendingExpires') }}: {{ pendingCountdown }}
            </p>
            <p v-else-if="pendingOrder.expiresAt" class="hint">
              {{ t('purchase.pendingExpiresAt') }}: {{ pendingOrder.expiresAt }}
            </p>

            <div v-if="pendingOrder.qrImageSrc" class="qr">
              <p>{{ t('purchase.scanQr') }}</p>
              <img :src="pendingOrder.qrImageSrc" alt="" class="qr__img">
              <p v-if="pendingOrder.qrRaw && pendingOrder.qrRaw !== pendingOrder.qrImageSrc" class="qr__raw">
                {{ pendingOrder.qrRaw }}
              </p>
            </div>
            <p v-else-if="pendingOrder.qrRaw" class="qr__raw">{{ pendingOrder.qrRaw }}</p>

            <p v-if="pendingError" class="error" role="alert">
              {{ pendingError }}
            </p>

            <div class="confirm__actions">
              <Button
                variant="secondary"
                :disabled="pendingLoading || pendingTerminal"
                @click="continuePending(false)"
              >
                {{ t('purchase.refreshContinue') }}
              </Button>
              <Button
                variant="secondary"
                :disabled="!pendingOrder.orderId || pendingLoading || pendingTerminal"
                @click="cancelPending"
              >
                {{ t('purchase.cancelOrder') }}
              </Button>
              <Button
                variant="secondary"
                :disabled="!canStartNewOrder"
                @click="startNewOrder"
              >
                {{ t('purchase.startNewOrder') }}
              </Button>
              <Button
                v-if="pendingOrder.payUrl"
                variant="secondary"
                @click="openPendingPayment"
              >
                {{ t('purchase.openPayment') }}
              </Button>
            </div>
            <p v-if="!canStartNewOrder" class="hint">
              {{ t('purchase.startNewHint') }}
            </p>
            <RouterLink class="link" :to="{ name: 'payment-result', query: pendingQuery }">
              {{ t('purchase.viewResult') }}
            </RouterLink>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: var(--cshell-page-gap);
  width: min(100%, var(--cshell-content-width));
  min-width: 0;
  margin-inline: auto;
}

.page__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.content-panel {
  display: grid;
  gap: 1rem;
  padding: var(--cshell-panel-padding);
  border: 1px solid var(--cshell-border);
  border-radius: var(--cshell-radius-panel);
  background: var(--cshell-surface);
  min-width: 0;
}

.page__head-text {
  display: grid;
  gap: 0.3rem;
}

.page h1 {
  margin: 0;
  font-size: var(--cshell-type-page);
  letter-spacing: -0.01em;
}

.page__subtitle {
  margin: 0;
  font-size: var(--cshell-type-body);
  color: var(--cshell-text-muted);
}

.state {
  margin: 0;
  color: var(--cshell-text-muted);
}

.banner {
  padding: 0.7rem 0.9rem;
  border-radius: var(--cshell-radius-control);
  border: 1px solid var(--cshell-border);
  font-size: 0.9rem;
}

.banner--error {
  color: var(--cshell-danger);
  border-color: var(--cshell-danger);
}

.banner--warn {
  color: var(--cshell-text-muted);
}

.summary-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.85rem;
  margin: 0;
}

.summary-card {
  padding: 1rem 1.1rem;
  border-radius: var(--cshell-radius-panel);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-bg-elevated);
  min-width: 0;
}

.summary-card__label {
  font-size: 0.76rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--cshell-text-muted);
}

.summary-card__value {
  margin: 0.3rem 0 0;
  font-size: 1.35rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.summary-card__value--small {
  font-size: 1rem;
}

.summary-card__caption {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  color: var(--cshell-text-muted);
}

.strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}

.tabbar {
  display: inline-flex;
  gap: 0.2rem;
  padding: 0.2rem;
  border-radius: var(--cshell-radius-control);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-surface-muted);
}

.tabbar__tab {
  min-height: 2.3rem;
  padding: 0.3rem 0.9rem;
  border: 0;
  border-radius: calc(var(--cshell-radius-control) - 3px);
  background: transparent;
  color: var(--cshell-text-muted);
  font-size: 0.9rem;
  cursor: pointer;
}

.tabbar__tab[aria-selected='true'] {
  background: var(--cshell-surface);
  color: var(--cshell-text);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(44, 36, 28, 0.1);
}

.tabbar__tab:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.panels {
  display: grid;
  gap: 1rem;
  min-width: 0;
}

.panel {
  display: grid;
  gap: 1rem;
  padding: var(--cshell-panel-padding);
  border-radius: var(--cshell-radius-panel);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-surface);
  min-width: 0;
}

.panel__head {
  display: grid;
  gap: 0.15rem;
}

.panel__title {
  margin: 0;
  font-size: var(--cshell-type-section);
}

.panel__caption {
  margin: 0;
  font-size: var(--cshell-type-caption);
  color: var(--cshell-text-muted);
}

.field {
  display: grid;
  gap: 0.35rem;
}

.field__label {
  font-size: 0.8rem;
  color: var(--cshell-text-muted);
}

.hint {
  font-size: 0.84rem;
  color: var(--cshell-text-muted);
}

.hint--error {
  color: var(--cshell-danger);
}

.plans {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.6rem;
}

.plan {
  display: flex;
  flex-wrap: wrap;
  gap: 0.85rem;
  justify-content: space-between;
  align-items: flex-start;
  padding: 1rem;
  border-radius: var(--cshell-radius-control);
  background: var(--cshell-bg-elevated);
  border: 1px solid var(--cshell-border);
  min-width: 0;
}

.plan__body {
  flex: 1 1 16rem;
  min-width: 0;
}

.plan__name {
  margin: 0 0 0.35rem;
  font-size: 1rem;
  overflow-wrap: anywhere;
}

.plan__desc {
  margin: 0 0 0.5rem;
  color: var(--cshell-text-muted);
  font-size: 0.88rem;
  overflow-wrap: anywhere;
}

.plan__facts {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin: 0;
}

.plan__facts div {
  display: grid;
  gap: 0.1rem;
}

.plan__facts dt {
  font-size: 0.72rem;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--cshell-text-muted);
}

.plan__facts dd {
  margin: 0;
  font-size: 0.88rem;
}

.features {
  margin: 0.5rem 0 0;
  padding-left: 1.1rem;
  color: var(--cshell-text-muted);
  font-size: 0.85rem;
}

.confirm,
.pending {
  display: grid;
  gap: 0.65rem;
  padding: 1.25rem;
  border-radius: var(--cshell-radius-panel);
  background: var(--cshell-surface);
  border: 1px solid var(--cshell-accent);
  box-shadow: 0 0 0 1px var(--cshell-accent-soft);
  min-width: 0;
}

.confirm__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
}

.confirm__title {
  margin: 0;
  font-size: var(--cshell-type-section);
}

.confirm__badge {
  padding: 0.15rem 0.5rem;
  border-radius: var(--cshell-radius-badge);
  background: var(--cshell-accent-soft);
  color: var(--cshell-accent);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}

.confirm__plan {
  margin: 0;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.confirm__amount {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.confirm__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.qr {
  display: grid;
  gap: 0.5rem;
}

.qr__img {
  max-width: 12rem;
  border-radius: var(--cshell-radius-panel);
}

.qr__raw {
  margin: 0;
  font-family: var(--cshell-font-mono);
  font-size: var(--cshell-type-caption);
  overflow-wrap: anywhere;
}

.pending__status {
  padding: 0.15rem 0.5rem;
  border-radius: var(--cshell-radius-badge);
  background: var(--cshell-surface-muted);
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}

.link {
  color: var(--cshell-accent);
  font-size: 0.88rem;
}

.error {
  margin: 0;
  color: var(--cshell-danger);
}

@media (max-width: 760px) {
  .content-panel {
    padding: var(--cshell-panel-padding-mobile);
  }

  .summary-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .panel,
  .confirm,
  .pending {
    padding: var(--cshell-panel-padding-mobile);
  }

  .confirm__head {
    flex-wrap: wrap;
  }
}

@media (max-width: 1023px) {
  .tabbar__tab {
    min-height: 44px;
  }
}
</style>
