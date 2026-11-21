import { describe, expect, it } from 'vitest'
import type { TrendPoint } from '@/api/types'
import {
  buildHeatmapDays,
  buildHeatmapHours,
  buildHeatmapMonths,
  buildYearMonthLabels,
  monthLabelsOverlap,
} from '@/utils/heatmap'

describe('heatmap utils', () => {
  it('builds exactly 24 hour cells and distinguishes missing from zero', () => {
    const points: TrendPoint[] = [
      {
        date: '2026-11-21 00:00:00',
        requests: 0,
        total_tokens: 0,
        cost: 0,
        actual_cost: 0,
      },
      {
        date: '2026-11-21 03:00:00',
        requests: 5,
        total_tokens: 100,
        cost: 0.1,
        actual_cost: 0.08,
      },
    ]

    const cells = buildHeatmapHours(points, '2026-11-21', 'requests')
    expect(cells).toHaveLength(24)
    expect(cells[0].point).not.toBeNull()
    expect(cells[0].value).toBe(0)
    expect(cells[1].point).toBeNull()
    expect(cells[1].value).toBe(0)
    expect(cells[3].point).not.toBeNull()
    expect(cells[3].value).toBe(5)
  })

  it('marks missing day buckets separately from explicit zero and outside range', () => {
    const points: TrendPoint[] = [
      {
        date: '2026-11-02',
        requests: 0,
        total_tokens: 0,
        cost: 0,
        actual_cost: 0,
      },
      {
        date: '2026-11-04',
        requests: 3,
        total_tokens: 30,
        cost: 0.2,
        actual_cost: 0.1,
      },
    ]

    const days = buildHeatmapDays(points, '2026-11-01', '2026-11-05', 'requests')
    const byDate = Object.fromEntries(days.map((d) => [d.date, d]))

    expect(byDate['2026-11-02'].inRange).toBe(true)
    expect(byDate['2026-11-02'].point).not.toBeNull()
    expect(byDate['2026-11-02'].value).toBe(0)

    expect(byDate['2026-11-03'].inRange).toBe(true)
    expect(byDate['2026-11-03'].point).toBeNull()
    expect(byDate['2026-11-03'].value).toBe(0)

    expect(byDate['2026-11-04'].point?.requests).toBe(3)

    const outside = days.filter((d) => !d.inRange)
    expect(outside.length).toBeGreaterThan(0)
    expect(outside.every((d) => d.point === null)).toBe(true)
  })

  it('keeps year month labels on non-overlapping single-row spans', () => {
    const points: TrendPoint[] = []
    for (let month = 0; month < 12; month += 1) {
      points.push({
        date: `2026-${String(month + 1).padStart(2, '0')}-15`,
        requests: month + 1,
        total_tokens: 10,
        cost: 0.1,
        actual_cost: 0.05,
      })
    }

    const days = buildHeatmapDays(points, '2026-01-01', '2026-12-31', 'requests')
    const labels = buildYearMonthLabels(days, 'en')

    expect(labels.length).toBeGreaterThanOrEqual(12)
    expect(monthLabelsOverlap(labels)).toBe(false)

    for (let i = 0; i < labels.length - 1; i += 1) {
      const end = labels[i].column + labels[i].span
      expect(end).toBeLessThanOrEqual(labels[i + 1].column)
      expect(labels[i].span).toBeGreaterThanOrEqual(1)
    }
  })

  it('builds multi-year months with missing vs populated aggregates', () => {
    const points: TrendPoint[] = [
      {
        date: '2024-01-10',
        requests: 2,
        total_tokens: 20,
        cost: 0.1,
        actual_cost: 0.05,
      },
      {
        date: '2024-03-01',
        requests: 0,
        total_tokens: 0,
        cost: 0,
        actual_cost: 0,
      },
    ]

    const months = buildHeatmapMonths(
      points,
      '2024-01-01',
      '2024-03-31',
      'requests',
    )
    expect(months).toHaveLength(3)
    expect(months[0].point).not.toBeNull()
    expect(months[0].value).toBe(2)
    expect(months[1].point).toBeNull()
    expect(months[2].point).not.toBeNull()
    expect(months[2].value).toBe(0)
  })
})
