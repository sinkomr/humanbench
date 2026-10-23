/// <reference lib="dom" />
/**
 * figure2d items (2D figures turned in the plane or mirrored in a dashed line; DESIGN §3 row 7, §4.2, §13) in real
 * browsers, on the dev-only visual gallery (`render-visual.html`). For a hard rotate item (11 squares, tilted options)
 * and a hard mirror item (a diagonal mirror line): the target and four option figures are drawn with every square, the
 * keyboard alone answers (a digit picks, Enter sends the display position), and at 320 px wide with the wide-font
 * simulation the figures keep a usable size and the page has no horizontal scrolling; axe finds no serious or critical
 * issue in either theme.
 */

import { expect, test, type Page } from '@playwright/test'
import { expectNoSeriousAxe } from './axe'
import { visualGalleryUrl } from './dev-server'
import { expectWideFont, useWideFont } from './wide-font'

/** Stratum-6 seeds: a rotate item (options tilted 60° / −30°) and a mirror item (the bottom-left–top-right diagonal). */
const ITEMS = [
  { task: 'rotate', seed: 'e2e-f2d-1@s6' },
  { task: 'mirror', seed: 'e2e-f2d-2@s6' },
] as const

async function open(page: Page, seed: string, width = 320): Promise<void> {
  await useWideFont(page)
  await page.setViewportSize({ width, height: 900 })
  await page.goto(visualGalleryUrl({ family: 'figure2d', seed }))
  await expectWideFont(page)
  await expect(page.locator('#shown-0')).toHaveText('Shown', { timeout: 30_000 })
}

for (const { task, seed } of ITEMS) {
  test.describe(`figure2d ${task} item`, () => {
    test('draws the target and four options with all their squares, and the page does not scroll sideways at 320 px', async ({ page }) => {
      await open(page, seed)
      const target = page.locator('.figure2d .target svg')
      await expect(target).toHaveAttribute('role', 'img')
      await expect(target).toHaveAttribute('aria-label', /^Target figure: \d+ squares\. Row 1: /)
      const n = Number((/(\d+) squares/.exec((await target.getAttribute('aria-label')) ?? '') ?? [])[1])
      await expect(target.locator('rect.square')).toHaveCount(n)
      if (task === 'mirror') await expect(target.locator('line.mirror-line')).toHaveCount(1)
      const options = page.locator('.figure2d form label svg')
      await expect(options).toHaveCount(4)
      for (let i = 0; i < 4; i++) await expect(options.nth(i).locator('rect.square')).toHaveCount(n)
      const widths = await options.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))
      for (const w of widths) expect(w).toBeGreaterThanOrEqual(100)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
      await expect(page.getByRole('radio')).toHaveCount(4)
      await expect(page.getByRole('radio').first()).toHaveAccessibleName(/^Option A: \d+ squares/)
    })

    test('answers with the keyboard alone: a digit picks an option, Enter sends its display position', async ({ page }) => {
      await open(page, seed, 1024)
      await page.getByRole('radio').first().focus()
      await page.keyboard.press('3')
      await expect(page.getByRole('radio').nth(2)).toBeChecked()
      await page.keyboard.press('Enter')
      await expect(page.locator('#response-0')).toHaveText('2')
    })

    for (const colorScheme of ['light', 'dark'] as const) {
      test(`has no serious or critical axe violations (${colorScheme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme })
        await open(page, seed)
        await expectNoSeriousAxe(page)
      })
    }
  })
}
