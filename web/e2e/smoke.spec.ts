/**
 * Smoke e2e of the start page (ROADMAP M0.1, M1.A, M1.15; DESIGN §13): the production build loads under
 * the Pages base path with every asset, shows the §13 disclaimer, passes the language lint as
 * rendered (A13, M1.20), and has no serious or critical axe violations in light or dark mode.
 * Also checks that the axe helper does fail on a page with known violations.
 */

import { expect, test } from '@playwright/test'
import { lintText } from '../scripts/language-lint'
import { DISCLAIMER, HEADING } from '../src/copy'
import { expectNoSeriousAxe, nonBlockingAxeViolations, seriousAxeViolations } from './axe'

test.describe('start page', () => {
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
    // Content-hashed asset names (assets/index-<hash>.js) are not copy, and a hash can spell a short
    // banned token between digits or "_" (the lint's letter boundaries), so they are dropped first.
    const html = (await page.content()).replace(/\/assets\/[^"'\s)]+/g, '/assets/')
    expect(html).toContain('/humanbench/assets/')
    expect(lintText(html, 'rendered.html')).toEqual([])
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
  test('reports and fails on serious violations of WCAG 2.0, 2.1 AA and 2.2 AA rules', async ({ page }) => {
    await page.setContent(
      '<!doctype html><html lang="en"><head><title>bad</title></head><body><main>' +
        // WCAG 2.0: image-alt (critical), color-contrast (serious).
        '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="10" height="10">' +
        '<p style="color:#999;background:#aaa">low contrast</p>' +
        // WCAG 2.1 AA (wcag21aa): autocomplete-valid.
        '<label>Name <input type="text" autocomplete="not-a-token"></label>' +
        // WCAG 2.2 AA (wcag22aa): target-size, two abutting 10 px buttons.
        '<div style="display:flex;gap:0"><button type="button" aria-label="one" style="width:10px;height:10px;padding:0;border:0;margin:0"></button>' +
        '<button type="button" aria-label="two" style="width:10px;height:10px;padding:0;border:0;margin:0"></button></div>' +
        '</main></body></html>',
    )
    const ids = (await seriousAxeViolations(page)).map((v) => v.id).sort()
    expect(ids).toEqual(['autocomplete-valid', 'color-contrast', 'image-alt', 'target-size'])
    await expect(expectNoSeriousAxe(page)).rejects.toThrow(/image-alt/)
  })

  test('reports and fails on the serious best-practice rules too, which carry no WCAG tag', async ({ page }) => {
    await page.setContent(
      '<!doctype html><html lang="en"><head><title>bad</title></head><body><main>' +
        // tabindex (serious): a positive tabindex breaks the natural focus order.
        '<button type="button" tabindex="3">Press</button>' +
        // label-title-only (serious): a field named only by its title.
        '<input type="text" title="Your name">' +
        // aria-dialog-name (serious): a dialog nobody can name.
        '<div role="dialog"><p>Hello</p></div>' +
        '</main></body></html>',
    )
    const ids = (await seriousAxeViolations(page)).map((v) => v.id).sort()
    expect(ids).toEqual(['aria-dialog-name', 'label-title-only', 'tabindex'])
    await expect(expectNoSeriousAxe(page)).rejects.toThrow(/tabindex/)
    // They are not also reported as the lesser kind.
    expect((await nonBlockingAxeViolations(page)).map((v) => v.id)).not.toEqual(expect.arrayContaining(['tabindex']))
  })
})
