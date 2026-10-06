/// <reference lib="dom" />
/**
 * Persona "Sam": a first-time visitor on an iPhone who arrived from a link a friend shared, one thumb, on a sofa,
 * on mobile data (package rev-phone; run id `phone`). Each test is independent and meant to run by itself:
 *
 *   UX_PORT=4611 UX_RUN=phone npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/phone.ux.ts --project=iphone --grep 'phone: journey practice'
 *
 * Output: web/test-results/ux-review/phone/<test>-<project>/... (one Shots per directory). Every test writes a JSON of
 * measured numbers next to the screenshots, which the findings file cites.
 */

import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { button, h1, loadSave, simulatedSave, toReady, toResults } from '../../e2e/flow'
import { openRoute, PREVIEW_ROUTES, type Route } from '../../e2e/routes'
import { SessionDriver } from '../../e2e/session-driver'
import { pageMetrics, playJourney, PRODUCT_ROUTES, Shots, tour, trackConsole, WEB_ROOT } from '../lib'

const RUN = process.env.UX_RUN ?? 'phone'

/** The size of a thumb-sized target the review judges against (CSS px). */
const THUMB = 44

interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

interface ScreenFacts {
  readonly h1: string
  /** Top of the h1 in viewport coordinates (negative: scrolled out above), or null without one. */
  readonly h1Top: number | null
  readonly scrollY: number
  readonly innerHeight: number
  readonly innerWidth: number
  readonly scrollHeight: number
  /** The primary action (first `.hb-primary`, or the named button): its rect and whether it is inside the first viewport. */
  readonly primary: { readonly name: string; readonly rect: Rect; readonly inFirstViewport: boolean; readonly needsScroll: number } | null
  /** Elements with position fixed or sticky, with their rects. */
  readonly fixed: { readonly selector: string; readonly rect: Rect; readonly position: string }[]
  readonly activeElement: string
  readonly fontSizePx: number
}

const SCREEN_FACTS = `(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) } }
  const describe = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : '')
  const h1 = document.querySelector('h1')
  const primaryEl = document.querySelector('.hb-primary') || [...document.querySelectorAll('button')].find((b) => /^(Start|Continue|Begin|Confirm|Submit|Done|Next)/.test(b.textContent.trim()))
  let primary = null
  if (primaryEl) {
    const rect = r(primaryEl)
    const absBottom = rect.y + rect.h + window.scrollY
    primary = { name: primaryEl.textContent.trim().slice(0, 40), rect, inFirstViewport: absBottom <= window.innerHeight, needsScroll: Math.max(0, Math.round(absBottom - window.innerHeight)) }
  }
  const fixed = []
  for (const el of document.querySelectorAll('*')) {
    const p = getComputedStyle(el).position
    if (p === 'fixed' || p === 'sticky') { const b = el.getBoundingClientRect(); if (b.width > 0 && b.height > 0) fixed.push({ selector: describe(el), rect: r(el), position: p }) }
  }
  const a = document.activeElement
  return {
    h1: h1 ? h1.textContent.trim() : '',
    h1Top: h1 ? Math.round(h1.getBoundingClientRect().top) : null,
    scrollY: Math.round(window.scrollY),
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    scrollHeight: document.documentElement.scrollHeight,
    primary,
    fixed,
    activeElement: a ? describe(a) + ' "' + (a.textContent || '').trim().slice(0, 30) + '"' : '',
    fontSizePx: parseFloat(getComputedStyle(document.body).fontSize),
  }
})()`

async function screenFacts(page: Page): Promise<ScreenFacts> {
  return page.evaluate<ScreenFacts>(SCREEN_FACTS)
}

/** Scroll to the bottom of the page (a thumb flicked down to find the button), then press `target` and read where the next screen opens. */
async function scrollThenPress(page: Page, target: Locator): Promise<void> {
  await page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
  await page.waitForTimeout(100)
  await press(target)
}

/** A finger (the default: every phone project) or, on a desktop project without touch, a mouse click. */
let TOUCH = true

async function press(target: Locator): Promise<void> {
  if (TOUCH) await target.tap({ timeout: 20_000 })
  else await target.click({ timeout: 20_000 })
}

/** Rects of every element `selector` matches (viewport coordinates). */
async function rectsOf(page: Page, selector: string): Promise<Rect[]> {
  return page.evaluate<Rect[]>(`[...document.querySelectorAll(${JSON.stringify(selector)})].map((el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left * 10) / 10, y: Math.round(b.top * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 } })`)
}

/** Smallest centre-to-centre gap between neighbouring rects (edge to edge), to judge how easy a wrong tap is. */
function minEdgeGap(rects: readonly Rect[]): number | null {
  let best: number | null = null
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!
      const b = rects[j]!
      const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w))
      const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h))
      const gap = Math.round(Math.max(dx, dy) * 10) / 10
      if (best === null || gap < best) best = gap
    }
  }
  return best
}

const touchDriver = (page: Page): SessionDriver => new SessionDriver(page, { touch: true })

/** Skip the part that is running from the header ("Skip <part>" asks first), the way a person stops a block they have started. */
async function skipFromBlock(page: Page): Promise<void> {
  await press(page.locator('header.top .actions').getByRole('button', { name: /^Skip / }))
  await press(page.locator('section.confirm').getByRole('button', { name: /^Skip / }))
  await expect(page.locator('section.confirm')).toHaveCount(0)
}

/** A preview route by id (e2e/routes.ts). */
function routeOf(id: string): Route {
  const route = PREVIEW_ROUTES.find((r) => r.id === id)
  if (route === undefined) throw new Error(`no route ${id}`)
  return route
}

// ------------------------------------------------------------------------------------------ 1. the journey

test('phone: journey practice', async ({ page }, testInfo) => {
  const project = testInfo.project.name
  const log = trackConsole(page)
  const shots = new Shots(page, RUN, `journey-practice-${project}`)
  const journey = await playJourney(page, { runId: RUN, touch: true, practice: true, shots, limitMs: 12 * 60_000 })
  shots.json('console', log)
  console.log(`[phone] journey practice ${project}: ${JSON.stringify({ completed: journey.completed, error: journey.error, segments: journey.segments, played: journey.played, answered: journey.answered, realMs: journey.realMs, steps: journey.steps.length })}`)
  expect(journey.steps.length).toBeGreaterThan(0)
})

test('phone: journey plain', async ({ page }, testInfo) => {
  const project = testInfo.project.name
  const log = trackConsole(page)
  const shots = new Shots(page, RUN, `journey-${project}`)
  const journey = await playJourney(page, { runId: RUN, touch: true, practice: false, shots, limitMs: 12 * 60_000 })
  if (journey.completed) {
    // The results of the session just played, as the person sees them: metrics and the blob.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const skip = button(page, 'Skip animation')
    if (await skip.isVisible().catch(() => false)) await skip.tap()
    await expect(button(page, 'Download save file')).toBeVisible({ timeout: 30_000 })
    shots.json('results-metrics', await pageMetrics(page, { touch: true, axe: true }))
    const blob = page.locator('svg.hb-blob').first()
    if (await blob.isVisible().catch(() => false)) await shots.shot('results-blob', { locator: blob })
  }
  shots.json('console', log)
  console.log(`[phone] journey plain ${project}: ${JSON.stringify({ completed: journey.completed, error: journey.error, segments: journey.segments, played: journey.played, answered: journey.answered, realMs: journey.realMs, steps: journey.steps.length })}`)
  expect(journey.steps.length).toBeGreaterThan(0)
})

// ------------------------------------------------------------------------------------------ 2. the tour, by group

const GROUPS = ['start', 'session', 'results', 'notes', 'selftest'] as const

for (const group of GROUPS) {
  test(`phone: tour ${group}`, async ({ context }, testInfo) => {
    const project = testInfo.project.name
    const routes = PRODUCT_ROUTES.filter((r) => r.group === group).map((r) => r.id)
    const entries = await tour(context, { runId: RUN, sub: `tour-${project}`, routes, schemes: ['light'], touch: true, axe: true })
    const failed = entries.filter((e) => !e.ok).map((e) => `${e.route}: ${e.error ?? ''}`)
    console.log(`[phone] tour ${group} ${project}: ${entries.length - failed.length}/${entries.length} ok${failed.length === 0 ? '' : `; failed: ${failed.join(' | ')}`}`)
    expect(entries.length).toBe(routes.length)
  })
}

// ------------------------------------------------------------------------------------------ 3. screen by screen

test('phone: screens start', async ({ page }, testInfo) => {
  const project = testInfo.project.name
  const log = trackConsole(page)
  const shots = new Shots(page, RUN, `screens-start-${project}`)
  const facts: Record<string, unknown> = {}

  await page.goto('./?fast=1')
  await expect(h1(page)).toHaveText('HumanBench')
  facts['welcome'] = await screenFacts(page)
  await shots.shot('welcome-viewport', { fullPage: false })
  await shots.all('welcome')
  facts['welcome-metrics'] = await pageMetrics(page, { touch: true })

  // A thumb scrolls down looking for the button; the next screen should open at its top.
  await scrollThenPress(page, button(page, 'Start'))
  await expect(h1(page)).toHaveText('Before you start')
  facts['gate'] = await screenFacts(page)
  await shots.shot('gate-viewport', { fullPage: false })
  await shots.all('gate')
  // The gate's checkbox and its label: the tap target as a finger meets it.
  facts['gate-checkbox'] = { label: await rectsOf(page, 'label:has(input[type=checkbox])'), input: await rectsOf(page, 'input[type=checkbox]') }
  await page.getByRole('checkbox', { name: /18 or older/ }).tap()
  await scrollThenPress(page, button(page, 'Continue'))
  await expect(h1(page)).toHaveText('Honour code')
  facts['honour'] = await screenFacts(page)
  await shots.shot('honour-viewport', { fullPage: false })
  await shots.all('honour')
  await page.getByRole('checkbox', { name: /honour code/ }).tap()
  await scrollThenPress(page, button(page, 'Continue'))
  await expect(h1(page)).toHaveText('Check your device')
  facts['device-measuring'] = await screenFacts(page)
  await shots.shot('device-measuring', { fullPage: false })
  await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
  facts['device'] = await screenFacts(page)
  await shots.shot('device-viewport', { fullPage: false })
  await shots.all('device')
  // Which response mode is preselected on this phone?
  const checked = await page.evaluate<string>(`(() => { const r = document.querySelector('input[type=radio]:checked'); return r ? (r.closest('label') || {}).textContent.trim() : '(none)' })()`)
  const coarse = await page.evaluate<boolean>('matchMedia("(pointer: coarse)").matches')
  const facts_dl = await page.locator('dl.facts').innerText().catch(() => '')
  facts['device-input'] = { preselected: checked, coarsePointer: coarse, maxTouchPoints: await page.evaluate<number>('navigator.maxTouchPoints'), facts: facts_dl, radios: await rectsOf(page, 'label.radio') }
  await scrollThenPress(page, button(page, 'Continue'))
  await expect(h1(page)).toHaveText('Ready when you are')
  facts['ready'] = await screenFacts(page)
  await shots.shot('ready-viewport', { fullPage: false })
  await shots.all('ready')
  facts['ready-metrics'] = await pageMetrics(page, { touch: true, axe: true })
  // Open the load-a-save part if it is a disclosure, to see the file input on a phone.
  const details = page.locator('details')
  facts['ready-details'] = { count: await details.count(), summaries: await details.locator('summary').allInnerTexts().catch(() => []) }

  // Practice: the first question, the slider and the feedback, by thumb.
  await scrollThenPress(page, button(page, 'Try practice questions first'))
  await expect(h1(page)).toHaveText('Practice')
  facts['practice'] = await screenFacts(page)
  await shots.shot('practice-viewport', { fullPage: false })
  await shots.all('practice')
  facts['practice-metrics'] = await pageMetrics(page, { touch: true })
  const choice = page.locator('form.choice')
  const entry = page.locator('form.entry')
  if ((await choice.count()) > 0) {
    facts['practice-options'] = { options: await rectsOf(page, 'form.choice label, form.choice .option'), gap: minEdgeGap(await rectsOf(page, 'form.choice label, form.choice .option')) }
    await choice.getByRole('radio').first().tap()
    await scrollThenPress(page, button(page, 'Confirm'))
  } else {
    const box = entry.locator('input[type=text]')
    facts['practice-entry'] = { inputFont: await box.evaluate((el) => getComputedStyle(el).fontSize), inputmode: await box.getAttribute('inputmode'), type: await box.getAttribute('type'), rect: await rectsOf(page, 'form.entry input[type=text]') }
    await box.tap()
    facts['practice-entry-focused'] = await screenFacts(page)
    await shots.shot('practice-entry-focused', { fullPage: false })
    await box.fill((await box.evaluate((el) => el.classList.contains('letter'))) ? 'A' : '1')
    await scrollThenPress(page, entry.getByRole('button', { name: 'Submit', exact: true }))
  }
  const slider = page.getByRole('slider')
  await expect(slider).toBeVisible()
  facts['confidence'] = await screenFacts(page)
  await shots.shot('confidence-viewport', { fullPage: false })
  await shots.all('confidence')
  // The slider by finger: its box, the thumb size the browser draws, and a tap at three quarters of its width.
  const box = (await rectsOf(page, 'input[type=range]'))[0]
  if (box !== undefined) {
    const before = await slider.inputValue()
    await page.touchscreen.tap(box.x + box.w * 0.75, box.y + box.h / 2)
    await page.waitForTimeout(150)
    const after = await slider.inputValue()
    facts['confidence-slider'] = { rect: box, valueBefore: before, valueAfterTapAt75pct: after, height: box.h }
  }
  await scrollThenPress(page, button(page, 'Continue'))
  await expect(page.getByText(/That was (not )?correct\./)).toBeVisible()
  facts['practice-feedback'] = await screenFacts(page)
  await shots.shot('practice-feedback-viewport', { fullPage: false })
  await shots.all('practice-feedback')

  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[phone] screens start ${project}: device preselected=${JSON.stringify(facts['device-input'])}`)
})

test('phone: screens session', async ({ page }, testInfo) => {
  const project = testInfo.project.name
  const log = trackConsole(page)
  const shots = new Shots(page, RUN, `screens-session-${project}`)
  const facts: Record<string, unknown> = {}
  const driver = touchDriver(page)

  await driver.toReady('./?fast=1')
  await scrollThenPress(page, button(page, 'Begin'))
  await expect(h1(page)).toHaveText('Up next: Reaction time')
  facts['interstitial'] = await screenFacts(page)
  await shots.shot('interstitial-viewport', { fullPage: false })
  await shots.all('interstitial')
  facts['interstitial-metrics'] = await pageMetrics(page, { touch: true, axe: true })

  // Reaction time: the intro, then the pads during a practice trial.
  await scrollThenPress(page, button(page, 'Start'))
  await expect(h1(page)).toHaveText('Reaction time')
  await expect(button(page, 'Start practice')).toBeVisible()
  facts['rt-intro'] = await screenFacts(page)
  await shots.shot('rt-intro-viewport', { fullPage: false })
  await shots.all('rt-intro')
  await scrollThenPress(page, button(page, 'Start practice'))
  await expect(page.locator('.rt .stage')).toBeVisible()
  facts['rt-trial'] = await screenFacts(page)
  await shots.shot('rt-trial-viewport', { fullPage: false })
  await shots.all('rt-trial')
  const pads = await rectsOf(page, 'section.hb-render.rt button.pad')
  facts['rt-pads'] = {
    pads,
    gap: minEdgeGap(pads),
    stage: (await rectsOf(page, '.rt .stage'))[0],
    touchAction: await page.evaluate<Record<string, string>>(`(() => { const o = {}; for (const s of ['.rt .stage', '.rt button.pad', 'body', 'html']) { const el = document.querySelector(s); o[s] = el ? getComputedStyle(el).touchAction : '(none)' } return o })()`),
    viewportMeta: await page.evaluate<string>(`(document.querySelector('meta[name=viewport]') || {}).content || ''`),
    statusLine: await page.locator('.rt .hb-status').innerText().catch(() => ''),
  }
  // A double tap on a pad: does the page zoom (visualViewport.scale) or scroll?
  const pad = pads[0]
  if (pad !== undefined) {
    const scale0 = await page.evaluate<number>('visualViewport.scale')
    const y0 = await page.evaluate<number>('window.scrollY')
    await page.touchscreen.tap(pad.x + pad.w / 2, pad.y + pad.h / 2)
    await page.waitForTimeout(80)
    await page.touchscreen.tap(pad.x + pad.w / 2, pad.y + pad.h / 2)
    await page.waitForTimeout(400)
    facts['rt-double-tap'] = { scaleBefore: scale0, scaleAfter: await page.evaluate<number>('visualViewport.scale'), scrollYBefore: y0, scrollYAfter: await page.evaluate<number>('window.scrollY') }
  }
  // Does a tap outside the pads (on the stage) count as a response? (Read with the source: here only what the page tells.)
  facts['rt-after-taps'] = { status: await page.locator('.rt .hb-status').innerText().catch(() => ''), progress: await page.locator('.rt .progress').innerText().catch(() => '') }
  // Stop the block from the header (the way a person does), then the Matrix & Series item.
  await skipFromBlock(page)
  await expect(h1(page)).toHaveText('Up next: Matrix & Series')
  facts['interstitial-2'] = await screenFacts(page)
  await scrollThenPress(page, button(page, 'Start'))
  await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
  facts['item'] = await screenFacts(page)
  await shots.shot('item-viewport', { fullPage: false })
  await shots.all('item')
  facts['item-metrics'] = await pageMetrics(page, { touch: true, axe: true })
  const entryBox = page.locator('form.entry input[type=text]')
  if ((await entryBox.count()) > 0) {
    facts['item-entry'] = { inputFont: await entryBox.evaluate((el) => getComputedStyle(el).fontSize), inputmode: await entryBox.getAttribute('inputmode'), type: await entryBox.getAttribute('type'), autocomplete: await entryBox.getAttribute('autocomplete'), rect: await rectsOf(page, 'form.entry input[type=text]') }
  }
  // The skip and finish controls under the item: where are they, how big?
  facts['item-actions'] = { buttons: await page.evaluate<{ name: string; rect: Rect }[]>(`[...document.querySelectorAll('.actions button, .hb-actions button')].map((b) => { const r = b.getBoundingClientRect(); return { name: b.textContent.trim(), rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } } })`) }
  await page.locator('.actions').getByRole('button', { name: /^Skip / }).tap()
  await expect(page.locator('section.confirm')).toBeVisible()
  facts['confirm-skip'] = await screenFacts(page)
  await shots.shot('confirm-skip-viewport', { fullPage: false })
  await shots.all('confirm-skip')
  await page.locator('section.confirm').getByRole('button', { name: /^Skip / }).tap()

  // Spatial: how long until the figures (Three.js) are up, and what the item looks like by thumb.
  await expect(h1(page)).toHaveText('Up next: Spatial')
  await scrollThenPress(page, button(page, 'Start'))
  const t0 = Date.now()
  await expect(page.locator('form.choice').or(page.locator('.unavailable'))).toBeVisible({ timeout: 60_000 })
  facts['spatial-ms-to-item'] = Date.now() - t0
  await page.waitForTimeout(500)
  facts['spatial'] = await screenFacts(page)
  await shots.shot('spatial-viewport', { fullPage: false })
  await shots.all('spatial')
  facts['spatial-metrics'] = await pageMetrics(page, { touch: true })
  facts['spatial-canvas'] = { canvases: await rectsOf(page, 'div.rotation canvas'), options: await rectsOf(page, 'form.choice label, form.choice .option'), figure: await rectsOf(page, 'div.rotation'), unavailable: await page.locator('.unavailable').count() }
  await skipFromBlock(page)

  // Working memory: the digit keypad.
  await expect(h1(page)).toHaveText('Up next: Working Memory')
  await scrollThenPress(page, button(page, 'Start'))
  await expect(page.locator('section.hb-render.span')).toBeVisible()
  facts['memory-intro'] = await screenFacts(page)
  await shots.shot('memory-intro-viewport', { fullPage: false })
  await shots.all('memory-intro')
  await scrollThenPress(page, page.locator('section.hb-render.span').getByRole('button', { name: 'Start' }))
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 30_000 })
  facts['memory-entry'] = await screenFacts(page)
  await shots.shot('memory-entry-viewport', { fullPage: false })
  await shots.all('memory-entry')
  const keys = await rectsOf(page, 'section.hb-render.span [role=group] button')
  facts['memory-keypad'] = { keys, gap: minEdgeGap(keys), under44: keys.filter((k) => Math.min(k.w, k.h) < THUMB).length, metrics: await pageMetrics(page, { touch: true, axe: true }) }
  // Corsi has its own test (phone: corsi, by route); stop the part from the header.
  await skipFromBlock(page)

  // Quantitative: the typed entry.
  await expect(h1(page)).toHaveText('Up next: Quantitative Reasoning')
  await scrollThenPress(page, button(page, 'Start'))
  await expect(page.locator('form.entry')).toBeVisible()
  facts['quant'] = await screenFacts(page)
  await shots.shot('quant-viewport', { fullPage: false })
  await shots.all('quant')
  const qbox = page.locator('form.entry input[type=text]')
  facts['quant-entry'] = { inputFont: await qbox.evaluate((el) => getComputedStyle(el).fontSize), inputmode: await qbox.getAttribute('inputmode'), type: await qbox.getAttribute('type'), rect: await rectsOf(page, 'form.entry input[type=text]'), metrics: await pageMetrics(page, { touch: true }) }
  await qbox.tap()
  await page.waitForTimeout(200)
  facts['quant-focused'] = await screenFacts(page)
  await shots.shot('quant-focused-viewport', { fullPage: false })
  await skipFromBlock(page)

  // Processing & reading speed: the coding keypad, the passage and the questions.
  await expect(h1(page)).toHaveText('Up next: Processing & Reading Speed')
  await scrollThenPress(page, button(page, 'Start'))
  await expect(page.locator('section.hb-render.coding')).toBeVisible()
  facts['coding-intro'] = await screenFacts(page)
  await shots.shot('coding-intro-viewport', { fullPage: false })
  await shots.all('coding-intro')
  await scrollThenPress(page, page.locator('section.hb-render.coding').getByRole('button', { name: 'Start' }))
  await expect(page.getByRole('timer')).toBeVisible()
  facts['coding'] = await screenFacts(page)
  await shots.shot('coding-viewport', { fullPage: false })
  await shots.all('coding')
  const ckeys = await rectsOf(page, 'section.hb-render.coding [role=group] button')
  facts['coding-keypad'] = { keys: ckeys, gap: minEdgeGap(ckeys), under44: ckeys.filter((k) => Math.min(k.w, k.h) < THUMB).length, metrics: await pageMetrics(page, { touch: true, axe: true }), keyAndLegendVisibleTogether: await page.evaluate<boolean>(`(() => { const g = document.querySelector('section.hb-render.coding [role=group]'); const key = document.querySelector('section.hb-render.coding .key, section.hb-render.coding table, section.hb-render.coding .legend'); if (!g || !key) return false; const a = g.getBoundingClientRect(); const b = key.getBoundingClientRect(); return a.bottom <= window.innerHeight && b.top >= 0 })()`) }
  // Reading has its own test (phone: reading, by route). Stop here: every part skipped ends the session with nothing answered.
  await skipFromBlock(page)
  await expect(h1(page)).toHaveText('Session ended', { timeout: 30_000 })
  facts['finished-nothing'] = await screenFacts(page)
  await shots.shot('finished-nothing-viewport', { fullPage: false })
  await shots.all('finished-nothing')

  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[phone] screens session ${project}: pads=${JSON.stringify(facts['rt-pads'])} dbl=${JSON.stringify(facts['rt-double-tap'])} spatialMs=${String(facts['spatial-ms-to-item'])}`)
})

test('phone: corsi', async ({ page }, testInfo) => {
  const project = testInfo.project.name
  const log = trackConsole(page)
  const shots = new Shots(page, RUN, `corsi-${project}`)
  const facts: Record<string, unknown> = {}
  await openRoute(page, routeOf('memory-corsi'))
  facts['corsi'] = await screenFacts(page)
  await shots.shot('corsi-viewport', { fullPage: false })
  await shots.all('corsi')
  const blocks = await rectsOf(page, 'section.hb-render.corsi button.block')
  facts['board'] = { board: (await rectsOf(page, 'section.hb-render.corsi .board'))[0], blocks, gap: minEdgeGap(blocks), under44: blocks.filter((k) => Math.min(k.w, k.h) < THUMB).length, smallest: Math.min(...blocks.map((k) => Math.min(k.w, k.h))) }
  facts['metrics'] = await pageMetrics(page, { touch: true, axe: true })
  // Two blocks by finger, then the status line and the Undo button.
  const [a, b] = blocks
  if (a !== undefined && b !== undefined) {
    await page.touchscreen.tap(a.x + a.w / 2, a.y + a.h / 2)
    await page.touchscreen.tap(b.x + b.w / 2, b.y + b.h / 2)
    await page.waitForTimeout(150)
    facts['after-taps'] = { status: await page.getByText(/^Selected \d+ of \d+\./).innerText().catch(() => ''), undoEnabled: await page.getByRole('button', { name: 'Undo' }).isEnabled().catch(() => null), doneRect: (await rectsOf(page, 'section.hb-render.corsi button.hb-primary'))[0] }
    await shots.shot('corsi-tapped', { fullPage: false })
  }
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[phone] corsi ${project}: ${JSON.stringify(facts['board']).slice(0, 300)} ${JSON.stringify(facts['after-taps'])}`)
})

test('phone: reading', async ({ page }, testInfo) => {
  const project = testInfo.project.name
  const log = trackConsole(page)
  const shots = new Shots(page, RUN, `reading-${project}`)
  const facts: Record<string, unknown> = {}
  await openRoute(page, routeOf('reading-passage'))
  const reading = page.locator('section.hb-render.reading')
  facts['passage'] = await screenFacts(page)
  await shots.shot('passage-viewport', { fullPage: false })
  await shots.all('passage')
  facts['passage-metrics'] = await pageMetrics(page, { touch: true, axe: true })
  facts['passage-text'] = await page.evaluate<Record<string, unknown>>(`(() => { const p = document.querySelector('section.hb-render.reading .passage'); if (!p) return {}; const cs = getComputedStyle(p); const r = p.getBoundingClientRect(); return { fontSize: cs.fontSize, lineHeight: cs.lineHeight, width: Math.round(r.width), height: Math.round(r.height), words: (p.textContent || '').trim().split(/\\s+/).length, paragraphs: p.querySelectorAll('p').length } })()`)
  const done = reading.getByRole('button', { name: 'Done reading' })
  facts['done-at-open'] = { enabled: await done.isEnabled(), rect: (await done.boundingBox()) ?? null }
  await expect(done).toBeEnabled({ timeout: 30_000 })
  await scrollThenPress(page, done)
  await expect(reading.locator('fieldset.question').first()).toBeVisible()
  facts['questions'] = await screenFacts(page)
  await shots.shot('questions-viewport', { fullPage: false })
  await shots.all('questions')
  facts['questions-metrics'] = await pageMetrics(page, { touch: true, axe: true })
  const options = await rectsOf(page, 'section.hb-render.reading label.option')
  facts['options'] = { count: options.length, gap: minEdgeGap(options), heights: options.map((o) => o.h) }
  for (const group of await reading.locator('fieldset.question').all()) await group.locator('input[type=radio]').first().tap()
  facts['submit'] = { rect: (await reading.getByRole('button', { name: 'Submit answers' }).boundingBox()) ?? null }
  await scrollThenPress(page, reading.getByRole('button', { name: 'Submit answers' }))
  await page.waitForTimeout(300)
  facts['after-submit'] = await screenFacts(page)
  await shots.shot('after-submit-viewport', { fullPage: false })
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[phone] reading ${project}: ${JSON.stringify(facts['passage-text'])} options=${JSON.stringify(facts['options'])}`)
})

test('phone: screens landscape', async ({ page }, testInfo) => {
  const project = testInfo.project.name
  const log = trackConsole(page)
  const shots = new Shots(page, RUN, `landscape-${project}`)
  const facts: Record<string, unknown> = {}
  const vp = page.viewportSize() ?? { width: 390, height: 664 }
  await page.setViewportSize({ width: vp.height, height: vp.width })
  const driver = touchDriver(page)
  await driver.toReady('./?fast=1')
  facts['ready'] = await screenFacts(page)
  await shots.shot('ready', { fullPage: false })
  await scrollThenPress(page, button(page, 'Begin'))
  await expect(h1(page)).toHaveText('Up next: Reaction time')
  facts['interstitial'] = await screenFacts(page)
  await shots.shot('interstitial', { fullPage: false })
  await scrollThenPress(page, button(page, 'Start'))
  await expect(button(page, 'Start practice')).toBeVisible()
  facts['rt-intro'] = await screenFacts(page)
  await shots.shot('rt-intro', { fullPage: false })
  await scrollThenPress(page, button(page, 'Start practice'))
  await expect(page.locator('.rt .stage')).toBeVisible()
  facts['rt-trial'] = await screenFacts(page)
  facts['rt-pads'] = await rectsOf(page, 'section.hb-render.rt button.pad')
  await shots.shot('rt-trial', { fullPage: false })
  await skipFromBlock(page)
  await expect(h1(page)).toHaveText('Up next: Matrix & Series')
  await scrollThenPress(page, button(page, 'Start'))
  await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
  facts['item'] = await screenFacts(page)
  await shots.shot('item', { fullPage: false })
  await shots.all('item-full')
  await skipFromBlock(page)
  await driver.skipPart()
  await expect(h1(page)).toHaveText('Up next: Working Memory')
  await scrollThenPress(page, button(page, 'Start'))
  await scrollThenPress(page, page.locator('section.hb-render.span').getByRole('button', { name: 'Start' }))
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 30_000 })
  facts['memory-entry'] = await screenFacts(page)
  facts['memory-keys'] = await rectsOf(page, 'section.hb-render.span [role=group] button')
  await shots.shot('memory-entry', { fullPage: false })
  await shots.all('memory-entry-full')
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[phone] landscape ${project}: ${JSON.stringify(facts['memory-entry'])}`)
})

// ------------------------------------------------------------------------------------------ 4. the results

test('phone: results', async ({ page }, testInfo) => {
  const project = testInfo.project.name
  const log = trackConsole(page)
  const shots = new Shots(page, RUN, `results-${project}`)
  const facts: Record<string, unknown> = {}
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const sim = simulatedSave(1)
  await toReady(page, 'Tap or click')
  await loadSave(page, sim.save)
  facts['ready-returning'] = await screenFacts(page)
  await shots.shot('ready-returning', { fullPage: false })
  await button(page, 'Begin').tap()
  await expect(h1(page)).toHaveText('Up next: Reaction time')
  await button(page, 'Finish early').tap()
  await expect(page.getByRole('heading', { level: 2, name: 'Finish now?' })).toBeVisible()
  facts['confirm-finish'] = await screenFacts(page)
  await shots.shot('confirm-finish', { fullPage: false })
  await button(page, 'Finish now').tap()
  await expect(h1(page)).toHaveText('Session complete')
  await expect(button(page, 'Download save file')).toBeVisible({ timeout: 30_000 })
  facts['results'] = await screenFacts(page)
  await shots.shot('results-viewport', { fullPage: false })
  await shots.all('results')
  facts['results-metrics'] = await pageMetrics(page, { touch: true, axe: true })

  // The blob: its box, its labels (overlaps, labels cut by the svg's edge) at this width.
  const blob = page.locator('svg.hb-blob').first()
  await expect(blob).toBeVisible()
  await shots.shot('blob', { locator: blob })
  facts['blob'] = await page.evaluate<Record<string, unknown>>(`(() => {
    const svg = document.querySelector('svg.hb-blob')
    const sb = svg.getBoundingClientRect()
    const texts = [...svg.querySelectorAll('text, foreignObject')].map((t) => { const r = t.getBoundingClientRect(); return { text: (t.textContent || '').trim().slice(0, 40), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), fontSize: getComputedStyle(t).fontSize } }).filter((t) => t.w > 0 && t.h > 0)
    const overlaps = []
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) { const a = texts[i], b = texts[j]; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps.push([a.text, b.text]) }
    const cut = texts.filter((t) => t.x < sb.left - 1 || t.x + t.w > sb.right + 1 || t.y < sb.top - 1 || t.y + t.h > sb.bottom + 1).map((t) => t.text)
    const outsideViewport = texts.filter((t) => t.x < 0 || t.x + t.w > window.innerWidth).map((t) => t.text)
    const smallest = texts.reduce((m, t) => Math.min(m, parseFloat(t.fontSize)), 99)
    return { svg: { x: Math.round(sb.left), y: Math.round(sb.top), w: Math.round(sb.width), h: Math.round(sb.height) }, labels: texts.length, overlaps, cutBySvg: cut, outsideViewport, smallestFontPx: smallest, texts }
  })()`)
  // The legend / rings / uncertainty copy near the blob.
  facts['blob-neighbourhood-text'] = await page.locator('.reveal').first().innerText().then((t) => t.slice(0, 1500)).catch(() => '')

  // Drill-down by tap, and where the page lands.
  const speed = page.getByRole('button', { name: 'Speed', exact: true })
  const speedRect = (await speed.boundingBox()) ?? null
  await speed.scrollIntoViewIfNeeded()
  await speed.tap()
  await expect(page.locator('section.facet-panel')).toBeVisible()
  const panel = (await page.locator('section.facet-panel').boundingBox()) ?? null
  facts['drilldown'] = { speedButton: speedRect, panelBox: panel, scrollY: await page.evaluate<number>('window.scrollY'), innerHeight: await page.evaluate<number>('window.innerHeight'), panelInView: panel !== null && panel.y >= 0 && panel.y < (await page.evaluate<number>('window.innerHeight')), activeElement: (await screenFacts(page)).activeElement }
  await shots.shot('drilldown-viewport', { fullPage: false })
  await shots.all('drilldown')
  facts['drilldown-metrics'] = await pageMetrics(page, { touch: true })
  // Tables anywhere on the page: do any need sideways scrolling?
  facts['tables'] = await page.evaluate<unknown[]>(`[...document.querySelectorAll('table')].map((t) => { const wrap = t.parentElement; return { caption: (t.querySelector('caption') || {}).textContent || '', cols: t.querySelectorAll('thead th, tr:first-child th, tr:first-child td').length, scrollWidth: t.scrollWidth, clientWidth: t.clientWidth, wrapperOverflowX: wrap ? getComputedStyle(wrap).overflowX : '', wrapperScroll: wrap ? wrap.scrollWidth - wrap.clientWidth : 0, right: Math.round(t.getBoundingClientRect().right), innerWidth: window.innerWidth } })`)

  // Bar view.
  await page.getByRole('button', { name: 'Bar view' }).tap()
  await expect(page.locator('svg.lollipop').first()).toBeVisible()
  facts['bars'] = await screenFacts(page)
  await shots.shot('bars-viewport', { fullPage: false })
  await shots.all('bars')
  facts['bars-metrics'] = await pageMetrics(page, { touch: true, axe: true })
  facts['bars-labels'] = await page.evaluate<Record<string, unknown>>(`(() => { const ts = [...document.querySelectorAll('svg.lollipop text')].map((t) => ({ text: (t.textContent || '').trim(), fontSize: getComputedStyle(t).fontSize, w: Math.round(t.getBoundingClientRect().width) })); return { count: ts.length, smallest: ts.reduce((m, t) => Math.min(m, parseFloat(t.fontSize)), 99), sample: ts.slice(0, 8) } })()`)
  await page.getByRole('button', { name: /Blob view|Blob/ }).first().tap().catch(() => undefined)

  // Share: what the browser offers, and what the panel shows.
  facts['share-api'] = await page.evaluate<Record<string, unknown>>(`({ share: typeof navigator.share, canShare: typeof navigator.canShare, ua: navigator.userAgent, clipboard: typeof navigator.clipboard, clipboardItem: typeof ClipboardItem })`)
  facts['save-panel-buttons'] = await page.evaluate<string[]>(`[...document.querySelectorAll('.save button, [class*=save] button, section:has(> h2) button')].map((b) => b.textContent.trim()).filter((t, i, a) => a.indexOf(t) === i).slice(0, 30)`)
  facts['save-panel-text'] = await page.locator('button', { hasText: 'Download save file' }).locator('xpath=ancestor::section[1]').innerText().catch(() => '')

  // Download: the file the browser is handed (name and extension), measured through the download event.
  const dl = button(page, 'Download save file')
  await dl.scrollIntoViewIfNeeded()
  const tDl = Date.now()
  const downloadP = page.waitForEvent('download', { timeout: 15_000 }).then((d) => ({ suggested: d.suggestedFilename(), url: d.url().slice(0, 40) })).catch((e: Error) => ({ error: e.message.split('\n')[0] }))
  await dl.tap()
  facts['download'] = { ...(await downloadP), ms: Date.now() - tDl, statusAfter: await page.locator('.reveal [role="status"]').allInnerTexts().catch(() => []) }
  await expect(page.locator('[data-share-card]')).toBeVisible({ timeout: 20_000 })
  facts['after-save'] = await screenFacts(page)
  await shots.shot('after-save-viewport', { fullPage: false })
  await shots.all('after-save')
  facts['after-save-metrics'] = await pageMetrics(page, { touch: true, axe: true })

  // The share card: how long until the PNG preview is there, its buttons, and its download.
  const tCard = Date.now()
  const preview = page.locator('img[data-preview]')
  await expect(preview).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => preview.evaluate((img) => (img as HTMLImageElement).naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0)
  const pngButton = page.locator('[data-share-card]').getByRole('button', { name: /PNG|image|picture/i }).first()
  await expect(pngButton).toBeEnabled({ timeout: 30_000 })
  facts['share-card'] = { msToPreview: Date.now() - tCard, preview: await preview.evaluate((img) => ({ w: (img as HTMLImageElement).naturalWidth, h: (img as HTMLImageElement).naturalHeight, cssW: Math.round(img.getBoundingClientRect().width) })), buttons: await page.locator('[data-share-card] button').allInnerTexts(), metrics: await pageMetrics(page, { touch: true, scope: '[data-share-card]' }) }
  await page.locator('[data-share-card]').scrollIntoViewIfNeeded()
  await shots.shot('share-card-viewport', { fullPage: false })
  await shots.shot('share-card', { locator: page.locator('[data-share-card]') })
  const cardDlP = page.waitForEvent('download', { timeout: 15_000 }).then((d) => ({ suggested: d.suggestedFilename() })).catch((e: Error) => ({ error: e.message.split('\n')[0] }))
  const tPng = Date.now()
  await pngButton.tap()
  facts['share-card-download'] = { ...(await cardDlP), ms: Date.now() - tPng }
  // The notes card and the results-talk helper after the save, as the thumb reaches them.
  const working = page.locator('[data-slot="working-with-ai"]')
  if (await working.isVisible().catch(() => false)) {
    await working.scrollIntoViewIfNeeded()
    await shots.shot('working-with-ai-viewport', { fullPage: false })
  }
  // Leaving: the guard.
  await button(page, 'Back to the start').scrollIntoViewIfNeeded()
  await button(page, 'Back to the start').tap()
  await expect(page.getByRole('heading', { level: 2, name: /Leave|leave/ })).toBeVisible().catch(() => undefined)
  facts['leave'] = await screenFacts(page)
  await shots.shot('leave', { fullPage: false })

  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[phone] results ${project}: blob=${JSON.stringify(facts['blob']).slice(0, 400)} download=${JSON.stringify(facts['download'])} share=${JSON.stringify(facts['share-api']).slice(0, 200)} card=${JSON.stringify(facts['share-card-download'])}`)
})

// ------------------------------------------------------------------------------------------ 5. performance on mobile data (pixel)

test('phone: perf', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'pixel', 'CDP throttling needs Chromium')
  const project = testInfo.project.name
  const log = trackConsole(page)
  const shots = new Shots(page, RUN, `perf-${project}`)
  const facts: Record<string, unknown> = {}

  // The build's assets, by size.
  const dist = path.join(WEB_ROOT, process.env.UX_DIST ?? 'test-results/ux-review/_dist', 'assets')
  facts['assets'] = readdirSync(dist)
    .map((f) => ({ file: f, bytes: statSync(path.join(dist, f)).size }))
    .sort((a, b) => b.bytes - a.bytes)

  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })

  const tNav = Date.now()
  await page.goto('./?fast=1', { waitUntil: 'commit' })
  await expect(h1(page)).toHaveText('HumanBench', { timeout: 60_000 })
  const msToH1 = Date.now() - tNav
  await expect(button(page, 'Start')).toBeEnabled({ timeout: 60_000 })
  const msToStart = Date.now() - tNav
  await page.waitForLoadState('load', { timeout: 60_000 }).catch(() => undefined)
  facts['welcome'] = {
    msToH1,
    msToStartEnabled: msToStart,
    paint: await page.evaluate<unknown>(`performance.getEntriesByType('paint').map((e) => ({ name: e.name, ms: Math.round(e.startTime) }))`),
    navigation: await page.evaluate<unknown>(`(() => { const n = performance.getEntriesByType('navigation')[0]; return n ? { domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), transferSize: n.transferSize } : null })()`),
    resources: await page.evaluate<unknown>(`performance.getEntriesByType('resource').map((r) => ({ name: r.name.split('/').pop(), type: r.initiatorType, bytes: r.transferSize, decoded: r.decodedBodySize, ms: Math.round(r.responseEnd) })).sort((a, b) => b.decoded - a.decoded)`),
    threeLoadedAtWelcome: await page.evaluate<boolean>(`performance.getEntriesByType('resource').some((r) => /three-view/.test(r.name))`),
    modulepreload: await page.evaluate<string[]>(`[...document.querySelectorAll('link[rel=modulepreload], link[rel=preload], script[src]')].map((l) => (l.href || l.src || '').split('/').pop())`),
  }
  await shots.shot('welcome', { fullPage: false })
  shots.json('facts-welcome', facts)

  // Through the start screens to Ready, then Begin to the first part, timed.
  const driver = touchDriver(page)
  await driver.press(button(page, 'Start'))
  await driver.tick(page.getByRole('checkbox', { name: /18 or older/ }))
  await driver.press(button(page, 'Continue'))
  await driver.tick(page.getByRole('checkbox', { name: /honour code/ }))
  await driver.press(button(page, 'Continue'))
  const tDev = Date.now()
  await expect(button(page, 'Continue')).toBeEnabled({ timeout: 40_000 })
  facts['device-check-ms'] = Date.now() - tDev
  facts['device-facts'] = await page.locator('dl.facts').innerText().catch(() => '')
  await driver.press(button(page, 'Continue'))
  await expect(h1(page)).toHaveText('Ready when you are')
  const tBegin = Date.now()
  await button(page, 'Begin').tap()
  await expect(h1(page)).toHaveText('Up next: Reaction time', { timeout: 60_000 })
  const msToInterstitial = Date.now() - tBegin
  const tStart = Date.now()
  await button(page, 'Start').tap()
  await expect(button(page, 'Start practice')).toBeVisible({ timeout: 60_000 })
  facts['begin'] = { msBeginToInterstitial: msToInterstitial, msStartToRtIntro: Date.now() - tStart, resourcesSince: await page.evaluate<unknown>(`performance.getEntriesByType('resource').filter((r) => r.startTime > 0).map((r) => ({ name: r.name.split('/').pop(), decoded: r.decodedBodySize, start: Math.round(r.startTime), end: Math.round(r.responseEnd) })).slice(-10)`) }
  shots.json('facts-partial', facts)
  // Skip to Spatial and time the figures (Three.js arrives over the slow link).
  await skipFromBlock(page)
  await expect(h1(page)).toHaveText('Up next: Matrix & Series')
  await driver.skipPart()
  await expect(h1(page)).toHaveText('Up next: Spatial')
  const tSp = Date.now()
  await button(page, 'Start').tap()
  await expect(page.locator('form.choice').or(page.locator('.unavailable'))).toBeVisible({ timeout: 90_000 })
  const msDom = Date.now() - tSp
  // What the person sees while the figures (Three.js, over the slow link) are still on their way.
  await page.waitForTimeout(800)
  await shots.shot('spatial-waiting', { fullPage: false })
  facts['spatial-waiting-text'] = await page.locator('div.rotation').innerText().then((t) => t.slice(0, 400)).catch(() => '')
  await page.waitForFunction(`performance.getEntriesByType('resource').some((r) => /three-view/.test(r.name)) || document.querySelector('.unavailable') !== null`, undefined, { timeout: 90_000 }).catch(() => undefined)
  const msChunk = Date.now() - tSp
  await page.waitForFunction(`document.querySelectorAll('div.rotation canvas').length >= 5 || document.querySelector('.unavailable') !== null`, undefined, { timeout: 30_000 }).catch(() => undefined)
  const msCanvases = Date.now() - tSp
  facts['spatial'] = { msStartToDom: msDom, msStartToThreeChunk: msChunk, msStartToCanvases: msCanvases, canvases: await page.locator('div.rotation canvas').count(), three: await page.evaluate<unknown>(`performance.getEntriesByType('resource').filter((r) => /three-view/.test(r.name)).map((r) => ({ bytes: r.transferSize, decoded: r.decodedBodySize, start: Math.round(r.startTime), end: Math.round(r.responseEnd), ms: Math.round(r.duration) }))`), status: await page.locator('div.rotation').innerText().then((t) => t.slice(0, 300)).catch(() => '') }
  await shots.shot('spatial', { fullPage: false })
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[phone] perf: welcome=${JSON.stringify(facts['welcome']).slice(0, 300)} begin=${JSON.stringify(facts['begin']).slice(0, 200)} spatial=${JSON.stringify(facts['spatial']).slice(0, 300)}`)
})

// ------------------------------------------------------------------------------------------ 6. follow-ups (second pass)

interface Landing {
  readonly h1: string
  readonly h1Top: number | null
  readonly scrollY: number
  readonly maxScrollY: number
  readonly innerHeight: number
  readonly scrollHeight: number
  /** The first renderer root (the item, the block): its top in viewport coordinates, and whether that top is on screen. */
  readonly stageTop: number | null
  readonly stageInView: boolean
  /** The question text of an item (matrix stem, series prompt, block instructions), if any. */
  readonly stemTop: number | null
  readonly stemInView: boolean
  readonly activeElement: string
}

const LANDING = `(() => {
  const describe = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : '')
  const top = (el) => (el ? Math.round(el.getBoundingClientRect().top) : null)
  const h1 = document.querySelector('h1')
  const stage = document.querySelector('form.choice, form.entry, section.hb-render.rt, section.hb-render.span, section.hb-render.corsi, section.hb-render.coding, section.hb-render.reading, div.rotation')
  const stem = document.querySelector('p.stem, p.prompt, .hb-instructions, .rotation .question, form.entry label')
  const inView = (t) => t !== null && t >= 0 && t < window.innerHeight
  const a = document.activeElement
  return {
    h1: h1 ? h1.textContent.trim() : '',
    h1Top: top(h1),
    scrollY: Math.round(window.scrollY),
    maxScrollY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
    innerHeight: window.innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
    stageTop: top(stage),
    stageInView: inView(top(stage)),
    stemTop: top(stem),
    stemInView: inView(top(stem)),
    activeElement: a ? describe(a) : '',
  }
})()`

/** Where a new screen lands: at once, and again 600 ms later (focus moves and lazy figures can shift it), with a viewport shot. */
async function landing(page: Page, shots: Shots, name: string, settleMs = 600): Promise<Record<string, unknown>> {
  const at0 = await page.evaluate<Landing>(LANDING)
  await page.waitForTimeout(settleMs)
  const later = await page.evaluate<Landing>(LANDING)
  const shot = await shots.shot(`${name}-viewport`, { fullPage: false })
  return { at0, [`at${settleMs}`]: later, shot }
}

/** Answer the item on screen by thumb (scrolling down to the button as a person does) and rate the confidence; stop on the next screen. */
async function answerByThumb(page: Page): Promise<string> {
  const choice = page.locator('form.choice')
  const entry = page.locator('form.entry')
  let kind: string
  if ((await choice.count()) > 0) {
    kind = 'choice'
    await press(choice.getByRole('radio').first())
    await scrollThenPress(page, button(page, 'Confirm'))
  } else {
    kind = 'entry'
    const box = entry.locator('input[type=text]')
    await box.fill((await box.evaluate((el) => el.classList.contains('letter'))) ? 'A' : '1')
    await scrollThenPress(page, entry.getByRole('button', { name: 'Submit', exact: true }))
  }
  await expect(page.getByRole('slider')).toBeVisible()
  await scrollThenPress(page, button(page, 'Continue'))
  await expect(page.getByRole('slider')).toHaveCount(0)
  return kind
}

/**
 * Where each new screen opens on a phone. A thumb scrolls down to the button at the bottom, taps, and the next screen
 * replaces the page: does it open at its top (heading and question in view), or where the thumb left the scroll?
 * Both ways are measured: with the page scrolled to the bottom before the tap, and with it at the top.
 */
test('phone: scroll on screen change', async ({ page }, testInfo) => {
  const project = testInfo.project.name
  TOUCH = testInfo.project.use.hasTouch === true
  const log = trackConsole(page)
  const shots = new Shots(page, RUN, `scroll-${project}`)
  const facts: Record<string, unknown> = {}
  const driver = new SessionDriver(page, { touch: TOUCH })

  await driver.toReady('./?fast=1')
  // A. From the top of the ready screen (Begin is in the first viewport): the first interstitial.
  await page.evaluate('window.scrollTo(0, 0)')
  await press(button(page, 'Begin'))
  await expect(h1(page)).toHaveText('Up next: Reaction time')
  facts['A-interstitial-from-top'] = await landing(page, shots, 'a-interstitial')

  // B. Scrolled to the bottom of the interstitial, tap Start: the reaction-time intro.
  await scrollThenPress(page, button(page, 'Start'))
  await expect(h1(page)).toHaveText('Reaction time')
  facts['B-rt-intro-from-bottom'] = await landing(page, shots, 'b-rt-intro')

  // C. Skip the part from the header; the next interstitial, then Start from the top of the page: the first item.
  await skipFromBlock(page)
  await expect(h1(page)).toHaveText('Up next: Matrix & Series')
  facts['C-interstitial-after-skip'] = await landing(page, shots, 'c-interstitial', 300)
  await page.evaluate('window.scrollTo(0, 0)')
  await press(button(page, 'Start'))
  await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
  facts['C-item1-from-top'] = await landing(page, shots, 'c-item1')

  // D. Answer, rate, Continue (all at the bottom): the second and third items, which replace the first inside the same screen.
  facts['D-item1-kind'] = await answerByThumb(page)
  await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
  facts['D-item2-after-continue'] = await landing(page, shots, 'd-item2')
  facts['D-item2-kind'] = await answerByThumb(page)
  await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
  facts['D-item3-after-continue'] = await landing(page, shots, 'd-item3')

  // E. Scrolled to the bottom of the next interstitial, tap Start: the Spatial item (figures arrive after the page).
  await skipFromBlock(page)
  await expect(h1(page)).toHaveText('Up next: Spatial')
  await scrollThenPress(page, button(page, 'Start'))
  await expect(page.locator('form.choice').or(page.locator('.unavailable'))).toBeVisible({ timeout: 60_000 })
  facts['E-spatial-from-bottom'] = await landing(page, shots, 'e-spatial', 1500)

  // F. The same interstitial-to-block step from the top of the page, for the Working Memory intro.
  await skipFromBlock(page)
  await expect(h1(page)).toHaveText('Up next: Working Memory')
  await page.evaluate('window.scrollTo(0, 0)')
  await press(button(page, 'Start'))
  await expect(page.locator('section.hb-render.span')).toBeVisible()
  facts['F-memory-intro-from-top'] = await landing(page, shots, 'f-memory-intro', 300)
  // G. And from the bottom of that intro into the digit entry (the block's Start button, then the stage).
  await scrollThenPress(page, page.locator('section.hb-render.span').getByRole('button', { name: 'Start' }))
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 30_000 })
  facts['G-memory-entry-from-bottom'] = await landing(page, shots, 'g-memory-entry', 300)

  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[phone] scroll ${project}: ${JSON.stringify(facts).slice(0, 1500)}`)
  TOUCH = true
})

/** The four-position reaction block by finger: pad sizes and gaps at this width, and what a trial looks like. */
test('phone: rt choice4', async ({ page }, testInfo) => {
  const project = testInfo.project.name
  const log = trackConsole(page)
  const shots = new Shots(page, RUN, `rt4-${project}`)
  const facts: Record<string, unknown> = {}
  const driver = touchDriver(page)
  await driver.toReady('./?fast=1')
  await driver.begin()
  await driver.press(button(page, 'Start'))
  await expect(h1(page)).toHaveText('Reaction time')
  const rt = page.locator('section.hb-render.rt')
  const title = rt.locator('p.title').first()
  for (let block = 0; block < 3; block++) {
    const t = ((await title.textContent({ timeout: 20_000 })) ?? '').trim()
    facts[`block-${block}-title`] = t
    if (/four positions/.test(t)) break
    await driver.step() // plays the whole block
    await expect(rt).toBeVisible({ timeout: 20_000 })
  }
  await expect(title).toHaveText(/four positions/)
  facts['intro'] = await page.evaluate<Landing>(LANDING)
  facts['intro-text'] = await rt.locator('.hb-instructions').innerText().catch(() => '')
  await shots.shot('choice4-intro-viewport', { fullPage: false })
  await scrollThenPress(page, rt.getByRole('button', { name: 'Start practice' }))
  await expect(page.locator('.rt .stage.choice4')).toBeVisible()
  const pads = await rectsOf(page, 'section.hb-render.rt button.pad')
  facts['pads'] = { pads, gap: minEdgeGap(pads), under44: pads.filter((p) => Math.min(p.w, p.h) < THUMB).length, stage: (await rectsOf(page, '.rt .stage'))[0], landing: await page.evaluate<Landing>(LANDING) }
  facts['pads-metrics'] = await pageMetrics(page, { touch: true })
  await page.waitForFunction(`!!document.querySelector('section.hb-render.rt .pad.on')`, undefined, { polling: 'raf', timeout: 8000 }).catch(() => undefined)
  await shots.shot('choice4-trial-viewport', { fullPage: false })
  await shots.all('choice4-trial')
  await skipFromBlock(page)
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[phone] rt4 ${project}: ${JSON.stringify(facts['pads']).slice(0, 600)}`)
})

/** The coding block: can the key (legend), the symbol and the keypad be on screen together at this height, and are they when the block starts? */
test('phone: coding fit', async ({ page }, testInfo) => {
  const project = testInfo.project.name
  const log = trackConsole(page)
  const shots = new Shots(page, RUN, `coding-fit-${project}`)
  const facts: Record<string, unknown> = {}
  await openRoute(page, routeOf('coding-intro'))
  facts['intro'] = await page.evaluate<Landing>(LANDING)
  const coding = page.locator('section.hb-render.coding')
  await scrollThenPress(page, coding.getByRole('button', { name: 'Start' }))
  await expect(page.getByRole('timer')).toBeVisible()
  await page.waitForTimeout(200)
  const layout = await page.evaluate<Record<string, unknown>>(`(() => {
    const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top + scrollY), bottom: Math.round(b.bottom + scrollY), h: Math.round(b.height), w: Math.round(b.width) } }
    const legend = r('section.hb-render.coding .legend'), stage = r('section.hb-render.coding .stage'), keypad = r('section.hb-render.coding [role=group]'), timer = r('section.hb-render.coding .timer'), title = r('section.hb-render.coding .title')
    const span = legend && keypad ? keypad.bottom - legend.top : null
    const y = Math.round(scrollY)
    const shows = (box) => box !== null && box.top >= y && box.bottom <= y + innerHeight
    return { title, legend, timer, stage, keypad, span, innerHeight, fits: span !== null && span <= innerHeight, scrollY: y, maxScrollY: Math.max(0, document.documentElement.scrollHeight - innerHeight), legendShown: shows(legend), stageShown: shows(stage), keypadShown: shows(keypad), legendCells: document.querySelectorAll('section.hb-render.coding .legend .cell').length, legendCellSize: (() => { const c = document.querySelector('section.hb-render.coding .legend .cell'); if (!c) return null; const b = c.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) } })() }
  })()`)
  facts['layout-at-start'] = layout
  await shots.shot('coding-start-viewport', { fullPage: false })
  const legend = layout['legend'] as { top: number } | null
  if (legend !== null) {
    await page.evaluate(`window.scrollTo(0, ${legend.top - 8})`)
    await page.waitForTimeout(150)
    facts['layout-legend-at-top'] = await page.evaluate<Record<string, unknown>>(`(() => { const y = Math.round(scrollY); const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) } }; const k = r('section.hb-render.coding [role=group]'); return { scrollY: y, keypad: k, keypadFullyVisible: k !== null && k.bottom <= innerHeight, innerHeight } })()`)
    await shots.shot('coding-legend-at-top-viewport', { fullPage: false })
  }
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[phone] coding fit ${project}: ${JSON.stringify(layout).slice(0, 800)}`)
})

/** The blob's labels as rendered on this phone (CSS px, not SVG units), their collisions, and the bar-view table's width. */
test('phone: blob labels', async ({ page }, testInfo) => {
  const project = testInfo.project.name
  const log = trackConsole(page)
  const shots = new Shots(page, RUN, `blob-${project}`)
  const facts: Record<string, unknown> = {}
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await toResults(page, 1)
  await expect(button(page, 'Download save file')).toBeVisible({ timeout: 30_000 })
  const blob = page.locator('svg.hb-blob').first()
  await expect(blob).toBeVisible()
  await blob.scrollIntoViewIfNeeded()
  facts['labels'] = await page.evaluate<Record<string, unknown>>(`(() => {
    const svg = document.querySelector('svg.hb-blob')
    const sb = svg.getBoundingClientRect()
    const vb = svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal : null
    const scale = vb && vb.width > 0 ? sb.width / vb.width : 1
    const items = [...svg.querySelectorAll('text')].map((t) => {
      const spans = [...t.querySelectorAll('tspan')]
      const parts = (spans.length ? spans : [t]).map((s) => { const r = s.getBoundingClientRect(); return { text: (s.textContent || '').trim().slice(0, 30), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), fontPx: Math.round(parseFloat(getComputedStyle(s).fontSize) * scale * 10) / 10, italic: getComputedStyle(s).fontStyle === 'italic' } })
      return parts
    }).flat().filter((p) => p.w > 0 && p.h > 0 && p.text !== '')
    const overlaps = []
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) { const a = items[i], b = items[j]; const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); if (ox > 1 && oy > 1) overlaps.push({ a: a.text, b: b.text, px: Math.min(ox, oy) }) }
    const sizes = items.map((p) => p.fontPx)
    return { svg: { w: Math.round(sb.width), h: Math.round(sb.height) }, viewBox: vb ? { w: Math.round(vb.width), h: Math.round(vb.height) } : null, scale: Math.round(scale * 1000) / 1000, labels: items.length, smallestFontPx: Math.min(...sizes), largestFontPx: Math.max(...sizes), italicFontPx: items.filter((p) => p.italic).map((p) => p.fontPx)[0] ?? null, overlaps, sample: items.slice(0, 40) }
  })()`)
  await shots.shot('blob', { locator: blob })
  await shots.shot('blob-viewport', { fullPage: false })
  // Bar view: the table as it renders at this width.
  await page.getByRole('button', { name: 'Bar view' }).tap()
  await expect(page.locator('table.hb-bars').first()).toBeVisible()
  await page.waitForTimeout(200)
  facts['table'] = await page.evaluate<Record<string, unknown>>(`(() => { const t = document.querySelector('table.hb-bars'); const wrap = t.parentElement; const ths = [...t.querySelectorAll('thead th')].map((th) => ({ text: th.textContent.trim(), w: Math.round(th.getBoundingClientRect().width) })); const firstCol = [...t.querySelectorAll('tbody th')].map((th) => ({ text: th.textContent.trim().slice(0, 40), w: Math.round(th.getBoundingClientRect().width), h: Math.round(th.getBoundingClientRect().height) })); return { scrollWidth: t.scrollWidth, clientWidth: t.clientWidth, tableRight: Math.round(t.getBoundingClientRect().right), innerWidth, wrapOverflowX: getComputedStyle(wrap).overflowX, wrapScrollable: wrap.scrollWidth > wrap.clientWidth, ths, firstCol: firstCol.slice(0, 16), fontPx: parseFloat(getComputedStyle(t).fontSize) } })()`)
  await page.locator('table.hb-bars').first().scrollIntoViewIfNeeded()
  await shots.shot('bars-viewport', { fullPage: false })
  facts['bars-metrics'] = await pageMetrics(page, { touch: true })
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[phone] blob ${project}: ${JSON.stringify(facts['labels']).slice(0, 700)} table=${JSON.stringify(facts['table']).slice(0, 500)}`)
})
