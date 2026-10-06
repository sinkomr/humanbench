/// <reference lib="dom" />
/**
 * The renderer fixes of the UX review (web/ux-review/triage.json, area "render"; DESIGN §3, §10, §13)
 * in a real browser, on the production build, through the session (`?fast=1` for the blocks): timed
 * blocks that start with everything on screen on a phone (UX-002), the reading questions that Enter
 * cannot submit by accident (UX-019), matrix options drawn at the scale of the grid (UX-020), one
 * primary button and one focus ring on the item screens, and a double tap that selects nothing on the
 * next item (UX-021), named focus targets in the timed blocks (UX-022), 44 px Corsi blocks with Done
 * in the first screen (UX-023), number entry (UX-024), and no empty frames without WebGL (UX-017b).
 * The unit side of each is in `src/render/**` (`*.dom.test.ts`).
 */

import { expect, test, type Locator, type Page } from '@playwright/test'
import { ROTATION_UNAVAILABLE } from '../src/render/rotation/copy'
import { button, h1, toReady } from './flow'
import { SEGMENT_TITLES, intoSegment } from './routes'
import { SessionDriver, type Screen } from './session-driver'

const PHONES = [
  { name: '390 x 664 (iPhone 13)', width: 390, height: 664 },
  { name: '320 x 568', width: 320, height: 568 },
] as const

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

const viewport = (page: Page): Promise<{ w: number; h: number }> => page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))

/** The page is not wider than the window (WCAG 1.4.10 reflow). */
async function noSidewaysScroll(page: Page, where: string): Promise<void> {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(over, `${where} scrolls sideways`).toBeLessThanOrEqual(0)
}

/** Played into the session on `?fast=1`, skipping the parts before segment `index`, until a screen of kind `until` is up (as `routes.ts`). */
async function playInto(page: Page, index: number, until: Screen): Promise<SessionDriver> {
  const driver = new SessionDriver(page, { touch: test.info().project.use.isMobile === true })
  await driver.toReady('./?fast=1')
  await driver.begin()
  for (let i = 0; i < index; i++) {
    await expect(h1(page)).toHaveText(`Up next: ${SEGMENT_TITLES[i]}`)
    await driver.skipPart()
  }
  await expect(h1(page)).toHaveText(`Up next: ${SEGMENT_TITLES[index]}`)
  await driver.press(button(page, 'Start'))
  for (let step = 0; step < 40 && (await driver.screen()) !== until; step++) await driver.step()
  expect(await driver.screen(), `played on in ${SEGMENT_TITLES[index]} and never reached a ${until} screen`).toBe(until)
  return driver
}

// ------------------------------------------------------------------------------ UX-002, UX-022

test.describe('the coding block (UX-002, UX-022, UX-025)', () => {
  for (const size of PHONES) {
    test(`the table, the shape and the keypad are all on screen when the clock starts, ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      await intoSegment(page, 5)
      await expect(page.locator('.coding .title')).toHaveText('Shape to digit')
      await button(page, 'Start').click()
      await expect(page.getByRole('timer')).toBeVisible()
      const { h } = await viewport(page)
      await expect
        .poll(async () => {
          const [legend] = await boxes(page, '.coding .legend')
          const keys = await boxes(page, '.coding .keypad button')
          return legend !== undefined && legend.top >= -0.5 && keys.length === 9 && keys.every((k) => k.bottom <= h + 0.5)
        }, { message: 'the table is at the top of the screen and the last key is not below the bottom', timeout: 5000 })
        .toBe(true)
      const [legend] = await boxes(page, '.coding .legend')
      const [stage] = await boxes(page, '.coding .stage')
      const keys = await boxes(page, '.coding .keypad button')
      expect(stage!.top, 'the shape is on screen').toBeGreaterThanOrEqual(-0.5)
      expect(stage!.bottom).toBeLessThanOrEqual(h + 0.5)
      // One row of nine keys, each at least a finger tall and wide enough for WCAG 2.5.8.
      expect(Math.max(...keys.map((k) => k.top)) - Math.min(...keys.map((k) => k.top))).toBeLessThan(2)
      for (const k of keys) {
        expect(k.height).toBeGreaterThanOrEqual(43.5)
        expect(k.width).toBeGreaterThanOrEqual(24)
      }
      // Key, shape and keypad together stay within the budget that fits the shortest phone.
      expect(keys.at(-1)!.bottom - legend!.top).toBeLessThan(468)
      // The table is a reference strip: nothing in it can be pressed.
      await expect(page.locator('.coding .legend').locator('button, [role="button"]')).toHaveCount(0)
      await expect(page.getByRole('list', { name: 'Shape-to-digit table' })).toBeVisible()
      await noSidewaysScroll(page, 'the coding block')
      // The stage that took focus has a name and does not zoom on a quick second tap.
      const stageEl = page.getByRole('group', { name: 'Shapes: type the digit for each shape' })
      await expect(stageEl).toBeFocused()
      expect(await stageEl.evaluate((el) => getComputedStyle(el).touchAction)).toBe('manipulation')
      expect(await page.getByRole('group', { name: 'Digit keypad' }).evaluate((el) => getComputedStyle(el).touchAction)).toBe('manipulation')
    })
  }
})

test.describe('the other timed stages start in view and have names (UX-002, UX-022)', () => {
  for (const size of PHONES) {
    test(`reaction time and digit span, ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      // Reaction Time: the stage that takes focus when the practice starts.
      await intoSegment(page, 0)
      await button(page, 'Start practice').click()
      const rt = page.getByRole('group', { name: /^Reaction stage: (press Space|tap the target)/ })
      await expect(rt).toBeFocused()
      const { h } = await viewport(page)
      const [rtBox] = await boxes(page, '.rt .stage')
      expect(rtBox!.top).toBeGreaterThanOrEqual(-0.5)
      expect(rtBox!.bottom).toBeLessThanOrEqual(h + 0.5)
      expect(await rt.evaluate((el) => getComputedStyle(el).touchAction)).toBe('manipulation')
      await expect(page.locator('.rt .progress span[translate="no"]')).toHaveCount(2)
      // The two headings are not the same words: the session's h1 says "Reaction Time", the block says what is different.
      await expect(h1(page)).toHaveText('Reaction Time')
      await expect(page.locator('.rt .title')).toHaveText('One position')
    })

    test(`digit span: the display is named, in view, and the status line is live from the start, ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height })
      await intoSegment(page, 3)
      const status = page.locator('.span .hb-status')
      await expect(status).toHaveAttribute('aria-live', 'polite')
      await expect(status).toHaveText('')
      await expect(page.locator('.span .hb-instructions')).toContainText('Press Enter when you are done; Backspace removes the last digit.')
      await button(page, 'Start').click()
      const stage = page.getByRole('group', { name: /^Digits: watch them, then type them in (reverse )?order$/ })
      await expect(stage).toBeFocused()
      const { h } = await viewport(page)
      const [box] = await boxes(page, '.span .stage')
      expect(box!.top).toBeGreaterThanOrEqual(-0.5)
      expect(box!.bottom).toBeLessThanOrEqual(h + 0.5)
      await expect(status).toHaveText('Watch the digits.')
      await expect(status).toHaveText(/^Enter \d+ digits/, { timeout: 30_000 })
      expect(await page.getByRole('group', { name: 'Digit keypad' }).evaluate((el) => getComputedStyle(el).touchAction)).toBe('manipulation')
    })
  }
})

// ------------------------------------------------------------------------------------ UX-023

test.describe('Corsi blocks (UX-023)', () => {
  for (const size of PHONES) {
    test(`44 px blocks that do not overlap, and Done in the first screen, ${size.name}`, async ({ page }) => {
      test.setTimeout(150_000)
      await page.setViewportSize({ width: size.width, height: size.height })
      await playInto(page, 3, 'corsi')
      await button(page, 'Start').click()
      await expect(page.locator('.corsi .hb-status')).toHaveText(/^Selected 0 of \d+\./, { timeout: 30_000 })
      const blocks = await boxes(page, '.corsi button.block')
      expect(blocks).toHaveLength(9)
      for (const b of blocks) {
        expect(b.width).toBeGreaterThanOrEqual(43.5)
        expect(b.height).toBeGreaterThanOrEqual(43.5)
      }
      for (let i = 0; i < blocks.length; i++) {
        for (let j = i + 1; j < blocks.length; j++) {
          const a = blocks[i]!
          const b = blocks[j]!
          const apart = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top
          expect(apart, `blocks ${i + 1} and ${j + 1} overlap`).toBe(true)
        }
      }
      // Every block lies on its board.
      const [board] = await boxes(page, '.corsi .board')
      for (const b of blocks) {
        expect(b.left).toBeGreaterThanOrEqual(board!.left - 0.5)
        expect(b.right).toBeLessThanOrEqual(board!.right + 0.5)
        expect(b.top).toBeGreaterThanOrEqual(board!.top - 0.5)
        expect(b.bottom).toBeLessThanOrEqual(board!.bottom + 0.5)
      }
      // With the heading at the top of the screen, Undo and Done are in that first screen too (nothing to scroll for after each sequence).
      // The stricter reading, with the page itself at its top (the session bar above the heading), is in ux2-render.spec.ts.
      await page.evaluate(() => document.querySelector('h1')?.scrollIntoView({ block: 'start' }))
      const { h } = await viewport(page)
      const actions = await boxes(page, '.corsi .hb-actions button')
      expect(actions).toHaveLength(2)
      for (const a of actions) expect(a.bottom, 'Done is below the first screen').toBeLessThanOrEqual(h + 0.5)
      expect(await page.locator('.corsi .board').evaluate((el) => getComputedStyle(el).touchAction)).toBe('manipulation')
      await noSidewaysScroll(page, 'the Corsi block')
    })
  }
})

// ------------------------------------------------------------------------------------ UX-019

test.describe('reading questions (UX-019)', () => {
  test('Enter on an option moves on and never submits; submitting with blank questions asks first; the labels read right', async ({ page }) => {
    test.setTimeout(150_000)
    await page.setViewportSize({ width: 390, height: 844 })
    await playInto(page, 5, 'reading')
    const reading = page.locator('section.hb-render.reading')
    await expect(reading.locator('.hb-instructions')).toContainText('Choose Done reading when you reach the end.')
    await reading.getByRole('button', { name: 'Show the passage' }).click()
    await expect(reading.getByRole('button', { name: 'Done reading' })).toBeEnabled()
    await reading.getByRole('button', { name: 'Done reading' }).click()

    const groups = reading.locator('fieldset.question')
    await expect(groups).toHaveCount(3)
    const first = (i: number): Locator => groups.nth(i).getByRole('radio').first()
    const submit = reading.getByRole('button', { name: 'Submit answers' })
    const count = reading.locator('.hb-status[aria-live="polite"]')

    // The question legends sit inside their frames.
    for (let i = 0; i < 3; i++) {
      const [frame, legend] = await Promise.all([groups.nth(i).boundingBox(), groups.nth(i).locator('legend').boundingBox()])
      expect(legend!.y, `legend ${i + 1} cuts through its frame`).toBeGreaterThanOrEqual(frame!.y + 2)
      expect(legend!.y + legend!.height).toBeLessThan(frame!.y + frame!.height)
    }

    await expect(count).toHaveText('3 questions not answered yet.')
    await first(0).focus()
    await page.keyboard.press('Space')
    await expect(count).toHaveText('2 questions not answered yet.')
    // Enter: on to question 2, nothing submitted.
    await page.keyboard.press('Enter')
    await expect(first(1)).toBeFocused()
    await expect(reading.locator('form.questions')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(first(2)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(submit).toBeFocused()
    await expect(reading.locator('form.questions')).toBeVisible()

    // Submit with two questions blank: asked once, in an alert, and the questions are still there.
    await page.keyboard.press('Enter')
    await expect(reading.getByRole('alert')).toHaveText('2 questions are not answered yet. Choose Submit answers again to submit anyway, or answer them first.')
    await expect(reading.locator('form.questions')).toBeVisible()
    // Answering one of them clears the alert and the count follows.
    await first(1).focus()
    await page.keyboard.press('Space')
    await expect(reading.getByRole('alert')).toHaveCount(0)
    await expect(count).toHaveText('1 question not answered yet.')
    await submit.focus()
    await page.keyboard.press('Enter')
    await expect(reading.getByRole('alert')).toHaveText('1 question is not answered yet. Choose Submit answers again to submit anyway, or answer it first.')
    // The second press goes through: the reading block is the last one, so the session is complete.
    await page.keyboard.press('Enter')
    await expect(h1(page)).toHaveText('Session complete', { timeout: 30_000 })
  })

  test('every question answered: one press of Submit answers finishes the block', async ({ page }) => {
    test.setTimeout(150_000)
    await playInto(page, 5, 'reading')
    const reading = page.locator('section.hb-render.reading')
    await reading.getByRole('button', { name: 'Show the passage' }).click()
    await expect(reading.getByRole('button', { name: 'Done reading' })).toBeEnabled()
    await reading.getByRole('button', { name: 'Done reading' }).click()
    for (const group of await reading.locator('fieldset.question').all()) await group.getByRole('radio').first().check()
    await expect(reading.locator('.hb-status')).toHaveText('')
    await reading.getByRole('button', { name: 'Submit answers' }).click()
    await expect(h1(page)).toHaveText('Session complete', { timeout: 30_000 })
  })
})

// ------------------------------------------------------------------------------------ UX-020

test.describe('matrix options are drawn at the scale of the grid (UX-020)', () => {
  const SIZES = [
    { width: 1280, height: 900 },
    { width: 768, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ] as const

  for (const size of SIZES) {
    test(`grid cells and option figures are the same width, on one left edge, at ${size.width} px`, async ({ page }) => {
      await page.setViewportSize(size)
      await toReady(page)
      await button(page, 'Try practice questions first').click()
      await expect(page.locator('div.matrix')).toBeVisible()
      const cells = await boxes(page, '.matrix .grid svg')
      const figures = await boxes(page, '.matrix form.choice .figure svg')
      expect(cells).toHaveLength(9)
      expect(figures).toHaveLength(6)
      const cell = cells[0]!.width
      for (const f of figures) expect(Math.abs(f.width - cell) / cell, `an option figure is ${f.width} px wide, a grid cell ${cell} px`).toBeLessThanOrEqual(0.05)
      const [grid] = await boxes(page, '.matrix .grid')
      const [options] = await boxes(page, '.matrix .options')
      expect(Math.abs(grid!.left - options!.left), 'grid and options start at the same edge').toBeLessThanOrEqual(1)
      expect(Math.abs(grid!.width - options!.width), 'grid and options are as wide as each other').toBeLessThanOrEqual(1)
      // Two rows of three, however wide the page.
      expect(new Set(figures.map((f) => Math.round(f.top))).size).toBe(2)
      await noSidewaysScroll(page, 'a matrix item')
    })
  }
})

// ------------------------------------------------------------------------------------ UX-021

test.describe('option groups share the session\'s primary button and focus ring (UX-021)', () => {
  test('Confirm is the primary blue and looks disabled until an option is chosen; the chosen card is marked by more than colour', async ({ page }) => {
    await toReady(page)
    await button(page, 'Try practice questions first').click()
    await expect(page.locator('div.matrix')).toBeVisible()
    const form = page.locator('form.choice')
    const confirm = form.getByRole('button', { name: 'Confirm' })
    const accent = await form.evaluate((el) => getComputedStyle(el).getPropertyValue('--r-accent').trim())
    const rgb = (hex: string): string => {
      const n = Number.parseInt(hex.slice(1), 16)
      return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
    }
    await expect(confirm).toHaveClass(/hb-btn/)
    await expect(confirm).toHaveClass(/hb-primary/)
    await expect(confirm).toBeDisabled()
    expect(await confirm.evaluate((el) => getComputedStyle(el).opacity)).toBe('0.6')
    expect(await confirm.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(rgb(accent))
    await form.getByRole('radio').nth(2).check()
    await expect(confirm).toBeEnabled()
    expect(await confirm.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
    // Chosen is shown by more than colour: a thicker frame round the card and the inverted letter.
    const chosen = await form.getByRole('radio').nth(2).evaluate((el) => {
      const card = el.nextElementSibling as HTMLElement
      return { shadow: getComputedStyle(card).boxShadow, letterBg: getComputedStyle(card.querySelector('.letter') as Element).backgroundColor }
    })
    expect(chosen.shadow).not.toBe('none')
    expect(chosen.letterBg).not.toBe('rgba(0, 0, 0, 0)')
  })

  test('the focus ring of an option card is the amber ring of every other control', async ({ page, browserName, isMobile }) => {
    test.skip(isMobile || browserName !== 'chromium', 'a keyboard ring is checked in desktop Chromium')
    await toReady(page)
    await button(page, 'Try practice questions first').click()
    await expect(page.locator('div.matrix')).toBeVisible()
    const form = page.locator('form.choice')
    const focus = await form.evaluate((el) => getComputedStyle(el).getPropertyValue('--r-focus').trim())
    const n = Number.parseInt(focus.slice(1), 16)
    await form.getByRole('radio').nth(1).focus()
    await page.keyboard.press('ArrowRight')
    const ring = await form.getByRole('radio').nth(2).evaluate((el) => {
      const s = getComputedStyle(el.nextElementSibling as HTMLElement)
      return { color: s.outlineColor, width: Number.parseFloat(s.outlineWidth), style: s.outlineStyle }
    })
    expect(ring).toEqual({ color: `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`, width: 3, style: 'solid' })
  })

  test('the second tap of a double tap on the confidence Continue selects nothing on the next item', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'a double tap is a touch gesture')
    test.setTimeout(150_000)
    // When each choice group appeared and when each press landed, on the page's own clock.
    await page.addInitScript(() => {
      const w = window as unknown as { __groupAt: number; __presses: { at: number; sinceGroup: number }[] }
      w.__groupAt = 0
      w.__presses = []
      new MutationObserver((records) => {
        for (const r of records) for (const n of r.addedNodes) if (n instanceof Element && (n.matches('form.choice') || n.querySelector('form.choice'))) w.__groupAt = performance.now()
      }).observe(document, { childList: true, subtree: true })
      document.addEventListener('pointerdown', () => w.__presses.push({ at: performance.now(), sinceGroup: performance.now() - w.__groupAt }), true)
    })
    const driver = new SessionDriver(page, { touch: true })
    await driver.toReady('./?fast=1')
    await driver.begin()
    await driver.skipPart()
    await expect(h1(page)).toHaveText('Up next: Matrix & Series')
    await driver.press(button(page, 'Start'))
    let verified = 0
    for (let item = 0; item < 16 && verified === 0; item++) {
      for (let guard = 0; guard < 10 && (await driver.screen()) !== 'confidence'; guard++) await driver.step()
      await expect(page.getByRole('slider')).toBeVisible()
      const box = (await button(page, 'Continue').boundingBox())!
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      // The first tap of the double tap: on Continue, which brings up the next item.
      await page.touchscreen.tap(x, y)
      await expect(page.getByRole('slider')).toHaveCount(0)
      if ((await driver.screen()) !== 'choice') continue
      // The second tap, at the same spot, a moment later. Whatever the next item has under that spot is what the finger lands on, so
      // the page is scrolled until an option is there (a person's finger would have met an item laid out so by luck: SKIM-15).
      const option = (await page.locator('form.choice input[type=radio]').first().boundingBox())!
      await page.evaluate((dy) => window.scrollBy(0, dy), option.y + option.height / 2 - y)
      const under = await page.evaluate(([px, py]) => {
        const el = document.elementFromPoint(px!, py!)
        return el instanceof HTMLInputElement && el.type === 'radio' && el.matches(':enabled')
      }, [x, y])
      if (!under) continue
      await page.touchscreen.tap(x, y)
      const press = await page.evaluate(() => (window as unknown as { __presses: { sinceGroup: number }[] }).__presses.at(-1)!)
      // A machine too slow to get the second tap in within the guard's 350 ms proves nothing: try the next item.
      if (press.sinceGroup > 300) continue
      // At once, not with a retry: under ?fast=1 the item times out in a few seconds and the next one starts with nothing chosen.
      await page.waitForTimeout(100)
      expect(await page.locator('form.choice input[type=radio]:checked').count(), 'the second tap chose an option of the next item').toBe(0)
      verified++
    }
    expect(verified, 'no item gave a double tap to check in 16 items').toBe(1)
  })
})

// ------------------------------------------------------------------------------------ UX-017b

test.describe('rotation without WebGL (UX-017b)', () => {
  test('nothing is drawn but the one-line note: no empty frames, no options, no Confirm', async ({ page }) => {
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null
        return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest) as never
      } as typeof orig
    })
    await intoSegment(page, 2)
    const rotation = page.locator('div.rotation')
    // The renderer's note is still written, but the session parks the renderer (hidden) and says it on its own panel (UX-017a).
    await expect(rotation.getByRole('status', { includeHidden: true })).toHaveText(ROTATION_UNAVAILABLE, { timeout: 30_000 })
    await expect(rotation).toBeHidden()
    await expect(rotation.locator('canvas')).toHaveCount(0)
    await expect(rotation.getByRole('img')).toHaveCount(0)
    await expect(rotation.getByRole('radio')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0)
    await expect(page.locator('.unavailable')).toBeVisible()
  })
})

test.describe('rotation while the figures load (UX-017b)', () => {
  test('the target box says so while the three-view chunk is on its way, and the line is gone once it has arrived', async ({ page }) => {
    let release: () => void = () => undefined
    const arrived = new Promise<void>((resolve) => (release = resolve))
    await page.route(/\/assets\/three-view-[^/]+\.js$/, async (route) => {
      await arrived
      await route.continue()
    })
    try {
      await intoSegment(page, 2)
      const rotation = page.locator('div.rotation')
      await expect(rotation.locator('.frame').getByText('Loading figures…')).toBeVisible()
      await expect(rotation.getByRole('radio').first()).toBeDisabled()
      await expect(rotation.getByRole('img', { name: /^Target: a 3D object/ })).toBeVisible()
    } finally {
      release()
    }
    await expect(page.locator('div.rotation').getByText('Loading figures…')).toHaveCount(0, { timeout: 30_000 })
  })
})

// ------------------------------------------------------------------------------------ UX-024

test.describe('number entry (UX-024)', () => {
  test('digits of another script are read, an unreadable entry gets a note that names the rule, and the box is short', async ({ page }) => {
    await intoSegment(page, 4)
    const entry = page.locator('form.entry')
    const box = entry.getByRole('textbox')
    await expect(entry).toBeVisible()
    const fraction = await box.evaluate((el) => el.classList.contains('fraction'))
    if (!fraction) expect((await box.boundingBox())!.width).toBeLessThanOrEqual(193)
    // Nothing a person types in a number box is a letter of the Latin alphabet.
    await box.fill('abc')
    await box.press('Enter')
    await expect(entry.locator('.hb-note')).toContainText(/Use (only the digits 0 to 9|a fraction such as 3\/8)/)
    await expect(page.getByRole('slider')).toHaveCount(0)
    // Arabic-Indic digits are the digits 35: accepted, and the slider follows.
    await box.fill('٣٥')
    await box.press('Enter')
    await expect(page.getByRole('slider')).toBeVisible()
  })
})
