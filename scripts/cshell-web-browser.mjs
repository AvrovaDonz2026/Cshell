#!/usr/bin/env node
/**
 * Strict Playwright acceptance for the independent web/ preview.
 * Default WORKSPACE_URL=http://127.0.0.1:4284 (distinct from historical 4184).
 */
import { createRequire } from 'node:module'
import { mkdir, writeFile, open, unlink, readFile, readdir, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { user } from './cshell-web-fixture.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const webPkg = path.join(root, 'web/package.json')

async function loadPlaywright() {
  try {
    await access(webPkg, fsConstants.R_OK)
    const require = createRequire(webPkg)
    return require('playwright')
  } catch {
    throw new Error(
      'playwright not found under web/; install web deps or set WORKSPACE_CHROME to a local Chrome binary',
    )
  }
}

const { chromium } = await loadPlaywright()
const smoke = process.argv.includes('--smoke')
const base = process.env.WORKSPACE_URL || process.env.CSHELL_WEB_URL || 'http://127.0.0.1:4284'
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)) {
  throw new Error('Acceptance only permits loopback previews')
}

const dir = fileURLToPath(
  new URL(
    smoke ? '../artifacts/cshell-web/diagnostic/' : '../artifacts/cshell-web/acceptance/',
    import.meta.url,
  ),
)
await mkdir(dir, { recursive: true })

async function sourceDigest() {
  const srcRoot = path.join(root, 'web/src')
  const hash = createHash('sha256')
  const names = (await readdir(srcRoot, { recursive: true })).sort()
  for (const name of names) {
    if (!/\.(vue|ts|css)$/.test(name)) continue
    hash.update(name)
    hash.update(await readFile(path.join(srcRoot, name)))
  }
  return hash.digest('hex')
}

const sourceAtStart = await sourceDigest()
const report = {
  scope: smoke
    ? 'diagnostic smoke only; not complete acceptance'
    : 'full acceptance matrix — independent web/',
  startedAt: new Date().toISOString(),
  sourceAtStart,
  base,
  fixture: 'deterministic local mock; not upstream acceptance',
  checks: [],
  failures: [],
  runtimeErrors: [],
  consoleErrors: [],
  requestFailures: [],
  httpFailures: [],
  screenshots: [],
  exclusions: [
    'Real payments',
    'OAuth providers',
    'Real authentication',
    'Production data',
  ],
}

const lockPath = path.join(root, 'artifacts/cshell-web/browser.lock')
try {
  const lock = await open(lockPath, 'wx')
  await lock.writeFile(String(process.pid))
  await lock.close()
} catch (e) {
  if (e.code !== 'EEXIST') throw e
  const pid = Number(await readFile(lockPath, 'utf8'))
  let alive = true
  try {
    process.kill(pid, 0)
  } catch {
    alive = false
  }
  if (alive) throw new Error(`Another cshell-web browser owns acceptance: ${pid}`)
  await unlink(lockPath)
  const lock = await open(lockPath, 'wx')
  await lock.writeFile(String(process.pid))
  await lock.close()
}

let browser
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    await browser?.close()
    await unlink(lockPath).catch(() => {})
    process.exit(128 + (signal === 'SIGTERM' ? 15 : 2))
  })
}

await writeFile(
  path.join(dir, 'results.json'),
  JSON.stringify({ ...report, inProgress: true, passed: false }, null, 2),
)

const chromePath = process.env.WORKSPACE_CHROME || process.env.CSHELL_WEB_CHROME
const launchOpts = {
  headless: true,
  args: ['--no-sandbox'],
}
if (chromePath) {
  try {
    await access(chromePath, fsConstants.X_OK)
    launchOpts.executablePath = chromePath
  } catch {
    console.warn('WORKSPACE_CHROME not executable; falling back to Playwright Chromium')
  }
}

try {
  browser = await chromium.launch(launchOpts)
} catch (e) {
  report.failures.push({ name: 'browser launch', error: e.stack })
  report.passed = false
  await unlink(lockPath).catch(() => {})
  await writeFile(path.join(dir, 'results.json'), JSON.stringify(report, null, 2))
  throw e
}

const flush = async () =>
  writeFile(path.join(dir, 'results.json'), JSON.stringify({ ...report, inProgress: true }, null, 2))

const track = (page) => {
  page.on('pageerror', (e) => report.runtimeErrors.push({ url: page.url(), error: e.stack }))
  page.on('console', (m) => {
    if (m.type() === 'error') report.consoleErrors.push({ url: page.url(), error: m.text() })
  })
  page.on('requestfailed', (req) => {
    const error = req.failure()?.errorText || ''
    if (error === 'net::ERR_ABORTED' && req.isNavigationRequest()) return
    report.requestFailures.push({ url: req.url(), error })
  })
  page.on('response', (res) => {
    if (res.status() >= 400) report.httpFailures.push({ url: res.url(), status: res.status() })
  })
}

async function check(name, fn) {
  try {
    const details = await fn()
    report.checks.push({ name, passed: true, ...details })
    console.log('PASS', name)
  } catch (e) {
    report.failures.push({ name, error: e.stack })
    report.checks.push({ name, passed: false })
    console.error('FAIL', name, e.message)
  } finally {
    await flush()
  }
}

async function contextFor({
  width = 1440,
  height = 1000,
  theme = 'light',
  system = 'light',
  role = 'user',
} = {}) {
  const resolvedTheme = theme === 'system' ? system : theme
  const ctx = await browser.newContext({
    viewport: { width, height },
    colorScheme: system,
    locale: 'en-US',
    timezoneId: 'UTC',
  })
  await ctx.addInitScript(
    ({ themeMode, role, user }) => {
      localStorage.setItem('cshell_theme', themeMode)
      localStorage.setItem('cshell_locale', 'en')
      if (role !== 'guest') {
        localStorage.setItem('auth_token', `local-mock-${role}`)
        localStorage.setItem('refresh_token', 'local-mock-refresh')
        localStorage.setItem('auth_user', JSON.stringify({ ...user, role }))
        localStorage.setItem('token_expires_at', String(Date.now() + 86_400_000))
      }
    },
    { themeMode: resolvedTheme, role, user },
  )
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url())
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) &&
      !['data:', 'blob:'].includes(u.protocol)
    ) {
      report.requestFailures.push({ url: u.href, error: 'External request forbidden' })
      await route.abort()
    } else {
      await route.continue()
    }
  })
  return ctx
}

async function navigate(page, route) {
  await page.goto(base + route, { waitUntil: 'networkidle', timeout: 120_000 })
  await page.locator('#cshell-web-mock-label').waitFor({ timeout: 30_000 })
}

/** Warm paper palette from web/src/styles/theme.css */
const palette = {
  light: {
    paper: 'rgb(244, 239, 230)',
    surface: 'rgb(255, 249, 240)',
    ink: 'rgb(44, 36, 28)',
  },
  dark: {
    paper: 'rgb(28, 24, 20)',
    surface: 'rgb(46, 38, 31)',
    ink: 'rgb(243, 232, 218)',
  },
}

async function painted(locator, theme, kind = 'surface') {
  await locator.waitFor({ state: 'visible' })
  const expected = palette[theme][kind]
  await locator.evaluate(
    (el, expectedColor) =>
      new Promise((resolve, reject) => {
        const start = performance.now()
        const sample = () => {
          if (getComputedStyle(el).backgroundColor === expectedColor) return resolve()
          if (performance.now() - start > 2500) {
            return reject(
              new Error(
                `Computed surface did not settle to ${expectedColor}; got ${getComputedStyle(el).backgroundColor}`,
              ),
            )
          }
          requestAnimationFrame(sample)
        }
        sample()
      }),
    expected,
  )
  const actual = await locator.evaluate((el) => {
    const s = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      background: s.backgroundColor,
      color: s.color,
      width: r.width,
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      viewport: innerWidth,
      height: innerHeight,
    }
  })
  assert.equal(actual.background, expected, `Computed ${kind} theme: ${JSON.stringify(actual)}`)
  assert.ok(actual.left >= -1 && actual.right <= actual.viewport + 1, 'Surface exceeds viewport')
  return actual
}

async function state(page, expectedTheme, workspace = true) {
  const result = await page.evaluate(() => ({
    route: location.pathname,
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    theme: document.documentElement.dataset.theme,
    workspace: !!document.querySelector('.cshell-user-workspace'),
    background: getComputedStyle(
      document.querySelector('.cshell-user-workspace') || document.body,
    ).backgroundColor,
  }))
  assert.ok(
    result.scrollWidth <= result.width + 1,
    `Viewport overflow: ${JSON.stringify(result)}`,
  )
  if (workspace) {
    assert.equal(result.theme, expectedTheme, 'Theme mismatch')
    assert.equal(result.workspace, true, 'Expected user workspace class')
    const shell = page.locator('.cshell-user-workspace').first()
    result.computed = await painted(shell, expectedTheme, 'paper')
    assert.equal(result.computed.color, palette[expectedTheme].ink, 'Computed workspace ink')
  } else {
    assert.equal(result.workspace, false, 'Workspace isolation mismatch')
  }
  return result
}

async function screenshot(page, name) {
  const file = `${name}.png`
  await page.screenshot({ path: path.join(dir, file), fullPage: true })
  report.screenshots.push(file)
}

const userRoutes = [
  '/dashboard',
  '/usage',
  '/keys',
  '/purchase',
  '/orders',
  '/profile',
  '/subscriptions',
]

try {
  const reset = await fetch(`${base}/__cshell_web/reset`, { method: 'POST' })
  assert.ok(reset.ok, 'fixture reset failed')

  // Theme store is light|dark only (no system preference mode). Cover light/dark
  // against opposite OS colorScheme; optional system rows resolve via that OS scheme.
  const themeMatrix = smoke
    ? [['light', 'dark']]
    : [
        ['light', 'dark'],
        ['dark', 'light'],
        ['system', 'light'],
        ['system', 'dark'],
      ]
  const devices = smoke
    ? [['desktop', 1440, 1000]]
    : [
        ['desktop', 1440, 1000],
        ['tablet', 820, 1180],
        ['phone', 390, 844],
      ]

  for (const [device, width, height] of devices) {
    for (const [theme, system] of themeMatrix) {
      const resolved = theme === 'system' ? system : theme
      const label = `${device}-${theme}${theme === 'system' ? `-${system}` : ''}`
      const ctx = await contextFor({ width, height, theme, system })
      const page = await ctx.newPage()
      page.setDefaultTimeout(15_000)
      track(page)

      await page.goto(`${base}/dashboard`, { waitUntil: 'networkidle', timeout: 120_000 })
      await page.locator('main').waitFor({ timeout: 120_000 })

      for (const route of userRoutes) {
        await check(`${label} ${route}`, async () => {
          await navigate(page, route)
          assert.equal(new URL(page.url()).pathname, route)
          const s = await state(page, resolved)
          if (route === '/dashboard' || route === '/usage') {
            await screenshot(page, `${label}-${route.slice(1)}`)
          }
          return s
        })
      }

      await check(`${label} long key dialog and nested dropdown`, async () => {
        await page.setViewportSize({ width, height: 560 })
        await navigate(page, '/keys')
        const trigger = page.getByRole('button', { name: 'Create key', exact: true })
        await trigger.click()
        const dialog = page.getByRole('dialog')
        await dialog.waitFor()
        await dialog.locator('input').first().fill(
          'Browser acceptance local key — 模型分析 '.repeat(4),
        )
        const panel = await painted(dialog, resolved)
        assert.ok(panel.top >= -1 && panel.bottom <= panel.height + 1, 'Dialog outside viewport')

        await dialog.locator('.cshell-select__trigger').click()
        const menu = page.getByRole('listbox')
        await menu.waitFor()
        const style = await painted(menu, resolved)
        await page.keyboard.press('Escape')
        await menu.waitFor({ state: 'hidden' })
        assert.ok(await dialog.isVisible(), 'First Escape closed parent dialog')

        await dialog.locator('.cshell-select__trigger').click()
        await menu.waitFor()
        await page
          .getByRole('option')
          .filter({ hasText: 'Research · long-context models' })
          .click({ force: true })
        await screenshot(page, `${label}-key-dialog`)
        await state(page, resolved)
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'hidden' })
        await page.setViewportSize({ width, height })
        return { panel, menu: style }
      })

      await page.setViewportSize({ width, height })

      await check(`${label} billing inline confirmation`, async () => {
        await navigate(page, '/purchase')
        await page.getByRole('button', { name: /Subscribe Now/i }).first().click()
        await page.getByRole('button', { name: /Confirm Payment/i }).waitFor()
        await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor()
        const confirm = page.getByLabel('Confirm subscription')
        assert.ok(
          await confirm.getByText('Research monthly · local mock', { exact: true }).isVisible(),
        )
        // Confirm panel uses accent-soft, not solid surface — assert workspace paper instead.
        await state(page, resolved)
        await screenshot(page, `${label}-billing-confirm`)
        await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      })

      if (width < 860 && theme === 'light') {
        await check(`${label} drawer keyboard`, async () => {
          await navigate(page, '/dashboard')
          const trigger = page.getByRole('button', { name: 'Open navigation' })
          await trigger.click()
          const drawer = page.locator('aside.drawer, aside[role="dialog"]').first()
          await drawer.waitFor({ state: 'visible' })
          await page.keyboard.press('Escape')
          await drawer.waitFor({ state: 'hidden' })
          assert.ok(
            await trigger.evaluate((el) => el === document.activeElement),
            'Drawer did not restore focus',
          )
        })
      }

      await ctx.close()
    }
  }

  {
    const ctx = await contextFor()
    const page = await ctx.newPage()
    page.setDefaultTimeout(15_000)
    track(page)

    await check('key creation POST persists local fixture', async () => {
      await navigate(page, '/keys')
      await page.getByRole('button', { name: 'Create key', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      await dialog.locator('input').first().fill('Acceptance created local key')
      await dialog.locator('.cshell-select__trigger').click()
      await page
        .getByRole('option')
        .filter({ hasText: 'Research · long-context models' })
        .click({ force: true })
      const response = page.waitForResponse(
        (r) => r.url().includes('/api/v1/keys') && r.request().method() === 'POST',
      )
      await dialog.getByRole('button', { name: 'Create', exact: true }).click()
      assert.equal((await response).status(), 200)
      await page.getByText('Acceptance created local key', { exact: true }).waitFor()
    })

    await check('heatmap four scales with actual populated cells', async () => {
      await navigate(page, '/usage')
      const buttons = page.locator('[aria-label="Heatmap time scale"] button')
      assert.equal(await buttons.count(), 4)
      const scales = []
      for (let i = 0; i < 4; i++) {
        await buttons.nth(i).click()
        await page.waitForLoadState('networkidle')
        const region = page.locator('[aria-labelledby="usage-calendar-title"]')
        await region.locator('[role="status"]').waitFor({ state: 'hidden' }).catch(() => {})
        assert.equal(await buttons.nth(i).getAttribute('aria-pressed'), 'true')
        const cells = region.locator('button[aria-label]')
        const count = await cells.count()
        assert.ok(count > 0, 'Missing heatmap cells')
        const populated = await cells.evaluateAll(
          (elements) =>
            elements.filter((el) => el.getAttribute('aria-label')?.includes('requests;')).length,
        )
        assert.ok(populated > 0, 'No actual populated heatmap cells')
        if (i === 0) assert.equal(count, 24, 'Hourly heatmap requires 24 cells')
        scales.push({
          label: await buttons.nth(i).innerText(),
          cells: count,
          populated,
        })
        await state(page, 'light')
      }
      await screenshot(page, 'usage-multiyear')
      return { scales }
    })

    await ctx.close()
  }

  for (const role of ['admin', 'guest']) {
    for (const theme of ['light', 'dark']) {
      const ctx = await contextFor({ role, theme })
      const page = await ctx.newPage()
      page.setDefaultTimeout(15_000)
      track(page)

      for (const route of ['/keys', '/profile']) {
        await check(`${role} ${theme} ${route} excluded`, async () => {
          // Admin assigns /admin (full navigation); guest goes to /login.
          // Do not wait for workspace main — neither role should keep it.
          await page.goto(base + route, { waitUntil: 'networkidle', timeout: 120_000 })
          await page.locator('#cshell-web-mock-label').waitFor({ timeout: 30_000 })
          if (role === 'guest') {
            assert.equal(new URL(page.url()).pathname, '/login')
            await state(page, theme, true) // login page still uses workspace class for theming
            // Guest login is themed with workspace class; assert not authenticated shell main.
            assert.ok(
              !(await page.locator('.app-shell').count()),
              'Guest must not see authenticated app shell',
            )
          } else {
            assert.equal(new URL(page.url()).pathname, '/admin')
            assert.ok(
              !(await page.locator('.cshell-user-workspace').count()),
              'Admin must not receive user workspace class',
            )
            await screenshot(page, `${role}-${theme}-${route.slice(1)}`)
          }
        })
      }

      if (role === 'guest') {
        await check(`guest ${theme} dummy login`, async () => {
          await page.goto(`${base}/login`, { waitUntil: 'networkidle', timeout: 120_000 })
          await page.locator('input[type="email"]').fill('cshell-web-fixture@example.invalid')
          await page.locator('input[type="password"]').fill('local-only-not-real')
          await page.locator('button[type="submit"]').click()
          await page.waitForURL('**/dashboard')
          await page.waitForLoadState('networkidle')
          await state(page, theme, true)
        })
      }

      await ctx.close()
    }
  }

  await check('fixture coverage and no unknown endpoints', async () => {
    const health = await fetch(`${base}/__cshell_web/health`)
    assert.ok(health.ok)
    const fixture = await (await fetch(`${base}/__cshell_web/report`)).json()
    report.fixtureUnexpected = fixture.data.unexpected
    report.fixtureRequests = fixture.data.requests
    assert.equal(fixture.data.unexpected.length, 0, 'Unhandled fixture endpoints')
  })
} catch (e) {
  report.failures.push({ name: 'runner', error: e.stack })
} finally {
  report.sourceAtEnd = await sourceDigest()
  if (report.sourceAtStart !== report.sourceAtEnd) {
    report.failures.push({
      name: 'web source stability',
      error: 'web/src changed during acceptance; rerun after edits settle',
    })
  }
  await browser.close()
  await unlink(lockPath).catch(() => {})
  report.finishedAt = new Date().toISOString()
  report.passed =
    report.failures.length === 0 &&
    report.runtimeErrors.length === 0 &&
    report.consoleErrors.length === 0 &&
    report.requestFailures.length === 0 &&
    report.httpFailures.length === 0 &&
    (report.fixtureUnexpected?.length ?? 0) === 0
  await writeFile(path.join(dir, 'results.json'), JSON.stringify(report, null, 2))
  console.log(
    JSON.stringify({
      passed: report.passed,
      checks: report.checks.length,
      failures: report.failures.length,
      runtimeErrors: report.runtimeErrors.length,
      consoleErrors: report.consoleErrors.length,
      requestFailures: report.requestFailures.length,
      httpFailures: report.httpFailures.length,
      report: path.join(dir, 'results.json'),
    }),
  )
  if (!report.passed) process.exitCode = 1
}

void webPkg
