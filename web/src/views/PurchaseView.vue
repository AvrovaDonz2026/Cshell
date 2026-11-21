<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  createPaymentOrder,
  fetchCheckoutInfo,
  fetchPaymentPlans,
} from '@/api/billing'
import type { PaymentPlan } from '@/api/types'
import { ApiError } from '@/api/types'
import Button from '@/components/primitives/Button.vue'

const { t } = useI18n()

const plans = ref<PaymentPlan[]>([])
const loading = ref(true)
const error = ref('')
const selected = ref<PaymentPlan | null>(null)
const confirming = ref(false)
const confirmError = ref('')

const visiblePlans = computed(() =>
  plans.value.filter((p) => p.for_sale !== false),
)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const checkout = await fetchCheckoutInfo().catch(() => null)
    if (checkout?.plans?.length) {
      plans.value = checkout.plans
    } else {
      plans.value = await fetchPaymentPlans()
    }
  } catch (err) {
    error.value =
      err instanceof ApiError || err instanceof Error
        ? err.message
        : t('common.error')
  } finally {
    loading.value = false
  }
}

function startSubscribe(plan: PaymentPlan): void {
  selected.value = plan
  confirmError.value = ''
}

function cancelConfirm(): void {
  selected.value = null
  confirmError.value = ''
}

async function confirmPayment(): Promise<void> {
  if (!selected.value) return
  confirming.value = true
  confirmError.value = ''
  try {
    await createPaymentOrder({
      amount: selected.value.price,
      payment_type: 'alipay',
      order_type: 'subscription',
      plan_id: selected.value.id,
    })
    // Real success is not expected from the local mock; if it ever succeeds,
    // surface a generic note without inventing payment completion UX.
    confirmError.value = t('purchase.mockDisabled')
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      confirmError.value = err.message || t('purchase.mockDisabled')
    } else if (err instanceof ApiError || err instanceof Error) {
      confirmError.value = err.message
    } else {
      confirmError.value = t('common.error')
    }
  } finally {
    confirming.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="page">
    <h1>{{ t('pages.purchase') }}</h1>

    <p v-if="loading" role="status">
      {{ t('common.loading') }}
    </p>
    <p v-else-if="error" class="error" role="alert">
      {{ error }}
    </p>
    <p v-else-if="!visiblePlans.length" role="status">
      {{ t('purchase.empty') }}
    </p>

    <template v-else>
      <h2 class="section-title">
        {{ t('purchase.plans') }}
      </h2>
      <ul class="plans">
        <li v-for="plan in visiblePlans" :key="plan.id" class="plan">
          <div class="plan__body">
            <h3>{{ plan.name }}</h3>
            <p class="plan__desc">
              {{ plan.description }}
            </p>
            <p>
              {{ t('purchase.price') }}:
              {{ plan.price }} {{ plan.currency || 'USD' }}
            </p>
            <p v-if="plan.validity_days">
              {{ t('purchase.validity') }}:
              {{ plan.validity_days }} {{ plan.validity_unit || 'day' }}
            </p>
            <ul v-if="plan.features?.length" class="features">
              <li
                v-for="(feature, idx) in plan.features"
                :key="idx"
              >
                {{ feature }}
              </li>
            </ul>
          </div>
          <Button @click="startSubscribe(plan)">
            {{ t('purchase.subscribe') }}
          </Button>
        </li>
      </ul>

      <section
        v-if="selected"
        class="confirm"
        :aria-label="t('purchase.confirmTitle')"
      >
        <h2>{{ t('purchase.confirmTitle') }}</h2>
        <p class="confirm__plan">
          {{ selected.name }}
        </p>
        <p>
          {{ t('purchase.price') }}:
          {{ selected.price }} {{ selected.currency || 'USD' }}
        </p>
        <p v-if="confirmError" class="error" role="alert">
          {{ confirmError }}
        </p>
        <div class="confirm__actions">
          <Button variant="secondary" @click="cancelConfirm">
            {{ t('common.cancel') }}
          </Button>
          <Button :disabled="confirming" @click="confirmPayment">
            {{ t('purchase.confirmPayment') }}
          </Button>
        </div>
      </section>
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

.section-title {
  margin: 0;
  font-size: 1.1rem;
}

.plans {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.85rem;
}

.plan {
  display: flex;
  flex-wrap: wrap;
  gap: 0.85rem;
  justify-content: space-between;
  align-items: flex-start;
  padding: 1rem;
  border-radius: var(--cshell-radius-panel);
  background: var(--cshell-surface);
  border: 1px solid var(--cshell-border);
  min-width: 0;
}

.plan__body {
  flex: 1 1 16rem;
  min-width: 0;
}

.plan h3 {
  margin: 0 0 0.4rem;
  overflow-wrap: anywhere;
}

.plan__desc {
  margin: 0 0 0.5rem;
  color: var(--cshell-text-muted);
  overflow-wrap: anywhere;
}

.plan p {
  margin: 0.2rem 0;
}

.features {
  margin: 0.5rem 0 0;
  padding-left: 1.1rem;
  color: var(--cshell-text-muted);
}

.confirm {
  padding: 1rem;
  border-radius: var(--cshell-radius-panel);
  background: var(--cshell-accent-soft);
  border: 1px solid var(--cshell-border);
}

.confirm h2 {
  margin: 0 0 0.5rem;
  font-size: 1.05rem;
}

.confirm__plan {
  font-weight: 700;
  overflow-wrap: anywhere;
}

.confirm__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.error {
  margin: 0.5rem 0 0;
  color: var(--cshell-danger);
}
</style>
