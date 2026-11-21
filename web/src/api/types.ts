/** Shared API shapes derived from docs/api-contracts.md and local fixture scripts. */

export interface ApiEnvelope<T> {
  code: number
  message: string
  data: T
}

export interface User {
  id: number
  username?: string
  email: string
  role: string
  status?: string
  balance?: number
  concurrency?: number
  created_at?: string
}

export interface AuthPayload {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type?: string
  user: User
}

export interface PublicSettings {
  site_name?: string
  site_logo?: string
  registration_enabled?: boolean
  payment_enabled?: boolean
  subscription_enabled?: boolean
  billing_currency?: string
  run_mode?: string
  [key: string]: unknown
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  pages: number
}

export interface DashboardStats {
  total_api_keys?: number
  active_api_keys?: number
  total_requests?: number
  total_tokens?: number
  total_input_tokens?: number
  total_output_tokens?: number
  total_cost?: number
  total_actual_cost?: number
  today_requests?: number
  today_tokens?: number
  today_cost?: number
  today_actual_cost?: number
  average_duration_ms?: number
  rpm?: number
  tpm?: number
}

export interface TrendPoint {
  date: string
  requests: number
  total_tokens?: number
  input_tokens?: number
  output_tokens?: number
  cost?: number
  actual_cost?: number
}

export interface TrendResponse {
  trend: TrendPoint[]
  models?: unknown[]
  groups?: unknown[]
  start_date: string
  end_date: string
  granularity: 'day' | 'hour'
}

export interface ApiGroup {
  id: number
  name: string
  platform?: string
  status?: string
  description?: string
  rate_multiplier?: number
  subscription_type?: string
}

export interface ApiKey {
  id: number
  user_id?: number
  name: string
  key?: string
  status?: string
  group_id?: number | null
  group?: ApiGroup | null
  quota?: number
  quota_used?: number
  created_at?: string
  updated_at?: string
  last_used_at?: string
  expires_at?: string
  ip_whitelist?: string[]
  ip_blacklist?: string[]
  current_concurrency?: number
}

export interface SubscriptionSummary {
  active_count: number
  subscriptions: SubscriptionItem[]
}

export interface SubscriptionItem {
  id?: number
  name?: string
  status?: string
  plan_name?: string
  expires_at?: string
  [key: string]: unknown
}

export interface PaymentPlan {
  id: number
  group_id?: number
  group_name?: string
  group_platform?: string
  name: string
  description?: string
  price: number
  original_price?: number
  currency?: string
  validity_days?: number
  validity_unit?: string
  features?: string[]
  for_sale?: boolean
  sort_order?: number
  rate_multiplier?: number
  daily_limit_usd?: number
}

export interface PaymentMethodInfo {
  currency?: string
  display_name?: string
  daily_limit?: number
  daily_used?: number
  daily_remaining?: number
  single_min?: number
  single_max?: number
  fee_rate?: number
  available?: boolean
}

export interface CheckoutInfo {
  methods?: Record<string, PaymentMethodInfo>
  plans?: PaymentPlan[]
  global_min?: number
  global_max?: number
  balance_disabled?: boolean
  help_text?: string
  help_image_url?: string
  stripe_publishable_key?: string
  [key: string]: unknown
}

export interface PaymentOrder {
  id: number
  user_id?: number
  amount: number
  pay_amount?: number
  fee_rate?: number
  payment_type?: string
  out_trade_no?: string
  status?: string
  order_type?: string
  created_at?: string
  paid_at?: string
  expires_at?: string
  refund_amount?: number
  plan_id?: number
}

export class ApiError extends Error {
  readonly code: number
  readonly status: number

  constructor(message: string, code: number, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}
