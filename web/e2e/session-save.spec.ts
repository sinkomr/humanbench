/// <reference lib="dom" />
/**
 * A whole `?fast=1` session, its save, and the save's way back in (ROADMAP M1.22; DESIGN §8 "Download
 * and upload compatibility", §10, §14.3 M1 acceptance 4 "iOS Safari emulation downloads and uploads a
 * save"; Phase AI AI.7 "the WebKit save round trip covers the preferences"). In Chromium, desktop
 * WebKit and an emulated iPhone 13 (WebKit, touch, iPhone user agent):
 *
 * - **The session**: the notes builder keeps its settings on the device (`brief_prefs`, AI.7), then the
 *   `?fast=1` session is played from the start page through the six parts (a mouse and the keyboard on
 *   desktop, a finger and the on-screen keypads on the phone: `session-driver.ts`) to the build-up, the
 *   required save and the cards that follow it.
 * - **Download**: the file the browser receives has the `humanbench-<id>-<date>.hbsave.json` name, is
 *   valid against the save schema, is the RFC 8785 canonical text, holds the session and the notes
 *   settings, and is what the device keeps as its autosave.
 * - **Upload**: on a device that has nothing, the file loads by its content however it arrives (named as
 *   downloaded, renamed `.txt` as iOS does, with no extension or type, with a byte-order mark), and so
 *   does a paste of its text, of its copy code and of a code wrapped in a message. The next session is
 *   added to it (R-8.1): the earlier session, the identifier and the notes settings come back unchanged,
 *   and the same session reached twice (the autosave and the file) is still one session.
 * - **Copy code and share**: the code the app hands to the clipboard decodes (in Node, a different
 *   gzip) to the same save as the file; only the stamp of when each export was made (`created_utc`, to
 *   the second) may differ. Where the clipboard refuses, the app shows the code for copying by hand;
 *   the share sheet gets a file (and, on a platform that only shares text, a `.txt` copy) that loads again.
 * - **Notes**: the settings that travelled in the save are the ones the notes builder shows on the other
 *   device, whether it found them in the session's autosave or was given the file.
 * - **A device that has notes settings of its own** (ROADMAP owner decisions 2026-10-01, AI.7): a save loaded
 *   on the ready screen wins over them set by set, as in the notes builder, even when the device's sets were
 *   edited more often (higher revs); the page says so; the choice holds whether or not the new session is added
 *   to the earlier saves on the device.
 *
 * A download event is observable on the iPhone emulation as on desktop (the pages' own downloads
 * come through it), so the file is read from the event. What the engines cannot do is read the
 * system clipboard (WebKit has no clipboard permission in Playwright) or open the share sheet or
 * the Files picker: those are replaced by recorders in the page, which see exactly what the app
 * hands over; Chromium also reads the real clipboard. The e2e tsconfig has no DOM lib, so page
 * code is passed as strings.
 */

import { readFileSync } from 'node:fs'
import { expect, test, type Browser, type Download, type Page } from '@playwright/test'
import { PREFS_AUTOSAVE_ID, prefsOnlySave } from '../src/brief-store/persist'
import { COPY } from '../src/brief/copy'
import { SAVE_SHARE, SAVE_SHARED } from '../src/reveal/copy'
import { autosaveKey } from '../src/save/autosave'
import { jcs } from '../src/save/jcs'
import { parseSaveText } from '../src/save/parse'
import type { BriefContextV1, BriefPrefsV1, SaveFileV1 } from '../src/save/types'
import { validateSave } from '../src/save/validate'
import { FINISHED_COPIED, FINISHED_COPY_FAILED, READY_LOAD_BUTTON, READY_LOAD_CODE, READY_LOAD_FILE, READY_LOAD_PREFS_NOTICE } from '../src/session/copy'
import { expectNoSeriousAxe } from './axe'
import { button, h1, languageClean, unloadIsGuarded } from './flow'
import { partsPlayedProblems } from './parts'
import { SEGMENT_TITLES } from './routes'
import { SessionDriver } from './session-driver'

const FILE_NAME = /^humanbench-[0-9A-Za-z]{6}-\d{4}-\d{2}-\d{2}\.hbsave\.json$/
const PREFS_KEY = autosaveKey(PREFS_AUTOSAVE_ID)

// -------------------------------------------------------------------------- what the page does with the browser

/** Records what the app hands to the clipboard, and says yes: WebKit's clipboard cannot be read from a test. */
const CLIPBOARD_RECORDER = `(() => {
  window.__hbClip = []
  const fake = {
    write: async (items) => { for (const item of items) window.__hbClip.push(await (await item.getType('text/plain')).text()) },
    writeText: async (text) => { window.__hbClip.push(String(text)) },
  }
  Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: true, get: () => fake })
})()`

/** A clipboard that refuses every write, as an embedded browser or a locked-down profile does. */
const CLIPBOARD_REFUSES = `(() => {
  const no = () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'))
  Object.defineProperty(Navigator.prototype, 'clipboard', { configurable: true, get: () => ({ write: no, writeText: no }) })
})()`

/**
 * A share sheet that records the files it is given. `accepts` is the type it takes: iOS apps that only take
 * text refuse a JSON file, so the app must try the same content as plain text.
 */
const shareSheet = (accepts: 'any' | 'text'): string => `(() => {
  window.__hbShared = []
  const ok = (data) => !!data && Array.isArray(data.files) && data.files.length > 0 && ${accepts === 'any' ? 'true' : "data.files.every((f) => f.type === 'text/plain')"}
  Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: (data) => ok(data) })
  Object.defineProperty(Navigator.prototype, 'share', {
    configurable: true,
    value: async (data) => {
      if (!ok(data)) throw new TypeError('not shareable')
      for (const f of data.files) window.__hbShared.push({ name: f.name, type: f.type, text: await f.text() })
    },
  })
})()`

interface Shared {
  readonly name: string
  readonly type: string
  readonly text: string
}
const sharedFiles = (page: Page): Promise<Shared[]> => page.evaluate<Shared[]>('window.__hbShared')
const clipped = (page: Page): Promise<string[]> => page.evaluate<string[]>('window.__hbClip')

// -------------------------------------------------------------------------- the files

interface Saved {
  /** The file name the browser was given. */
  readonly name: string
  /** The file's text, as received. */
  readonly text: string
  readonly file: SaveFileV1
}

/** The bytes of a download (what the browser would put in Downloads). */
async function textOf(download: Download): Promise<string> {
  return readFileSync((await download.path())!, 'utf8')
}

/** Press "Download save file" and read the file that arrives. */
async function downloadSave(page: Page, driver: SessionDriver): Promise<Saved> {
  const [download] = await Promise.all([page.waitForEvent('download'), driver.press(button(page, 'Download save file'))])
  const text = await textOf(download)
  const name = download.suggestedFilename()
  expect(name).toMatch(FILE_NAME)
  const checked = validateSave(JSON.parse(text))
  expect(checked.ok, checked.ok ? '' : checked.errors.join('; ')).toBe(true)
  // The text is the canonical form (RFC 8785): one way to write a save, on any device.
  expect(jcs(JSON.parse(text))).toBe(text)
  return { name, text, file: JSON.parse(text) as SaveFileV1 }
}

/** What is in localStorage under the app's keys. */
const localKeys = (page: Page): Promise<string[]> => page.evaluate<string[]>(`Object.keys(localStorage).sort()`)

/** The notes builder keeps coding settings on this device (18+ ticked); returns the prefs-only save it wrote. */
async function keepNotesSettings(page: Page): Promise<SaveFileV1> {
  await page.goto('./notes.html')
  await expect(page.getByRole('heading', { level: 1, name: 'Notes for your AI' })).toBeVisible()
  await page.getByRole('radio', { name: /Coding and data/ }).check()
  await page.getByRole('button', { name: /Programming/ }).first().click()
  await page.getByRole('button', { name: /Statistics/ }).first().click()
  await page.getByRole('group', { name: 'Programming' }).getByLabel('I know this well').check()
  // A note on how well the Programming notes fit is kept as a topic, a verdict and a month (the fit log).
  await page.getByRole('group', { name: 'Programming' }).getByTestId('fit-too_basic').click()
  // Words typed on the page are not settings: they must not reach the save.
  await page.getByLabel(/Hobbies or subjects/).fill('chess, cooking')
  await page.locator('#custom-0').fill('Use metric units')
  await page.getByLabel(COPY.keepAdult).check()
  await page.getByRole('button', { name: COPY.keepButton }).click()
  await expect(page.getByTestId('keep-status')).toHaveText(COPY.keepNow)
  // Copying the notes records which lines were copied, and the write lands a moment after the last change.
  await page.getByRole('button', { name: 'Copy the notes' }).click()
  await expect(page.getByTestId('status')).toHaveText(COPY.copied)
  await expect.poll(async () => (await page.evaluate<string | null>(`localStorage.getItem(${JSON.stringify(PREFS_KEY)})`)) ?? '', { timeout: 10_000 }).toContain('"copied"')
  const kept = JSON.parse((await page.evaluate<string | null>(`localStorage.getItem(${JSON.stringify(PREFS_KEY)})`))!) as SaveFileV1
  expect(kept.sessions).toEqual([])
  expect(kept.brief_prefs?.contexts[0]).toMatchObject({ preset: 'coding', topics: { 'other/programming': 'skip', 'other/statistics': 'ask_first' } })
  expect(kept.brief_prefs?.fit_log).toMatchObject([{ topic: 'other/programming', verdict: 'too_basic' }])
  expect(JSON.stringify(kept)).not.toMatch(/chess|cooking|metric/)
  // They are still there when the page is opened again (and the typed words are not).
  await page.reload()
  await expectNotesSettings(page)
  return kept
}

/**
 * The settings the notes builder shows: the coding notes, with the two topics set as they were kept (Programming
 * "I know this well", Statistics "Not sure"; or, after an edit, as `programming` says), and none of the typed words.
 */
async function expectNotesSettings(page: Page, programming: RegExp | string = 'I know this well'): Promise<void> {
  await expect(page.getByRole('radio', { name: /Coding and data/ })).toBeChecked()
  await expect(page.getByRole('group', { name: 'Programming' }).getByLabel(programming)).toBeChecked()
  await expect(page.getByRole('group', { name: 'Statistics' }).getByLabel('Not sure')).toBeChecked()
  await expect(page.getByLabel(/Hobbies or subjects/)).toHaveValue('')
}

/** The settings of a save without the two fields a new write changes: each set's revision and the month of the latest change. */
function settingsOf(prefs: BriefPrefsV1 | undefined): unknown {
  if (prefs === undefined) return undefined
  return { ...prefs, notes_as_of: undefined, contexts: prefs.contexts.map((c) => ({ ...c, rev: undefined })) }
}

/** Give the notes builder a save file (as the person would, renamed `.txt` as iOS does) and wait for it to say so. */
async function loadIntoBuilder(page: Page, isMobile: boolean, file: Pick<Saved, 'name' | 'text'>): Promise<void> {
  await page.goto('./notes.html')
  await expect(page.getByRole('heading', { level: 1, name: 'Notes for your AI' })).toBeVisible()
  await expect(page.locator('input[name=preset][value=general]')).toBeChecked()
  await page.getByTestId('load-file').setInputFiles({ name: file.name.replace(/\.json$/, '.txt'), mimeType: 'text/plain', buffer: Buffer.from(file.text) })
  if (isMobile) await page.getByRole('button', { name: COPY.loadButton }).tap()
  else await page.getByRole('button', { name: COPY.loadButton }).click()
  await expect(page.getByTestId('load-status')).toHaveText(COPY.loadDone)
}

/**
 * Notes settings a device holds before the session: the saved file's set in slot 1, edited five more times since
 * (a higher rev) with Programming moved to "New to me", and a second set (slot 2) that only this device has. A plain
 * join of this device and the file would keep the device's slot 1.
 */
function deviceSettings(file: SaveFileV1): BriefPrefsV1 {
  const prefs = JSON.parse(JSON.stringify(file.brief_prefs)) as BriefPrefsV1
  const first = prefs.contexts[0] as BriefContextV1
  const mine: BriefContextV1 = { ...first, rev: first.rev + 5, topics: { ...first.topics, 'other/programming': 'build' } }
  const second: BriefContextV1 = { ...mine, slot: 2, preset: 'reading', rev: 1 }
  prefs.contexts = [mine, second]
  return prefs
}

/** Put notes settings on a device that has nothing else, as the notes builder would have kept them. */
async function keepSettingsOnDevice(page: Page, prefs: BriefPrefsV1, anonId: string): Promise<void> {
  const text = jcs(prefsOnlySave(prefs, anonId, Date.parse('2026-10-01T09:00:00Z')))
  await page.goto('./')
  await page.evaluate(`localStorage.setItem(${JSON.stringify(PREFS_KEY)}, ${JSON.stringify(text)})`)
}

/** Clear the "add my new session to the earlier saves on this device" box on the ready screen. */
async function leaveOutEarlierSaves(page: Page, isMobile: boolean): Promise<void> {
  const box = page.getByRole('checkbox', { name: /Add my new session to the/ })
  await expect(box).toBeChecked()
  if (isMobile) await box.tap()
  else await box.uncheck()
  await expect(box).not.toBeChecked()
}

/** The next session is added to the save it started from (R-8.1): nothing of the earlier one is lost or changed. */
function expectAddedTo(after: SaveFileV1, before: SaveFileV1, sessions = 2): void {
  expect(after.anon_id).toBe(before.anon_id)
  expect(after.sessions).toHaveLength(sessions)
  const earlier = before.sessions[0]!
  expect(after.sessions.filter((s) => s.session_id === earlier.session_id)).toEqual([earlier])
  expect(before.brief_prefs, 'the save under test holds notes settings').toBeDefined()
  expect(after.brief_prefs).toEqual(before.brief_prefs)
  expect(after.seen_items).toEqual(expect.arrayContaining(before.seen_items))
  expect(after.seen_families).toEqual(expect.arrayContaining(before.seen_families))
  expect(after.sig).toBeUndefined()
}

// -------------------------------------------------------------------------- the ways in

interface Way {
  readonly what: string
  /** Put the save on the ready screen of a device that has nothing. */
  readonly bring: (page: Page, driver: SessionDriver, saved: Saved, code: string) => Promise<void>
}

async function chooseFile(page: Page, driver: SessionDriver, file: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  await page.getByLabel(READY_LOAD_FILE).setInputFiles(file)
  await driver.press(button(page, READY_LOAD_BUTTON))
}

async function pasteText(page: Page, driver: SessionDriver, text: string): Promise<void> {
  // A file that was chosen wins over the pasted text, so a person who changes their mind clears it first.
  await page.getByLabel(READY_LOAD_FILE).setInputFiles([])
  await page.getByLabel(READY_LOAD_CODE).fill(text)
  await driver.press(button(page, READY_LOAD_BUTTON))
}

/**
 * A page on a device that has nothing: a new browser context with this project's device settings (a second page of
 * the same context would share the first one's storage). Close it when done.
 */
async function anotherDevice(browser: Browser): Promise<{ page: Page; driver: SessionDriver; close: () => Promise<void> }> {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL } = test.info().project.use
  const context = await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL })
  const page = await context.newPage()
  return { page, driver: new SessionDriver(page, { touch: isMobile === true }), close: () => context.close() }
}

const WAYS: readonly Way[] = [
  { what: 'a file named as it was downloaded', bring: (p, d, s) => chooseFile(p, d, { name: s.name, mimeType: 'application/json', buffer: Buffer.from(s.text) }) },
  // Files and some mail apps on iOS hand the file over under another name and type: it is read by its content (§8).
  { what: 'a file renamed .txt by iOS', bring: (p, d, s) => chooseFile(p, d, { name: s.name.replace(/\.json$/, '.txt'), mimeType: 'text/plain', buffer: Buffer.from(s.text) }) },
  { what: 'a file with no extension and no type', bring: (p, d, s) => chooseFile(p, d, { name: 'save', mimeType: 'application/octet-stream', buffer: Buffer.from(s.text) }) },
  { what: 'a file that an editor saved with a byte-order mark and Windows line ends', bring: (p, d, s) => chooseFile(p, d, { name: 'save.txt', mimeType: 'text/plain', buffer: Buffer.from(`\uFEFF${s.text}\r\n`) }) },
  { what: 'pasted file text', bring: (p, d, s) => pasteText(p, d, s.text) },
  { what: 'a pasted copy code', bring: (p, d, _s, code) => pasteText(p, d, code) },
  {
    what: 'a copy code wrapped by a mail app inside a message',
    bring: (p, d, _s, code) => pasteText(p, d, `My HumanBench save:\r\n${code.replace(/(.{76})/g, '$1\r\n')}\r\n\r\nSent from my iPhone`),
  },
]

// -------------------------------------------------------------------------- the tests

test.describe('a whole ?fast=1 session, its save and the way back in', () => {
  // The first test makes the save; every later one starts from it. A failure of the first skips the rest.
  test.describe.configure({ mode: 'serial' })

  let saved: Saved
  let code: string

  test('plays from the start page to the results and downloads the save, with the notes settings in it', async ({ page, context, browserName, isMobile }) => {
    test.setTimeout(8 * 60_000)
    const touch = isMobile === true
    const driver = new SessionDriver(page, { touch })
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    else await page.addInitScript(CLIPBOARD_RECORDER)

    // The notes builder keeps its settings on this device before any session (AI.7).
    const kept = await keepNotesSettings(page)

    // The session starts from the settings the builder kept (they are an earlier save on this device) and keeps their identifier.
    await driver.toReady()
    await driver.begin()
    await driver.playToResults()

    // Every part of the session was played, in the order of the plan (A15), each showing its own kind of screen.
    expect(driver.segments, 'the parts of the session, by their interstitials').toEqual([...SEGMENT_TITLES])
    // One break offer, at the part boundary nearest half-way: before Working Memory (UX-066; owner decision 2026-10-05, UX-REVIEW D5).
    expect(driver.breakOffers, 'break offers in the session').toBe(1)
    expect(driver.breakBefore, 'the part the break offer came before').toBe('Working Memory')
    // Each part showed the kinds of screen it cannot do without (`parts.ts`: the Matrix & Series part serves both a matrix and a series item, because the selector balances the two families).
    expect(partsPlayedProblems(driver.played), 'screens a part of the session did not show').toEqual([])

    // The reveal: the profile builds up, and the file is required before leaving.
    await driver.resultsReady()
    expect(await unloadIsGuarded(page), 'the tab asks before closing while the file is not saved').toBe(true)
    await expect(page.locator('[data-section="after-save"]')).toHaveCount(0)
    await expectNoSeriousAxe(page)
    await languageClean(page)

    saved = await downloadSave(page, driver)
    expect(await unloadIsGuarded(page), 'the guard is off once the file is saved').toBe(false)
    await expect(page.locator('[data-section="save"]')).toContainText('You can leave this page safely')
    await expect(page.locator('[data-section="after-save"]')).toBeVisible()
    await expect(page.locator('[data-slot="share-card"] [data-share-card]')).toBeVisible()
    await expect(page.locator('[data-slot="working-with-ai"]')).toBeVisible()

    // The file: one session of this device and this browser, all the instruments, the notes settings, unsigned.
    const { file } = saved
    expect(file.sessions).toHaveLength(1)
    const session = file.sessions[0]!
    expect(session.device).toMatchObject(touch ? { class: 'phone', input: 'touch', os_family: 'iOS', browser_family: 'Safari' } : { class: 'desktop', input: 'keyboard' })
    expect(session.device.viewport[0]).toBeGreaterThan(0)
    // Nothing was pasted into an answer and the page was never hidden for long (§13 flags it at 10 s).
    expect(session.flags.paste_events).toBe(0)
    expect(Number(session.flags.visibility_hidden_s ?? 0)).toBeLessThan(10)
    const instruments = new Set(session.responses.map((r) => r[0].split(':')[1]))
    for (const kind of ['rt_simple', 'rt_choice4', 'rotation', 'span_fwd', 'span_bwd', 'corsi', 'quant', 'coding', 'reading']) expect(instruments, kind).toContain(kind)
    expect([...instruments].some((k) => k === 'series' || k === 'matrices')).toBe(true)
    // The reaction tasks record how they were answered (norms are kept per input, §11.6): keys on desktop, touches on the phone.
    // The driver answers at a person's pace, so the counted trials are valid and each block is scored (a block with
    // fewer than `min_valid` valid trials yields no estimate). On the phone the keys do nothing, so valid trials
    // prove the taps landed; the input type alone would not (it falls back to the primary pointer, 'touch').
    for (const id of ['rt_simple', 'rt_choice4']) {
      const rt = session.responses.find((r) => r[0].split(':')[1] === id)
      const meta = rt?.[6] as { input_type?: string; n_valid?: number; min_valid?: number; n_trials?: number } | undefined
      expect(meta?.input_type, id).toBe(touch ? 'touch' : 'keyboard')
      expect(meta?.n_valid ?? 0, `${id}: valid trials of ${meta?.n_trials}`).toBeGreaterThanOrEqual(meta?.min_valid ?? Infinity)
    }
    expect(session.responses.length).toBeGreaterThan(60)
    expect(file.seen_items.length).toBeGreaterThan(60)
    expect(file.sig).toBeUndefined()
    expect(file.brief_prefs, 'the notes settings travel in the save').toEqual(kept.brief_prefs)
    expect(file.anon_id, 'the session starts from the identifier the settings were kept under').toBe(kept.anon_id)
    // What was typed on the notes page is not a setting and is not in the file.
    expect(saved.text).not.toMatch(/chess|cooking|metric/)

    // The device keeps the same session as an autosave. It holds the settings the session started from, so
    // the autosave that held only those is dropped as redundant when the session ends (nothing is lost).
    const keys = await localKeys(page)
    expect(keys).toContain(autosaveKey(session.session_id))
    expect(keys).not.toContain(PREFS_KEY)
    const autosave = JSON.parse((await page.evaluate<string>(`localStorage.getItem(${JSON.stringify(autosaveKey(session.session_id))})`))) as SaveFileV1
    expect(autosave.sessions.map((s) => s.session_id)).toEqual([session.session_id])
    expect(autosave.sessions[0]).toEqual(session)
    expect(autosave.brief_prefs).toEqual(kept.brief_prefs)
    expect(autosave.anon_id).toBe(kept.anon_id)

    // The copy code: what the app hands to the clipboard decodes, in another environment, to the same file.
    await driver.press(button(page, 'Copy save code'))
    await expect(page.locator('[data-section="save"] [role="status"]')).toHaveText(FINISHED_COPIED)
    code =
      browserName === 'chromium' ? await page.evaluate<string>(`navigator.clipboard.readText()`) : ((await clipped(page)).at(-1) ?? '')
    expect(code).toMatch(/^H4sI[A-Za-z0-9_-]+$/)
    const decoded = await parseSaveText(code)
    expect(decoded.ok && decoded.format === 'code').toBe(true)
    // The same save. Each export is stamped with the moment it was made (`created_utc`, to the second), so
    // the file from a minute ago and the code from now differ in that stamp, and in nothing else.
    expect(decoded.ok && { ...decoded.save, created_utc: file.created_utc }).toEqual(file)
    expect(decoded.ok && decoded.save.created_utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)

    // The settings are still the builder's after the session: the autosave that held only them was dropped
    // because the session's autosave holds them too.
    await test.step('the notes builder still shows the settings', async () => {
      await page.goto('./notes.html')
      await expect(page.getByRole('heading', { level: 1, name: 'Notes for your AI' })).toBeVisible()
      await expectNotesSettings(page)
    })

    // Save, reload, merge (M1 acceptance 3): a new visit to the same device adds its session to the autosave.
    await test.step('the next visit adds its session to the one the device kept', async () => {
      await driver.toReady()
      await expect(page.getByText(/saved on this device\./)).toContainText('1 earlier session')
      await driver.begin()
      await driver.answerOne()
      await driver.finishEarly()
      await driver.resultsReady()
      const next = await downloadSave(page, driver)
      expectAddedTo(next.file, file)
    })
  })

  for (const way of WAYS) {
    test(`a device with nothing loads the save from ${way.what}, and the next session is added to it`, async ({ page, isMobile }) => {
      test.setTimeout(3 * 60_000)
      const driver = new SessionDriver(page, { touch: isMobile === true })
      await driver.toReady()
      // Nothing on this device: no earlier saves are offered.
      await expect(page.getByRole('heading', { level: 2, name: 'Earlier saves on this device' })).toHaveCount(0)
      await way.bring(page, driver, saved, code)
      await expect(page.getByText('Loaded 1 earlier session. Your new session will be added to it.')).toBeVisible()
      await driver.begin()
      await driver.answerOne()
      await driver.finishEarly()
      await driver.resultsReady()
      const after = await downloadSave(page, driver)
      expectAddedTo(after.file, saved.file)
      // The new session answered one item; the one before it is exactly as it was.
      expect(after.file.sessions.find((s) => s.session_id !== saved.file.sessions[0]!.session_id)?.responses.length).toBeGreaterThan(0)
    })
  }

  test('the same session reached twice, as an autosave on the device and as the file, is one session (R-8.1)', async ({ page, isMobile }) => {
    const driver = new SessionDriver(page, { touch: isMobile === true })
    const key = autosaveKey(saved.file.sessions[0]!.session_id)
    await page.addInitScript(([k, v]) => { if (localStorage.getItem(k) === null) localStorage.setItem(k, v) }, [key, saved.text] as const)
    await driver.toReady()
    await expect(page.getByRole('heading', { level: 2, name: 'Earlier saves on this device' })).toBeVisible()
    await expect(page.getByText(/saved on this device\./)).toContainText('1 earlier session')
    await chooseFile(page, driver, { name: saved.name, mimeType: 'application/json', buffer: Buffer.from(saved.text) })
    await expect(page.getByText('Loaded 1 earlier session.')).toBeVisible()
    await driver.begin()
    await driver.answerOne()
    await driver.finishEarly()
    await driver.resultsReady()
    const after = await downloadSave(page, driver)
    expectAddedTo(after.file, saved.file)
    // The session that came by both routes is there once, as it was.
    expect(jcs(after.file.sessions.filter((s) => s.session_id === saved.file.sessions[0]!.session_id))).toBe(jcs(saved.file.sessions))
  })

  test('says so for a file that is not a save, and for a code that was cut short, and the person can go on', async ({ page, isMobile }) => {
    const driver = new SessionDriver(page, { touch: isMobile === true })
    await driver.toReady()
    // A failure is an alert of its own (UX-012a); the status line keeps for what went well.
    const status = page.getByRole('status')
    const alert = page.getByRole('alert')
    await chooseFile(page, driver, { name: 'photo.txt', mimeType: 'text/plain', buffer: Buffer.from('this is not a save') })
    await expect(alert).toContainText('not a HumanBench save')
    await expect(alert).toHaveClass(/error/)
    await expect(alert).toHaveCount(1)
    await expect(status).toHaveText('')
    // Pasted text is worded as text, not as a file (a raw cut-off copy of a save, a code copied in part).
    await pasteText(page, driver, saved.text.slice(0, 200))
    await expect(alert).toContainText('This pasted save looks cut off or damaged')
    await expect(alert).toHaveClass(/error/)
    await pasteText(page, driver, code.slice(0, Math.floor(code.length / 2)))
    await expect(alert).toContainText('incomplete or damaged')
    await pasteText(page, driver, '{"a": 1}')
    await expect(alert).toContainText('This text is not a HumanBench save or save code.')
    await pasteText(page, driver, '')
    await expect(alert).toContainText('paste a save code first')
    await expect(alert).toHaveCount(1)
    await expect(status).toHaveText('')
    // Nothing was loaded: the screen still starts a session on its own.
    await expect(button(page, 'Begin')).toBeEnabled()
    await expect(h1(page)).toHaveText('Ready when you are')
  })

  test('the share sheet is given the file, and a file it hands on loads on a device that has nothing', async ({ page, browser, isMobile }) => {
    await page.addInitScript(shareSheet('any'))
    const driver = new SessionDriver(page, { touch: isMobile === true })
    await driver.toReady()
    await chooseFile(page, driver, { name: saved.name, mimeType: 'application/json', buffer: Buffer.from(saved.text) })
    await driver.begin()
    await driver.answerOne()
    await driver.finishEarly()
    await driver.resultsReady()
    await expect(page.locator('[data-section="after-save"]')).toHaveCount(0)
    await driver.press(button(page, SAVE_SHARE))
    await expect(page.locator('[data-section="save"] [role="status"]')).toHaveText(SAVE_SHARED)
    // Sharing counts as saving: the guard is off and the cards follow.
    expect(await unloadIsGuarded(page)).toBe(false)
    await expect(page.locator('[data-section="after-save"]')).toBeVisible()
    const [file, ...more] = await sharedFiles(page)
    expect(more).toEqual([])
    expect(file?.name).toMatch(FILE_NAME)
    expect(file?.type).toBe('application/json')
    const shared = JSON.parse(file!.text) as SaveFileV1
    expect(validateSave(shared).ok).toBe(true)
    expect(jcs(shared)).toBe(file!.text)
    expectAddedTo(shared, saved.file)

    // On another device the shared file is loaded.
    const other = await anotherDevice(browser)
    try {
      await other.driver.toReady()
      await chooseFile(other.page, other.driver, { name: file!.name, mimeType: file!.type, buffer: Buffer.from(file!.text) })
      await expect(other.page.getByText('Loaded 2 earlier sessions. Your new session will be added to them.')).toBeVisible()
    } finally {
      await other.close()
    }
  })

  test('where an app only takes text, the share sheet is given the same file as .txt, and it loads', async ({ page, browser, isMobile }) => {
    await page.addInitScript(shareSheet('text'))
    const driver = new SessionDriver(page, { touch: isMobile === true })
    await driver.toReady()
    await chooseFile(page, driver, { name: saved.name, mimeType: 'application/json', buffer: Buffer.from(saved.text) })
    await driver.begin()
    await driver.answerOne()
    await driver.finishEarly()
    await driver.resultsReady()
    await driver.press(button(page, SAVE_SHARE))
    await expect(page.locator('[data-section="save"] [role="status"]')).toHaveText(SAVE_SHARED)
    const [file] = await sharedFiles(page)
    expect(file?.type).toBe('text/plain')
    expect(file?.name).toMatch(/\.hbsave\.txt$/)
    expectAddedTo(JSON.parse(file!.text) as SaveFileV1, saved.file)
    const other = await anotherDevice(browser)
    try {
      await other.driver.toReady()
      await chooseFile(other.page, other.driver, { name: file!.name, mimeType: file!.type, buffer: Buffer.from(file!.text) })
      await expect(other.page.getByText(/^Loaded 2 earlier sessions/)).toBeVisible()
    } finally {
      await other.close()
    }
  })

  test('when the clipboard refuses, the code is shown to copy by hand, and that code loads', async ({ page, browser, isMobile }) => {
    await page.addInitScript(CLIPBOARD_REFUSES)
    const driver = new SessionDriver(page, { touch: isMobile === true })
    await driver.toReady()
    await chooseFile(page, driver, { name: saved.name, mimeType: 'application/json', buffer: Buffer.from(saved.text) })
    await driver.begin()
    await driver.answerOne()
    await driver.finishEarly()
    await driver.resultsReady()
    await driver.press(button(page, 'Copy save code'))
    await expect(page.locator('[data-section="save"] [role="status"]')).toHaveText(FINISHED_COPY_FAILED)
    // Copying by hand is not saving: the guard stays on.
    expect(await unloadIsGuarded(page)).toBe(true)
    const manual = page.getByRole('textbox', { name: 'Save code' })
    await expect(manual).toBeVisible()
    await expect(manual).toHaveAttribute('readonly', '')
    const shown = await manual.inputValue()
    const decoded = await parseSaveText(shown)
    expect(decoded.ok).toBe(true)
    expectAddedTo(decoded.ok ? decoded.save : saved.file, saved.file)

    const other = await anotherDevice(browser)
    try {
      await other.driver.toReady()
      await pasteText(other.page, other.driver, shown)
      await expect(other.page.getByText(/^Loaded 2 earlier sessions/)).toBeVisible()
    } finally {
      await other.close()
    }
  })

  test('the notes settings that travelled in the save are the ones the notes builder shows on the other device', async ({ page, isMobile }) => {
    const driver = new SessionDriver(page, { touch: isMobile === true })
    await driver.toReady()
    await chooseFile(page, driver, { name: saved.name, mimeType: 'text/plain', buffer: Buffer.from(saved.text) })
    await driver.begin()
    await driver.answerOne()
    await driver.finishEarly()
    await driver.resultsReady()
    // The session wrote its autosave (it has an answer), and the autosave carries the settings of the save it started from.
    const stored = await localKeys(page)
    expect(stored.filter((k) => k !== PREFS_KEY && k.startsWith('hb:save:v1:'))).toHaveLength(1)
    expect(stored).not.toContain(PREFS_KEY)

    // The notes builder on this device finds them there, without being given anything.
    await page.goto('./notes.html')
    await expect(page.getByRole('heading', { level: 1, name: 'Notes for your AI' })).toBeVisible()
    await expectNotesSettings(page)
    // Reading them writes nothing new: the builder keeps its own copy only when the person asks.
    expect(await localKeys(page)).toEqual(stored)
  })

  test('the notes builder reads the settings from the session’s save file when it is given the file, and keeps them as they were', async ({ page, isMobile }) => {
    await loadIntoBuilder(page, isMobile === true, saved)
    await expectNotesSettings(page)
    // Loading is not keeping: nothing is written until the person asks.
    expect(await localKeys(page)).toEqual([])
    // The test answers in the file are left alone: the page shows no profile and says nothing of them.
    expect(await page.content()).not.toContain(saved.file.sessions[0]!.session_id)
    // Asked to keep them, the page writes all that the file held: the sets, the notes copied and the fit log.
    await page.getByLabel(COPY.keepAdult).check()
    await page.getByRole('button', { name: COPY.keepButton }).click()
    await expect(page.getByTestId('keep-status')).toHaveText(COPY.keepNow)
    await expect.poll(async () => (await page.evaluate<string | null>(`localStorage.getItem(${JSON.stringify(PREFS_KEY)})`)) ?? '', { timeout: 10_000 }).not.toBe('')
    const rewritten = JSON.parse((await page.evaluate<string>(`localStorage.getItem(${JSON.stringify(PREFS_KEY)})`))) as SaveFileV1
    expect(rewritten.sessions).toEqual([])
    expect(settingsOf(rewritten.brief_prefs)).toEqual(settingsOf(saved.file.brief_prefs))
    expect(rewritten.brief_prefs?.fit_log).toHaveLength(1)
    expect(rewritten.brief_prefs?.contexts[0]).toHaveProperty('copied')
  })

  test('a device that already has notes settings: a loaded file’s settings win set by set, the page says so, and the notes builder shows them', async ({ page, isMobile }) => {
    test.setTimeout(3 * 60_000)
    const driver = new SessionDriver(page, { touch: isMobile === true })
    const fileFirst = saved.file.brief_prefs!.contexts[0] as BriefContextV1
    const mine = deviceSettings(saved.file)
    const [mineFirst, mineSecond] = mine.contexts as [BriefContextV1, BriefContextV1]
    // The device's set was edited more often than the file's: a join by edit counts would keep the device's.
    expect(mineFirst.rev).toBeGreaterThan(fileFirst.rev)
    await keepSettingsOnDevice(page, mine, saved.file.anon_id)
    await driver.toReady()
    await expect(page.getByRole('heading', { level: 2, name: 'Earlier saves on this device' })).toBeVisible()
    await expect(page.getByRole('status')).toHaveText('')

    await chooseFile(page, driver, { name: saved.name, mimeType: 'application/json', buffer: Buffer.from(saved.text) })
    await expect(page.getByRole('status')).toContainText('Loaded 1 earlier session. Your new session will be added to it.')
    await expect(page.getByRole('status')).toContainText(READY_LOAD_PREFS_NOTICE)

    await driver.begin()
    await driver.answerOne()
    await driver.finishEarly()
    await driver.resultsReady()
    const after = await downloadSave(page, driver)
    expect(after.file.anon_id).toBe(saved.file.anon_id)
    expect(after.file.sessions).toHaveLength(2)
    // The file's set is the one in slot 1 (one rev above the device's, so every later join keeps it), the device's own second set is kept as it was.
    expect(after.file.brief_prefs!.contexts).toEqual([{ ...fileFirst, rev: mineFirst.rev + 1 }, mineSecond])
    expect(after.file.brief_prefs!.fit_log).toEqual(saved.file.brief_prefs!.fit_log)
    expect(after.text).not.toMatch(/chess|cooking|metric/)

    // The notes builder on this device shows the file's settings (Programming "I know this well"), not the device's old ones.
    await page.goto('./notes.html')
    await expect(page.getByRole('heading', { level: 1, name: 'Notes for your AI' })).toBeVisible()
    await expectNotesSettings(page)
  })

  test('the file’s notes settings win the same way when the new session is not added to the earlier saves on the device', async ({ page, isMobile }) => {
    test.setTimeout(3 * 60_000)
    const touch = isMobile === true
    const driver = new SessionDriver(page, { touch })
    const fileFirst = saved.file.brief_prefs!.contexts[0] as BriefContextV1
    const mine = deviceSettings(saved.file)
    const [mineFirst, mineSecond] = mine.contexts as [BriefContextV1, BriefContextV1]
    await keepSettingsOnDevice(page, mine, saved.file.anon_id)
    await driver.toReady()
    await leaveOutEarlierSaves(page, touch)
    await chooseFile(page, driver, { name: saved.name, mimeType: 'text/plain', buffer: Buffer.from(saved.text) })
    await expect(page.getByRole('status')).toContainText(READY_LOAD_PREFS_NOTICE)
    await driver.begin()
    await driver.answerOne()
    await driver.finishEarly()
    await driver.resultsReady()
    const after = await downloadSave(page, driver)
    // The session was built from the file alone: its own set, one rev above the device's. The download also takes in the notes
    // settings kept on this device under the same identifier, read at the click (D17): the device's second set comes with it.
    expect(after.file.brief_prefs!.contexts).toEqual([{ ...fileFirst, rev: mineFirst.rev + 1 }, mineSecond])

    // The device keeps its own save of the second set, and the session's save holds the file's first set at the higher rev.
    // Joined, the device has the file's settings in slot 1 and still its own second set.
    const stored = await Promise.all((await localKeys(page)).filter((k) => k.startsWith('hb:save:v1:')).map(async (k) => JSON.parse((await page.evaluate<string>(`localStorage.getItem(${JSON.stringify(k)})`))) as SaveFileV1))
    const sets = stored.flatMap((x) => x.brief_prefs?.contexts ?? []).filter((c): c is BriefContextV1 => !('removed' in c))
    expect(sets.filter((c) => c.slot === 2)).toEqual([mineSecond])
    const slotOne = sets.filter((c) => c.slot === 1).sort((a, b) => b.rev - a.rev)[0]
    expect(slotOne).toEqual({ ...fileFirst, rev: mineFirst.rev + 1 })

    await page.goto('./notes.html')
    await expect(page.getByRole('heading', { level: 1, name: 'Notes for your AI' })).toBeVisible()
    await expectNotesSettings(page)
  })

  test('a device with the same notes settings as the file is told nothing about them', async ({ page, isMobile }) => {
    const driver = new SessionDriver(page, { touch: isMobile === true })
    await keepSettingsOnDevice(page, saved.file.brief_prefs!, saved.file.anon_id)
    await driver.toReady()
    await chooseFile(page, driver, { name: saved.name, mimeType: 'application/json', buffer: Buffer.from(saved.text) })
    await expect(page.getByRole('status')).toContainText('Loaded 1 earlier session.')
    await expect(page.getByRole('status')).not.toContainText(READY_LOAD_PREFS_NOTICE)
  })

  test('a change made in the notes builder after a session is in the next session’s save, and in the file that save is downloaded as', async ({ page, browser, isMobile }) => {
    test.setTimeout(4 * 60_000)
    const touch = isMobile === true
    const driver = new SessionDriver(page, { touch })
    const rev = saved.file.brief_prefs!.contexts[0]!.rev
    // A device that holds the first save (and so its settings) and has played a short session of its own.
    await driver.toReady()
    await chooseFile(page, driver, { name: saved.name, mimeType: 'application/json', buffer: Buffer.from(saved.text) })
    await driver.begin()
    await driver.answerOne()
    await driver.finishEarly()
    await driver.resultsReady()

    // The person opens the notes builder, which shows the settings as kept (the session holds them), and moves
    // Programming to "New to me". The kept copy changes with it, with no question asked again (18+ was answered).
    await page.goto('./notes.html')
    await expect(page.getByRole('heading', { level: 1, name: 'Notes for your AI' })).toBeVisible()
    await expectNotesSettings(page)
    await expect(page.getByTestId('keep-state')).toHaveText(COPY.keepDone)
    await page.getByRole('group', { name: 'Programming' }).getByLabel(/New to me/).check()
    await expect.poll(async () => (await page.evaluate<string | null>(`localStorage.getItem(${JSON.stringify(PREFS_KEY)})`)) ?? '', { timeout: 10_000 }).toContain('"build"')

    // The next session starts from the edited settings, not the ones the earlier session held.
    await driver.toReady()
    await driver.begin()
    await driver.answerOne()
    await driver.finishEarly()
    await driver.resultsReady()
    const next = await downloadSave(page, driver)
    expect(next.file.sessions).toHaveLength(3)
    expect(next.file.anon_id).toBe(saved.file.anon_id)
    const edited = next.file.brief_prefs!.contexts[0]!
    expect(edited).toMatchObject({ preset: 'coding', topics: { 'other/programming': 'build', 'other/statistics': 'ask_first' } })
    expect(edited.rev, 'the edit is a newer revision of the set').toBeGreaterThan(rev)
    expect(next.file.brief_prefs!.fit_log, 'the fit log is carried along').toEqual(saved.file.brief_prefs!.fit_log)
    expect(next.text).not.toMatch(/chess|cooking|metric/)

    // The builder still shows the edit once the sessions are over.
    await page.goto('./notes.html')
    await expect(page.getByRole('heading', { level: 1, name: 'Notes for your AI' })).toBeVisible()
    await expectNotesSettings(page, /New to me/)

    // And the file carries it to a device that has nothing.
    const other = await anotherDevice(browser)
    try {
      await loadIntoBuilder(other.page, touch, next)
      await expectNotesSettings(other.page, /New to me/)
    } finally {
      await other.close()
    }
  })
})
