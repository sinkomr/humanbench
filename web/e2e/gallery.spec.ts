/// <reference lib="dom" />
/**
 * Renderer gallery / G7 review page e2e (ROADMAP M1.13, M1.A, M1.G7; DESIGN §4.4, §13). The page is
 * dev-only, so these tests browse the `vite` dev server (`e2e/dev-server.ts`), one family at a time
 * (`?family=<name>&per=1`): every renderer, driven into its main phase, has 0 serious/critical axe
 * violations (WCAG 2.x A/AA, light and dark), fits a 360 px and a 640 px (200% zoom of 1280) wide
 * viewport without sideways scrolling, turns off transitions under prefers-reduced-motion, and
 * works from the keyboard; verdicts persist and export; stable SVG renderers (Corsi board, coding
 * legend) render the same pixels on every load (and, on macOS Chromium, match a stored baseline).
 */

import { expect, test, type Page } from '@playwright/test'
import { expectNoSeriousAxe } from './axe'
import { REVIEW_URL } from './dev-server'

/** Families with an entry/block renderer, and how to drive each into its main phase. */
const DRIVERS: Readonly<Record<string, (page: Page) => Promise<void>>> = {
  series: async (page) => {
    await page.getByLabel('Next term', { exact: true }).first().fill('1')
    await page.getByRole('button', { name: 'Submit' }).first().click()
    await expect(page.getByText('Answer recorded.')).toBeVisible()
  },
  quant: async (page) => {
    await page.getByLabel('Your answer', { exact: true }).first().fill('12')
    await page.getByRole('button', { name: 'Submit' }).first().click()
    await expect(page.getByText('Answer recorded.')).toBeVisible()
  },
  span_fwd: async (page) => {
    await page.getByRole('button', { name: 'Start' }).first().click()
    await expect(page.getByText(/^Enter 3 digits/)).toBeVisible({ timeout: 15_000 })
  },
  span_bwd: async (page) => {
    await page.getByRole('button', { name: 'Start' }).first().click()
    await expect(page.getByText(/^Enter 3 digits, last one first/)).toBeVisible({ timeout: 15_000 })
  },
  corsi: async (page) => {
    await page.getByRole('button', { name: 'Start' }).first().click()
    await expect(page.getByText('Selected 0 of 3.')).toBeVisible({ timeout: 15_000 })
  },
  rt_simple: async (page) => {
    await page.getByRole('button', { name: 'Start practice' }).first().click()
    await expect(page.getByText(/^Practice 1 of 3/)).toBeVisible()
  },
  rt_choice4: async (page) => {
    await page.getByRole('button', { name: 'Start practice' }).first().click()
    await expect(page.getByText(/^Practice 1 of 3/)).toBeVisible()
  },
  coding: async (page) => {
    await page.getByRole('button', { name: 'Start' }).first().click()
    await expect(page.getByRole('timer')).toBeVisible()
  },
  reading: async (page) => {
    await page.getByRole('button', { name: 'Show the passage' }).first().click()
    await page.getByRole('button', { name: 'Done reading' }).first().click()
    await expect(page.getByRole('group').filter({ hasText: /^1\./ }).first()).toBeVisible()
  },
}

async function openFamily(page: Page, family: string, per = 1): Promise<void> {
  await page.goto(`${REVIEW_URL}?family=${family}&page=1&per=${per}`)
  await expect(page.getByRole('heading', { level: 2, name: new RegExp(`^${family}\\b`) })).toBeVisible({ timeout: 30_000 })
}

test.describe('renderer gallery (dev server)', () => {
  test('lists every registered family, 30 instances each, with key, checks and difficulty', async ({ page }) => {
    await openFamily(page, 'series', 5)
    const families = page.getByRole('navigation', { name: 'Families' }).getByRole('link')
    await expect(families).toHaveCount(11)
    await expect(page.getByRole('navigation', { name: 'Instances of series' }).getByRole('link')).toHaveCount(30)
    await expect(page.locator('article')).toHaveCount(5)
    const first = page.locator('article').first()
    await expect(first.getByRole('heading', { level: 3 })).toContainText('i:series:')
    await expect(first.getByText('Key', { exact: true })).toBeVisible()
    await expect(first.getByText(/^b prior/)).toBeVisible()
    await expect(first.getByText(/sibling_group/)).toBeVisible()
  })

  for (const family of Object.keys(DRIVERS)) {
    test(`${family}: no serious axe violations before and during the task (light and dark)`, async ({ page }) => {
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme })
        await openFamily(page, family)
        await expectNoSeriousAxe(page)
        await DRIVERS[family]?.(page)
        await expectNoSeriousAxe(page)
      }
    })
  }

  test('families without an entry renderer (rotation, matrices) render or fall back to JSON, axe-clean', async ({ page }) => {
    for (const family of ['rotation', 'matrices']) {
      await openFamily(page, family)
      await expect(page.locator('article').first()).toBeVisible()
      await expectNoSeriousAxe(page)
    }
  })

  test('verdicts persist across reloads and export as hb.g7_review.v1 JSON', async ({ page }) => {
    await openFamily(page, 'quant', 1)
    await page.getByLabel('Reviewer').fill('e2e-reviewer')
    await page.getByLabel('Reviewer').press('Tab')
    await page.getByRole('radio', { name: 'fail' }).check()
    await page.getByLabel(/^Note/).fill('stem typo')
    await page.getByLabel(/^Note/).press('Tab')
    await expect(page.getByRole('status')).toContainText('Saved #1: fail')
    await page.reload()
    await expect(page.getByRole('radio', { name: 'fail' })).toBeChecked()
    await expect(page.getByLabel(/^Note/)).toHaveValue('stem typo')
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export JSON' }).click()])
    const path = await download.path()
    const { readFileSync } = await import('node:fs')
    const doc = JSON.parse(readFileSync(path, 'utf8')) as { schema: string; reviewer: string; verdicts: { item_id: string; verdict: string; note: string }[]; families: { family: string; fail: number }[] }
    expect(doc.schema).toBe('hb.g7_review.v1')
    expect(doc.reviewer).toBe('e2e-reviewer')
    expect(doc.verdicts).toEqual([expect.objectContaining({ item_id: expect.stringMatching(/^i:quant:[^:]+:review-quant-1$/), verdict: 'fail', note: 'stem typo' })])
    expect(doc.families.find((f) => f.family === 'quant')?.fail).toBe(1)
  })
})

test.describe('renderers at 360 px and 200% zoom, reduced motion, keyboard (chromium)', () => {
  test.skip(({ browserName, isMobile }) => browserName !== 'chromium' || isMobile, 'layout checks run once, in desktop Chromium')

  for (const width of [360, 640]) {
    test(`every renderer fits ${width} px without sideways scrolling`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      for (const family of Object.keys(DRIVERS)) {
        await openFamily(page, family)
        await DRIVERS[family]?.(page)
        const overflow = await page.evaluate(() => {
          const r = document.querySelector('.hb-render')?.getBoundingClientRect()
          return { page: document.documentElement.scrollWidth - window.innerWidth, right: (r?.right ?? 0) - window.innerWidth }
        })
        expect(overflow.page, family).toBeLessThanOrEqual(0)
        expect(overflow.right, family).toBeLessThanOrEqual(0)
      }
    })
  }

  test('prefers-reduced-motion turns renderer transitions off', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openFamily(page, 'series')
    const reduced = await page.locator('.hb-render .hb-btn').first().evaluate((el) => getComputedStyle(el).transitionDuration)
    expect(reduced).toBe('0s')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await openFamily(page, 'series')
    const normal = await page.locator('.hb-render .hb-btn').first().evaluate((el) => getComputedStyle(el).transitionDuration)
    expect(normal).not.toBe('0s')
  })

  test('digit span runs from the keyboard alone', async ({ page }) => {
    await openFamily(page, 'span_fwd')
    const start = page.getByRole('button', { name: 'Start' }).first()
    await start.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByText(/^Enter 3 digits/)).toBeVisible({ timeout: 15_000 })
    await page.keyboard.type('123')
    await expect(page.getByRole('list', { name: /Your entry, 3 of 3 digits/ })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.getByText(/Next sequence coming up|Watch the digits/)).toBeVisible()
  })

  test('simple RT responds to the Space bar', async ({ page }) => {
    await openFamily(page, 'rt_simple')
    await page.getByLabel('Keyboard').check()
    await page.getByRole('button', { name: 'Start practice' }).first().click()
    await expect(page.locator('.pad.on')).toBeVisible({ timeout: 5_000 })
    await page.keyboard.press('Space')
    await expect(page.locator('.pad.on')).toHaveCount(0)
    await expect(page.getByText(/^Practice 2 of 3/)).toBeVisible()
  })
})

test.describe('stable SVG renderers look the same on every load', () => {
  test.skip(({ browserName, isMobile }) => browserName !== 'chromium' || isMobile, 'pixel checks run in desktop Chromium')

  async function boardShot(page: Page): Promise<Buffer> {
    await openFamily(page, 'corsi')
    await page.getByRole('button', { name: 'Start' }).first().click()
    const board = page.getByRole('group', { name: /Board of 9 blocks/ })
    await expect(page.getByText('Selected 0 of 3.')).toBeVisible({ timeout: 15_000 })
    await page.mouse.move(0, 0)
    return board.screenshot({ animations: 'disabled', caret: 'hide' })
  }

  test('the Corsi board and the coding legend are pixel-stable', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
    const a = await boardShot(page)
    const b = await boardShot(page)
    expect(a.equals(b)).toBe(true)
    await openFamily(page, 'coding')
    const legend = page.getByRole('list', { name: /Key: each shape and its digit/ })
    const c = await legend.screenshot({ animations: 'disabled' })
    await page.reload()
    const d = await page.getByRole('list', { name: /Key: each shape and its digit/ }).screenshot({ animations: 'disabled' })
    expect(c.equals(d)).toBe(true)
    if (process.platform === 'darwin') {
      // Baselines are recorded on macOS Chromium (npx playwright test e2e/gallery.spec.ts --update-snapshots).
      expect(a).toMatchSnapshot('corsi-board.png')
      expect(c).toMatchSnapshot('coding-legend.png')
    }
  })
})
