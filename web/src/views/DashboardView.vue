<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { fetchDashboardStats } from '@/api/usage'
import type { DashboardStats } from '@/api/types'
import { ApiError } from '@/api/types'

const { t } = useI18n()

const stats = ref<DashboardStats | null>(null)
const loading = ref(true)
const error = ref('')

function formatNumber(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
    value,
  )
}

onMounted(async () => {
  loading.value = true
  error.value = ''
  try {
    stats.value = await fetchDashboardStats()
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
    <h1>{{ t('pages.dashboard') }}</h1>

    <p v-if="loading" role="status">
      {{ t('common.loading') }}
    </p>
    <p v-else-if="error" class="error" role="alert">
      {{ error }}
    </p>

    <template v-else-if="stats">
      <div class="cards">
        <article class="card">
          <h2>{{ t('dashboard.todayRequests') }}</h2>
          <p class="card__value">
            {{ formatNumber(stats.today_requests) }}
          </p>
        </article>
        <article class="card">
          <h2>{{ t('dashboard.todayTokens') }}</h2>
          <p class="card__value">
            {{ formatNumber(stats.today_tokens) }}
          </p>
        </article>
        <article class="card">
          <h2>{{ t('dashboard.todayCost') }}</h2>
          <p class="card__value">
            {{ formatNumber(stats.today_cost) }}
          </p>
        </article>
        <article class="card">
          <h2>{{ t('dashboard.totalRequests') }}</h2>
          <p class="card__value">
            {{ formatNumber(stats.total_requests) }}
          </p>
        </article>
        <article class="card">
          <h2>{{ t('dashboard.totalTokens') }}</h2>
          <p class="card__value">
            {{ formatNumber(stats.total_tokens) }}
          </p>
        </article>
        <article class="card">
          <h2>{{ t('dashboard.totalCost') }}</h2>
          <p class="card__value">
            {{ formatNumber(stats.total_cost) }}
          </p>
        </article>
        <article class="card">
          <h2>{{ t('dashboard.activeKeys') }}</h2>
          <p class="card__value">
            {{ formatNumber(stats.active_api_keys) }}
          </p>
        </article>
        <article class="card">
          <h2>{{ t('dashboard.rpm') }} / {{ t('dashboard.tpm') }}</h2>
          <p class="card__value">
            {{ formatNumber(stats.rpm) }} / {{ formatNumber(stats.tpm) }}
          </p>
        </article>
      </div>

      <section class="links" :aria-label="t('dashboard.quickLinks')">
        <h2>{{ t('dashboard.quickLinks') }}</h2>
        <div class="links__row">
          <RouterLink class="link" :to="{ name: 'usage' }">
            {{ t('dashboard.linkUsage') }}
          </RouterLink>
          <RouterLink class="link" :to="{ name: 'keys' }">
            {{ t('dashboard.linkKeys') }}
          </RouterLink>
          <RouterLink class="link" :to="{ name: 'purchase' }">
            {{ t('dashboard.linkPurchase') }}
          </RouterLink>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: 1.25rem;
  min-width: 0;
}

.page h1 {
  margin: 0;
  font-size: 1.55rem;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(11.5rem, 1fr));
  gap: 0.85rem;
}

.card {
  padding: 1rem;
  border-radius: var(--cshell-radius-panel);
  background: var(--cshell-surface);
  border: 1px solid var(--cshell-border);
  box-shadow: var(--cshell-shadow);
  min-width: 0;
}

.card h2 {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--cshell-text-muted);
}

.card__value {
  margin: 0.45rem 0 0;
  font-size: 1.45rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.links h2 {
  margin: 0 0 0.65rem;
  font-size: 1rem;
}

.links__row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
}

.link {
  display: inline-flex;
  align-items: center;
  min-height: 2.5rem;
  padding: 0.4rem 0.9rem;
  border-radius: var(--cshell-radius-control);
  background: var(--cshell-accent-soft);
  color: var(--cshell-text);
  text-decoration: none;
  font-weight: 600;
}

.error {
  margin: 0;
  color: var(--cshell-danger);
}
</style>
