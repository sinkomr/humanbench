/// <reference lib="dom" />
/**
 * Wave 2 of the renderer fixes of the UX review (web/ux-review/fixes/w2-render.json), in a real browser, on the
 * production build, through the session (`?fast=1`):
 *
 * - UX-023, the rest of it: the Corsi board on an iPhone SE sized screen (320 x 568) and on an iPhone 13 (390 x 664),
 *   measured as the verifier did (web/ux-review/personas/verify-render.ux.ts): the fast-mode banner hidden (a dev-only
 *   strip, production has none), the page at its top, Done's bottom against `innerHeight`. Every frame of the block is
 *   sampled from before the first sequence to after Done, so the sequence, the pause and the next trial are all
 *   measured, not only the moment the taker may answer. Done is inside the first screen in all of them, the board does
 *   not move when Done is pressed, every block is 44 px or larger with no overlaps, the board is centred, and the page
 *   does not scroll sideways.
 * - OptionGroup's card border, which is the dark value for screens only: on paper it is the light one, whatever the
 *   screen's scheme (the same rule as app.css and render.css).
 *
 * The unit side is in `src/render/span/span.dom.test.ts` and `src/render/choice/OptionGroup.dom.test.ts`; the
 * wave 1 checks of the same items are in `ux-render.spec.ts`.
 */

import { expect, test, type Locator, type Page } from '@playwright/test'
import { CORSI_BOARD } from '../src/tasks/span/config'
import { button, h1 } from './flow'
import { SEGMENT_TITLES, intoSegment } from './routes'
import { SessionDriver, type Screen } from './session-driver'

const VIEWPORTS = [
  { name: '390 x 664 (iPhone 13)', width: 390, height: 664 },
  { name: '320 x 568 (iPhone SE)', width: 320, height: 568 },
] as const

interface Box {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
  readonly width: number
  readonly height: number
}

/** One animation frame of the Corsi block: what is on screen and where (viewport coordinates). */
interface Sample {
  readonly status: string
  readonly board: Box
  readonly slot: Box | null
  readonly done: Box | null
  readonly undo: Box | null
  readonly scrollY: number
  readonly innerHeight: number
  readonly scrollWidth: number
  readonly clientWidth: number
  readonly docHeight: number
}

/**
 * Records, on every animation frame from the moment it is installed, where the Corsi board, the row of Undo and Done
 * and the buttons are. It only reads the layout: nothing of the renderer's own timing is touched.
 */
const SAMPLER = `(() => {
  const log = []
  window.__corsiLog = log
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }
  }
  const tick = () => {
    const board = document.querySelector('.corsi .board')
    if (board) {
      const buttons = [...document.querySelectorAll('.corsi .hb-actions button')]
      const named = (name) => buttons.find((b) => (b.textContent || '').trim() === name) || null
      log.push({
        status: ((document.querySelector('.corsi .hb-status') || {}).textContent || '').trim(),
        board: box(board),
        slot: box(document.querySelector('.corsi .hb-actions')),
        done: box(named('Done')),
        undo: box(named('Undo')),
        scrollY: window.scrollY,
        innerHeight: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        docHeight: document.documentElement.scrollHeight,
      })
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})()`

/** Played into the session on `?fast=1`, skipping the parts before segment `index`, until a screen of kind `until` is up (as `routes.ts`). */
async function playInto(page: Page, index: number, until: Screen): Promise<void> {
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
}

const spread = (values: readonly number[]): number => Math.max(...values) - Math.min(...values)

// ------------------------------------------------------------------------------------ UX-023

for (const size of VIEWPORTS) {
  test.describe(`Corsi board at ${size.name} (UX-023)`, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    test('Done is in the first screen from the first sequence to after Done, and the board does not move', async ({ page }) => {
      test.setTimeout(150_000)
      const touch = test.info().project.use.hasTouch === true
      const press = (target: Locator): Promise<void> => (touch ? target.tap() : target.click())
      await playInto(page, 3, 'corsi')
      // The same screen without the fast-mode banner (production has none), the page at its top: as the verifier measured.
      await page.addStyleTag({ content: '.banner[role=note] { display: none !important; }' })
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.evaluate(SAMPLER)
      await press(button(page, 'Start'))

      // The first sequence plays, then the taker may answer.
      const status = page.locator('.corsi .hb-status')
      await expect(status).toHaveText(/^Selected 0 of \d+\./, { timeout: 30_000 })
      const length = Number(/of (\d+)\./.exec((await status.textContent()) ?? '')?.[1])
      expect(length).toBeGreaterThanOrEqual(2)

      // The state the verifier measured: nine blocks, none under 44 px, none touching, all on the board, Done in the first screen.
      const entry = await page.evaluate<{ blocks: Box[]; board: Box; done: Box; undo: Box; innerWidth: number; innerHeight: number; scrollY: number; scrollWidth: number; clientWidth: number }>(`(() => {
        const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height } }
        const named = (name) => box([...document.querySelectorAll('.corsi .hb-actions button')].find((b) => b.textContent.trim() === name))
        return {
          blocks: [...document.querySelectorAll('.corsi button.block')].map(box),
          board: box(document.querySelector('.corsi .board')),
          done: named('Done'),
          undo: named('Undo'),
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          scrollY: window.scrollY,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }
      })()`)
      const { blocks, board } = entry
      expect(blocks).toHaveLength(9)
      for (const b of blocks) {
        expect(b.width, 'a block is narrower than 44 px').toBeGreaterThanOrEqual(43.99)
        expect(b.height, 'a block is shorter than 44 px').toBeGreaterThanOrEqual(43.99)
      }
      for (let i = 0; i < blocks.length; i++) {
        for (let j = i + 1; j < blocks.length; j++) {
          const a = blocks[i]!
          const b = blocks[j]!
          const apart = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top
          expect(apart, `blocks ${i + 1} and ${j + 1} overlap`).toBe(true)
        }
      }
      // Inside the board's border, not merely inside its outer edge (2px border each side).
      for (const b of blocks) {
        expect(b.left).toBeGreaterThanOrEqual(board.left + 2 - 0.5)
        expect(b.right).toBeLessThanOrEqual(board.right - 2 + 0.5)
        expect(b.top).toBeGreaterThanOrEqual(board.top + 2 - 0.5)
        expect(b.bottom).toBeLessThanOrEqual(board.bottom - 2 + 0.5)
      }
      // The centres are still where the spec puts them (the hit areas keep their proportion), to a pixel.
      const inner = board.width - 4
      CORSI_BOARD.blocks.forEach(([x, y], i) => {
        const b = blocks[i]!
        expect(Math.abs((b.left + b.right) / 2 - (board.left + 2 + x * inner)), `block ${i + 1} centre, x`).toBeLessThanOrEqual(1)
        expect(Math.abs((b.top + b.bottom) / 2 - (board.top + 2 + y * inner)), `block ${i + 1} centre, y`).toBeLessThanOrEqual(1)
      })
      // The board is square, in the middle of the screen, and the page does not scroll sideways.
      expect(Math.abs(board.width - board.height)).toBeLessThanOrEqual(1)
      expect(Math.abs((board.left + board.right) / 2 - entry.clientWidth / 2), 'the board is off centre').toBeLessThanOrEqual(1)
      expect(entry.scrollWidth - entry.clientWidth, 'the page scrolls sideways').toBeLessThanOrEqual(0)
      // Done, measured as the verifier did: its bottom against the height of the window, the page at its top.
      expect(entry.scrollY, 'the page had to scroll').toBe(0)
      expect(entry.done.bottom, `Done's bottom (${entry.done.bottom}) is below the first screen (${entry.innerHeight})`).toBeLessThanOrEqual(entry.innerHeight)
      expect(entry.undo.bottom).toBeLessThanOrEqual(entry.innerHeight)
      expect(entry.done.height).toBeGreaterThanOrEqual(43.99)

      // Pick `length` blocks and press Done; the next sequence plays on the same board.
      const marked = await page.evaluate<number>('window.__corsiLog.length')
      for (let k = 0; k < length; k++) await press(page.locator('.corsi button.block').nth(k))
      await press(page.locator('.corsi').getByRole('button', { name: 'Done' }))
      await expect(page.locator('.corsi').getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 30_000 })
      await expect(status).toHaveText(/^Selected 0 of \d+\./)
      await page.waitForTimeout(100)

      const log = await page.evaluate<Sample[]>('window.__corsiLog')
      const phases = new Set(log.map((s) => (s.status.startsWith('Selected') ? 'entry' : s.status)))
      expect(phases, 'the sampler saw the sequence and the entry').toContain('Watch the blocks.')
      expect(phases).toContain('entry')
      // Frames from before Done to after it: the buttons were there, then gone (pause), then back for the next trial.
      const after = log.slice(marked)
      expect(after.some((s) => s.done === null), 'the pause after Done was not sampled').toBe(true)
      expect(after.at(-1)?.done, 'Done did not come back for the next trial').not.toBeNull()

      // In every frame: the row of Undo and Done is inside the first screen, so is Done where it is, and the page never scrolled.
      for (const s of log) {
        expect(s.slot, `no row of buttons while "${s.status}"`).not.toBeNull()
        expect(s.slot!.bottom, `the row of Undo and Done is below the first screen while "${s.status}"`).toBeLessThanOrEqual(s.innerHeight)
        if (s.done !== null) expect(s.done.bottom, `Done is below the first screen while "${s.status}"`).toBeLessThanOrEqual(s.innerHeight)
        expect(s.scrollY, `the page scrolled while "${s.status}"`).toBe(0)
        expect(s.scrollWidth - s.clientWidth).toBeLessThanOrEqual(0)
      }
      // Nothing moves: the board's top and height are the same, within a pixel, in every frame, and so is the page's height.
      expect(spread(log.map((s) => s.board.top)), 'the board moved').toBeLessThanOrEqual(1)
      expect(spread(log.map((s) => s.board.height)), 'the board changed size').toBeLessThanOrEqual(1)
      expect(spread(log.map((s) => s.board.left)), 'the board moved sideways').toBeLessThanOrEqual(1)
      expect(spread(log.map((s) => s.docHeight)), 'the page changed height').toBeLessThanOrEqual(1)
      // The row of Undo and Done stays where it was when its buttons are not there, and the buttons are inside it.
      expect(spread(log.map((s) => s.slot!.top)), 'the row of Undo and Done moved').toBeLessThanOrEqual(1)
      expect(spread(log.map((s) => s.slot!.height)), 'the row of Undo and Done changed height').toBeLessThanOrEqual(1)
      // The second trial's entry is the first's, to the pixel.
      const first = log.find((s) => s.done !== null)!
      const second = after.filter((s) => s.done !== null).at(-1)!
      expect(Math.abs(second.board.top - first.board.top)).toBeLessThanOrEqual(1)
      expect(Math.abs(second.done!.top - first.done!.top)).toBeLessThanOrEqual(1)
    })
  })
}

// ------------------------------------------------------------------------------------ OptionGroup on paper

test.describe('the option cards of a choice item (OptionGroup)', () => {
  test('keep the light border on paper, whatever the screen: the dark value is for screens only', async ({ page }) => {
    test.setTimeout(150_000)
    await page.setViewportSize({ width: 1024, height: 800 })
    await intoSegment(page, 2)
    const choice = page.locator('form.choice')
    await expect(choice.or(page.locator('.unavailable'))).toBeVisible({ timeout: 30_000 })
    test.skip((await choice.count()) === 0, 'this browser has no WebGL, so the spatial item is not drawn and there are no option cards')

    /** The form's border token and the first card's colours, as the browser resolves them under a medium and scheme. */
    const look = async (media: 'screen' | 'print', colorScheme: 'light' | 'dark'): Promise<{ token: string; border: string; borderWidth: string; surface: string }> => {
      await page.emulateMedia({ media, colorScheme, reducedMotion: 'reduce' })
      return choice.evaluate((form) => {
        const card = form.querySelector('.card') as HTMLElement
        const cs = getComputedStyle(card)
        return { token: getComputedStyle(form).getPropertyValue('--hb-card-border').trim(), border: cs.borderTopColor, borderWidth: cs.borderTopWidth, surface: cs.backgroundColor }
      })
    }

    const screenLight = await look('screen', 'light')
    const screenDark = await look('screen', 'dark')
    const paperLight = await look('print', 'light')
    const paperDark = await look('print', 'dark')

    expect(screenLight.token).toBe('#767676')
    expect(screenLight.border).toBe('rgb(118, 118, 118)')
    // On a dark screen the border is the lighter grey, drawn on the dark page.
    expect(screenDark.token).toBe('#8d8b95')
    expect(screenDark.border).toBe('rgb(141, 139, 149)')
    expect(screenDark.surface).not.toBe(screenLight.surface)
    // On paper, with a dark OS: the light border on the light card, as with no dark scheme at all.
    expect(paperDark.token).toBe('#767676')
    expect(paperDark.border).toBe(paperLight.border)
    expect(paperDark.border).toBe('rgb(118, 118, 118)')
    expect(paperDark.surface).toBe(paperLight.surface)
    expect(paperDark.surface).toBe('rgb(255, 255, 255)')
    expect(paperDark.borderWidth).toBe(screenDark.borderWidth)
  })
})
