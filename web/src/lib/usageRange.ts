/** Pure date-range helpers for the Usage view filters. */

export type UsageRangeScale = 'hour' | 'month' | 'year' | 'multi-year'

export type UsageRangeError = 'usage.invalidRange' | 'usage.rangeTooLarge'

export type UsageRangeResult =
  | { ok: true; start: string; end: string; days: number }
  | { ok: false; error: UsageRangeError }

/** Inclusive maximum day span per heatmap scale. */
export const MAX_SPAN_DAYS: Record<UsageRangeScale, number> = {
  hour: 31,
  month: 62,
  year: 740,
  'multi-year': 3700,
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

function parseDateKey(value: string): Date | null {
  if (!DATE_KEY.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null
  }
  return date
}

/** Inclusive calendar-day count between two `YYYY-MM-DD` keys. */
export function daysInclusive(start: string, end: string): number {
  const from = parseDateKey(start)
  const to = parseDateKey(end)
  if (!from || !to) return 0
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1
}

export function maxSpanDays(scale: UsageRangeScale): number {
  return MAX_SPAN_DAYS[scale]
}

/**
 * Validate a draft range for a heatmap scale.
 * Both dates are required, must be real calendar dates, start <= end, and the
 * inclusive span must not exceed the per-scale cap.
 */
export function validateRange(
  start: string,
  end: string,
  scale: UsageRangeScale,
): UsageRangeResult {
  const from = start.trim()
  const to = end.trim()
  if (!from || !to) {
    return { ok: false, error: 'usage.invalidRange' }
  }
  const fromDate = parseDateKey(from)
  const toDate = parseDateKey(to)
  if (!fromDate || !toDate || fromDate.getTime() > toDate.getTime()) {
    return { ok: false, error: 'usage.invalidRange' }
  }
  const days = daysInclusive(from, to)
  if (days > maxSpanDays(scale)) {
    return { ok: false, error: 'usage.rangeTooLarge' }
  }
  return { ok: true, start: from, end: to, days }
}
