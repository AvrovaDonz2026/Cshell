<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { fetchUsageTrend } from '@/api/usage'
import type { TrendPoint } from '@/api/types'
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

const { t, locale } = useI18n()

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const scale = ref<HeatmapScale>('month')
const metric = ref<HeatmapMetric>('requests')
const startDate = ref('')
const endDate = ref('')
const points = ref<TrendPoint[]>([])
const loading = ref(false)
const error = ref('')

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

function applyScaleDefaults(next: HeatmapScale): void {
  const range = defaultRangeForScale(next)
  startDate.value = range.start
  endDate.value = range.end
}

async function loadTrend(): Promise<void> {
  if (!startDate.value || !endDate.value) return
  loading.value = true
  error.value = ''
  try {
    const granularity = scale.value === 'hour' ? 'hour' : 'day'
    const data = await fetchUsageTrend({
      start_date: startDate.value,
      end_date: endDate.value,
      granularity,
      timezone,
    })
    points.value = data.trend || []
  } catch (err) {
    points.value = []
    error.value =
      err instanceof ApiError || err instanceof Error
        ? err.message
        : t('common.error')
  } finally {
    loading.value = false
  }
}

function onScale(next: HeatmapScale): void {
  scale.value = next
  applyScaleDefaults(next)
  void loadTrend()
}

const hourCells = computed(() =>
  buildHeatmapHours(points.value, startDate.value || endDate.value, metric.value),
)

const dayCells = computed(() =>
  buildHeatmapDays(
    points.value,
    startDate.value,
    endDate.value,
    metric.value,
  ),
)

const monthCells = computed(() =>
  buildHeatmapMonths(
    points.value,
    startDate.value,
    endDate.value,
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
  applyScaleDefaults(scale.value)
  void loadTrend()
})
</script>

<template>
  <div class="page">
    <h1>{{ t('pages.usage') }}</h1>

    <div class="controls">
      <label class="field">
        <span>{{ t('usage.startDate') }}</span>
        <Input v-model="startDate" type="date" />
      </label>
      <label class="field">
        <span>{{ t('usage.endDate') }}</span>
        <Input v-model="endDate" type="date" />
      </label>
      <Button variant="secondary" @click="loadTrend">
        {{ t('common.apply') }}
      </Button>
      <p class="tz">
        {{ t('usage.timezone') }}: {{ timezone }}
      </p>
    </div>

    <div
      class="scale"
      role="group"
      :aria-label="t('usage.scaleLabel')"
    >
      <button
        v-for="item in scales"
        :key="item.id"
        type="button"
        class="scale__btn"
        :aria-pressed="scale === item.id"
        @click="onScale(item.id)"
      >
        {{ t(item.labelKey) }}
      </button>
    </div>

    <div class="metric" role="group" :aria-label="t('usage.metricLabel')">
      <button
        v-for="item in metrics"
        :key="item.id"
        type="button"
        class="metric__btn"
        :aria-pressed="metric === item.id"
        @click="metric = item.id"
      >
        {{ t(item.labelKey) }}
      </button>
    </div>

    <section
      class="heatmap"
      aria-labelledby="usage-calendar-title"
    >
      <h2 id="usage-calendar-title">
        {{ t('usage.heatmapTitle') }}
      </h2>

      <div v-if="loading" role="status">
        {{ t('common.loading') }}
      </div>
      <p v-else-if="error" class="error" role="alert">
        {{ error }}
      </p>
      <p v-else-if="!points.length" role="status">
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

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: end;
}

.field {
  display: grid;
  gap: 0.3rem;
  font-size: 0.9rem;
  min-width: min(100%, 10rem);
}

.tz {
  margin: 0;
  color: var(--cshell-text-muted);
  font-size: 0.85rem;
  align-self: center;
}

.scale,
.metric {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.scale__btn,
.metric__btn {
  min-height: 2.25rem;
  padding: 0.35rem 0.75rem;
  border-radius: var(--cshell-radius-control);
  border: 1px solid var(--cshell-border);
  background: var(--cshell-surface);
  color: var(--cshell-text);
  cursor: pointer;
}

.scale__btn[aria-pressed='true'],
.metric__btn[aria-pressed='true'] {
  background: var(--cshell-accent-soft);
  border-color: var(--cshell-accent);
  font-weight: 600;
}

.heatmap {
  padding: 1rem;
  border-radius: var(--cshell-radius-panel);
  background: var(--cshell-surface);
  border: 1px solid var(--cshell-border);
  overflow-x: auto;
  min-width: 0;
}

.heatmap h2 {
  margin: 0 0 0.75rem;
  font-size: 1rem;
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
  grid-template-columns: 2rem 1fr;
  gap: 0.35rem;
  min-width: 28rem;
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

.cell--l0 { background: #f1ede5; }
.cell--l1 { background: #d9c6a8; }
.cell--l2 { background: #bd9a6d; }
.cell--l3 { background: #946a43; color: #fffaf2; }
.cell--l4 { background: #5c3826; color: #fffaf2; }

:global(.cshell-user-workspace[data-theme='dark']) .cell--l0,
:global(html[data-theme='dark']) .cell--l0 { background: #29251f; }
:global(.cshell-user-workspace[data-theme='dark']) .cell--l1,
:global(html[data-theme='dark']) .cell--l1 { background: #6b5139; }
:global(.cshell-user-workspace[data-theme='dark']) .cell--l2,
:global(html[data-theme='dark']) .cell--l2 { background: #896642; }
:global(.cshell-user-workspace[data-theme='dark']) .cell--l3,
:global(html[data-theme='dark']) .cell--l3 { background: #b18a60; color: #29251f; }
:global(.cshell-user-workspace[data-theme='dark']) .cell--l4,
:global(html[data-theme='dark']) .cell--l4 { background: #d0ad7d; color: #29251f; }

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
  margin-top: 0.85rem;
  font-size: 0.7rem;
  color: var(--cshell-text-muted);
}

.legend__swatch {
  width: 0.75rem;
  height: 0.75rem;
  border: 1px solid var(--cshell-border);
  border-radius: 2px;
}

.error {
  margin: 0;
  color: var(--cshell-danger);
}
</style>
