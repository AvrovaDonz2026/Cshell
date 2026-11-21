import { apiRequest } from './client'
import type {
  CheckoutInfo,
  Paginated,
  PaymentOrder,
  PaymentPlan,
  SubscriptionItem,
  SubscriptionSummary,
} from './types'

export function fetchSubscriptionSummary(): Promise<SubscriptionSummary> {
  return apiRequest<SubscriptionSummary>('/subscriptions/summary')
}

export function fetchSubscriptions(): Promise<SubscriptionItem[]> {
  return apiRequest<SubscriptionItem[]>('/subscriptions')
}

export function fetchCheckoutInfo(): Promise<CheckoutInfo> {
  return apiRequest<CheckoutInfo>('/payment/checkout-info')
}

export function fetchPaymentPlans(): Promise<PaymentPlan[]> {
  return apiRequest<PaymentPlan[]>('/payment/plans')
}

export function fetchMyOrders(
  page = 1,
  pageSize = 20,
): Promise<Paginated<PaymentOrder>> {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  })
  return apiRequest<Paginated<PaymentOrder>>(
    `/payment/orders/my?${query.toString()}`,
  )
}

export function createPaymentOrder(input: {
  amount: number
  payment_type: string
  order_type: string
  plan_id?: number
  return_url?: string
}): Promise<PaymentOrder> {
  return apiRequest<PaymentOrder>('/payment/orders', {
    method: 'POST',
    body: input,
  })
}
