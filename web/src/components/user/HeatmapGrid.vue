<script setup lang="ts">
import { heatmapLevel, type HeatmapDayCell, type HeatmapHourCell, type HeatmapMetric, type HeatmapMonthCell, type HeatmapScale, type MonthLabel } from '@/utils/heatmap'
const props = defineProps<{ scale: HeatmapScale; hourCells: HeatmapHourCell[]; dayCells: HeatmapDayCell[]; monthCells: HeatmapMonthCell[]; weekCount: number; monthLabels: MonthLabel[]; weekdayLabels: string[]; maxValue: number; metric: HeatmapMetric; translate: (key: string) => string }>()
function hourLabel(cell: HeatmapHourCell): string {
  const base = `${String(cell.hour).padStart(2, '0')}:00`
  if (!cell.point) return `${base}; ${props.translate('usage.missing')}`
  return `${base}; ${cell.value} ${props.metric}; ${cell.point.requests} requests;`
}
function dayLabel(cell: HeatmapDayCell): string {
  if (!cell.inRange) return `${cell.date}; ${props.translate('usage.outside')}`
  if (!cell.point) return `${cell.date}; ${props.translate('usage.missing')}`
  return `${cell.date}; ${cell.value} ${props.metric}; ${cell.point.requests} requests;`
}
function monthLabel(cell: HeatmapMonthCell): string {
  if (!cell.point) return `${cell.key}; ${props.translate('usage.missing')}`
  return `${cell.key}; ${cell.value} ${props.metric}; ${cell.point.requests} requests;`
}
</script>
<template>
  <div v-if="scale === 'hour'" class="hour-grid" role="grid">
    <button v-for="cell in hourCells" :key="cell.hour" type="button" role="gridcell" class="cell" :class="[`cell--l${heatmapLevel(cell.value, maxValue)}`, { 'cell--missing': !cell.point }]" :aria-label="hourLabel(cell)" :title="hourLabel(cell)">{{ String(cell.hour).padStart(2, '0') }}</button>
  </div>
  <div v-else-if="scale === 'multi-year'" class="month-grid" role="grid">
    <button v-for="cell in monthCells" :key="cell.key" type="button" role="gridcell" class="cell cell--month" :class="[`cell--l${heatmapLevel(cell.value, maxValue)}`, { 'cell--missing': !cell.point }]" :aria-label="monthLabel(cell)" :title="monthLabel(cell)">{{ cell.key }}</button>
  </div>
  <div v-else>
    <div v-if="scale === 'year'" class="heatmap-month-labels" :style="{ gridTemplateColumns: `repeat(${weekCount}, minmax(0, 1fr))` }" aria-hidden="true"><span v-for="label in monthLabels" :key="label.key" class="month-label" :style="{ gridColumn: `${label.column + 1} / span ${label.span}`, gridRow: 1 }">{{ label.label }}</span></div>
    <div class="day-layout">
      <div class="weekdays" aria-hidden="true"><span v-for="(label, idx) in weekdayLabels" :key="idx">{{ label }}</span></div><div class="day-grid" role="grid" :style="{ gridTemplateColumns: `repeat(${weekCount}, minmax(0, 1fr))` }">
        <button v-for="cell in dayCells" :key="cell.date + String(cell.inRange)" type="button" role="gridcell" class="cell" :class="[`cell--l${heatmapLevel(cell.value, maxValue)}`, { 'cell--outside': !cell.inRange, 'cell--missing': cell.inRange && !cell.point }]" :aria-label="dayLabel(cell)" :title="dayLabel(cell)" />
      </div>
    </div>
  </div>
  <div class="legend" aria-hidden="true"><span>{{ translate('usage.less') }}</span><span v-for="level in 5" :key="level" class="legend__swatch" :class="`cell--l${level - 1}`" /><span>{{ translate('usage.more') }}</span></div>
</template>
<style scoped>
.hour-grid { display:grid; grid-template-columns:repeat(8,minmax(2.25rem,1fr)); gap:.35rem; max-width:36rem; }
.month-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(5.5rem,1fr)); gap:.4rem; }
.heatmap-month-labels { display:grid; gap:.25rem; margin:0 0 .35rem 2rem; font-size:.7rem; color:var(--cshell-text-muted); }
.month-label { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.day-layout { display:grid; grid-template-columns:2rem minmax(0,1fr); gap:.35rem; min-width:24rem; }
.weekdays { display:grid; grid-template-rows:repeat(7,minmax(0,1fr)); gap:.25rem; font-size:.65rem; color:var(--cshell-text-muted); align-items:center; }
.day-grid { display:grid; grid-auto-flow:column; grid-template-rows:repeat(7,minmax(0,1fr)); gap:.25rem; }
.cell { aspect-ratio:1; min-width:0; min-height:1rem; border:1px solid transparent; border-radius:3px; padding:0; font-size:.65rem; cursor:default; color:var(--cshell-text); }
.cell--month { aspect-ratio:auto; min-height:2.5rem; padding:.35rem; }
.cell--l0 { background:var(--cshell-heat-0); } .cell--l1 { background:var(--cshell-heat-1); } .cell--l2 { background:var(--cshell-heat-2); } .cell--l3 { background:var(--cshell-heat-3); color:var(--cshell-heat-3-ink); } .cell--l4 { background:var(--cshell-heat-4); color:var(--cshell-heat-4-ink); }
.cell--outside { opacity:.28; }
.cell--missing { background:repeating-linear-gradient(135deg,transparent,transparent 3px,#ac95743b 3px,#ac95743b 5px); }
.legend { display:flex; align-items:center; justify-content:flex-end; gap:.25rem; font-size:.7rem; color:var(--cshell-text-muted); }
.legend__swatch { width:.75rem; height:.75rem; border:1px solid var(--cshell-border); border-radius:2px; }
</style>
