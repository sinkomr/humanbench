/// <reference lib="dom" />
/**
 * Persona "Pat", part B (package rev-sharer; run id `sharer`): talking to an AI, the notes builder, a second device and
 * bad inputs on the ready screen. Part A (save panel, share card) is `sharer.ux.ts`. Each test runs by itself:
 *
 *   UX_PORT=4617 UX_RUN=sharer npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/sharer-b.ux.ts --project=chromium --grep 'sharer-b: talk'
 *
 * Output: web/test-results/ux-review/sharer/<test>-<project>/... with a facts JSON per test.
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { devices, expect, test, type Browser, type BrowserContext, type Download, type Locator, type Page } from '@playwright/test'
import { PREAMBLE } from '../../src/brief/results-talk'
import { lintText } from '../../scripts/language-lint'
import { button, h1, simulatedSave, toResults } from '../../e2e/flow'
import { SessionDriver } from '../../e2e/session-driver'
import { Shots, trackConsole, UX_ROOT } from '../lib'

const RUN = process.env.UX_RUN ?? 'sharer'

const dirOf = (sub: string): string => {
  const dir = path.join(UX_ROOT, RUN, sub)
  mkdirSync(dir, { recursive: true })
  return dir
}

async function keep(download: Download, sub: string, as?: string): Promise<{ name: string; bytes: number; file: string }> {
  const name = download.suggestedFilename()
  const file = path.join(dirOf(sub), as ?? `dl-${name}`)
  await download.saveAs(file)
  return { name, bytes: statSync(file).size, file }
}

const SHARE_RECORDER = `(() => {
  window.__shareCalls = []
  Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: (d) => !!d && Array.isArray(d.files) && d.files.length > 0 })
  Object.defineProperty(Navigator.prototype, 'share', {
    configurable: true,
    value: async (d) => { window.__shareCalls.push({ keys: Object.keys(d || {}), title: d && d.title, text: d && d.text, files: ((d && d.files) || []).map((f) => f.name + ' ' + f.type + ' ' + f.size) }) },
  })
})()`

const focused = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const a = document.activeElement
    return a ? `${a.tagName}${a.id ? '#' + a.id : ''} ${(a.getAttribute('data-testid') ?? '')} ${(a.textContent || '').trim().slice(0, 40)}` : ''
  })

const savePanel = (page: Page): Locator => page.locator('section[data-section="save"]')

/** Results of the simulated person (one earlier session plus a finished-early one), save downloaded: the after-save cards are up. */
async function savedResults(page: Page, sub: string): Promise<{ name: string; bytes: number; file: string }> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await toResults(page, 1)
  await expect(button(page, 'Download save file')).toBeVisible()
  await savePanel(page).scrollIntoViewIfNeeded()
  const [dl] = await Promise.all([page.waitForEvent('download'), button(page, 'Download save file').click()])
  const got = await keep(dl, sub)
  await expect(page.locator('[data-section="after-save"]')).toBeVisible()
  return got
}

/** A real short session on a clean device, then the save downloaded: the after-save cards are up. */
async function realSavedResults(page: Page, touch: boolean, sub: string): Promise<{ name: string; bytes: number; file: string }> {
  await shortSession(page, touch)
  await savePanel(page).scrollIntoViewIfNeeded()
  const [dl] = await Promise.all([page.waitForEvent('download'), button(page, 'Download save file').click()])
  const got = await keep(dl, sub)
  await expect(page.locator('[data-section="after-save"]')).toBeVisible()
  return got
}

/** A real short session on a clean device: skip the reaction tasks, answer one matrix item, finish early. */
async function shortSession(page: Page, touch: boolean): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const d = new SessionDriver(page, { touch })
  await d.toReady('./?fast=1')
  return d.begin().then(async () => {
    await d.answerOne()
    await d.finishEarly()
    await d.resultsReady()
  })
}

const NEW_CONTEXT_FOR: Record<string, string> = { chromium: 'Desktop Chrome', webkit: 'Desktop Safari', iphone: 'iPhone 13', 'iphone-se': 'iPhone SE', pixel: 'Pixel 7' }
async function secondDevice(browser: Browser, project: string, baseURL: string): Promise<BrowserContext> {
  const preset = (devices as Record<string, object>)[NEW_CONTEXT_FOR[project] ?? 'Desktop Chrome'] ?? {}
  return browser.newContext({ ...preset, baseURL, acceptDownloads: true })
}

const words = (s: string): string[] => [...s.toLowerCase().matchAll(/[a-z]+/g)].map((m) => m[0])

// ------------------------------------------------------------------------------------------------ 3. talking to an AI

test.describe('sharer-b: AI', () => {
  test('sharer-b: talk (results-talk helper, notes link)', async ({ page, context }, testInfo) => {
    const project = testInfo.project.name
    const sub = `talk-${project}`
    const shots = new Shots(page, RUN, sub)
    const log = trackConsole(page)
    const facts: Record<string, unknown> = { project }
    if (project === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await savedResults(page, sub)
    const ai = page.locator('[data-slot="working-with-ai"]')
    await ai.scrollIntoViewIfNeeded()
    facts.aiCardText = ((await ai.innerText()) ?? '').trim()
    await shots.shot('ai-card', { locator: ai })
    facts.aiCardHeadings = await ai.locator('h2,h3,h4').allInnerTexts()

    // The link from the share card to the helper.
    const link = page.locator('[data-talk-link] a')
    facts.talkLinkText = ((await page.locator('[data-talk-link]').innerText()) ?? '').trim()
    await link.scrollIntoViewIfNeeded()
    const y0 = await page.evaluate(() => Math.round(window.scrollY))
    await link.click()
    await page.waitForTimeout(500)
    facts.talkJump = { scrollBefore: y0, scrollAfter: await page.evaluate(() => Math.round(window.scrollY)), focus: await focused(page) }
    await shots.shot('after-talk-link', { fullPage: false })

    // What exactly is copied.
    const talk = page.getByTestId('results-talk')
    facts.helperText = ((await talk.innerText()) ?? '').trim()
    await button(page, 'Copy the text to paste first').click()
    await page.waitForTimeout(500)
    facts.copyStatus = ((await page.getByTestId('results-talk-status').textContent()) ?? '').trim()
    if (project === 'chromium') {
      const clip = await page.evaluate(() => navigator.clipboard.readText())
      facts.clipboard = clip
      facts.clipboardEqualsPreamble = clip === PREAMBLE
      facts.clipboardLength = clip.length
    } else {
      facts.preambleOnScreen = ((await page.getByTestId('preamble').innerText()) ?? '').trim()
    }
    await shots.shot('helper-after-copy', { locator: talk })
    facts.preambleA13 = lintText(PREAMBLE, 'preamble')
    // Does the helper say what to do after pasting the first text?
    facts.mentionsWhatNext = /then (tell|describe|ask|add|paste)|your own words|attach|describe your/i.test(facts.helperText as string)

    // The notes link opens a new tab.
    const href = await page.getByTestId('notes-link').getAttribute('href')
    facts.notesHref = href
    facts.notesLinkText = ((await page.getByTestId('notes-link').textContent()) ?? '').trim()
    const [popup] = await Promise.all([context.waitForEvent('page'), page.getByTestId('notes-link').click()])
    await popup.waitForLoadState('domcontentloaded')
    facts.popupUrl = popup.url()
    facts.popupTitle = await popup.title()
    await expect(popup.getByRole('heading', { level: 1, name: 'Notes for your AI' })).toBeVisible()
    const ps = new Shots(popup, RUN, `${sub}-notes-tab`)
    await ps.shot('notes-first-screen', { fullPage: false })
    facts.notesPageHeight = await popup.evaluate(() => document.documentElement.scrollHeight)
    facts.notesViewport = await popup.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    facts.notesBackLink = await popup.locator('a').evaluateAll((as) => as.map((a) => `${a.textContent?.trim()} -> ${a.getAttribute('href')}`))
    facts.openerStillOnResults = ((await h1(page).textContent()) ?? '').trim()
    shots.json('facts', { ...facts, console: log })
  })
})

test.describe('sharer-b: notes', () => {
  test('sharer-b: notes builder (build, copy, keep, come back)', async ({ page, context, browser }, testInfo) => {
    const project = testInfo.project.name
    const sub = `notes-${project}`
    const shots = new Shots(page, RUN, sub)
    const facts: Record<string, unknown> = { project }
    if (project === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const first = await realSavedResults(page, testInfo.project.use.hasTouch === true, sub)
    const idsOf = (file: string): { anon: string; sessions: number } => {
      const d = JSON.parse(readFileSync(file, 'utf8')) as { anon_id: string; sessions: unknown[] }
      return { anon: d.anon_id, sessions: d.sessions.length }
    }
    facts.firstSave = { name: first.name, ...idsOf(first.file) }
    const [np] = await Promise.all([context.waitForEvent('page'), page.getByTestId('notes-link').click()])
    await np.waitForLoadState('domcontentloaded')
    await expect(np.locator('#notes-text')).toContainText('How I like explanations')
    const ns = new Shots(np, RUN, `${sub}-tab`)
    await np.bringToFront()
    await ns.shot('01-as-opened-viewport', { fullPage: false })
    facts.firstScreenText = ((await np.locator('main').innerText({ timeout: 3000 }).catch(() => '')) ?? '').slice(0, 900)
    facts.headingsAtOpen = await np.locator('h1,h2').allInnerTexts()
    facts.pageHeightAtOpen = await np.evaluate('document.documentElement.scrollHeight')

    // Build: a context, one topic, one choice.
    await np.getByRole('radio', { name: /Learning something new/ }).check()
    await np.getByRole('button', { name: /Probability and counting/ }).first().click()
    const group = np.getByRole('group', { name: 'Probability and counting' })
    facts.topicGroupText = ((await group.innerText()) ?? '').trim()
    await group.getByLabel(/New to me/).check()
    await np.getByLabel(/Short answers/).check()
    await np.waitForTimeout(300)
    await ns.shot('02-built-viewport', { fullPage: false })
    const notes = ((await np.locator('#notes-text').innerText()) ?? '').trim()
    facts.notesLength = notes.length
    facts.notesLineCount = notes.split('\n').length
    facts.notesText = notes
    facts.notesA13 = lintText(notes, 'notes')
    facts.counter = ((await np.getByTestId('counter').innerText()) ?? '').trim()
    // Copy.
    const copyBtn = np.getByRole('button', { name: 'Copy the notes' })
    await copyBtn.scrollIntoViewIfNeeded()
    await copyBtn.click()
    await np.waitForTimeout(500)
    facts.copyStatus = ((await np.getByTestId('status').first().textContent({ timeout: 3000 }).catch(() => '')) ?? '').trim()
    if (project === 'chromium') {
      const clip = await np.evaluate(() => navigator.clipboard.readText())
      facts.clipboardEqualsPreview = clip.trim() === notes
      facts.clipboardLength = clip.length
    }
    await ns.shot('03-after-copy-viewport', { fullPage: false })
    // The notes download.
    const dlBtn = np.getByRole('button', { name: /^Download hb-notes/ }).or(np.getByRole('link', { name: /^Download hb-notes/ }))
    facts.notesDownloadLabel = ((await dlBtn.first().textContent({ timeout: 3000 }).catch(() => '')) ?? '').trim()
    const [nd] = await Promise.all([np.waitForEvent('download'), dlBtn.first().click()])
    const gotN = await keep(nd, `${sub}-tab`)
    facts.notesDownload = { name: gotN.name, bytes: gotN.bytes }

    // Keep settings: needs the 18+ tick.
    const keepBtn = np.getByRole('button', { name: 'Keep my settings on this device' })
    await keepBtn.scrollIntoViewIfNeeded()
    await keepBtn.click()
    await np.waitForTimeout(400)
    facts.keepWithoutTick = ((await np.getByTestId('adult-error').textContent({ timeout: 1500 }).catch(() => '')) ?? '').trim()
    await ns.shot('04-after-keep-click', { fullPage: false })
    // The 18+ tick is asked for only when this browser holds no consent record (it does here: the person passed the gate in the app).
    facts.adultTickShown = (await np.getByLabel('I am 18 or older').count()) > 0 && (await np.getByLabel('I am 18 or older').isVisible().catch(() => false))
    if (facts.adultTickShown === true) {
      await np.getByLabel('I am 18 or older').check()
      await keepBtn.click()
    }
    await expect(np.getByTestId('keep-state').first()).toBeVisible()
    facts.keepState = ((await np.getByTestId('keep-state').first().textContent()) ?? '').trim()
    facts.keepStatus = ((await np.getByTestId('keep-status').textContent({ timeout: 1500 }).catch(() => '')) ?? '').trim()
    facts.keepSectionText = ((await np.getByTestId('keep-settings').innerText()) ?? '').trim()
    await ns.shot('05-kept', { locator: np.getByTestId('keep-settings') })

    // Come back: reload the notes tab; then open it fresh from the results tab.
    await np.reload()
    await expect(np.locator('#notes-text')).toContainText('How I like explanations')
    facts.afterReload = {
      learningChecked: await np.getByRole('radio', { name: /Learning something new/ }).isChecked(),
      keepState: ((await np.getByTestId('keep-state').first().textContent({ timeout: 3000 }).catch(() => '')) ?? '').trim(),
      returningShown: (await np.getByTestId('returning').count()) > 0,
      returningText: ((await np.getByTestId('returning').innerText({ timeout: 3000 }).catch(() => '')) ?? '').trim(),
    }
    await ns.shot('06-after-reload-viewport', { fullPage: false })
    await np.getByRole('radio', { name: /Learning something new/ }).scrollIntoViewIfNeeded()
    await ns.all('07-after-reload-full')

    // Back on the results tab: does the next save file carry the notes settings?
    await page.bringToFront()
    await savePanel(page).scrollIntoViewIfNeeded()
    const [dl2] = await Promise.all([page.waitForEvent('download'), button(page, 'Download save file').click()])
    const got2 = await keep(dl2, sub, 'save-with-notes-settings.json')
    const doc = JSON.parse(readFileSync(got2.file, 'utf8')) as Record<string, unknown>
    facts.saveAfterKeepKeys = Object.keys(doc)
    facts.saveAfterKeepHasBriefPrefs = 'brief_prefs' in doc
    facts.saveAfterKeepBytes = got2.bytes

    // The notes page's own download: "Download a save file with my settings".
    await np.bringToFront()
    const dlSettings = np.getByRole('button', { name: 'Download a save file with my settings' })
    await dlSettings.scrollIntoViewIfNeeded()
    const [dl3] = await Promise.all([np.waitForEvent('download'), dlSettings.click()])
    const got3 = await keep(dl3, sub, 'save-from-notes-page.json')
    const doc3 = JSON.parse(readFileSync(got3.file, 'utf8')) as Record<string, unknown>
    facts.notesPageSave = { name: got3.name, bytes: got3.bytes, keys: Object.keys(doc3), hasBriefPrefs: 'brief_prefs' in doc3, sessions: Array.isArray(doc3.sessions) ? doc3.sessions.length : null, anon: doc3.anon_id }
    facts.resultsSaveAfterKeep = { name: got2.name, ...idsOf(got2.file) }
    facts.notesPageSaveStatus = ((await np.getByTestId('keep-status').textContent({ timeout: 1500 }).catch(() => '')) ?? '').trim()
    await ns.shot('08-after-notes-page-save', { fullPage: false })

    // A second device: the notes page loads the settings from the results page's save file, then from the notes page's.
    const ctx2 = await secondDevice(browser, project, String(testInfo.project.use.baseURL))
    const p2 = await ctx2.newPage()
    const s2 = new Shots(p2, RUN, `${sub}-device2`)
    await p2.goto('./notes.html')
    await expect(p2.locator('#notes-text')).toContainText('How I like explanations')
    facts.device2LearningCheckedBefore = await p2.getByRole('radio', { name: /Learning something new/ }).isChecked()
    await p2.getByTestId('load-file').setInputFiles(got2.file)
    await p2.getByTestId('load-button').click()
    await p2.waitForTimeout(500)
    facts.device2LoadStatus = ((await p2.getByTestId('load-status').textContent()) ?? '').trim()
    facts.device2LearningChecked = await p2.getByRole('radio', { name: /Learning something new/ }).isChecked()
    facts.device2Notes = ((await p2.locator('#notes-text').innerText()) ?? '').trim() === notes
    await s2.shot('load-settings-result-results-save', { locator: p2.getByTestId('keep-settings') })
    await p2.getByTestId('load-file').setInputFiles(got3.file)
    await p2.getByTestId('load-button').click()
    await p2.waitForTimeout(500)
    facts.device2LoadStatusNotesSave = ((await p2.getByTestId('load-status').textContent()) ?? '').trim()
    facts.device2LearningCheckedNotesSave = await p2.getByRole('radio', { name: /Learning something new/ }).isChecked()
    facts.device2NotesNotesSave = ((await p2.locator('#notes-text').innerText()) ?? '').trim() === notes
    await s2.shot('load-settings-result-notes-save', { locator: p2.getByTestId('keep-settings') })
    await ctx2.close()
    shots.json('facts', facts)
  })
})

// ------------------------------------------------------------------------------------------------ 4. a second device

test.describe('sharer-b: second device', () => {
  test('sharer-b: second device (file, session, results of both, save and share again)', async ({ page, browser }, testInfo) => {
    const project = testInfo.project.name
    const touch = testInfo.project.use.hasTouch === true
    const sub = `device2-${project}`
    const shots = new Shots(page, RUN, sub)
    const facts: Record<string, unknown> = { project }
    const baseURL = String(testInfo.project.use.baseURL)

    // Device A: a real short session, results, the save file.
    await shortSession(page, touch)
    await shots.shot('a-results-top', { fullPage: false })
    facts.aSessionLine = ((await page.locator('.reveal [role="status"]').first().textContent({ timeout: 3000 }).catch(() => '')) ?? '').trim()
    await savePanel(page).scrollIntoViewIfNeeded()
    const [dl] = await Promise.all([page.waitForEvent('download'), button(page, 'Download save file').click()])
    const a = await keep(dl, sub, 'save-A.hbsave.json')
    facts.fileA = { name: a.name, bytes: a.bytes, sessions: (JSON.parse(readFileSync(a.file, 'utf8')) as { sessions: unknown[] }).sessions.length }
    const cardA = page.locator('[data-share-card]')
    await cardA.scrollIntoViewIfNeeded()
    facts.aCardText = ((await cardA.innerText()) ?? '').trim()
    facts.aCardSkillBoxes = await cardA.locator('input[data-skill]').count()
    facts.aPreviewShown = await page.locator('img[data-preview]').count()
    facts.aPngEnabled = await button(page, 'Download image (PNG)').isEnabled({ timeout: 3000 }).catch(() => null)
    await shots.shot('a-card-panel', { locator: cardA })

    // Device B: a clean browser; load the file on the ready screen.
    const ctxB = await secondDevice(browser, project, baseURL)
    const b = await ctxB.newPage()
    await b.addInitScript(SHARE_RECORDER)
    const bs = new Shots(b, RUN, `${sub}-b`)
    const dB = new SessionDriver(b, { touch })
    await b.emulateMedia({ reducedMotion: 'reduce' })
    await dB.toReady('./?fast=1')
    await bs.shot('b-ready-fresh', { fullPage: false })
    facts.bReadyHeadings = await b.locator('h1,h2').allInnerTexts()
    await b.getByLabel('Save file').setInputFiles(a.file)
    await button(b, 'Load').click()
    await b.waitForTimeout(400)
    facts.bLoadMessage = ((await b.locator('[role="status"]').last().textContent()) ?? '').trim()
    await bs.shot('b-ready-loaded', { fullPage: true })
    await dB.begin()
    await dB.answerOne()
    await dB.finishEarly()
    await dB.resultsReady()
    await bs.shot('b-results-top', { fullPage: false })
    facts.bResultsText = ((await b.locator('.reveal').innerText()) ?? '').slice(0, 1800)
    const sessionMentions = ((await b.locator('body').innerText()) ?? '').match(/[^.\n]*\b(\d+|one|two|three) sessions?\b[^.\n]*\./gi)
    facts.bSessionMentions = sessionMentions
    await savePanel(b).scrollIntoViewIfNeeded()
    const [dl2] = await Promise.all([b.waitForEvent('download'), button(b, 'Download save file').click()])
    const gotB = await keep(dl2, sub, 'save-B.hbsave.json')
    const docB = JSON.parse(readFileSync(gotB.file, 'utf8')) as { sessions: { session_id: string }[]; anon_id: string }
    const docA = JSON.parse(readFileSync(a.file, 'utf8')) as { sessions: { session_id: string }[]; anon_id: string }
    facts.fileB = { name: gotB.name, bytes: gotB.bytes, sessions: docB.sessions.length, sameAnonId: docA.anon_id === docB.anon_id, nameA: a.name, nameB: gotB.name }
    // Share again.
    const cardB = b.locator('[data-share-card]')
    await cardB.scrollIntoViewIfNeeded()
    facts.bCardText = ((await cardB.innerText()) ?? '').trim()
    facts.bCardSkillBoxes = await cardB.locator('input[data-skill]').count()
    await bs.shot('b-card-panel', { locator: cardB })
    if ((await b.locator('img[data-preview]').count()) > 0) {
      const [png] = await Promise.all([b.waitForEvent('download'), button(b, 'Download image (PNG)').click()])
      const gp = await keep(png, `${sub}-b`, 'card-B.png')
      facts.bPng = { name: gp.name, bytes: gp.bytes }
    }
    // The file lost by mistake: what does the start page offer a person with a save elsewhere (device B has an autosave now)?
    await b.goto('./')
    await bs.shot('b-start-again', { fullPage: false })
    facts.bStartText = ((await b.locator('main, body').first().innerText()) ?? '').slice(0, 600)
    await ctxB.close()

    // Device C: the save code pasted, with spaces and line breaks.
    const code = gzipSync(Buffer.from(readFileSync(a.file))).toString('base64')
    const wrapped = (code.match(/.{1,60}/g) ?? []).join('\n  ')
    const ctxC = await secondDevice(browser, project, baseURL)
    const c = await ctxC.newPage()
    const cs = new Shots(c, RUN, `${sub}-c`)
    const dC = new SessionDriver(c, { touch })
    await c.emulateMedia({ reducedMotion: 'reduce' })
    await dC.toReady('./?fast=1')
    await c.getByLabel('Or paste a save code').fill(wrapped)
    await button(c, 'Load').click()
    await c.waitForTimeout(400)
    facts.cPasteMessage = ((await c.locator('[role="status"]').last().textContent()) ?? '').trim()
    await cs.shot('c-ready-pasted', { fullPage: true })
    await ctxC.close()
    shots.json('facts', facts)
  })
})

// ------------------------------------------------------------------------------------------------ extra flows

test.describe('sharer-b: flows', () => {
  test('sharer-b: forgot Load (file chosen, Begin pressed)', async ({ page }, testInfo) => {
    const project = testInfo.project.name
    const touch = testInfo.project.use.hasTouch === true
    const sub = `forgot-load-${project}`
    const shots = new Shots(page, RUN, sub)
    const facts: Record<string, unknown> = { project }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const d = new SessionDriver(page, { touch })
    await d.toReady('./?fast=1')
    const sim = simulatedSave(1)
    await page.getByLabel('Save file').setInputFiles({ name: 'humanbench-save.hbsave.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sim.save)) })
    await shots.shot('file-chosen-not-loaded', { fullPage: true })
    facts.beginRect = await page.getByRole('button', { name: 'Begin', exact: true }).evaluate((el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top + window.scrollY) } })
    facts.loadRect = await page.getByRole('button', { name: 'Load', exact: true }).evaluate((el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top + window.scrollY) } })
    facts.viewportH = await page.evaluate(() => window.innerHeight)
    await d.begin()
    await d.answerOne()
    await d.finishEarly()
    await d.resultsReady()
    await savePanel(page).scrollIntoViewIfNeeded()
    const [dl] = await Promise.all([page.waitForEvent('download'), button(page, 'Download save file').click()])
    const got = await keep(dl, sub)
    const doc = JSON.parse(readFileSync(got.file, 'utf8')) as { sessions: unknown[]; anon_id: string }
    facts.sessionsInSave = doc.sessions.length
    facts.simulatedSessions = (sim.save as { sessions: unknown[] }).sessions.length
    facts.anonIdSame = doc.anon_id === (sim.save as { anon_id: string }).anon_id
    facts.warnedBeforeBegin = null
    shots.json('facts', facts)
  })

  test('sharer-b: stay and save (where does Pat land)', async ({ page }, testInfo) => {
    const project = testInfo.project.name
    const sub = `stay-${project}`
    const shots = new Shots(page, RUN, sub)
    const facts: Record<string, unknown> = { project }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await toResults(page, 1)
    await expect(button(page, 'Download save file')).toBeVisible()
    const vh = await page.evaluate(() => window.innerHeight)
    const topOf = (loc: Locator): Promise<number> => loc.evaluate((el) => Math.round(el.getBoundingClientRect().top + window.scrollY))
    facts.viewportH = vh
    facts.savePanelTop = await topOf(savePanel(page))
    facts.pageHeight = await page.evaluate(() => document.documentElement.scrollHeight)
    const back = button(page, 'Back to the start')
    await back.scrollIntoViewIfNeeded()
    facts.backButtonTop = await topOf(back)
    await back.click()
    await expect(page.getByRole('heading', { level: 2, name: 'Leave without saving?' })).toBeVisible()
    await shots.shot('leave-question', { fullPage: false })
    await button(page, 'Stay and save').click()
    await page.waitForTimeout(500)
    facts.scrollYAfterStay = await page.evaluate(() => Math.round(window.scrollY))
    const r = await savePanel(page).evaluate((el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) } })
    facts.savePanelRectAfterStay = r
    facts.savePanelInViewAfterStay = r.bottom > 0 && r.top < vh
    facts.distanceToSavePanel = Math.abs(r.top)
    facts.focusAfterStay = await focused(page)
    await shots.shot('after-stay', { fullPage: false })
    // And the top of the results: anything about saving?
    await page.evaluate(() => window.scrollTo(0, 0))
    facts.topOfPageSaveMentions = ((await page.locator('body').innerText()) ?? '').slice(0, 1200).match(/[^.\n]*\b(save|saved|download)\b[^.\n]*/gi)
    await shots.shot('results-top', { fullPage: false })
    shots.json('facts', facts)
  })
})

// ------------------------------------------------------------------------------------------------ 5. bad inputs

interface Case {
  readonly id: string
  readonly label: string
  readonly file?: { name: string; mimeType: string; buffer: Buffer }
  readonly code?: string
  /** Choose a bad file first, press Load, then paste this valid code and press Load again. */
  readonly then?: string
}

test.describe('sharer-b: bad inputs', () => {
  test('sharer-b: bad saves on the ready screen', async ({ page }, testInfo) => {
    const project = testInfo.project.name
    const touch = testInfo.project.use.hasTouch === true
    const sub = `bad-${project}`
    const shots = new Shots(page, RUN, sub)
    const facts: Record<string, unknown> = { project }
    // A good save to damage: the app's own download.
    await savedResults(page, sub)
    const good = readFileSync(path.join(dirOf(sub), (await readdirGood(sub))!))
    const goodText = good.toString('utf8')
    const goodDoc = JSON.parse(goodText) as { sessions: { responses: unknown[][] }[]; created_utc: string; posterior_cache?: unknown; schema_version: string }
    // A hand-edited one: every answer marked right, a reaction time of 1 ms.
    const edited = JSON.parse(goodText) as typeof goodDoc
    for (const s of edited.sessions) for (const r of s.responses) if (r.length > 3 && r[3] === 0) r[3] = 1
    if (edited.sessions[0]?.responses[0]) edited.sessions[0].responses[0][4] = 1
    const newer = { ...JSON.parse(goodText), schema_version: '9.0.0' }
    const badCode = gzipSync(Buffer.from(goodText)).toString('base64')
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, ...new Array<number>(200).fill(7)])
    const cases: Case[] = [
      { id: 'nothing', label: 'Load pressed with nothing chosen' },
      { id: 'truncated', label: 'a truncated file (first 40%)', file: { name: 'humanbench-save.hbsave.json', mimeType: 'application/json', buffer: good.subarray(0, Math.floor(good.length * 0.4)) } },
      { id: 'hand-edited', label: 'a hand-edited file (answers marked right)', file: { name: 'humanbench-save.hbsave.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(edited)) } },
      { id: 'random-text', label: 'a text file of random words', file: { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Shopping list: eggs, milk, bread. Call Sam on Friday about the thing.') } },
      { id: 'empty', label: 'an empty file', file: { name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) } },
      { id: 'huge', label: 'a very large file (9 MB of text)', file: { name: 'big.txt', mimeType: 'text/plain', buffer: Buffer.alloc(9 * 1024 * 1024, 'abcdefgh ') } },
      { id: 'other-json', label: 'JSON that is not a save', file: { name: 'package.json', mimeType: 'application/json', buffer: Buffer.from('{"name":"my-app","version":"1.0.0"}') } },
      { id: 'array-json', label: 'a JSON list', file: { name: 'list.json', mimeType: 'application/json', buffer: Buffer.from('[1,2,3]') } },
      { id: 'newer', label: 'a save from a newer version (9.0.0)', file: { name: 'humanbench-save.hbsave.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(newer)) } },
      { id: 'card-png', label: 'the share card picture chosen by mistake (a PNG)', file: { name: 'humanbench-card-2026-10-03.png', mimeType: 'image/png', buffer: png } },
      { id: 'code-wrapped', label: 'a save code with spaces and line breaks', code: `  ${(badCode.match(/.{1,60}/g) ?? []).join('\n  ')}  \n` },
      { id: 'code-in-email', label: 'a save code inside other text', code: `Hi me,\nhere is my HumanBench code:\n\n${(badCode.match(/.{1,76}/g) ?? []).join('\n')}\n\nSent from my iPhone` },
      { id: 'code-cut', label: 'a save code with the last third missing', code: badCode.slice(0, Math.floor(badCode.length * 0.66)) },
      { id: 'code-garbage', label: 'a pasted code with a typo in the middle', code: badCode.slice(0, 500) + '!!??' + badCode.slice(500) },
      { id: 'code-space-inside', label: 'a code with a space inside a line (copied from a chat)', code: badCode.replace(/(.{40})/, '$1 ') },
      { id: 'file-then-code', label: 'a bad file first, then a good code pasted: Load again', file: { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a save') }, then: badCode },
      { id: 'good-file-txt', label: 'the real save renamed .txt (what iOS may do)', file: { name: 'humanbench-save.txt', mimeType: 'text/plain', buffer: good } },
    ]
    facts.goodBytes = good.length

    // A clean ready screen for each case would take 15 s each: reload the ready screen only when the page leaves it.
    const d = new SessionDriver(page, { touch })
    const out: Record<string, unknown>[] = []
    const startFresh = async (): Promise<void> => {
      await d.toReady('./?fast=1')
    }
    // Use a fresh context state: the saved results above left an autosave, so go to a new page of the same browser after clearing storage.
    await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear() } catch { /* ignore */ } })
    page.on('dialog', (x) => void x.dismiss())
    await startFresh()
    for (const c of cases) {
      const row: Record<string, unknown> = { id: c.id, label: c.label }
      try {
        if (c.file) await page.getByLabel('Save file').setInputFiles(c.file)
        else await page.getByLabel('Save file').setInputFiles([])
        await page.getByLabel('Or paste a save code').fill(c.code ?? '')
        const t0 = Date.now()
        await button(page, 'Load').click()
        await page.waitForTimeout(700)
        const status = page.locator('[role="status"]').last()
        row.message = ((await status.textContent()) ?? '').trim()
        row.isError = await status.evaluate((el) => el.classList.contains('error'))
        row.ms = Date.now() - t0
        row.focus = await focused(page)
        row.pageErrorBadge = await page.locator('.error').count()
        await status.scrollIntoViewIfNeeded()
        await shots.shot(`case-${c.id}`, { fullPage: false })
        if (c.then !== undefined) {
          await page.getByLabel('Or paste a save code').fill(c.then)
          await button(page, 'Load').click()
          await page.waitForTimeout(500)
          row.messageAfterGoodCode = ((await status.textContent()) ?? '').trim()
          row.isErrorAfterGoodCode = await status.evaluate((el) => el.classList.contains('error'))
          row.fileStillChosen = await page.getByLabel('Save file').evaluate((el) => (el as HTMLInputElement).files?.[0]?.name ?? '')
          row.codeBoxStillFilled = ((await page.getByLabel('Or paste a save code').inputValue()) ?? '').length
          await status.scrollIntoViewIfNeeded()
          await shots.shot(`case-${c.id}-after-good-code`, { fullPage: false })
        }
      } catch (error) {
        row.exception = String(error).split('\n')[0]
      }
      out.push(row)
      // Leave a clean state for the next case: no file, no code, no loaded save.
      if (typeof row.message === 'string' && /^Loaded /.test(row.message)) {
        await page.reload().catch(() => undefined)
        await startFresh()
      }
    }
    facts.cases = out
    shots.json('facts', facts)
  })
})

/** The file the save download left in `sub` (the first dl-*.hbsave.json). */
async function readdirGood(sub: string): Promise<string | undefined> {
  const { readdirSync } = await import('node:fs')
  return readdirSync(dirOf(sub)).find((f) => /^dl-.*\.hbsave\.json$/.test(f))
}

// A reference so unused imports stay meaningful if a case is removed while editing.
void words
void writeFileSync
