/**
 * Pure payment helpers shared by the checkout and result views.
 * Kept free of Vue/browser state so they can be unit tested directly.
 */

export type NormalizedOrderStatus =
  | 'paid'
  | 'pending'
  | 'expired'
  | 'failed'
  | 'cancelled'
  | 'refunded'
  | 'unknown'

const PAID_STATUSES = new Set(['paid', 'completed', 'complete', 'success', 'succeeded'])
const PENDING_STATUSES = new Set([
  'pending',
  'waiting',
  'created',
  'processing',
  'recharging',
  'unpaid',
  'in_progress',
  'new',
])
const EXPIRED_STATUSES = new Set(['expired', 'expired_timeout', 'timeout', 'timed_out'])
const FAILED_STATUSES = new Set(['failed', 'failure', 'error'])
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled'])
const REFUNDED_STATUSES = new Set(['refunded', 'refund', 'refund_requested', 'refunding', 'refund_pending', 'partially_refunded', 'refund_failed'])

const TERMINAL_STATUSES = new Set<NormalizedOrderStatus>([
  'paid',
  'expired',
  'failed',
  'cancelled',
  'refunded',
])

/** Map provider-specific status strings onto a small, stable vocabulary. */
export function normalizeOrderStatus(
  status: unknown,
  paid?: boolean,
): NormalizedOrderStatus {
  const raw = typeof status === 'string' ? status.trim().toLowerCase() : ''
  if (REFUNDED_STATUSES.has(raw)) return 'refunded'
  if (paid === true) return 'paid'
  if (!raw) return paid === false ? 'pending' : 'unknown'
  if (PAID_STATUSES.has(raw)) return 'paid'
  if (PENDING_STATUSES.has(raw)) return 'pending'
  if (EXPIRED_STATUSES.has(raw)) return 'expired'
  if (FAILED_STATUSES.has(raw)) return 'failed'
  if (CANCELLED_STATUSES.has(raw)) return 'cancelled'
  if (REFUNDED_STATUSES.has(raw)) return 'refunded'
  return 'unknown'
}

/** Terminal states stop polling and allow starting a new order. */
export function isTerminalStatus(status: NormalizedOrderStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

export type PaymentAmountError =
  | 'not-a-number'
  | 'not-finite'
  | 'non-positive'
  | 'too-many-decimals'
  | 'below-minimum'
  | 'above-maximum'
  | 'above-daily-remaining'

export interface PaymentLimitInput {
  globalMin?: number | null
  globalMax?: number | null
  singleMin?: number | null
  singleMax?: number | null
  dailyRemaining?: number | null
}

export interface PaymentAmountValidation {
  ok: boolean
  value: number
  /** Effective lower/upper bounds after combining global and method limits. */
  min: number | null
  max: number | null
  error?: PaymentAmountError
  /** English fallback; views localize from `error` when possible. */
  reason?: string
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function effectiveMin(limits: PaymentLimitInput): number | null {
  const candidates = [limits.globalMin, limits.singleMin].filter(finite)
  return candidates.length ? Math.max(...candidates) : null
}

export function effectiveMax(limits: PaymentLimitInput): number | null {
  const candidates: number[] = []
  if (finite(limits.globalMax)) candidates.push(limits.globalMax)
  if (finite(limits.singleMax)) candidates.push(limits.singleMax)
  if (finite(limits.dailyRemaining) && limits.dailyRemaining > 0) {
    candidates.push(limits.dailyRemaining)
  }
  return candidates.length ? Math.min(...candidates) : null
}

function decimalPlaces(value: number): number {
  if (Number.isInteger(value)) return 0
  const text = String(value)
  if (text.includes('e-') || text.includes('E-')) {
    // Very small exponentials are always too precise for money inputs.
    return 3
  }
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : text.length - dot - 1
}

/**
 * Validate a checkout amount against global + per-method limits.
 * Enforces > 0, finite, at most 2 decimals and the combined min/max.
 */
export function validatePaymentAmount(
  raw: unknown,
  limits: PaymentLimitInput,
): PaymentAmountValidation {
  const min = effectiveMin(limits)
  const max = effectiveMax(limits)
  const fail = (error: PaymentAmountError, reason: string): PaymentAmountValidation => ({
    ok: false,
    value: Number(raw),
    min,
    max,
    error,
    reason,
  })

  if (typeof raw === 'string' && raw.trim() === '') {
    return fail('not-a-number', 'Enter an amount.')
  }
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (typeof raw === 'boolean' || raw == null || raw === '') {
    return fail('not-a-number', 'Enter an amount.')
  }
  if (Number.isNaN(value)) {
    return fail('not-a-number', 'Enter a valid number.')
  }
  if (!Number.isFinite(value)) {
    return fail('not-finite', 'Enter a finite amount.')
  }
  if (value <= 0) {
    return fail('non-positive', 'Amount must be greater than 0.')
  }
  if (decimalPlaces(value) > 2) {
    return fail('too-many-decimals', 'Amount may have at most 2 decimal places.')
  }
  if (min !== null && value < min) {
    return fail(
      'below-minimum',
      `Amount is below the minimum of ${min}.`,
    )
  }
  if (max !== null && value > max) {
    const dailyBinding =
      finite(limits.dailyRemaining) &&
      limits.dailyRemaining > 0 &&
      limits.dailyRemaining === max
    if (dailyBinding) {
      return fail(
        'above-daily-remaining',
        `Amount exceeds today's remaining limit of ${max}.`,
      )
    }
    return fail('above-maximum', `Amount exceeds the maximum of ${max}.`)
  }
  return { ok: true, value, min, max }
}

export function secondsRemaining(
  expiresAt: string | undefined | null,
  now: number = Date.now(),
): number | null {
  if (!expiresAt) return null
  const parsed = Date.parse(expiresAt)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.floor((parsed - now) / 1000))
}

export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * Monotonic counter so late responses can be discarded. A response only
 * applies when its generation is still the newest issued one.
 */
export interface GenerationGuard {
  next(): number
  isCurrent(generation: number): boolean
  current(): number
}

export function createGenerationGuard(): GenerationGuard {
  let generation = 0
  return {
    next() {
      generation += 1
      return generation
    },
    isCurrent(candidate: number) {
      return candidate === generation
    },
    current() {
      return generation
    },
  }
}
