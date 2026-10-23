/// <reference lib="dom" />
/**
 * Paper folding (family `folding`; DESIGN §3 row 7, §13) in real browsers, on the dev-only visual
 * gallery (`render-visual.html`): the fold panels and the punch panel draw, the keyboard answers
 * (a letter key, then Enter), and at 320 px with the wide-font simulation the panels wrap two per row
 * with no horizontal scrolling; 0 serious or critical axe issues in light and dark.
 */

import { expect, test, type Page } from '@playwright/test'
import { expectNoSeriousAxe } from './axe'
import { visualGalleryUrl } from './dev-server'
import { expectWideFont, useWideFont } from './wide-font'

/** A stratum-5 seed (6 × 6 sheet, two or three folds with a diagonal). */
const SEED = 'e2e-folding-1@s5'

/** The number of folds, read from the item's own text alternative ("Step k: …" lines). */
async function foldCount(page: Page): Promise<number> {
  const steps = await page.getByRole('group', { name: 'How the sheet is folded and punched' }).locator('ol li').allTextContents()
  return steps.filter((t) => /^Step \d+:/.test(t)).length
}

async function open(page: Page, width: number, wide = false): Promise<void> {
  if (wide) await useWideFont(page)
  await page.setViewportSize({ width, height: 900 })
  await page.goto(visualGalleryUrl({ family: 'folding', seed: SEED }))
  if (wide) await expectWideFont(page)
  await expect(page.locator('#shown-0')).toHaveText('Shown', { timeout: 30_000 })
}

test.describe('paper folding renderer', () => {
  test('draws a panel per fold plus the punch panel, and five option sheets', async ({ page }) => {
    await open(page, 1024)
    const folds = await foldCount(page)
    expect(folds).toBeGreaterThanOrEqual(1)
    expect(folds).toBeLessThanOrEqual(3)
    await expect(page.locator('figure.panel')).toHaveCount(folds + 1)
    await expect(page.locator('line.fold')).toHaveCount(folds)
    await expect(page.locator('path.arrow')).toHaveCount(folds)
    await expect(page.locator('figure.panel').last().locator('circle.hole')).not.toHaveCount(0)
    await expect(page.getByRole('radio')).toHaveCount(5)
    await expect(page.getByRole('radio').first()).toHaveAccessibleName(/^Option A: holes? at row \d, column \d/)
    // The sheet, each fold, the punches.
    await expect(page.getByRole('group', { name: 'How the sheet is folded and punched' }).locator('ol li')).toHaveCount(folds + 2)
  })

  test('answers by keyboard: a letter picks, Enter responds with the display position', async ({ page }) => {
    await open(page, 1024)
    await page.getByRole('radio').first().focus()
    await page.keyboard.press('c')
    await expect(page.getByRole('radio').nth(2)).toBeChecked()
    await page.keyboard.press('Enter')
    await expect(page.locator('#response-0')).toHaveText('2')
  })

  test('at 320 px with a wide font: panels two per row, no horizontal scroll', async ({ page }) => {
    await open(page, 320, true)
    const folds = await foldCount(page)
    const boxes = await page.locator('figure.panel').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect))
    expect(boxes).toHaveLength(folds + 1)
    // Two per row: panels 0 and 1 share a row, panel 2 (when there is one) starts the next.
    expect(Math.abs((boxes[0] as DOMRect).top - (boxes[1] as DOMRect).top)).toBeLessThan(2)
    if (boxes.length > 2) expect((boxes[2] as DOMRect).top).toBeGreaterThan((boxes[0] as DOMRect).bottom - 1)
    for (const b of boxes) expect(b.width).toBeGreaterThanOrEqual(100)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`has no serious or critical axe violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      await open(page, 320, true)
      await expectNoSeriousAxe(page)
    })
  }
})
