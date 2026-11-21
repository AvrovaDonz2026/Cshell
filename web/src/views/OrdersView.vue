<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { fetchMyOrders } from '@/api/billing'
import type { PaymentOrder } from '@/api/types'
import { ApiError } from '@/api/types'
import Button from '@/components/primitives/Button.vue'

const { t } = useI18n()

const orders = ref<PaymentOrder[]>([])
const page = ref(1)
const pages = ref(1)
const loading = ref(true)
const error = ref('')

async function load(nextPage = page.value): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const data = await fetchMyOrders(nextPage, 20)
    orders.value = data.items || []
    page.value = data.page || nextPage
    pages.value = Math.max(1, data.pages || 1)
  } catch (err) {
    error.value =
      err instanceof ApiError || err instanceof Error
        ? err.message
        : t('common.error')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load(1)
})
</script>

<template>
  <div class="page">
    <h1>{{ t('pages.orders') }}</h1>

    <p v-if="loading" role="status">
      {{ t('common.loading') }}
    </p>
    <p v-else-if="error" class="error" role="alert">
      {{ error }}
    </p>
    <p v-else-if="!orders.length" role="status">
      {{ t('orders.empty') }}
    </p>

    <template v-else>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('orders.id') }}</th>
              <th>{{ t('orders.amount') }}</th>
              <th>{{ t('orders.status') }}</th>
              <th>{{ t('orders.type') }}</th>
              <th>{{ t('orders.payment') }}</th>
              <th>{{ t('orders.tradeNo') }}</th>
              <th>{{ t('orders.created') }}</th>
              <th>{{ t('orders.paid') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="order in orders" :key="order.id">
              <td>{{ order.id }}</td>
              <td>{{ order.amount }}</td>
              <td>{{ order.status || '—' }}</td>
              <td>{{ order.order_type || '—' }}</td>
              <td>{{ order.payment_type || '—' }}</td>
              <td class="mono">
                {{ order.out_trade_no || '—' }}
              </td>
              <td>{{ order.created_at || '—' }}</td>
              <td>{{ order.paid_at || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="pager">
        <Button
          variant="secondary"
          :disabled="page <= 1 || loading"
          @click="load(page - 1)"
        >
          {{ t('common.prev') }}
        </Button>
        <span>
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
  gap: 1rem;
  min-width: 0;
}

.page h1 {
  margin: 0;
  font-size: 1.55rem;
}

.table-wrap {
  overflow-x: auto;
  max-width: 100%;
  border-radius: var(--cshell-radius-panel);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-surface);
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
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
  background: var(--cshell-surface-muted);
}

.mono {
  font-family: var(--cshell-font-mono);
}

.pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}

.error {
  margin: 0;
  color: var(--cshell-danger);
}
</style>
