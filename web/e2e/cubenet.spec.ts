/// <reference lib="dom" />
/**
 * Cube-net items (DESIGN §3 row 7, §4.2, §13) in real browsers, on the dev-only visual gallery
 * (`render-visual.html`): the net and four cubes are drawn as SVG, the net is an
 * image with its row-by-row text alternative, the options are named by their three faces, a
 * keyboard answer reaches `onrespond`, and at 320 px with the wide-font simulation the page has no
 * horizontal scrolling and every cube is at least 100 px wide; axe finds no serious or critical
 * issue in the light or the dark theme; 200% zoom (640 × 400 CSS px) fits too. A natural-pool seed and a stratum-5 seed (three mirror
 * distractors) are opened the same way.
 */

import { expect, test, type Page } from '@playwright/test'
import { expectNoSeriousAxe } from './axe'
import { visualGalleryUrl } from './dev-server'
import { expectWideFont, useWideFont } from './wide-font'

const SEEDS = ['e2e-cubenet-1', 'e2e-cubenet-2@s5'] as const

async function open(page: Page, seed: string, width = 320): Promise<void> {
  await useWideFont(page)
  await page.setViewportSize({ width, height: 900 })
  await page.goto(visualGalleryUrl({ family: 'cubenet', seed }))
  await expectWideFont(page)
  await expect(page.locator('#shown-0')).toHaveText('Shown', { timeout: 30_000 })
}

test.describe('cube-net items', () => {
  for (const seed of SEEDS) {
    test(`draws the net and four cubes at 320 px without horizontal scrolling (${seed})`, async ({ page }) => {
      await open(page, seed)
      const net = page.locator('svg.net')
      await expect(net).toHaveCount(1)
      await expect(net).toHaveAttribute('role', 'img')
      await expect(net).toHaveAttribute('aria-label', /^Flat pattern of 6 squares.*Row 1: .*Row 2: /)
      await expect(net.locator('rect')).toHaveCount(6)
      const cubes = page.locator('svg.cube')
      await expect(cubes).toHaveCount(4)
      const widths = await cubes.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))
      for (const w of widths) expect(w).toBeGreaterThanOrEqual(100)
      const netBox = await net.boundingBox()
      expect(netBox?.width ?? 0).toBeGreaterThanOrEqual(200)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
      const radios = page.getByRole('radio')
      await expect(radios).toHaveCount(4)
      await expect(radios.first()).toHaveAccessibleName(/^Option A: top face: [a-z -]+; front left face: [a-z -]+; front right face: [a-z -]+\.$/)
    })
  }

  test('answers with the keyboard: a letter key picks, Enter confirms', async ({ page }) => {
    await open(page, SEEDS[0], 1024)
    await page.getByRole('radio').first().focus()
    await page.keyboard.press('c')
    await expect(page.getByRole('radio').nth(2)).toBeChecked()
    await page.keyboard.press('Enter')
    await expect(page.locator('#response-0')).toHaveText('2')
  })

  test('fits 200% browser zoom (a 1280 × 800 window shows 640 × 400) without horizontal scrolling', async ({ page }) => {
    await useWideFont(page)
    await page.setViewportSize({ width: 640, height: 400 })
    await page.goto(visualGalleryUrl({ family: 'cubenet', seed: SEEDS[1] }))
    await expect(page.locator('#shown-0')).toHaveText('Shown', { timeout: 30_000 })
    await expect(page.locator('svg.cube')).toHaveCount(4)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`has no serious or critical axe violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      await open(page, SEEDS[0])
      await expectNoSeriousAxe(page)
    })
  }
})
