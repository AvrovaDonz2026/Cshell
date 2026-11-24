#!/usr/bin/env node
/**
 * Real-backend browser gate for the production `web/dist` served by Cshell.
 *
 * Cshell serves the downloaded production build and reverse-proxies a real
 * Sub2API reachable at CSHELL_BASE_URL. There is no API mocking, no fixture
 * server and no interception of business responses: every assertion below is
 * made against the deployed backend. The only routing rule is a loopback guard
 * that aborts non-loopback destinations, so a leaked external dependency fails
 * loudly instead of silently leaving the machine.
 *
 * Required environment:
 *   CSHELL_BASE_URL                default http://127.0.0.1:18080 (loopback only)
 *   SUB2API_TEST_EMAIL/PASSWORD    non-admin account used for the whole user flow
 *   SUB2API_ADMIN_EMAIL/PASSWORD   administrator account, redirect check only
 *   SUB2API_UPSTREAM_ID            commit or image digest, recorded as evidence
 * Optional:
 *   SUB2API_BROWSER_ARTIFACTS      default artifacts/sub2api-browser
 *   CHROME_PATH / WORKSPACE_CHROME optional Chrome executable
 *
 * The gate never skips: an unreachable Cshell, a non-ready upstream, missing
 * credentials or an enabled interactive captcha is a hard failure. Expected
 * negative HTTP responses must be declared by exact method, path, status and
 * count; every other runtime, console, request or HTTP error fails the run.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { access, mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const webPkg = path.join(root, 'web/package.json')

/* --------------------------------------------------------------- fail closed */

function failConfig(message) {
  throw new Error(message)
}

const rawBase = (process.env.CSHELL_BASE_URL || 'http://127.0.0.1:18080').replace(/\/+$/, '')
let parsedBase
try {
  parsedBase = new URL(rawBase)
} catch {
  failConfig(`CSHELL_BASE_URL is not a valid URL: ${rawBase}`)
}
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
if (parsedBase.protocol !== 'http:' && parsedBase.protocol !== 'https:') {
  failConfig('CSHELL_BASE_URL must be an http(s) loopback origin')
}
if (!LOOPBACK.has(parsedBase.hostname)) {
  failConfig(
    `CSHELL_BASE_URL must be loopback (127.0.0.1, localhost or [::1]); got ${parsedBase.hostname}`,
  )
}
if (parsedBase.pathname !== '/' || parsedBase.search || parsedBase.hash) {
  failConfig('CSHELL_BASE_URL must be an origin without path, query or fragment')
}
const baseUrl = parsedBase.origin
const baseOrigin = parsedBase.origin

const env = {
  email: process.env.SUB2API_TEST_EMAIL || '',
  password: process.env.SUB2API_TEST_PASSWORD || '',
  adminEmail: process.env.SUB2API_ADMIN_EMAIL || '',
  adminPassword: process.env.SUB2API_ADMIN_PASSWORD || '',
  upstream: process.env.SUB2API_UPSTREAM_ID || 'unknown',
}
const missing = [
  ['SUB2API_TEST_EMAIL', env.email],
  ['SUB2API_TEST_PASSWORD', env.password],
  ['SUB2API_ADMIN_EMAIL', env.adminEmail],
  ['SUB2API_ADMIN_PASSWORD', env.adminPassword],
]
  .filter(([, value]) => !value)
  .map(([name]) => name)
if (missing.length) failConfig(`Missing required environment: ${missing.join(', ')}`)
if (env.email.toLowerCase() === env.adminEmail.toLowerCase()) {
  failConfig('SUB2API_TEST_EMAIL must be a non-admin account distinct from SUB2API_ADMIN_EMAIL')
}
if (env.upstream === 'unknown') {
  console.warn('SUB2API_UPSTREAM_ID is unset; recording upstream as unknown')
}

const artifactsDir = path.resolve(
  root,
  process.env.SUB2API_BROWSER_ARTIFACTS || 'artifacts/sub2api-browser',
)
await mkdir(artifactsDir, { recursive: true })

async function loadPlaywright() {
  try {
    await access(webPkg, fsConstants.R_OK)
    return createRequire(webPkg)('playwright')
  } catch {
    throw new Error(
      'playwright not found under web/; install web dependencies (pnpm --dir web install) first',
    )
  }
}

const { chromium } = await loadPlaywright()

/* ------------------------------------------------------------- sanitization */

const SECRET_PARAMS =
  /^(?:token|access_token|refresh_token|id_token|resume_token|authorization|password|old_password|new_password|secret|api[_-]?key|key|code|verify_code|turnstile_token)$/i
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const QUERY_SECRET = new RegExp(
  '([?&](?:token|access_token|refresh_token|id_token|resume_token|authorization|password|secret|api[_-]?key|key|code|verify_code|turnstile_token)=)[^&#\\s]+',
  'gi',
)

/** Redact bearer tokens and secret query parameters from any diagnostic text. */
function redactText(value) {
  return String(value)
    .replace(BEARER, 'Bearer [REDACTED]')
    .replace(QUERY_SECRET, '$1[REDACTED]')
}

/** Redact credentials and secret query parameters from a URL. */
function redactUrl(value) {
  try {
    const url = new URL(value)
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_PARAMS.test(key)) url.searchParams.set(key, '[REDACTED]')
    }
    url.username = ''
    url.password = ''
    return redactText(url.toString())
  } catch {
    return redactText(value)
  }
}

/* ------------------------------------------------------------------- report */

const report = {
  scope:
    'real Sub2API through the Cshell proxy plus production web/dist; no API mocks, no fixtures, no business-response interception',
  base: baseUrl,
  upstream: env.upstream,
  startedAt: new Date().toISOString(),
  browser: null,
  preflight: [],
  settings: null,
  unauthenticatedProfileStatus: null,
  /** Status a rejected login returns; learned from a synthetic identity, not the test account. */
  wrongPasswordStatus: null,
  sessionObserved: null,
  checks: [],
  failures: [],
  runtimeErrors: [],
  consoleErrors: [],
  requestFailures: [],
  httpFailures: [],
  unexpectedExternalRequests: [],
  toleratedStaleUsageAborts: [],
  expectedNegatives: [],
  /** Upstream admin UI is out of scope (never crawled); its noise is recorded only. */
  adminDiagnostics: [],
  screenshots: [],
  passed: false,
}

const resultsPath = path.join(artifactsDir, 'results.json')
const flush = async () =>
  writeFile(resultsPath, JSON.stringify({ ...report, inProgress: true }, null, 2))
await flush()

const lockPath = path.join(artifactsDir, 'browser.lock')
async function acquireLock() {
  try {
    const lock = await open(lockPath, 'wx')
    await lock.writeFile(String(process.pid))
    await lock.close()
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const pid = Number(await readFile(lockPath, 'utf8').catch(() => '0'))
    let alive = false
    if (pid > 0) {
      try {
        process.kill(pid, 0)
        alive = true
      } catch {
        alive = false
      }
    }
    if (alive) throw new Error(`Another sub2api browser gate owns ${lockPath}: pid ${pid}`)
    await unlink(lockPath)
    const lock = await open(lockPath, 'wx')
    await lock.writeFile(String(process.pid))
    await lock.close()
  }
}
await acquireLock()

/* --------------------------------------------------------------- preflight */

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
    ...options,
    headers: {
      accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  return { response, text }
}

function recordPreflight(name, details) {
  report.preflight.push({ name, passed: true, ...details })
  console.log('PASS preflight:', name)
}

function envelope(text, label) {
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`${label} was not JSON; Cshell API forwarding is broken`)
  }
  assert.equal(typeof body.code, 'number', `${label} is not a Cshell API envelope`)
  assert.equal(body.code, 0, `${label} envelope code ${body.code}: ${redactText(body.message)}`)
  return body.data
}

async function preflight() {
  let health
  try {
    health = await request('/_cshell/health', { headers: { accept: 'text/plain' } })
  } catch (error) {
    throw new Error(
      `Cshell at ${baseUrl} is unreachable (/_cshell/health: ${redactText(error?.message || error)}). ` +
        'This gate never skips: start Cshell against a reachable Sub2API, or set CSHELL_BASE_URL.',
    )
  }
  assert.equal(health.response.status, 200, `/_cshell/health returned ${health.response.status}`)
  assert.match(health.text, /ok/i, '/_cshell/health did not report ok')
  recordPreflight('cshell health', { status: 200 })

  const ready = await request('/_cshell/ready', { headers: { accept: 'text/plain' } })
  assert.equal(
    ready.response.status,
    200,
    `/_cshell/ready returned ${ready.response.status}; the Sub2API upstream is not ready`,
  )
  assert.match(ready.text, /ready/i, '/_cshell/ready did not report readiness')
  recordPreflight('sub2api upstream ready', { status: 200 })

  const index = await request('/', { headers: { accept: 'text/html' } })
  assert.equal(index.response.status, 200, `/ returned ${index.response.status}`)
  assert.ok(
    String(index.response.headers.get('content-type') || '').includes('text/html'),
    '/ was not served as HTML',
  )
  assert.match(index.text, /<div id="app"><\/div>/, '/ did not serve the production SPA shell')
  const assetRefs = [
    ...new Set(
      [...index.text.matchAll(/(?:src|href)="(\/_cshell\/[^"]+)"/g)].map((match) => match[1]),
    ),
  ]
  assert.ok(assetRefs.length > 0, 'production index.html does not reference /_cshell/ assets')
  assert.ok(
    assetRefs.some((ref) => ref.startsWith('/_cshell/assets/')),
    'production index.html does not reference /_cshell/assets/',
  )
  recordPreflight('production SPA HTML', { status: 200, assets: assetRefs.length })

  for (const ref of assetRefs) {
    const asset = await request(ref)
    assert.equal(asset.response.status, 200, `${ref} returned ${asset.response.status} (expected 200)`)
    assert.ok(asset.text.length > 0, `${ref} was empty`)
  }
  recordPreflight('production /_cshell/ assets', { assets: assetRefs })

  for (const route of ['/dashboard', '/login']) {
    const deep = await request(route, { headers: { accept: 'text/html' } })
    assert.equal(deep.response.status, 200, `${route} returned ${deep.response.status}`)
    assert.match(deep.text, /<div id="app"><\/div>/, `${route} did not serve the SPA shell`)
  }
  recordPreflight('SPA deep links', { routes: ['/dashboard', '/login'] })

  const settings = envelope(
    (await request('/api/v1/settings/public')).text,
    '/api/v1/settings/public',
  )
  assert.ok(settings && typeof settings === 'object', 'settings/public has no data object')
  report.settings = {
    site_name: settings.site_name ?? null,
    registration_enabled: settings.registration_enabled === true,
    email_verify_enabled: settings.email_verify_enabled === true,
    payment_enabled: settings.payment_enabled === true,
    subscription_enabled: settings.subscription_enabled === true,
    turnstile_enabled: settings.turnstile_enabled === true,
    tencent_captcha_enabled: settings.tencent_captcha_enabled === true,
    aliyun_captcha_enabled: settings.aliyun_captcha_enabled === true,
  }
  recordPreflight('API forwarding', { route: '/api/v1/settings/public', status: 200 })

  if (
    report.settings.turnstile_enabled ||
    report.settings.tencent_captcha_enabled ||
    report.settings.aliyun_captcha_enabled
  ) {
    throw new Error(
      'captcha is enabled on the real backend; this browser gate cannot solve interactive captchas. ' +
        'Configure the CI deployment with captcha disabled for the generated test accounts.',
    )
  }

  const anonymous = await request('/api/v1/user/profile')
  assert.ok(
    anonymous.response.status === 401 || anonymous.response.status === 403,
    `unauthenticated profile must be rejected, got ${anonymous.response.status}`,
  )
  report.unauthenticatedProfileStatus = anonymous.response.status
  recordPreflight('authenticated API is protected', { status: anonymous.response.status })

  // Learn the status a rejected login returns. A synthetic identity is used so the
  // real test account never consumes a lockout counter; the browser phase can then
  // declare a precise expected negative instead of guessing a status.
  const synthetic = `cshell-browser-negative-${Date.now().toString(36)}@example.invalid`
  const wrong = await request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: synthetic, password: `not-the-password-${Date.now()}` }),
  })
  assert.ok(
    [400, 401, 403, 422].includes(wrong.response.status),
    `a rejected login must return 400/401/403/422, got ${wrong.response.status}. ` +
      'If this is 429 the deployment rate-limits login probes and the gate cannot declare ' +
      'its one expected negative safely.',
  )
  report.wrongPasswordStatus = wrong.response.status
  recordPreflight('rejected login status is observable', { status: wrong.response.status })
}

/* ----------------------------------------------------------------- tracking */

const RESOURCE_FAILURE = /^Failed to load resource: the server responded with a status of (\d{3})/

function normalizerFor(tracker) {
  if (tracker.gating) {
    return {
      runtime: (entry) => report.runtimeErrors.push(entry),
      console: (entry) => report.consoleErrors.push(entry),
      request: (entry) => report.requestFailures.push(entry),
      http: (entry) => report.httpFailures.push(entry),
      external: (entry) => report.unexpectedExternalRequests.push(entry),
    }
  }
  return {
    runtime: (entry) => report.adminDiagnostics.push({ kind: 'pageerror', ...entry }),
    console: (entry) => report.adminDiagnostics.push({ kind: 'console', ...entry }),
    request: (entry) => report.adminDiagnostics.push({ kind: 'requestfailed', ...entry }),
    http: (entry) => report.adminDiagnostics.push({ kind: 'http', ...entry }),
    external: (entry) => report.adminDiagnostics.push({ kind: 'external', ...entry }),
  }
}

/**
 * Declare an expected negative HTTP response by exact method, path, status and
 * count. The returned handle asserts the declared count actually happened and
 * then stops tolerating the response, so an unrelated later failure still fails.
 */
function expectNegative(tracker, spec) {
  assert.ok(spec.method && spec.pathname, 'expectation needs a method and pathname')
  assert.ok(Number.isInteger(spec.status), 'expectation needs an integer status')
  const count = spec.count ?? 1
  assert.ok(count > 0, 'expectation count must be positive')
  const expectation = {
    method: spec.method,
    pathname: spec.pathname,
    status: spec.status,
    count,
    seen: 0,
    consoles: 0,
  }
  tracker.expected.push(expectation)
  const record = {
    phase: tracker.phase,
    method: expectation.method,
    pathname: expectation.pathname,
    status: expectation.status,
    count: expectation.count,
    observed: 0,
  }
  report.expectedNegatives.push(record)
  return {
    dispose() {
      const index = tracker.expected.indexOf(expectation)
      if (index >= 0) tracker.expected.splice(index, 1)
      record.observed = expectation.seen
      return { seen: expectation.seen, consoles: expectation.consoles, expected: count }
    },
  }
}

function track(page, phase, { gating = true, allowExternal = false } = {}) {
  const tracker = { phase, gating, allowExternal, expected: [] }
  const sink = normalizerFor(tracker)

  page.on('pageerror', (error) => {
    sink.runtime({
      phase,
      url: redactUrl(page.url()),
      error: redactText(error?.stack || error?.message || error),
    })
  })

  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    const location = message.location()
    const resourceMatch = RESOURCE_FAILURE.exec(text)
    if (resourceMatch && location.url) {
      try {
        const url = new URL(location.url)
        const status = Number(resourceMatch[1])
        const expectation = tracker.expected.find(
          (candidate) =>
            url.origin === baseOrigin &&
            candidate.pathname === url.pathname &&
            candidate.status === status &&
            candidate.consoles < candidate.count,
        )
        if (expectation) {
          expectation.consoles += 1
          return
        }
      } catch {
        // fall through and record the console error strictly
      }
    }
    sink.console({
      phase,
      url: redactUrl(page.url()),
      location: location.url ? redactUrl(location.url) : null,
      text: redactText(text),
    })
  })

  page.on('requestfailed', (request) => {
    const error = request.failure()?.errorText || 'request failed'
    let url
    try {
      url = new URL(request.url())
    } catch {
      return
    }
    if (url.origin !== baseOrigin) {
      if (!allowExternal) {
        sink.external({
          phase,
          method: request.method(),
          url: redactUrl(request.url()),
          error: redactText(error),
        })
      }
      return
    }
    // The SPA deliberately aborts stale usage/trend fetches when filters or the
    // heatmap scale change. Only those same-origin GET aborts are tolerated;
    // every other request failure stays fatal.
    if (
      error === 'net::ERR_ABORTED' &&
      request.method() === 'GET' &&
      url.pathname.startsWith('/api/v1/usage')
    ) {
      report.toleratedStaleUsageAborts.push({
        phase,
        method: request.method(),
        pathname: url.pathname,
        error,
      })
      return
    }
    sink.request({
      phase,
      method: request.method(),
      url: redactUrl(request.url()),
      error: redactText(error),
    })
  })

  page.on('response', (response) => {
    if (response.status() < 400) return
    const request = response.request()
    let url
    try {
      url = new URL(response.url())
    } catch {
      return
    }
    if (url.origin !== baseOrigin) {
      if (!allowExternal) {
        sink.http({
          phase,
          method: request.method(),
          url: redactUrl(response.url()),
          status: response.status(),
        })
      }
      return
    }
    const expectation = tracker.expected.find(
      (candidate) =>
        candidate.method === request.method() &&
        candidate.pathname === url.pathname &&
        candidate.status === response.status() &&
        candidate.seen < candidate.count,
    )
    if (expectation) {
      expectation.seen += 1
      return
    }
    sink.http({
      phase,
      method: request.method(),
      url: redactUrl(response.url()),
      status: response.status(),
    })
  })

  return tracker
}

/* ------------------------------------------------------------------ helpers */

async function settle(page, extraMs = 150) {
  await page.waitForLoadState('networkidle', { timeout: 25_000 }).catch(() => {})
  if (extraMs > 0) await page.waitForTimeout(extraMs)
}

async function check(name, fn, page) {
  try {
    const details = await fn()
    report.checks.push({ name, passed: true, ...(details || {}) })
    console.log('PASS', name)
  } catch (error) {
    report.failures.push({ name, error: redactText(error?.stack || error) })
    report.checks.push({ name, passed: false })
    console.error('FAIL', name, error?.message || error)
    if (page) {
      const file = `failure-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60)}.png`
      const saved = await page
        .screenshot({ path: path.join(artifactsDir, file), fullPage: true })
        .then(() => true)
        .catch(() => false)
      if (saved) report.screenshots.push(file)
    }
  } finally {
    await flush()
  }
}

async function screenshot(page, name) {
  const file = `${name}.png`
  await page.screenshot({ path: path.join(artifactsDir, file), fullPage: true })
  report.screenshots.push(file)
}

async function assertNoOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    path: location.pathname,
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  assert.ok(
    metrics.scrollWidth <= metrics.width + 1,
    `${label}: horizontal overflow at ${metrics.path} (${metrics.scrollWidth} > ${metrics.width})`,
  )
  return metrics
}

async function gotoRoute(page, route) {
  await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await settle(page)
}

async function fillLogin(page, email, password) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.locator('form input[type="email"]').waitFor()
  await page.locator('form input[type="email"]').fill(email)
  await page.locator('form input[type="password"]').fill(password)
  await page
    .waitForFunction(
      () => {
        const button = document.querySelector('form button[type="submit"]')
        return Boolean(button) && !button.disabled
      },
      null,
      { timeout: 30_000 },
    )
    .catch(() => {
      throw new Error(
        'login submit stayed disabled: public settings failed to load or a captcha is required',
      )
    })
}

async function waitForWorkspace(page) {
  // `.cshell-user-workspace` is also on the auth split, so the authenticated
  // shell is identified by the app shell plus its content landmark.
  await page.locator('.app-shell').waitFor({ timeout: 30_000 })
  await page.locator('main.shell-content').first().waitFor({ timeout: 30_000 })
}

/** Count of authenticated app shells; a guest/login page has none. */
async function appShellCount(page) {
  return page.locator('.app-shell').count()
}

async function loginAsUser(page) {
  await fillLogin(page, env.email, env.password)
  await page.locator('form button[type="submit"]').click()
  await page
    .waitForURL((url) => url.pathname === '/dashboard' || url.pathname.startsWith('/admin'), {
      timeout: 60_000,
    })
    .catch(() => {
      throw new Error(`login did not reach the workspace; still at ${redactUrl(page.url())}`)
    })
  assert.equal(
    new URL(page.url()).pathname,
    '/dashboard',
    'the non-admin test account was redirected to the upstream admin surface',
  )
  await waitForWorkspace(page)
  await settle(page)
}

async function keyRowNames(page) {
  return page
    .locator('li.key-row h2')
    .evaluateAll((nodes) => nodes.map((node) => (node.textContent || '').trim()))
}

/**
 * Locate a key row by exact name. The list reloads after a mutation, so this
 * first waits briefly for the name to appear on the current page and only then
 * paginates; a name that never appears returns null.
 */
async function findKeyRow(page, name) {
  const seen = async () => (await keyRowNames(page)).includes(name)
  try {
    await page.waitForFunction(
      (text) =>
        Array.from(document.querySelectorAll('li.key-row h2')).some(
          (node) => (node.textContent || '').trim() === text,
        ),
      name,
      { timeout: 10_000 },
    )
  } catch {
    // Not on this page; fall through to pagination.
  }
  for (let index = 0; index < 8; index += 1) {
    const position = (await keyRowNames(page)).indexOf(name)
    if (position >= 0) return page.locator('li.key-row').nth(position)
    const next = page.getByRole('button', { name: 'Next', exact: true })
    if ((await next.count()) === 0 || (await next.isDisabled())) return null
    await next.click()
    await settle(page)
    if (await seen()) return page.locator('li.key-row').nth((await keyRowNames(page)).indexOf(name))
  }
  return null
}

async function waitForKeyGone(page, name) {
  await page.waitForFunction(
    (text) =>
      !Array.from(document.querySelectorAll('li.key-row')).some((row) =>
        row.textContent.includes(text),
      ),
    name,
    { timeout: 20_000 },
  )
}

async function waitForSaved(page) {
  await page.getByText('Saved', { exact: true }).first().waitFor({ timeout: 20_000 })
}

async function storageValue(page, key) {
  return page.evaluate((name) => localStorage.getItem(name), key)
}

async function chooseLocale(page, scope, label) {
  await scope.locator('.cshell-select__trigger').click()
  const list = page.locator('body > .cshell-select__list')
  await list.waitFor()
  await list.locator('.cshell-select__option').filter({ hasText: label }).click()
  await list.waitFor({ state: 'hidden' }).catch(() => {})
}

function billingEnabled() {
  return report.settings?.payment_enabled === true || report.settings?.subscription_enabled === true
}

async function assertNoPaidClaim(page, label) {
  assert.equal(
    await page.locator('.status--paid').count(),
    0,
    `${label}: rendered a paid order chip without any payment`,
  )
  assert.equal(
    await page.locator('.pending').count(),
    0,
    `${label}: opened a pending payment panel unexpectedly`,
  )
  assert.notEqual(
    new URL(page.url()).pathname,
    '/payment/result',
    `${label}: navigated to a payment result without a payment`,
  )
}

/* --------------------------------------------------------------------- gate */

let browser = null

try {
  await preflight()

  const launchOptions = { headless: true, args: ['--no-sandbox'] }
  const chromePath = process.env.CHROME_PATH || process.env.WORKSPACE_CHROME
  if (chromePath) {
    try {
      await access(chromePath, fsConstants.X_OK)
      launchOptions.executablePath = chromePath
    } catch {
      console.warn('CHROME_PATH/WORKSPACE_CHROME is not executable; using Playwright Chromium')
    }
  }
  browser = await chromium.launch(launchOptions)
  report.browser = `chromium ${browser.version()}`

  /** Abort any destination that is not the Cshell loopback origin. */
  const guardExternal = async (context) => {
    await context.route('**/*', async (route) => {
      let url
      try {
        url = new URL(route.request().url())
      } catch {
        await route.abort()
        return
      }
      if (url.protocol === 'data:' || url.protocol === 'blob:') {
        await route.continue()
        return
      }
      if (url.origin !== baseOrigin) {
        await route.abort()
        return
      }
      await route.continue()
    })
  }

  /* ------------------------------------------------ desktop light user flow */

  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: 'en-US',
      timezoneId: 'UTC',
      colorScheme: 'light',
    })
    const page = await context.newPage()
    page.setDefaultTimeout(30_000)
    page.setDefaultNavigationTimeout(60_000)
    const tracker = track(page, 'desktop-light')
    await guardExternal(context)

    await check(
      'guest home renders the production SPA built for /_cshell/',
      async () => {
        await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await page.locator('.cshell-public').waitFor()
        await settle(page)
        assert.ok((await page.locator('h1').count()) > 0, 'guest home has no h1')
        assert.equal(
          await appShellCount(page),
          0,
          'guest sees the authenticated workspace shell',
        )
        assert.ok(
          await page.locator('.wordmark__logo').evaluate((el) => el.complete && el.naturalWidth > 0),
          'production brand asset did not load from /_cshell/',
        )
        const assets = await page.evaluate(() =>
          performance
            .getEntriesByType('resource')
            .map((entry) => entry.name)
            .filter((name) => /\.(js|css)$/.test(name)),
        )
        assert.ok(assets.length > 0, 'guest home loaded no JS/CSS resources')
        for (const asset of assets) {
          assert.ok(
            new URL(asset).pathname.startsWith('/_cshell/assets/'),
            `production asset is not served from /_cshell/assets/: ${redactUrl(asset)}`,
          )
        }
        const metrics = await assertNoOverflow(page, 'guest home')
        await screenshot(page, 'guest-home')
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.locator('.cshell-public').waitFor()
        await settle(page)
        assert.equal(
          await appShellCount(page),
          0,
          'guest reload entered the workspace',
        )
        return { assets: assets.length, metrics }
      },
      page,
    )

    await check(
      'wrong password is rejected with the exact declared status',
      async () => {
        const loginPage = await context.newPage()
        const loginTracker = track(loginPage, 'negative-login')
        try {
          const synthetic = `cshell-browser-negative-${Date.now().toString(36)}@example.invalid`
          const expectation = expectNegative(loginTracker, {
            method: 'POST',
            pathname: '/api/v1/auth/login',
            status: report.wrongPasswordStatus,
            count: 1,
          })
          try {
            await fillLogin(loginPage, synthetic, `wrong-${Date.now()}`)
            const response = loginPage.waitForResponse(
              (candidate) =>
                new URL(candidate.url()).pathname === '/api/v1/auth/login' &&
                candidate.request().method() === 'POST',
              { timeout: 30_000 },
            )
            await loginPage.locator('form button[type="submit"]').click()
            assert.equal((await response).status(), report.wrongPasswordStatus)
            await loginPage.locator('form [role="alert"]').first().waitFor({ timeout: 20_000 })
            await settle(loginPage)
          } finally {
            const outcome = expectation.dispose()
            assert.equal(
              outcome.seen,
              outcome.expected,
              'the declared negative response did not occur exactly once',
            )
          }
          assert.equal(
            new URL(loginPage.url()).pathname,
            '/login',
            'a failed login left the login route',
          )
          assert.equal(
            await appShellCount(loginPage),
            0,
            'a failed login entered the workspace',
          )
          await screenshot(loginPage, 'login-rejected')
        } finally {
          await loginPage.close()
        }
      },
      page,
    )

    await check(
      'real test account signs in and lands on the dashboard',
      async () => {
        await loginAsUser(page)
        const user = await page.evaluate(() => {
          const raw = localStorage.getItem('auth_user')
          return raw ? JSON.parse(raw) : null
        })
        assert.ok(user, 'login did not persist an authenticated user')
        assert.notEqual(user.role, 'admin', 'the user flow must not sign in with an admin account')
        report.sessionObserved = {
          role: user.role,
          hasAccessToken: Boolean(await storageValue(page, 'auth_token')),
        }
        await screenshot(page, 'dashboard')
        return { role: user.role }
      },
      page,
    )

    await check(
      'production /dashboard deep link survives a reload',
      async () => {
        await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' })
        await waitForWorkspace(page)
        await settle(page)
        await page.reload({ waitUntil: 'domcontentloaded' })
        await waitForWorkspace(page)
        await settle(page)
        assert.equal(new URL(page.url()).pathname, '/dashboard')
        return await assertNoOverflow(page, 'dashboard reload')
      },
      page,
    )

    await check(
      'dashboard loads real stats and trend without errors',
      async () => {
        await gotoRoute(page, '/dashboard')
        await waitForWorkspace(page)
        await page.locator('.metric-strip').waitFor({ timeout: 30_000 })
        assert.equal(
          await page.locator('.shell-content [role="alert"]').count(),
          0,
          'dashboard renders an error alert',
        )
        const trend = page.locator('section.dashboard-trend')
        await trend.waitFor()
        await trend.locator('[role="grid"]').first().waitFor({ timeout: 30_000 })
        const cells = await trend.locator('[role="gridcell"]').count()
        assert.ok(cells > 0, 'dashboard heatmap rendered no cells')
        const totals = await page.locator('.totals .total-card').count()
        assert.ok(totals > 0, 'dashboard totals did not render')
        const metrics = await assertNoOverflow(page, 'dashboard')
        await screenshot(page, 'dashboard-stats')
        return { cells, totals, metrics }
      },
      page,
    )

    await check(
      'dashboard heatmap scale switch re-queries the real trend',
      async () => {
        const group = page.locator('.dashboard-filters [role="group"][aria-label="Heatmap time scale"]').first()
        await group.waitFor()
        const buttons = group.locator('button')
        const count = await buttons.count()
        assert.equal(count, 3, `dashboard scale control has ${count} buttons, expected 3`)
        const scales = []
        for (let index = 0; index < count; index += 1) {
          const response = page.waitForResponse(
            (candidate) =>
              new URL(candidate.url()).pathname === '/api/v1/usage/dashboard/trend' &&
              candidate.request().method() === 'GET',
            { timeout: 30_000 },
          )
          await buttons.nth(index).click()
          assert.equal((await response).status(), 200)
          await settle(page)
          assert.equal(await buttons.nth(index).getAttribute('aria-pressed'), 'true')
          // The dashboard always feeds the day-cell grid; its multi-year row
          // renders an empty month grid by design (monthCells is []), so require
          // the grid container to be attached and record the real cell count.
          const grid = page.locator('section.dashboard-trend [role="grid"]').first()
          await grid.waitFor({ state: 'attached', timeout: 30_000 })
          scales.push({
            label: (await buttons.nth(index).innerText()).trim(),
            cells: await grid.locator('[role="gridcell"]').count(),
          })
        }
        assert.ok(
          scales.some((entry) => entry.cells > 0),
          'the dashboard rendered no heatmap cells on any scale',
        )
        return { scales }
      },
      page,
    )

    await check(
      'usage heatmap renders and all four scale switches work',
      async () => {
        await gotoRoute(page, '/usage')
        await waitForWorkspace(page)
        const region = page.locator('section[aria-labelledby="usage-calendar-title"]')
        await region.waitFor()
        const scaleGroup = page.locator('[aria-label="Heatmap time scale"]')
        await scaleGroup.waitFor()
        const buttons = scaleGroup.locator('button')
        assert.equal(await buttons.count(), 4, 'usage must expose four heatmap scales')
        const scales = []
        let renderedAny = false
        for (let index = 0; index < 4; index += 1) {
          const trend = page.waitForResponse(
            (candidate) =>
              new URL(candidate.url()).pathname === '/api/v1/usage/dashboard/trend' &&
              candidate.request().method() === 'GET',
            { timeout: 30_000 },
          )
          const logs = page.waitForResponse(
            (candidate) =>
              new URL(candidate.url()).pathname === '/api/v1/usage' &&
              candidate.request().method() === 'GET',
            { timeout: 30_000 },
          )
          await buttons.nth(index).click()
          assert.equal((await trend).status(), 200)
          assert.equal((await logs).status(), 200)
          await settle(page)
          assert.equal(await buttons.nth(index).getAttribute('aria-pressed'), 'true')
          const cells = await region.locator('[role="gridcell"]').count()
          // A real backend with no usage legitimately shows the empty state; a
          // backend with usage must render the grid. Either is accepted, but the
          // scale must have re-queried and settled into one of the two.
          const empty = await region
            .getByText('No usage data for this period')
            .isVisible()
            .catch(() => false)
          assert.ok(cells > 0 || empty, `usage scale ${index} rendered neither a grid nor an empty state`)
          if (cells > 0) renderedAny = true
          scales.push({ cells, empty })
        }
        report.usageHeatmapRendered = renderedAny
        assert.ok(
          (await page.locator('#usage-models-title').count()) > 0,
          'usage models section is missing',
        )
        assert.ok((await page.locator('#usage-logs-title').count()) > 0, 'usage logs section is missing')
        const models = await page
          .locator('section[aria-labelledby="usage-models-title"] tbody tr')
          .count()
        const logs = await page.locator('section[aria-labelledby="usage-logs-title"] tbody tr').count()
        assert.equal(
          await page.locator('.shell-content [role="alert"]').count(),
          0,
          'usage page renders an error alert',
        )
        const metrics = await assertNoOverflow(page, 'usage')
        await screenshot(page, 'usage')
        return { scales, models, logs, metrics, heatmapRendered: renderedAny }
      },
      page,
    )

    await check(
      'billing pages never claim a payment was made',
      async () => {
        if (!billingEnabled()) {
          await gotoRoute(page, '/purchase')
          await page
            .waitForURL((url) => url.pathname === '/dashboard', { timeout: 30_000 })
            .catch(() => {
              throw new Error(
                `/purchase did not redirect to /dashboard while billing is disabled; at ${redactUrl(page.url())}`,
              )
            })
          await waitForWorkspace(page)
          await assertNoPaidClaim(page, 'purchase (billing disabled)')
          await gotoRoute(page, '/orders')
          await page
            .waitForURL((url) => url.pathname === '/dashboard', { timeout: 30_000 })
            .catch(() => {
              throw new Error(
                `/orders did not redirect to /dashboard while billing is disabled; at ${redactUrl(page.url())}`,
              )
            })
          await waitForWorkspace(page)
          await assertNoPaidClaim(page, 'orders (billing disabled)')
          return { mode: 'disabled', purchase: 'redirected', orders: 'redirected' }
        }

        await gotoRoute(page, '/purchase')
        assert.equal(new URL(page.url()).pathname, '/purchase')
        await page.locator('h1').waitFor()
        await settle(page)
        const purchaseAlerts = await page.locator('.shell-content [role="alert"]').count()
        await assertNoPaidClaim(page, 'purchase')
        const purchaseMetrics = await assertNoOverflow(page, 'purchase')
        await screenshot(page, 'purchase')

        await gotoRoute(page, '/orders')
        assert.equal(new URL(page.url()).pathname, '/orders')
        await page.locator('h1').waitFor()
        await settle(page)
        const orderAlerts = await page.locator('.shell-content [role="alert"]').count()
        await assertNoPaidClaim(page, 'orders')
        const orderMetrics = await assertNoOverflow(page, 'orders')
        await screenshot(page, 'orders')
        return { mode: 'enabled', purchaseAlerts, orderAlerts, purchaseMetrics, orderMetrics }
      },
      page,
    )

    const uniqueKey = `ci-key-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const editedKey = `${uniqueKey}-edited`

    await check(
      'API key create, edit and delete persist against the real backend',
      async () => {
        await gotoRoute(page, '/keys')
        await waitForWorkspace(page)

        await page.getByRole('button', { name: 'Create key', exact: true }).click()
        const createDialog = page.locator('[role="dialog"]')
        await createDialog.waitFor()
        await createDialog.locator('input').first().fill(uniqueKey)
        const created = page.waitForResponse(
          (candidate) =>
            new URL(candidate.url()).pathname === '/api/v1/keys' &&
            candidate.request().method() === 'POST',
          { timeout: 30_000 },
        )
        await createDialog.getByRole('button', { name: 'Create', exact: true }).click()
        assert.equal((await created).status(), 200)
        // The one-time secret (when the backend returns one) is never screenshotted.
        await createDialog.getByRole('button', { name: 'Close', exact: true }).click()
        await createDialog.waitFor({ state: 'hidden' })

        const createdRow = await findKeyRow(page, uniqueKey)
        assert.ok(createdRow, 'the created key did not appear in the real key list')

        await createdRow.getByRole('button', { name: 'Edit', exact: true }).click()
        const editDialog = page.locator('[role="dialog"]')
        await editDialog.waitFor()
        await editDialog.locator('input').first().fill(editedKey)
        const updated = page.waitForResponse(
          (candidate) =>
            /\/api\/v1\/keys\/\d+$/.test(new URL(candidate.url()).pathname) &&
            candidate.request().method() === 'PUT',
          { timeout: 30_000 },
        )
        await editDialog.getByRole('button', { name: 'Save', exact: true }).click()
        assert.equal((await updated).status(), 200)
        await editDialog.waitFor({ state: 'hidden' })
        const editedRow = await findKeyRow(page, editedKey)
        assert.ok(editedRow, 'the edited key name did not persist')
        assert.ok(
          !(await keyRowNames(page)).includes(uniqueKey),
          'the pre-edit key name is still listed after a successful update',
        )

        await editedRow.getByRole('button', { name: 'Delete', exact: true }).click()
        const confirm = page.locator('[role="dialog"]')
        await confirm.waitFor()
        const deleted = page.waitForResponse(
          (candidate) =>
            /\/api\/v1\/keys\/\d+$/.test(new URL(candidate.url()).pathname) &&
            candidate.request().method() === 'DELETE',
          { timeout: 30_000 },
        )
        await confirm.getByRole('button', { name: 'Confirm', exact: true }).click()
        assert.equal((await deleted).status(), 200)
        await waitForKeyGone(page, editedKey)
        await screenshot(page, 'keys-after-delete')
        return { created: uniqueKey, edited: editedKey, deleted: true }
      },
      page,
    )

    await check(
      'profile username update persists and is reverted',
      async () => {
        await gotoRoute(page, '/profile')
        await waitForWorkspace(page)
        const form = page.locator('form.panel').first()
        await form.waitFor()
        const input = form.locator('input').first()
        const original = (await input.inputValue()).trim()
        // A backend that never stored a username still needs a deterministic
        // revert target; the generated CI email local part is unique per run.
        const revertTo = original || env.email.split('@')[0]
        const save = form.getByRole('button', { name: 'Save', exact: true })
        const unique = `cshell-${Date.now().toString(36)}`

        await input.fill(unique)
        let response = page.waitForResponse(
          (candidate) =>
            new URL(candidate.url()).pathname === '/api/v1/user' &&
            candidate.request().method() === 'PUT',
          { timeout: 30_000 },
        )
        await save.click()
        assert.equal((await response).status(), 200)
        await waitForSaved(page)
        assert.equal(await input.inputValue(), unique, 'the profile username was not applied')

        await input.fill(revertTo)
        response = page.waitForResponse(
          (candidate) =>
            new URL(candidate.url()).pathname === '/api/v1/user' &&
            candidate.request().method() === 'PUT',
          { timeout: 30_000 },
        )
        await save.click()
        assert.equal((await response).status(), 200)
        await waitForSaved(page)
        assert.equal(await input.inputValue(), revertTo, 'the profile username was not reverted')
        assert.equal(
          await page.locator('.shell-content [role="alert"]').count(),
          0,
          'profile page renders an error alert',
        )
        const metrics = await assertNoOverflow(page, 'profile')
        await screenshot(page, 'profile')
        return { updated: unique, revertedTo: revertTo, metrics }
      },
      page,
    )

    await check(
      'logout clears the session and protected routes redirect to login',
      async () => {
        await gotoRoute(page, '/dashboard')
        await waitForWorkspace(page)
        await page.locator('.account-menu__trigger').click()
        await page.locator('.account-menu').waitFor()
        await page.locator('.account-menu__logout').click()
        await page.waitForURL((url) => url.pathname === '/login', { timeout: 30_000 })
        await page.locator('form input[type="email"]').waitFor()
        assert.equal(
          await storageValue(page, 'auth_token'),
          null,
          'logout left an access token in storage',
        )
        assert.equal(await storageValue(page, 'auth_user'), null, 'logout left a user record in storage')

        await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' })
        await page.waitForURL((url) => url.pathname === '/login', { timeout: 30_000 })
        assert.equal(new URL(page.url()).pathname, '/login')
        await settle(page)
        assert.equal(await appShellCount(page), 0, 'a protected route still rendered the app shell')
        await screenshot(page, 'login-after-redirect')
      },
      page,
    )

    assert.equal(
      tracker.expected.length,
      0,
      'the user-flow tracker still holds an undeclared negative expectation',
    )
    await context.close()
  }

  /* ------------------------------------------------ desktop dark regression */

  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: 'en-US',
      timezoneId: 'UTC',
      colorScheme: 'light',
    })
    const page = await context.newPage()
    page.setDefaultTimeout(30_000)
    page.setDefaultNavigationTimeout(60_000)
    track(page, 'desktop-dark')
    await guardExternal(context)

    await check(
      'desktop dark: theme and locale switches persist across reloads',
      async () => {
        await loginAsUser(page)
        const themeButton = page.locator('.shell-sidebar .theme-toggle__button')
        await themeButton.waitFor()
        await themeButton.click()
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, {
          timeout: 15_000,
        })
        assert.equal(await storageValue(page, 'cshell_theme'), 'dark')
        await page.reload({ waitUntil: 'domcontentloaded' })
        await waitForWorkspace(page)
        await settle(page)
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')

        await chooseLocale(page, page.locator('.shell-sidebar'), '中文')
        await page.waitForFunction(() => document.documentElement.lang === 'zh')
        assert.equal(await storageValue(page, 'cshell_locale'), 'zh')
        await page.reload({ waitUntil: 'domcontentloaded' })
        await waitForWorkspace(page)
        await settle(page)
        assert.equal(await page.evaluate(() => document.documentElement.lang), 'zh')
        assert.equal(await storageValue(page, 'cshell_theme'), 'dark')
        const metrics = await assertNoOverflow(page, 'desktop dark dashboard')
        await screenshot(page, 'dashboard-dark-zh')
        return { metrics }
      },
      page,
    )

    await check(
      'desktop dark: section navigation and non-destructive routes',
      async () => {
        const nav = page.locator('.section-nav')
        await nav.waitFor()
        await nav.locator('a[href="/usage"]').click()
        await page.waitForURL((url) => url.pathname === '/usage', { timeout: 30_000 })
        await settle(page)
        const metrics = [await assertNoOverflow(page, 'desktop dark usage')]
        for (const route of ['/keys', '/profile', '/dashboard']) {
          await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' })
          await waitForWorkspace(page)
          await settle(page)
          assert.equal(new URL(page.url()).pathname, route)
          metrics.push(await assertNoOverflow(page, `desktop dark ${route}`))
        }
        assert.equal(
          await page.locator('.shell-content [role="alert"]').count(),
          0,
          'the desktop dark flow renders an error alert',
        )
        await screenshot(page, 'desktop-dark-keys')
        return { metrics }
      },
      page,
    )

    await context.close()
  }

  /* ------------------------------------------------------- mobile light flow */

  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: 'en-US',
      timezoneId: 'UTC',
      colorScheme: 'light',
      isMobile: true,
      hasTouch: true,
    })
    const page = await context.newPage()
    page.setDefaultTimeout(30_000)
    page.setDefaultNavigationTimeout(60_000)
    track(page, 'mobile-light')
    await guardExternal(context)

    await check(
      'mobile light: drawer navigation, theme and locale work',
      async () => {
        await loginAsUser(page)
        await page.getByRole('button', { name: 'Open navigation' }).click()
        const drawer = page.locator('aside.drawer')
        await drawer.waitFor()
        // The mobile flow must stay on the light theme, so prove the switch
        // persists in both directions and end where it started.
        await drawer.locator('.theme-toggle__button').click()
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, {
          timeout: 15_000,
        })
        assert.equal(await storageValue(page, 'cshell_theme'), 'dark')
        await drawer.locator('.theme-toggle__button').click()
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, {
          timeout: 15_000,
        })
        assert.equal(await storageValue(page, 'cshell_theme'), 'light')
        await chooseLocale(page, drawer, '中文')
        await page.waitForFunction(() => document.documentElement.lang === 'zh')
        assert.equal(await storageValue(page, 'cshell_locale'), 'zh')
        await drawer.locator('a[href="/usage"]').click()
        await page.waitForURL((url) => url.pathname === '/usage', { timeout: 30_000 })
        await drawer.waitFor({ state: 'hidden' })
        await settle(page)
        const metrics = [await assertNoOverflow(page, 'mobile usage')]
        await screenshot(page, 'mobile-usage-zh-light')

        for (const route of ['/dashboard', '/keys', '/profile']) {
          await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' })
          await waitForWorkspace(page)
          await settle(page)
          assert.equal(new URL(page.url()).pathname, route)
          metrics.push(await assertNoOverflow(page, `mobile ${route}`))
        }
        assert.equal(
          await page.locator('.shell-content [role="alert"]').count(),
          0,
          'the mobile flow renders an error alert',
        )
        await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' })
        await waitForWorkspace(page)
        await settle(page)
        await page.reload({ waitUntil: 'domcontentloaded' })
        await waitForWorkspace(page)
        await settle(page)
        assert.equal(
          await page.evaluate(() => document.documentElement.dataset.theme),
          'light',
          'the mobile light theme did not persist across a reload',
        )
        assert.equal(
          await page.evaluate(() => document.documentElement.lang),
          'zh',
          'the mobile locale did not persist across a reload',
        )
        await screenshot(page, 'mobile-dashboard-zh-light')
        return { metrics }
      },
      page,
    )

    await context.close()
  }

  /* -------------------------------------------------------- admin redirect */

  // The upstream admin UI is a separate application behind the same proxy. This
  // phase proves the redirect target and the absence of the user workspace only;
  // its own console/network noise is recorded in `adminDiagnostics`, not gated.
  {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: 'en-US',
      timezoneId: 'UTC',
    })
    const page = await context.newPage()
    page.setDefaultTimeout(30_000)
    page.setDefaultNavigationTimeout(60_000)
    track(page, 'admin', { gating: false, allowExternal: true })

    await check(
      'admin login redirects to the upstream /admin surface',
      async () => {
        await fillLogin(page, env.adminEmail, env.adminPassword)
        await page.locator('form button[type="submit"]').click()
        await page
          .waitForURL((url) => url.pathname === '/admin' || url.pathname.startsWith('/admin/'), {
            timeout: 60_000,
          })
          .catch(() => {
            throw new Error(
              `admin login did not redirect to the upstream /admin surface; at ${redactUrl(page.url())}`,
            )
          })
        await page.waitForLoadState('domcontentloaded').catch(() => {})
        await settle(page, 400)
        // Contract: confirm the redirect target and the absence of the user
        // workspace. The upstream admin UI itself is intentionally not crawled.
        assert.equal(
          await page.locator('.cshell-user-workspace').count(),
          0,
          'the admin session received the user workspace shell',
        )
        assert.equal(
          await page.locator('.cshell-public').count(),
          0,
          'the admin session received the public Cshell SPA',
        )
        const title = await page.title()
        await screenshot(page, 'admin-redirect')
        return { path: new URL(page.url()).pathname, title }
      },
      page,
    )

    await context.close()
  }
} catch (error) {
  report.failures.push({ name: 'runner', error: redactText(error?.stack || error) })
  console.error('GATE ERROR', error?.message || error)
} finally {
  await browser?.close().catch(() => {})
  await unlink(lockPath).catch(() => {})
  report.finishedAt = new Date().toISOString()
  report.passed =
    report.failures.length === 0 &&
    report.runtimeErrors.length === 0 &&
    report.consoleErrors.length === 0 &&
    report.requestFailures.length === 0 &&
    report.httpFailures.length === 0 &&
    report.unexpectedExternalRequests.length === 0 &&
    report.checks.length > 0 &&
    report.checks.every((entry) => entry.passed)

  await writeFile(resultsPath, JSON.stringify(report, null, 2))

  const summary = [
    '# Sub2API real-backend browser gate',
    '',
    `- base: ${report.base}`,
    `- upstream: ${report.upstream}`,
    `- browser: ${report.browser ?? 'not launched'}`,
    `- scope: ${report.scope}`,
    `- started: ${report.startedAt}`,
    `- finished: ${report.finishedAt}`,
    `- passed: ${report.passed}`,
    `- checks: ${report.checks.filter((entry) => entry.passed).length}/${report.checks.length}`,
    `- runtime errors: ${report.runtimeErrors.length}`,
    `- console errors: ${report.consoleErrors.length}`,
    `- failed requests: ${report.requestFailures.length}`,
    `- HTTP >= 400: ${report.httpFailures.length}`,
    `- unexpected external requests: ${report.unexpectedExternalRequests.length}`,
    `- tolerated stale usage aborts: ${report.toleratedStaleUsageAborts.length}`,
    `- expected negatives: ${report.expectedNegatives.length}`,
    `- admin UI diagnostics (not gated): ${report.adminDiagnostics.length}`,
    `- screenshots: ${report.screenshots.length}`,
    '',
    'Backend capabilities: ' +
      `registration_enabled=${report.settings?.registration_enabled}, ` +
      `payment_enabled=${report.settings?.payment_enabled}, ` +
      `subscription_enabled=${report.settings?.subscription_enabled}`,
    '',
    '## Checks',
    '',
    ...report.checks.map((entry) => `- ${entry.passed ? 'PASS' : 'FAIL'} ${entry.name}`),
    '',
    '## Failures',
    '',
    ...(report.failures.length
      ? report.failures.map((entry) => `- ${entry.name}: ${String(entry.error).split('\n')[0]}`)
      : ['- none']),
    '',
    '## Boundaries',
    '',
    '- No API route mocking, no fixtures, no mocked business responses.',
    '- Diagnostics track pageerror, console errors, failed requests and HTTP >= 400. Only',
    '  same-origin stale usage/trend GET aborts are tolerated, and expected negatives require an',
    '  exact method/path/status/count declared before they happen.',
    '- Passwords, access/refresh tokens, Authorization headers and token query parameters are',
    '  redacted and never written to the report, the summary or the logs. Session storage is',
    '  reported only as booleans.',
    '- The upstream admin UI is not crawled; its own diagnostics are recorded but out of scope.',
    '- No payment is attempted; billing assertions only prove that unconfigured pages never',
    '  claim a paid order.',
    '',
  ].join('\n')
  await writeFile(path.join(artifactsDir, 'summary.md'), summary)

  console.log(
    JSON.stringify({
      passed: report.passed,
      checks: report.checks.length,
      failures: report.failures.length,
      runtimeErrors: report.runtimeErrors.length,
      consoleErrors: report.consoleErrors.length,
      requestFailures: report.requestFailures.length,
      httpFailures: report.httpFailures.length,
      unexpectedExternalRequests: report.unexpectedExternalRequests.length,
      screenshots: report.screenshots.length,
      report: resultsPath,
      summary: path.join(artifactsDir, 'summary.md'),
    }),
  )
  if (!report.passed) process.exitCode = 1
}
