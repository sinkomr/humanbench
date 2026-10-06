/// <reference lib="dom" />
/**
 * Verification package 2 (run id `verify2`), session items of wave 2: VER-01 (checklist word breaks), VER-02 (one
 * privacy link on the welcome, 44 px footer links elsewhere), UX-017a (the no-WebGL message said once), UX-012a
 * (alerts tied to their field, the autosave line), the pasted-JSON wording, and the RT block after the dev merge
 * (stage name, focus, trial counter, the time-stamp source in the save). Each test records facts and screenshots
 * under web/test-results/ux-review/verify2/<item>/<project>/ and asserts nothing beyond what it needs to go on.
 *
 *   UX_PORT=4770 UX_RUN=verify2 npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/verify2-session.ux.ts --project=chromium
 */

import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { ROTATION_UNAVAILABLE } from '../../src/render/rotation/copy'
import { button, h1, simulatedSave, toReady } from '../../e2e/flow'
import { setTextZoomNow } from '../../e2e/layout'
import { PREVIEW_ROUTES, skipPart, type Route } from '../../e2e/routes'
import { SessionDriver } from '../../e2e/session-driver'
import { pageMetrics, Shots, trackConsole } from '../lib'

const RUN = process.env.UX_RUN ?? 'verify2'

test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 })

// ------------------------------------------------------------------------------------------------ helpers

function routeOf(id: string): Route {
  const r = PREVIEW_ROUTES.find((x) => x.id === id)
  if (r === undefined) throw new Error(`no route ${id}`)
  return r
}

async function fresh(page: Page): Promise<void> {
  await page.goto('./favicon.svg')
  await page.evaluate('localStorage.clear(); sessionStorage.clear()')
}

async function press(touch: boolean, target: Locator): Promise<void> {
  if (touch) await target.tap()
  else await target.click()
}

const what = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return 'nothing (body)'
    const label = el.getAttribute('aria-label') || ((el as HTMLInputElement).labels?.[0]?.textContent ?? '') || el.textContent || ''
    return `${el.tagName.toLowerCase()}${el.getAttribute('type') ? `[${el.getAttribute('type')}]` : ''}.${[...el.classList].slice(0, 2).join('.')} "${label.replace(/\s+/g, ' ').trim().slice(0, 60)}"`
  })

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

const bodyText = (page: Page): Promise<string> => page.locator('body').innerText()

/** Runs in the page: words of the checklist whose letters sit on more than one line, and the rows' sizes. */
const CHECKLIST = `(() => {
  const list = document.querySelector('.checklist')
  if (!list) return null
  const broken = []
  const walker = document.createTreeWalker(list, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent || ''
    for (const m of text.matchAll(/[\\p{L}\\p{N}]+(?:['’][\\p{L}\\p{N}]+)*/gu)) {
      const range = document.createRange()
      range.setStart(node, m.index)
      range.setEnd(node, m.index + m[0].length)
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
      if (rects.length < 2) continue
      const tops = rects.map((r) => r.top)
      const smallest = Math.min(...rects.map((r) => r.height))
      if (Math.max(...tops) - Math.min(...tops) > smallest / 2) broken.push(m[0])
    }
  }
  const rows = [...list.querySelectorAll('li')].map((li) => {
    const name = li.querySelector('.name')
    const box = li.getBoundingClientRect()
    const font = name ? parseFloat(getComputedStyle(name).fontSize) : 16
    return { text: (li.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80), h: Math.round(box.height), lines: Math.round((box.height / (font * 1.2)) * 10) / 10, right: Math.round(box.right), w: Math.round(box.width) }
  })
  const lb = list.getBoundingClientRect()
  return { broken, rows, listWidth: Math.round(lb.width), innerWidth, overflow: document.documentElement.scrollWidth - innerWidth, upNext: ((list.textContent || '').match(/Up next/g) || []).length, wbr: list.querySelectorAll('wbr').length }
})()`

interface ChecklistFacts {
  readonly broken: string[]
  readonly rows: { text: string; h: number; lines: number; right: number; w: number }[]
  readonly listWidth: number
  readonly innerWidth: number
  readonly overflow: number
  readonly upNext: number
  readonly wbr: number
}

// ------------------------------------------------------------------------------------------------ VER-01

test('verify2 VER-01 checklist: no mid-word breaks 320 to 1440 px and at 200% text', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `VER-01/${testInfo.project.name}`)
  const log = trackConsole(page)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  const sizes: { width: number; zoom: 100 | 200 }[] = touch
    ? [{ width: page.viewportSize()?.width ?? 390, zoom: 100 }, { width: 320, zoom: 100 }, { width: page.viewportSize()?.width ?? 390, zoom: 200 }, { width: 320, zoom: 200 }]
    : [{ width: 320, zoom: 100 }, { width: 390, zoom: 100 }, { width: 768, zoom: 100 }, { width: 1024, zoom: 100 }, { width: 1280, zoom: 100 }, { width: 1440, zoom: 100 }, { width: 320, zoom: 200 }, { width: 390, zoom: 200 }, { width: 1280, zoom: 200 }]
  const height = page.viewportSize()?.height ?? 800
  const driver = new SessionDriver(page, { touch })
  await driver.toReady('./?fast=1')
  await driver.begin()
  const states: [string, () => Promise<void>][] = [
    ['interstitial', async () => undefined],
    [
      'after-skip',
      async () => {
        await skipPart(page)
        await expect(h1(page)).toHaveText('Up next: Matrix & Series')
      },
    ],
    [
      'in-part',
      async () => {
        await driver.press(button(page, 'Start'))
        await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
      },
    ],
  ]
  const problems: string[] = []
  for (const [label, go] of states) {
    await setTextZoomNow(page, null)
    if (!touch) await page.setViewportSize({ width: 1280, height })
    await go()
    for (const { width, zoom } of sizes) {
      const key = `${label} ${width}px ${zoom}%`
      await setTextZoomNow(page, zoom === 200 ? 200 : null)
      await page.setViewportSize({ width, height })
      await settle(page)
      await page.waitForTimeout(100)
      const f = (await page.evaluate(CHECKLIST)) as ChecklistFacts | null
      const shot = label === 'interstitial' || (label === 'in-part' && (width === 1280 || width === 320)) ? await shots.shot(`${label}-${width}-${zoom}`, { fullPage: zoom === 200 && width <= 390 ? false : true }) : ''
      facts[key] = f === null ? 'no checklist' : { ...f, shot }
      if (f === null) problems.push(`${key}: no checklist`)
      else {
        if (f.broken.length > 0) problems.push(`${key}: broken ${f.broken.join(', ')}`)
        if (f.overflow > 0) problems.push(`${key}: overflow ${f.overflow}px`)
        if (f.rows.some((r) => r.right > f.innerWidth + 0.5)) problems.push(`${key}: a row reaches past the window`)
      }
    }
  }
  await setTextZoomNow(page, null)
  facts.summary = { problems, sizes: sizes.map((s) => `${s.width}@${s.zoom}`) }
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[verify2 VER-01] ${JSON.stringify(facts.summary)}`)
})

// ------------------------------------------------------------------------------------------------ VER-02

test('verify2 VER-02 one privacy link on the welcome; footer links 44 px elsewhere', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `VER-02/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name, viewport: page.viewportSize() }
  const LINKS = `[...document.querySelectorAll('a')].filter((a) => /Privacy and terms/.test(a.textContent || '')).map((a) => { const r = a.getBoundingClientRect(); return { text: (a.textContent || '').trim(), href: a.getAttribute('href'), target: a.getAttribute('target'), inFooter: a.closest('footer') !== null, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, fontPx: parseFloat(getComputedStyle(a).fontSize) } })`
  const footer = `(() => { const f = document.querySelector('footer'); return f ? { text: (f.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 160), links: [...f.querySelectorAll('a')].map((a) => (a.textContent || '').trim()) } : null })()`
  const at = async (label: string): Promise<void> => {
    await page.waitForTimeout(150)
    const links = (await page.evaluate(LINKS)) as { inFooter: boolean; h: number }[]
    facts[label] = { links, footer: await page.evaluate(footer), privacyLinkCount: links.length, footerLinkUnder44: links.filter((l) => l.inFooter && l.h < 43.9).length, overflow: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) }
  }
  await page.goto('./')
  await expect(h1(page)).toHaveText('HumanBench')
  await at('1 welcome')
  await shots.shot('welcome', { fullPage: true })
  await press(touch, button(page, 'Start'))
  await expect(h1(page)).toHaveText('Before you start')
  await at('2 gate')
  await shots.shot('gate-footer', { locator: page.locator('footer') })
  await press(touch, page.getByRole('checkbox', { name: /18 or older/ }))
  await press(touch, button(page, 'Continue'))
  await expect(h1(page)).toHaveText('Honour code')
  await at('3 honour')
  await press(touch, page.getByRole('checkbox', { name: /honour code/ }))
  await press(touch, button(page, 'Continue'))
  await expect(h1(page)).toHaveText('Check your device')
  await at('4 device')
  await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
  await press(touch, page.getByRole('radio', { name: touch ? 'Tap or click' : 'Keyboard' }))
  await press(touch, button(page, 'Continue'))
  await expect(h1(page)).toHaveText('Ready when you are')
  await at('5 ready')
  await press(touch, button(page, 'Begin'))
  await expect(h1(page)).toHaveText('Up next: Reaction time')
  await at('6 run (interstitial)')
  await press(touch, button(page, 'Finish early'))
  await press(touch, button(page, 'Finish now'))
  await expect(h1(page)).toHaveText(/^Session (complete|ended)$/)
  await at('7 end')
  await press(touch, button(page, 'Back to the start'))
  await expect(h1(page)).toHaveText('HumanBench')
  await at('8 welcome after Back to the start')
  // The notice open from the welcome: the footer has a way to it; closing it takes the footer link away.
  await page.goto('./#/privacy')
  await expect(h1(page)).toHaveText('Privacy and terms')
  await at('9 privacy page')
  await press(touch, page.getByRole('link', { name: 'Back', exact: true }))
  await expect(h1(page)).toHaveText('HumanBench')
  await at('10 welcome after privacy Back')
  const entries = Object.entries(facts).filter(([k]) => /^\d+ /.test(k)) as [string, { privacyLinkCount: number; footerLinkUnder44: number; links: { inFooter: boolean }[] }][]
  facts.summary = {
    welcomeLinkCounts: entries.filter(([k]) => /welcome/.test(k)).map(([k, v]) => `${k}: ${v.privacyLinkCount} (footer ${v.links.filter((l) => l.inFooter).length})`),
    otherScreensWithoutFooterLink: entries.filter(([k, v]) => !/welcome/.test(k) && v.links.filter((l) => l.inFooter).length === 0).map(([k]) => k),
    footerLinksUnder44: entries.filter(([, v]) => v.footerLinkUnder44 > 0).map(([k]) => k),
  }
  shots.json('facts', facts)
  console.log(`[verify2 VER-02] ${JSON.stringify(facts.summary)}`)
})

// ------------------------------------------------------------------------------------------------ UX-017a

/** Records which live regions were on screen with text at the end of any frame (what a screen reader is told). */
const LIVE_LOG = `(() => {
  const seen = new Map()
  window.__liveSeen = seen
  const selector = '[role=status], [role=alert], [role=log], [aria-live=polite], [aria-live=assertive]'
  const frame = () => {
    for (const el of document.querySelectorAll(selector)) {
      const text = (el.textContent || '').trim()
      if (text === '' || el.closest('[hidden], [aria-hidden=true]') !== null || el.getClientRects().length === 0) continue
      if (!seen.has(el)) seen.set(el, text)
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
})()`

const occurrences = (text: string, part: string): number => text.split(part).length - 1

test('verify2 UX-017a no-WebGL message once; Skip in the first screen at 320x568', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-017a/${testInfo.project.name}`)
  const log = trackConsole(page)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  const route = routeOf('item-spatial-no-webgl')
  const viewports: { width: number; height: number; zoom: 100 | 200 }[] = touch
    ? [{ ...(page.viewportSize() ?? { width: 390, height: 664 }), zoom: 100 }, { width: 320, height: 568, zoom: 100 }, { width: 320, height: 568, zoom: 200 }]
    : [{ width: 1280, height: 800, zoom: 100 }, { width: 320, height: 568, zoom: 100 }, { width: 320, height: 568, zoom: 200 }]
  for (const vp of viewports) {
    const key = `${vp.width}x${vp.height}@${vp.zoom}`
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await fresh(page)
    await route.prepare?.(page)
    await page.addInitScript(LIVE_LOG)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await route.open(page)
    if (vp.zoom === 200) await setTextZoomNow(page, 200)
    await settle(page)
    await settle(page)
    await page.waitForTimeout(300)
    const text = await bodyText(page)
    const tree = await page.locator('body').ariaSnapshot()
    const live = await page.evaluate(() => [...(window as unknown as { __liveSeen: Map<Element, string> }).__liveSeen.values()])
    const m = await pageMetrics(page, { touch, axe: true })
    const skip = page.locator('.unavailable').getByRole('button', { name: /^Skip / })
    facts[key] = {
      messageInText: occurrences(text, 'cannot be shown in your browser'),
      rendererNoteInText: occurrences(text, ROTATION_UNAVAILABLE),
      messageInTree: occurrences(tree, 'cannot be shown in your browser'),
      rendererNoteInTree: occurrences(tree, 'could not be drawn'),
      liveAboutMessage: live.filter((t) => /cannot be shown|could not be drawn/.test(t)),
      liveAll: live.slice(0, 8),
      skip: await skip.evaluate((el) => { const r = el.getBoundingClientRect(); return { text: (el.textContent ?? '').trim(), primary: el.classList.contains('hb-primary'), top: Math.round(r.top), bottom: Math.round(r.bottom), inFirstScreen: r.top >= 0 && r.bottom <= innerHeight, scrollY: Math.round(scrollY) } }).catch(() => null),
      panelButtons: await page.locator('.unavailable button').allInnerTexts(),
      headerStatus: await page.locator('header.top .status').innerText().catch(() => ''),
      rotation: await page.locator('div.rotation').evaluate((el) => ({ attached: true, hidden: el.getClientRects().length === 0, display: getComputedStyle(el).display })).catch(() => ({ attached: false })),
      canvases: await page.locator('div.rotation canvas').filter({ visible: true }).count(),
      radios: await page.getByRole('radio').count(),
      confirm: await button(page, 'Confirm').count(),
      overflowX: m.overflowX.px,
      clipped: m.clipped,
      axeSerious: m.axe?.serious.map((v) => `${v.id} x${v.nodes}`),
      shot: await shots.shot(`${key}-viewport`, { fullPage: false }),
      full: await shots.shot(`${key}-full`, { fullPage: true }),
    }
    if (vp.zoom === 200) await setTextZoomNow(page, null)
  }
  // Skip leaves for the next part.
  await press(touch, page.locator('.unavailable').getByRole('button', { name: /^Skip / }))
  await expect(h1(page)).toHaveText('Up next: Working Memory')
  facts['after Skip'] = { h1: (await h1(page).innerText()).trim(), unavailableLeft: await page.locator('.unavailable').count(), rotationLeft: await page.locator('div.rotation').count() }
  const keys = Object.keys(facts).filter((k) => /x\d+@/.test(k))
  facts.summary = Object.fromEntries(keys.map((k) => { const v = facts[k] as { messageInText: number; messageInTree: number; liveAboutMessage: string[]; skip: { inFirstScreen: boolean; primary: boolean } | null; rendererNoteInText: number; axeSerious?: string[] }; return [k, `text ${v.messageInText} tree ${v.messageInTree} live ${v.liveAboutMessage.length} note ${v.rendererNoteInText} skipFirstScreen ${v.skip?.inFirstScreen} primary ${v.skip?.primary} axe ${(v.axeSerious ?? []).length}`] }))
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[verify2 UX-017a] ${JSON.stringify(facts.summary)}`)
})

// ------------------------------------------------------------------------------------------------ UX-012a and the pasted wording

test('verify2 UX-012a ready screen: one alert per failure, status for success, the autosave line; pasted wording', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-012a/${testInfo.project.name}`)
  const log = trackConsole(page)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  const sim = simulatedSave(1)
  const file = (name: string, text: string | Buffer, mimeType = 'application/json'): { name: string; mimeType: string; buffer: Buffer } => ({ name, mimeType, buffer: typeof text === 'string' ? Buffer.from(text) : text })
  const fields = (): Promise<unknown> =>
    page.evaluate(() => {
      const f = document.querySelector('input[type=file]')
      const c = document.querySelector('textarea')
      const d = (el: Element | null): unknown => (el ? { invalid: el.getAttribute('aria-invalid'), describedby: el.getAttribute('aria-describedby'), describedRole: document.getElementById(el.getAttribute('aria-describedby') ?? '')?.getAttribute('role') ?? null, describedText: (document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? '').trim().slice(0, 200) } : null)
      const live = [...document.querySelectorAll('[role=alert], [role=status]')].map((a) => ({ role: a.getAttribute('role'), id: a.id, text: (a.textContent ?? '').trim().slice(0, 200) }))
      return { file: d(f), code: d(c), alerts: live.filter((l) => l.role === 'alert'), statuses: live.filter((l) => l.role === 'status'), nonEmptyStatuses: live.filter((l) => l.role === 'status' && l.text !== '') }
    })
  const treeCount = async (part: string): Promise<number> => occurrences(await page.locator('main').ariaSnapshot(), part)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await toReady(page, touch ? 'Tap or click' : 'Keyboard')
  facts['0 at rest'] = await fields()
  // A bad file: one alert tied to the file field, status empty.
  await page.getByLabel('Save file').setInputFiles(file('photo.txt', 'this is not a save', 'text/plain'))
  await page.waitForTimeout(700)
  facts['1 bad file'] = { ...(await fields() as object), inTree: await treeCount('not a HumanBench save'), shot: await shots.shot('1-bad-file', { fullPage: false }) }
  // Typing in the code box takes the alert away; a bad code is one alert tied to the code box.
  await page.getByLabel('Or paste a save code').fill('hello there')
  await page.waitForTimeout(300)
  facts['2 typed in code box'] = await fields()
  await press(touch, button(page, 'Load'))
  await page.waitForTimeout(700)
  facts['3 bad code'] = { ...(await fields() as object), inTree: await treeCount('not a HumanBench save'), shot: await shots.shot('3-bad-code', { fullPage: false }) }
  // Pasted raw JSON that is not a save, and cut-off JSON: worded as text, with a next step.
  await page.getByLabel('Or paste a save code').fill('{"hello": "world"}')
  await press(touch, button(page, 'Load'))
  await page.waitForTimeout(700)
  facts['4 pasted JSON object'] = { ...(await fields() as object) }
  await page.getByLabel('Or paste a save code').fill('{"schema_version": "1.0.0", "sessions": [')
  await press(touch, button(page, 'Load'))
  await page.waitForTimeout(700)
  facts['5 pasted cut-off JSON'] = { ...(await fields() as object), shot: await shots.shot('5-pasted-cut-off', { fullPage: false }) }
  await page.getByLabel('Or paste a save code').fill('')
  await page.getByLabel('Save file').setInputFiles(file('cut.txt', '{"schema_version": "1.0.0", "sessions": [', 'text/plain'))
  await page.waitForTimeout(700)
  facts['6 chosen cut-off file'] = { ...(await fields() as object) }
  // A good code: a status line, no alert.
  await page.getByLabel('Save file').setInputFiles([])
  await page.getByLabel('Or paste a save code').fill(JSON.stringify(sim.save))
  await press(touch, button(page, 'Load'))
  await page.waitForTimeout(1000)
  facts['7 good code'] = { ...(await fields() as object), shot: await shots.shot('7-good-code', { fullPage: false }) }
  const wording = (k: string): string => { const f = facts[k] as { alerts: { text: string }[] } | undefined; return f?.alerts[0]?.text ?? '' }
  facts['pasted wording'] = {
    jsonObject: wording('4 pasted JSON object'),
    cutOffPasted: wording('5 pasted cut-off JSON'),
    cutOffFile: wording('6 chosen cut-off file'),
    badCode: wording('3 bad code'),
    badFile: wording('1 bad file'),
    pastedSaysText: /^This text|pasted/i.test(wording('4 pasted JSON object')) && /pasted|text/i.test(wording('5 pasted cut-off JSON')),
    pastedNeverSaysFile: !/This file|save file looks|the file/i.test(wording('4 pasted JSON object') + ' ' + wording('5 pasted cut-off JSON')),
    fileSaysFile: /file/i.test(wording('6 chosen cut-off file')) && !/pasted|This text/i.test(wording('6 chosen cut-off file')),
    jargon: [wording('4 pasted JSON object'), wording('5 pasted cut-off JSON'), wording('6 chosen cut-off file')].filter((t) => /json|gzip|schema|base64|parse/i.test(t)),
  }
  // The autosave line: a session with one answer, finished early; a new visit on the same device.
  const driver = new SessionDriver(page, { touch })
  await driver.toReady('./?fast=1')
  await driver.begin()
  await driver.answerOne()
  await driver.finishEarly()
  await page.waitForTimeout(500)
  await driver.toReady('./?fast=1')
  await page.waitForTimeout(500)
  facts['8 second visit with an autosave'] = {
    heading: await page.getByRole('heading', { level: 2, name: 'Earlier saves on this device' }).count(),
    lastSavedLine: (await bodyText(page)).match(/Last saved [^\n]*/)?.[0] ?? null,
    lastSavedPattern: /^Last saved today at .+, 1 question answered\.$/.test((await bodyText(page)).match(/Last saved [^\n]*/)?.[0] ?? ''),
    lineTiedToCheckbox: await page.evaluate(() => { const box = [...document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].find((b) => (b.getAttribute('aria-describedby') ?? '').endsWith('found-note')); const note = box ? document.getElementById(box.getAttribute('aria-describedby') ?? '') : null; return { checkbox: box ? (box.labels?.[0]?.textContent ?? '').trim().slice(0, 80) : null, note: (note?.textContent ?? '').trim().slice(0, 120), noteRole: note?.getAttribute('role') ?? null } }),
    ...(await fields() as object),
    shot: await shots.shot('8-second-visit-autosave', { fullPage: false }),
  }
  await page.getByLabel('Or paste a save code').fill(JSON.stringify(sim.save))
  await press(touch, button(page, 'Load'))
  await page.waitForTimeout(1000)
  facts['9 code loaded on the second visit'] = { ...(await fields() as object), lastSavedStill: (await bodyText(page)).match(/Last saved [^\n]*/)?.[0] ?? null }
  const f1 = facts['1 bad file'] as { alerts: unknown[]; nonEmptyStatuses: unknown[]; file: { invalid: string; describedRole: string } }
  const f3 = facts['3 bad code'] as { alerts: unknown[]; nonEmptyStatuses: unknown[]; code: { invalid: string; describedRole: string } }
  const f7 = facts['7 good code'] as { alerts: unknown[]; nonEmptyStatuses: { text: string }[] }
  const f8 = facts['8 second visit with an autosave'] as { lastSavedPattern: boolean; alerts: unknown[] }
  facts.summary = { badFile: `${f1.alerts.length} alert, ${f1.nonEmptyStatuses.length} status, file aria-invalid ${f1.file?.invalid} described by ${f1.file?.describedRole}`, badCode: `${f3.alerts.length} alert, ${f3.nonEmptyStatuses.length} status, code aria-invalid ${f3.code?.invalid} described by ${f3.code?.describedRole}`, goodCode: `${f7.alerts.length} alert, status "${f7.nonEmptyStatuses[0]?.text ?? ''}"`, autosaveLine: f8.lastSavedPattern, autosaveAlerts: f8.alerts.length, pasted: facts['pasted wording'] }
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[verify2 UX-012a] ${JSON.stringify(facts.summary)}`)
})

// ------------------------------------------------------------------------------------------------ RT block after the merge

test('verify2 RT block after the merge: stage name, focus, trial counter, time-stamp source in the save', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `RT-merge/${testInfo.project.name}`)
  const log = trackConsole(page)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  const driver = new SessionDriver(page, { touch })
  await driver.toReady('./?fast=1')
  await driver.begin()
  await driver.press(button(page, 'Start'))
  await expect(button(page, 'Start practice')).toBeVisible()
  facts['intro'] = { h1: (await h1(page).innerText()).trim(), title: await page.locator('.rt p.title').innerText().catch(() => null), instructions: await page.locator('.rt .hb-instructions').innerText().then((t) => t.replace(/\s+/g, ' ').slice(0, 300)).catch(() => null), focus: await what(page) }
  await driver.press(button(page, 'Start practice'))
  await expect(page.locator('.rt .stage')).toBeVisible()
  await page.waitForTimeout(250)
  const STAGE = `(() => { const s = document.querySelector('.rt .stage'); const a = document.activeElement; const p = document.querySelector('.rt p.progress'); const r = s ? s.getBoundingClientRect() : null; return { stage: s ? { role: s.getAttribute('role'), label: s.getAttribute('aria-label'), tabindex: s.getAttribute('tabindex'), top: Math.round(r.top), bottom: Math.round(r.bottom), inView: r.top >= 0 && r.bottom <= innerHeight } : null, focusIsStage: a === s, active: a ? a.tagName.toLowerCase() + '.' + [...a.classList].join('.') : '', progress: p ? (p.textContent || '').trim() : null, progressTranslateNo: p ? p.querySelectorAll('[translate="no"]').length : null, status: ((document.querySelector('.rt .hb-status') || {}).textContent || '').trim(), kbd: [...document.querySelectorAll('.rt kbd')].map((k) => (k.textContent || '').trim()) } })()`
  facts['practice stage'] = { ...(await page.evaluate<Record<string, unknown>>(STAGE)), shot: await shots.shot('practice-stage', { fullPage: false }) }
  // Play the block the way the driver does (a press about 20 ms of real time after the target lights up), reading the counter as it goes.
  const counters = new Set<string>()
  const rt = page.locator('section.hb-render.rt')
  const hold = touch ? 12 : 20
  const playPads = async (stage: 'practice' | 'counted'): Promise<string> => {
    let last = ''
    for (let guard = 0; guard < 400; guard++) {
      const seen = await page
        .waitForFunction(
          `(() => {
            const root = document.querySelector('section.hb-render.rt')
            if (!root) return 'gone'
            if (/Block complete/.test((root.querySelector('.hb-status') || {}).textContent || '')) return 'done'
            if ([...root.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Start')) return 'ready'
            const pads = [...root.querySelectorAll('.pad')]
            const on = pads.findIndex((p) => p.classList.contains('on'))
            if (on < 0) { window.__hbSeenOn = 0; return '' }
            const now = performance.now()
            if (!window.__hbSeenOn) window.__hbSeenOn = now
            return now - window.__hbSeenOn >= ${hold} ? 'pad:' + on + ':' + pads.length + ':' + ((root.querySelector('p.progress') || {}).textContent || '').trim() : ''
          })()`,
          undefined,
          { polling: 'raf', timeout: 8000 },
        )
        .then((h) => h.jsonValue() as Promise<string>)
        .catch(() => 'timeout')
      if (seen === 'gone' || seen === 'done' || seen === 'ready' || seen === 'timeout') { last = seen; break }
      const [, index, count, progress] = seen.split(':')
      if (progress !== undefined && progress !== '') counters.add(progress.replace(/\d+/g, 'N'))
      if (guard === 2 && stage === 'counted') facts['counted stage'] = { ...(await page.evaluate<Record<string, unknown>>(STAGE)), shot: await shots.shot('counted-stage', { fullPage: false }) }
      if (touch) await rt.locator('button.pad').nth(Number(index)).tap({ force: true, timeout: 2000, noWaitAfter: true }).catch(() => undefined)
      else await page.keyboard.press(Number(count) === 1 ? 'Space' : ['d', 'f', 'j', 'k'][Number(index)]!)
      await page.waitForFunction(`!document.querySelector('section.hb-render.rt .pad.on')`, undefined, { polling: 'raf', timeout: 3000 }).catch(() => undefined)
    }
    return last
  }
  facts['practice ended with'] = await playPads('practice')
  if ((await rt.getByRole('button', { name: 'Start', exact: true }).count()) > 0) {
    facts['between practice and counted'] = { status: await page.locator('.rt .hb-status').innerText().catch(() => ''), focus: await what(page), shot: await shots.shot('practice-done', { fullPage: false }) }
    await driver.press(rt.getByRole('button', { name: 'Start', exact: true }))
    await page.waitForTimeout(200)
    facts['counted ended with'] = await playPads('counted')
  }
  await page.waitForTimeout(500)
  facts['counter forms seen'] = [...counters]
  facts['after block screen'] = await driver.screen()
  // Finish, download the save, read the time-stamp source of the RT block(s).
  if ((await driver.screen()) !== 'finished') {
    if ((await page.locator('section.hb-render.rt').count()) > 0) {
      await driver.press(page.locator('header.top .actions').getByRole('button', { name: /^Skip / }))
      await driver.press(page.locator('section.confirm').getByRole('button', { name: /^Skip / }))
    }
    await expect(h1(page)).toHaveText(/^Up next:/)
    await driver.press(button(page, 'Finish early'))
    await driver.press(button(page, 'Finish now'))
  }
  await expect(h1(page)).toHaveText(/^Session (complete|ended)$/, { timeout: 30_000 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const skipAnim = button(page, 'Skip animation')
  if (await skipAnim.isVisible().catch(() => false)) await press(touch, skipAnim)
  await page.waitForTimeout(800)
  facts['end screen'] = { h1: (await h1(page).innerText()).trim(), lead: await page.locator('p.lead').allInnerTexts(), shot: await shots.shot('end-screen', { fullPage: false }) }
  // "Session ended" (no block scored, e.g. every trial too slow on a loaded machine) keeps the save panel inside a closed disclosure (UX-009a).
  const keep = page.locator('details', { has: page.locator('[data-section="save"]') }).locator('summary')
  if ((await keep.count()) > 0 && !(await button(page, 'Download save file').isVisible().catch(() => false))) await press(touch, keep)
  await expect(button(page, 'Download save file')).toBeVisible({ timeout: 30_000 })
  const [dl] = await Promise.all([page.waitForEvent('download'), press(touch, button(page, 'Download save file'))])
  const path = await dl.path()
  const doc = JSON.parse(readFileSync(path ?? '', 'utf8')) as unknown
  const found: Record<string, unknown>[] = []
  const walk = (v: unknown, at: string): void => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}[${i}]`))
    else if (typeof v === 'object' && v !== null) {
      const o = v as Record<string, unknown>
      if ('rt_timestamp_source' in o || 'rt_timestamp_reason' in o) found.push({ at, family: o.family ?? o.item_family ?? null, rt_timestamp_source: o.rt_timestamp_source ?? null, rt_timestamp_reason: o.rt_timestamp_reason ?? null, input_type: o.input_type ?? null, device_class: o.device_class ?? null })
      for (const [k, x] of Object.entries(o)) walk(x, `${at}.${k}`)
    }
  }
  walk(doc, '$')
  facts['save: time-stamp source records'] = found
  facts['save: rt responses'] = (() => { const d = doc as { sessions?: { responses?: { family?: string }[] }[] }; return (d.sessions ?? []).map((s) => (s.responses ?? []).filter((r) => /^rt_/.test(r.family ?? '')).length) })()
  facts.summary = { stageLabel: (facts['practice stage'] as { stage: { label: string } | null }).stage?.label, focusIsStage: (facts['practice stage'] as { focusIsStage: boolean }).focusIsStage, counters: [...counters], timestampRecords: found.map((f) => `${f.rt_timestamp_source} (${f.rt_timestamp_reason})`) }
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[verify2 RT] ${JSON.stringify(facts.summary)}`)
})
