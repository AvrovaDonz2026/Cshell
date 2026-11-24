import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import HeatmapGrid from '@/components/user/HeatmapGrid.vue'
import { buildHeatmapDays, weekCountForDays, type HeatmapDayCell } from '@/utils/heatmap'
import type { TrendPoint } from '@/api/types'

describe('shared HeatmapGrid', () => {
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

  it('renders identical explicit-zero, missing, and outside labels for consumers', () => {
    const render = (dayCells: HeatmapDayCell[]) => mount(HeatmapGrid, { props: { ...props, dayCells } })
    const dashboardRendering = render(cells)
    const usageRendering = render([...cells])
    const labels = (wrapper: typeof dashboardRendering) => wrapper.findAll('[role="gridcell"]').map((cell) => cell.attributes('aria-label'))
    expect(labels(dashboardRendering)).toEqual(labels(usageRendering))
    expect(labels(dashboardRendering)).toContain('2026-11-02; 0 requests; 0 requests;')
    expect(labels(dashboardRendering)).toContain('2026-11-03; Missing')
    expect(labels(dashboardRendering).some((label) => label?.endsWith('; Outside'))).toBe(true)
  })

  it('aligns month labels with the day-grid columns', () => {
    const wrapper = mount(HeatmapGrid, { props: { ...props, scale: 'year' as const, monthLabels: [{ key: '2026-11', label: 'Nov', column: 0, span: 2 }] } })
    const layoutStyle = wrapper.find('.day-layout').attributes('style') ?? ''
    const labelsStyle = wrapper.find('.heatmap-month-labels').attributes('style') ?? ''

    const parseColumnValue = (style: string, property: string): number => {
      const match = style.match(new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`))
      expect(match, `expected ${property} in "${style}"`).not.toBeNull()
      return Number.parseFloat(match![1]!)
    }

    const railWidth = Number.parseFloat(layoutStyle.match(/grid-template-columns:\s*([\d.]+)rem/)![1]!)
    const columnGap = parseColumnValue(layoutStyle, 'gap')
    const labelsLeft = parseColumnValue(labelsStyle, 'margin-left')

    // The labels' left edge must equal the weekday rail width + column gap.
    expect(labelsLeft).toBeCloseTo(railWidth + columnGap, 5)
  })

  it('applies compact density via the compact prop', () => {
    const roomy = mount(HeatmapGrid, { props: { ...props } })
    const compact = mount(HeatmapGrid, { props: { ...props, compact: true } })

    const minWidth = (wrapper: ReturnType<typeof mount>) =>
      (wrapper.find('.day-layout').attributes('style') ?? '').match(/min-width:\s*([^;]+)/)?.[1]?.trim()

    expect(minWidth(roomy)).toBe('24rem')
    expect(minWidth(compact)).toBe('18rem')
  })

  it('keeps day cells at least 10px tall with the compacted footprint', async () => {
    // 0.75rem = 12px >= the 10px minimum clickable height.
    const source = (await import('@/components/user/HeatmapGrid.vue?raw')).default as string
    expect(source).toContain('min-height:0.75rem')
    // Compaction: cell min-height below the previous 1rem, tighter gaps.
    expect(source).not.toContain('min-height:1rem;')
    expect(source).toContain('min-height:1.75rem') // multi-year month cells 2.5rem -> 1.75rem
    expect(source).not.toContain('min-height:2.5rem')
    expect(source).not.toContain('gap:.35rem')
    expect(source).not.toContain('gap:.4rem')
    // Legend (Less/More swatches) stays.
    const wrapper = mount(HeatmapGrid, { props })
    expect(wrapper.find('.legend').exists()).toBe(true)
    expect(wrapper.findAll('.legend__swatch')).toHaveLength(5)
    // Zero/missing/outside semantics survive compaction: Mon 11-02 grid pads
    // back to Sunday and forward to Saturday -> 7 cells (1 explicit zero,
    // 1 missing, 5 outside).
    expect(wrapper.findAll('[role="gridcell"]')).toHaveLength(7)
    expect(wrapper.text()).toContain('Less')
    expect(wrapper.text()).toContain('More')
  })
})
