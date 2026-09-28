/// <reference lib="dom" />
/**
 * The visual renderers in real browsers (ROADMAP M1.13, M1.A; DESIGN §4.2, §13 WCAG 2.2 AA), on
 * the dev-only gallery (`web/render-visual.html`, served by the Vite dev server, see
 * `dev-server.ts`). For the rotation (Three.js) and matrices (SVG) renderers, in Chromium, WebKit
 * and iPhone emulation:
 * - 0 serious or critical axe issues, light and dark;
 * - keyboard only: number/letter keys, arrow keys, Enter; a visible focus ring;
 * - no horizontal scrolling at 360 px wide and at 200% zoom (a 1280 × 800 screen = 640 × 400 CSS px);
 * - nothing animates under prefers-reduced-motion (the renderers have no motion at all);
 * - rotation: five non-blank figures per item, the options all different, identical pixels on a
 *   reload (fixed camera and lighting), ONE WebGL context however many figures and items, and that
 *   context freed when the items unmount;
 * - matrices: a screenshot comparison where a baseline exists for the platform (SVG is stable).
 */

import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { expectNoSeriousAxe } from './axe'
import { visualGalleryUrl } from './dev-server'

const FAMILIES = ['rotation', 'matrices'] as const
type Family = (typeof FAMILIES)[number]
const OPTIONS: Record<Family, number> = { rotation: 4, matrices: 6 }

/** Open the gallery and wait until every item reports its onset. */
async function openGallery(page: Page, query: Record<string, string | number>): Promise<void> {
  await page.goto(visualGalleryUrl(query))
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const n = Number(query.count ?? 1)
  for (let i = 0; i < n; i++) await expect(page.locator(`#shown-${i}`)).toHaveText('Shown', { timeout: 30_000 })
}

/** True if this browser build can create a WebGL context at all. */
async function hasWebGL(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const c = document.createElement('canvas')
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'))
  })
}

/** Horizontal overflow of the page in CSS px (0 = no horizontal scrolling). */
async function overflowX(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}

for (const family of FAMILIES) {
  test.describe(`${family} renderer`, () => {
    for (const colorScheme of ['light', 'dark'] as const) {
      test(`has no serious or critical axe violations (${colorScheme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme })
        await openGallery(page, { family, seed: 'e2e-axe-1' })
        await expectNoSeriousAxe(page)
        // With an option chosen (the chosen state is styled, and must stay accessible too).
        await page.getByRole('radio').nth(1).check()
        await expectNoSeriousAxe(page)
      })
    }

    test('is operable by keyboard alone, with a visible focus ring', async ({ page }) => {
      await openGallery(page, { family, seed: 'e2e-keys-1' })
      const radios = page.getByRole('radio')
      await expect(radios).toHaveCount(OPTIONS[family])
      await radios.first().focus()
      await page.keyboard.press('3')
      await expect(radios.nth(2)).toBeChecked()
      await expect(radios.nth(2)).toBeFocused()
      // The focused option's card shows a ≥ 2 px outline.
      const ring = await radios.nth(2).evaluate((el) => {
        const card = el.nextElementSibling as HTMLElement
        const s = getComputedStyle(card)
        return { style: s.outlineStyle, width: Number.parseFloat(s.outlineWidth) }
      })
      expect(ring.style).not.toBe('none')
      expect(ring.width).toBeGreaterThanOrEqual(2)
      await page.keyboard.press('ArrowRight')
      await expect(radios.nth(3)).toBeChecked()
      await page.keyboard.press('b')
      await expect(radios.nth(1)).toBeChecked()
      await expect(page.locator('#response-0')).toHaveText('none yet')
      await page.keyboard.press('Enter')
      await expect(page.locator('#response-0')).toHaveText('1')
      // Answered once: the group is locked.
      await expect(radios.first()).toBeDisabled()
    })

    test('the options are reachable with Tab, in display order', async ({ page, browserName }) => {
      // Desktop Safari skips form controls on Tab unless "Press Tab to highlight each item" is on.
      test.skip(browserName === 'webkit', 'WebKit tabs only to text fields by default')
      await openGallery(page, { family, seed: 'e2e-tab-1' })
      let found = false
      for (let i = 0; i < 20 && !found; i++) {
        await page.keyboard.press('Tab')
        found = await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type === 'radio')
      }
      expect(found).toBe(true)
      await expect(page.getByRole('radio').first()).toBeFocused()
    })

    for (const [label, size] of [
      ['360 px wide', { width: 360, height: 740 }],
      ['200% zoom', { width: 640, height: 400 }],
    ] as const) {
      test(`fits ${label} without horizontal scrolling`, async ({ page }) => {
        await page.setViewportSize(size)
        await openGallery(page, { family, seed: 'e2e-fit-1' })
        expect(await overflowX(page)).toBeLessThanOrEqual(0)
        const cards = page.locator('label')
        await expect(cards).toHaveCount(OPTIONS[family])
        for (const box of await cards.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect))) {
          expect(box.left).toBeGreaterThanOrEqual(0)
          expect(box.right).toBeLessThanOrEqual(size.width)
          // Comfortable touch targets (WCAG 2.5.8 asks for 24 px).
          expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44)
        }
      })
    }

    test('nothing moves under prefers-reduced-motion', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await openGallery(page, { family, seed: 'e2e-motion-1' })
      await page.getByRole('radio').nth(0).check()
      const motion = await page.evaluate(() => ({
        animations: document.getAnimations().length,
        transitions: [...document.querySelectorAll('label, label *, button')].filter((el) => {
          const s = getComputedStyle(el)
          return s.transitionDuration.split(',').some((d: string) => Number.parseFloat(d) > 0) || s.animationName !== 'none'
        }).length,
      }))
      expect(motion).toEqual({ animations: 0, transitions: 0 })
    })
  })
}

test.describe('rotation renderer drawing (Three.js)', () => {
  test('draws distinct non-blank figures through one WebGL context, identically on reload, and frees it', async ({ page }) => {
    // Count WebGL contexts and their losses (forceContextLoss on the last release).
    await page.addInitScript(() => {
      const w = window as unknown as { __webgl: { created: number; lost: number } }
      w.__webgl = { created: 0, lost: 0 }
      const orig = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        const ctx = (orig as (this: HTMLCanvasElement, t: string, ...r: unknown[]) => RenderingContext | null).call(this, type, ...rest)
        if (ctx && /webgl/.test(type) && !(this as unknown as { __counted?: boolean }).__counted) {
          ;(this as unknown as { __counted: boolean }).__counted = true
          w.__webgl.created++
          this.addEventListener('webglcontextlost', () => w.__webgl.lost++)
        }
        return ctx
      } as typeof orig
    })
    await page.goto(visualGalleryUrl({ family: 'rotation', seed: 'e2e-draw', count: 2 }))
    test.skip(!(await hasWebGL(page)), 'this browser build has no WebGL (the text fallback is unit-tested)')
    await openGallery(page, { family: 'rotation', seed: 'e2e-draw', count: 2 })

    const snapshot = (): Promise<{ url: string; ink: number }[]> =>
      page.locator('canvas').evaluateAll((canvases) =>
        (canvases as HTMLCanvasElement[]).map((c) => {
          const ctx = c.getContext('2d')
          if (!ctx || c.width === 0) return { url: '', ink: 0 }
          const { data } = ctx.getImageData(0, 0, c.width, c.height)
          let ink = 0
          for (let i = 0; i < data.length; i += 4) if ((data[i] as number) < 200 || (data[i + 1] as number) < 200 || (data[i + 2] as number) < 200) ink++
          return { url: c.toDataURL(), ink: ink / (c.width * c.height) }
        }),
      )
    const first = await snapshot()
    expect(first).toHaveLength(10) // 2 items × (target + 4 options)
    for (const f of first) expect(f.ink, 'a figure is blank').toBeGreaterThan(0.02)
    for (const item of [first.slice(0, 5), first.slice(5)]) {
      const options = item.slice(1).map((f) => f.url)
      expect(new Set(options).size).toBe(4)
      expect(options).not.toContain(item[0]?.url)
    }
    expect(await page.evaluate(() => (window as unknown as { __webgl: { created: number } }).__webgl.created)).toBe(1)

    // Deterministic: a reload draws the same pixels.
    await page.reload()
    await openGallery(page, { family: 'rotation', seed: 'e2e-draw', count: 2 })
    expect((await snapshot()).map((f) => f.url)).toEqual(first.map((f) => f.url))

    // Unmounting every renderer releases, and so loses, the one shared context.
    await page.getByRole('button', { name: 'Remove items' }).click()
    await expect(page.locator('#removed')).toBeVisible()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __webgl: { lost: number } }).__webgl.lost)).toBe(1)
  })
})

test.describe('matrices renderer look', () => {
  test('matches the screenshot baseline of a fixed item (where one exists for this platform)', async ({ page }, testInfo) => {
    const name = 'matrices-e2e-look-1.png'
    // Baselines are per project and platform (fonts and rasterisers differ); without one, skip
    // rather than write one and fail (e.g. the first Linux CI run). Refresh with --update-snapshots.
    const updating = testInfo.config.updateSnapshots === 'all' || testInfo.config.updateSnapshots === 'changed'
    test.skip(!updating && !existsSync(testInfo.snapshotPath(name)), `no ${testInfo.project.name} baseline on ${process.platform}`)
    await page.setViewportSize({ width: 900, height: 900 })
    await openGallery(page, { family: 'matrices', seed: 'e2e-look-1' })
    // The grid is text-free SVG (the "?" is a path), so it rasterises the same run to run.
    await expect(page.getByRole('group', { name: /^Pattern:/ })).toHaveScreenshot(name, { maxDiffPixelRatio: 0.01, animations: 'disabled' })
  })
})
