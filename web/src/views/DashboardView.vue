<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { fetchMyOrders, fetchSubscriptionSummary } from '@/api/billing'
import { fetchKeys } from '@/api/keys'
import { fetchDashboardStats, fetchUsageTrend } from '@/api/usage'
import { buildHeatmapDays, buildYearMonthLabels, defaultRangeForScale, weekCountForDays, type HeatmapScale } from '@/utils/heatmap'
import UsageTrendChart from '@/components/user/UsageTrendChart.vue'
import { buildTrendSeries } from '@/utils/trendChart'
import {
  loadTrendViewMode,
  saveTrendViewMode,
  type TrendViewMode,
} from '@/lib/viewPreference'
import type { TrendPoint } from '@/api/types'
import type { ApiKey, DashboardStats, SubscriptionSummary } from '@/api/types'
import { ApiError } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'

const { t, locale } = useI18n()
const auth = useAuthStore()
const settings = useSettingsStore()

const stats = ref<DashboardStats | null>(null)
const dashboardScale = ref<HeatmapScale>('month')
/** Dashboard keeps its own persisted view choice, separate from Usage. */
const DASH_VIEW_STORAGE_KEY = 'cshell_dash_view'
const dashboardViewMode = ref<TrendViewMode>(
  loadTrendViewMode(DASH_VIEW_STORAGE_KEY),
)

function onDashboardViewMode(next: TrendViewMode): void {
  dashboardViewMode.value = next
  saveTrendViewMode(DASH_VIEW_STORAGE_KEY, next)
}
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
/** Line-chart series for the dashboard trend panel; derived from the loaded points. */
const dashboardTrendSeries = computed(() => buildTrendSeries(dashboardPoints.value, dashboardMetric))
const dashboardViewModes: { id: 'heatmap' | 'line'; labelKey: string }[] = [
  { id: 'heatmap', labelKey: 'usage.viewHeatmap' },
  { id: 'line', labelKey: 'usage.viewLine' },
]
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

/** Welcome text falls back to the email local-part when no username exists. */
const displayName = computed(() => auth.user?.username || auth.user?.email || '')

/** Real, client-side filtered pending counts. Nothing here is fabricated. */
const pendingOrdersCount = ref<number | null>(null)
const pendingKeysCount = ref<number | null>(null)

/** Keys expiring within 7 days (or already expired but still listed). */
const EXPIRY_WINDOW_DAYS = 7
const EXPIRY_WINDOW_MS = EXPIRY_WINDOW_DAYS * 24 * 60 * 60 * 1000

function isExpiringSoon(key: ApiKey): boolean {
  if (!key.expires_at) return false
  const expiresAt = Date.parse(key.expires_at)
  if (!Number.isFinite(expiresAt)) return false
  return expiresAt <= Date.now() + EXPIRY_WINDOW_MS
}

async function loadPending(): Promise<void> {
  // Failures degrade to "unknown" (—) instead of breaking the dashboard.
  fetchMyOrders(1, 20, { status: 'PENDING' })
    .then((result) => {
      pendingOrdersCount.value = result.total ?? result.items?.length ?? 0
    })
    .catch(() => {
      pendingOrdersCount.value = null
    })
  fetchKeys(1, 100)
    .then((result) => {
      pendingKeysCount.value = (result.items || []).filter(isExpiringSoon).length
    })
    .catch(() => {
      pendingKeysCount.value = null
    })
}

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

/** Refresh every dashboard data source; failures degrade, never break the page. */
async function refreshAll(): Promise<void> {
  await loadStats()
  await loadDashboardTrend()
  void loadPending()
}

onMounted(() => {
  const range = defaultRangeForScale('month')
  dashboardDraftStart.value = range.start
  dashboardDraftEnd.value = range.end
  dashboardStart.value = range.start
  dashboardEnd.value = range.end
  void loadStats().then(() => loadDashboardTrend())
  void loadPending()
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
      <div class="page__welcome">
        <span v-if="displayName" class="page__welcome-text">
          {{ t('dashboard.welcome', { username: displayName }) }}
        </span>
        <button type="button" class="page__refresh" @click="refreshAll">
          {{ t('dashboard.refresh') }}
        </button>
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
          <p v-if="!stats.today_requests && !stats.today_tokens && !stats.today_cost && !stats.today_actual_cost" class="empty-state" role="status">
            {{ t('dashboard.emptyState') }}
          </p>
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
            <div class="segmented" role="group" :aria-label="t('usage.viewLabel')">
              <button v-for="item in dashboardViewModes" :key="item.id" type="button" :aria-pressed="dashboardViewMode === item.id" @click="onDashboardViewMode(item.id)">{{ t(item.labelKey) }}</button>
            </div>
            <div class="segmented" role="group" :aria-label="t('usage.scaleLabel')">
              <button v-for="item in ['month', 'year', 'multi-year'] as const" :key="item" type="button" :aria-pressed="dashboardScale === item" @click="setDashboardScale(item)">{{ t(`usage.scale${item === 'multi-year' ? 'MultiYear' : item[0].toUpperCase() + item.slice(1)}`) }}</button>
            </div>
          </div>
          <p class="section-caption" role="status">{{ dashboardStart }} — {{ dashboardEnd }} · {{ Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }}</p>
          <p v-if="dashboardLoading" role="status" class="state">{{ t('common.loading') }}</p>
          <p v-else-if="dashboardError" role="alert" class="error">{{ dashboardError }}</p>
          <UsageTrendChart v-else compact :scale="dashboardScale" :series="dashboardTrendSeries" :metric="dashboardMetric" :day-cells="dashboardCells" :week-count="dashboardWeeks" :month-labels="dashboardLabels" :weekday-labels="[t('usage.weekdays.sun'), t('usage.weekdays.mon'), t('usage.weekdays.tue'), t('usage.weekdays.wed'), t('usage.weekdays.thu'), t('usage.weekdays.fri'), t('usage.weekdays.sat')]" :max-value="dashboardMax" :view-mode="dashboardViewMode" :translate="t" />
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
      </div>

      <aside class="rail" :aria-label="t('dashboard.railLabel')">
        <article class="rail-card">
          <h2 class="rail-card__title">{{ t('dashboard.balanceTitle') }}</h2>
          <p class="rail-card__value rail-card__value--big">{{ balanceText }}</p>
          <p class="rail-card__caption">{{ t('dashboard.balanceCaption') }}</p>
          <div class="rail-card__links">
            <RouterLink class="rail-card__link" :to="{ name: 'profile' }">
              {{ t('dashboard.balanceDetail') }}
            </RouterLink>
            <RouterLink
              v-if="settings.paymentEnabled"
              class="rail-card__link"
              :to="{ name: 'purchase' }"
            >
              {{ t('dashboard.balanceRecharge') }}
            </RouterLink>
          </div>
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
          <div class="rail-card__links">
            <RouterLink class="rail-card__link" :to="{ name: 'subscriptions' }">
              {{ t('dashboard.linkSubscriptions') }}
            </RouterLink>
          </div>
        </article>

        <article class="rail-card" :aria-labelledby="'dash-pending-title'">
          <h2 id="dash-pending-title" class="rail-card__title">
            {{ t('dashboard.pendingTitle') }}
          </h2>
          <p class="rail-card__caption">{{ t('dashboard.pendingCaption') }}</p>
          <ul class="pending-list">
            <li class="pending-list__row">
              <span class="pending-list__label">
                {{ t('dashboard.pendingOrders') }}
              </span>
              <RouterLink class="pending-list__value" :to="{ name: 'orders' }">
                {{ pendingOrdersCount === null ? '—' : pendingOrdersCount }}
              </RouterLink>
            </li>
            <li class="pending-list__row">
              <span class="pending-list__label">
                {{ t('dashboard.pendingKeys') }}
              </span>
              <RouterLink class="pending-list__value" :to="{ name: 'keys' }">
                {{ pendingKeysCount === null ? '—' : pendingKeysCount }}
              </RouterLink>
            </li>
          </ul>
          <p
            v-if="pendingOrdersCount === 0 && pendingKeysCount === 0"
            class="pending-list__empty"
            role="status"
          >
            {{ t('dashboard.pendingEmpty') }}
          </p>
        </article>

        <article class="rail-card">
          <h2 class="rail-card__title">{{ t('dashboard.helpTitle') }}</h2>
          <div class="rail-card__links">
            <RouterLink class="rail-card__link" :to="{ name: 'profile' }">
              {{ t('dashboard.helpProfile') }}
            </RouterLink>
            <RouterLink class="rail-card__link" :to="{ name: 'dashboard' }">
              {{ t('dashboard.helpOverview') }}
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

.page__welcome {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}

.page__welcome-text {
  font-size: var(--cshell-type-body);
  color: var(--cshell-text-muted);
}

.page__refresh {
  min-height: 2.25rem;
  padding: 0.3rem 0.9rem;
  border-radius: var(--cshell-radius-control);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-surface);
  color: var(--cshell-text);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}

.page__refresh:hover {
  border-color: var(--cshell-accent);
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
  padding: var(--cshell-panel-padding-lg);
  border-radius: var(--cshell-radius-panel-lg);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-surface);
  min-width: 0;
}

.dashboard-filters { display:flex; flex-wrap:wrap; gap:.5rem; align-items:end; }
.dashboard-filters label { display:grid; gap:.2rem; font-size:.75rem; color:var(--cshell-text-muted); }
.dashboard-filters button { min-height:2rem; }
.segmented { display:inline-flex; flex-wrap:wrap; gap:.2rem; width:fit-content; max-width:100%; padding:.2rem; border-radius:var(--cshell-radius-control); border:1px solid var(--cshell-border); background:var(--cshell-bg-elevated); }
.segmented__btn { min-height:2rem; padding:.25rem .65rem; border:0; border-radius:calc(var(--cshell-radius-control) - 3px); background:transparent; color:var(--cshell-text-muted); font-size:.82rem; cursor:pointer; }
.segmented__btn[aria-pressed='true'] { background:var(--cshell-surface); color:var(--cshell-text); font-weight:600; box-shadow:0 1px 2px rgba(44, 36, 28, 0.1); }
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
  padding: var(--cshell-panel-padding-lg);
  border-radius: var(--cshell-radius-panel-lg);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-surface);
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
  background: var(--cshell-bg-elevated);
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

.empty-state {
  margin: 0;
  padding: 1.25rem 0;
  text-align: center;
  color: var(--cshell-text-muted);
  font-size: var(--cshell-type-small);
}

.rail {
  display: grid;
  gap: 1rem;
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

.rail-card__value--big {
  font-size: clamp(1.75rem, 3vw, 2.25rem);
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

.pending-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0;
}

.pending-list__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.55rem 0;
  border-bottom: 1px solid var(--cshell-border);
  min-width: 0;
}

.pending-list__row:last-child {
  border-bottom: 0;
}

.pending-list__label {
  font-size: 0.86rem;
  color: var(--cshell-text);
  min-width: 0;
  overflow-wrap: anywhere;
}

.pending-list__value {
  font-size: 1.05rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--cshell-accent);
  text-decoration: none;
  white-space: nowrap;
}

.pending-list__value:hover {
  text-decoration: underline;
}

.pending-list__empty {
  margin: 0.35rem 0 0;
  font-size: 0.86rem;
  color: var(--cshell-text-muted);
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

  .page__welcome {
    width: 100%;
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
  .rail-card__link,
  .pending-list__value {
    min-height: 44px;
  }

  .segmented__btn {
    min-height: 44px;
  }
}
</style>
