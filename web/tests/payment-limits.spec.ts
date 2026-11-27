import { describe, expect, it } from 'vitest'
import {
  createGenerationGuard,
  effectiveMax,
  effectiveMin,
  normalizeOrderStatus,
  validatePaymentAmount,
} from '@/lib/payment'

describe('payment amount validation', () => {
  const limits = {
    globalMin: 1,
    globalMax: 1000,
    singleMin: 2,
    singleMax: 500,
    dailyRemaining: 300,
  }

  it('combines global and method bounds', () => {
    expect(effectiveMin(limits)).toBe(2)
    // daily remaining is smaller than single/global max, so it binds.
    expect(effectiveMax(limits)).toBe(300)
  })

  it('ignores non-positive daily remaining when bound', () => {
    expect(effectiveMax({ ...limits, dailyRemaining: 0 })).toBe(500)
    expect(effectiveMax({ ...limits, dailyRemaining: null })).toBe(500)
  })

  it('accepts a value inside all bounds', () => {
    const result = validatePaymentAmount('5', limits)
    expect(result.ok).toBe(true)
    expect(result.value).toBe(5)
    expect(result.min).toBe(2)
    expect(result.max).toBe(300)
  })

  it('rejects empty and non-numeric input', () => {
    expect(validatePaymentAmount('', limits).error).toBe('not-a-number')
    expect(validatePaymentAmount('abc', limits).error).toBe('not-a-number')
    expect(validatePaymentAmount(null, limits).error).toBe('not-a-number')
  })

  it('rejects zero, negatives and non-finite values', () => {
    expect(validatePaymentAmount(0, limits).error).toBe('non-positive')
    expect(validatePaymentAmount(-1, limits).error).toBe('non-positive')
    expect(validatePaymentAmount(Infinity, limits).error).toBe('not-finite')
  })

  it('rejects more than two decimals', () => {
    expect(validatePaymentAmount('2.555', limits).error).toBe('too-many-decimals')
    expect(validatePaymentAmount('2.55', limits).ok).toBe(true)
  })

  it('rejects below the combined minimum', () => {
    const result = validatePaymentAmount('1.5', limits)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('below-minimum')
    expect(result.min).toBe(2)
  })

  it('distinguishes the daily remaining bound from the max bound', () => {
    const daily = validatePaymentAmount('400', limits)
    expect(daily.error).toBe('above-daily-remaining')
    const max = validatePaymentAmount('600', { ...limits, dailyRemaining: 1000 })
    expect(max.error).toBe('above-maximum')
    expect(validatePaymentAmount('450', { ...limits, dailyRemaining: 1000 }).ok).toBe(true)
  })

  it('allows any positive amount when no limits are provided', () => {
    const result = validatePaymentAmount('0.5', {})
    expect(result.ok).toBe(true)
    expect(result.min).toBeNull()
    expect(result.max).toBeNull()
  })
})

describe('status normalization', () => {
  it('maps paid-family statuses to paid', () => {
    for (const status of ['paid', 'COMPLETED', 'success', 'Succeeded']) {
      expect(normalizeOrderStatus(status)).toBe('paid')
    }
    expect(normalizeOrderStatus('anything', true)).toBe('paid')
  })

  it('maps pending-family statuses to pending', () => {
    for (const status of ['pending', 'WAITING', 'created', 'processing']) {
      expect(normalizeOrderStatus(status)).toBe('pending')
    }
  })

  it('maps expired/failed/cancelled/refunded families', () => {
    expect(normalizeOrderStatus('expired_timeout')).toBe('expired')
    expect(normalizeOrderStatus('EXPIRED')).toBe('expired')
    expect(normalizeOrderStatus('failed')).toBe('failed')
    expect(normalizeOrderStatus('cancelled')).toBe('cancelled')
    expect(normalizeOrderStatus('canceled')).toBe('cancelled')
    expect(normalizeOrderStatus('refunded')).toBe('refunded')
  })

  it('falls back to unknown for unrecognized values', () => {
    expect(normalizeOrderStatus('weird')).toBe('unknown')
    expect(normalizeOrderStatus(null, false)).toBe('pending')
    expect(normalizeOrderStatus(undefined)).toBe('unknown')
  })
})

describe('stale response generation guard', () => {
  it('only accepts the latest issued generation', () => {
    const guard = createGenerationGuard()
    const first = guard.next()
    const second = guard.next()
    expect(guard.isCurrent(first)).toBe(false)
    expect(guard.isCurrent(second)).toBe(true)
    guard.next()
    expect(guard.isCurrent(second)).toBe(false)
  })
})
