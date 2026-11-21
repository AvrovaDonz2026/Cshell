#!/usr/bin/env node

const base = (process.env.CSHELL_BASE_URL || 'http://127.0.0.1:18080').replace(/\/$/, '');
const email = process.env.SUB2API_TEST_EMAIL;
const password = process.env.SUB2API_TEST_PASSWORD;
if (!email || !password) throw new Error('SUB2API_TEST_EMAIL and SUB2API_TEST_PASSWORD are required');

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

const unauth = await request('/api/v1/user/profile');
assert(unauth.response.status === 401 || unauth.response.status === 403,
  `unauthorized profile expected 401/403, got ${unauth.response.status}`);

const login = await request('/api/v1/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
assert(login.response.ok, `login failed with HTTP ${login.response.status}: ${login.text.slice(0, 300)}`);
const auth = payload(login.body);
const token = auth?.access_token;
assert(typeof token === 'string' && token.length > 20, 'login response did not contain an access_token');

const headers = { authorization: `Bearer ${token}` };
const profile = await request('/api/v1/user/profile', { headers });
assert(profile.response.ok, `authenticated profile failed with HTTP ${profile.response.status}`);
assert(payload(profile.body)?.email === email, 'profile response did not preserve the test account identity');

const keys = await request('/api/v1/keys', { headers });
assert(keys.response.ok, `authenticated keys failed with HTTP ${keys.response.status}`);
const keysPayload = payload(keys.body);
assert(keysPayload && typeof keysPayload === 'object' && !Array.isArray(keysPayload), 'keys response was not a successful data envelope');
assert(Array.isArray(keysPayload.items) || Array.isArray(keysPayload.keys) || Array.isArray(keysPayload.data), 'keys response did not contain a key collection');

console.log(JSON.stringify({
  upstream: process.env.SUB2API_UPSTREAM_COMMIT || 'unknown',
  base,
  checks: ['unauthorized-profile', 'login', 'authenticated-profile', 'authenticated-keys'],
  statuses: { unauthorizedProfile: unauth.response.status, login: login.response.status, profile: profile.response.status, keys: keys.response.status },
}));
