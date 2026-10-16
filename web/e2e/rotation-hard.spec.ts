/// <reference lib="dom" />
/**
 * Hard rotation items (generator 1.4.0, the torsion template of strata 5–6; ROADMAP M3.12, DESIGN
 * §4.2 "Mental rotation") in real browsers, on the dev-only visual gallery (`render-visual.html`):
 * a stratum-6 item has 10–14 cubes, so it must stay legible at the smallest phone width. At 320 px
 * wide with the wide-font simulation: the five figures are drawn and non-blank, every option canvas
 * is at least 120 px wide, the page has no horizontal scrolling, and axe finds no serious or
 * critical issue in either theme. Without WebGL the one-line note replaces the item (as for every
 * rotation item).
 */

import { expect, test, type Page } from '@playwright/test'
import { ROTATION_UNAVAILABLE } from '../src/render/rotation/copy'
import { expectNoSeriousAxe } from './axe'
import { visualGalleryUrl } from './dev-server'
import { expectWideFont, useWideFont } from './wide-font'

/** A stratum-6 seed: the torsion template. */
const SEED = 'e2e-hard-1@s6'

async function hasWebGL(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const c = document.createElement('canvas')
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'))
  })
}

async function openHard(page: Page): Promise<boolean> {
  await useWideFont(page)
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto(visualGalleryUrl({ family: 'rotation', seed: SEED }))
  await expectWideFont(page)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  if (!(await hasWebGL(page))) return false
  await expect(page.locator('#shown-0')).toHaveText('Shown', { timeout: 30_000 })
  return true
}

test.describe('hard (torsion) rotation items at 320 px', () => {
  test('draws five non-blank figures, option canvases ≥ 120 px wide, no horizontal scrolling', async ({ page }) => {
    if (!(await openHard(page))) {
      await expect(page.locator('.rotation').getByRole('status')).toHaveText(ROTATION_UNAVAILABLE)
      return
    }
    const figures = await page.locator('.rotation canvas').evaluateAll((canvases) =>
      (canvases as HTMLCanvasElement[]).map((c) => {
        const ctx = c.getContext('2d')
        const width = c.getBoundingClientRect().width
        if (!ctx || c.width === 0) return { width, ink: 0 }
        const { data } = ctx.getImageData(0, 0, c.width, c.height)
        let ink = 0
        for (let i = 0; i < data.length; i += 4) if ((data[i] as number) < 200 || (data[i + 1] as number) < 200 || (data[i + 2] as number) < 200) ink++
        return { width, ink: ink / (c.width * c.height) }
      }),
    )
    expect(figures).toHaveLength(5)
    for (const f of figures) expect(f.ink, 'a figure is blank').toBeGreaterThan(0.02)
    for (const f of figures.slice(1)) expect(f.width).toBeGreaterThanOrEqual(120)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
    // The accessible names give the cube count only (10–14 here), the same for every option.
    await expect(page.getByRole('radio').first()).toHaveAccessibleName(/^Option A: a 3D object made of 1[0-4] cubes\.$/)
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`has no serious or critical axe violations (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      await openHard(page)
      await expectNoSeriousAxe(page)
    })
  }
})
