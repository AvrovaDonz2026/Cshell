<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { cancelOrder, fetchMyOrders } from '@/api/billing'
import type { PaymentOrder } from '@/api/types'
import { ApiError } from '@/api/types'
import Button from '@/components/primitives/Button.vue'
import { normalizeOrderStatus, type NormalizedOrderStatus } from '@/lib/payment'

const { t } = useI18n()

const STATUS_FILTERS = [
  'all',
  'pending',
  'paid',
  'expired',
  'failed',
  'cancelled',
] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

const orders = ref<PaymentOrder[]>([])
const page = ref(1)
const pages = ref(1)
const total = ref(0)
const loading = ref(true)
const error = ref('')
const cancellingId = ref<number | null>(null)
const statusFilter = ref<StatusFilter>('all')
const search = ref('')

const statusLabel: Record<NormalizedOrderStatus, string> = {
  paid: 'orders.statusPaid',
  pending: 'orders.statusPending',
  expired: 'orders.statusExpired',
  failed: 'orders.statusFailed',
  cancelled: 'orders.statusCancelled',
  refunded: 'orders.statusRefunded',
  unknown: 'orders.statusUnknown',
}

function normalized(order: PaymentOrder): NormalizedOrderStatus {
  const status = normalizeOrderStatus(order.status)
  if (status === 'unknown' && order.paid_at) return 'paid'
  return status
}

function isPending(order: PaymentOrder): boolean {
  return String(order.status || '').toUpperCase() === 'PENDING'
}

function statusText(order: PaymentOrder): string {
  return t(statusLabel[normalized(order)])
}

function formatAmount(order: PaymentOrder): string {
  const amount = order.pay_amount ?? order.amount
  if (amount == null) return '—'
  const currency = order.currency
  return currency ? `${amount} ${currency}` : String(amount)
}

const paidTotal = computed(() =>
  orders.value
    .filter((order) => normalized(order) === 'paid')
    .reduce((sum, order) => {
      const amount = order.pay_amount ?? order.amount
      return sum + (typeof amount === 'number' ? amount : 0)
    }, 0),
)

const summary = computed(() => [
  {
    label: t('orders.summaryCount'),
    value: String(total.value),
  },
  {
    label: t('orders.summaryPending'),
    value: String(
      orders.value.filter((order) => normalized(order) === 'pending').length,
    ),
  },
  {
    label: t('orders.summaryPaidValue'),
    value: new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2,
    }).format(paidTotal.value),
  },
])

const visibleOrders = computed(() => {
  const term = search.value.trim().toLowerCase()
  let list = orders.value
  if (statusFilter.value !== 'all') {
    list = list.filter((order) => normalized(order) === statusFilter.value)
  }
  if (term) {
    list = list.filter((order) =>
      [
        String(order.id),
        order.out_trade_no,
        order.payment_type,
        order.order_type,
        order.created_at,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    )
  }
  return list
})

const filterOptions = computed(() =>
  STATUS_FILTERS.map((value) => ({
    value,
    label:
      value === 'all'
        ? t('orders.filterAll')
        : t(statusLabel[value as NormalizedOrderStatus]),
  })),
)

async function load(nextPage = page.value): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const status = statusFilter.value === 'all' ? undefined : statusFilter.value
    const data = await fetchMyOrders(nextPage, 20, status ? { status } : {})
    orders.value = data.items || []
    page.value = data.page || nextPage
    pages.value = Math.max(1, data.pages || 1)
    total.value = typeof data.total === 'number' ? data.total : orders.value.length
  } catch (err) {
    error.value =
      err instanceof ApiError || err instanceof Error
        ? err.message
        : t('common.error')
  } finally {
    loading.value = false
  }
}

async function onCancel(order: PaymentOrder): Promise<void> {
  if (cancellingId.value !== null) return
  cancellingId.value = order.id
  error.value = ''
  try {
    await cancelOrder(order.id)
    await load(page.value)
  } catch (err) {
    error.value =
      err instanceof ApiError || err instanceof Error
        ? err.message
        : t('common.error')
  } finally {
    cancellingId.value = null
  }
}

watch(statusFilter, () => {
  error.value = ''
  void load(1)
})

onMounted(() => {
  void load(1)
})
</script>

<template>
  <div class="page">
    <header class="page__head">
      <div class="page__head-text">
        <h1>{{ t('pages.orders') }}</h1>
        <p class="page__subtitle">{{ t('orders.subtitle') }}</p>
      </div>
    </header>

    <dl class="summary-strip">
      <div v-for="item in summary" :key="item.label" class="summary-item">
        <dd class="summary-item__value">{{ item.value }}</dd>
        <dt class="summary-item__caption">{{ item.label }}</dt>
      </div>
    </dl>

    <div class="filterbar">
      <label class="filterbar__field">
        <span class="filterbar__label">{{ t('orders.filter') }}</span>
        <select v-model="statusFilter" class="filterbar__select">
          <option v-for="option in filterOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <label class="filterbar__field filterbar__field--grow">
        <span class="filterbar__label">{{ t('orders.search') }}</span>
        <input
          v-model="search"
          type="search"
          class="filterbar__input"
          :placeholder="t('orders.searchPlaceholder')"
        >
      </label>
    </div>

    <p v-if="loading" role="status" class="state">
      {{ t('common.loading') }}
    </p>
    <p v-else-if="error" class="error" role="alert">
      {{ error }}
    </p>
    <p v-else-if="!orders.length" role="status" class="state">
      {{ t('orders.empty') }}
    </p>
    <p v-else-if="!visibleOrders.length" role="status" class="state">
      {{ t('orders.emptyFiltered') }}
    </p>

    <template v-else>
      <div class="table-panel">
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>{{ t('orders.id') }}</th>
                <th>{{ t('orders.amount') }}</th>
                <th>{{ t('orders.payAmount') }}</th>
                <th>{{ t('orders.status') }}</th>
                <th>{{ t('orders.type') }}</th>
                <th>{{ t('orders.payment') }}</th>
                <th>{{ t('orders.tradeNo') }}</th>
                <th>{{ t('orders.created') }}</th>
                <th>{{ t('orders.expires') }}</th>
                <th>{{ t('orders.paid') }}</th>
                <th class="table__actions">{{ t('orders.actions') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="order in visibleOrders" :key="order.id">
                <td class="mono">{{ order.id }}</td>
                <td>{{ order.amount }}{{ order.currency ? ` ${order.currency}` : '' }}</td>
                <td>{{ formatAmount(order) }}</td>
                <td>
                  <span class="status" :class="`status--${normalized(order)}`">
                    {{ statusText(order) }}
                  </span>
                  <span
                    v-if="order.status && order.status !== statusText(order)"
                    class="status-raw"
                  >
                    {{ order.status }}
                  </span>
                </td>
                <td>{{ order.order_type || '—' }}</td>
                <td>{{ order.payment_type || '—' }}</td>
                <td class="mono">
                  {{ order.out_trade_no || '—' }}
                </td>
                <td>{{ order.created_at || '—' }}</td>
                <td>{{ order.expires_at || '—' }}</td>
                <td>{{ order.paid_at || '—' }}</td>
                <td class="table__actions">
                  <Button
                    v-if="isPending(order)"
                    variant="secondary"
                    :disabled="cancellingId === order.id"
                    @click="onCancel(order)"
                  >
                    {{ cancellingId === order.id ? t('orders.cancelling') : t('orders.cancel') }}
                  </Button>
                  <span v-else>—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="pager">
        <Button
          variant="secondary"
          :disabled="page <= 1 || loading"
          @click="load(page - 1)"
        >
          {{ t('common.prev') }}
        </Button>
        <span class="pager__status">
          {{ t('orders.page', { page, pages }) }}
        </span>
        <Button
          variant="secondary"
          :disabled="page >= pages || loading"
          @click="load(page + 1)"
        >
          {{ t('common.next') }}
        </Button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 1.4rem;
  min-width: 0;
}

.page__head-text {
  display: grid;
  gap: 0.3rem;
}

.page h1 {
  margin: 0;
  font-size: 1.7rem;
  letter-spacing: -0.01em;
}

.page__subtitle {
  margin: 0;
  font-size: 0.94rem;
  color: var(--cshell-text-muted);
}

.summary-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.85rem;
  margin: 0;
}

.summary-item {
  padding: 1rem 1.1rem;
  border-radius: var(--cshell-radius-panel);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-bg-elevated);
  min-width: 0;
}

.summary-item__value {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.summary-item__caption {
  margin-top: 0.2rem;
  font-size: 0.8rem;
  color: var(--cshell-text-muted);
}

.filterbar {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  border-radius: var(--cshell-radius-panel);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-surface);
}

.filterbar__field {
  display: grid;
  gap: 0.3rem;
  min-width: min(100%, 11rem);
}

.filterbar__field--grow {
  flex: 1 1 16rem;
}

.filterbar__label {
  font-size: 0.8rem;
  color: var(--cshell-text-muted);
}

.filterbar__select,
.filterbar__input {
  min-height: 2.5rem;
  padding: 0.45rem 0.7rem;
  border-radius: var(--cshell-radius-control);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-bg-elevated);
  color: var(--cshell-text);
}

.table-panel {
  border-radius: var(--cshell-radius-panel);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-surface);
  overflow: hidden;
}

.table-wrap {
  overflow-x: auto;
  max-width: 100%;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}

.table th,
.table td {
  padding: 0.65rem 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--cshell-border);
  white-space: nowrap;
}

.table th {
  color: var(--cshell-text-muted);
  font-weight: 600;
  font-size: 0.78rem;
  letter-spacing: 0.02em;
  background: var(--cshell-surface-muted);
}

.table tbody tr:last-child td {
  border-bottom: 0;
}

.table__actions {
  text-align: right;
}

.status {
  display: inline-block;
  padding: 0.1rem 0.45rem;
  border-radius: var(--cshell-radius-badge);
  background: var(--cshell-surface-muted);
  font-weight: 600;
}

.status--paid {
  background: color-mix(in srgb, var(--cshell-accent) 18%, transparent);
  color: var(--cshell-accent);
}

.status--pending {
  background: var(--cshell-accent-soft);
  color: var(--cshell-accent);
}

.status-raw {
  display: block;
  font-size: 0.72rem;
  color: var(--cshell-text-muted);
}

.mono {
  font-family: var(--cshell-font-mono);
}

.pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
}

.pager__status {
  font-size: 0.86rem;
  color: var(--cshell-text-muted);
}

.state {
  margin: 0;
  color: var(--cshell-text-muted);
}

.error {
  margin: 0;
  color: var(--cshell-danger);
}

@media (max-width: 640px) {
  .summary-strip {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 1023px) {
  .filterbar__select,
  .filterbar__input {
    min-height: 44px;
  }
}
</style>
