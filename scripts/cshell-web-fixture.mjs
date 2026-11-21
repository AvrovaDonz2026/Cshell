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

function trend(url) {
  const start = url.searchParams.get('start_date') || '2026-11-01'
  const end = url.searchParams.get('end_date') || '2026-11-21'
  const hourly = url.searchParams.get('granularity') === 'hour'
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
    granularity: hourly ? 'hour' : 'day',
  }
}

function resolveUser(req) {
  const auth = req.headers.authorization || ''
  if (auth.includes('admin')) return { ...user, role: 'admin', username: 'admin-local' }
  return { ...user }
}

export function createCshellWebFixture() {
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

    if (method === 'GET' && path === '/settings/public') return send(settings)

    if (method === 'POST' && path === '/auth/login') {
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
      return send({
        access_token: 'local-mock-user',
        refresh_token: 'local-mock-refresh',
        expires_in: 86400,
        user: { ...user, email: input.email || user.email, username: input.username || user.username },
      })
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
      return send(
        paginate(
          [1, 2, 3].map((id) => ({
            id,
            api_key_id: 1,
            model: 'claude-sonnet-4-6',
            request_type: 'chat',
            input_tokens: 16000,
            output_tokens: 8000,
            total_cost: 1.25,
            actual_cost: 1.05,
            duration_ms: 720,
            created_at: '2026-11-20T23:59:59Z',
          })),
        ),
      )
    }

    if (method === 'POST' && path === '/keys') {
      const key = {
        ...initialKeys()[0],
        id: 100 + keys.length,
        name: input.name || 'unnamed',
        group_id: input.group_id ?? 7,
        group,
        key: 'sk-local-mock-created-not-valid',
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
      keys[idx] = { ...keys[idx], ...input, id }
      return send(keys[idx])
    }

    if (method === 'GET' && path === '/keys') return send(paginate(keys))

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
        min_amount: 1,
        max_amount: 1000,
        enabled_payment_types: ['alipay'],
        help_text: checkout.help_text,
      })
    }

    if (method === 'GET' && path === '/payment/orders/my') {
      return send(
        paginate([
          {
            id: 1,
            user_id: user.id,
            amount: 20,
            pay_amount: 20,
            fee_rate: 0,
            payment_type: 'alipay',
            out_trade_no: 'LOCAL-MOCK-CSHELL-WEB-20260229',
            status: 'COMPLETED',
            order_type: 'balance',
            created_at: '2024-02-29T23:59:59Z',
            paid_at: '2024-03-01T00:00:01Z',
            expires_at: '2024-03-01T00:15:00Z',
            refund_amount: 0,
          },
        ]),
      )
    }

    if (method === 'POST' && path === '/payment/orders') {
      return send('Real checkout is intentionally disabled in local preview', 409)
    }

    unexpected.push({ method, path, query: url.search })
    console.error('UNHANDLED CSHELL WEB FIXTURE', method, path)
    return send(`Unhandled local fixture endpoint: ${method} ${path}`, 501)
  })
}
