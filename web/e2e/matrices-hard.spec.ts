/// <reference lib="dom" />
/**
 * Hard matrices (generator 1.3.0, ROADMAP M3.12; DESIGN §4.2 "Matrices", §13) in real browsers,
 * on the dev-only visual gallery (`render-visual.html`): an item of stratum 6 has an outer frame
 * band in every cell and its objects drawn smaller to clear it, so it must stay legible at the
 * smallest phone width. At 320 px wide with the wide-font simulation: the grid and options keep
 * cells ≥ 80 px wide, every cell but the missing one has its frame band, no horizontal scrolling,
 * 0 serious or critical axe issues in both themes; plus a screenshot baseline where one exists for
 * the platform (SVG is stable).
 */

import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { expectNoSeriousAxe } from './axe'
import { visualGalleryUrl } from './dev-server'
import { expectWideFont, useWideFont } from './wide-font'

/** A stratum-6 seed: every stratum-6 rule set has a frame. */
const SEED = 'e2e-hard-1@s6'

async function openHard(page: Page): Promise<void> {
  await useWideFont(page)
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto(visualGalleryUrl({ family: 'matrices', seed: SEED }))
  await expectWideFont(page)
  await expect(page.locator('#shown-0')).toHaveText('Shown', { timeout: 30_000 })
}

test.describe('hard (framed) matrices at 320 px', () => {
  test('draws every frame, keeps cells ≥ 80 px wide and the page without horizontal scrolling', async ({ page }) => {
    await openHard(page)
    const grid = page.getByRole('group', { name: /^Pattern:/ })
    await expect(grid.locator('rect.frame')).toHaveCount(8)
    await expect(page.locator('form rect.frame')).toHaveCount(6)
    const widths = await page.locator('svg.cell').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))
    expect(widths).toHaveLength(15)
    for (const w of widths) expect(w).toBeGreaterThanOrEqual(80)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
    // The options' accessible names name the frame.
    await expect(page.getByRole('radio').first()).toHaveAccessibleName(/frame$/)
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`has no serious or critical axe violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      await openHard(page)
      await expectNoSeriousAxe(page)
    })
  }

  test('matches the screenshot baseline of a fixed hard item (where one exists for this platform)', async ({ page }, testInfo) => {
    const name = 'matrices-hard-look-1.png'
    const updating = testInfo.config.updateSnapshots === 'all' || testInfo.config.updateSnapshots === 'changed'
    test.skip(!updating && !existsSync(testInfo.snapshotPath(name)), `no ${testInfo.project.name} baseline on ${process.platform}`)
    await openHard(page)
    await expect(page.getByRole('group', { name: /^Pattern:/ })).toHaveScreenshot(name, { maxDiffPixelRatio: 0.01, animations: 'disabled' })
  })
})
