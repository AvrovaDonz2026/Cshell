import { describe, expect, it } from 'vitest'
import {
  daysInclusive,
  maxSpanDays,
  validateRange,
} from '@/lib/usageRange'

describe('usage range helpers', () => {
  it('counts inclusive days between two dates', () => {
    expect(daysInclusive('2026-11-01', '2026-11-01')).toBe(1)
    expect(daysInclusive('2026-11-01', '2026-11-30')).toBe(30)
    expect(daysInclusive('2024-02-01', '2024-02-29')).toBe(29)
  })

  it('exposes per-scale span caps', () => {
    expect(maxSpanDays('hour')).toBe(31)
    expect(maxSpanDays('month')).toBe(62)
    expect(maxSpanDays('year')).toBe(740)
    expect(maxSpanDays('multi-year')).toBe(3700)
  })

  it('rejects missing or malformed dates', () => {
    expect(validateRange('', '2026-11-30', 'month')).toEqual({
      ok: false,
      error: 'usage.invalidRange',
    })
    expect(validateRange('2026-11-01', '', 'month')).toEqual({
      ok: false,
      error: 'usage.invalidRange',
    })
    expect(validateRange('2026-13-01', '2026-11-30', 'month')).toEqual({
      ok: false,
      error: 'usage.invalidRange',
    })
    expect(validateRange('2026-02-30', '2026-11-30', 'month')).toEqual({
      ok: false,
      error: 'usage.invalidRange',
    })
  })

  it('rejects reversed ranges', () => {
    expect(validateRange('2026-11-21', '2026-11-01', 'month')).toEqual({
      ok: false,
      error: 'usage.invalidRange',
    })
  })

  it('accepts a range at the scale ceiling and rejects one day over', () => {
    expect(validateRange('2026-01-01', '2026-01-31', 'hour').ok).toBe(true)
    expect(validateRange('2026-01-01', '2026-02-01', 'hour')).toEqual({
      ok: false,
      error: 'usage.rangeTooLarge',
    })

    expect(validateRange('2026-01-01', '2026-03-03', 'month').ok).toBe(true)
    expect(validateRange('2026-01-01', '2026-03-04', 'month')).toEqual({
      ok: false,
      error: 'usage.rangeTooLarge',
    })
  })

  it('returns the validated applied dates', () => {
    const result = validateRange(' 2026-11-01 ', ' 2026-11-20 ', 'month')
    expect(result).toEqual({
      ok: true,
      start: '2026-11-01',
      end: '2026-11-20',
      days: 20,
    })
  })
})
