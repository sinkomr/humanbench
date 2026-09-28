/**
 * Smoke e2e of the hello page (ROADMAP M0.1, M1.A; DESIGN §13): the production build loads under
 * the Pages base path with every asset, shows the §13 disclaimer, passes the language lint as
 * rendered (A13, M1.20), and has no serious or critical axe violations in light or dark mode.
 * Also checks that the axe helper does fail on a page with known violations.
 */

import { expect, test } from '@playwright/test'
import { lintText } from '../scripts/language-lint'
import { DISCLAIMER, HEADING } from '../src/copy'
import { expectNoSeriousAxe, seriousAxeViolations } from './axe'

test.describe('hello page', () => {
  test('loads under /humanbench/ with every asset and no errors', async ({ page }) => {
    const problems: string[] = []
    page.on('response', (r) => {
      if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`)
    })
    page.on('requestfailed', (r) => problems.push(`failed ${r.url()}: ${r.failure()?.errorText ?? ''}`))
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`console error: ${m.text()}`)
    })

    const response = await page.goto('./', { waitUntil: 'networkidle' })
    expect(response?.status()).toBe(200)
    expect(new URL(page.url()).pathname).toBe('/humanbench/')
    await expect(page).toHaveTitle('HumanBench')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADING)
    expect(problems).toEqual([])
  })

  test('shows the §13 disclaimer in the footer landmark', async ({ page }) => {
    await page.goto('./')
    const footer = page.getByRole('contentinfo')
    await expect(footer).toBeVisible()
    await expect(footer).toHaveText(DISCLAIMER)
    await expect(footer.getByText(DISCLAIMER, { exact: true })).toBeVisible()
  })

  test('the rendered page passes the language lint (A13)', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(lintText(await page.content(), 'rendered.html')).toEqual([])
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`has no serious or critical axe violations (WCAG A/AA, ${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      await page.goto('./')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectNoSeriousAxe(page)
    })
  }
})

test.describe('axe helper', () => {
  test('reports and fails on serious violations', async ({ page }) => {
    await page.setContent(
      '<!doctype html><html lang="en"><head><title>bad</title></head><body><main>' +
        '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="10" height="10">' +
        '<p style="color:#999;background:#aaa">low contrast</p>' +
        '</main></body></html>',
    )
    const ids = (await seriousAxeViolations(page)).map((v) => v.id).sort()
    expect(ids).toEqual(['color-contrast', 'image-alt'])
    await expect(expectNoSeriousAxe(page)).rejects.toThrow(/image-alt/)
  })
})
