import type { TrendPoint } from '@/api/types'

export type HeatmapScale = 'hour' | 'month' | 'year' | 'multi-year'

export type HeatmapMetric =
  | 'tokens'
  | 'requests'
  | 'input'
  | 'output'
  | 'cost'
  | 'actual_cost'

export interface HeatmapHourCell {
  hour: number
  value: number
  /** Present bucket (including explicit zero). Null = missing. */
  point: TrendPoint | null
}

export interface HeatmapDayCell {
  date: string
  weekday: number
  value: number
  inRange: boolean
  point: TrendPoint | null
}

export interface HeatmapMonthCell {
  year: number
  month: number
  key: string
  value: number
  inRange: boolean
  point: TrendPoint | null
}

export interface MonthLabel {
  key: string
  label: string
  /** 0-based week column index */
  column: number
  /** Column span; labels share gridRow 1 and must not overlap */
  span: number
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Parse `YYYY-MM-DD` as a local calendar date (no TZ shift). */
export function parseDateKey(date: string): Date {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function metricValue(
  point: TrendPoint | null | undefined,
  metric: HeatmapMetric,
): number {
  if (!point) return 0
  switch (metric) {
    case 'requests':
      return point.requests ?? 0
    case 'tokens':
      return point.total_tokens ?? 0
    case 'input':
      return point.input_tokens ?? 0
    case 'output':
      return point.output_tokens ?? 0
    case 'cost':
      return point.cost ?? 0
    case 'actual_cost':
      return point.actual_cost ?? 0
    default:
      return 0
  }
}

export function heatmapLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0
  const ratio = value / max
  if (ratio <= 0.25) return 1
  if (ratio <= 0.5) return 2
  if (ratio <= 0.75) return 3
  return 4
}

function dayKeyFromTrendDate(raw: string): string {
  return raw.slice(0, 10)
}

function hourFromTrendDate(raw: string): number | null {
  const match = /(\d{2}):\d{2}:\d{2}/.exec(raw)
  if (!match) return null
  return Number(match[1])
}

function indexDayPoints(
  points: TrendPoint[],
): Map<string, TrendPoint> {
  const map = new Map<string, TrendPoint>()
  for (const point of points) {
    const key = dayKeyFromTrendDate(point.date)
    const existing = map.get(key)
    if (!existing) {
      map.set(key, { ...point, date: key })
      continue
    }
    map.set(key, {
      date: key,
      requests: (existing.requests || 0) + (point.requests || 0),
      total_tokens: (existing.total_tokens || 0) + (point.total_tokens || 0),
      input_tokens: (existing.input_tokens || 0) + (point.input_tokens || 0),
      output_tokens: (existing.output_tokens || 0) + (point.output_tokens || 0),
      cost: (existing.cost || 0) + (point.cost || 0),
      actual_cost: (existing.actual_cost || 0) + (point.actual_cost || 0),
    })
  }
  return map
}

function indexHourPoints(
  points: TrendPoint[],
  day: string,
): Map<number, TrendPoint> {
  const map = new Map<number, TrendPoint>()
  for (const point of points) {
    if (dayKeyFromTrendDate(point.date) !== day) continue
    const hour = hourFromTrendDate(point.date)
    if (hour == null || hour < 0 || hour > 23) continue
    map.set(hour, point)
  }
  return map
}

/** Exactly 24 hour cells; missing hours have `point: null` (distinct from zero). */
export function buildHeatmapHours(
  points: TrendPoint[],
  day: string,
  metric: HeatmapMetric,
): HeatmapHourCell[] {
  const byHour = indexHourPoints(points, day)
  const cells: HeatmapHourCell[] = []
  for (let hour = 0; hour < 24; hour += 1) {
    const point = byHour.get(hour) ?? null
    cells.push({
      hour,
      point,
      value: metricValue(point, metric),
    })
  }
  return cells
}

function eachDate(start: Date, end: Date, fn: (d: Date) => void): void {
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  while (cursor <= last) {
    fn(new Date(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
}

/**
 * Calendar day grid (Sunday-start weeks) for month/year views.
 * Outside-range padding cells have `inRange: false`.
 * In-range days absent from trend have `point: null` (missing ≠ zero).
 */
export function buildHeatmapDays(
  points: TrendPoint[],
  startDate: string,
  endDate: string,
  metric: HeatmapMetric,
): HeatmapDayCell[] {
  const byDay = indexDayPoints(points)
  const rangeStart = parseDateKey(startDate)
  const rangeEnd = parseDateKey(endDate)
  const gridStart = new Date(rangeStart)
  gridStart.setDate(gridStart.getDate() - gridStart.getDay())
  const gridEnd = new Date(rangeEnd)
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()))

  const cells: HeatmapDayCell[] = []
  eachDate(gridStart, gridEnd, (d) => {
    const key = formatDateKey(d)
    const inRange = d >= rangeStart && d <= rangeEnd
    const point = inRange ? (byDay.get(key) ?? null) : null
    cells.push({
      date: key,
      weekday: d.getDay(),
      inRange,
      point,
      value: inRange ? metricValue(point, metric) : 0,
    })
  })
  return cells
}

export function weekCountForDays(days: HeatmapDayCell[]): number {
  return Math.max(1, Math.ceil(days.length / 7))
}

/**
 * Month labels for year (week-column) view.
 * Every label uses the same grid row conceptually (gridRow: 1) with
 * non-overlapping column spans covering weeks until the next month.
 */
export function buildYearMonthLabels(
  days: HeatmapDayCell[],
  locale = 'en',
): MonthLabel[] {
  const weekCount = weekCountForDays(days)
  const firstByMonth = new Map<string, { column: number; year: number; month: number }>()

  days.forEach((day, index) => {
    if (!day.inRange) return
    const d = parseDateKey(day.date)
    const monthKey = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
    const column = Math.floor(index / 7)
    if (!firstByMonth.has(monthKey)) {
      firstByMonth.set(monthKey, {
        column,
        year: d.getFullYear(),
        month: d.getMonth(),
      })
    }
  })

  const ordered = [...firstByMonth.entries()]
    .map(([key, meta]) => ({ key, ...meta }))
    .sort((a, b) => a.column - b.column || a.key.localeCompare(b.key))

  const formatter = new Intl.DateTimeFormat(locale, { month: 'short' })
  return ordered.map((entry, index) => {
    const nextColumn = ordered[index + 1]?.column ?? weekCount
    const span = Math.max(1, nextColumn - entry.column)
    return {
      key: entry.key,
      label: formatter.format(new Date(entry.year, entry.month, 1)),
      column: entry.column,
      span,
    }
  })
}

/** Assert month labels do not overlap when placed on a single grid row. */
export function monthLabelsOverlap(labels: MonthLabel[]): boolean {
  const sorted = [...labels].sort((a, b) => a.column - b.column)
  for (let i = 0; i < sorted.length; i += 1) {
    const end = sorted[i].column + sorted[i].span
    const next = sorted[i + 1]
    if (next && end > next.column) return true
  }
  return false
}

function monthKey(year: number, month: number): string {
  return `${year}-${pad2(month)}`
}

/**
 * Multi-year monthly grid: one cell per calendar month in [startDate, endDate].
 * Missing months (no trend days) keep `point: null`; explicit zero aggregates stay present.
 */
export function buildHeatmapMonths(
  points: TrendPoint[],
  startDate: string,
  endDate: string,
  metric: HeatmapMetric,
): HeatmapMonthCell[] {
  const byDay = indexDayPoints(points)
  const start = parseDateKey(startDate)
  const end = parseDateKey(endDate)
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  const last = new Date(end.getFullYear(), end.getMonth(), 1)
  const cells: HeatmapMonthCell[] = []

  while (cursor <= last) {
    const year = cursor.getFullYear()
    const month = cursor.getMonth() + 1
    const key = monthKey(year, month)
    const monthStart = new Date(year, month - 1, 1)
    const monthEnd = new Date(year, month, 0)
    let sawPoint = false
    const aggregate: TrendPoint = {
      date: key,
      requests: 0,
      total_tokens: 0,
      input_tokens: 0,
      output_tokens: 0,
      cost: 0,
      actual_cost: 0,
    }

    eachDate(monthStart, monthEnd, (d) => {
      if (d < start || d > end) return
      const dayPoint = byDay.get(formatDateKey(d))
      if (!dayPoint) return
      sawPoint = true
      aggregate.requests += dayPoint.requests || 0
      aggregate.total_tokens =
        (aggregate.total_tokens || 0) + (dayPoint.total_tokens || 0)
      aggregate.input_tokens =
        (aggregate.input_tokens || 0) + (dayPoint.input_tokens || 0)
      aggregate.output_tokens =
        (aggregate.output_tokens || 0) + (dayPoint.output_tokens || 0)
      aggregate.cost = (aggregate.cost || 0) + (dayPoint.cost || 0)
      aggregate.actual_cost =
        (aggregate.actual_cost || 0) + (dayPoint.actual_cost || 0)
    })

    const point = sawPoint ? aggregate : null
    cells.push({
      year,
      month,
      key,
      inRange: true,
      point,
      value: metricValue(point, metric),
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }

  return cells
}

export function defaultRangeForScale(
  scale: HeatmapScale,
  now = new Date(),
): { start: string; end: string; granularity: 'day' | 'hour' } {
  const end = formatDateKey(now)
  if (scale === 'hour') {
    return { start: end, end, granularity: 'hour' }
  }
  if (scale === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    return { start: formatDateKey(start), end, granularity: 'day' }
  }
  if (scale === 'year') {
    const start = new Date(now.getFullYear(), 0, 1)
    const yearEnd = new Date(now.getFullYear(), 11, 31)
    return {
      start: formatDateKey(start),
      end: formatDateKey(yearEnd < now ? yearEnd : now),
      granularity: 'day',
    }
  }
  const start = new Date(now.getFullYear() - 2, 0, 1)
  return { start: formatDateKey(start), end, granularity: 'day' }
}
