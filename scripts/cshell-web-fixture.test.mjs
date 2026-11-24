import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createCshellWebFixture } from './cshell-web-fixture.mjs'

async function fixtureTest(fn) {
  const server = createCshellWebFixture()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  const post = async (path, input = {}) => {
    const response = await fetch(origin + '/api/v1' + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    })
    return { status: response.status, ...await response.json() }
  }
  try { await fn(post, origin) }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
}

test('unknown trade/resume identifiers never synthesize paid orders', async () => fixtureTest(async post => {
  for (const [path, input] of [
    ['/payment/public/orders/verify', { out_trade_no: 'UNKNOWN' }],
    ['/payment/public/orders/resolve', { resume_token: 'UNKNOWN' }],
  ]) {
    const result = await post(path, input)
    assert.equal(result.status, 404)
    assert.equal(result.data, undefined)
  }
}))

test('strict payment scenarios reject unsupported states rather than pay', async () => fixtureTest(async post => {
  assert.equal((await post('/__cshell_web/payment', { result: 'qr', status: 'typo' })).status, 400)
  assert.equal((await post('/payment/orders', { amount: 5, mock_result: 'typo' })).status, 400)
  const created = await post('/payment/orders', { amount: 5 })
  assert.equal(created.status, 200)
  const invalid = await post('/payment/public/orders/verify?mock_status=typo', { out_trade_no: created.data.out_trade_no })
  assert.equal(invalid.status, 400)
  const order = await post('/payment/public/orders/verify?mock_status=pending', { out_trade_no: created.data.out_trade_no })
  assert.equal(order.data.status, 'PENDING')
  assert.equal(order.data.paid, false)
}))

test('QR pending, expired and cancelled orders remain unpaid on verify and resolve', async () => fixtureTest(async post => {
  for (const status of ['pending', 'expired', 'cancelled']) {
    assert.equal((await post('/__cshell_web/payment', { result: 'qr', status })).status, 200)
    const created = await post('/payment/orders', { amount: 5 })
    assert.equal(created.data.result_type, 'order_created')
    assert.ok(created.data.qr_code)
    for (const [path, input] of [
      ['/payment/public/orders/verify', { out_trade_no: created.data.out_trade_no }],
      ['/payment/public/orders/resolve', { resume_token: created.data.resume_token }],
    ]) {
      const verified = await post(path, input)
      assert.equal(verified.status, 200)
      assert.equal(verified.data.status, status.toUpperCase())
      assert.equal(verified.data.paid, path.endsWith('/resolve') ? undefined : false)
    }
  }
}))

test('explicit cancellation stays unpaid after scenario restores default completion', async () => fixtureTest(async post => {
  const created = await post('/payment/orders', { amount: 5 })
  assert.equal((await post(`/payment/orders/${created.data.order_id}/cancel`)).status, 200)
  const verified = await post('/payment/public/orders/verify', { out_trade_no: created.data.out_trade_no })
  assert.equal(verified.data.status, 'CANCELLED')
  assert.equal(verified.data.paid, false)
}))


test('auth uses pinned captcha and email-code contracts, not a standalone verification endpoint', async () => fixtureTest(async post => {
  assert.equal((await post('/auth/login', { email: 'mock@example.invalid', password: 'secret' })).status, 400)
  assert.equal((await post('/auth/login', { email: 'mock@example.invalid', password: 'secret', turnstile_token: 'LOCAL-OK' })).status, 200)
  assert.equal((await post('/auth/send-verify-code', { email: 'mock@example.invalid' })).status, 400)
  const sent = await post('/auth/send-verify-code', { email: 'mock@example.invalid', turnstile_token: 'LOCAL-OK' })
  assert.equal(sent.status, 200)
  assert.equal(typeof sent.data.message, 'string')
  assert.equal(sent.data.countdown, 60)
  assert.equal(sent.data.sent, undefined)
  const registration = await post('/auth/register', { email: 'mock@example.invalid', password: 'secret', verify_code: '123456' })
  assert.equal(registration.status, 200)
  assert.equal((await post('/auth/verify-email', { email: 'mock@example.invalid', code: '123456' })).status, 501)
}))
