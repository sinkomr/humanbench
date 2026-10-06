/// <reference lib="dom" />
/**
 * The results page after UX-REVIEW D16 A (the compact top, one column) and D11 B (the first-language note on the
 * reading line), in real browsers (chromium, the iPhone 13 emulation, WebKit for the layout):
 *
 * - **one column**: the h1, the lines under it, the save pointer, the practice note, the profile heading, the view toggle, the
 *   chart caption and the save panel share one left edge; the column is 52rem of content and centred, and 100% wide on a phone;
 * - **the chart** grows with the column up to 48rem; the facet chart under a cluster stays at 40rem; on a phone it fills the column;
 * - **the compact top**: the practice note is one line, Replay (Skip while it builds) is a 44 px control that only exists when
 *   there is something to replay, "Your profile is ready." is out of sight and still in the accessibility tree, the
 *   chart does not move when the build-up ends, and the start of the chart is on the first screen of a phone;
 * - **layout everywhere**: 320 px, 200% text, the wide font, dark mode and print have no sideways scroll, no clipped text and
 *   no serious axe issue;
 * - **D11 B**: the reading line ends with the first-language sentence.
 *
 * "measure" (not run unless `HB_REVEAL_MEASURE=<label>` is set, e.g. `before` or `after`): the figures the package
 * reports, written with screenshots to `web/test-results/ux-review/uxdec-reveal/<label>/`: what the first screen shows at
 * 390 × 664 and 320 × 568, at 1280 px, with 200% text and the wide font (`wide-font.ts`), in dark mode and in print.
 *
 * The e2e tsconfig has no DOM lib: page code that runs in the browser is passed as strings or as functions of the page.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectNoSeriousAxe } from './axe'
import { button, scheme, toResults } from './flow'
import { expectNoClippedText, expectNoSidewaysScroll, useTextZoom } from './layout'
import { measureResults, type ResultsMeasure } from './uxdec-reveal'
import { expectWideFont, useWideFont } from './wide-font'

const REM = 16
const status = (page: Page): Locator => page.locator('.reveal [role="status"]').first()

/** Two animation frames, three times over: the charts have measured their box and laid their text out. */
async function settle(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) await page.evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
}

/** The top of the chart in the page, CSS px (-1: no chart yet). */
const chartTop = (page: Page): Promise<number> =>
  page.evaluate<number>(`(() => { const el = document.querySelector('svg.hb-blob'); return el ? Math.round((el.getBoundingClientRect().top + scrollY) * 10) / 10 : -1 })()`)

/**
 * While the profile builds (sampled every 150 ms until it is built, the caption of the skill drawn changing under it) and once it
 * is built, the chart stays where it is: the row of controls and the save pointer take the same room in both states. Call it
 * with the build-up running (right after the results appear).
 */
async function expectStableChart(page: Page, where: string): Promise<void> {
  const reveal = page.locator('.reveal')
  await expect(reveal).toHaveAttribute('data-building', 'true')
  // The page's first layout is not part of what is watched: the system font (on Linux, a late-loading fallback face)
  // and the charts' own measuring of their box settle in the first frames, and a first sample taken before that read
  // 142 px higher than all the later ones on CI. What must not move is the chart once it is laid out.
  await page.evaluate('document.fonts.ready')
  await settle(page)
  const tops: number[] = []
  const until = Date.now() + 30_000
  while (Date.now() < until) {
    tops.push(await chartTop(page))
    if ((await reveal.getAttribute('data-building')) === 'false') break
    await page.waitForTimeout(150)
  }
  expect(tops.length, `${where}: the build-up was watched`).toBeGreaterThan(3)
  await expect(status(page)).toHaveText('Your profile is ready.')
  await settle(page)
  tops.push(await chartTop(page))
  const [min, max] = [Math.min(...tops), Math.max(...tops)]
  expect(min, `${where}: the chart is in the page`).toBeGreaterThan(0)
  expect(max - min, `${where}: the chart's top moved between ${min} and ${max} (${tops.join(', ')})`).toBeLessThanOrEqual(2)
}

interface Options {
  /** Switch the motion off: the profile is complete at once and there is no Replay (default false: the build-up runs, then is skipped). */
  readonly still?: boolean
  /** Sessions of the simulated save (2: the later practice wording). */
  readonly sessions?: 1 | 2
}

/** The results page with the profile built, at the window's current size. A test that visits it more than once starts each visit with nothing kept on the device. */
async function built(page: Page, { still = false, sessions = 1 }: Options = {}): Promise<void> {
  if (still) await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('./')
  await page.evaluate('localStorage.clear(); sessionStorage.clear()')
  await toResults(page, sessions)
  if (!still && (await button(page, 'Skip animation').count()) > 0) await button(page, 'Skip animation').click()
  await expect(status(page)).toHaveText('Your profile is ready.', { timeout: 30_000 })
  await expect(page.locator('figcaption').first()).toBeVisible()
  await settle(page)
}

/** Phones (the iPhone 13 emulation) and desktop windows are tested at their own sizes. */
const phoneSizes = [
  { width: 390, height: 664 },
  { width: 320, height: 568 },
] as const

// ------------------------------------------------------------------------------------ one column

test.describe('one column for the whole results page (D16)', () => {
  test('the h1, the lines under it, the pointer, the practice note, the heading, the toggle, the chart caption and the save panel share one left edge', async ({ page, isMobile }) => {
    const sizes = isMobile === true ? phoneSizes : [{ width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 768, height: 1024 }]
    for (const size of sizes) {
      await page.setViewportSize(size)
      await built(page, { still: true })
      const m = await measureResults(page)
      const where = `${size.width}x${size.height}`
      // The column's content box: 52rem and centred in a wide window; the window less 2 x 1rem of padding in a narrow one.
      const width = Math.min(52 * REM, size.width - 2 * REM)
      expect(m.column.w, `${where}: the column`).toBeCloseTo(width, 0)
      expect(m.column.x, `${where}: centred`).toBeCloseTo((size.width - width) / 2, 0)
      for (const [name, x] of Object.entries(m.leftEdges)) {
        if (name === 'saveHeading') continue // inside the save panel's border and padding
        expect(x, `${where}: the left edge of ${name}`).not.toBeNull()
        expect(x!, `${where}: the left edge of ${name}`).toBeCloseTo(m.column.x, 0)
      }
      // Every panel of the reveal has the column's left edge and its width, and none is wider.
      const panels = await page.locator('.hb-reveal-panel').evaluateAll((els) => els.map((el) => ({ x: el.getBoundingClientRect().left, w: el.getBoundingClientRect().width })))
      expect(panels.length, `${where}: the panels`).toBeGreaterThan(5)
      for (const p of panels) {
        expect(p.x, `${where}: a panel's left edge`).toBeCloseTo(m.column.x, 0)
        expect(p.w, `${where}: a panel's width`).toBeLessThanOrEqual(m.column.w + 0.5)
      }
      expect(m.sidewaysOverflow, `${where}: sideways scroll`).toBeLessThanOrEqual(0)
    }
  })

  test('the page is not the wide screen any more: its main block is 54rem at most (52rem of content), and a plain screen is as before', async ({ page, isMobile }) => {
    test.skip(isMobile === true, 'a wide window')
    await page.setViewportSize({ width: 1440, height: 900 })
    await built(page, { still: true })
    expect(await page.locator('main').evaluate((el) => el.getBoundingClientRect().width)).toBeCloseTo(54 * REM, 0)
    expect(await page.locator('main').evaluate((el) => el.classList.contains('wide'))).toBe(false)
  })
})

// ------------------------------------------------------------------------------------ the chart

test.describe('the chart box (D16)', () => {
  test('grows to 48rem in a wide window, follows the column in a narrower one and fills it on a phone', async ({ page, isMobile }) => {
    const cases = isMobile === true ? [{ width: 390, height: 664, expected: 390 - 2 * REM }] : [{ width: 1280, height: 800, expected: 48 * REM }, { width: 768, height: 1024, expected: 768 - 2 * REM }]
    for (const c of cases) {
      await page.setViewportSize({ width: c.width, height: c.height })
      await built(page, { still: true })
      const m = await measureResults(page)
      expect(m.chartBox!.w, `${c.width}: the chart box`).toBeCloseTo(c.expected, 0)
      expect(m.chart!.w, `${c.width}: the chart itself`).toBeCloseTo(c.expected, 0)
    }
  })

  test('the facet chart under a cluster stays at 40rem or less', async ({ page, isMobile }) => {
    test.skip(isMobile === true, 'a wide window')
    await page.setViewportSize({ width: 1280, height: 800 })
    await built(page, { still: true })
    await page.getByRole('button', { name: 'Knowledge', exact: true }).click()
    await expect(page.locator('section.facet-panel')).toBeVisible()
    await settle(page)
    const sub = page.locator('.facet-panel svg.hb-blob')
    if ((await sub.count()) > 0) {
      const w = (await sub.first().boundingBox())!.width
      expect(w).toBeGreaterThan(300)
      expect(w).toBeLessThanOrEqual(40 * REM + 0.5)
    }
    // The profile's own chart is still the wide one.
    expect((await page.locator('figure.blob-figure svg.hb-blob').boundingBox())!.width).toBeCloseTo(48 * REM, 0)
  })
})

// ------------------------------------------------------------------------------------ the top

test.describe('the compact top (D16)', () => {
  test('the practice note is one line: the first-session wording on a phone and on a desktop, the later wording on a desktop', async ({ page, isMobile }) => {
    if (isMobile === true) {
      for (const size of phoneSizes) {
        await page.setViewportSize(size)
        await built(page)
        const m = await measureResults(page)
        expect(m.practice!.text).toBe('Practice-adjusted. Nothing to adjust yet.')
        // One line wherever the system font fits it (macOS at both sizes; Linux's DejaVu Sans at 390 px). At 320 px
        // the 41 characters are 288 px of room: a wider font breaks the line once, which is not a defect (nothing is
        // cut, nothing moves) so long as the chart still starts on the first screen, which the test below checks.
        expect(m.practice!.lines, `${size.width}: the note`).toBeLessThanOrEqual(size.width >= 390 ? 1 : 2)
      }
      return
    }
    await page.setViewportSize({ width: 1280, height: 800 })
    await built(page)
    const first = await measureResults(page)
    expect(first.practice!.text).toBe('Practice-adjusted. Nothing to adjust yet.')
    expect(first.practice!.lines).toBe(1)
    // With two sessions the note is the longer wording; it is still one line on a desktop.
    await built(page, { sessions: 2 })
    const later = await measureResults(page)
    expect(later.practice!.text).toBe('Practice-adjusted. Each later session is credited for the typical gain from practice (a provisional figure).')
    expect(later.practice!.lines).toBe(1)
  })

  test('"Your profile is ready." is out of sight and in the accessibility tree: a 1 px status, announced, said once', async ({ page }) => {
    await built(page)
    const m = await measureResults(page)
    expect(m.status!.text).toBe('Your profile is ready.')
    expect(m.status!.w).toBeLessThanOrEqual(1)
    expect(m.status!.h).toBeLessThanOrEqual(1)
    // The tree still has it: a role query does not return what is out of the tree (display: none, hidden, aria-hidden).
    await expect(page.getByRole('status').filter({ hasText: 'Your profile is ready.' })).toHaveCount(1)
    await expect(page.locator('.reveal .controls')).toMatchAriaSnapshot(`
      - paragraph:
        - strong: Practice-adjusted.
        - text: Nothing to adjust yet.
      - button "Replay animation"
      - status: Your profile is ready.
    `)
    // No sighted-only copy of it anywhere, and no visible text outside the 1 px box says it.
    expect(await page.getByText('Your profile is ready.').count()).toBe(1)
    // A live region that is announced: it had text put into it after it was in the page (the start of the build-up is announced too).
    await page.getByRole('button', { name: 'Replay animation' }).click()
    await expect(status(page)).toHaveText('Building your profile, one skill at a time.')
    await expect(status(page)).toHaveText('Your profile is ready.', { timeout: 30_000 })
  })

  test('Skip and Replay are 44 px controls, there only while there is something to do with them, and Replay is a small text button', async ({ page }) => {
    await toResults(page)
    const skip = button(page, 'Skip animation')
    await expect(skip).toBeVisible()
    const skipBox = (await skip.boundingBox())!
    expect(skipBox.height).toBeGreaterThanOrEqual(44)
    expect(skipBox.width).toBeGreaterThanOrEqual(44)
    await skip.click()
    const replay = button(page, 'Replay animation')
    await expect(replay).toBeVisible()
    const box = (await replay.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.width).toBeGreaterThanOrEqual(44)
    // A text button: no box of its own, the link colour, underlined.
    const look = await replay.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { border: cs.borderTopWidth, bg: cs.backgroundColor, underline: cs.textDecorationLine }
    })
    expect(look).toEqual({ border: '0px', bg: 'rgba(0, 0, 0, 0)', underline: 'underline' })
  })

  test('with the motion off there is no animation row: the note is followed at once by the profile heading', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await built(page, { still: true })
    await expect(page.locator('.reveal .anim')).toHaveCount(0)
    await expect(button(page, 'Replay animation')).toHaveCount(0)
    const m = await measureResults(page)
    // The note (one 24 px line), the 8 px gap of the column and the heading: less than the 44 px row of the button.
    expect(m.profileHeading!.y - m.practice!.bottom).toBeLessThan(44)
  })

  test('the chart does not move while the profile builds or when it is built', async ({ page, isMobile }) => {
    const sizes = isMobile === true ? [{ width: 390, height: 664 }, { width: 320, height: 568 }] : [{ width: 1280, height: 800 }, { width: 768, height: 1024 }]
    for (const size of sizes) {
      await page.setViewportSize(size)
      await page.goto('./')
      await page.evaluate('localStorage.clear(); sessionStorage.clear()')
      await toResults(page)
      await expectStableChart(page, `${size.width} px`)
    }
  })

  test('and not with the text at 200% either, where the note and the button could have shared a row', async ({ page, isMobile }) => {
    await useTextZoom(page, 200)
    await page.setViewportSize(isMobile === true ? { width: 390, height: 664 } : { width: 1280, height: 800 })
    await toResults(page)
    await expectStableChart(page, '200% text')
  })

  test('the first screen shows the start of the chart: at 390 x 664, 320 x 568 and 1280 x 800', async ({ page, isMobile }) => {
    const cases = isMobile === true ? [{ width: 390, height: 664, minPx: 150 }, { width: 320, height: 568, minPx: 10 }] : [{ width: 1280, height: 800, minPx: 330 }]
    for (const c of cases) {
      await page.setViewportSize({ width: c.width, height: c.height })
      await built(page)
      const m = await measureResults(page)
      expect(m.chartInFirstScreen.starts, `${c.width}: the chart starts on the first screen`).toBe(true)
      expect(m.chartInFirstScreen.px, `${c.width}: how much of the chart the first screen shows`).toBeGreaterThanOrEqual(c.minPx)
    }
  })
})

// The same checks in the wide face (e2e/wide-font.ts: Verdana, else DejaVu Sans, plus letter spacing). The Linux CI
// runners set the page in DejaVu Sans, wider than macOS's system font, which wrapped the practice note at 320 px and
// pushed the chart down; the layout has to absorb font metrics, so these hold on every machine.
test.describe('the compact top in the wide font (D16)', () => {
  test.beforeEach(async ({ page }) => {
    await useWideFont(page)
  })

  test('the practice note is at most two lines on a phone and one on a desktop, and at 390 px the chart still starts on the first screen', async ({ page, isMobile }) => {
    const sizes = isMobile === true ? phoneSizes : [{ width: 1280, height: 800 }]
    for (const size of sizes) {
      await page.setViewportSize(size)
      await built(page)
      await expectWideFont(page)
      const m = await measureResults(page)
      expect(m.practice!.text).toBe('Practice-adjusted. Nothing to adjust yet.')
      expect(m.practice!.lines, `${size.width}: the note`).toBeLessThanOrEqual(isMobile === true ? 2 : 1)
      if (size.width >= 390) expect(m.chartInFirstScreen.starts, `${size.width}: the chart starts on the first screen`).toBe(true)
    }
  })

  test('the chart does not move while the profile builds, at 100% and at 200% text', async ({ page, isMobile }) => {
    const sizes = isMobile === true ? [{ width: 390, height: 664 }, { width: 320, height: 568 }] : [{ width: 1280, height: 800 }]
    for (const size of sizes) {
      await page.setViewportSize(size)
      await page.goto('./')
      await page.evaluate('localStorage.clear(); sessionStorage.clear()')
      await toResults(page)
      await expectStableChart(page, `${size.width} px, wide font`)
    }
  })

  test('the chart does not move with the text at 200% either', async ({ page, isMobile }) => {
    await useTextZoom(page, 200)
    await page.setViewportSize(isMobile === true ? { width: 390, height: 664 } : { width: 1280, height: 800 })
    await toResults(page)
    await expectStableChart(page, '200% text, wide font')
  })

  test('the first screen shows the start of the chart at 390 x 664 and 1280 x 800, and at 320 x 568 it is within a quarter of a screen', async ({ page, isMobile }) => {
    const cases = isMobile === true ? [{ width: 390, height: 664, minPx: 100 }, { width: 320, height: 568, minPx: null }] : [{ width: 1280, height: 800, minPx: 250 }]
    for (const c of cases) {
      await page.setViewportSize({ width: c.width, height: c.height })
      await built(page)
      const m = await measureResults(page)
      if (c.minPx === null) {
        // The wide face wraps the three paragraphs above the chart to many more lines on a 288 px column: it cannot start in
        // the first screen, but the heading and the view toggle do, and the chart is a short scroll away.
        expect(m.chart!.y, `${c.width}: the chart's top`).toBeLessThan(c.height * 1.25)
        continue
      }
      expect(m.chartInFirstScreen.starts, `${c.width}: the chart starts on the first screen`).toBe(true)
      expect(m.chartInFirstScreen.px, `${c.width}: how much of the chart the first screen shows`).toBeGreaterThanOrEqual(c.minPx)
    }
  })
})

// ------------------------------------------------------------------------------------ layout everywhere

interface Context {
  readonly id: string
  readonly width: number
  readonly height: number
  readonly textZoom?: number
  readonly wideFont?: boolean
  readonly dark?: boolean
  readonly desktop?: boolean
}

const CONTEXTS: readonly Context[] = [
  { id: '320 px', width: 320, height: 568 },
  { id: '320 px with 200% text', width: 320, height: 568, textZoom: 200 },
  { id: '390 px with 200% text', width: 390, height: 664, textZoom: 200 },
  { id: '320 px in the wide font', width: 320, height: 568, wideFont: true },
  { id: '390 px in dark mode', width: 390, height: 664, dark: true },
  { id: '1280 px with 200% text', width: 1280, height: 800, textZoom: 200, desktop: true },
  { id: '1280 px in the wide font', width: 1280, height: 800, wideFont: true, desktop: true },
  { id: '1280 px in dark mode', width: 1280, height: 800, dark: true, desktop: true },
]

test.describe('the compact top and the column in every setting (D16)', () => {
  for (const c of CONTEXTS) {
    test(`${c.id}: no sideways scroll, no clipped text, no serious axe issue, the controls are 44 px`, async ({ page, isMobile }) => {
      test.skip(c.desktop === true && isMobile === true, 'a desktop window')
      test.skip(c.desktop !== true && isMobile !== true, 'a phone')
      if (c.textZoom !== undefined) await useTextZoom(page, c.textZoom)
      if (c.wideFont === true) await useWideFont(page)
      await page.setViewportSize({ width: c.width, height: c.height })
      await built(page)
      if (c.dark === true) await scheme(page, 'dark')
      await expectNoSidewaysScroll(page, c.id)
      await expectNoClippedText(page, c.id)
      await expectNoSeriousAxe(page)
      const m = await measureResults(page)
      expect(m.animButton!.h, `${c.id}: Replay`).toBeGreaterThanOrEqual(44)
      // The note is there, and it is not cut off: all of its text is inside the column.
      const note = await page.locator('[data-practice-adjusted]').evaluate((el) => ({ right: el.getBoundingClientRect().right, scroll: el.scrollWidth, client: el.clientWidth }))
      expect(note.scroll).toBeLessThanOrEqual(note.client + 1)
      expect(note.right).toBeLessThanOrEqual(c.width)
      // Every setting keeps one left edge for the h1 and the profile.
      expect(m.leftEdges.h1).toBeCloseTo(m.leftEdges.profileHeading!, 0)
    })
  }

  test('printed: the page is one column, the animation row is gone and nothing runs past the paper', async ({ page, isMobile, browserName }) => {
    test.skip(isMobile === true || browserName !== 'chromium', 'print layout is read in a desktop chromium')
    await page.setViewportSize({ width: 1280, height: 800 })
    await built(page)
    await page.emulateMedia({ media: 'print', colorScheme: 'dark' })
    const m = await measureResults(page)
    expect(m.animButton, 'no Replay on paper').toMatchObject({ h: 0 })
    expect(m.practice!.text).toBe('Practice-adjusted. Nothing to adjust yet.')
    expect(m.sidewaysOverflow).toBeLessThanOrEqual(0)
    expect(m.leftEdges.h1).toBeCloseTo(m.leftEdges.profileHeading!, 0)
    // Light tokens on white paper, whatever the screen's scheme.
    const colour = await page.locator('[data-practice-adjusted] strong').evaluate((el) => getComputedStyle(el).color)
    expect(colour).toBe('rgb(31, 29, 36)')
  })
})

// ------------------------------------------------------------------------------------ D11 B

test.describe('the reading line (D11 B)', () => {
  test('ends by saying the comparison figures are for people reading in their first language', async ({ page }) => {
    await built(page, { still: true })
    const line = page.locator('[data-section="numbers"] [data-norm="reading"]')
    await expect(line).toHaveCount(1)
    const text = (await line.innerText()).replace(/\s+/g, ' ').trim()
    expect(text.endsWith('One passage is a rough guide. The comparison figures are for people reading in their first language.')).toBe(true)
    // The other lines of the section do not carry it.
    expect(await page.locator('[data-section="numbers"]').innerText()).not.toMatch(/first language[\s\S]*first language/)
  })
})

// ------------------------------------------------------------------------------------ measuring

const LABEL = process.env.HB_REVEAL_MEASURE ?? ''
const OUT = path.resolve('test-results/ux-review/uxdec-reveal', LABEL === '' ? 'unlabelled' : LABEL)

interface Scenario {
  readonly id: string
  readonly width: number
  readonly height: number
  readonly textZoom?: number
  readonly wideFont?: boolean
  readonly dark?: boolean
  readonly print?: boolean
  /** Sessions of the simulated save (default 1). */
  readonly sessions?: 1 | 2
  /** Desktop windows only (the phone project runs the phone scenarios). */
  readonly on?: 'desktop'
}

const SCENARIOS: readonly Scenario[] = [
  { id: 'phone-390x664', width: 390, height: 664 },
  { id: 'phone-320x568', width: 320, height: 568 },
  { id: 'phone-390x664-text200', width: 390, height: 664, textZoom: 200 },
  { id: 'phone-320x568-text200', width: 320, height: 568, textZoom: 200 },
  { id: 'phone-390x664-widefont', width: 390, height: 664, wideFont: true },
  { id: 'phone-320x568-widefont', width: 320, height: 568, wideFont: true },
  { id: 'phone-390x664-dark', width: 390, height: 664, dark: true },
  { id: 'phone-390x664-two-sessions', width: 390, height: 664, sessions: 2 },
  { id: 'desktop-1280x800', width: 1280, height: 800, on: 'desktop' },
  { id: 'desktop-1280x800-two-sessions', width: 1280, height: 800, sessions: 2, on: 'desktop' },
  { id: 'desktop-1280x800-text200', width: 1280, height: 800, textZoom: 200, on: 'desktop' },
  { id: 'desktop-1280x800-widefont', width: 1280, height: 800, wideFont: true, on: 'desktop' },
  { id: 'desktop-1280x800-dark', width: 1280, height: 800, dark: true, on: 'desktop' },
  { id: 'desktop-1440x900', width: 1440, height: 900, on: 'desktop' },
  { id: 'desktop-1280x800-print', width: 1280, height: 800, print: true, on: 'desktop' },
]

async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage })
}

test.describe('measure the results page (HB_REVEAL_MEASURE)', () => {
  test.skip(LABEL === '', 'figures for the handoff: set HB_REVEAL_MEASURE=before or after')

  for (const s of SCENARIOS) {
    test(`first screen: ${s.id}`, async ({ page, isMobile, browserName }, info) => {
      test.skip(s.on === 'desktop' && isMobile === true, 'a desktop window')
      test.skip(s.on !== 'desktop' && isMobile !== true, 'a phone')
      test.skip(s.print === true && browserName !== 'chromium', 'print emulation is read in chromium')
      const project = info.project.name
      test.setTimeout(120_000)
      if (s.textZoom !== undefined) await useTextZoom(page, s.textZoom)
      if (s.wideFont === true) await useWideFont(page)
      await page.setViewportSize({ width: s.width, height: s.height })
      await toResults(page, s.sessions ?? 1)
      if (s.dark === true) await scheme(page, 'dark')
      // The first screen while the profile builds up, then when it is done (Skip animation, then the build is complete).
      const building: ResultsMeasure = await measureResults(page)
      await shot(page, `${project}-${s.id}-building`)
      if ((await button(page, 'Skip animation').count()) > 0) await button(page, 'Skip animation').click()
      await expect(status(page)).toHaveText('Your profile is ready.', { timeout: 30_000 })
      await settle(page)
      if (s.print === true) await page.emulateMedia({ media: 'print' })
      const done = await measureResults(page)
      await shot(page, `${project}-${s.id}-ready`)
      if (s.print === true) await shot(page, `${project}-${s.id}-ready-full`, true)
      mkdirSync(OUT, { recursive: true })
      writeFileSync(path.join(OUT, `${project}-${s.id}.json`), JSON.stringify({ scenario: s, project, building, done }, null, 2))
    })
  }
})
