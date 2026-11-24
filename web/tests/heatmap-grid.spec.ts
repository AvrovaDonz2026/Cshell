import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import HeatmapGrid from '@/components/user/HeatmapGrid.vue'
import { buildHeatmapDays, weekCountForDays, type HeatmapDayCell } from '@/utils/heatmap'
import type { TrendPoint } from '@/api/types'

describe('shared HeatmapGrid', () => {
  it('renders identical explicit-zero, missing, and outside labels for consumers', () => {
    const points: TrendPoint[] = [{ date: '2026-11-02', requests: 0 }]
    const cells = buildHeatmapDays(points, '2026-11-02', '2026-11-03', 'requests')
    const props = {
      scale: 'month' as const,
      hourCells: [],
      dayCells: cells,
      monthCells: [],
      weekCount: weekCountForDays(cells),
      monthLabels: [],
      weekdayLabels: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      maxValue: 0,
      metric: 'requests' as const,
      translate: (key: string) => ({ 'usage.missing': 'Missing', 'usage.outside': 'Outside', 'usage.less': 'Less', 'usage.more': 'More' })[key] || key,
    }
    const render = (dayCells: HeatmapDayCell[]) => mount(HeatmapGrid, { props: { ...props, dayCells } })
    const dashboardRendering = render(cells)
    const usageRendering = render([...cells])
    const labels = (wrapper: typeof dashboardRendering) => wrapper.findAll('[role="gridcell"]').map((cell) => cell.attributes('aria-label'))
    expect(labels(dashboardRendering)).toEqual(labels(usageRendering))
    expect(labels(dashboardRendering)).toContain('2026-11-02; 0 requests; 0 requests;')
    expect(labels(dashboardRendering)).toContain('2026-11-03; Missing')
    expect(labels(dashboardRendering).some((label) => label?.endsWith('; Outside'))).toBe(true)
  })
})
