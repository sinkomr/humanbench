/// <reference lib="dom" />
/**
 * Letter series of any rule family (series generator 1.5.0; DESIGN §4.2 "Series") in real browsers,
 * on the dev-only visual gallery (`render-visual.html?family=series&seed=…@s<k>`, which draws a
 * series item of a requested stratum by seed; the review page shows only the natural review seeds,
 * which never hold a letter template). A stratum-4 seed (two alternating steps on letters) and a
 * stratum-6 seed (a cycle of three ops on letters): the letters are drawn, the next letter is typed
 * and submitted by keyboard alone, the page has no horizontal scrolling at 320 px with the
 * wide-font simulation, and axe finds no serious or critical issue in either theme.
 */

import { expect, test, type Page } from '@playwright/test'
import { expectNoSeriousAxe } from './axe'
import { visualGalleryUrl } from './dev-server'
import { tabTo } from './keyboard'
import { expectWideFont, useWideFont } from './wide-font'

/** Letter-template seeds of requested strata 4 and 6 (5 and 7 letters shown). */
const SEEDS = [
  { seed: 'e2e-letters-3@s4', terms: 5 },
  { seed: 'e2e-letters-1@s6', terms: 7 },
] as const

async function openSeries(page: Page, seed: string): Promise<void> {
  await useWideFont(page)
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto(visualGalleryUrl({ family: 'series', seed }))
  await expectWideFont(page)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.locator('#shown-0')).toHaveText('Shown', { timeout: 30_000 })
}

test.describe('letter series of any rule family at 320 px', () => {
  for (const { seed, terms } of SEEDS) {
    test(`${seed}: draws the letters, takes a typed letter by keyboard, no horizontal scrolling`, async ({ page, browserName }) => {
      await openSeries(page, seed)
      const series = page.locator('.series')
      await expect(series.getByText('Which letter comes next in this sequence?')).toBeVisible()
      const shown = await series.locator('.term:not(.next)').allInnerTexts()
      expect(shown).toHaveLength(terms)
      for (const t of shown) expect(t.trim()).toMatch(/^[A-Z]$/)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)

      // Keyboard only: Tab to the entry, type a lower-case letter, Enter submits it as typed.
      const entry = page.getByRole('textbox', { name: 'Next letter', exact: true })
      await tabTo(page, entry, browserName)
      await page.keyboard.type('q')
      await page.keyboard.press('Enter')
      await expect(page.locator('#response-0')).toHaveText('q')
      await expect(series.getByText('Answer recorded.')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
    })
  }

  test('a digit is not taken as a letter answer', async ({ page, browserName }) => {
    await openSeries(page, SEEDS[0].seed)
    await tabTo(page, page.getByRole('textbox', { name: 'Next letter', exact: true }), browserName)
    await page.keyboard.type('7')
    await page.keyboard.press('Enter')
    await expect(page.locator('#response-0')).toHaveText('none yet')
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`has no serious or critical axe violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      for (const { seed } of SEEDS) {
        await openSeries(page, seed)
        await expectNoSeriousAxe(page)
      }
    })
  }
})
