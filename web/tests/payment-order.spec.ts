import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPaymentOrder,
  isSafeRedirectUrl,
  resolvePublicOrder,
  verifyPublicOrder,
} from '@/api/billing'
import { ApiError } from '@/api/types'
import { normalizeOrderStatus } from '@/lib/payment'

function envelope(data: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ code: 0, message: 'LOCAL MOCK', data }),
  }
}

function errorEnvelope(status: number, message: string) {
  return {
    ok: false,
    status,
    statusText: message,
    text: async () => JSON.stringify({ code: status, message }),
  }
}

describe('payment order creation payload', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('sends amount, method, plan, return_url and web payment_source', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body || '{}')) })
        return envelope({
          order_id: 1000,
          out_trade_no: 'LOCAL-MOCK-1',
          pay_url: 'http://127.0.0.1:4284/payment/result?out_trade_no=LOCAL-MOCK-1',
          resume_token: 'resume-LOCAL-MOCK-1',
          result_type: 'order_created',
          status: 'PENDING',
          amount: 20,
          payment_type: 'alipay',
          order_type: 'subscription',
        })
      }),
    )

    const result = await createPaymentOrder({
      amount: 20,
      payment_type: 'alipay',
      order_type: 'subscription',
      plan_id: 11,
      return_url: 'http://127.0.0.1:4284/payment/result',
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toContain('/api/v1/payment/orders')
    expect(calls[0]!.body).toMatchObject({
      amount: 20,
      payment_type: 'alipay',
      order_type: 'subscription',
      plan_id: 11,
      return_url: 'http://127.0.0.1:4284/payment/result',
      payment_source: 'web',
    })
    expect(result.pay_url).toContain('/payment/result')
    expect(result.resume_token).toBe('resume-LOCAL-MOCK-1')
  })

  it('passes an AbortSignal through to fetch', async () => {
    const controller = new AbortController()
    let received: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        received = init?.signal as AbortSignal | undefined
        return envelope({ order_id: 1, out_trade_no: 'x', resume_token: 'r', expires_at: '', status: 'PENDING', amount: 5, payment_type: 'alipay', order_type: 'balance' })
      }),
    )

    await createPaymentOrder(
      { amount: 5, payment_type: 'alipay', order_type: 'balance' },
      { signal: controller.signal },
    )
    expect(received).toBe(controller.signal)
  })

  it('verifies and resolves public order status', async () => {
    const paths: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        paths.push(String(url))
        return envelope({
          out_trade_no: 'LOCAL-MOCK-1',
          status: 'COMPLETED',
          ...(String(url).includes('/resolve') ? { id: 1 } : { paid: true }),
        })
      }),
    )

    const verified = await verifyPublicOrder({ out_trade_no: 'LOCAL-MOCK-1' })
    const resolved = await resolvePublicOrder({ resume_token: 'resume-LOCAL-MOCK-1' })

    expect(paths[0]).toContain('/api/v1/payment/public/orders/verify')
    expect(paths[1]).toContain('/api/v1/payment/public/orders/resolve')
    expect(verified.paid).toBe(true)
    expect(resolved.paid).toBeUndefined()
    expect(resolved.status).toBe('COMPLETED')
  })

  it('surfaces a 404 not-found error so callers can fall back to resolve', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => errorEnvelope(404, 'Order not found')),
    )
    await expect(verifyPublicOrder({ out_trade_no: 'missing' })).rejects.toMatchObject({
      message: 'Order not found',
      status: 404,
    })
    await expect(
      verifyPublicOrder({ out_trade_no: 'missing' }),
    ).rejects.toBeInstanceOf(ApiError)
  })
})

describe('safe redirect validation', () => {
  it('accepts absolute http(s) URLs', () => {
    expect(isSafeRedirectUrl('https://pay.example.com/checkout')).toBe(true)
    expect(isSafeRedirectUrl('http://127.0.0.1:4284/payment/result')).toBe(true)
  })

  it('accepts same-origin relative paths', () => {
    expect(isSafeRedirectUrl('/payment/result?out_trade_no=1')).toBe(true)
    expect(isSafeRedirectUrl('/')).toBe(true)
  })

  it('rejects javascript:, data: and other schemes', () => {
    expect(isSafeRedirectUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeRedirectUrl('JavaScript:alert(1)')).toBe(false)
    expect(isSafeRedirectUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false)
    expect(isSafeRedirectUrl('ftp://example.com/file')).toBe(false)
  })

  it('rejects protocol-relative and backslash host tricks', () => {
    expect(isSafeRedirectUrl('//evil.com/path')).toBe(false)
    expect(isSafeRedirectUrl('/\\evil.com')).toBe(false)
    expect(isSafeRedirectUrl('\\\\evil.com')).toBe(false)
  })

  it('rejects malformed, empty and non-string values', () => {
    expect(isSafeRedirectUrl('')).toBe(false)
    expect(isSafeRedirectUrl('   ')).toBe(false)
    expect(isSafeRedirectUrl('not a url')).toBe(false)
    expect(isSafeRedirectUrl(undefined)).toBe(false)
    expect(isSafeRedirectUrl(null)).toBe(false)
  })

  it('rejects URLs carrying embedded credentials', () => {
    expect(isSafeRedirectUrl('https://user:pass@example.com/')).toBe(false)
  })
})


describe('pinned order shapes', () => {
  it('normalizes resolve status without a paid boolean', () => {
    expect(normalizeOrderStatus('COMPLETED')).toBe('paid')
    expect(normalizeOrderStatus('PAID')).toBe('paid')
    expect(normalizeOrderStatus('RECHARGING')).toBe('pending')
    for (const status of ['REFUND_REQUESTED', 'REFUNDING', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED', 'REFUND_FAILED']) {
      expect(normalizeOrderStatus(status)).toBe('refunded')
      expect(normalizeOrderStatus(status, true)).toBe('refunded')
    }
    expect(normalizeOrderStatus('UNRECOGNIZED')).toBe('unknown')
  })

  it('accepts order_created without optional trade, resume or order type fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => envelope({ order_id: 9, amount: 10, pay_amount: 11, fee_rate: 10, bonus_amount: 0, status: 'PENDING', payment_type: 'alipay', expires_at: '2027-01-01T00:00:00Z', result_type: 'order_created', qr_code: 'payment-content' })))
    const result = await createPaymentOrder({ amount: 10, payment_type: 'alipay', order_type: 'balance' })
    expect(result.pay_amount).toBe(11)
    expect(result.out_trade_no).toBeUndefined()
    expect(result.resume_token).toBeUndefined()
    expect(result.result_type).toBe('order_created')
  })
})
