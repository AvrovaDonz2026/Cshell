#!/usr/bin/env node
/**
 * Deterministic loopback mock for the independent web/ SPA.
 * Wire shapes follow docs/api-contracts.md. All success messages are LOCAL MOCK.
 * Binds 127.0.0.1 only (caller listens).
 */
import { createServer } from 'node:http'

export const user = {
  id: 4201,
  username: 'Donz · independent web researcher',
  email: 'cshell-web-fixture@example.invalid',
  role: 'user',
  status: 'active',
  balance: 64.25,
  concurrency: 4,
  created_at: '2024-02-29T23:59:59Z',
}

export const settings = {
  site_name: 'Cshell',
  site_logo: '/2shell.jpeg',
  registration_enabled: true,
  turnstile_enabled: true,
  captcha_provider: 'mock',
  email_verify_enabled: true,
  turnstile_site_key: '',
  registration_email_suffix_whitelist: [],
  run_mode: 'standard',
  payment_enabled: true,
  subscription_enabled: true,
  billing_currency: 'USD',
}


const long =
  'Independent web preview — multilingual 模型分析 and long content for wrapping. '

const group = {
  id: 7,
  name: 'Research · long-context models',
  platform: 'anthropic',
  status: 'active',
  subscription_type: 'standard',
  rate_multiplier: 1,
  description: long.repeat(3),
}

const plans = [
  {
    id: 11,
    group_id: 7,
    group_name: group.name,
    group_platform: 'anthropic',
    name: 'Research monthly · local mock',
    description: long.repeat(2),
    price: 20,
    original_price: 25,
    currency: 'USD',
    validity_days: 30,
    validity_unit: 'day',
    features: ['Long context research', 'Local fixture only — no charge'],
    for_sale: true,
    sort_order: 1,
    rate_multiplier: 1,
    daily_limit_usd: 5,
  },
]

const methods = {
  alipay: {
    currency: 'USD',
    display_name: 'LOCAL MOCK · no real payment',
    daily_limit: 1000,
    daily_used: 0,
    daily_remaining: 1000,
    single_min: 1,
    single_max: 1000,
    fee_rate: 0,
    available: true,
  },
  demo_unavailable: {
    currency: 'USD',
    display_name: 'LOCAL MOCK · unavailable method',
    daily_limit: 1000,
    daily_used: 0,
    daily_remaining: 1000,
    single_min: 1,
    single_max: 1000,
    fee_rate: 0,
    available: false,
  },
}

const checkout = {
  methods,
  plans,
  global_min: 1,
  global_max: 1000,
  balance_disabled: false,
  balance_recharge_multiplier: 1,
  subscription_usd_to_cny_rate: 0,
  recharge_fee_rate: 0,
  recharge_bonus_tiers: [],
  help_text: long.repeat(4),
  help_image_url: '',
  stripe_publishable_key: '',
}

const initialKeys = () =>
  [1, 2, 3].map((id) => ({
    id,
    user_id: user.id,
    name: id === 1 ? long.repeat(2) : `Research key ${id}`,
    key: `sk-local-mock-not-a-provider-key-${id}`,
    status: id === 3 ? 'inactive' : 'active',
    group_id: 7,
    group,
    quota: 100,
    quota_used: 12.5,
    created_at: '2024-02-29T23:59:59Z',
    updated_at: '2026-11-21T00:00:00Z',
    last_used_at: '2026-11-20T23:59:59Z',
    expires_at: '2027-01-01T00:00:00Z',
    ip_whitelist: [],
    ip_blacklist: [],
    current_concurrency: 0,
  }))

const paginate = (items, page = 1, pageSize = 20) => ({
  items,
  total: items.length,
  page,
  page_size: pageSize,
  pages: Math.max(1, Math.ceil(items.length / pageSize) || 1),
})

const MAX_KEY_QUOTA = 1_000_000
const MAX_IP_ENTRIES = 50

const isIPv4 = (value) => {
  const parts = String(value).split('.')
  if (parts.length !== 4) return false
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

const isIPv6 = (value) => {
  const text = String(value)
  if (!text || !text.includes(':')) return false
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':')
    if (lastColon < 0) return false
    if (!isIPv4(text.slice(lastColon + 1))) return false
    return isIPv6(`${text.slice(0, lastColon + 1)}0:0`)
  }
  const halves = text.split('::')
  if (halves.length > 2) return false
  const toGroups = (part) => (part === '' ? [] : part.split(':'))
  const left = toGroups(halves[0])
  const right = halves.length === 2 ? toGroups(halves[1]) : []
  const isHex = (group) => /^[0-9a-fA-F]{1,4}$/.test(group)
  if (!left.every(isHex) || !right.every(isHex)) return false
  if (halves.length === 1) return left.length === 8
  return left.length + right.length <= 7
}

const isIpOrCidr = (entry) => {
  const value = String(entry).trim()
  if (!value) return false
  const slash = value.indexOf('/')
  if (slash === -1) return isIPv4(value) || isIPv6(value)
  const address = value.slice(0, slash)
  const prefix = value.slice(slash + 1)
  if (!/^\d{1,3}$/.test(prefix)) return false
  const max = Number(prefix)
  if (isIPv4(address)) return max <= 32
  if (isIPv6(address)) return max <= 128
  return false
}

/**
 * Validate the mutating key fields shared by POST /keys and PUT /keys/:id.
 * Returns an error message string, or null when the input is acceptable.
 */
function validateKeyInput(input) {
  if (input.quota !== undefined) {
    const quota = Number(input.quota)
    if (!Number.isFinite(quota) || quota < 0 || quota > MAX_KEY_QUOTA) {
      return 'Invalid quota: must be a finite number between 0 and 1000000'
    }
  }

  if (input.expires_in_days !== undefined) {
    const days = Number(input.expires_in_days)
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      return 'Invalid expires_in_days: must be an integer between 1 and 3650'
    }
  }

  if (input.group_id !== undefined && input.group_id !== null) {
    const groupId = Number(input.group_id)
    if (!Number.isInteger(groupId) || groupId <= 0) {
      return 'Invalid group_id: must be a positive integer'
    }
  }

  for (const field of ['ip_whitelist', 'ip_blacklist']) {
    if (input[field] === undefined) continue
    if (!Array.isArray(input[field])) {
      return `Invalid ${field}: must be an array of IP addresses or CIDRs`
    }
    if (input[field].length > MAX_IP_ENTRIES) {
      return `Invalid ${field}: at most ${MAX_IP_ENTRIES} entries are allowed`
    }
    for (const entry of input[field]) {
      if (typeof entry !== 'string' || !isIpOrCidr(entry.trim())) {
        return `Invalid ${field}: "${String(entry)}" is not a valid IPv4/IPv6 address or CIDR`
      }
    }
  }

  return null
}

function trend(url) {
  const start = url.searchParams.get('start_date') || '2026-11-01'
  const end = url.searchParams.get('end_date') || '2026-11-21'
  const hourly = url.searchParams.get('granularity') === 'hour'
  const timezone = url.searchParams.get('timezone') || 'UTC'
  const rows = []
  for (
    let d = new Date(start), i = 0;
    d <= new Date(end) && i < 2200;
    d.setUTCDate(d.getUTCDate() + 1), i++
  ) {
    // Deliberately skip some days so missing ≠ explicit zero.
    if (i % 13 === 7) continue
    for (let h = 0; h < (hourly ? 24 : 1); h++) {
      const n = (i * 7 + h * 3) % 25
      rows.push({
        date:
          d.toISOString().slice(0, 10) +
          (hourly ? ` ${String(h).padStart(2, '0')}:00:00` : ''),
        requests: n,
        total_tokens: n * 500,
        input_tokens: n * 300,
        output_tokens: n * 200,
        cost: n * 0.03,
        actual_cost: n * 0.025,
      })
    }
  }
  return {
    trend: rows,
    models: [
      {
        model: 'claude-sonnet-4-6',
        requests: 42,
        total_tokens: 24000,
        input_tokens: 16000,
        output_tokens: 8000,
        cost: 1.25,
        actual_cost: 1.05,
      },
    ],
    groups: [],
    start_date: start,
    end_date: end,
    timezone,
    granularity: hourly ? 'hour' : 'day',
  }
}

function resolveUser(req) {
  const auth = req.headers.authorization || ''
  if (auth.includes('admin')) return { ...user, role: 'admin', username: 'admin-local' }
  return { ...user }
}

export function createCshellWebFixture() {
  let liveSettings = { ...settings }
  let mockOrders = []
  let paymentScenario = { result: 'redirect', status: 'completed' }
  let keys = initialKeys()
  let profile = { ...user }
  const unexpected = []
  const requests = []

  return createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const path = url.pathname.replace(/^\/api\/v1/, '')
    const method = req.method || 'GET'

    const send = (data, status = 200) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      })
      res.end(
        JSON.stringify(
          status < 400
            ? { code: 0, data, message: 'LOCAL MOCK' }
            : { code: status, message: typeof data === 'string' ? data : 'LOCAL MOCK error' },
        ),
      )
    }

    if (path === '/__cshell_web/health') return send({ fixture: true, mock: true })
    if (path === '/__cshell_web/report') return send({ unexpected, requests })
    if (path === '/__cshell_web/reset' && method === 'POST') {
      keys = initialKeys()
      profile = { ...user }
      liveSettings = { ...settings }
      mockOrders = []
      paymentScenario = { result: 'redirect', status: 'completed' }
      unexpected.length = 0
      requests.length = 0
      return send({ reset: true })
    }

    requests.push({ method, path, query: url.search })

    let body = ''
    for await (const chunk of req) body += chunk
    let input = {}
    try {
      input = JSON.parse(body || '{}')
    } catch {
      return send('Invalid JSON', 400)
    }

    if (path === '/__cshell_web/settings' && method === 'POST') {
      liveSettings = { ...liveSettings, ...input }
      return send(liveSettings)
    }

    if (path === '/__cshell_web/payment' && method === 'POST') {
      if (!['redirect', 'qr', 'qr_code', 'query', 'oauth_required', 'jsapi_ready'].includes(input.result) ||
          !['completed', 'pending', 'expired', 'failed', 'cancelled'].includes(input.status)) {
        return send('Invalid payment scenario', 400)
      }
      paymentScenario = { result: input.result, status: input.status }
      return send(paymentScenario)
    }

    if (path === '/__workspace/settings' && method === 'POST') {
      liveSettings = { ...liveSettings, ...input }
      return send(liveSettings)
    }

    if (method === 'GET' && path === '/settings/public') return send(liveSettings)

    if (method === 'POST' && path === '/auth/login') {
      if (liveSettings.turnstile_enabled && input.turnstile_token !== 'LOCAL-OK') return send('Invalid captcha token', 400)
      const roleUser =
        String(input.email || '').includes('admin')
          ? { ...user, role: 'admin', username: 'admin-local' }
          : { ...user }
      return send({
        access_token: roleUser.role === 'admin' ? 'local-mock-admin' : 'local-mock-user',
        refresh_token: 'local-mock-refresh',
        expires_in: 86400,
        user: roleUser,
      })
    }

    if (method === 'POST' && path === '/auth/register') {
      if (liveSettings.registration_enabled === false) {
        return send('Registration is disabled', 403)
      }
      if (liveSettings.turnstile_enabled && !liveSettings.email_verify_enabled) {
        if (liveSettings.captcha_provider === 'mock') {
          // Cshell-side mock marker: the fixture accepts the browser's local token.
          if (input.turnstile_token !== 'LOCAL-OK') {
            return send('Invalid captcha token', 400)
          }
        } else if (!input.turnstile_token) {
          return send('Captcha token required', 400)
        }
      }
      if (liveSettings.email_verify_enabled) {
        if (!input.verify_code) return send('Email verification code required', 400)
        if (input.verify_code !== '123456') return send('Invalid verification code', 400)
      }
      const whitelist = liveSettings.registration_email_suffix_whitelist || []
      if (Array.isArray(whitelist) && whitelist.length) {
        const email = String(input.email || '')
        const ok = whitelist.some((suffix) => email.endsWith(suffix))
        if (!ok) return send('Email domain not allowed', 400)
      }
      return send({
        access_token: 'local-mock-user',
        refresh_token: 'local-mock-refresh',
        expires_in: 86400,
        user: { ...user, email: input.email || user.email, username: input.username || user.username },
      })
    }

    if (method === 'POST' && path === '/auth/send-verify-code') {
      if (!input.email) return send('Email required', 400)
      if (liveSettings.turnstile_enabled && input.turnstile_token !== 'LOCAL-OK') return send('Invalid captcha token', 400)
      return send({ message: 'LOCAL MOCK verification code sent', countdown: 60 })
    }

    if (method === 'POST' && path === '/auth/refresh') {
      return send({
        access_token: 'local-mock-user',
        refresh_token: 'local-mock-refresh',
        expires_in: 86400,
        user: profile,
      })
    }

    if (method === 'POST' && path === '/auth/logout') return send({ ok: true })

    if (method === 'GET' && path === '/auth/me') return send(resolveUser(req))
    if (method === 'GET' && path === '/user/profile') return send(resolveUser(req).role === 'admin' ? resolveUser(req) : profile)

    if (method === 'PUT' && path === '/user') {
      profile = { ...profile, username: input.username || profile.username }
      return send(profile)
    }

    if (method === 'PUT' && path === '/user/password') return send({ ok: true })

    if (method === 'GET' && path === '/usage/dashboard/stats') {
      return send({
        total_api_keys: 3,
        active_api_keys: 2,
        total_requests: 420,
        total_tokens: 240000,
        total_input_tokens: 160000,
        total_output_tokens: 80000,
        total_cost: 12.5,
        total_actual_cost: 10.5,
        today_requests: 42,
        today_tokens: 24000,
        today_cost: 1.25,
        today_actual_cost: 1.05,
        average_duration_ms: 720,
        rpm: 2,
        tpm: 500,
      })
    }

    if (method === 'GET' && path === '/usage/dashboard/trend') return send(trend(url))

    if (method === 'GET' && path === '/usage') {
      const startDate = url.searchParams.get('start_date')
      const endDate = url.searchParams.get('end_date')
      const timezone = url.searchParams.get('timezone') || 'UTC'
      // Deliberate gaps: skip log ids 2 and 5 so missing ≠ zero/empty rows.
      const rows = [1, 2, 3, 4, 5, 6]
        .filter((id) => id !== 2 && id !== 5)
        .map((id) => ({
          id,
          api_key_id: 1,
          model: 'claude-sonnet-4-6',
          request_type: 'chat',
          input_tokens: 16000,
          output_tokens: 8000,
          total_cost: 1.25,
          actual_cost: 1.05,
          duration_ms: 720,
          created_at: `2026-11-${String(10 + id).padStart(2, '0')}T23:59:59Z`,
        }))
      const filtered = rows.filter((row) => {
        const day = row.created_at.slice(0, 10)
        if (startDate && day < startDate) return false
        if (endDate && day > endDate) return false
        return true
      })
      const page = Number(url.searchParams.get('page') || 1)
      const pageSize = Number(url.searchParams.get('page_size') || 20)
      return send({
        ...paginate(filtered, page, pageSize),
        start_date: startDate || null,
        end_date: endDate || null,
        timezone,
      })
    }

    if (method === 'POST' && path === '/keys') {
      const error = validateKeyInput(input)
      if (error) return send(error, 400)
      const expiresDays = Number(input.expires_in_days)
      const key = {
        ...initialKeys()[0],
        id: 100 + keys.length,
        name: input.name || 'unnamed',
        group_id: input.group_id ?? 7,
        group,
        key: 'sk-local-mock-created-not-valid',
        quota: input.quota ?? 100,
        quota_used: 0,
        ip_whitelist: Array.isArray(input.ip_whitelist) ? input.ip_whitelist : [],
        ip_blacklist: Array.isArray(input.ip_blacklist) ? input.ip_blacklist : [],
        expires_at:
          Number.isFinite(expiresDays) && expiresDays > 0
            ? new Date(Date.now() + expiresDays * 86400000).toISOString()
            : '2027-01-01T00:00:00Z',
      }
      keys.push(key)
      return send(key)
    }

    if (method === 'DELETE' && /^\/keys\/\d+$/.test(path)) {
      const id = Number(path.split('/')[2])
      keys = keys.filter((k) => k.id !== id)
      return send({ ok: true })
    }

    if (method === 'PUT' && /^\/keys\/\d+$/.test(path)) {
      const id = Number(path.split('/')[2])
      const idx = keys.findIndex((k) => k.id === id)
      if (idx < 0) return send('Key not found', 404)
      const error = validateKeyInput(input)
      if (error) return send(error, 400)
      const cur = keys[idx]
      const next = { ...cur, id }
      if (input.name !== undefined) next.name = input.name
      if (input.status !== undefined) next.status = input.status
      if (input.quota !== undefined) next.quota = input.quota
      if (input.group_id !== undefined) next.group_id = input.group_id
      if (input.ip_whitelist !== undefined) {
        next.ip_whitelist = Array.isArray(input.ip_whitelist) ? input.ip_whitelist : []
      }
      if (input.ip_blacklist !== undefined) {
        next.ip_blacklist = Array.isArray(input.ip_blacklist) ? input.ip_blacklist : []
      }
      next.updated_at = new Date().toISOString()
      keys[idx] = next
      return send(next)
    }

    if (method === 'GET' && path === '/keys') {
      const page = Number(url.searchParams.get('page') || 1)
      const pageSize = Number(url.searchParams.get('page_size') || 20)
      const status = url.searchParams.get('status')
      const search = url.searchParams.get('search')
      let filtered = [...keys]
      if (status) filtered = filtered.filter((k) => k.status === status)
      if (search) {
        const q = search.toLowerCase()
        filtered = filtered.filter((k) => String(k.name).toLowerCase().includes(q))
      }
      const start = Math.max(0, (page - 1) * pageSize)
      return send({
        items: filtered.slice(start, start + pageSize),
        total: filtered.length,
        page,
        page_size: pageSize,
        pages: Math.max(1, Math.ceil(filtered.length / pageSize) || 1),
      })
    }

    if (method === 'GET' && path === '/groups/available') return send([group])

    if (method === 'GET' && path === '/subscriptions/summary') {
      return send({ active_count: 0, subscriptions: [] })
    }

    if (method === 'GET' && path === '/subscriptions') return send([])

    if (method === 'GET' && path === '/payment/checkout-info') return send(checkout)
    if (method === 'GET' && path === '/payment/plans') return send(plans)
    if (method === 'GET' && path === '/payment/config') {
      return send({
        payment_enabled: true,
        min_amount: checkout.global_min,
        max_amount: checkout.global_max,
        enabled_payment_types: Object.keys(methods).filter(
          (key) => methods[key].available !== false,
        ),
        daily_limit: 1000,
        max_pending_orders: 3,
        order_timeout_minutes: 15,
        balance_disabled: checkout.balance_disabled,
        help_text: checkout.help_text,
        help_image_url: checkout.help_image_url,
        stripe_publishable_key: checkout.stripe_publishable_key,
      })
    }

    if (method === 'GET' && path === '/payment/orders/my') {
      const seed = {
        id: 1,
        user_id: user.id,
        amount: 20,
        pay_amount: 20,
        currency: 'USD',
        fee_rate: 0,
        payment_type: 'alipay',
        out_trade_no: 'LOCAL-MOCK-CSHELL-WEB-20260229',
        status: 'COMPLETED',
        order_type: 'balance',
        created_at: '2024-02-29T23:59:59Z',
        paid_at: '2024-03-01T00:00:01Z',
        expires_at: '2024-03-01T00:15:00Z',
        refund_amount: 0,
      }
      const status = url.searchParams.get('status')
      const all = [ ...mockOrders, seed ]
      const filtered = status
        ? all.filter((o) => String(o.status).toUpperCase() === status.toUpperCase())
        : all
      return send(paginate(filtered))
    }

    if (method === 'GET' && path === '/payment/limits') {
      return send({
        methods: Object.fromEntries(
          Object.entries(methods).map(([key, info]) => [
            key,
            {
              currency: info.currency,
              display_name: info.display_name,
              single_min: info.single_min,
              single_max: info.single_max,
              daily_limit: info.daily_limit,
              daily_used: info.daily_used,
              daily_remaining: info.daily_remaining,
              available: info.available,
            },
          ]),
        ),
        global_min: checkout.global_min,
        global_max: checkout.global_max,
        min_amount: checkout.global_min,
        max_amount: checkout.global_max,
      })
    }

    if (method === 'POST' && path === '/payment/orders') {
      const amount = Number(input.amount)
      if (amount === 0.01) {
        return send('Simulated checkout failure for amount 0.01', 409)
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return send('Invalid amount', 400)
      }
      const decimals = String(amount).split('.')[1] || ''
      if (decimals.length > 2) {
        return send('Amount may have at most 2 decimal places', 400)
      }

      const methodKey = String(input.payment_type || 'alipay')
      const methodInfo = methods[methodKey]
      if (!methodInfo) {
        return send(`Unknown payment method: ${methodKey}`, 400)
      }
      if (methodInfo.available === false) {
        return send(`Payment method unavailable: ${methodKey}`, 400)
      }
      const globalMin = Number(checkout.global_min)
      const globalMax = Number(checkout.global_max)
      if (Number.isFinite(globalMin) && amount < globalMin) {
        return send(`Amount is below the global minimum of ${globalMin}`, 400)
      }
      if (Number.isFinite(globalMax) && amount > globalMax) {
        return send(`Amount exceeds the global maximum of ${globalMax}`, 400)
      }
      if (typeof methodInfo.single_min === 'number' && amount < methodInfo.single_min) {
        return send(
          `Amount is below the minimum of ${methodInfo.single_min} for ${methodKey}`,
          400,
        )
      }
      if (typeof methodInfo.single_max === 'number' && amount > methodInfo.single_max) {
        return send(
          `Amount exceeds the maximum of ${methodInfo.single_max} for ${methodKey}`,
          400,
        )
      }
      if (
        typeof methodInfo.daily_remaining === 'number' &&
        methodInfo.daily_remaining > 0 &&
        amount > methodInfo.daily_remaining
      ) {
        return send(
          `Amount exceeds today's remaining limit of ${methodInfo.daily_remaining}`,
          400,
        )
      }

      const outTradeNo = 'LOCAL-MOCK-' + Date.now()
      const resume = 'resume-' + outTradeNo
      let origin = 'http://127.0.0.1:4284'
      if (typeof input.return_url === 'string') {
        try {
          const parsed = new URL(input.return_url)
          origin = parsed.origin
        } catch {
          // Keep the preview default when return_url is not absolute.
        }
      }

      if ('mock_result' in input) return send('Unknown payment field', 400)
      const requestedResult = paymentScenario.result
      const resultType = ['oauth_required', 'jsapi_ready'].includes(requestedResult) ? requestedResult : 'order_created'
      const payUrl =
        `${origin}/payment/result?out_trade_no=${encodeURIComponent(outTradeNo)}` +
        `&resume_token=${encodeURIComponent(resume)}`

      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
      const order = {
        id: 1000 + mockOrders.length,
        user_id: user.id,
        amount,
        pay_amount: amount,
        currency: methodInfo.currency || 'USD',
        fee_rate: 0,
        payment_type: methodKey,
        out_trade_no: outTradeNo,
        status: 'PENDING',
        order_type: input.order_type || 'subscription',
        plan_id: input.plan_id,
        created_at: new Date().toISOString(),
        expires_at: expiresAt,
        refund_amount: 0,
        resume_token: resume,
        paid: false,
      }
      mockOrders.unshift(order)

      const payload = {
        order_id: order.id,
        out_trade_no: outTradeNo,
        resume_token: resume,
        result_type: resultType,
        expires_at: expiresAt,
        status: 'PENDING',
        amount,
        pay_amount: amount,
        currency: order.currency,
        payment_type: order.payment_type,
        order_type: order.order_type,
      }

      // qr => raw payment content; qr_code => ready-to-render data URL.
      if (requestedResult === 'qr') {
        payload.qr_code = payUrl
        payload.pay_url = payUrl
      } else if (requestedResult === 'qr_code') {
        payload.qr_code =
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
        payload.pay_url = payUrl
      } else if (requestedResult === 'query' || resultType !== 'order_created') {
        // Query-only: caller must poll verify/resolve, no redirect target.
      } else {
        payload.pay_url = payUrl
      }

      return send(payload)
    }

    if (method === 'POST' && path === '/payment/public/orders/verify') {
      const outTradeNo = String(input.out_trade_no || '')
      const found = mockOrders.find((o) => o.out_trade_no === outTradeNo)
      if (!found) return send('Order not found', 404)

      const mockStatus = (url.searchParams.get('mock_status') || paymentScenario.status).toLowerCase()
      if (!['completed', 'pending', 'expired', 'failed', 'cancelled'].includes(mockStatus)) return send('Invalid mock status', 400)
      if (mockStatus === 'failed') {
        found.status = 'FAILED'
        found.paid = false
      } else if (mockStatus === 'expired') {
        found.status = 'EXPIRED'
        found.paid = false
      } else if (mockStatus === 'cancelled') {
        found.status = 'CANCELLED'
        found.paid = false
      } else if (mockStatus === 'pending') {
        // Leave the order untouched so the caller keeps polling.
      } else if (found.status === 'PENDING') {
        found.status = 'COMPLETED'
        found.paid = true
        found.paid_at = new Date().toISOString()
      }

      return send({
        out_trade_no: found.out_trade_no,
        status: found.status,
        paid: found.status === 'COMPLETED' && found.paid !== false,
        created_at: found.created_at,
        expires_at: found.expires_at,
      })
    }

    if (method === 'POST' && path === '/payment/public/orders/resolve') {
      const resume = String(input.resume_token || '')
      const found = mockOrders.find((o) => o.resume_token === resume)
      if (!found) return send('Order not found', 404)

      const mockStatus = (url.searchParams.get('mock_status') || paymentScenario.status).toLowerCase()
      if (!['completed', 'pending', 'expired', 'failed', 'cancelled'].includes(mockStatus)) return send('Invalid mock status', 400)
      if (mockStatus === 'failed') {
        found.status = 'FAILED'
        found.paid = false
      } else if (mockStatus === 'expired') {
        found.status = 'EXPIRED'
        found.paid = false
      } else if (mockStatus === 'cancelled') {
        found.status = 'CANCELLED'
        found.paid = false
      } else if (mockStatus === 'pending') {
        // Leave the order untouched so the caller keeps polling.
      } else if (found.status === 'PENDING') {
        found.status = 'COMPLETED'
        found.paid = true
        found.paid_at = new Date().toISOString()
      }

      return send({
        out_trade_no: found.out_trade_no,
        status: found.status,
        id: found.id,
        payment_type: found.payment_type,
        order_type: found.order_type,
        amount: found.amount,
        pay_amount: found.pay_amount,
        currency: found.currency,
        created_at: found.created_at,
        expires_at: found.expires_at,
      })
    }

    if (method === 'POST' && /^\/payment\/orders\/\d+\/cancel$/.test(path)) {
      const id = Number(path.split('/')[3])
      const found = mockOrders.find((o) => o.id === id)
      if (!found) return send('Order not found', 404)
      found.status = 'CANCELLED'
      found.paid = false
      return send({ ok: true, id, status: 'CANCELLED' })
    }

    if (method === 'GET' && /^\/payment\/orders\/\d+$/.test(path)) {
      const id = Number(path.split('/')[3])
      const found = mockOrders.find((o) => o.id === id)
      if (!found) return send('Order not found', 404)
      return send(found)
    }

    unexpected.push({ method, path, query: url.search })
    console.error('UNHANDLED CSHELL WEB FIXTURE', method, path)
    return send(`Unhandled local fixture endpoint: ${method} ${path}`, 501)
  })
}
