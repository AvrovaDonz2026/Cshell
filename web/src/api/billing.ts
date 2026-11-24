import { apiRequest } from './client'
import type {
  CheckoutInfo,
  CreateOrderResult,
  Paginated,
  PaymentConfig,
  PaymentLimits,
  PaymentOrder,
  PaymentPlan,
  PublicOrderVerify,
  PublicOrderResolve,
  SubscriptionItem,
  SubscriptionSummary,
} from './types'

interface FetchOptions {
  signal?: AbortSignal
}

export function fetchSubscriptionSummary(
  options: FetchOptions = {},
): Promise<SubscriptionSummary> {
  return apiRequest<SubscriptionSummary>('/subscriptions/summary', {
    signal: options.signal,
  })
}

export function fetchSubscriptions(
  options: FetchOptions = {},
): Promise<SubscriptionItem[]> {
  return apiRequest<SubscriptionItem[]>('/subscriptions', {
    signal: options.signal,
  })
}

export function fetchCheckoutInfo(
  options: FetchOptions = {},
): Promise<CheckoutInfo> {
  return apiRequest<CheckoutInfo>('/payment/checkout-info', {
    signal: options.signal,
  })
}

export function fetchPaymentPlans(
  options: FetchOptions = {},
): Promise<PaymentPlan[]> {
  return apiRequest<PaymentPlan[]>('/payment/plans', {
    signal: options.signal,
  })
}

export function fetchPaymentConfig(
  options: FetchOptions = {},
): Promise<PaymentConfig> {
  return apiRequest<PaymentConfig>('/payment/config', {
    signal: options.signal,
  })
}

export function fetchPaymentLimits(
  options: FetchOptions = {},
): Promise<PaymentLimits> {
  return apiRequest<PaymentLimits>('/payment/limits', {
    signal: options.signal,
  })
}

export function fetchMyOrders(
  page = 1,
  pageSize = 20,
  options: { signal?: AbortSignal; status?: string } = {},
): Promise<Paginated<PaymentOrder>> {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  })
  if (options.status) query.set('status', options.status)
  return apiRequest<Paginated<PaymentOrder>>(
    `/payment/orders/my?${query.toString()}`,
    { signal: options.signal },
  )
}

export function createPaymentOrder(
  input: {
    amount: number
    payment_type: string
    order_type: string
    plan_id?: number
    return_url?: string
    payment_source?: string
  },
  options: FetchOptions = {},
): Promise<CreateOrderResult> {
  return apiRequest<CreateOrderResult>('/payment/orders', {
    method: 'POST',
    signal: options.signal,
    body: {
      ...input,
      payment_source: input.payment_source ?? 'web',
    },
  })
}

export function verifyPublicOrder(
  input: { out_trade_no: string },
  options: FetchOptions = {},
): Promise<PublicOrderVerify> {
  return apiRequest<PublicOrderVerify>('/payment/public/orders/verify', {
    method: 'POST',
    body: input,
    auth: false,
    skipRefresh: true,
    signal: options.signal,
  })
}

export function resolvePublicOrder(
  input: { resume_token: string },
  options: FetchOptions = {},
): Promise<PublicOrderResolve> {
  return apiRequest<PublicOrderResolve>('/payment/public/orders/resolve', {
    method: 'POST',
    body: input,
    auth: false,
    skipRefresh: true,
    signal: options.signal,
  })
}

export function fetchOrder(
  id: number,
  options: FetchOptions = {},
): Promise<PaymentOrder> {
  return apiRequest<PaymentOrder>(`/payment/orders/${id}`, {
    signal: options.signal,
  })
}

export function cancelOrder(
  id: number,
  options: FetchOptions = {},
): Promise<{ ok?: boolean } | PaymentOrder> {
  return apiRequest<{ ok?: boolean } | PaymentOrder>(
    `/payment/orders/${id}/cancel`,
    { method: 'POST', signal: options.signal },
  )
}

/**
 * Redirect allowlist: absolute http(s) URLs only, or same-origin relative
 * paths. Blocks `javascript:`, `data:`, protocol-relative `//host` and
 * malformed values.
 */
export function isSafeRedirectUrl(url: string | null | undefined): boolean {
  if (typeof url !== 'string') return false
  const value = url.trim()
  if (!value) return false
  // Reject protocol-relative and backslash tricks before parsing.
  if (value.startsWith('//') || value.startsWith('\\\\')) return false

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value)
  if (!hasScheme) {
    // Relative path must be a single-slash root-relative path, with no
    // whitespace or control characters that browsers would strip.
    if (!value.startsWith('/')) return false
    for (const char of value) {
      const code = char.charCodeAt(0)
      if (code <= 0x20 || code === 0x7f) return false
    }
    try {
      const base =
        typeof window !== 'undefined' && window.location?.origin
          ? window.location.origin
          : 'http://localhost'
      const parsed = new URL(value, base)
      return (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        parsed.origin === new URL(base).origin
      )
    } catch {
      return false
    }
  }

  try {
    const parsed = new URL(value)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      Boolean(parsed.hostname) &&
      !parsed.username &&
      !parsed.password
    )
  } catch {
    return false
  }
}
