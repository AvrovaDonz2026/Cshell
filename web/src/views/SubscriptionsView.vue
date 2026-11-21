<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  fetchSubscriptionSummary,
  fetchSubscriptions,
} from '@/api/billing'
import type { SubscriptionItem, SubscriptionSummary } from '@/api/types'
import { ApiError } from '@/api/types'

const { t } = useI18n()

const summary = ref<SubscriptionSummary | null>(null)
const items = ref<SubscriptionItem[]>([])
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  loading.value = true
  error.value = ''
  try {
    const [sum, list] = await Promise.all([
      fetchSubscriptionSummary(),
      fetchSubscriptions().catch(() => [] as SubscriptionItem[]),
    ])
    summary.value = sum
    const fromSummary = sum.subscriptions || []
    items.value = fromSummary.length ? fromSummary : list || []
  } catch (err) {
    error.value =
      err instanceof ApiError || err instanceof Error
        ? err.message
        : t('common.error')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="page">
    <h1>{{ t('pages.subscriptions') }}</h1>

    <p v-if="loading" role="status">
      {{ t('common.loading') }}
    </p>
    <p v-else-if="error" class="error" role="alert">
      {{ error }}
    </p>

    <template v-else>
      <p class="summary">
        {{ t('subscriptions.activeCount') }}:
        <strong>{{ summary?.active_count ?? 0 }}</strong>
      </p>

      <p v-if="!items.length" role="status">
        {{ t('subscriptions.empty') }}
      </p>

      <ul v-else class="list">
        <li v-for="(item, index) in items" :key="item.id ?? index" class="item">
          <h2>{{ item.plan_name || item.name || `#${item.id ?? index + 1}` }}</h2>
          <p>
            {{ t('subscriptions.status') }}: {{ item.status || '—' }}
          </p>
          <p>
            {{ t('subscriptions.expires') }}: {{ item.expires_at || '—' }}
          </p>
        </li>
      </ul>
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

.summary {
  margin: 0;
  padding: 0.85rem 1rem;
  border-radius: var(--cshell-radius-panel);
  background: var(--cshell-surface);
  border: 1px solid var(--cshell-border);
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.75rem;
}

.item {
  padding: 1rem;
  border-radius: var(--cshell-radius-panel);
  background: var(--cshell-surface);
  border: 1px solid var(--cshell-border);
  min-width: 0;
}

.item h2 {
  margin: 0 0 0.4rem;
  font-size: 1rem;
  overflow-wrap: anywhere;
}

.item p {
  margin: 0.2rem 0;
  color: var(--cshell-text-muted);
  font-size: 0.9rem;
}

.error {
  margin: 0;
  color: var(--cshell-danger);
}
</style>
