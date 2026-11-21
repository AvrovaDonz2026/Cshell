import { apiRequest } from './client'
import type { DashboardStats, TrendResponse } from './types'

export function fetchDashboardStats(): Promise<DashboardStats> {
  return apiRequest<DashboardStats>('/usage/dashboard/stats')
}

export function fetchUsageTrend(params: {
  start_date: string
  end_date: string
  granularity: 'day' | 'hour'
  timezone: string
}): Promise<TrendResponse> {
  const query = new URLSearchParams({
    start_date: params.start_date,
    end_date: params.end_date,
    granularity: params.granularity,
    timezone: params.timezone,
  })
  return apiRequest<TrendResponse>(`/usage/dashboard/trend?${query.toString()}`)
}
