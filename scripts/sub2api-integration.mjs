#!/usr/bin/env node
// Real-protocol compatibility checks through a running Cshell instance.
//
// Every request goes through Cshell's same-origin proxy to the real Sub2API
// backend provisioned by scripts/sub2api-ci-upstream.mjs. There are no mocks and
// no fabricated responses: when a contract cannot be satisfied the script exits
// non-zero instead of downgrading the assertion.
//
// Required env:
//   CSHELL_BASE_URL          origin of the Cshell process under test
//   SUB2API_TEST_EMAIL       regular (non-admin) test account email
//   SUB2API_TEST_PASSWORD    its password
// Optional env:
//   SUB2API_ADMIN_EMAIL / SUB2API_ADMIN_PASSWORD   used only to prove an admin can
//                                                  read /admin/users while a normal
//                                                  user cannot
//   CI_REGISTRATION_ENABLED  'true' (default) or 'false'; must match configure
//
// Secrets (passwords, tokens, API keys) never reach stdout/stderr.

const base = (process.env.CSHELL_BASE_URL || 'http://127.0.0.1:18080').replace(/\/+$/, '');
const userEmail = process.env.SUB2API_TEST_EMAIL;
const userPassword = process.env.SUB2API_TEST_PASSWORD;
if (!userEmail || !userPassword) throw new Error('SUB2API_TEST_EMAIL and SUB2API_TEST_PASSWORD are required');
const adminEmail = process.env.SUB2API_ADMIN_EMAIL || '';
const adminPassword = process.env.SUB2API_ADMIN_PASSWORD || '';
const registrationEnabled = String(process.env.CI_REGISTRATION_ENABLED ?? 'true').toLowerCase() !== 'false';
const timeoutMs = Number(process.env.SUB2API_TEST_TIMEOUT_MS || 20_000);

const KNOWN_SECRETS = [userPassword, adminPassword, process.env.JWT_SECRET, process.env.SUB2API_ADMIN_PASSWORD].filter(
  value => typeof value === 'string' && value.length >= 4,
);

export function sanitize(value) {
  if (typeof value !== 'string') return value;
  let out = value;
  for (const secret of KNOWN_SECRETS) out = out.split(secret).join('[REDACTED]');
  return out
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/((?:password|passwd|secret|token|api[_-]?key))(\s*["']?\s*[:=]\s*["']?)([^\s"',}]+)/gi, '$1$2[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, 'sk-[REDACTED]')
    .replace(/\brt_[A-Za-z0-9]{12,}/g, 'rt_[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[JWT-REDACTED]');
}

function redactBody(body) {
  if (body === null || body === undefined) return body;
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return sanitize(text).slice(0, 400);
}

function log(message) {
  process.stderr.write(`[sub2api-integration] ${message}\n`);
}

const results = [];
function record(name, detail = {}) {
  results.push({ name, ok: true, ...detail });
}
function assert(condition, message, detail) {
  if (!condition) {
    const suffix = detail ? ` (observed: ${redactBody(detail)})` : '';
    throw new Error(`${message}${suffix}`);
  }
}

async function request(path, { method = 'GET', token, body, headers = {} } = {}) {
  const init = {
    method,
    headers: { accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (token) init.headers.authorization = `Bearer ${token}`;
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${base}${path}`, init);
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, ok: response.ok, body: parsed, text };
}

function data(result) {
  return result.body?.data ?? null;
}

function assertSuccess(result, label) {
  assert(result.ok, `${label} expected HTTP 2xx, got ${result.status}`, result.body);
  assert(result.body && typeof result.body === 'object', `${label} did not return a JSON envelope`, result.text);
  assert(result.body.code === 0, `${label} expected envelope code 0, got ${JSON.stringify(result.body.code)}`, result.body);
  return data(result);
}

// Strict failure assertion: a 4xx status AND a non-zero envelope code. A body that
// merely happens to be JSON, or a 200 carrying an error code, does not pass.
function assertRejected(result, label, expectedStatuses) {
  assert(
    result.status >= 400 && result.status < 500,
    `${label} expected a 4xx rejection, got HTTP ${result.status}`,
    result.body,
  );
  if (expectedStatuses) {
    assert(
      expectedStatuses.includes(result.status),
      `${label} expected HTTP ${expectedStatuses.join('/')}, got ${result.status}`,
      result.body,
    );
  }
  const code = result.body?.code;
  assert(
    code !== undefined && code !== null && code !== 0 && code !== '0',
    `${label} expected a non-zero envelope code, got ${JSON.stringify(code)}`,
    result.body,
  );
  return result.body;
}

function uniqueName(prefix) {
  const run = String(process.env.GITHUB_RUN_ID || 'local').replace(/[^0-9a-zA-Z]/g, '').slice(-12);
  const attempt = String(process.env.GITHUB_RUN_ATTEMPT || '1').replace(/[^0-9a-zA-Z]/g, '');
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${run}-${attempt}-${random}`;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

const startedAt = Date.now();
const version = {
  cshellBaseUrl: base,
  registrationEnabled,
  nodeVersion: process.version,
};

// ---------------------------------------------------------------------------
// 1. Unauthenticated access is refused on protected routes.
// ---------------------------------------------------------------------------
{
  const profile = await request('/api/v1/user/profile');
  assert(
    profile.status === 401 || profile.status === 403,
    `unauthenticated profile expected 401/403, got ${profile.status}`,
    profile.body,
  );
  const adminList = await request('/api/v1/admin/users');
  assert(
    adminList.status === 401 || adminList.status === 403,
    `unauthenticated admin users expected 401/403, got ${adminList.status}`,
    adminList.body,
  );
  record('unauthenticated-refused', { profileStatus: profile.status, adminStatus: adminList.status });
}

// ---------------------------------------------------------------------------
// 2. Admin login (optional) must succeed and may read the admin surface.
// ---------------------------------------------------------------------------
let adminToken;
if (adminEmail && adminPassword) {
  const adminLogin = await request('/api/v1/auth/login', {
    method: 'POST',
    body: { email: adminEmail, password: adminPassword },
  });
  const adminAuth = assertSuccess(adminLogin, 'admin login');
  assert(typeof adminAuth?.access_token === 'string', 'admin login did not return an access_token');
  adminToken = adminAuth.access_token;
  const adminUsers = await request('/api/v1/admin/users?page=1&page_size=5', { token: adminToken });
  const adminUsersData = assertSuccess(adminUsers, 'admin users list');
  assert(Array.isArray(adminUsersData?.items), 'admin users list did not return an items array');
  record('admin-login-and-list', { total: adminUsersData.total });
}

// ---------------------------------------------------------------------------
// 3. Normal user login envelope and profile identity.
// ---------------------------------------------------------------------------
const login = await request('/api/v1/auth/login', { method: 'POST', body: { email: userEmail, password: userPassword } });
const auth = assertSuccess(login, 'login');
assert(typeof auth?.access_token === 'string' && auth.access_token.length > 20, 'login did not return an access_token');
assert(typeof auth?.refresh_token === 'string' && auth.refresh_token.length > 10, 'login did not return a refresh_token');
assert(typeof auth?.expires_in === 'number', 'login did not return numeric expires_in');
assert(auth?.user?.email === userEmail, 'login user did not match the test account');
let token = auth.access_token;
record('login-envelope', { expiresIn: auth.expires_in });

{
  const profile = await request('/api/v1/user/profile', { token });
  const profileData = assertSuccess(profile, 'profile');
  assert(profileData?.email === userEmail, 'profile email did not match the test account');
  assert(profileData?.role !== 'admin', 'test account unexpectedly has the admin role; use a normal user for permission checks');
  assert(typeof profileData?.id === 'number', 'profile did not expose a numeric user id');
  record('profile-identity', { userId: profileData.id, role: profileData.role });
}

// ---------------------------------------------------------------------------
// 4. Refresh round trip yields usable new credentials.
// ---------------------------------------------------------------------------
{
  const refreshed = await request('/api/v1/auth/refresh', { method: 'POST', body: { refresh_token: auth.refresh_token } });
  const refreshedData = assertSuccess(refreshed, 'refresh');
  assert(typeof refreshedData?.access_token === 'string', 'refresh did not return a new access_token');
  assert(typeof refreshedData?.refresh_token === 'string', 'refresh did not return a rotated refresh_token');
  // The pinned backend may mint a byte-identical access token when login and refresh
  // land in the same second with the same session id, so identity of the string is not
  // part of the contract. What must hold is that the refreshed token authenticates.
  const afterRefresh = await request('/api/v1/user/profile', { token: refreshedData.access_token });
  const afterData = assertSuccess(afterRefresh, 'profile after refresh');
  assert(afterData?.email === userEmail, 'profile after refresh lost the account identity');
  assert(afterData?.id, 'profile after refresh lost the account id');
  token = refreshedData.access_token;
  record('refresh-round-trip');
}

// ---------------------------------------------------------------------------
// 5. Registration gate matches CI_REGISTRATION_ENABLED.
// ---------------------------------------------------------------------------
{
  const publicSettings = await request('/api/v1/settings/public');
  const publicData = assertSuccess(publicSettings, 'public settings');
  assert(
    publicData?.registration_enabled === registrationEnabled,
    `public registration_enabled is ${JSON.stringify(publicData?.registration_enabled)}, expected ${registrationEnabled}`,
    publicData,
  );

  const newEmail = `${uniqueName('cshell-ci-register')}@example.invalid`;
  const registration = await request('/api/v1/auth/register', {
    method: 'POST',
    body: { email: newEmail, password: `CshellCI-register-${Math.random().toString(36).slice(2, 10)}` },
  });
  if (registrationEnabled) {
    const registered = assertSuccess(registration, 'open registration');
    assert(registered?.user?.email === newEmail, 'registration did not return the new account');
    assert(typeof registered?.access_token === 'string', 'registration did not return an access token');
  } else {
    assertRejected(registration, 'closed registration', [403]);
  }
  record('registration-gate', { registrationEnabled });
}

// ---------------------------------------------------------------------------
// 6. A normal user is denied the admin surface.
// ---------------------------------------------------------------------------
{
  const denied = await request('/api/v1/admin/users', { token });
  assertRejected(denied, 'non-admin admin users', [403]);
  record('non-admin-denied', { status: denied.status, code: String(denied.body?.code) });
}

// ---------------------------------------------------------------------------
// 7. API key lifecycle.
// ---------------------------------------------------------------------------
const keyName = uniqueName('cshell-ci-key');
let keyId;
{
  const before = await request('/api/v1/keys?page=1&page_size=100', { token });
  const beforeData = assertSuccess(before, 'keys list before create');
  const baselineTotal = Number(beforeData?.total ?? 0);

  const created = await request('/api/v1/keys', {
    method: 'POST',
    token,
    body: { name: keyName, quota: 1.5, ip_whitelist: ['10.0.0.0/8', '192.168.0.0/16'] },
  });
  const createdData = assertSuccess(created, 'key create');
  assert(typeof createdData?.id === 'number', 'key create did not return a numeric id');
  assert(createdData?.name === keyName, 'key create did not preserve the requested name');
  assert(createdData?.status === 'active', 'new key is not active');
  assert(createdData?.quota === 1.5, 'key create did not persist the quota');
  assert(
    Array.isArray(createdData?.ip_whitelist) && createdData.ip_whitelist.includes('10.0.0.0/8'),
    'key create did not persist the CIDR whitelist',
  );
  assert(typeof createdData?.key === 'string' && createdData.key.length > 8, 'key create did not return a secret');
  keyId = createdData.id;
  record('key-create', { id: keyId });

  const listed = await request('/api/v1/keys?page=1&page_size=100', { token });
  const listedData = assertSuccess(listed, 'keys list after create');
  assert(Number(listedData?.total) === baselineTotal + 1, 'key list total did not increase by one');
  assert(Array.isArray(listedData?.items), 'key list did not return an items array');
  assert(listedData.items.some(item => item.id === keyId), 'created key missing from the list');
  record('key-list', { total: listedData.total });

  const fetched = await request(`/api/v1/keys/${keyId}`, { token });
  const fetchedData = assertSuccess(fetched, 'key get');
  assert(fetchedData?.id === keyId, 'key get returned a different key');
  assert(fetchedData?.name === keyName, 'key get returned a different name');
  record('key-get');

  const renamed = `${keyName}-renamed`;
  const updated = await request(`/api/v1/keys/${keyId}`, {
    method: 'PUT',
    token,
    body: { name: renamed, status: 'inactive' },
  });
  const updatedData = assertSuccess(updated, 'key update');
  assert(updatedData?.name === renamed, 'key update did not change the name');
  assert(updatedData?.status === 'inactive', 'key update did not change the status');
  record('key-update-name-status');

  const invalidQuota = await request(`/api/v1/keys/${keyId}`, {
    method: 'PUT',
    token,
    body: { quota: -1 },
  });
  assertRejected(invalidQuota, 'key update invalid quota', [400]);
  record('key-update-invalid-quota', { status: invalidQuota.status });

  const invalidCidr = await request('/api/v1/keys', {
    method: 'POST',
    token,
    body: { name: uniqueName('cshell-ci-badcidr'), ip_whitelist: ['not-a-cidr'] },
  });
  assertRejected(invalidCidr, 'key create invalid CIDR', [400]);
  record('key-create-invalid-cidr', { status: invalidCidr.status });

  const deleted = await request(`/api/v1/keys/${keyId}`, { method: 'DELETE', token });
  assertSuccess(deleted, 'key delete');

  const gone = await request(`/api/v1/keys/${keyId}`, { token });
  assertRejected(gone, 'key get after delete', [404]);
  record('key-delete');
}

// ---------------------------------------------------------------------------
// 8. Usage surfaces report empty state with dates and timezone echo.
// ---------------------------------------------------------------------------
{
  const stats = await request('/api/v1/usage/dashboard/stats', { token });
  const statsData = assertSuccess(stats, 'usage stats');
  assert(typeof statsData?.total_requests === 'number', 'usage stats did not return numeric total_requests');
  assert(statsData.total_requests === 0, `usage stats total_requests is ${statsData.total_requests}; no real model calls were made`);
  record('usage-stats-empty', { totalRequests: statsData.total_requests, totalApiKeys: statsData.total_api_keys });

  const day = todayUtc();
  const trend = await request(
    `/api/v1/usage/dashboard/trend?start_date=${day}&end_date=${day}&granularity=day&timezone=UTC`,
    { token },
  );
  const trendData = assertSuccess(trend, 'usage trend');
  assert(Array.isArray(trendData?.trend), 'usage trend did not return a trend array');
  assert(trendData.trend.length === 0, `usage trend is not empty (${trendData.trend.length} points); no real model calls were made`);
  assert(trendData.start_date === day, `usage trend start_date is ${trendData.start_date}, expected ${day}`);
  assert(trendData.end_date === day, `usage trend end_date is ${trendData.end_date}, expected ${day}`);
  assert(trendData.granularity === 'day', 'usage trend did not echo the day granularity');
  record('usage-trend-empty', { startDate: trendData.start_date, endDate: trendData.end_date });

  const logs = await request('/api/v1/usage?page=1&page_size=20', { token });
  const logsData = assertSuccess(logs, 'usage logs');
  assert(Array.isArray(logsData?.items), 'usage logs did not return an items array');
  assert(logsData.items.length === 0, 'usage logs are not empty; no real model calls were made');
  assert(Number(logsData.total) === 0, 'usage logs total is not zero');
  assert(Number(logsData.page) === 1, 'usage logs did not echo page 1');
  record('usage-logs-empty', { total: logsData.total });

  const summary = await request('/api/v1/subscriptions/summary', { token });
  const summaryData = assertSuccess(summary, 'subscriptions summary');
  assert(typeof summaryData?.active_count === 'number', 'subscriptions summary did not return numeric active_count');
  assert(Array.isArray(summaryData?.subscriptions), 'subscriptions summary did not return a subscriptions array');
  record('subscriptions-summary', { activeCount: summaryData.active_count });
}

// ---------------------------------------------------------------------------
// 9. Payment surfaces respond while disabled, and disabled checkout has no side effect.
// ---------------------------------------------------------------------------
{
  const config = await request('/api/v1/payment/config', { token });
  const configData = assertSuccess(config, 'payment config');
  assert(
    configData?.enabled === false,
    'payment is enabled; the CI configure step must disable it before these checks run',
    configData,
  );

  const checkout = await request('/api/v1/payment/checkout-info', { token });
  assertSuccess(checkout, 'payment checkout-info');

  const plans = await request('/api/v1/payment/plans', { token });
  const plansData = assertSuccess(plans, 'payment plans');
  assert(Array.isArray(plansData), 'payment plans did not return an array');

  const limits = await request('/api/v1/payment/limits', { token });
  const limitsData = assertSuccess(limits, 'payment limits');
  assert(limitsData && typeof limitsData === 'object', 'payment limits did not return an object');
  record('payment-surfaces', { enabled: configData.enabled, planCount: plansData.length });

  const ordersBefore = await request('/api/v1/payment/orders/my?page=1&page_size=50', { token });
  const ordersBeforeData = assertSuccess(ordersBefore, 'orders before create');
  const countBefore = Number(ordersBeforeData?.total ?? 0);

  const created = await request('/api/v1/payment/orders', {
    method: 'POST',
    token,
    body: { amount: 5, payment_type: 'alipay', order_type: 'balance' },
  });
  assertRejected(created, 'create order while payment disabled', [403]);
  assert(typeof created.body?.reason === 'string' || typeof created.body?.message === 'string',
    'disabled payment rejection did not explain itself');

  const ordersAfter = await request('/api/v1/payment/orders/my?page=1&page_size=50', { token });
  const ordersAfterData = assertSuccess(ordersAfter, 'orders after create');
  const countAfter = Number(ordersAfterData?.total ?? 0);
  assert(countAfter === countBefore, `rejected order changed the order count (${countBefore} -> ${countAfter})`);
  assert(Array.isArray(ordersAfterData?.items), 'orders list did not return an items array');
  assert(ordersAfterData.items.length === 0, 'orders list is not empty; payment is disabled and no order should exist');
  record('payment-order-rejected-no-side-effect', { count: countAfter, status: created.status });

  const unknownVerify = await request('/api/v1/payment/public/orders/verify', {
    method: 'POST',
    body: { out_trade_no: `CSHELLUNKNOWN${Date.now()}` },
  });
  assertRejected(unknownVerify, 'unknown order verify', [404]);
  record('payment-unknown-order-verify', { status: unknownVerify.status });
}

process.stdout.write(
  `${JSON.stringify(
    sanitize({
      base,
      version,
      registrationEnabled,
      checks: results,
      checkCount: results.length,
      timings: { totalMs: Date.now() - startedAt },
    }),
  )}\n`,
);
