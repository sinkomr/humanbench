/// <reference lib="dom" />
/**
 * The render changes for three open questions of web/UX-REVIEW.md section 2 (D9, D12, D28), each built as the review's
 * recommended option (provisional until the owner confirms it), in a real browser, on the production build:
 *
 * - D9 (VER-03): the coding keypad folds into rows of five and four where nine keys would be under about 40 px wide,
 *   the keys are then 44 px or more wide, and the table, the shape and the keypad still fit one phone screen (UX-002);
 *   the digit span keypad keeps its own layout. Sizes at 320, 390, 412, 430 and 768 px are measured here and written to
 *   the test annotations (`key-size`).
 * - D12 (UX-084): the reaction-time fixation cross is drawn in the middle of the pad, not in a row above it; the stage
 *   loses that row, the cross is no target for a tap, and the target replaces it without anything moving. The four
 *   position block is reached on the dev-only review page (needs `HB_DEV_SERVER=1`).
 * - D28 (UX-085): the Spatial stem reads "Which option shows the same object as the target, rotated? A mirror image does
 *   not count." on the item screen (where the browser can draw the figures; the unit side is `RotationRenderer.dom.test.ts`).
 *
 * The timing of the blocks is not touched by any of this (markup and style only): `rt-selftest.spec.ts` and the
 * `src/selftest` tests are the check for that.
 */

import { expect, test, type Page } from '@playwright/test'
import { ROTATION_STEM } from '../src/render/rotation/copy'
import { expectNoSeriousAxe } from './axe'
import { REVIEW_URL, devServerAbsent } from './dev-server'
import { button } from './flow'
import { useTextZoom } from './layout'
import { intoSegment } from './routes'

interface Box {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
  readonly width: number
  readonly height: number
}

/** Boxes (viewport coordinates) of the elements matching `selector`, in DOM order. */
async function boxes(page: Page, selector: string): Promise<Box[]> {
  return page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => {
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }
  }), selector)
}

const round = (n: number): number => Math.round(n * 10) / 10

// ------------------------------------------------------------------------------------ D9

/** Phone widths, the number of rows the nine coding keys are expected in, and the viewport height of that phone. */
const CODING_SIZES = [
  { width: 320, height: 568, rows: 2, name: 'iPhone SE (320)' },
  { width: 390, height: 664, rows: 2, name: 'iPhone 13 (390)' },
  { width: 412, height: 840, rows: 2, name: 'Pixel 7 (412)' },
  { width: 430, height: 932, rows: 1, name: 'iPhone Pro Max (430)' },
  { width: 768, height: 1024, rows: 1, name: 'tablet (768)' },
] as const

test.describe('the coding keypad folds where nine keys would be under 40 px wide (D9, VER-03)', () => {
  for (const size of CODING_SIZES) {
    test(`${size.name}: ${size.rows === 1 ? 'one row of nine keys of 40 px or more' : 'rows of five and four, keys 44 px or more wide'}, and the block fits the screen`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      await intoSegment(page, 5)
      await expect(page.locator('.coding .title')).toHaveText('Shape to digit')
      await button(page, 'Start').click()
      await expect(page.getByRole('timer')).toBeVisible()
      await expect
        .poll(async () => {
          const [legend] = await boxes(page, '.coding .legend')
          const keys = await boxes(page, '.coding .keypad button')
          return legend !== undefined && legend.top >= -0.5 && keys.length === 9 && keys.every((k) => k.bottom <= size.height + 0.5)
        }, { message: 'the table is at the top of the screen and the last key is not below the bottom', timeout: 5000 })
        .toBe(true)
      const [legend] = await boxes(page, '.coding .legend')
      const [stage] = await boxes(page, '.coding .stage')
      const [pad] = await boxes(page, '.coding .keypad')
      const keys = await boxes(page, '.coding .keypad button')
      const rowTops = [...new Set(keys.map((k) => Math.round(k.top)))]
      const widths = keys.map((k) => k.width)
      const rowSizes = rowTops.map((t) => keys.filter((k) => Math.round(k.top) === t).length)
      const minW = Math.min(...widths)
      const minH = Math.min(...keys.map((k) => k.height))
      const block = keys.at(-1)!.bottom - legend!.top
      test.info().annotations.push({
        type: 'key-size',
        description: `${size.width} x ${size.height}: rows ${rowSizes.join('+')}, keys ${round(minW)}-${round(Math.max(...widths))} x ${round(minH)} px, block ${round(block)} px (table top to last key), keypad ${round(pad!.width)} px wide`,
      })
      console.log(`KEYSIZE ${size.width}x${size.height} rows=${rowSizes.join('+')} key=${round(minW)}x${round(minH)} block=${round(block)}`)

      expect(rowSizes, `${size.width} px: the rows of keys`).toEqual(size.rows === 2 ? [5, 4] : [9])
      for (const k of keys) {
        expect(k.height, 'a key is a finger tall').toBeGreaterThanOrEqual(43.5)
        // Folded keys are at least WCAG 2.5.8's 24 px and the 44 px of the other targets; one row keeps keys of about 40 px or more.
        expect(k.width).toBeGreaterThanOrEqual(size.rows === 2 ? 43.5 : 39.5)
      }
      // The rows are centred in the keypad: the second row is not pushed against one side.
      if (size.rows === 2) {
        const second = keys.slice(5)
        const left = Math.min(...second.map((k) => k.left)) - pad!.left
        const right = pad!.right - Math.max(...second.map((k) => k.right))
        expect(Math.abs(left - right), 'the four keys of the second row are centred').toBeLessThanOrEqual(2)
        // No two keys touch or overlap.
        for (let i = 1; i < 5; i++) expect(keys[i]!.left - keys[i - 1]!.right, 'a gap between keys').toBeGreaterThanOrEqual(2)
      }
      // The table, the shape and the keypad are all on screen at once (UX-002), within the budget of the shortest phone.
      expect(stage!.top, 'the shape is on screen').toBeGreaterThanOrEqual(-0.5)
      expect(stage!.bottom).toBeLessThanOrEqual(size.height + 0.5)
      expect(block, 'table, shape and keypad together').toBeLessThan(size.height <= 664 ? 468 : size.height)
      // Every key is what a tap on its middle reaches (nothing lies over a key), and the keypad is still a group of nine buttons.
      const hit = await page.evaluate(() => [...document.querySelectorAll('.coding .keypad button')].map((b) => {
        const r = b.getBoundingClientRect()
        return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b
      }))
      expect(hit).toEqual(Array(9).fill(true))
      await expect(page.getByRole('group', { name: 'Digit keypad' }).getByRole('button')).toHaveText(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(over, 'the coding block scrolls sideways').toBeLessThanOrEqual(0)
    })
  }

  test('a tap on a key of each row answers the shape, and the next shape follows (the response path is the same)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 })
    await intoSegment(page, 5)
    await button(page, 'Start').click()
    await expect(page.getByRole('timer')).toBeVisible()
    const shape = page.locator('.coding .stage svg')
    const tapKey = async (digit: number): Promise<void> => {
      const key = page.getByRole('group', { name: 'Digit keypad' }).getByRole('button', { name: String(digit), exact: true })
      if (test.info().project.use.isMobile === true) await key.tap()
      else await key.click()
    }
    // A key of the first row (5) and of the second (9), by the user's own taps: each moves on to the next shape.
    const seen: (string | null)[] = []
    for (const digit of [5, 9, 1, 6]) {
      seen.push(await shape.getAttribute('aria-label'))
      await tapKey(digit)
      await expect.poll(async () => (await page.locator('.coding .stage svg').count()) === 1).toBe(true)
    }
    // Four answers were taken: four glyphs were shown, and the block is still running.
    expect(seen).toHaveLength(4)
    await expect(page.getByRole('timer')).toBeVisible()
  })

  test('the digit span keypad is not folded: it keeps as many 2.75rem keys as fit', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await intoSegment(page, 3)
    await button(page, 'Start').click()
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 40_000 })
    const pad = page.getByRole('group', { name: 'Digit keypad' })
    expect(await pad.evaluate((el) => getComputedStyle(el).display)).toBe('grid')
    const keys = await boxes(page, '.span .keypad button')
    for (const k of keys) {
      expect(k.height).toBeGreaterThanOrEqual(43.5)
      expect(k.width).toBeGreaterThanOrEqual(43.5)
    }
  })

  for (const width of [320, 390]) {
    test(`with the text at 200% the coding keypad still folds, fits ${width} px and every key is a 44 px target`, async ({ page }) => {
      await useTextZoom(page, 200)
      await page.setViewportSize({ width, height: 664 })
      await intoSegment(page, 5)
      await button(page, 'Start').click()
      await expect(page.getByRole('timer')).toBeVisible()
      const keys = await boxes(page, '.coding .keypad button')
      expect(keys).toHaveLength(9)
      expect(new Set(keys.map((k) => Math.round(k.top))).size, 'rows of keys').toBe(2)
      for (const k of keys) {
        expect(k.width).toBeGreaterThanOrEqual(43.5)
        expect(k.height).toBeGreaterThanOrEqual(43.5)
        expect(k.right, 'a key inside the window').toBeLessThanOrEqual(width + 0.5)
      }
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(over, 'the coding block at 200% text scrolls sideways').toBeLessThanOrEqual(0)
    })
  }
})

// ----------------------------------------------------------------------------------- D12

/**
 * A reaction-time trial on screen with the cross showing: its geometry, measured in the page in the same frame the cross
 * is seen in (the foreperiod is a second or more, but a measurement between two calls could be after the target).
 */
async function measureFixation(page: Page): Promise<{
  cross: { text: string; centre: [number, number]; pointerEvents: string }
  pads: Box[]
  stageTop: number
  stageHeight: number
  firstPadTop: number
  hitIsPad: boolean
}> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const t0 = performance.now()
    const tick = (): void => {
      const f = document.querySelector('.rt .fixation')
      if (f !== null && (f.textContent ?? '') === '+') {
        const range = document.createRange()
        range.selectNodeContents(f)
        const r = range.getBoundingClientRect()
        const pads = [...document.querySelectorAll('.rt .pad')].map((el) => {
          const b = el.getBoundingClientRect()
          return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width, height: b.height }
        })
        const stage = document.querySelector('.rt .stage')!.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        const hit = document.elementFromPoint(cx, cy)
        resolve({
          cross: { text: f.textContent ?? '', centre: [cx, cy], pointerEvents: getComputedStyle(f).pointerEvents },
          pads,
          stageTop: stage.top,
          stageHeight: stage.height,
          firstPadTop: pads[0]!.top,
          hitIsPad: hit !== null && hit.closest('.pad') !== null,
        })
        return
      }
      if (performance.now() - t0 > 15_000) reject(new Error('no fixation cross within 15 s'))
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }))
}

test.describe('the reaction-time fixation cross is drawn in the pad (D12, UX-084)', () => {
  for (const size of [{ width: 390, height: 664 }, { width: 320, height: 568 }] as const) {
    test(`one position, ${size.width} px: the cross is in the middle of the pad, the stage has no row above the pad, and the target takes its place`, async ({ page }) => {
      await page.setViewportSize(size)
      await intoSegment(page, 0)
      await button(page, 'Start practice').click()
      const m = await measureFixation(page)
      expect(m.pads).toHaveLength(1)
      const pad = m.pads[0]!
      // The middle of the cross is the middle of the pad (to a pixel and a half: a glyph's own box is not exactly square).
      expect(Math.abs(m.cross.centre[0] - (pad.left + pad.width / 2)), 'horizontal offset of the cross from the pad middle').toBeLessThanOrEqual(1.5)
      expect(Math.abs(m.cross.centre[1] - (pad.top + pad.height / 2)), 'vertical offset of the cross from the pad middle').toBeLessThanOrEqual(2.5)
      // No row of its own: the pad starts where the stage's border and padding end (2 px + 1rem), the row cost 2.5rem + 0.75rem.
      expect(m.firstPadTop - m.stageTop, 'the pad starts at the top of the stage').toBeLessThanOrEqual(19.5)
      // Nothing to hear or tap: a tap on the cross lands on the pad.
      expect(m.cross.pointerEvents).toBe('none')
      expect(m.hitIsPad, 'the pad is what a tap on the cross reaches').toBe(true)
      // The stage on screen as a whole (it took focus with the practice start).
      expect(m.stageTop).toBeGreaterThanOrEqual(-0.5)
      expect(m.stageTop + m.stageHeight).toBeLessThanOrEqual(size.height + 0.5)
      console.log(`FIXATION ${size.width}x${size.height} stage=${round(m.stageHeight)} px, pad ${round(pad.width)} px, cross offset (${round(m.cross.centre[0] - (pad.left + pad.width / 2))}, ${round(m.cross.centre[1] - (pad.top + pad.height / 2))})`)
      test.info().annotations.push({ type: 'rt-stage', description: `${size.width} x ${size.height}: stage ${round(m.stageHeight)} px high, pad ${round(pad.width)} px` })

      // The target replaces the cross where the cross was: the pad does not move and the cross is gone.
      await expect(page.locator('.rt .pad.on')).toBeVisible({ timeout: 15_000 })
      const after = await boxes(page, '.rt .pad')
      expect(after[0]!.top).toBeCloseTo(pad.top, 1)
      expect(after[0]!.left).toBeCloseTo(pad.left, 1)
      expect(after[0]!.width).toBeCloseTo(pad.width, 1)
      await expect(page.locator('.rt .fixation')).toHaveText('')
    })
  }

  test('four positions (review page): the cross is in the middle of the row of pads, which stay four equal pads in one row', async ({ page }) => {
    test.skip(devServerAbsent(), 'the review page is served by the dev server (HB_DEV_SERVER=1)')
    // 390 px: the review page has its own padding, and the four pads sit in one row from about 340 px (a row needs 4 x 3rem and the gaps).
    await page.setViewportSize({ width: 390, height: 664 })
    await page.goto(`${REVIEW_URL}?family=rt_choice4&page=1&per=1`)
    await page.getByRole('button', { name: 'Start practice' }).first().click()
    const m = await measureFixation(page)
    expect(m.pads).toHaveLength(4)
    const rowLeft = m.pads[0]!.left
    const rowRight = m.pads[3]!.right
    expect(Math.abs(m.cross.centre[0] - (rowLeft + rowRight) / 2), 'horizontal offset of the cross from the middle of the row').toBeLessThanOrEqual(1.5)
    expect(Math.abs(m.cross.centre[1] - (m.pads[0]!.top + m.pads[0]!.height / 2)), 'vertical offset of the cross from the row middle').toBeLessThanOrEqual(2.5)
    expect(m.cross.pointerEvents).toBe('none')
    // Four equal pads in one row, as before.
    expect(new Set(m.pads.map((p) => Math.round(p.top))).size).toBe(1)
    expect(m.firstPadTop - m.stageTop, 'no row above the pads').toBeLessThanOrEqual(19.5)
    console.log(`FIXATION4 390x664 stage=${round(m.stageHeight)} px, pads ${m.pads.map((p) => round(p.width)).join('/')} px`)
    await expect(page.locator('.rt .pad.on')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.rt .fixation')).toHaveText('')
  })
})

// ----------------------------------------------------------------------------------- D28

test.describe('the Spatial stem (D28, UX-085)', () => {
  test('the item says "A mirror image does not count." in a sentence of its own', async ({ page }) => {
    expect(ROTATION_STEM).toBe('Which option shows the same object as the target, rotated? A mirror image does not count.')
    await intoSegment(page, 2)
    const stem = page.locator('div.rotation .stem')
    const note = page.locator('.unavailable')
    await expect(stem.or(note).first()).toBeVisible({ timeout: 30_000 })
    test.skip(await note.isVisible(), 'this browser cannot draw the 3D figures, so the stem is not on screen')
    await expect(stem).toHaveText(ROTATION_STEM)
    await expect(page.locator('div.rotation')).not.toContainText('mirror-imaged')
  })
})

// ------------------------------------------------------------------------------------ axe

test.describe('no serious or critical axe issues on the changed blocks (A, AA; light and dark)', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const size of [{ width: 320, height: 568 }, { width: 390, height: 664 }] as const) {
      test(`the coding block with the folded keypad, ${size.width} px, ${scheme}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme })
        await page.setViewportSize(size)
        await intoSegment(page, 5)
        await button(page, 'Start').click()
        await expect(page.getByRole('timer')).toBeVisible()
        await expect(page.getByRole('group', { name: 'Digit keypad' }).getByRole('button')).toHaveCount(9)
        await expectNoSeriousAxe(page)
      })
    }

    test(`the reaction-time stage with the cross in the pad, 390 px, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await page.setViewportSize({ width: 390, height: 664 })
      await intoSegment(page, 0)
      await button(page, 'Start practice').click()
      await expect(page.locator('.rt .stage')).toBeVisible()
      await measureFixation(page)
      await expectNoSeriousAxe(page)
    })
  }
})
