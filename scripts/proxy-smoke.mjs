// Loopback-only Cshell HTTP smoke test. No provider credentials or live calls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
function option(name, fallback) {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
}
const binary = resolve(option('--binary', 'target/debug/cshell'));
const staticDirArg = option('--static-dir', 'web/dist');
const staticDir = resolve(staticDirArg);
const temp = await mkdtemp(join(tmpdir(), 'cshell-smoke-'));
const fixtureDir = join(temp, 'web');
await mkdir(fixtureDir);
await writeFile(join(fixtureDir, 'index.html'), '<!doctype html><html><head><title>smoke-spa</title></head><body>cshell-spa</body></html>');
await writeFile(join(fixtureDir, 'assets.js'), 'window.fixture = true;');

let expectation;
const mockServer = createServer(async (req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
    return;
  }
  try {
    const expected = expectation;
    expectation = undefined;
    assert.ok(expected, `unexpected upstream request: ${req.method} ${req.url}`);
    assert.equal(req.method, expected.method);
    assert.equal(req.url, expected.path);
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    assert.deepEqual(raw, expected.body ?? Buffer.alloc(0));
    for (const [name, value] of Object.entries(expected.headers ?? {})) assert.equal(req.headers[name], value, name);
    expected.check?.(req, raw);
    const responseBody = typeof expected.response === 'string' || Buffer.isBuffer(expected.response)
      ? expected.response
      : JSON.stringify(expected.response);
    res.writeHead(expected.status ?? 200, expected.headersOut ?? {});
    res.end(responseBody ?? '');
  } catch (e) {
    failures.push(e);
    res.writeHead(500).end('fixture assertion failed');
  }
});
const failures = [];
mockServer.listen(0, '127.0.0.1');
await once(mockServer, 'listening');
const upstream = `http://127.0.0.1:${mockServer.address().port}`;

const cshellServer = createServer();
const listen = cshellServer.listen(0, '127.0.0.1');
await once(listen, 'listening');
const cshellPort = listen.address().port;
cshellServer.close();

const child = spawn(binary, [], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, SUB2API_UPSTREAM: upstream, CSHELL_LISTEN: `127.0.0.1:${cshellPort}`, CSHELL_STATIC_DIR: fixtureDir },
});
let logs = '';
child.stdout.on('data', (b) => { logs += b; });
child.stderr.on('data', (b) => { logs += b; });
const base = `http://127.0.0.1:${cshellPort}`;
async function ready() {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Cshell exited (${child.exitCode}): ${logs}`);
    try { const r = await fetch(`${base}/_cshell/health`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Cshell did not become ready: ${logs}`);
}
function expect(method, path, response, { body, headers = {}, headersOut = {}, check, status } = {}) {
  assert.equal(expectation, undefined, 'previous fixture expectation was not consumed');
  expectation = { method, path, response, body, headers, headersOut, check, status };
}
async function call(path, options = {}) {
  const request = { ...options };
  if (request.method === 'GET' || request.method === 'HEAD') delete request.body;
  return fetch(`${base}${path}`, request);
}
async function forwarded(name, path, method, requestOptions, response, expected = {}) {
  expect(method, path, response, expected);
  const res = await call(path, { method, ...requestOptions });
  assert.equal(res.status, expected.responseStatus ?? 200, name);
  const text = await res.text();
  if (expected.responseExact !== undefined) assert.equal(text, expected.responseExact, name);
  else assert.deepEqual(JSON.parse(text), response, name);
  assert.equal(expectation, undefined, `${name}: request did not reach mock`);
  process.stdout.write(`PASS ${name}\n`);
  return res;
}

const successes = [];
try {
  await ready();
  const health = await call('/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  successes.push('health');
  process.stdout.write('PASS health\n');

  expect('GET', '/admin/dashboard', '<!doctype html><html><body>upstream-admin</body></html>', { headersOut: { 'content-type': 'text/html' } });
  const html = await call('/admin/dashboard');
  assert.equal(html.status, 200);
  assert.match(await html.text(), /upstream-admin/);
  assert.equal(expectation, undefined);
  process.stdout.write('PASS admin HTML same-origin upstream routing\n');
  expect('GET', '/admin/assets.js', 'window.adminFixture = true;', { headersOut: { 'content-type': 'application/javascript' } });
  const asset = await call('/admin/assets.js');
  assert.equal(asset.status, 200);
  assert.match(await asset.text(), /adminFixture/);
  assert.equal(expectation, undefined);
  process.stdout.write('PASS admin resource same-origin upstream routing\n');

  const reg = JSON.stringify({ email: 'mock@example.test', password: 'not-a-real-secret', username: 'mock' });
  const auth = { code: 0, message: 'success', data: { access_token: 'access-mock', refresh_token: 'refresh-mock', expires_in: 3600, token_type: 'Bearer', user: { id: 7, email: 'mock@example.test' } } };
  await forwarded('register and clean forwarding headers', '/api/v1/auth/register', 'POST', { headers: {
    'content-type': 'application/json',
    'x-forwarded-for': 'spoofed-client',
    'x-forwarded-proto': 'http',
    'x-forwarded-host': 'spoofed.example',
    'x-forwarded-port': '9',
  }, body: reg }, auth, {
    body: Buffer.from(reg), headers: { 'content-type': 'application/json' },
    check: (req) => {
      assert.match(req.headers['x-forwarded-for'] ?? '', /^127\.0\.0\.1$/);
      assert.equal(req.headers['x-forwarded-proto'], 'http');
      assert.notEqual(req.headers['x-forwarded-host'], 'spoofed.example');
      assert.notEqual(req.headers['x-forwarded-port'], '9');
    },
  });
  const login = JSON.stringify({ email: 'mock@example.test', password: 'not-a-real-secret' });
  const loginRes = await forwarded('login and repeated cookies', '/api/v1/auth/login', 'POST', { headers: { 'content-type': 'application/json' }, body: login }, auth, {
    body: Buffer.from(login), headers: { 'content-type': 'application/json' },
    headersOut: { 'set-cookie': ['access=one; Path=/; HttpOnly', 'refresh=two; Path=/; HttpOnly'] },
  });
  assert.equal(loginRes.headers.getSetCookie().length, 2);
  const tokenHeaders = { authorization: 'Bearer access-mock' };
  const refresh = JSON.stringify({ refresh_token: 'refresh-mock' });
  await forwarded('refresh', '/api/v1/auth/refresh', 'POST', { headers: { 'content-type': 'application/json' }, body: refresh }, auth, { body: Buffer.from(refresh), headers: { 'content-type': 'application/json' } });
  const logout = JSON.stringify({ refresh_token: 'refresh-mock' });
  await forwarded('logout', '/api/v1/auth/logout', 'POST', { headers: { 'content-type': 'application/json' }, body: logout }, { code: 0, message: 'success', data: { message: 'Logged out successfully' } }, { body: Buffer.from(logout), headers: { 'content-type': 'application/json' } });
  const user = { code: 0, message: 'success', data: { id: 7, email: 'mock@example.test', role: 'user' } };
  await forwarded('auth me', '/api/v1/auth/me', 'GET', { headers: tokenHeaders }, user, { headers: tokenHeaders });

  const userApiCases = [
    ['GET', '/api/v1/keys?page=1&page_size=10', undefined, { items: [], total: 0 }],
    ['GET', '/api/v1/model-plaza', undefined, { description: '', groups: [] }],
    ['GET', '/api/v1/usage?page=1&page_size=10', undefined, { items: [], total: 0 }],
    ['GET', '/api/v1/subscriptions', undefined, []],
    ['POST', '/api/v1/redeem', JSON.stringify({ code: 'mock-code' }), { message: 'redeemed', type: 'balance', value: 1, new_balance: 11 }],
  ];
  for (const [method, path, body, data] of userApiCases) {
    const headers = { ...tokenHeaders, ...(body ? { 'content-type': 'application/json' } : {}) };
    await forwarded(`user API ${method} ${path.split('?')[0]}`, path, method, { headers, body }, { code: 0, message: 'success', data }, {
      ...(body ? { body: Buffer.from(body), headers } : { headers: tokenHeaders }),
    });
  }

  const orderRequest = JSON.stringify({ amount: 10, payment_type: 'alipay', order_type: 'balance', return_url: 'http://127.0.0.1/return', payment_source: 'web' });
  const order = { code: 0, message: 'success', data: { order_id: 12, amount: 10, pay_amount: 10, fee_rate: 0, expires_at: '2030-01-01T00:00:00Z', result_type: 'order_created', payment_type: 'alipay', out_trade_no: 'mock-12', pay_url: 'http://127.0.0.1/pay', resume_token: 'mock-resume' } };
  await forwarded('payment order create', '/api/v1/payment/orders', 'POST', { headers: { ...tokenHeaders, 'content-type': 'application/json' }, body: orderRequest }, order, { body: Buffer.from(orderRequest), headers: { ...tokenHeaders, 'content-type': 'application/json' } });
  const verify = JSON.stringify({ out_trade_no: 'mock-12' });
  await forwarded('public payment verify', '/api/v1/payment/public/orders/verify', 'POST', { headers: { 'content-type': 'application/json' }, body: verify }, { code: 0, message: 'success', data: { out_trade_no: 'mock-12', status: 'paid', paid: true, created_at: '2030-01-01T00:00:00Z', expires_at: '2030-01-01T01:00:00Z' } }, { body: Buffer.from(verify), headers: { 'content-type': 'application/json' } });
  const resume = JSON.stringify({ resume_token: 'mock-resume' });
  await forwarded('payment resume resolve', '/api/v1/payment/public/orders/resolve', 'POST', { headers: { 'content-type': 'application/json' }, body: resume }, { code: 0, message: 'success', data: { out_trade_no: 'mock-12', status: 'pending', paid: false, created_at: '2030-01-01T00:00:00Z', expires_at: '2030-01-01T01:00:00Z' } }, { body: Buffer.from(resume), headers: { 'content-type': 'application/json' } });

  for (const [method, query, body, path] of [
    ['GET', 'out_trade_no=mock-12&trade_no=provider-1&trade_status=TRADE_SUCCESS', undefined, '/api/v1/payment/webhook/easypay?out_trade_no=mock-12&trade_no=provider-1&trade_status=TRADE_SUCCESS'],
    ['POST', undefined, 'out_trade_no=mock-12&trade_no=provider-1&trade_status=TRADE_SUCCESS', '/api/v1/payment/webhook/easypay'],
    ['POST', undefined, 'merchant_order_id=mock-12&status=success', '/api/v1/payment/webhook/alipay'],
    ['POST', undefined, '{"id":"evt_mock","type":"payment_intent.succeeded"}', '/api/v1/payment/webhook/stripe'],
  ]) {
    const raw = body === undefined ? Buffer.alloc(0) : Buffer.from(body);
    const methodHeaders = method === 'GET' ? {} : { 'content-type': 'application/x-www-form-urlencoded' };
    await forwarded(`webhook ${method} ${path.split('/').at(-1).split('?')[0]}`, path, method, { headers: methodHeaders, body: raw }, 'success', {
      body: raw, headers: methodHeaders, responseExact: 'success',
      check: (req) => { if (query) assert.equal(req.url.split('?')[1], query); },
    });
  }

  for (const path of ['/login', '/payment/result']) {
    const response = await call(path);
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), /smoke-spa/);
  }
  assert.equal(expectation, undefined);
  assert.deepEqual(failures, []);
  process.stdout.write(`\n${successes.length + 15} smoke groups passed. All upstream calls were loopback protocol mocks; no provider verification or payment occurred.\n`);
} finally {
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise((r) => setTimeout(r, 2000))]);
  mockServer.closeAllConnections();
  await new Promise((r) => mockServer.close(r));
  await rm(temp, { recursive: true, force: true });
}
