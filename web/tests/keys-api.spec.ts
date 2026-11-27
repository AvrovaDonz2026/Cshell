import { describe, expect, it } from 'vitest'
import {
  buildCreateKeyPayload,
  buildUpdateKeyPayload,
  KeyInputError,
  MAX_IP_ENTRIES,
  parseIpList,
  validateIpList,
  validateKeyExpiry,
  validateKeyGroupId,
  validateKeyQuota,
} from '@/api/keys'

describe('keys API payload builders', () => {
  it('parses IP lists one per line and trims blanks', () => {
    expect(parseIpList(' 1.1.1.1 \n\n2.2.2.2\n')).toEqual([
      '1.1.1.1',
      '2.2.2.2',
    ])
  })

  it('builds create payload with optional quota, group, ips, and expiry', () => {
    const payload = buildCreateKeyPayload({
      name: '  Research key  ',
      group_id: '7',
      quota: '50.5',
      expires_in_days: '30',
      ip_whitelist: '10.0.0.1\n10.0.0.2',
      ip_blacklist: '9.9.9.9',
    })

    expect(payload).toEqual({
      name: 'Research key',
      group_id: 7,
      quota: 50.5,
      expires_in_days: 30,
      ip_whitelist: ['10.0.0.1', '10.0.0.2'],
      ip_blacklist: ['9.9.9.9'],
    })
  })

  it('accepts valid CIDR entries', () => {
    const payload = buildCreateKeyPayload({
      name: 'cidr',
      ip_whitelist: '10.0.0.0/8\n2001:db8::/32',
    })
    expect(payload.ip_whitelist).toEqual(['10.0.0.0/8', '2001:db8::/32'])
  })

  it('trims and deduplicates IP entries', () => {
    const list = validateIpList('  10.0.0.1 \n10.0.0.1\n\n2001:DB8::1\n2001:db8::1\n')
    expect(list).toEqual(['10.0.0.1', '2001:DB8::1'])
  })

  it('omits empty optional create fields', () => {
    const payload = buildCreateKeyPayload({
      name: 'minimal',
      group_id: '',
      quota: '',
      expires_in_days: '',
      ip_whitelist: '',
      ip_blacklist: '\n\n',
    })

    expect(payload).toEqual({ name: 'minimal' })
  })

  it('builds update payload including empty IP arrays', () => {
    const payload = buildUpdateKeyPayload({
      name: 'renamed',
      status: 'inactive',
      quota: '12',
      ip_whitelist: '',
      ip_blacklist: '8.8.8.8',
    })

    expect(payload).toEqual({
      name: 'renamed',
      status: 'inactive',
      quota: 12,
      ip_whitelist: [],
      ip_blacklist: ['8.8.8.8'],
    })
  })

  it('omits status when the user did not change it', () => {
    const payload = buildUpdateKeyPayload({ name: 'plain', status: undefined })
    expect(payload).toEqual({ name: 'plain' })
  })
})

describe('key field validators', () => {
  it('accepts valid quotas and omits empty input', () => {
    expect(validateKeyQuota('')).toBeUndefined()
    expect(validateKeyQuota(undefined)).toBeUndefined()
    expect(validateKeyQuota('0')).toBe(0)
    expect(validateKeyQuota(1000000)).toBe(1000000)
    expect(validateKeyQuota(12.5)).toBe(12.5)
  })

  it('throws invalid_quota for bad quotas', () => {
    for (const bad of ['-1', '1000001', 'abc', 'Infinity', 'NaN']) {
      expect(() => validateKeyQuota(bad)).toThrowError(KeyInputError)
    }
    try {
      validateKeyQuota('-1')
    } catch (err) {
      expect((err as KeyInputError).code).toBe('invalid_quota')
      expect((err as KeyInputError).messageKey).toBe('keys.errorQuota')
    }
  })

  it('validates expiry as an integer within bounds', () => {
    expect(validateKeyExpiry('')).toBeUndefined()
    expect(validateKeyExpiry('1')).toBe(1)
    expect(validateKeyExpiry(3650)).toBe(3650)
    for (const bad of ['0', '-3', '1.5', '3651', 'abc']) {
      expect(() => validateKeyExpiry(bad)).toThrowError(KeyInputError)
    }
  })

  it('validates group id as a positive integer', () => {
    expect(validateKeyGroupId('')).toBeUndefined()
    expect(validateKeyGroupId('7')).toBe(7)
    for (const bad of ['0', '-2', '1.5', 'abc']) {
      expect(() => validateKeyGroupId(bad)).toThrowError(KeyInputError)
    }
  })

  it('throws invalid_ip for malformed entries', () => {
    for (const bad of ['999.1.1.1', '10.0.0.0/33', 'hello', '::gg']) {
      expect(() => validateIpList(bad)).toThrowError(KeyInputError)
    }
    try {
      validateIpList('hello')
    } catch (err) {
      expect((err as KeyInputError).code).toBe('invalid_ip')
    }
  })

  it('caps IP lists at the entry limit', () => {
    const many = Array.from({ length: MAX_IP_ENTRIES + 1 }, (_, i) => `10.0.0.${i % 250}`)
    expect(() => validateIpList(many)).toThrowError(KeyInputError)
    const atCap = Array.from({ length: MAX_IP_ENTRIES }, (_, i) => `10.0.1.${i}`)
    expect(validateIpList(atCap)).toHaveLength(MAX_IP_ENTRIES)
  })

  it('never silently drops invalid create input', () => {
    expect(() =>
      buildCreateKeyPayload({ name: 'bad', quota: 'nope' }),
    ).toThrowError(KeyInputError)
    expect(() =>
      buildCreateKeyPayload({ name: 'bad', expires_in_days: '0' }),
    ).toThrowError(KeyInputError)
    expect(() =>
      buildCreateKeyPayload({ name: 'bad', group_id: '0' }),
    ).toThrowError(KeyInputError)
    expect(() =>
      buildCreateKeyPayload({ name: 'bad', ip_whitelist: 'bad-ip' }),
    ).toThrowError(KeyInputError)
  })
})
