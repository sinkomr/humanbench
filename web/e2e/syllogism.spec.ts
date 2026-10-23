/// <reference lib="dom" />
/**
 * syllogism items (formal deduction: syllogisms, chains, conditionals; DESIGN §3 row 2, §4.2, §13) in real browsers,
 * on the dev-only visual gallery (`render-visual.html`). For an easy item and a hard one (a long chain or a
 * four-statement conditional): the statements are a named numbered list, the question and five text options are
 * shown, the keyboard alone answers (a digit picks, Enter sends the display position), and at 320 px wide with the
 * wide-font simulation the text wraps and the page has no horizontal scrolling; axe finds no serious or critical issue
 * in either theme.
 */

import { expect, test, type Page } from '@playwright/test'
import { expectNoSeriousAxe } from './axe'
import { visualGalleryUrl } from './dev-server'
import { expectWideFont, useWideFont } from './wide-font'

const ITEMS = [
  { level: 'easy', seed: 'e2e-syl-1@s1' },
  { level: 'hard', seed: 'e2e-syl-2@s6' },
] as const

async function open(page: Page, seed: string, width = 320): Promise<void> {
  await useWideFont(page)
  await page.setViewportSize({ width, height: 900 })
  await page.goto(visualGalleryUrl({ family: 'syllogism', seed }))
  await expectWideFont(page)
  await expect(page.locator('#shown-0')).toHaveText('Shown', { timeout: 30_000 })
}

for (const { level, seed } of ITEMS) {
  test.describe(`syllogism ${level} item`, () => {
    test('shows the statements as a list and five text options, and the page does not scroll sideways at 320 px', async ({ page }) => {
      await open(page, seed)
      const list = page.getByRole('list', { name: 'Statements' })
      await expect(list).toBeVisible()
      const n = await list.getByRole('listitem').count()
      expect(n).toBeGreaterThanOrEqual(2)
      expect(n).toBeLessThanOrEqual(5)
      await expect(page.locator('.syllogism legend')).toHaveText(/^If these statements are true, which of the following/)
      await expect(page.getByRole('radio')).toHaveCount(5)
      await expect(page.getByRole('radio').first()).toHaveAccessibleName(/^A\. \S/)
      const widths = await page.locator('.syllogism form label').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))
      for (const w of widths) expect(w).toBeGreaterThanOrEqual(200)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
    })

    test('answers with the keyboard alone: a digit picks an option, Enter sends its display position', async ({ page }) => {
      await open(page, seed, 1024)
      await page.getByRole('radio').first().focus()
      await page.keyboard.press('4')
      await expect(page.getByRole('radio').nth(3)).toBeChecked()
      await page.keyboard.press('Enter')
      await expect(page.locator('#response-0')).toHaveText('3')
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
