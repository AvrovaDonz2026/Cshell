#!/usr/bin/env node
/** Real Rust proxy, normal /_cshell/ assets, strict loopback mock acceptance. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { createCshellWebFixture, user } from './cshell-web-fixture.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const { chromium } = createRequire(root + 'web/package.json')('playwright')
const dir = root + 'artifacts/cshell-web/production/'
await mkdir(dir, { recursive: true })
const report = { scope: 'actual Rust proxy + loopback mock; no real upstream/payment claim', checks: [], errors: [], screenshots: [] }
const fixture = createCshellWebFixture()
let proxy, browser
async function check(name, fn) {
  try { await fn(); report.checks.push({ name, passed: true }); console.log('PASS', name) }
  catch (e) { report.checks.push({ name, passed: false, error: e.stack }); console.error('FAIL', name, e.message) }
}
try {
  const html = await readFile(root + 'web/dist/index.html', 'utf8')
  assert.ok(html.includes('/_cshell/assets/'), 'Build must use normal production asset base')
  fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening')
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const base = `http://127.0.0.1:${port}`
  proxy = spawn(root + 'target/debug/cshell', [], { cwd: root, env: { ...process.env,
    CSHELL_LISTEN: `127.0.0.1:${port}`, SUB2API_UPSTREAM: `http://127.0.0.1:${fixture.address().port}`,
    CSHELL_STATIC_DIR: root + 'web/dist', CSHELL_PUBLIC_URL: base,
  }, stdio: ['ignore', 'pipe', 'pipe'] })
  proxy.stdout.on('data', () => {}); proxy.stderr.on('data', () => {})
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/_cshell/health')).ok) break } catch {}
    if (proxy.exitCode !== null) throw new Error('Rust proxy exited before readiness')
    if (i === 99) throw new Error('Rust readiness timeout')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({ headless: true, executablePath: process.env.WORKSPACE_CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] })
  for (const route of ['/', '/login', '/dashboard']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    await ctx.route('**/*', async route => {
      if (new URL(route.request().url()).origin !== base) { report.errors.push('Forbidden external request: ' + route.request().url()); await route.abort() }
      else await route.continue()
    })
    await ctx.addInitScript(({ signedIn, user }) => {
      localStorage.setItem('cshell_locale', 'en'); localStorage.setItem('cshell_theme', 'light')
      if (signedIn) {
        localStorage.setItem('auth_token', 'local-mock-user'); localStorage.setItem('auth_user', JSON.stringify(user))
        localStorage.setItem('refresh_token', 'local-mock-refresh'); localStorage.setItem('token_expires_at', String(Date.now() + 86400000))
      }
    }, { signedIn: route === '/dashboard', user })
    const page = await ctx.newPage()
    page.on('pageerror', e => report.errors.push(e.stack))
    page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()) })
    page.on('response', r => { if (r.status() >= 400) report.errors.push(`${r.status()} ${r.url()}`) })
    page.on('requestfailed', r => report.errors.push(`${r.failure()?.errorText} ${r.url()}`))
    await check(`production ${route} direct and reload`, async () => {
      await page.goto(base + route, { waitUntil: 'networkidle' })
      await page.locator('h1').waitFor()
      assert.equal(new URL(page.url()).pathname, route)
      await page.reload({ waitUntil: 'networkidle' })
      assert.equal(new URL(page.url()).pathname, route)
      await page.locator('h1').waitFor()
      const logo = page.locator('img').first()
      assert.equal(new URL(await logo.getAttribute('src'), base).pathname, '/_cshell/2shell.jpeg')
      assert.ok(await logo.evaluate(el => el.complete && el.naturalWidth > 0), 'Production brand image broken')
      const assets = await page.evaluate(() => performance.getEntriesByType('resource').map(r => r.name).filter(n => /\.(js|css)$/.test(n)))
      assert.ok(assets.length > 0)
      assert.ok(assets.every(n => new URL(n).pathname.startsWith('/_cshell/assets/')))
      const name = route === '/' ? 'home' : route.slice(1)
      await page.screenshot({ path: dir + name + '.png', fullPage: true }); report.screenshots.push(name + '.png')
      if (route === '/login') {
        await page.locator('input[type="email"]').fill('production-mock@example.invalid')
        await page.locator('input[type="password"]').fill('local-only-password')
        await page.getByRole('button', { name: 'Click to complete the local mock check' }).click()
        await page.locator('button[type="submit"]').click()
        await page.waitForURL(base + '/dashboard')
        await page.waitForLoadState('networkidle')
        assert.equal(new URL(page.url()).pathname, '/dashboard', 'Router must not prefix history with asset base')
      }
    })
    await ctx.close()
  }
  await check('production API forwarding and local assets', async () => {
    const response = await fetch(base + '/api/v1/settings/public')
    assert.equal(response.status, 200); assert.equal((await response.json()).data.site_name, 'Cshell')
    const requests = (await (await fetch(base + '/api/v1/__cshell_web/report')).json()).data
    assert.ok(requests.requests.some(r => r.method === 'POST' && r.path === '/auth/login'))
    assert.ok(requests.requests.some(r => r.path === '/usage/dashboard/stats'))
    assert.equal(requests.unexpected.length, 0)
    const logo = await fetch(base + '/_cshell/2shell.jpeg')
    assert.equal(logo.status, 200); assert.ok(logo.headers.get('content-type').startsWith('image/'))
    assert.equal((await fetch(base + '/_cshell/assets/not-present.js')).status, 404)
  })
} catch (e) { report.errors.push(e.stack) }
finally {
  await browser?.close()
  if (proxy && proxy.exitCode === null) { proxy.kill('SIGTERM'); await once(proxy, 'exit') }
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve))
  report.passed = report.errors.length === 0 && report.checks.length === 4 && report.checks.every(c => c.passed)
  report.finishedAt = new Date().toISOString()
  await writeFile(dir + 'results.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, errors: report.errors.length, report: dir + 'results.json' }))
  if (!report.passed) process.exitCode = 1
}
