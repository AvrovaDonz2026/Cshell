<script setup lang="ts">
import { computed } from 'vue'
import type { HeatmapMetric } from '@/utils/heatmap'
import type { TrendSeries } from '@/utils/trendChart'

const props = withDefaults(
  defineProps<{
    series: TrendSeries
    metric: HeatmapMetric
    translate: (key: string, params?: Record<string, unknown>) => string
    /** Dashboard trend panel passes compact for a shorter chart. */
    compact?: boolean
  }>(),
  { compact: false },
)

/** Full-size ~180px tall; compact (dashboard) ~140px. */
const heightPx = computed(() => (props.compact ? 140 : 180))

/** Fixed viewBox coordinate system; CSS keeps the width fluid. */
const W = 640
const H = 220
const PAD = { top: 10, right: 12, bottom: 26, left: 12 }

const plot = computed(() => {
  const points = props.series.points
  // y-max floors at 1 so an all-zero series still draws along the baseline.
  if (!points.length || props.series.max < 0) return null
  const yMax = Math.max(1, props.series.max)
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const step = points.length > 1 ? innerW / (points.length - 1) : 0
  const coords = points.map((point, index) => ({
    ...point,
    x: PAD.left + step * index,
    y:
      PAD.top +
      innerH -
      (Math.max(0, point.value) / yMax) * innerH,
  }))
  // Segments stop at each discontinuity, so missing days never plot as zero.
  const segments: { x: number; y: number }[][] = []
  let current: { x: number; y: number }[] = []
  for (const coord of coords) {
    if (coord.contiguous) {
      current.push({ x: coord.x, y: coord.y })
      continue
    }
    if (current.length) segments.push(current)
    current = [{ x: coord.x, y: coord.y }]
  }
  if (current.length) segments.push(current)
  return { coords, segments, baseline: PAD.top + innerH, innerH }
})

const areaD = computed(() => {
  const data = plot.value
  if (!data) return ''
  const segments = data.segments.filter((segment) => segment.length >= 2)
  if (!segments.length) return ''
  const parts = segments.map((segment) => {
    const start = segment[0]!
    const end = segment[segment.length - 1]!
    return `M${start.x.toFixed(2)},${data.baseline.toFixed(2)}L${segment
      .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join('L')}${end.x.toFixed(2)},${data.baseline.toFixed(2)}Z`
  })
  return parts.join('')
})

const lineD = computed(() => {
  const data = plot.value
  if (!data) return ''
  return data.segments
    .filter((segment) => segment.length >= 2)
    .map((segment) =>
      segment
        .map((point, index) =>
          index === 0
            ? `M${point.x.toFixed(2)},${point.y.toFixed(2)}`
            : `L${point.x.toFixed(2)},${point.y.toFixed(2)}`,
        )
        .join(''),
    )
    .join('')
})

const ariaLabel = computed(() => {
  const points = props.series.points
  const start = points[0]?.date ?? ''
  const end = points[points.length - 1]?.date ?? ''
  return props.translate('usage.lineChartSummary', {
    start,
    end,
    metric: props.metric,
    total: props.series.total.toLocaleString(),
  })
})

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(
    value,
  )
}

function hourLabel(raw: string): string {
  const match = /(\d{2}:\d{2})/.exec(raw)
  return match ? match[1] : raw
}

function dayLabel(raw: string): string {
  return raw.slice(0, 10)
}

const startCaption = computed(() => {
  const points = props.series.points
  if (!points.length) return ''
  const raw = points[0]!.date
  return raw.includes(':') ? hourLabel(raw) : dayLabel(raw)
})

const endCaption = computed(() => {
  const points = props.series.points
  if (!points.length) return ''
  const raw = points[points.length - 1]!.date
  return raw.includes(':') ? hourLabel(raw) : dayLabel(raw)
})

const gridlines = computed(() => {
  const data = plot.value
  if (!data) return []
  return [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({
    y: data.baseline - data.innerH * fraction,
  }))
})
</script>

<template>
  <div v-if="plot" class="trend-chart" :class="{ 'trend-chart--compact': compact }">
    <svg
      class="trend-chart__svg"
      :viewBox="`0 0 ${W} ${H}`"
      width="100%"
      :height="heightPx"
      preserveAspectRatio="none"
      role="img"
      :aria-label="ariaLabel"
    >
      <line
        v-for="(line, idx) in gridlines"
        :key="idx"
        class="trend-chart__gridline"
        :x1="PAD.left"
        :x2="W - PAD.right"
        :y1="line.y"
        :y2="line.y"
      />
      <path
        v-if="areaD"
        class="trend-chart__area"
        :d="areaD"
      />
      <path
        v-if="lineD"
        class="trend-chart__line"
        :d="lineD"
      />
      <circle
        v-for="coord in plot.coords"
        :key="coord.date"
        class="trend-chart__dot"
        :cx="coord.x"
        :cy="coord.y"
        r="2.5"
      />
    </svg>
    <div class="trend-chart__captions" aria-hidden="true">
      <span>{{ startCaption }}</span>
      <span class="trend-chart__max">{{ formatNumber(series.max) }} {{ metric }}</span>
      <span>{{ endCaption }}</span>
    </div>
  </div>
  <p v-else role="status" class="trend-chart__empty">
    {{ translate('usage.lineChartEmpty') }}
  </p>
</template>

<style scoped>
.trend-chart {
  display: grid;
  gap: 0.2rem;
  min-width: 0;
}

.trend-chart__svg {
  display: block;
  min-height: 180px;
  width: 100%;
}

.trend-chart--compact .trend-chart__svg {
  min-height: 140px;
}

.trend-chart__gridline {
  stroke: var(--cshell-border);
  stroke-width: 1;
}

.trend-chart__area {
  fill: var(--cshell-accent-soft);
  stroke: none;
}

.trend-chart__line {
  fill: none;
  stroke: var(--cshell-accent);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.trend-chart__dot {
  fill: var(--cshell-accent);
}

.trend-chart__captions {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: var(--cshell-type-caption);
  color: var(--cshell-text-muted);
}

.trend-chart__max {
  overflow-wrap: anywhere;
}

.trend-chart__empty {
  margin: 0;
  padding: 1.25rem 0;
  text-align: center;
  color: var(--cshell-text-muted);
  font-size: var(--cshell-type-small);
}
</style>
