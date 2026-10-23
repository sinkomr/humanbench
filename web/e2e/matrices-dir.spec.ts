/// <reference lib="dom" />
/**
 * Matrices generator 1.4.0 (directions and diagonals; DESIGN §4.2 "Matrices", §13) in real
 * browsers, on the dev-only visual gallery (`render-visual.html`). The templates change no render
 * data (the direction lives in `structural_params`, never in the spec), so this checks that items
 * of the diagonal, column and mixed templates draw like any other at the smallest phone width with
 * the wide-font simulation: 8 grid cells and 6 options, cells ≥ 80 px wide, no horizontal page
 * scrolling, a keyboard answer, the neutral grid label (no reading direction), and 0 serious or
 * critical axe issues in both themes.
 *
 * Seeds (generator 1.4.0, stratum 4): `e2e-dir-11@s4` draws a diagonal template (color constant
 * along the diagonals, with a frame), `e2e-dir-1@s4` a column template, `e2e-dir-3@s4` a mixed one
 * (the diagonal and mixed ones are framed; `dir.test.ts` checks the generator itself).
 */

import { expect, test, type Page } from '@playwright/test'
import { expectNoSeriousAxe } from './axe'
import { visualGalleryUrl } from './dev-server'
import { expectWideFont, useWideFont } from './wide-font'

const SEEDS = {
  diagonal: 'e2e-dir-11@s4',
  column: 'e2e-dir-1@s4',
  mixed: 'e2e-dir-3@s4',
} as const

async function open(page: Page, seed: string): Promise<void> {
  await useWideFont(page)
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto(visualGalleryUrl({ family: 'matrices', seed }))
  await expectWideFont(page)
  await expect(page.locator('#shown-0')).toHaveText('Shown', { timeout: 30_000 })
}

for (const [kind, seed] of Object.entries(SEEDS)) {
  test.describe(`matrices, ${kind} template, at 320 px`, () => {
    test('draws the grid and the options, cells ≥ 80 px wide, no horizontal scrolling, a neutral grid label', async ({ page }) => {
      await open(page, seed)
      const grid = page.getByRole('group', { name: /^Pattern:/ })
      await expect(grid).toHaveAccessibleName(/The cells follow rules\./)
      await expect(grid).not.toHaveAccessibleName(/\b(read|along|down|diagonal)\b/i)
      await expect(grid.locator('svg.cell')).toHaveCount(9) // 8 cells and the empty one
      await expect(page.getByRole('radio')).toHaveCount(6)
      const widths = await page.locator('svg.cell').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))
      expect(widths).toHaveLength(15)
      for (const w of widths) expect(w).toBeGreaterThanOrEqual(80)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
      if (kind !== 'column') await expect(grid.locator('rect.frame')).toHaveCount(8) // the diagonal and mixed seeds are framed
    })

    test('takes a keyboard answer', async ({ page }) => {
      await open(page, seed)
      const radios = page.getByRole('radio')
      await radios.first().focus()
      await page.keyboard.press('3')
      await expect(radios.nth(2)).toBeChecked()
      await page.keyboard.press('ArrowRight')
      await expect(radios.nth(3)).toBeChecked()
      await expect(page.locator('#response-0')).toHaveText('none yet')
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
