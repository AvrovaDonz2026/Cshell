import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildMemoryFlag, registerSecret, resolveLatestDigest, sanitize } from './sub2api-ci-upstream.mjs'

test('build memory flag bounds the upstream frontend heap', () => {
  assert.equal(buildMemoryFlag(), 'NODE_OPTIONS=--max-old-space-size=4096')
})

test('sanitize removes registered secrets and generic credential assignments', () => {
  const secret = 'super-secret-ci-password'
  registerSecret(secret)
  const text = `login with ${secret} and PASSWORD=hunter2 JWT_SECRET=abc123`
  const clean = sanitize(text)
  assert.ok(!clean.includes(secret), 'registered secret leaked')
  assert.ok(!clean.includes('hunter2'), 'generic password leaked')
  assert.ok(!clean.includes('abc123'), 'jwt secret leaked')
  assert.ok(clean.includes('[REDACTED]'), 'expected redaction marker')
})

test('sanitize leaves non-credential content intact', () => {
  assert.equal(sanitize('registration_enabled=true'), 'registration_enabled=true')
})

test('latest digest reference is a valid per-platform image pin', async () => {
  const { digest, reference } = await resolveLatestDigest('podman')
  assert.match(digest, /^sha256:[a-f0-9]{64}$/)
  assert.equal(reference, `docker.io/weishaw/sub2api@${digest}`)
})
