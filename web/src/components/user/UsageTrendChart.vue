<script setup lang="ts">
import { computed } from 'vue'
import HeatmapGrid from './HeatmapGrid.vue'
import TrendLineChart from './TrendLineChart.vue'
import type {
  HeatmapDayCell,
  HeatmapHourCell,
  HeatmapMetric,
  HeatmapMonthCell,
  HeatmapScale,
  MonthLabel,
} from '@/utils/heatmap'
import type { TrendSeries } from '@/utils/trendChart'

const props = withDefaults(
  defineProps<{
    scale: HeatmapScale
    series: TrendSeries
    metric: HeatmapMetric
    hourCells?: HeatmapHourCell[]
    dayCells?: HeatmapDayCell[]
    monthCells?: HeatmapMonthCell[]
    weekCount?: number
    monthLabels?: MonthLabel[]
    weekdayLabels?: string[]
    maxValue?: number
    compact?: boolean
    viewMode?: 'heatmap' | 'line'
    translate: (key: string, params?: Record<string, unknown>) => string  }>(),
  {
    hourCells: () => [],
    dayCells: () => [],
    monthCells: () => [],
    weekCount: 1,
    monthLabels: () => [],
    weekdayLabels: () => [],
    maxValue: 0,
    compact: false,
    viewMode: 'heatmap',
  },
)

/** Spread-safe copy without the wrapper-only props (`series`, `viewMode`). */
const heatmapProps = computed(() => ({
  scale: props.scale,
  hourCells: props.hourCells,
  dayCells: props.dayCells,
  monthCells: props.monthCells,
  weekCount: props.weekCount,
  monthLabels: props.monthLabels,
  weekdayLabels: props.weekdayLabels,
  maxValue: props.maxValue,
  metric: props.metric,
  compact: props.compact,
  translate: props.translate,
}))
</script>

<template>
  <TrendLineChart
    v-if="viewMode === 'line'"
    :series="series"
    :metric="metric"
    :compact="compact"
    :translate="translate"
  />
  <HeatmapGrid v-else v-bind="heatmapProps" />
</template>
