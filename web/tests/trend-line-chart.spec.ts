import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import TrendLineChart from '@/components/user/TrendLineChart.vue'
import { buildTrendSeries } from '@/utils/trendChart'
import type { TrendPoint } from '@/api/types'

const translate = (key: string, params?: Record<string, unknown>) => {
  const template =
    ({
      'usage.lineChartSummary':
        'Usage line chart of {metric} from {start} to {end}; total {total}.',
      'usage.lineChartEmpty': 'No data points to chart for this period',
    })[key] || key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (token, name) =>
    name in params ? String(params[name]) : token,
  )
}

function mountChart(points: TrendPoint[], metric: 'requests' | 'tokens' = 'requests') {
  const series = buildTrendSeries(points, metric)
  return mount(TrendLineChart, {
    props: { series, metric, translate },
  })
}

describe('TrendLineChart', () => {
  it('plots every populated day exactly once (no fabricated padding)', () => {
    const points: TrendPoint[] = [
      { date: '2026-11-01', requests: 4 },
      { date: '2026-11-02', requests: 7 },
      { date: '2026-11-05', requests: 2 },
    ]
    const wrapper = mountChart(points)
    // 3 real points -> 3 dots; November's other 27 days never appear.
    expect(wrapper.findAll('circle')).toHaveLength(3)
    expect(wrapper.find('svg').exists()).toBe(true)
  })

  it('breaks the line at missing days instead of plotting zeros', () => {
    // 11-01 -> 11-02 contiguous, 11-03 missing, 11-04 -> 11-05 contiguous.
    const points: TrendPoint[] = [
      { date: '2026-11-01', requests: 4 },
      { date: '2026-11-02', requests: 7 },
      { date: '2026-11-04', requests: 5 },
      { date: '2026-11-05', requests: 9 },
    ]
    const series = buildTrendSeries(points, 'requests')
    expect(series.points.map((p) => p.contiguous)).toEqual([
      true,
      true,
      false,
      true,
    ])
    const wrapper = mountChart(points)
    // Two path elements: one area (with fill) covering the two segments,
    // and the stroke line — each holds two M… segments (no bridge over the gap).
    const area = wrapper.find('path.trend-chart__area')
    const line = wrapper.find('path.trend-chart__line')
    expect((area.attributes('d') ?? '').split('M').filter(Boolean)).toHaveLength(2)
    expect((line.attributes('d') ?? '').split('M').filter(Boolean)).toHaveLength(2)
    // 11-03 is absent from the plotted coordinates entirely.
    const dots = wrapper.findAll('circle')
    expect(dots).toHaveLength(4)
  })

  it('plots explicit zero values as zero, not gaps', () => {
    const points: TrendPoint[] = [
      { date: '2026-11-01', requests: 0 },
      { date: '2026-11-02', requests: 0 },
      { date: '2026-11-03', requests: 6 },
    ]
    const wrapper = mountChart(points)
    expect(wrapper.findAll('circle')).toHaveLength(3)
    // One continuous segment — explicit zeros do not break the line.
    const line = wrapper.find('path.trend-chart__line')
    expect((line.attributes('d') ?? '').split('M').filter(Boolean)).toHaveLength(1)
    const series = buildTrendSeries(points, 'requests')
    expect(series.points.map((p) => p.value)).toEqual([0, 0, 6])
  })

  it('derives new values when the metric changes without new API data', () => {
    const points: TrendPoint[] = [
      { date: '2026-11-01', requests: 2, total_tokens: 200 },
      { date: '2026-11-02', requests: 3, total_tokens: 500 },
    ]
    const requests = buildTrendSeries(points, 'requests')
    const tokens = buildTrendSeries(points, 'tokens')
    expect(requests.points.map((p) => p.value)).toEqual([2, 3])
    expect(requests.total).toBe(5)
    expect(tokens.points.map((p) => p.value)).toEqual([200, 500])
    expect(tokens.total).toBe(700)

    const wrapper = mount(TrendLineChart, {
      props: { series: tokens, metric: 'tokens', translate },
    })
    // Y-axis scale (max caption) follows the switched metric.
    expect(wrapper.find('.trend-chart__max').text()).toContain('500 tokens')
    expect(wrapper.find('.trend-chart__max').text()).not.toContain('requests')
  })

  it('shows an empty state when there are no points', () => {
    const wrapper = mountChart([])
    expect(wrapper.find('svg').exists()).toBe(false)
    expect(wrapper.find('[role="status"]').text()).toBe(
      'No data points to chart for this period',
    )
  })

  it('plots an all-zero series flat on the baseline (no divide-by-zero)', () => {
    const wrapper = mountChart([
      { date: '2026-11-01', requests: 0 },
      { date: '2026-11-02', requests: 0 },
    ])
    const line = wrapper.find('path.trend-chart__line')
    expect(line.exists()).toBe(true)
    // Every plotted y equals the chart baseline when all values are zero.
    const ys = (line.attributes('d') ?? '')
      .split('L')
      .slice(1)
      .map((part) => Number.parseFloat(part.split(',')[1] ?? ''))
    expect(ys.length).toBeGreaterThan(0)
    expect(ys.every((y) => Number.isFinite(y))).toBe(true)
    expect(new Set(ys).size).toBe(1)
  })

  it('summarizes the series for screen readers via aria-label', () => {
    const points: TrendPoint[] = [
      { date: '2026-11-01', requests: 4 },
      { date: '2026-11-02', requests: 6 },
      { date: '2026-11-03', requests: 5 },
    ]
    const wrapper = mountChart(points)
    const svg = wrapper.find('svg')
    expect(svg.attributes('role')).toBe('img')
    expect(svg.attributes('aria-label')).toBe(
      'Usage line chart of requests from 2026-11-01 to 2026-11-03; total 15.',
    )
  })

  it('renders hour buckets (hour scale) with hour axis labels', () => {
    const points: TrendPoint[] = [
      { date: '2026-11-24T09:00:00', requests: 1 },
      { date: '2026-11-24T10:00:00', requests: 2 },
      { date: '2026-11-24T11:00:00', requests: 3 },
    ]
    const wrapper = mountChart(points)
    expect(wrapper.findAll('circle')).toHaveLength(3)
    const captions = wrapper.findAll('.trend-chart__captions span')
    expect(captions[0]!.text()).toBe('09:00')
    expect(captions[2]!.text()).toBe('11:00')
  })
})
