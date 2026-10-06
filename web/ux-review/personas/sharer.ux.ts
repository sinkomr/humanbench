/// <reference lib="dom" />
/**
 * Persona "Pat": wants to show friends their blob and keep the results for next time; an iPhone and a laptop
 * (package rev-sharer; run id `sharer`). Each test is independent and meant to run by itself:
 *
 *   UX_PORT=4617 UX_RUN=sharer npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/sharer.ux.ts --project=chromium --grep 'sharer: save panel'
 *
 * Output: web/test-results/ux-review/sharer/<test>-<project>/... Every test writes a JSON of the facts it measured next to
 * the screenshots; the findings file cites them.
 */

import { mkdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Download, type Locator, type Page } from '@playwright/test'
import { RESOURCE_LINE } from '../../src/copy'
import { NOTES_LEAK_MARKERS } from '../../src/brief/leak-markers'
import { lintText } from '../../scripts/language-lint'
import { button, h1, toResults, unloadIsGuarded } from '../../e2e/flow'
import { Shots, trackConsole, UX_ROOT } from '../lib'

const RUN = process.env.UX_RUN ?? 'sharer'

/** Where this test's files go: web/test-results/ux-review/sharer/<sub>/. */
const dirOf = (sub: string): string => {
  const dir = path.join(UX_ROOT, RUN, sub)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** A download event saved under the test's folder; returns its facts. */
interface Got {
  readonly name: string
  readonly bytes: number
  readonly file: string
}
async function keep(download: Download, sub: string): Promise<Got> {
  const name = download.suggestedFilename()
  const file = path.join(dirOf(sub), `dl-${name}`)
  await download.saveAs(file)
  return { name, bytes: statSync(file).size, file }
}

/** Records every call of navigator.share / canShare with what it was given, and says yes (the iOS share sheet). */
const SHARE_RECORDER = `(() => {
  window.__shareCalls = []
  window.__canShareCalls = []
  const describe = async (data) => {
    const out = { keys: Object.keys(data || {}), title: data && data.title, text: data && data.text, url: data && data.url, files: [] }
    for (const f of (data && data.files) || []) out.files.push({ name: f.name, type: f.type, size: f.size, head: (await f.text()).slice(0, 80) })
    return out
  }
  Object.defineProperty(Navigator.prototype, 'canShare', {
    configurable: true,
    value: (data) => { window.__canShareCalls.push({ keys: Object.keys(data || {}), files: ((data && data.files) || []).map((f) => f.name + ' ' + f.type) }); return !!data && Array.isArray(data.files) && data.files.length > 0 },
  })
  Object.defineProperty(Navigator.prototype, 'share', {
    configurable: true,
    value: async (data) => { window.__shareCalls.push(await describe(data)) },
  })
})()`

const shareCalls = (page: Page): Promise<unknown[]> => page.evaluate<unknown[]>('window.__shareCalls')

/** The results of the simulated person, motion off. */
async function results(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await toResults(page, 1)
  await expect(button(page, 'Download save file')).toBeVisible()
}

const savePanel = (page: Page): Locator => page.locator('section[data-section="save"]')
const status = async (panel: Locator): Promise<string> => ((await panel.locator('[role="status"]').first().textContent()) ?? '').trim()
const focused = (page: Page): Promise<string> => page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName} ${(a.textContent || '').trim().slice(0, 40)}` : '' })

test.describe('sharer: save', () => {
  test('sharer: save panel (download, leave guard, message after saving)', async ({ page }, testInfo) => {
    const project = testInfo.project.name
    const sub = `save-panel-${project}`
    const shots = new Shots(page, RUN, sub)
    const log = trackConsole(page)
    const facts: Record<string, unknown> = { project }
    await results(page)
    await shots.shot('results-top', { fullPage: false })
    const panel = savePanel(page)
    await panel.scrollIntoViewIfNeeded()
    facts.panelTextBefore = ((await panel.innerText()) ?? '').trim()
    await shots.shot('save-panel-before', { locator: panel })
    facts.guardedBefore = await unloadIsGuarded(page)
    facts.afterSavePanelBefore = await page.locator('[data-section="after-save"]').count()
    facts.pendingText = (await page.getByText('Save your file first to see the next steps.').count()) > 0

    // The download.
    const [download] = await Promise.all([page.waitForEvent('download'), button(page, 'Download save file').click()])
    const got = await keep(download, sub)
    facts.download = { name: got.name, bytes: got.bytes }
    const text = readFileSync(got.file, 'utf8')
    const doc = JSON.parse(text) as Record<string, unknown>
    facts.fileKeys = Object.keys(doc)
    facts.fileHead = text.slice(0, 400)
    facts.fileLines = text.split('\n').length
    facts.fileSessions = Array.isArray(doc.sessions) ? doc.sessions.length : null
    await expect(panel).toHaveAttribute('data-saved', 'true')
    facts.messageAfter = await status(panel)
    facts.doneText = ((await panel.locator('.done').textContent().catch(() => '')) ?? '').trim()
    facts.guardedAfter = await unloadIsGuarded(page)
    await shots.shot('save-panel-after', { locator: panel })
    await shots.shot('after-save-viewport', { fullPage: false })

    // Where does the page say the file went, and how to bring it back?
    const body = await page.locator('body').innerText()
    facts.mentionsDownloadsFolder = /downloads|files app|folder/i.test(body)
    facts.mentionsLoadOnStart = body.match(/load your save file on the start screen[^.]*\./i)?.[0] ?? null
    facts.mentionsLost = body.match(/[^.]*\b(lose|lost|if you lose)[^.]*\./i)?.[0] ?? null
    facts.bodyHasFileName = body.includes(got.name)
    shots.json('facts', { ...facts, console: log })
    await shots.all('results-saved-full')
    expect(got.name).toMatch(/\.hbsave\.json$/)
  })

  test('sharer: copy save code (clipboard)', async ({ page, context }, testInfo) => {
    const project = testInfo.project.name
    const sub = `copy-code-${project}`
    const shots = new Shots(page, RUN, sub)
    const facts: Record<string, unknown> = { project }
    if (project === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await results(page)
    const panel = savePanel(page)
    await panel.scrollIntoViewIfNeeded()
    await button(page, 'Copy save code').click()
    await page.waitForTimeout(800)
    facts.messageUnsaved = await status(panel)
    facts.manualCode = (await panel.locator('textarea').count()) > 0
    facts.savedAfterCopy = await panel.getAttribute('data-saved')
    facts.guardedAfterCopy = await unloadIsGuarded(page)
    facts.afterSavePanelAfterCopy = await page.locator('[data-section="after-save"]').count()
    await shots.shot('after-copy-unsaved', { locator: panel })
    if (project === 'chromium') {
      const clip = await page.evaluate(() => navigator.clipboard.readText())
      facts.clipboardLength = clip.length
      facts.clipboardHead = clip.slice(0, 60)
      facts.clipboardIsGzipBase64 = clip.startsWith('H4sI')
    }
    shots.json('facts', facts)
  })

  test('sharer: share sheet (stubbed navigator.share)', async ({ page }, testInfo) => {
    const project = testInfo.project.name
    const shots = new Shots(page, RUN, `share-sheet-${project}`)
    const facts: Record<string, unknown> = { project }
    await page.addInitScript(SHARE_RECORDER)
    await results(page)
    const panel = savePanel(page)
    await panel.scrollIntoViewIfNeeded()
    await shots.shot('save-panel-with-share', { locator: panel })
    facts.buttons = await panel.getByRole('button').allInnerTexts()
    await button(page, 'Share or save to an app').click()
    await expect(panel).toHaveAttribute('data-saved', 'true')
    facts.calls = await shareCalls(page)
    facts.canShareCalls = await page.evaluate('window.__canShareCalls')
    facts.messageAfter = await status(panel)
    facts.guardedAfter = await unloadIsGuarded(page)
    await shots.shot('after-share', { locator: panel })
    shots.json('facts', facts)
  })

  test('sharer: native share support (no stub)', async ({ page }, testInfo) => {
    const project = testInfo.project.name
    const shots = new Shots(page, RUN, `native-share-${project}`)
    await results(page)
    const panel = savePanel(page)
    const facts = {
      project,
      share: await page.evaluate(() => typeof navigator.share),
      canShare: await page.evaluate(() => typeof navigator.canShare),
      clipboardWrite: await page.evaluate(() => typeof navigator.clipboard?.write),
      buttons: await panel.getByRole('button').allInnerTexts(),
      ua: await page.evaluate(() => navigator.userAgent),
    }
    shots.json('facts', facts)
    await panel.scrollIntoViewIfNeeded()
    await shots.shot('panel', { locator: panel })
  })

  test('sharer: leave without saving dialog', async ({ page }, testInfo) => {
    const project = testInfo.project.name
    const shots = new Shots(page, RUN, `leave-${project}`)
    const facts: Record<string, unknown> = { project }
    await results(page)
    await button(page, 'Back to the start').click()
    await expect(page.getByRole('heading', { level: 2, name: 'Leave without saving?' })).toBeVisible()
    await shots.all('leave-question')
    facts.dialogText = ((await page.locator('section.confirm').innerText().catch(() => '')) ?? '').trim()
    facts.focused = await focused(page)
    // Stay and save: what is on screen now?
    await button(page, 'Stay and save').click()
    await page.waitForTimeout(400)
    facts.afterStay = await focused(page)
    await shots.shot('after-stay', { fullPage: false })
    // Save, then leave: does "Back to the start" ask again, and what happens to the results?
    await button(page, 'Download save file').click()
    await button(page, 'Back to the start').click()
    await page.waitForTimeout(500)
    facts.afterSavedLeaveH1 = ((await h1(page).textContent()) ?? '').trim()
    await shots.shot('start-after-leave', { fullPage: false })
    shots.json('facts', facts)
  })
})

// ------------------------------------------------------------------------------------------------ the share card

const card = (page: Page): Locator => page.locator('[data-share-card]')
const preview = (page: Page): Locator => page.locator('img[data-preview]')

/** Width and height in the IHDR chunk of PNG bytes, or null when they are not a PNG. */
function pngSize(bytes: Buffer): { width: number; height: number } | null {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(sig)) return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

/** The text of every drawn label / title / desc of an SVG, unescaped. */
function svgTexts(svg: string): string[] {
  return [...svg.matchAll(/<(?:text|tspan|title|desc)\b[^>]*>([^<]+)<\//g)].map((m) => m[1]!.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"))
}

interface Rect {
  readonly top: number
  readonly bottom: number
  readonly height: number
  readonly width: number
}
const rectOf = (loc: Locator): Promise<Rect> => loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), width: Math.round(r.width) } })

test.describe('sharer: share card', () => {
  test('sharer: share card (toggles, themes, exports, share)', async ({ page }, testInfo) => {
    const project = testInfo.project.name
    const sub = `card-${project}`
    const shots = new Shots(page, RUN, sub)
    const facts: Record<string, unknown> = { project }
    await page.addInitScript(SHARE_RECORDER)
    await results(page)
    const vh = await page.evaluate(() => window.innerHeight)
    facts.viewport = { w: await page.evaluate(() => window.innerWidth), h: vh }
    const panel = savePanel(page)
    // Where is the save panel on the page, and how far must Pat scroll to reach it from the top?
    const pageH = await page.evaluate(() => document.documentElement.scrollHeight)
    facts.pageHeightBeforeSave = pageH
    facts.savePanelTopFromPageTop = await panel.evaluate((el) => Math.round(el.getBoundingClientRect().top + window.scrollY))
    facts.savePanelTopInViewports = Math.round(((facts.savePanelTopFromPageTop as number) / vh) * 10) / 10
    // Save, then: is the share card in view, and what has moved focus?
    await panel.scrollIntoViewIfNeeded()
    await button(page, 'Download save file').click()
    await expect(card(page)).toBeVisible()
    await page.waitForTimeout(400)
    facts.afterSaveScrollY = await page.evaluate(() => Math.round(window.scrollY))
    facts.afterSaveCardRect = await rectOf(card(page))
    facts.afterSaveFocus = await focused(page)
    await shots.shot('after-save-viewport', { fullPage: false })
    await card(page).scrollIntoViewIfNeeded()
    await expect(preview(page)).toBeVisible()
    await expect(button(page, 'Download image (PNG)')).toBeEnabled()
    await shots.shot('card-panel', { locator: card(page) })

    // Toggle: does the preview stay in view while a skill is ticked? (a phone shows one screen at a time)
    const boxes = card(page).locator('input[data-skill]')
    const n = await boxes.count()
    facts.skillCount = n
    const labels = (await card(page).locator('fieldset.skills label').allInnerTexts()).map((l) => l.trim())
    facts.skillLabels = labels
    const first = boxes.first()
    await first.scrollIntoViewIfNeeded()
    facts.previewRectWhenToggling = await rectOf(preview(page))
    facts.checkboxRectWhenToggling = await rectOf(first)
    facts.previewVisibleWhenToggling = (await rectOf(preview(page))).top < vh && (await rectOf(preview(page))).bottom > 0
    await shots.shot('toggle-viewport-first-skill', { fullPage: false })
    const countText = card(page).locator('[data-count]')
    facts.countBefore = ((await countText.textContent()) ?? '').trim()
    await first.uncheck()
    facts.countAfterOne = ((await countText.textContent()) ?? '').trim()
    facts.messageAfterToggle = ((await card(page).locator('[data-message]').textContent()) ?? '').trim()
    await first.check()

    // Show all / Hide all / too few.
    await button(page, 'Hide all').click()
    facts.hideAll = { count: ((await countText.textContent()) ?? '').trim(), previewCount: await preview(page).count(), pngDisabled: await button(page, 'Download image (PNG)').isDisabled(), svgDisabled: await button(page, 'Download vector image (SVG)').isDisabled() }
    facts.hideAllFocus = await focused(page)
    await shots.shot('hide-all', { locator: card(page) })
    await button(page, 'Show all').click()
    await expect(preview(page)).toBeVisible()
    facts.showAllFocus = await focused(page)
    // exactly two on: "Tick at least 3 skills (2 ticked)"
    await button(page, 'Hide all').click()
    await boxes.nth(0).check()
    await boxes.nth(1).check()
    facts.twoTicked = ((await countText.textContent()) ?? '').trim()
    await shots.shot('two-ticked', { locator: card(page) })
    await boxes.nth(2).check()
    facts.threeTicked = ((await countText.textContent()) ?? '').trim()
    await shots.shot('three-ticked', { locator: card(page) })
    await button(page, 'Show all').click()

    // Light and dark, PNG and SVG.
    const files: Record<string, { name: string; bytes: number; size?: { width: number; height: number } | null; file: string }> = {}
    for (const theme of ['Light', 'Dark'] as const) {
      await card(page).getByRole('radio', { name: theme }).check()
      await expect(button(page, 'Download image (PNG)')).toBeEnabled({ timeout: 20_000 })
      await page.waitForTimeout(500)
      await shots.shot(`preview-${theme.toLowerCase()}`, { locator: preview(page) })
      const [png] = await Promise.all([page.waitForEvent('download'), button(page, 'Download image (PNG)').click()])
      const gotPng = await keep(png, sub)
      const pngTarget = path.join(dirOf(sub), `card-${theme.toLowerCase()}.png`)
      await png.saveAs(pngTarget)
      facts[`pngMessage${theme}`] = ((await card(page).locator('[data-message]').textContent()) ?? '').trim()
      files[`png-${theme}`] = { name: gotPng.name, bytes: gotPng.bytes, size: pngSize(readFileSync(gotPng.file)), file: pngTarget }
      const [svg] = await Promise.all([page.waitForEvent('download'), button(page, 'Download vector image (SVG)').click()])
      const gotSvg = await keep(svg, sub)
      const svgTarget = path.join(dirOf(sub), `card-${theme.toLowerCase()}.svg`)
      await svg.saveAs(svgTarget)
      facts[`svgMessage${theme}`] = ((await card(page).locator('[data-message]').textContent()) ?? '').trim()
      files[`svg-${theme}`] = { name: gotSvg.name, bytes: gotSvg.bytes, file: svgTarget }
    }
    facts.files = files
    await card(page).getByRole('radio', { name: 'Light' }).check()

    // The SVG's content.
    const svg = readFileSync(files['svg-Light']!.file, 'utf8')
    const texts = svgTexts(svg)
    facts.svgHead = svg.slice(0, 260)
    facts.svgTexts = texts
    facts.svgHasEmotion = /emotion/i.test(svg)
    facts.svgHasTotalWords = [...svg.matchAll(/\b(total|overall|average|iq|rank|percentile|score)\b/gi)].map((m) => m[0])
    facts.svgResourceLine = svg.includes(RESOURCE_LINE.slice(0, 40))
    facts.svgNotesMarkers = NOTES_LEAK_MARKERS.filter((m) => svg.includes(m))
    facts.svgA13Hits = lintText(svg, 'card.svg')
    facts.svgFonts = [...new Set([...svg.matchAll(/font-family="([^"]+)"/g)].map((m) => m[1]))]
    facts.svgWidthHeight = svg.match(/<svg[^>]*>/)?.[0] ?? ''

    // Share image (stubbed).
    if ((await button(page, 'Share image').count()) > 0) {
      await button(page, 'Share image').click()
      await page.waitForTimeout(500)
      facts.shareImageCalls = await shareCalls(page)
      facts.shareImageMessage = ((await card(page).locator('[data-message]').textContent()) ?? '').trim()
    } else facts.shareImageButton = 'absent'
    facts.buttonRow = await card(page).locator('.hb-actions').last().locator('button').allInnerTexts()
    shots.json('facts', facts)

    // What a friend sees: the PNG shrunk to 600 x 315 and to a phone feed's width (340 px), and the SVG opened by itself.
    const thumbs = await context(page).newPage()
    for (const [theme, w] of [['light', 600], ['dark', 600], ['light', 340], ['dark', 340]] as const) {
      const b64 = readFileSync(files[`png-${theme === 'light' ? 'Light' : 'Dark'}`]!.file).toString('base64')
      await thumbs.setViewportSize({ width: w + 40, height: Math.round((w * 630) / 1200) + 40 })
      await thumbs.setContent(`<body style="margin:0;padding:20px;background:#f4f4f4"><canvas id="c" width="${w}" height="${Math.round((w * 630) / 1200)}" style="display:block"></canvas></body>`)
      await thumbs.evaluate(
        ([data, width]) =>
          new Promise<void>((resolve, reject) => {
            const img = new Image()
            img.onload = () => {
              const c = document.getElementById('c') as HTMLCanvasElement
              const ctx = c.getContext('2d')!
              ctx.imageSmoothingQuality = 'high'
              ctx.drawImage(img, 0, 0, width, Math.round((width * 630) / 1200))
              resolve()
            }
            img.onerror = () => reject(new Error('png did not load'))
            img.src = 'data:image/png;base64,' + data
          }),
        [b64, w] as [string, number],
      )
      const tShots = new Shots(thumbs, RUN, `${sub}-thumbs`)
      await tShots.shot(`png-${theme}-${w}px`, { locator: thumbs.locator('#c') })
    }
    await thumbs.close()
    expect(files['png-Light']!.size).toEqual({ width: 2400, height: 1260 })
  })
})

const context = (page: Page) => page.context()
