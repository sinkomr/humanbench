/// <reference lib="dom" />
/**
 * Qdata items (data interpretation and everyday word problems; DESIGN §3 row 6, §4.2, §13) in real
 * browsers, on the dev-only visual gallery (`render-visual.html`). Fixed seeds cover every exhibit
 * shape: a three-column table, the widest table (a label column and four data columns), a bar chart
 * of six days, a bar chart with negative bars (yearly percent changes), a line chart of seven
 * points, a line chart of two series, and a word problem without an exhibit. Each draws, a chart is
 * an image named by its hidden data table, a typed answer submitted with Enter reaches `onrespond`,
 * and at 320 px with the wide-font simulation (and at 200% zoom, 640 × 400 CSS px) the page has no horizontal
 * scrolling; axe finds no serious or critical issue in the light or the dark theme.
 */

import { expect, test, type Page } from '@playwright/test'
import { expectNoSeriousAxe } from './axe'
import { visualGalleryUrl } from './dev-server'
import { expectWideFont, useWideFont } from './wide-font'

/** Seeds by what they draw (generator 1.0.0). */
const SEEDS = {
  table: 'e2e-qdata-1',
  wideTable: 'e2e-qdata-32@s4',
  bar: 'e2e-qdata-11@s1',
  negativeBars: 'e2e-qdata-1@s6',
  line: 'e2e-qdata-30@s2',
  twoLines: 'e2e-qdata-2@s5',
  wordProblem: 'e2e-qdata-1@s4',
} as const

async function open(page: Page, seed: string, width = 320): Promise<void> {
  await useWideFont(page)
  await page.setViewportSize({ width, height: 900 })
  await page.goto(visualGalleryUrl({ family: 'qdata', seed }))
  await expectWideFont(page)
  await expect(page.locator('#shown-0')).toHaveText('Shown', { timeout: 30_000 })
}

const noSideScroll = async (page: Page): Promise<number> => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

test.describe('qdata items', () => {
  for (const [name, seed] of Object.entries(SEEDS)) {
    test(`draws at 320 px with the wide font and no horizontal scrolling (${name})`, async ({ page }) => {
      await open(page, seed)
      const question = page.locator('section.qdata')
      await expect(question).toHaveCount(1)
      await expect(question.locator('.stem')).not.toBeEmpty()
      if (name === 'table' || name === 'wideTable') {
        const table = question.locator('table.data')
        await expect(table).toBeVisible()
        await expect(table.locator('caption')).not.toBeEmpty()
        await expect(table.locator('th[scope="col"]').first()).toBeVisible()
        const box = await table.boundingBox()
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320)
      } else if (name === 'wordProblem') {
        await expect(question.locator('table, svg.plot')).toHaveCount(0)
      } else {
        const svg = question.locator('svg.plot')
        await expect(svg).toHaveAttribute('role', 'img')
        const id = await svg.getAttribute('aria-labelledby')
        await expect(page.locator(`table[id="${id ?? ''}"]`)).toHaveCount(1)
        await expect(svg).toHaveAccessibleName(/\S/)
        await expect(question.getByRole('heading', { level: 3 })).toBeVisible()
        const box = await svg.boundingBox()
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(240)
        expect(await svg.locator('text.value').count()).toBeGreaterThanOrEqual(3)
        if (name === 'twoLines') await expect(question.locator('.legend li')).toHaveCount(2)
      }
      expect(await noSideScroll(page)).toBeLessThanOrEqual(0)
    })
  }

  test('answers with the keyboard: type, then Enter', async ({ page }) => {
    await open(page, SEEDS.table, 1024)
    const box = page.locator('section.qdata form.entry').getByRole('textbox')
    await box.focus()
    await page.keyboard.type('12')
    await page.keyboard.press('Enter')
    await expect(page.locator('#response-0')).toHaveText('12')
  })

  test('fits 200% browser zoom (a 1280 × 800 window shows 640 × 400) without horizontal scrolling', async ({ page }) => {
    for (const seed of [SEEDS.wideTable, SEEDS.twoLines, SEEDS.negativeBars]) {
      await useWideFont(page)
      await page.setViewportSize({ width: 640, height: 400 })
      await page.goto(visualGalleryUrl({ family: 'qdata', seed }))
      await expect(page.locator('#shown-0')).toHaveText('Shown', { timeout: 30_000 })
      await expect(page.locator('section.qdata')).toHaveCount(1)
      expect(await noSideScroll(page)).toBeLessThanOrEqual(0)
    }
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    for (const seed of [SEEDS.wideTable, SEEDS.twoLines, SEEDS.negativeBars]) {
      test(`has no serious or critical axe violations (${colorScheme}, ${seed})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme })
        await open(page, seed)
        await expectNoSeriousAxe(page)
      })
    }
  }
})
