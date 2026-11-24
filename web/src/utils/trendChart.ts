import type { TrendPoint } from '@/api/types'
import { metricValue, type HeatmapMetric } from './heatmap'

export interface TrendSeriesPoint {
  /** Raw trend date exactly as provided by the API (day or hour bucket). */
  date: string
  value: number
  /**
   * False when the previous calendar slot (day or hour) has no data point.
   * The line chart breaks the line here instead of fabricating a zero.
   */
  contiguous: boolean
}

export interface TrendSeries {
  points: TrendSeriesPoint[]
  total: number
  max: number
}

interface SlotKey {
  mode: 'day' | 'hour'
  day: string
  hour: number
}

/**
 * Classify a raw trend date. Day buckets are `YYYY-MM-DD`; hour buckets carry
 * an `HH:MM:SS` time part (mirrors the hour parsing in `heatmap.ts`).
 */
function slotKey(raw: string): SlotKey | null {
  const day = raw.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const match = /(\d{2}):\d{2}:\d{2}/.exec(raw)
  if (match) {
    const hour = Number(match[1])
    if (hour >= 0 && hour <= 23) return { mode: 'hour', day, hour }
    return null
  }
  return { mode: 'day', day, hour: -1 }
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Derive the plotted series for one metric from the trend points already
 * loaded for the heatmap. No aggregation changes: missing slots stay absent
 * (gap), explicit zeros stay zero.
 */
export function buildTrendSeries(
  points: TrendPoint[],
  metric: HeatmapMetric,
): TrendSeries {
  const entries = points
    .map((point) => {
      const key = slotKey(point.date)
      if (!key) return null
      return { key, date: point.date, value: metricValue(point, metric) }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort(
      (a, b) => a.key.day.localeCompare(b.key.day) || a.key.hour - b.key.hour,
    )

  const seriesPoints: TrendSeriesPoint[] = entries.map((entry, index) => {
    const point: TrendSeriesPoint = {
      date: entry.date,
      value: entry.value,
      contiguous: true,
    }
    if (index === 0) return point
    const prev = entries[index - 1]
    if (!prev || prev.key.mode !== entry.key.mode) {
      point.contiguous = false
      return point
    }
    if (entry.key.mode === 'hour') {
      point.contiguous =
        prev.key.day === entry.key.day &&
        entry.key.hour - prev.key.hour === 1
      return point
    }
    const prevMs = Date.parse(`${prev.key.day}T00:00:00Z`)
    const curMs = Date.parse(`${entry.key.day}T00:00:00Z`)
    point.contiguous =
      Number.isFinite(prevMs) &&
      Number.isFinite(curMs) &&
      curMs - prevMs === DAY_MS
    return point
  })

  let total = 0
  let max = 0
  for (const point of seriesPoints) {
    total += point.value
    if (point.value > max) max = point.value
  }
  return { points: seriesPoints, total, max }
}
