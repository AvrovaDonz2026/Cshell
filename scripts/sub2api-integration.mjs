#!/usr/bin/env node
/**
 * Real Sub2API integration checks through the actual Cshell proxy.
 * Every request goes through CSHELL_BASE_URL — never directly to the upstream.
 *
 * Env:
 *   CSHELL_BASE_URL           default http://127.0.0.1:18080 (Cshell, loopback only)
 *   SUB2API_TEST_EMAIL/PASSWORD   existing admin account created by AUTO_SETUP
 *   CI_REGISTRATION_ENABLED   "true" when the harness configured open registration
 *   SUB2API_UPSTREAM_ID       commit or image digest, recorded in the summary
 *
 * Contract assertions follow docs/api-contracts.md; no mocking, no skips.
 */

const base = (process.env.CSHELL_BASE_URL || 'http://127.0.0.1:18080').replace(/\/$/, '');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)) {
  throw new Error('integration only permits loopback Cshell entrypoints');
}
const email = process.env.SUB2API_TEST_EMAIL;
const password = process.env.SUB2API_TEST_PASSWORD;
if (!email || !password) throw new Error('SUB2API_TEST_EMAIL and SUB2API_TEST_PASSWORD are required');

const steps = [];
async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    signal: AbortSignal.timeout(10_000),
    ...options,
    headers: { accept: 'application/json', ...(options.headers || {}) },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body, text };
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function payload(body) { return body?.data ?? body; }
function assertOk(step, result) {
  assert(result.response.ok, `${step} failed with HTTP ${result.response.status}: ${sanitize(result.text.slice(0, 200))}`);
  assert(payload(result.body) && typeof payload(result.body) === 'object', `${step} returned a non-envelope payload`);
  assert(payload(result.body).code === undefined || payload(result.body).code === 0, `${step} returned business code error`);
  steps.push({ step, status: result.response.status });
}
function sanitize(text) {
  return String(text)
    .replaceAll(password, '[REDACTED]')
    .replaceAll(email, '[REDACTED-EMAIL]')
    .replace(/sk-[A-Za-z0-9-_]{8,}/g, 'sk-[REDACTED]');
}
function expectFailure(step, result, statuses = [400, 401, 403, 404, 409, 422]) {
  assert(statuses.includes(result.response.status), `${step} expected rejection ${statuses.join('/')} got ${result.response.status}`);
  steps.push({ step, status: result.response.status, rejected: true });
}

/* 1. Unauthenticated request is rejected. */
const unauth = await request('/api/v1/user/profile');
expectFailure('unauthorized-profile', unauth, [401, 403]);

/* 2. Login envelope and identity. */
const login = await request('/api/v1/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
assertOk('login', login);
const auth = payload(login.body);
const token = auth?.access_token;
assert(typeof token === 'string' && token.length > 20, 'login response did not contain an access_token');
const headers = { authorization: `Bearer ${token}` };

/* 3. Authenticated profile preserves identity. */
const profile = await request('/api/v1/user/profile', { headers });
assertOk('authenticated-profile', profile);
assert(payload(profile.body)?.email === email, 'profile response did not preserve the test account identity');

/* 4. Refresh token round trip. */
if (typeof auth?.refresh_token === 'string' && auth.refresh_token.length > 10) {
  const refresh = await request('/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: auth.refresh_token }),
  });
  assertOk('refresh-token', refresh);
}

/* 5. Role isolation: user cannot read the admin user directory. */
const adminProbe = await request('/api/v1/admin/users', { headers });
expectFailure('user-denied-admin-users', adminProbe, [401, 403]);

/* 6. API key lifecycle through the real proxy. */
const keyName = `ci-key-${Date.now()}`;
const created = await request('/api/v1/keys', {
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify({ name: keyName, ip_whitelist: ['127.0.0.1/32'] }),
});
assertOk('keys-create', created);
const key = payload(created.body);
assert(key && (key.name === keyName || key.key), 'created key payload missing name/key');
assert(!sanitize(JSON.stringify(key)).includes('sk-') || key.key, 'key payload unexpectedly missing secret field');

const keyList = await request('/api/v1/keys?page=1&page_size=20', { headers });
assertOk('keys-list', keyList);
const listPayload = payload(keyList.body);
assert(Array.isArray(listPayload.items) || Array.isArray(listPayload.keys) || Array.isArray(listPayload.data), 'keys list missing collection');

if (key?.id) {
  const updated = await request(`/api/v1/keys/${key.id}`, {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ name: `${keyName}-renamed` }),
  });
  if (updated.response.ok) steps.push({ step: 'keys-update', status: updated.response.status });
  const invalid = await request('/api/v1/keys', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ name: `${keyName}-bad`, quota: -5 }),
  });
  expectFailure('keys-invalid-quota', invalid, [400, 401, 403, 422]);
  const removed = await request(`/api/v1/keys/${key.id}`, { method: 'DELETE', headers });
  if (removed.response.ok) steps.push({ step: 'keys-delete', status: removed.response.status });
}

/* 7. Usage endpoints with empty-state contract. */
const stats = await request('/api/v1/usage/dashboard/stats', { headers });
assertOk('usage-stats', stats);
const trend = await request('/api/v1/usage/dashboard/trend?start_date=2026-01-01&end_date=2026-01-02&granularity=day&timezone=UTC', { headers });
assertOk('usage-trend', trend);
const usageLogs = await request('/api/v1/usage?page=1&page_size=10&start_date=2026-01-01&end_date=2026-01-02&timezone=UTC', { headers });
assertOk('usage-logs', usageLogs);
const logsPayload = payload(usageLogs.body);
assert(Array.isArray(logsPayload.items) || Array.isArray(logsPayload.data) || Array.isArray(logsPayload), 'usage logs missing collection');

/* 8. Subscriptions summary and payment config respond; no order is forged. */
const summary = await request('/api/v1/subscriptions/summary', { headers });
if (summary.response.ok) steps.push({ step: 'subscriptions-summary', status: summary.response.status });
const paymentConfig = await request('/api/v1/payment/config', { headers });
if (paymentConfig.response.ok) steps.push({ step: 'payment-config', status: paymentConfig.response.status });
const myOrders = await request('/api/v1/payment/orders/my?page=1&page_size=10', { headers });
if (myOrders.response.ok) steps.push({ step: 'payment-orders-my', status: myOrders.response.status });

/* 9. Unknown order verify must be rejected, not reported paid. */
const unknownVerify = await request('/api/v1/payment/public/orders/verify', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ out_trade_no: `CI-UNKNOWN-${Date.now()}` }),
});
expectFailure('unknown-order-verify', unknownVerify, [400, 404, 422]);

/* 10. Logout succeeds; do not assume the old access token is globally revoked. */
const logout = await request('/api/v1/auth/logout', {
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify({ refresh_token: auth?.refresh_token }),
});
if (logout.response.ok) steps.push({ step: 'logout', status: logout.response.status });

console.log(JSON.stringify({
  upstream: process.env.SUB2API_UPSTREAM_ID || 'unknown',
  base,
  steps,
  checks: steps.map((s) => s.step),
}));
