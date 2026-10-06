/// <reference lib="dom" />
/**
 * The results page after the UX review (web/ux-review/triage.json, area "reveal": UX-028 to UX-036),
 * in real browsers. Each block is one finding the review reproduced, and what the fix promises:
 *
 * - UX-028 "Stay and save" lands on the download button, in view;
 * - UX-005b (integration) the leave question puts "Stay and save" first, and Escape means it too;
 * - UX-029 while the file is unsaved a line at the top says so and leads to the save panel, and the
 *   panel stands out until it is saved;
 * - UX-030 the save panel confirms a copy once, says what the file is for and where it went;
 * - UX-031 the "Save your file first" note lines up with the panels;
 * - UX-032 the share card: a one-skill profile gets an explanation, the PNG button stays in the Tab
 *   order while it is prepared, the card can be opened full size, the count line is translation-safe;
 * - UX-033 the focus-session rows are 44 px tall and read "Matrix & Series (wide range)";
 * - UX-034, UX-035, UX-036 wording, the worked examples, the disclosure markers and the headings.
 *
 * The results are those of a simulated earlier session loaded on the ready screen (`flow.ts` toResults),
 * except where a one-skill profile is needed: that one is played (`session-driver.ts`). Chromium and the
 * iPhone 13 emulation run all of it, WebKit what touches saving, downloading, the clipboard or a new tab
 * (the isolated runner can be given any project). The e2e tsconfig has no DOM lib: page code that runs in
 * the browser is passed as strings or as functions of the page.
 */

import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectNoSeriousAxe } from './axe'
import { button, languageClean, openDetails, overflow, scheme, toResults, unloadIsGuarded } from './flow'
import { SessionDriver } from './session-driver'

const section = (page: Page, name: string): Locator => page.locator(`[data-section="${name}"]`)
const panel = (page: Page): Locator => page.locator('[data-share-card]')

/** No motion: the profile is complete at once. */
async function still(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
}

/** Distance of an element's top from the top of the page, CSS px. */
async function pageTop(page: Page, target: Locator): Promise<number> {
  const box = await target.boundingBox()
  expect(box, 'the element is on the page').not.toBeNull()
  return box!.y + (await page.evaluate<number>('window.scrollY'))
}

/** Says yes to every clipboard write, and keeps the text: WebKit's clipboard cannot be read from a test. */
const CLIPBOARD_RECORDER = `(() => {
  window.__hbClip = []
  const fake = {
    write: async (items) => { for (const item of items) window.__hbClip.push(await (await item.getType('text/plain')).text()) },
    writeText: async (text) => { window.__hbClip.push(String(text)) },
  }
  Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: true, get: () => fake })
})()`

/** Encoding a PNG waits until the test says so (`window.__hbPngGo = true`), so the share card's "Preparing" state can be looked at as long as needed. */
const SLOW_PNG = `(() => {
  const encode = HTMLCanvasElement.prototype.toBlob
  HTMLCanvasElement.prototype.toBlob = function (callback, ...rest) {
    const run = () => (window.__hbPngGo ? encode.call(this, callback, ...rest) : setTimeout(run, 40))
    run()
  }
})()`

// ------------------------------------------------------------------------------------ UX-028

test.describe('"Stay and save" (UX-028)', () => {
  test('lands focus and the view on the download button, however far down the question was opened', async ({ page }) => {
    await still(page)
    await toResults(page)
    await button(page, 'Back to the start').scrollIntoViewIfNeeded()
    await button(page, 'Back to the start').click()
    await expect(page.getByRole('heading', { level: 2, name: 'Leave without saving?' })).toBeVisible()
    await button(page, 'Stay and save').click()
    await expect(button(page, 'Download save file')).toBeFocused()
    await expect(button(page, 'Download save file')).toBeInViewport()
    // Still unsaved and still guarded: staying is not saving.
    expect(await unloadIsGuarded(page)).toBe(true)
  })
})

// ------------------------------------------------------------------------------------ UX-005b

test.describe('the leave question (UX-005b)', () => {
  test('offers "Stay and save" first and as the primary answer; Escape stays too', async ({ page }) => {
    await still(page)
    await toResults(page)
    await button(page, 'Back to the start').click()
    const confirm = page.locator('.confirm')
    await expect(confirm.getByRole('heading', { level: 2, name: 'Leave without saving?' })).toBeFocused()
    await expect(confirm.getByRole('button')).toHaveText(['Stay and save', 'Leave anyway'])
    await expect(confirm.getByRole('button').first()).toHaveClass(/hb-primary/)
    await expect(confirm.getByRole('button').last()).not.toHaveClass(/hb-primary/)
    await page.keyboard.press('Escape')
    await expect(confirm).toHaveCount(0)
    await expect(button(page, 'Download save file')).toBeFocused()
    expect(await unloadIsGuarded(page)).toBe(true)
  })
})

// ------------------------------------------------------------------------------------ UX-029

test.describe('the unsaved results point to the save (UX-029)', () => {
  test('a line at the top says so within the first two screens, above the chart, and leads to the save panel', async ({ page }) => {
    await still(page)
    await toResults(page)
    const pointer = page.locator('[data-save-pointer]')
    await expect(pointer).toBeVisible()
    await expect(pointer).toContainText('Your results are not saved yet. Download your save file to keep them.')
    expect(await pageTop(page, pointer)).toBeLessThan(2 * page.viewportSize()!.height)
    expect(await pageTop(page, pointer)).toBeLessThan(await pageTop(page, page.locator('svg.hb-blob').first()))
    // Not a status: the drivers and screen readers read the profile's own first.
    await expect(page.locator('.reveal [role="status"]').first()).toHaveText('Your profile is ready.')
    expect(await pointer.locator('[role], [aria-live]').count()).toBe(0)
    await pointer.getByRole('link', { name: 'Go to the save file' }).click()
    const heading = section(page, 'save').getByRole('heading', { level: 2, name: 'Save your results' })
    await expect(heading).toBeFocused()
    await expect(heading).toBeInViewport()
    expect(new URL(page.url()).hash).toBe('')
    await expectNoSeriousAxe(page)
    await button(page, 'Download save file').click()
    await expect(pointer).toHaveCount(0)
    await expect(section(page, 'save')).toHaveAttribute('data-saved', 'true')
  })

  test('the pointer is reached by keyboard and works with Enter', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard navigation is checked on the desktop projects')
    await still(page)
    await toResults(page)
    const link = page.locator('[data-save-pointer]').getByRole('link', { name: 'Go to the save file' })
    await link.focus()
    await page.keyboard.press('Enter')
    await expect(section(page, 'save').getByRole('heading', { level: 2, name: 'Save your results' })).toBeFocused()
  })

  test('while the file is unsaved the panel has a surface of its own; it keeps its place and size when saved', async ({ page }) => {
    await still(page)
    await toResults(page)
    const save = section(page, 'save')
    const look = (): Promise<{ bg: string; border: string; width: number; left: number }> =>
      save.evaluate((el) => {
        const cs = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        return { bg: cs.backgroundColor, border: cs.borderTopColor, width: r.width, left: r.left }
      })
    const unsaved = await look()
    expect(unsaved.bg, 'a fill').not.toBe('rgba(0, 0, 0, 0)')
    await button(page, 'Download save file').click()
    await expect(save).toHaveAttribute('data-saved', 'true')
    const done = await look()
    expect(done.bg, 'no fill once saved').toBe('rgba(0, 0, 0, 0)')
    expect(done.border).not.toBe(unsaved.border)
    expect(done.width).toBeCloseTo(unsaved.width, 0)
    expect(done.left).toBeCloseTo(unsaved.left, 0)
  })

  test('at 320 px the pointer and the panel fit, in light and dark', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 })
    await still(page)
    await toResults(page)
    await overflow(page, 'results with the pointer')
    for (const colorScheme of ['light', 'dark'] as const) {
      await scheme(page, colorScheme)
      await expectNoSeriousAxe(page)
    }
  })
})

// ------------------------------------------------------------------------------------ UX-030

test.describe('the save panel says what happened (UX-030)', () => {
  test('a copy before the file is saved is confirmed once and says where the code goes; the download names the file', async ({ page }) => {
    await page.addInitScript(CLIPBOARD_RECORDER)
    await still(page)
    await toResults(page)
    const status = section(page, 'save').locator('[role="status"]')
    await button(page, 'Copy save code').click()
    await expect(status).toContainText('Save code copied.')
    const text = await status.innerText()
    expect(text.match(/Save code copied\./g)).toHaveLength(1)
    expect(text).toContain('under "Or paste a save code" on the "Ready when you are" screen')
    expect(text).toContain('Downloading the file is still the safest way')
    expect(await unloadIsGuarded(page)).toBe(true)

    const [download] = await Promise.all([page.waitForEvent('download'), button(page, 'Download save file').click()])
    await expect(status).toHaveText('Save file downloaded.')
    await expect(section(page, 'save').locator('[data-saved-as]')).toHaveText(
      `Saved as ${download.suggestedFilename()}. Look in your Downloads folder (on an iPhone, the Files app) and keep it.`,
    )
    await expect(section(page, 'save')).toContainText('You can leave this page safely. Your share card and notes for your AI are just below.')
    // The primary action has moved on: the download is an ordinary button now.
    await expect(button(page, 'Download save file')).not.toHaveClass(/hb-primary/)
    // A copy after the save is just confirmed.
    await button(page, 'Copy save code').click()
    await expect(status).toHaveText('Save code copied.')
    expect(await unloadIsGuarded(page)).toBe(false)
    await expectNoSeriousAxe(page)
    await languageClean(page)
  })
})

// ------------------------------------------------------------------------------------ UX-031

test.describe('the pending note (UX-031)', () => {
  test('lines up with the save panel and has the muted note style', async ({ page }) => {
    await still(page)
    await toResults(page)
    const note = page.locator('[data-pending]')
    await expect(note).toHaveText('Save your file first to see the next steps.')
    const [noteBox, saveBox] = [await note.boundingBox(), await section(page, 'save').boundingBox()]
    expect(noteBox!.x).toBeCloseTo(saveBox!.x, 0)
    // The muted note style of the other notes, not the body's colour and size.
    const style = (el: Locator): Promise<{ color: string; size: string }> => el.evaluate((n) => ({ color: getComputedStyle(n).color, size: getComputedStyle(n).fontSize }))
    expect(await style(note)).toEqual(await style(section(page, 'save').locator('p.note').first()))
  })
})

// ------------------------------------------------------------------------------------ UX-032

test.describe('the share card (UX-032)', () => {
  test('a profile with one measured skill gets an explanation, not an instruction it cannot follow', async ({ page, isMobile }) => {
    const driver = new SessionDriver(page, { touch: isMobile === true })
    await driver.toReady()
    await driver.begin()
    await driver.answerOne()
    await driver.finishEarly()
    await driver.resultsReady()
    await driver.press(button(page, 'Download save file'))
    const card = panel(page)
    await expect(card).toBeVisible()
    await expect(card.locator('[data-needs-more]')).toHaveText(
      'A card needs at least 3 measured skills, and your profile has 1. Play more parts or add another session, then come back to make a card.',
    )
    await expect(card.getByRole('checkbox')).toHaveCount(0)
    await expect(card.getByRole('button')).toHaveCount(0)
    await expect(card.locator('[data-count]')).toHaveCount(0)
    expect(await card.innerText()).not.toContain('Tick at least')
    await expectNoSeriousAxe(page)
    await languageClean(page)
  })

  test('the PNG button stays in the Tab order while the PNG is prepared, and keeps focus when it is ready', async ({ page, browserName }) => {
    await page.addInitScript(SLOW_PNG)
    await still(page)
    await toResults(page)
    await button(page, 'Download save file').click()
    const card = panel(page)
    const png = button(page, 'Download image (PNG)')
    await expect(card.locator('[data-preparing]')).toBeVisible()
    // Not disabled (a disabled button is skipped by Tab): aria-disabled, described by the note.
    await expect(png).toHaveAttribute('aria-disabled', 'true')
    expect(await png.evaluate((el: HTMLButtonElement) => el.disabled)).toBe(false)
    await expect(png).toHaveAccessibleDescription('Preparing the PNG…')
    await expectNoSeriousAxe(page)
    if (browserName === 'chromium') {
      // Tab from the colour choice reaches it, whatever comes in between (the other engines' Tab key follows the system's settings for buttons).
      await card.getByRole('radio', { name: 'Dark' }).focus()
      for (let i = 0; i < 4 && !(await png.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
    } else {
      await png.focus()
    }
    await expect(png).toBeFocused()
    // A press while it is prepared does nothing and says nothing.
    await png.press('Enter')
    await expect(card.locator('[data-message]')).toHaveText('')
    await page.evaluate('window.__hbPngGo = true')
    await expect(card.locator('[data-preparing]')).toHaveCount(0, { timeout: 15_000 })
    await expect(png).not.toHaveAttribute('aria-disabled', 'true')
    await expect(png).toBeFocused()
    const [download] = await Promise.all([page.waitForEvent('download'), png.press('Enter')])
    expect(download.suggestedFilename()).toMatch(/^humanbench-card-\d{4}-\d{2}-\d{2}\.png$/)
    await expect(card.locator('[data-message]')).toHaveText('Image saved: 2400 × 1260 pixels.')
  })

  test('the card opens full size in a new tab', async ({ page, context }) => {
    await still(page)
    await toResults(page)
    await button(page, 'Download save file').click()
    const link = panel(page).getByRole('link', { name: 'View the card full size (opens in a new tab)' })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('target', '_blank')
    const [popup] = await Promise.all([context.waitForEvent('page'), link.click()])
    await popup.waitForLoadState('domcontentloaded')
    expect(popup.url()).toMatch(/^blob:/)
    expect(await popup.evaluate('document.documentElement.localName')).toBe('svg')
    const size = await popup.evaluate<number[]>('(() => { const r = document.documentElement.getBoundingClientRect(); return [r.width, r.height] })()')
    expect(size[0]).toBeCloseTo(1200, 0)
    expect(size[1]).toBeCloseTo(630, 0)
    await popup.close()
    // The panel is where it was left, and the link is not the only thing on the card's page that works.
    await expect(panel(page).locator('img[data-preview]')).toBeVisible()
  })

  test('the count line starts empty, keeps its number in an element of its own, and follows the ticks', async ({ page }) => {
    await still(page)
    await toResults(page)
    await button(page, 'Download save file').click()
    const count = panel(page).locator('[data-count]')
    await expect(count).toHaveText(/^\d+ skills are on the card\.$/)
    await expect(count.locator('span[translate="no"]')).toHaveCount(1)
    const first = await count.locator('span[translate="no"]').innerText()
    await panel(page).locator('input[data-skill]').first().uncheck()
    await expect(count.locator('span[translate="no"]')).toHaveText(String(Number(first) - 1))
    await expect(count).toHaveText(`${Number(first) - 1} skills are on the card.`)
  })
})

// ------------------------------------------------------------------------------------ UX-033

test.describe('the focus-session rows (UX-033)', () => {
  test('are 44 px tall, closely spaced, a whole-row target, and read "(wide range)" with a space', async ({ page }) => {
    await still(page)
    await toResults(page)
    await button(page, 'Download save file').click()
    const form = section(page, 'retest').locator('[data-focus-form]')
    const rows = form.locator('label')
    await expect(rows).toHaveCount(6)
    const boxes = await rows.evaluateAll((els) => els.map((e) => ({ y: e.getBoundingClientRect().top, h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width })))
    for (const b of boxes) expect(b.h).toBeGreaterThanOrEqual(43.5)
    for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.y - boxes[i - 1]!.y, `row ${i} pitch`).toBeLessThanOrEqual(48)
    const texts = (await rows.allInnerTexts()).map((t) => t.trim())
    expect(texts.some((t) => t.includes('(wide range)'))).toBe(true)
    for (const t of texts) expect(t, t).toMatch(/^[^(]*[^\s(]( \(wide range\))?$/)
    // The far end of a row is part of its target.
    const row = rows.nth(0)
    const box = row.getByRole('checkbox')
    const was = await box.isChecked()
    await row.click({ position: { x: boxes[0]!.w - 6, y: boxes[0]!.h / 2 } })
    await expect(box).toBeChecked({ checked: !was })
    await expectNoSeriousAxe(page)
  })
})

// ------------------------------------------------------------------------------ UX-034 to UX-036

test.describe('wording, worked examples and markers (UX-034, UX-035, UX-036)', () => {
  test('the worked examples: the heading counts them, the sequence is a sequence, the question is plain, the solution is a rule under the card', async ({ page }) => {
    await still(page)
    await toResults(page)
    const worked = section(page, 'worked')
    const cards = worked.locator('article[data-worked]')
    const n = await cards.count()
    expect(n).toBeGreaterThan(0)
    await expect(worked.getByRole('heading', { level: 2 })).toHaveText(`${['No', 'One', 'Two', 'Three'][n]} worked ${n === 1 ? 'example' : 'examples'}`)
    await expect(worked.getByRole('heading', { level: 3, name: /^Example \d: (Matrix|Sequence|Quantitative)$/ })).toHaveCount(n)
    const series = worked.locator('article[data-worked="series"]')
    if ((await series.count()) > 0) {
      await expect(series).toContainText('What comes next in this sequence?')
      await expect(series).not.toContainText('next term of this series')
    }
    const quant = worked.locator('article[data-worked="quant"]')
    if ((await quant.count()) > 0) {
      await expect(quant.locator('.terms strong')).toHaveCount(0)
      await openDetails(page)
      expect(await quant.locator('ol.steps').innerText()).not.toMatch(/(^|[^\d.])1x\b/)
    }
    const details = cards.first().locator('details')
    const border = await details.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { left: cs.borderLeftWidth, top: cs.borderTopWidth, radius: cs.borderTopLeftRadius }
    })
    expect(border).toEqual({ left: '0px', top: '1px', radius: '0px' })
    await expectNoSeriousAxe(page)
  })

  test('every disclosure shows whether it is open, and the peaks heading is the colour of the other headings', async ({ page }) => {
    await still(page)
    await toResults(page)
    for (const sel of ['details.pace > summary', 'article[data-worked] details > summary']) {
      const summary = page.locator(sel).first()
      const draw = (): Promise<{ marker: string; list: string; transform: string }> =>
        summary.evaluate((el) => ({ marker: getComputedStyle(el, '::before').content, list: getComputedStyle(el).listStyleType, transform: getComputedStyle(el, '::before').transform }))
      const closed = await draw()
      expect(closed.marker, sel).not.toBe('none')
      expect(closed.list, sel).toBe('none')
      await summary.click()
      const open = await draw()
      expect(open.transform, `${sel} turns when open`).not.toBe(closed.transform)
    }
    const colour = (el: Locator): Promise<string> => el.evaluate((n) => getComputedStyle(n).color)
    const peaks = await colour(section(page, 'peaks').getByRole('heading', { level: 2 }))
    expect(peaks).toBe(await colour(section(page, 'save').getByRole('heading', { level: 2 })))
    expect(peaks).toBe(await colour(section(page, 'retest').getByRole('heading', { level: 2 })))
    for (const colorScheme of ['light', 'dark'] as const) {
      await scheme(page, colorScheme)
      await expect.poll(async () => colour(section(page, 'peaks').getByRole('heading', { level: 2 }))).toBe(await colour(section(page, 'save').getByRole('heading', { level: 2 })))
      await expectNoSeriousAxe(page)
    }
  })

  test('the build-up is announced, and the end of it too', async ({ page }) => {
    await toResults(page)
    const status = page.locator('.reveal [role="status"]').first()
    await expect(status).toHaveText('Building your profile, one skill at a time.')
    await button(page, 'Skip animation').click()
    await expect(status).toHaveText('Your profile is ready.')
  })

  test('the numbers, the practice adjustment and the spacing advice name what they refer to', async ({ page }) => {
    await still(page)
    await toResults(page, 2)
    await expect(page.locator('[data-practice-adjusted]')).toContainText('each later session is credited for the typical gain from practice (a provisional figure)')
    await expect(section(page, 'numbers')).toContainText('From your most recent attempt at each task:')
    await openDetails(page)
    await expect(section(page, 'numbers').locator('li[data-pace]').first()).toContainText(/about \d+ seconds? per question/)
    await expect(section(page, 'retest').locator('[data-spacing]')).toContainText('press Start and load your save file on the "Ready when you are" screen')
    await expect(section(page, 'retest')).not.toContainText('sharpen')
    await expect(section(page, 'retest')).toContainText('Pick the parts you want measured more precisely.')
    await expect(section(page, 'peaks')).toContainText('The hollow and filled markers in the chart compare each skill with 0 SD instead')
    await button(page, 'Download save file').click()
    await expect(page.locator('[data-talk-link]')).toHaveText('Thinking of asking an AI about your results? Read this first.')
    await expect(panel(page)).toContainText('twice the card size, for sharp screens')
    await languageClean(page)
    await expectNoSeriousAxe(page)
  })
})
