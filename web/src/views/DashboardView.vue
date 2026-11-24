<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { fetchSubscriptionSummary } from '@/api/billing'
import { fetchDashboardStats, fetchUsageTrend } from '@/api/usage'
import { buildHeatmapDays, buildYearMonthLabels, defaultRangeForScale, weekCountForDays, type HeatmapScale } from '@/utils/heatmap'
import HeatmapGrid from '@/components/user/HeatmapGrid.vue'
import type { TrendPoint } from '@/api/types'
import type { DashboardStats, SubscriptionSummary } from '@/api/types'
import { ApiError } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'

const { t, locale } = useI18n()
const auth = useAuthStore()
const settings = useSettingsStore()

const stats = ref<DashboardStats | null>(null)
const dashboardScale = ref<HeatmapScale>('month')
const dashboardDraftStart = ref('')
const dashboardDraftEnd = ref('')
const dashboardStart = ref('')
const dashboardEnd = ref('')
const dashboardPoints = ref<TrendPoint[]>([])
const dashboardLoading = ref(false)
const dashboardError = ref('')
let dashboardGeneration = 0
let dashboardController: AbortController | null = null
const dashboardMetric = 'requests' as const
const dashboardCells = computed(() => buildHeatmapDays(dashboardPoints.value, dashboardStart.value, dashboardEnd.value, dashboardMetric))
const dashboardWeeks = computed(() => weekCountForDays(dashboardCells.value))
const dashboardLabels = computed(() => buildYearMonthLabels(dashboardCells.value, locale.value === 'zh' ? 'zh' : 'en'))
const dashboardMax = computed(() => Math.max(0, ...dashboardCells.value.filter((cell) => cell.inRange).map((cell) => cell.value)))
const loading = ref(true)
const error = ref('')

const subscription = ref<SubscriptionSummary | null>(null)
const subscriptionLoading = ref(false)

function formatNumber(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
    value,
  )
}

function formatMoney(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  const currency = settings.settings?.billing_currency
  const text = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
  return currency ? `${text} ${currency}` : text
}

const balanceText = computed(() => formatMoney(auth.user?.balance))

const todayMetrics = computed(() => [
  {
    label: t('dashboard.todayRequests'),
    value: formatNumber(stats.value?.today_requests),
  },
  {
    label: t('dashboard.todayTokens'),
    value: formatNumber(stats.value?.today_tokens),
  },
  {
    label: t('dashboard.todayCost'),
    value: formatNumber(stats.value?.today_cost),
  },
  {
    label: t('dashboard.todayActualCost'),
    value: formatNumber(stats.value?.today_actual_cost),
  },
])

const totals = computed(() => [
  {
    label: t('dashboard.totalRequests'),
    value: formatNumber(stats.value?.total_requests),
  },
  {
    label: t('dashboard.totalTokens'),
    value: formatNumber(stats.value?.total_tokens),
  },
  {
    label: t('dashboard.totalCost'),
    value: formatNumber(stats.value?.total_cost),
  },
  {
    label: t('dashboard.totalActualCost'),
    value: formatNumber(stats.value?.total_actual_cost),
  },
  {
    label: t('dashboard.averageDuration'),
    value: formatNumber(stats.value?.average_duration_ms),
  },
  {
    label: t('dashboard.activeKeys'),
    value: formatNumber(stats.value?.active_api_keys),
  },
  {
    label: `${t('dashboard.rpm')} / ${t('dashboard.tpm')}`,
    value: `${formatNumber(stats.value?.rpm)} / ${formatNumber(stats.value?.tpm)}`,
  },
])

const activeSubscriptions = computed(
  () => subscription.value?.active_count ?? null,
)

function setDashboardScale(scale: HeatmapScale): void {
  dashboardScale.value = scale
  const range = defaultRangeForScale(scale)
  dashboardDraftStart.value = range.start
  dashboardDraftEnd.value = range.end
  dashboardStart.value = range.start
  dashboardEnd.value = range.end
  void loadDashboardTrend()
}

async function loadDashboardTrend(): Promise<void> {
  if (!dashboardStart.value || !dashboardEnd.value) return
  dashboardGeneration += 1
  const generation = dashboardGeneration
  dashboardController?.abort()
  const controller = new AbortController()
  dashboardController = controller
  dashboardLoading.value = true
  dashboardError.value = ''
  try {
    const result = await fetchUsageTrend({ start_date: dashboardStart.value, end_date: dashboardEnd.value, granularity: dashboardScale.value === 'hour' ? 'hour' : 'day', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', signal: controller.signal })
    if (generation === dashboardGeneration) dashboardPoints.value = result.trend || []
  } catch (err) {
    if (generation === dashboardGeneration && !(err instanceof Error && err.name === 'AbortError')) dashboardError.value = err instanceof Error ? err.message : t('common.error')
  } finally {
    if (generation === dashboardGeneration) dashboardLoading.value = false
  }
}

function applyDashboardRange(): void {
  if (!dashboardDraftStart.value || !dashboardDraftEnd.value || dashboardDraftStart.value > dashboardDraftEnd.value) return
  dashboardStart.value = dashboardDraftStart.value
  dashboardEnd.value = dashboardDraftEnd.value
  void loadDashboardTrend()
}

async function loadStats(): Promise<void> {
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
}

async function loadSubscription(): Promise<void> {
  if (subscriptionLoading.value) return
  subscriptionLoading.value = true
  try {
    subscription.value = await fetchSubscriptionSummary()
  } catch {
    // A missing summary must not break the dashboard; the card shows a dash.
    subscription.value = null
  } finally {
    subscriptionLoading.value = false
  }
}

watch(
  () => settings.subscriptionEnabled,
  (enabled) => {
    if (enabled && subscription.value === null) void loadSubscription()
  },
  { immediate: true },
)

onMounted(() => {
  const range = defaultRangeForScale('month')
  dashboardDraftStart.value = range.start
  dashboardDraftEnd.value = range.end
  dashboardStart.value = range.start
  dashboardEnd.value = range.end
  void loadStats().then(() => loadDashboardTrend())
})
</script>

<template>
  <div class="page">
    <header class="page__head">
      <div class="page__head-text">
        <h1>{{ t('pages.dashboard') }}</h1>
        <p class="page__subtitle">
          {{ t('dashboard.subtitle') }}
        </p>
      </div>
    </header>

    <p v-if="loading" role="status" class="state">
      {{ t('common.loading') }}
    </p>
    <p v-else-if="error" class="error" role="alert">
      {{ error }}
    </p>

    <div v-else-if="stats" class="layout">
      <div class="main-col">
        <section class="usage-block" :aria-labelledby="'dash-today-title'">
          <div class="usage-block__head">
            <h2 id="dash-today-title" class="section-title">
              {{ t('dashboard.todayTitle') }}
            </h2>
            <p class="section-caption">
              {{ t('dashboard.todayCaption') }}
            </p>
          </div>
          <dl class="metric-strip">
            <div v-for="item in todayMetrics" :key="item.label" class="metric">
              <dd class="metric__value">{{ item.value }}</dd>
              <dt class="metric__caption">{{ item.label }}</dt>
            </div>
          </dl>
        </section>

        <section class="usage-block dashboard-trend" aria-labelledby="dashboard-trend-title">
          <div class="usage-block__head">
            <h2 id="dashboard-trend-title" class="section-title">{{ t('usage.heatmapTitle') }}</h2>
            <p class="section-caption">{{ t('usage.heatmapCaption') }}</p>
          </div>
          <div class="dashboard-filters">
            <label><span>{{ t('usage.startDate') }}</span><input v-model="dashboardDraftStart" type="date"></label>
            <label><span>{{ t('usage.endDate') }}</span><input v-model="dashboardDraftEnd" type="date"></label>
            <button type="button" @click="applyDashboardRange">{{ t('common.apply') }}</button>
            <div class="segmented" role="group" :aria-label="t('usage.scaleLabel')">
              <button v-for="item in ['month', 'year', 'multi-year'] as const" :key="item" type="button" :aria-pressed="dashboardScale === item" @click="setDashboardScale(item)">{{ t(`usage.scale${item === 'multi-year' ? 'MultiYear' : item[0].toUpperCase() + item.slice(1)}`) }}</button>
            </div>
          </div>
          <p class="section-caption" role="status">{{ dashboardStart }} — {{ dashboardEnd }} · {{ Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }}</p>
          <p v-if="dashboardLoading" role="status" class="state">{{ t('common.loading') }}</p>
          <p v-else-if="dashboardError" role="alert" class="error">{{ dashboardError }}</p>
          <HeatmapGrid v-else :scale="dashboardScale" :hour-cells="[]" :day-cells="dashboardCells" :month-cells="[]" :week-count="dashboardWeeks" :month-labels="dashboardLabels" :weekday-labels="[t('usage.weekdays.sun'), t('usage.weekdays.mon'), t('usage.weekdays.tue'), t('usage.weekdays.wed'), t('usage.weekdays.thu'), t('usage.weekdays.fri'), t('usage.weekdays.sat')]" :max-value="dashboardMax" :metric="dashboardMetric" :translate="t" />
        </section>

        <section class="totals" :aria-labelledby="'dash-totals-title'">
          <div class="totals__head">
            <h2 id="dash-totals-title" class="section-title">
              {{ t('dashboard.totalsTitle') }}
            </h2>
            <p class="section-caption">
              {{ t('dashboard.totalsCaption') }}
            </p>
          </div>
          <div class="totals__grid">
            <article v-for="item in totals" :key="item.label" class="total-card">
              <p class="total-card__value">{{ item.value }}</p>
              <p class="total-card__caption">{{ item.label }}</p>
            </article>
          </div>
        </section>

        <section class="quick" :aria-label="t('dashboard.quickLinks')">
          <h2 class="section-title">{{ t('dashboard.quickLinks') }}</h2>
          <div class="quick__row">
            <RouterLink class="quick__link" :to="{ name: 'usage' }">
              {{ t('dashboard.linkUsage') }}
            </RouterLink>
            <RouterLink class="quick__link" :to="{ name: 'keys' }">
              {{ t('dashboard.linkKeys') }}
            </RouterLink>
            <RouterLink
              v-if="settings.paymentEnabled || settings.subscriptionEnabled"
              class="quick__link"
              :to="{ name: 'purchase' }"
            >
              {{ t('dashboard.linkPurchase') }}
            </RouterLink>
          </div>
        </section>
      </div>

      <aside class="rail" :aria-label="t('dashboard.railLabel')">
        <article class="rail-card">
          <h2 class="rail-card__title">{{ t('dashboard.balanceTitle') }}</h2>
          <p class="rail-card__value">{{ balanceText }}</p>
          <p class="rail-card__caption">{{ t('dashboard.balanceCaption') }}</p>
        </article>

        <article v-if="settings.subscriptionEnabled" class="rail-card">
          <h2 class="rail-card__title">{{ t('dashboard.planTitle') }}</h2>
          <p class="rail-card__value">
            {{
              subscriptionLoading
                ? t('common.loading')
                : activeSubscriptions === null
                  ? '—'
                  : activeSubscriptions
            }}
          </p>
          <p class="rail-card__caption">{{ t('dashboard.planCaption') }}</p>
          <RouterLink class="rail-card__link" :to="{ name: 'subscriptions' }">
            {{ t('dashboard.linkSubscriptions') }}
          </RouterLink>
        </article>

        <article class="rail-card">
          <h2 class="rail-card__title">{{ t('dashboard.quickLinks') }}</h2>
          <div class="rail-card__links">
            <RouterLink class="rail-card__link" :to="{ name: 'keys' }">
              {{ t('dashboard.linkKeys') }}
            </RouterLink>
            <RouterLink class="rail-card__link" :to="{ name: 'profile' }">
              {{ t('dashboard.linkProfile') }}
            </RouterLink>
            <RouterLink
              v-if="settings.paymentEnabled || settings.subscriptionEnabled"
              class="rail-card__link"
              :to="{ name: 'orders' }"
            >
              {{ t('dashboard.linkOrders') }}
            </RouterLink>
          </div>
        </article>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: var(--cshell-space-6);
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
  color: var(--cshell-text-muted);
  font-size: var(--cshell-type-body);
}

.layout {
  display: grid;
  gap: var(--cshell-space-6);
  align-items: start;
  min-width: 0;
}

.main-col {
  display: grid;
  gap: var(--cshell-space-6);
  min-width: 0;
}

.section-title {
  margin: 0;
  font-size: 1.05rem;
}

.section-caption {
  margin: 0.15rem 0 0;
  font-size: 0.84rem;
  color: var(--cshell-text-muted);
}

.usage-block {
  display: grid;
  gap: 1.1rem;
  padding: var(--cshell-panel-padding);
  border-radius: var(--cshell-radius-panel);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-surface);
  min-width: 0;
}

.dashboard-filters { display:flex; flex-wrap:wrap; gap:.5rem; align-items:end; }
.dashboard-filters label { display:grid; gap:.2rem; font-size:.75rem; color:var(--cshell-text-muted); }
.dashboard-filters button { min-height:2rem; }
.dashboard-trend :deep(.day-layout) { min-width:18rem; }
.usage-block__head {
  display: grid;
  gap: 0.1rem;
}

.metric-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1rem;
  margin: 0;
  padding-top: 1.1rem;
  border-top: 1px solid var(--cshell-border);
}

.metric {
  display: grid;
  gap: 0.2rem;
  min-width: 0;
}

.metric__value {
  margin: 0;
  font-size: clamp(1.3rem, 2.4vw, 1.75rem);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.metric__caption {
  font-size: 0.8rem;
  color: var(--cshell-text-muted);
}

.totals {
  display: grid;
  gap: 0.85rem;
  min-width: 0;
}

.totals__head {
  display: grid;
  gap: 0.1rem;
}

.totals__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
}

.total-card {
  padding: 1rem 1.1rem;
  border-radius: var(--cshell-radius-panel);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-surface);
  min-width: 0;
}

.total-card__value {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.total-card__caption {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  color: var(--cshell-text-muted);
}

.quick {
  display: grid;
  gap: 0.7rem;
}

.quick__row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.quick__link {
  display: inline-flex;
  align-items: center;
  min-height: 2.5rem;
  padding: 0.4rem 0.9rem;
  border-radius: var(--cshell-radius-control);
  background: var(--cshell-surface);
  border: 1px solid var(--cshell-border);
  color: var(--cshell-text);
  text-decoration: none;
  font-weight: 600;
  font-size: 0.9rem;
}

.quick__link:hover {
  border-color: var(--cshell-accent);
}

.rail {
  display: grid;
  gap: 0.85rem;
  min-width: 0;
}

.rail-card {
  display: grid;
  gap: 0.35rem;
  padding: var(--cshell-panel-padding);
  border-radius: var(--cshell-radius-panel);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-bg-elevated);
  min-width: 0;
}

.rail-card__title {
  margin: 0;
  font-size: var(--cshell-type-caption);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--cshell-text-muted);
}

.rail-card__value {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.rail-card__caption {
  margin: 0;
  font-size: var(--cshell-type-caption);
  color: var(--cshell-text-muted);
  line-height: 1.5;
}

.rail-card__links {
  display: grid;
  gap: 0.25rem;
}

.rail-card__link {
  display: inline-flex;
  align-items: center;
  min-height: 2.25rem;
  font-size: 0.86rem;
  color: var(--cshell-accent);
  text-decoration: none;
}

.rail-card__link:hover {
  text-decoration: underline;
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
  .metric-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    row-gap: 1.25rem;
  }
}

@media (min-width: 1200px) {
  .layout {
    grid-template-columns: minmax(0, 1fr) 17rem;
  }

  .rail {
    position: sticky;
    top: 5rem;
  }
}

@media (max-width: 1023px) {
  .quick__link,
  .rail-card__link {
    min-height: 44px;
  }
}
</style>
