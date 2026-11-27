<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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

const activeCount = computed(() => summary.value?.active_count ?? 0)
</script>

<template>
  <div class="page">
    <header class="page__head">
      <div class="page__head-text">
        <h1>{{ t('pages.subscriptions') }}</h1>
        <p class="page__subtitle">{{ t('subscriptions.subtitle') }}</p>
      </div>
    </header>

    <p v-if="loading" role="status" class="state">
      {{ t('common.loading') }}
    </p>
    <p v-else-if="error" class="error" role="alert">
      {{ error }}
    </p>

    <div v-else class="content-panel">
      <div class="layout">
        <section class="panel" :aria-labelledby="'subs-list-title'">
          <div class="panel__head">
            <h2 id="subs-list-title" class="panel__title">
              {{ t('subscriptions.listTitle') }}
            </h2>
            <p class="panel__caption">{{ t('subscriptions.listCaption') }}</p>
          </div>

          <p v-if="!items.length" role="status" class="state">
            {{ t('subscriptions.empty') }}
          </p>

          <ul v-else class="list">
            <li v-for="(item, index) in items" :key="item.id ?? index" class="item">
              <div class="item__main">
                <h3 class="item__name">
                  {{ item.plan_name || item.name || `#${item.id ?? index + 1}` }}
                </h3>
                <p class="item__meta">
                  {{ t('subscriptions.status') }}: {{ item.status || '—' }}
                </p>
                <p class="item__meta">
                  {{ t('subscriptions.expires') }}: {{ item.expires_at || '—' }}
                </p>
              </div>
            </li>
          </ul>
        </section>

        <aside class="rail" :aria-labelledby="'subs-meta-title'">
          <h2 id="subs-meta-title" class="panel__title">
            {{ t('subscriptions.metaTitle') }}
          </h2>
          <dl class="facts">
            <div class="fact">
              <dt class="fact__label">{{ t('subscriptions.activeCount') }}</dt>
              <dd class="fact__value">{{ activeCount }}</dd>
            </div>
            <div class="fact">
              <dt class="fact__label">{{ t('subscriptions.totalCount') }}</dt>
              <dd class="fact__value">{{ items.length }}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </div>
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
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.75rem;
}

.page__head-text {
  display: grid;
  gap: 0.3rem;
}

.page h1 {
  margin: 0;
  font-size: var(--cshell-type-page-lg);
  line-height: var(--cshell-leading-page-lg);
  letter-spacing: -0.01em;
}

.page__subtitle {
  margin: 0;
  font-size: var(--cshell-type-body);
  color: var(--cshell-text-muted);
}

.content-panel {
  display: grid;
  gap: 1rem;
  padding: var(--cshell-panel-padding-lg);
  border: 1px solid var(--cshell-border);
  border-radius: var(--cshell-radius-panel-lg);
  background: var(--cshell-surface);
  min-width: 0;
}

.layout {
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

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.25rem;
}

.item {
  display: grid;
  gap: 0.2rem;
  padding: 0.9rem 1rem;
  border-radius: var(--cshell-radius-control);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-bg-elevated);
  min-width: 0;
}

.item__name {
  margin: 0 0 0.2rem;
  font-size: 0.96rem;
  overflow-wrap: anywhere;
}

.item__meta {
  margin: 0;
  color: var(--cshell-text-muted);
  font-size: 0.84rem;
}

.rail {
  display: grid;
  gap: 0.85rem;
  padding: var(--cshell-panel-padding);
  border-radius: var(--cshell-radius-panel);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-surface-muted);
  align-content: start;
  min-width: 0;
}

.facts {
  display: grid;
  gap: 0.7rem;
  margin: 0;
}

.fact {
  display: grid;
  gap: 0.1rem;
}

.fact__label {
  font-size: 0.75rem;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--cshell-text-muted);
}

.fact__value {
  margin: 0;
  font-size: 1.3rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.state {
  margin: 0;
  color: var(--cshell-text-muted);
}

.error {
  margin: 0;
  color: var(--cshell-danger);
}

@media (max-width: 760px) {
  .content-panel {
    padding: var(--cshell-panel-padding-mobile);
  }
}

@media (min-width: 1024px) {
  .layout {
    grid-template-columns: minmax(0, 1fr) 17rem;
    align-items: start;
  }

  .rail {
    position: sticky;
    top: 5rem;
  }
}
</style>
