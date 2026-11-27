<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { fetchUsageLogs, fetchUsageTrend } from '@/api/usage'
import type { TrendResponse, UsageLog } from '@/api/types'
import { ApiError } from '@/api/types'
import Button from '@/components/primitives/Button.vue'
import Input from '@/components/primitives/Input.vue'
import UsageTrendChart from '@/components/user/UsageTrendChart.vue'
import { buildTrendSeries } from '@/utils/trendChart'
import {
  loadTrendViewMode,
  saveTrendViewMode,
  type TrendViewMode,
} from '@/lib/viewPreference'
import {
  buildHeatmapDays,
  buildHeatmapHours,
  buildHeatmapMonths,
  buildYearMonthLabels,
  defaultRangeForScale,
  type HeatmapMetric,
  type HeatmapScale,
  weekCountForDays,
} from '@/utils/heatmap'
import {
  maxSpanDays,
  validateRange,
  type UsageRangeError,
} from '@/lib/usageRange'

const { t, locale } = useI18n()

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const scale = ref<HeatmapScale>('month')
const metric = ref<HeatmapMetric>('requests')
/** View choice persists per view under its own localStorage key. */
const USAGE_VIEW_STORAGE_KEY = 'cshell_usage_view'
const viewMode = ref<TrendViewMode>(
  loadTrendViewMode(USAGE_VIEW_STORAGE_KEY),
)

function onViewMode(next: TrendViewMode): void {
  viewMode.value = next
  saveTrendViewMode(USAGE_VIEW_STORAGE_KEY, next)
}

/** Draft filters: edited by the date inputs only. */
const draftStart = ref('')
const draftEnd = ref('')

/** Applied filters: the only dates used for heatmap + API requests. */
const appliedStart = ref('')
const appliedEnd = ref('')

const rangeError = ref<UsageRangeError | ''>('')
const trend = ref<TrendResponse | null>(null)
const loading = ref(false)
const error = ref('')

const logs = ref<UsageLog[]>([])
const logsPage = ref(1)
const logsPages = ref(1)
const logsLoading = ref(false)
const logsError = ref('')

/**
 * Monotonic request generation. Every load cycle increments `loadGen`,
 * captures the value, and only applies its result while the captured
 * generation is still the latest — so out-of-order or stale responses from
 * older filters can never overwrite newer data.
 */
let loadGen = 0
let trendController: AbortController | null = null
let logsController: AbortController | null = null

const viewModes: { id: 'heatmap' | 'line'; labelKey: string }[] = [
  { id: 'heatmap', labelKey: 'usage.viewHeatmap' },
  { id: 'line', labelKey: 'usage.viewLine' },
]

const scales: { id: HeatmapScale; labelKey: string }[] = [
  { id: 'hour', labelKey: 'usage.scaleHour' },
  { id: 'month', labelKey: 'usage.scaleMonth' },
  { id: 'year', labelKey: 'usage.scaleYear' },
  { id: 'multi-year', labelKey: 'usage.scaleMultiYear' },
]

const metrics: { id: HeatmapMetric; labelKey: string }[] = [
  { id: 'requests', labelKey: 'usage.metricRequests' },
  { id: 'tokens', labelKey: 'usage.metricTokens' },
  { id: 'input', labelKey: 'usage.metricInput' },
  { id: 'output', labelKey: 'usage.metricOutput' },
  { id: 'cost', labelKey: 'usage.metricCost' },
  { id: 'actual_cost', labelKey: 'usage.metricActualCost' },
]

const weekdayLabels = computed(() => [
  t('usage.weekdays.sun'),
  t('usage.weekdays.mon'),
  t('usage.weekdays.tue'),
  t('usage.weekdays.wed'),
  t('usage.weekdays.thu'),
  t('usage.weekdays.fri'),
  t('usage.weekdays.sat'),
])

const points = computed(() => trend.value?.trend || [])
const models = computed(() => trend.value?.models || [])

const appliedRangeText = computed(() =>
  t('usage.appliedRange', {
    start: appliedStart.value || '—',
    end: appliedEnd.value || '—',
  }),
)

const rangeLimitText = computed(() =>
  t('usage.rangeLimit', { days: maxSpanDays(scale.value) }),
)

const rangeErrorText = computed(() =>
  rangeError.value
    ? t(rangeError.value, { days: maxSpanDays(scale.value) })
    : '',
)

function formatNumber(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(
    value,
  )
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: string }).name === 'AbortError'
  )
}

function abortTrend(): void {
  trendController?.abort()
  trendController = null
}

function abortLogs(): void {
  logsController?.abort()
  logsController = null
}

/**
 * Begin a load cycle: bump the generation, cancel in-flight requests from
 * older cycles, and hand the new generation to the requests of this cycle.
 */
function startCycle(): number {
  loadGen += 1
  abortTrend()
  abortLogs()
  return loadGen
}

function resetToScaleDefault(next: HeatmapScale): void {
  const range = defaultRangeForScale(next)
  draftStart.value = range.start
  draftEnd.value = range.end
  appliedStart.value = range.start
  appliedEnd.value = range.end
  rangeError.value = ''
}

async function loadTrend(gen: number): Promise<void> {
  if (!appliedStart.value || !appliedEnd.value) return
  const controller = new AbortController()
  trendController = controller
  loading.value = true
  error.value = ''
  try {
    const granularity = scale.value === 'hour' ? 'hour' : 'day'
    const data = await fetchUsageTrend({
      start_date: appliedStart.value,
      end_date: appliedEnd.value,
      granularity,
      timezone,
      signal: controller.signal,
    })
    if (gen !== loadGen) return
    trend.value = data
  } catch (err) {
    if (isAbortError(err) || gen !== loadGen) return
    trend.value = null
    error.value =
      err instanceof ApiError || err instanceof Error
        ? err.message
        : t('common.error')
  } finally {
    if (gen === loadGen) {
      loading.value = false
      if (trendController === controller) trendController = null
    }
  }
}

async function loadLogs(gen: number, nextPage = logsPage.value): Promise<void> {
  if (!appliedStart.value || !appliedEnd.value) return
  const controller = new AbortController()
  logsController = controller
  logsLoading.value = true
  logsError.value = ''
  try {
    const data = await fetchUsageLogs({
      page: nextPage,
      page_size: 20,
      start_date: appliedStart.value,
      end_date: appliedEnd.value,
      timezone,
      signal: controller.signal,
    })
    if (gen !== loadGen) return
    logs.value = data.items || []
    logsPage.value = data.page || nextPage
    logsPages.value = Math.max(1, data.pages || 1)
  } catch (err) {
    if (isAbortError(err) || gen !== loadGen) return
    logs.value = []
    logsError.value =
      err instanceof ApiError || err instanceof Error
        ? err.message
        : t('common.error')
  } finally {
    if (gen === loadGen) {
      logsLoading.value = false
      if (logsController === controller) logsController = null
    }
  }
}

async function refreshAll(): Promise<void> {
  const gen = startCycle()
  await Promise.all([loadTrend(gen), loadLogs(gen, 1)])
}

/** Logs pagination keeps the applied dates and starts a fresh cycle. */
async function goToLogsPage(nextPage: number): Promise<void> {
  const gen = startCycle()
  await loadLogs(gen, nextPage)
}

/** Validate the draft range, then copy it into the applied filters and load. */
async function applyRange(): Promise<void> {
  const result = validateRange(draftStart.value, draftEnd.value, scale.value)
  if (!result.ok) {
    rangeError.value = result.error
    return
  }
  rangeError.value = ''
  appliedStart.value = result.start
  appliedEnd.value = result.end
  draftStart.value = result.start
  draftEnd.value = result.end
  await refreshAll()
}

function onScale(next: HeatmapScale): void {
  scale.value = next
  resetToScaleDefault(next)
  void refreshAll()
}

const hourCells = computed(() =>
  buildHeatmapHours(
    points.value,
    appliedStart.value || appliedEnd.value,
    metric.value,
  ),
)

const dayCells = computed(() =>
  buildHeatmapDays(
    points.value,
    appliedStart.value,
    appliedEnd.value,
    metric.value,
  ),
)

const monthCells = computed(() =>
  buildHeatmapMonths(
    points.value,
    appliedStart.value,
    appliedEnd.value,
    metric.value,
  ),
)

const weekCount = computed(() => weekCountForDays(dayCells.value))

const monthLabels = computed(() =>
  buildYearMonthLabels(dayCells.value, locale.value === 'ru' ? 'ru-RU' : locale.value === 'zh' ? 'zh' : 'en'),
)

const maxValue = computed(() => {
  const values =
    scale.value === 'hour'
      ? hourCells.value.map((c) => c.value)
      : scale.value === 'multi-year'
        ? monthCells.value.map((c) => c.value)
        : dayCells.value.filter((c) => c.inRange).map((c) => c.value)
  return Math.max(0, ...values, 0)
})

/**
 * Line-chart series derived from the same loaded points as the heatmap —
 * metric switching is pure re-derivation, no new API calls.
 */
const trendSeries = computed(() =>
  buildTrendSeries(points.value, metric.value),
)


onMounted(() => {
  resetToScaleDefault(scale.value)
  void refreshAll()
})
</script>

<template>
  <div class="page">
    <header class="page__head">
      <div class="page__head-text">
        <h1>{{ t('pages.usage') }}</h1>
        <p class="page__subtitle">{{ t('usage.subtitle') }}</p>
      </div>
      <div class="page__actions">
        <Button variant="secondary" @click="applyRange">
          {{ t('common.apply') }}
        </Button>
      </div>
    </header>

    <div class="toolbar">
      <label class="field">
        <span class="field__label">{{ t('usage.startDate') }}</span>
        <Input v-model="draftStart" type="date" />
      </label>
      <label class="field">
        <span class="field__label">{{ t('usage.endDate') }}</span>
        <Input v-model="draftEnd" type="date" />
      </label>
      <p class="toolbar__meta">
        {{ t('usage.timezone') }}: {{ timezone }}
      </p>
    </div>

    <div class="applied">
      <p class="applied__text" role="status">
        {{ appliedRangeText }}
      </p>
      <p class="applied__hint">
        {{ rangeLimitText }}
      </p>
      <p v-if="rangeErrorText" class="error" role="alert">
        {{ rangeErrorText }}
      </p>
    </div>

    <div class="strip">
      <div class="segmented" role="group" :aria-label="t('usage.viewLabel')">
        <button
          v-for="item in viewModes"
          :key="item.id"
          type="button"
          class="segmented__btn"
          :aria-pressed="viewMode === item.id"
          @click="onViewMode(item.id)"
        >
          {{ t(item.labelKey) }}
        </button>
      </div>
      <div class="segmented" role="group" :aria-label="t('usage.scaleLabel')">
        <button
          v-for="item in scales"
          :key="item.id"
          type="button"
          class="segmented__btn"
          :aria-pressed="scale === item.id"
          @click="onScale(item.id)"
        >
          {{ t(item.labelKey) }}
        </button>
      </div>
      <div class="segmented" role="group" :aria-label="t('usage.metricLabel')">
        <button
          v-for="item in metrics"
          :key="item.id"
          type="button"
          class="segmented__btn"
          :aria-pressed="metric === item.id"
          @click="metric = item.id"
        >
          {{ t(item.labelKey) }}
        </button>
      </div>
    </div>

    <section class="panel" aria-labelledby="usage-calendar-title">
      <div class="panel__head">
        <h2 id="usage-calendar-title" class="panel__title">
          {{ t('usage.heatmapTitle') }}
        </h2>
        <p class="panel__caption">{{ t('usage.heatmapCaption') }}</p>
      </div>

      <div v-if="loading" role="status" class="state">
        {{ t('common.loading') }}
      </div>
      <p v-else-if="error" class="error" role="alert">
        {{ error }}
      </p>
      <p v-else-if="!points.length" role="status" class="state">
        {{ t('usage.empty') }}
      </p>

      <template v-else>
        <UsageTrendChart
          :scale="scale"
          :series="trendSeries"
          :metric="metric"
          :hour-cells="hourCells"
          :day-cells="dayCells"
          :month-cells="monthCells"
          :week-count="weekCount"
          :month-labels="monthLabels"
          :weekday-labels="weekdayLabels"
          :max-value="maxValue"
          :view-mode="viewMode"
          :translate="t"
        />
      </template>
    </section>

    <section class="panel" aria-labelledby="usage-models-title">
      <div class="panel__head">
        <h2 id="usage-models-title" class="panel__title">
          {{ t('usage.modelsTitle') }}
        </h2>
        <p class="panel__caption">{{ t('usage.modelsCaption') }}</p>
      </div>

      <p v-if="!models.length" class="state" role="status">
        {{ t('usage.modelsEmpty') }}
      </p>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('usage.modelsModel') }}</th>
              <th>{{ t('usage.modelsRequests') }}</th>
              <th>{{ t('usage.modelsTokens') }}</th>
              <th>{{ t('usage.modelsCost') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in models" :key="row.model">
              <td>{{ row.model }}</td>
              <td>{{ formatNumber(row.requests) }}</td>
              <td>{{ formatNumber(row.total_tokens) }}</td>
              <td>{{ formatNumber(row.cost ?? row.actual_cost) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel" aria-labelledby="usage-logs-title">
      <div class="panel__head">
        <h2 id="usage-logs-title" class="panel__title">
          {{ t('usage.logsTitle') }}
        </h2>
        <p class="panel__caption">{{ t('usage.logsCaption') }}</p>
      </div>

      <p v-if="logsLoading" role="status" class="state">
        {{ t('common.loading') }}
      </p>
      <p v-else-if="logsError" class="error" role="alert">
        {{ logsError }}
      </p>
      <p v-else-if="!logs.length" role="status" class="state">
        {{ t('usage.logsEmpty') }}
      </p>

      <template v-else>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>{{ t('usage.logsModel') }}</th>
                <th>{{ t('usage.logsDuration') }}</th>
                <th>{{ t('usage.logsCost') }}</th>
                <th>{{ t('usage.logsActualCost') }}</th>
                <th>{{ t('usage.logsCreated') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in logs" :key="row.id">
                <td>{{ row.model || '—' }}</td>
                <td>{{ formatNumber(row.duration_ms) }}</td>
                <td>{{ formatNumber(row.total_cost) }}</td>
                <td>{{ formatNumber(row.actual_cost) }}</td>
                <td>{{ row.created_at || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="pager">
          <Button
            variant="secondary"
            :disabled="logsPage <= 1 || logsLoading"
            @click="goToLogsPage(logsPage - 1)"
          >
            {{ t('common.prev') }}
          </Button>
          <span class="pager__status">
            {{ t('usage.logsPage', { page: logsPage, pages: logsPages }) }}
          </span>
          <Button
            variant="secondary"
            :disabled="logsPage >= logsPages || logsLoading"
            @click="goToLogsPage(logsPage + 1)"
          >
            {{ t('common.next') }}
          </Button>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.page {
  display: grid;
  gap: var(--cshell-page-gap);
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

.page__subtitle {
  margin: 0;
  font-size: var(--cshell-type-body);
  color: var(--cshell-text-muted);
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.7rem;
  align-items: end;
  padding: 0.9rem 1rem;
  border-radius: var(--cshell-radius-panel);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-bg-elevated);
}

.field {
  display: grid;
  gap: 0.3rem;
  min-width: min(100%, 10.5rem);
}

.field__label {
  font-size: 0.8rem;
  color: var(--cshell-text-muted);
}

.toolbar__meta {
  margin: 0 0 0.6rem auto;
  font-size: var(--cshell-type-caption);
  color: var(--cshell-text-muted);
  overflow-wrap: anywhere;
}

.applied {
  display: grid;
  gap: 0.2rem;
  margin-top: -0.5rem;
  font-size: 0.84rem;
  color: var(--cshell-text-muted);
}

.applied__text,
.applied__hint {
  margin: 0;
}

.strip {
  display: grid;
  gap: 0.6rem;
}

.segmented {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.2rem;
  width: fit-content;
  max-width: 100%;
  padding: 0.2rem;
  border-radius: var(--cshell-radius-control);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-bg-elevated);
}

.segmented__btn {
  min-height: 2.25rem;
  padding: 0.3rem 0.75rem;
  border: 0;
  border-radius: calc(var(--cshell-radius-control) - 3px);
  background: transparent;
  color: var(--cshell-text-muted);
  font-size: 0.88rem;
  cursor: pointer;
}

.segmented__btn[aria-pressed='true'] {
  background: var(--cshell-surface);
  color: var(--cshell-text);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(44, 36, 28, 0.1);
}

.panel {
  display: grid;
  gap: 1rem;
  padding: var(--cshell-panel-padding-lg);
  border-radius: var(--cshell-radius-panel-lg);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-surface);
  min-width: 0;
  overflow-x: auto;
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

.state {
  margin: 0;
  color: var(--cshell-text-muted);
}

.table-wrap {
  overflow-x: auto;
  min-width: 0;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.table th,
.table td {
  padding: 0.55rem 0.6rem;
  text-align: left;
  border-bottom: 1px solid var(--cshell-border);
  overflow-wrap: anywhere;
}

.table td:not(:first-child),
.table th:not(:first-child) {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.table th {
  color: var(--cshell-text-muted);
  font-weight: 600;
  font-size: 0.8rem;
}

.pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}

.pager__status {
  font-size: 0.86rem;
  color: var(--cshell-text-muted);
}

.error {
  margin: 0;
  color: var(--cshell-danger);
}

@media (max-width: 640px) {
  .toolbar__meta {
    margin-left: 0;
  }

  .panel {
    padding: var(--cshell-panel-padding-mobile);
  }
}

@media (max-width: 1023px) {
  .segmented__btn {
    min-height: 44px;
  }
}
</style>
