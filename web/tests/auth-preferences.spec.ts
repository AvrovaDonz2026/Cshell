import { describe, expect, it } from 'vitest'
import { chromium, type Page } from 'playwright'

const baseURL = process.env.AUTH_TEST_BASE_URL || 'http://127.0.0.1:18080'
const desktopViewports = [320, 390, 820, 1440].map((width) => ({ width, height: 900 }))
const mobileLandscape = { width: 844, height: 390 }

async function setLocale(page: Page, locale: 'en' | 'zh'): Promise<void> {
  const trigger = page.locator('.auth-header__prefs .cshell-select__trigger')
  const currentLabel = (await trigger.innerText()).trim()
  if ((locale === 'en' && currentLabel === 'English') || (locale === 'zh' && currentLabel === '中文')) return
  await trigger.click()
  await page.getByRole('option', { name: locale === 'en' ? 'English' : '中文' }).click()
  const selectedLabel = (await trigger.innerText()).trim()
  if (selectedLabel !== (locale === 'en' ? 'English' : '中文')) {
    throw new Error(`Locale switch did not select ${locale}: ${selectedLabel}`)
  }
}

async function verifyLocaleMenu(page: Page, selector: string, centered: boolean, label: string): Promise<void> {
  const trigger = page.locator(selector)
  await trigger.waitFor({ state: 'visible' })
  const before = await trigger.innerText()
  const beforeAlignment = await trigger.evaluate((element) => getComputedStyle(element).textAlign)
  expect(beforeAlignment, `${label} trigger alignment`).toBe(centered ? 'center' : 'left')
  const target = before.trim() === 'English' ? '中文' : 'English'
  await trigger.click()
  const option = page.getByRole('option', { name: target })
  await option.waitFor({ state: 'visible' })
  const optionAlignment = await option.evaluate((element) => getComputedStyle(element).textAlign)
  const optionRect = await option.boundingBox()
  const triggerRect = await trigger.boundingBox()
  expect(['left', 'start'], `${label} option alignment`).toContain(optionAlignment)
  expect(optionRect?.height, `${label} option hit target`).toBeGreaterThanOrEqual(44)
  expect(triggerRect?.height, `${label} trigger hit target`).toBeGreaterThanOrEqual(44)
  await option.click()
  if ((await trigger.innerText()).trim() !== target) throw new Error(`${label} locale did not switch to ${target}`)
}

describe('locale preference geometry', () => {
  it('centers the header trigger, keeps options left, and toggles locales', async () => {
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
      await page.goto(`${baseURL}/login`)
      await page.addStyleTag({ content: '.locale-switcher--header .cshell-select__trigger { text-align: center !important; } .locale-switcher--header .cshell-select__option { text-align: left !important; }' })
      await page.locator('.auth-content').waitFor()
      await verifyLocaleMenu(page, '.auth-header__prefs .cshell-select__trigger', true, 'auth header')
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, 'auth header overflow').toBeLessThanOrEqual(0)

      await page.goto(baseURL)
      await page.evaluate(() => localStorage.removeItem('auth_token'))
      await page.reload()
      await page.addStyleTag({ content: '.locale-switcher--header .cshell-select__trigger { text-align: center !important; } .locale-switcher--header .cshell-select__option { text-align: left !important; }' })
      const homeTrigger = page.locator('.site-header__prefs .cshell-select__trigger')
      await homeTrigger.waitFor()
      await verifyLocaleMenu(page, '.site-header__prefs .cshell-select__trigger', false, 'standalone header')
      const homeOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(homeOverflow, 'standalone header overflow').toBeLessThanOrEqual(0)
    } finally {
      await browser.close()
    }
  }, 60000)
})

describe('centered auth layout', () => {
  for (const path of ['/login', '/register', '/email-verify']) {
    for (const locale of ['en', 'zh'] as const) {
      it(`${path} meets the layout contract in ${locale}`, async () => {
        const browser = await chromium.launch({ headless: true })
        try {
          const page = await browser.newPage()
          await page.goto(`${baseURL}${path}`)
          await page.locator('.auth-content').waitFor()
          for (const viewport of [...desktopViewports, mobileLandscape]) {
            await page.setViewportSize(viewport)
            await setLocale(page, locale)
            const result = await page.evaluate(() => {
              const brand = document.querySelector<HTMLElement>('.auth-header__brand')!.getBoundingClientRect()
              const prefs = document.querySelector<HTMLElement>('.auth-header__prefs')!.getBoundingClientRect()
              const content = document.querySelector<HTMLElement>('.auth-content')!.getBoundingClientRect()
              return {
                brand: { left: brand.left, right: brand.right, top: brand.top, bottom: brand.bottom },
                prefs: { left: prefs.left, right: prefs.right, top: prefs.top, bottom: prefs.bottom },
                content: { left: content.left, right: content.right, width: content.width },
                headings: [...document.querySelectorAll<HTMLElement>('h1')].filter((heading) => {
                  const style = getComputedStyle(heading)
                  const rect = heading.getBoundingClientRect()
                  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
                }).length,
                viewport: document.documentElement.clientWidth,
                scroll: document.documentElement.scrollWidth,
              }
            })
            const label = `${path} ${locale} at ${viewport.width}x${viewport.height}`
            expect(result.headings, label).toBe(1)
            expect(result.content.width, label).toBeLessThanOrEqual(380)
            expect(result.content.width, label).toBeGreaterThan(0)
            expect(Math.abs((result.content.left + result.content.right) / 2 - result.viewport / 2), label).toBeLessThanOrEqual(1)
            expect(result.prefs.left, label).toBeGreaterThanOrEqual(result.brand.right)
            expect(result.prefs.right, label).toBeLessThanOrEqual(result.viewport)
            const verticallyOverlaps = result.brand.top < result.prefs.bottom && result.prefs.top < result.brand.bottom
            const horizontallyOverlaps = result.brand.left < result.prefs.right && result.prefs.left < result.brand.right
            expect(verticallyOverlaps && horizontallyOverlaps, label).toBe(false)
            expect(result.scroll, label).toBeLessThanOrEqual(result.viewport)
          }
        } finally {
          await browser.close()
        }
      }, 60000)
    }
  }
})
