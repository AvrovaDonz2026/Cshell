import { apiRequest } from './client'
import type { DashboardStats, Paginated, TrendResponse, UsageLog } from './types'

export function fetchDashboardStats(): Promise<DashboardStats> {
  return apiRequest<DashboardStats>('/usage/dashboard/stats')
}

export function fetchUsageTrend(params: {
  start_date: string
  end_date: string
  granularity: 'day' | 'hour'
  timezone: string
  signal?: AbortSignal
}): Promise<TrendResponse> {
  const query = new URLSearchParams({
    start_date: params.start_date,
    end_date: params.end_date,
    granularity: params.granularity,
    timezone: params.timezone,
  })
  return apiRequest<TrendResponse>(`/usage/dashboard/trend?${query.toString()}`, {
    signal: params.signal,
  })
}

export function fetchUsageLogs(params: {
  page: number
  page_size: number
  start_date?: string
  end_date?: string
  /** Same IANA timezone used by the trend request. */
  timezone?: string
  signal?: AbortSignal
}): Promise<Paginated<UsageLog>> {
  const query = new URLSearchParams({
    page: String(params.page),
    page_size: String(params.page_size),
  })
  if (params.start_date) query.set('start_date', params.start_date)
  if (params.end_date) query.set('end_date', params.end_date)
  if (params.timezone) query.set('timezone', params.timezone)
  return apiRequest<Paginated<UsageLog>>(`/usage?${query.toString()}`, {
    signal: params.signal,
  })
}
