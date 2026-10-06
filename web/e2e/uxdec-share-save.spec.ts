/// <reference lib="dom" />
/**
 * The share card's buttons, the results page's save and the file names, after the UX-review answers D15 (C),
 * D17 (A) and D19 (A) (`web/UX-REVIEW.md` §2), in Chromium, WebKit and the iPhone 13 emulation:
 *
 * - **D15 C**: where the browser can hand image files to its share sheet, "Share image" is the primary button
 *   and comes first, and the two downloads sit under a "Save a copy" label; where it cannot (no share sheet, or
 *   a sheet that takes text only), today's order stays. The share sheet is replaced by a recorder, which sees
 *   exactly the file the app hands over (a real 2400 × 1260 PNG).
 * - **D17 A**: the save downloaded on the results page holds the notes settings kept on this device, read at the
 *   click (here, kept by the notes page in another tab after the results were up), so a second device that
 *   loads it gets them back; without them on the device the file has none and the page says nothing about notes.
 * - **D19 A**: the save and the card files are named with the person's local day (a fixed clock and a time zone
 *   on both sides of UTC, a second either side of local midnight), and the card with its colours.
 *
 * The e2e tsconfig has no DOM lib, so page code is passed as strings.
 */

import { readFileSync } from 'node:fs'
import { expect, test, type Browser, type Download, type Page } from '@playwright/test'
import { COPY } from '../src/brief/copy'
import { SAVE_HOLDS_NOTES } from '../src/reveal/copy'
import type { SaveFileV1 } from '../src/save/types'
import { validateSave } from '../src/save/validate'
import { expectNoSeriousAxe } from './axe'
import { button, languageClean, overflow, scheme, toResults } from './flow'

const panel = (page: Page) => page.locator('[data-share-card]')
const SAVE_NAME = /^humanbench-[0-9A-Za-z]{6}-(\d{4}-\d{2}-\d{2})\.hbsave\.json$/

/** A share sheet that takes image files and records what it is given, with the PNG's size read from its header. */
const SHARE_SHEET_FILES = `(() => {
  window.__hbShared = []
  const ok = (d) => !!d && Array.isArray(d.files) && d.files.length > 0
  Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: (d) => ok(d) })
  Object.defineProperty(Navigator.prototype, 'share', {
    configurable: true,
    value: async (d) => {
      if (!ok(d)) throw new TypeError('not shareable')
      for (const f of d.files) {
        const head = Array.from(new Uint8Array(await f.slice(0, 24).arrayBuffer()))
        window.__hbShared.push({ name: f.name, type: f.type, size: f.size, head })
      }
    },
  })
})()`

/** A browser with no share sheet at all (desktop engines that have none). */
const NO_SHARE_SHEET = `(() => {
  Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: undefined })
  Object.defineProperty(Navigator.prototype, 'share', { configurable: true, value: undefined })
})()`

/** A share sheet that takes text and links only: canShare says no to files. */
const SHARE_SHEET_TEXT_ONLY = `(() => {
  Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: (d) => !d || !d.files || d.files.length === 0 })
  Object.defineProperty(Navigator.prototype, 'share', { configurable: true, value: async () => undefined })
})()`

/** Records what the share sheet is given, as text (the save file is JSON). */
const SHARE_SHEET_FILE_TEXT = `(() => {
  window.__hbShareText = []
  const ok = (d) => !!d && Array.isArray(d.files) && d.files.length > 0
  Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: (d) => ok(d) })
  Object.defineProperty(Navigator.prototype, 'share', {
    configurable: true,
    value: async (d) => {
      if (!ok(d)) throw new TypeError('not shareable')
      for (const f of d.files) window.__hbShareText.push({ name: f.name, text: await f.text() })
    },
  })
})()`

/** Records what the app hands to the clipboard, and says yes (WebKit's clipboard cannot be read from a test). */
const CLIPBOARD_RECORDER = `(() => {
  window.__hbClip = []
  const fake = {
    write: async (items) => { for (const item of items) window.__hbClip.push(await (await item.getType('text/plain')).text()) },
    writeText: async (text) => { window.__hbClip.push(String(text)) },
  }
  Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: true, get: () => fake })
})()`

interface SharedFile {
  readonly name: string
  readonly type: string
  readonly size: number
  readonly head: number[]
}
const shared = (page: Page): Promise<SharedFile[]> => page.evaluate<SharedFile[]>('window.__hbShared')
const pngSizeOf = (head: number[]): { width: number; height: number } => {
  const b = Buffer.from(head)
  expect([...b.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

/** Results up, save downloaded: the card panel is there with its preview. */
async function toCard(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await toResults(page)
  await button(page, 'Download save file').click()
  await expect(panel(page)).toBeVisible()
  await expect(page.locator('img[data-preview]')).toBeVisible()
}

/** The card's buttons in page order (the rows that make the card, not the skill toggles' Show all / Hide all). */
const cardButtons = (page: Page): Promise<{ text: string; primary: boolean; grouped: boolean }[]> =>
  page.evaluate(`(() => {
    const rows = document.querySelectorAll('[data-share-card] [data-share-actions], [data-share-card] [data-save-copy] .hb-actions')
    return [...rows].flatMap((row) => [...row.querySelectorAll('button')].map((b) => ({ text: b.textContent.trim(), primary: b.classList.contains('hb-primary'), grouped: b.closest('[data-save-copy]') !== null })))
  })()`) as Promise<{ text: string; primary: boolean; grouped: boolean }[]>

async function downloadOf(page: Page, name: string): Promise<Download> {
  const [download] = await Promise.all([page.waitForEvent('download'), button(page, name).click()])
  return download
}

test.describe('D15 C: "Share image" first where the browser can share image files', () => {
  test.describe('with a share sheet that takes image files', () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(SHARE_SHEET_FILES)
    })

    test('"Share image" is the one primary button and comes first; the downloads are a labelled group, "Save a copy"', async ({ page }) => {
      await toCard(page)
      expect(await cardButtons(page)).toEqual([
        { text: 'Share image', primary: true, grouped: false },
        { text: 'Download image (PNG)', primary: false, grouped: true },
        { text: 'Download vector image (SVG)', primary: false, grouped: true },
      ])
      const group = panel(page).getByRole('group', { name: 'Save a copy' })
      await expect(group).toBeVisible()
      await expect(group.getByRole('button')).toHaveText(['Download image (PNG)', 'Download vector image (SVG)'])
      await expect(group.getByRole('button', { name: 'Share image' })).toHaveCount(0)
    })

    test('"Share image" hands the finished PNG, 2400 × 1260, to the share sheet under the card\'s name, and says so', async ({ page }) => {
      await toCard(page)
      await expect(button(page, 'Share image')).toBeEnabled()
      await expect(panel(page).locator('[data-preparing]')).toHaveCount(0)
      await button(page, 'Share image').click()
      await expect(panel(page).locator('[data-message]')).toHaveText('Image shared.')
      const files = await shared(page)
      expect(files).toHaveLength(1)
      expect(files[0]!.name).toMatch(/^humanbench-card-light-\d{4}-\d{2}-\d{2}\.png$/)
      expect(files[0]!.type).toBe('image/png')
      expect(pngSizeOf(files[0]!.head)).toEqual({ width: 2400, height: 1260 })
      // The dark card is shared under its own name.
      await panel(page).getByRole('radio', { name: 'Dark' }).check()
      await expect(button(page, 'Share image')).toBeEnabled()
      await button(page, 'Share image').click()
      await expect.poll(async () => (await shared(page)).length).toBe(2)
      expect((await shared(page))[1]!.name).toMatch(/^humanbench-card-dark-\d{4}-\d{2}-\d{2}\.png$/)
    })

    test('the buttons meet the 44 px target and the page passes axe (light and dark), with the group at 320 px too', async ({ page }) => {
      await toCard(page)
      await expect(button(page, 'Share image')).toBeEnabled()
      for (const name of ['Share image', 'Download image (PNG)', 'Download vector image (SVG)']) {
        const box = (await button(page, name).boundingBox())!
        expect(box.height, name).toBeGreaterThanOrEqual(43.5)
        expect(box.width, name).toBeGreaterThanOrEqual(43.5)
      }
      for (const colorScheme of ['light', 'dark'] as const) {
        await scheme(page, colorScheme)
        await expectNoSeriousAxe(page)
      }
      await languageClean(page)
      await page.setViewportSize({ width: 320, height: 700 })
      await overflow(page, 'the share card panel with its Save a copy group')
      await expectNoSeriousAxe(page)
    })

    test('the downloads still work from the group, under the card\'s own names', async ({ page }) => {
      await toCard(page)
      await expect(button(page, 'Download image (PNG)')).toBeEnabled()
      const png = await downloadOf(page, 'Download image (PNG)')
      expect(png.suggestedFilename()).toMatch(/^humanbench-card-light-\d{4}-\d{2}-\d{2}\.png$/)
      const svg = await downloadOf(page, 'Download vector image (SVG)')
      expect(svg.suggestedFilename()).toMatch(/^humanbench-card-light-\d{4}-\d{2}-\d{2}\.svg$/)
    })

    test('the Tab order follows the page: Share image, then the two downloads', async ({ page }) => {
      test.skip(test.info().project.name !== 'chromium', 'WebKit\'s Tab key follows the system setting for buttons; the order is the page\'s own and is checked in the DOM test')
      await toCard(page)
      await expect(button(page, 'Share image')).toBeEnabled()
      await button(page, 'Share image').focus()
      const order: string[] = []
      for (let i = 0; i < 2; i++) {
        await page.keyboard.press('Tab')
        order.push((await page.evaluate(`document.activeElement && document.activeElement.textContent.trim()`)) as string)
      }
      expect(order).toEqual(['Download image (PNG)', 'Download vector image (SVG)'])
    })
  })

  for (const [what, script] of [
    ['no share sheet', NO_SHARE_SHEET],
    ['a share sheet that takes text only', SHARE_SHEET_TEXT_ONLY],
  ] as const) {
    test(`with ${what}: today's order stays (the PNG download primary, then the SVG), with no "Share image" and no "Save a copy"`, async ({ page }) => {
      await page.addInitScript(script)
      await toCard(page)
      expect(await cardButtons(page)).toEqual([
        { text: 'Download image (PNG)', primary: true, grouped: false },
        { text: 'Download vector image (SVG)', primary: false, grouped: false },
      ])
      await expect(button(page, 'Share image')).toHaveCount(0)
      await expect(panel(page).getByRole('group', { name: 'Save a copy' })).toHaveCount(0)
      await expect(panel(page)).not.toContainText('Save a copy')
      await expect(button(page, 'Download image (PNG)')).toBeEnabled()
      await expectNoSeriousAxe(page)
    })
  }
})

test.describe('D19 A: card files named for their colours', () => {
  test('light and dark cards, PNG and SVG, get names that differ and carry the day', async ({ page }) => {
    await toCard(page)
    await expect(button(page, 'Download image (PNG)')).toBeEnabled()
    const names: string[] = []
    for (const colours of ['Light', 'Dark'] as const) {
      await panel(page).getByRole('radio', { name: colours }).check()
      await expect(button(page, 'Download image (PNG)')).toBeEnabled()
      await expect(panel(page).locator('[data-preparing]')).toHaveCount(0)
      names.push((await downloadOf(page, 'Download image (PNG)')).suggestedFilename())
      names.push((await downloadOf(page, 'Download vector image (SVG)')).suggestedFilename())
    }
    expect(names[0]).toMatch(/^humanbench-card-light-\d{4}-\d{2}-\d{2}\.png$/)
    expect(names[1]).toMatch(/^humanbench-card-light-\d{4}-\d{2}-\d{2}\.svg$/)
    expect(names[2]).toMatch(/^humanbench-card-dark-\d{4}-\d{2}-\d{2}\.png$/)
    expect(names[3]).toMatch(/^humanbench-card-dark-\d{4}-\d{2}-\d{2}\.svg$/)
    expect(new Set(names).size).toBe(4)
  })
})

// ---------------------------------------------------------------------------------------------------- local day

/** One person's day on the page's own clock: a zone, the moment just before local midnight, and the moment of it. */
const DAYS: readonly { tz: string; before: string; after: string; dayBefore: string; dayAfter: string }[] = [
  // Los Angeles, PDT (UTC-7): local midnight is 07:00 UTC. At 06:59:59 UTC it is still the 5th (8 pm, in the evening, UTC says the 6th).
  { tz: 'America/Los_Angeles', before: '2026-10-06T06:59:59Z', after: '2026-10-06T07:00:00Z', dayBefore: '2026-10-05', dayAfter: '2026-10-06' },
  // Auckland, NZDT (UTC+13): local midnight is 11:00 UTC the day before. At 10:59:59 UTC it is the 5th there already (UTC says the 5th too).
  { tz: 'Pacific/Auckland', before: '2026-10-05T10:59:59Z', after: '2026-10-05T11:00:00Z', dayBefore: '2026-10-05', dayAfter: '2026-10-06' },
]

for (const d of DAYS) {
  test.describe(`D19 A: the person's own day in ${d.tz}`, () => {
    test.use({ timezoneId: d.tz })

    test(`a save and a card made at ${d.before} are dated ${d.dayBefore}; made at ${d.after}, ${d.dayAfter}`, async ({ page }) => {
      test.setTimeout(150_000)
      await page.clock.setFixedTime(new Date(d.before))
      await toCard(page)
      await expect(button(page, 'Download image (PNG)')).toBeEnabled()
      expect(await page.evaluate('new Date().toISOString()')).toBe(new Date(d.before).toISOString())
      // The first save was downloaded by toCard; the card and the save again, once the clock has passed local midnight.
      const svgBefore = await downloadOf(page, 'Download vector image (SVG)')
      expect(svgBefore.suggestedFilename()).toBe(`humanbench-card-light-${d.dayBefore}.svg`)
      const saveBefore = await downloadOf(page, 'Download save file')
      expect(SAVE_NAME.exec(saveBefore.suggestedFilename())?.[1]).toBe(d.dayBefore)
      await page.clock.setFixedTime(new Date(d.after))
      const svgAfter = await downloadOf(page, 'Download vector image (SVG)')
      expect(svgAfter.suggestedFilename()).toBe(`humanbench-card-light-${d.dayAfter}.svg`)
      const pngAfter = await downloadOf(page, 'Download image (PNG)')
      expect(pngAfter.suggestedFilename()).toBe(`humanbench-card-light-${d.dayAfter}.png`)
      const saveAfter = await downloadOf(page, 'Download save file')
      expect(SAVE_NAME.exec(saveAfter.suggestedFilename())?.[1]).toBe(d.dayAfter)
      // The stamp inside the file stays UTC (§8): only the name is the person's day.
      const file = JSON.parse(readFileSync((await saveAfter.path())!, 'utf8')) as SaveFileV1
      expect(file.created_utc).toBe(d.after)
      // The page says where the file went, under that name.
      await expect(page.locator('[data-saved-as]')).toContainText(saveAfter.suggestedFilename())
    })
  })
}

// ---------------------------------------------------------------------------------------------------- notes settings in the save

/** The notes page, in a tab of the same browser (same storage): coding notes with two topics, typed words, 18+ and keep. */
async function keepSettingsInAnotherTab(page: Page): Promise<void> {
  const tab = await page.context().newPage()
  await tab.goto('./notes.html')
  await expect(tab.getByRole('heading', { level: 1, name: 'Notes for your AI' })).toBeVisible()
  await tab.getByRole('radio', { name: /Coding and data/ }).check()
  await tab.getByRole('button', { name: /Programming/ }).first().click()
  await tab.getByRole('button', { name: /Statistics/ }).first().click()
  await tab.getByRole('group', { name: 'Programming' }).getByLabel('I know this well').check()
  await tab.getByLabel(/Hobbies or subjects/).fill('chess, cooking')
  await tab.locator('#custom-0').fill('Use metric units')
  // A person who has been through the start page has said they are 18 or older already: the notes page does not ask again.
  const adult = tab.getByLabel(COPY.keepAdult)
  if ((await adult.count()) > 0) await adult.check()
  await tab.getByRole('button', { name: COPY.keepButton }).click()
  await expect(tab.getByTestId('keep-status')).toHaveText(COPY.keepNow)
  // The write lands a moment after the last change.
  await expect.poll(async () => (await tab.evaluate<string | null>(`localStorage.getItem('hb:save:v1:prefs')`)) ?? '', { timeout: 10_000 }).toContain('"brief_prefs"')
  await tab.close()
}

/** A page on a device that has nothing: a new browser context with this project's device settings. */
async function anotherDevice(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL } = test.info().project.use
  const context = await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL })
  return { page: await context.newPage(), close: () => context.close() }
}

test.describe('D17 A: the results page\'s save holds the notes settings kept on this device', () => {
  test('kept after the results were up, they are in the file read at the click, and a second device restores them', async ({ page, browser }) => {
    test.setTimeout(180_000)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await toResults(page)
    // The notes page, in another tab, keeps its settings while the results stay open.
    await keepSettingsInAnotherTab(page)
    await page.bringToFront()
    const download = await downloadOf(page, 'Download save file')
    const text = readFileSync((await download.path())!, 'utf8')
    const file = JSON.parse(text) as SaveFileV1
    expect(validateSave(file).ok).toBe(true)
    expect(file.sessions.length).toBeGreaterThan(0)
    expect(file.brief_prefs?.contexts[0]).toMatchObject({ preset: 'coding', topics: { 'other/programming': 'skip', 'other/statistics': 'ask_first' } })
    // Choices and ids only: the words typed on the notes page are not in the file.
    expect(text).not.toMatch(/chess|cooking|metric/)
    await expect(page.locator('[data-notes-included]')).toHaveText(SAVE_HOLDS_NOTES)
    await expectNoSeriousAxe(page)

    // A second device with nothing on it: the notes page loads the file and shows the settings (it no longer says "That save has no notes settings.").
    const second = await anotherDevice(browser)
    try {
      await second.page.goto('./notes.html')
      await expect(second.page.locator('input[name=preset][value=general]')).toBeChecked()
      await second.page.getByTestId('load-file').setInputFiles({ name: download.suggestedFilename().replace(/\.json$/, '.txt'), mimeType: 'text/plain', buffer: Buffer.from(text) })
      await second.page.getByRole('button', { name: COPY.loadButton }).click()
      await expect(second.page.getByTestId('load-status')).toHaveText(COPY.loadDone)
      await expect(second.page.getByRole('radio', { name: /Coding and data/ })).toBeChecked()
      await expect(second.page.getByRole('group', { name: 'Programming' }).getByLabel('I know this well')).toBeChecked()
      // Loading is not keeping: nothing was written on that device.
      expect(await second.page.evaluate<string[]>('Object.keys(localStorage)')).toEqual([])
    } finally {
      await second.close()
    }
  })

  test('the share sheet\'s file and the copy code hold them too', async ({ page }) => {
    test.setTimeout(180_000)
    await page.addInitScript(SHARE_SHEET_FILE_TEXT)
    await page.addInitScript(CLIPBOARD_RECORDER)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await toResults(page)
    await keepSettingsInAnotherTab(page)
    await page.bringToFront()
    await button(page, 'Share or save to an app').click()
    await expect(page.locator('[data-section="save"]').getByRole('status')).toHaveText('Save file shared.')
    const files = await page.evaluate<{ name: string; text: string }[]>('window.__hbShareText')
    expect(files).toHaveLength(1)
    expect(files[0]!.name).toMatch(SAVE_NAME)
    const file = JSON.parse(files[0]!.text) as SaveFileV1
    expect(validateSave(file).ok).toBe(true)
    expect(file.brief_prefs?.contexts[0]).toMatchObject({ preset: 'coding' })
    await expect(page.locator('[data-notes-included]')).toHaveText(SAVE_HOLDS_NOTES)
    await button(page, 'Copy save code').click()
    await expect(page.locator('[data-section="save"]').getByRole('status')).toHaveText(/^Save code copied/)
    const clip = await page.evaluate<string[]>('window.__hbClip')
    expect(clip.length).toBeGreaterThan(0)
    expect(clip.at(-1)!.length).toBeGreaterThan(50)
  })

  test('with nothing kept on the device the file has no notes settings, and the page says nothing about notes', async ({ page }) => {
    test.setTimeout(150_000)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await toResults(page)
    const download = await downloadOf(page, 'Download save file')
    const file = JSON.parse(readFileSync((await download.path())!, 'utf8')) as SaveFileV1
    expect(file.brief_prefs).toBeUndefined()
    await expect(page.locator('[data-saved-as]')).toBeVisible()
    await expect(page.locator('[data-notes-included]')).toHaveCount(0)
  })
})
