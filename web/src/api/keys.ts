import { apiRequest } from './client'
import { isValidIpOrCidr } from '@/lib/ip'
import type { ApiGroup, ApiKey, Paginated } from './types'

/** Maximum entries allowed in a single IP allow/deny list. */
export const MAX_IP_ENTRIES = 50
export const MAX_KEY_QUOTA = 1_000_000
export const MIN_KEY_EXPIRY_DAYS = 1
export const MAX_KEY_EXPIRY_DAYS = 3650

export type KeyInputErrorCode =
  | 'invalid_quota'
  | 'invalid_expiry'
  | 'invalid_ip'
  | 'invalid_group'

/** Typed validation failure carrying an i18n message key for the form. */
export class KeyInputError extends Error {
  readonly code: KeyInputErrorCode
  readonly messageKey: string

  constructor(code: KeyInputErrorCode, messageKey: string) {
    super(messageKey)
    this.name = 'KeyInputError'
    this.code = code
    this.messageKey = messageKey
  }
}

export interface CreateKeyInput {
  name: string
  group_id?: number
  quota?: number
  ip_whitelist?: string[]
  ip_blacklist?: string[]
  expires_in_days?: number
}

export interface UpdateKeyInput {
  name?: string
  status?: string
  quota?: number
  ip_whitelist?: string[]
  ip_blacklist?: string[]
  group_id?: number
}

export type KeyInputValue = string | number | undefined | null

function isBlank(input: KeyInputValue): boolean {
  return input === undefined || input === null || (
    typeof input === 'string' && input.trim() === ''
  )
}

/**
 * Validate and normalize an optional quota.
 * Empty input is omitted (`undefined`); otherwise it must be a finite number
 * in `[0, MAX_KEY_QUOTA]`. Throws `KeyInputError('invalid_quota')`.
 */
export function validateKeyQuota(input: KeyInputValue): number | undefined {
  if (isBlank(input)) return undefined
  const quota = typeof input === 'number' ? input : Number(String(input).trim())
  if (
    !Number.isFinite(quota) ||
    quota < 0 ||
    quota > MAX_KEY_QUOTA
  ) {
    throw new KeyInputError('invalid_quota', 'keys.errorQuota')
  }
  return quota
}

/**
 * Validate and normalize an optional expiry in days.
 * Empty input is omitted (`undefined`); otherwise it must be an integer in
 * `[MIN_KEY_EXPIRY_DAYS, MAX_KEY_EXPIRY_DAYS]`.
 */
export function validateKeyExpiry(input: KeyInputValue): number | undefined {
  if (isBlank(input)) return undefined
  const days = typeof input === 'number' ? input : Number(String(input).trim())
  if (
    !Number.isInteger(days) ||
    days < MIN_KEY_EXPIRY_DAYS ||
    days > MAX_KEY_EXPIRY_DAYS
  ) {
    throw new KeyInputError('invalid_expiry', 'keys.errorExpiry')
  }
  return days
}

/**
 * Validate and normalize an optional group id.
 * Empty input is omitted (`undefined`); otherwise it must be a positive integer.
 */
export function validateKeyGroupId(input: KeyInputValue): number | undefined {
  if (isBlank(input)) return undefined
  const id = typeof input === 'number' ? input : Number(String(input).trim())
  if (!Number.isInteger(id) || id <= 0) {
    throw new KeyInputError('invalid_group', 'keys.errorGroup')
  }
  return id
}

/**
 * Validate a single IP list: every entry must be IPv4/IPv6 or CIDR, at most
 * `MAX_IP_ENTRIES` entries, trimmed and deduplicated. Invalid entries throw.
 */
export function validateIpList(text: string | string[] | undefined | null): string[] {
  if (text === undefined || text === null) return []
  const raw = Array.isArray(text) ? text : text.split(/\r?\n/)
  const trimmed = raw
    .map((line) => (typeof line === 'string' ? line.trim() : ''))
    .filter(Boolean)

  if (trimmed.length > MAX_IP_ENTRIES) {
    throw new KeyInputError('invalid_ip', 'keys.errorIp')
  }

  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of trimmed) {
    if (!isValidIpOrCidr(entry)) {
      throw new KeyInputError('invalid_ip', 'keys.errorIp')
    }
    const dedupeKey = entry.toLowerCase()
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    result.push(entry)
  }
  return result
}

export function parseIpList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/** Build a POST /keys payload, validating every optional field. */
export function buildCreateKeyPayload(input: {
  name: string
  group_id?: KeyInputValue
  quota?: KeyInputValue
  ip_whitelist?: string | string[]
  ip_blacklist?: string | string[]
  expires_in_days?: KeyInputValue
}): CreateKeyInput {
  const payload: CreateKeyInput = {
    name: input.name.trim(),
  }

  const groupId = validateKeyGroupId(input.group_id)
  if (groupId !== undefined) payload.group_id = groupId

  const quota = validateKeyQuota(input.quota)
  if (quota !== undefined) payload.quota = quota

  if (input.ip_whitelist !== undefined) {
    const list = validateIpList(input.ip_whitelist)
    if (list.length) payload.ip_whitelist = list
  }

  if (input.ip_blacklist !== undefined) {
    const list = validateIpList(input.ip_blacklist)
    if (list.length) payload.ip_blacklist = list
  }

  const expires = validateKeyExpiry(input.expires_in_days)
  if (expires !== undefined) payload.expires_in_days = expires

  return payload
}

/**
 * Build a PUT /keys/:id payload, validating every provided field.
 * `status` is forwarded only when the caller supplies it explicitly.
 */
export function buildUpdateKeyPayload(input: {
  name?: string
  status?: string
  quota?: KeyInputValue
  ip_whitelist?: string | string[]
  ip_blacklist?: string | string[]
  group_id?: KeyInputValue
}): UpdateKeyInput {
  const payload: UpdateKeyInput = {}

  if (input.name !== undefined) payload.name = input.name.trim()
  if (input.status !== undefined) payload.status = input.status

  const groupId = validateKeyGroupId(input.group_id)
  if (groupId !== undefined) payload.group_id = groupId

  const quota = validateKeyQuota(input.quota)
  if (quota !== undefined) payload.quota = quota

  if (input.ip_whitelist !== undefined) {
    payload.ip_whitelist = validateIpList(input.ip_whitelist)
  }

  if (input.ip_blacklist !== undefined) {
    payload.ip_blacklist = validateIpList(input.ip_blacklist)
  }

  return payload
}

export function fetchKeys(
  page = 1,
  pageSize = 20,
  filters?: { search?: string; status?: string },
): Promise<Paginated<ApiKey>> {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  })
  if (filters?.search) query.set('search', filters.search)
  if (filters?.status) query.set('status', filters.status)
  return apiRequest<Paginated<ApiKey>>(`/keys?${query.toString()}`)
}

export function createKey(input: CreateKeyInput): Promise<ApiKey> {
  return apiRequest<ApiKey>('/keys', {
    method: 'POST',
    body: input,
  })
}

export function updateKey(id: number, partial: UpdateKeyInput): Promise<ApiKey> {
  return apiRequest<ApiKey>(`/keys/${id}`, {
    method: 'PUT',
    body: partial,
  })
}

export function deleteKey(id: number): Promise<unknown> {
  return apiRequest(`/keys/${id}`, { method: 'DELETE' })
}

export function fetchAvailableGroups(): Promise<ApiGroup[]> {
  return apiRequest<ApiGroup[]>('/groups/available')
}
