<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { fetchUsageLogs, fetchUsageTrend } from '@/api/usage'
import type { TrendResponse, UsageLog } from '@/api/types'
import { ApiError } from '@/api/types'
import Button from '@/components/primitives/Button.vue'
import Input from '@/components/primitives/Input.vue'
import {
  buildHeatmapDays,
  buildHeatmapHours,
  buildHeatmapMonths,
  buildYearMonthLabels,
  defaultRangeForScale,
  heatmapLevel,
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
  buildYearMonthLabels(dayCells.value, locale.value === 'zh' ? 'zh' : 'en'),
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

function hourLabel(cell: (typeof hourCells.value)[number]): string {
  const base = `${String(cell.hour).padStart(2, '0')}:00`
  if (!cell.point) return `${base}; ${t('usage.missing')}`
  return `${base}; ${cell.value} ${metric.value}; ${cell.point.requests} requests;`
}

function dayLabel(cell: (typeof dayCells.value)[number]): string {
  if (!cell.inRange) return `${cell.date}; ${t('usage.outside')}`
  if (!cell.point) return `${cell.date}; ${t('usage.missing')}`
  return `${cell.date}; ${cell.value} ${metric.value}; ${cell.point.requests} requests;`
}

function monthLabel(cell: (typeof monthCells.value)[number]): string {
  if (!cell.point) return `${cell.key}; ${t('usage.missing')}`
  return `${cell.key}; ${cell.value} ${metric.value}; ${cell.point.requests} requests;`
}

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
      <Button variant="secondary" @click="applyRange">
        {{ t('common.apply') }}
      </Button>
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
        <!-- Hour: 24 cells -->
        <div v-if="scale === 'hour'" class="hour-grid" role="grid">
          <button
            v-for="cell in hourCells"
            :key="cell.hour"
            type="button"
            role="gridcell"
            class="cell"
            :class="[
              `cell--l${heatmapLevel(cell.value, maxValue)}`,
              { 'cell--missing': !cell.point },
            ]"
            :aria-label="hourLabel(cell)"
            :title="hourLabel(cell)"
          >
            {{ String(cell.hour).padStart(2, '0') }}
          </button>
        </div>

        <!-- Multi-year monthly -->
        <div v-else-if="scale === 'multi-year'" class="month-grid" role="grid">
          <button
            v-for="cell in monthCells"
            :key="cell.key"
            type="button"
            role="gridcell"
            class="cell cell--month"
            :class="[
              `cell--l${heatmapLevel(cell.value, maxValue)}`,
              { 'cell--missing': !cell.point },
            ]"
            :aria-label="monthLabel(cell)"
            :title="monthLabel(cell)"
          >
            {{ cell.key }}
          </button>
        </div>

        <!-- Month / year day calendar -->
        <div v-else class="day-wrap">
          <div
            v-if="scale === 'year'"
            class="heatmap-month-labels"
            :style="{ gridTemplateColumns: `repeat(${weekCount}, minmax(0, 1fr))` }"
            aria-hidden="true"
          >
            <span
              v-for="label in monthLabels"
              :key="label.key"
              class="month-label"
              :style="{
                gridColumn: `${label.column + 1} / span ${label.span}`,
                gridRow: 1,
              }"
            >
              {{ label.label }}
            </span>
          </div>

          <div class="day-layout">
            <div class="weekdays" aria-hidden="true">
              <span v-for="(label, idx) in weekdayLabels" :key="idx">
                {{ label }}
              </span>
            </div>
            <div
              class="day-grid"
              role="grid"
              :style="{ gridTemplateColumns: `repeat(${weekCount}, minmax(0, 1fr))` }"
            >
              <button
                v-for="cell in dayCells"
                :key="cell.date + String(cell.inRange)"
                type="button"
                role="gridcell"
                class="cell"
                :class="[
                  `cell--l${heatmapLevel(cell.value, maxValue)}`,
                  {
                    'cell--outside': !cell.inRange,
                    'cell--missing': cell.inRange && !cell.point,
                  },
                ]"
                :aria-label="dayLabel(cell)"
                :title="dayLabel(cell)"
              />
            </div>
          </div>
        </div>

        <div class="legend" aria-hidden="true">
          <span>{{ t('usage.less') }}</span>
          <span
            v-for="level in 5"
            :key="level"
            class="legend__swatch"
            :class="`cell--l${level - 1}`"
          />
          <span>{{ t('usage.more') }}</span>
        </div>
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
  font-size: 0.82rem;
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
  padding: 1.3rem;
  border-radius: var(--cshell-radius-panel);
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
  font-size: 1.02rem;
}

.panel__caption {
  margin: 0;
  font-size: 0.82rem;
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

.table th {
  color: var(--cshell-text-muted);
  font-weight: 600;
  font-size: 0.8rem;
}

.hour-grid {
  display: grid;
  grid-template-columns: repeat(8, minmax(2.25rem, 1fr));
  gap: 0.35rem;
  max-width: 36rem;
}

.month-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr));
  gap: 0.4rem;
}

.heatmap-month-labels {
  display: grid;
  gap: 0.25rem;
  margin: 0 0 0.35rem 2rem;
  font-size: 0.7rem;
  color: var(--cshell-text-muted);
}

.month-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.day-layout {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr);
  gap: 0.35rem;
  min-width: 24rem;
}

.weekdays {
  display: grid;
  grid-template-rows: repeat(7, minmax(0, 1fr));
  gap: 0.25rem;
  font-size: 0.65rem;
  color: var(--cshell-text-muted);
  align-items: center;
}

.day-grid {
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(7, minmax(0, 1fr));
  gap: 0.25rem;
}

.cell {
  aspect-ratio: 1;
  min-width: 0;
  min-height: 1rem;
  border: 1px solid transparent;
  border-radius: 3px;
  padding: 0;
  font-size: 0.65rem;
  cursor: default;
  color: var(--cshell-text);
}

.cell--month {
  aspect-ratio: auto;
  min-height: 2.5rem;
  padding: 0.35rem;
}

.cell--l0 { background: var(--cshell-heat-0); }
.cell--l1 { background: var(--cshell-heat-1); }
.cell--l2 { background: var(--cshell-heat-2); }
.cell--l3 { background: var(--cshell-heat-3); color: var(--cshell-heat-3-ink); }
.cell--l4 { background: var(--cshell-heat-4); color: var(--cshell-heat-4-ink); }

.cell--outside {
  opacity: 0.28;
}

.cell--missing {
  background: repeating-linear-gradient(
    135deg,
    transparent,
    transparent 3px,
    #ac95743b 3px,
    #ac95743b 5px
  );
}

.legend {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.25rem;
  font-size: 0.7rem;
  color: var(--cshell-text-muted);
}

.legend__swatch {
  width: 0.75rem;
  height: 0.75rem;
  border: 1px solid var(--cshell-border);
  border-radius: 2px;
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
    padding: 1rem;
  }
}

@media (max-width: 1023px) {
  .segmented__btn {
    min-height: 44px;
  }
}
</style>
