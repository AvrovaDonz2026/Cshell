import { apiRequest } from './client'
import type { ApiGroup, ApiKey, Paginated } from './types'

export function fetchKeys(page = 1, pageSize = 20): Promise<Paginated<ApiKey>> {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  })
  return apiRequest<Paginated<ApiKey>>(`/keys?${query.toString()}`)
}

export function createKey(input: {
  name: string
  group_id?: number
}): Promise<ApiKey> {
  return apiRequest<ApiKey>('/keys', {
    method: 'POST',
    body: input,
  })
}

export function deleteKey(id: number): Promise<unknown> {
  return apiRequest(`/keys/${id}`, { method: 'DELETE' })
}

export function fetchAvailableGroups(): Promise<ApiGroup[]> {
  return apiRequest<ApiGroup[]>('/groups/available')
}
