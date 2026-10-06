/// <reference lib="dom" />
/**
 * Verification package (run id `verify`), session area: the original scenarios of the session fix items (UX-001 to
 * UX-018a and the integration items UX-005b, UX-007b, UX-009b) re-run on the FIXED build, with after-screenshots and
 * measured numbers under web/test-results/ux-review/verify/<item id>/. One test per item (or pair); each is short.
 *
 *   UX_REUSE=1 UX_PORT=4653 UX_RUN=verify npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/verify-session.ux.ts --project=iphone --grep 'UX-001'
 */

import { expect, test, type Locator, type Page } from '@playwright/test'
import { button, h1, loadSave, simulatedSave, toReady, unloadIsGuarded } from '../../e2e/flow'
import { chordFor } from '../../e2e/keyboard'
import { useTextZoom } from '../../e2e/layout'
import { openRoute, PREVIEW_ROUTES, SEGMENT_TITLES, type Route } from '../../e2e/routes'
import { SessionDriver } from '../../e2e/session-driver'
import { pageMetrics, Shots, trackConsole } from '../lib'

const RUN = process.env.UX_RUN ?? 'verify'

test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 })

// ------------------------------------------------------------------------------------------------ helpers

function routeOf(id: string): Route {
  const r = PREVIEW_ROUTES.find((x) => x.id === id)
  if (r === undefined) throw new Error(`no route ${id}`)
  return r
}

async function open(page: Page, id: string): Promise<void> {
  const r = routeOf(id)
  await r.prepare?.(page)
  if (r.motion !== 'allow') await page.emulateMedia({ reducedMotion: 'reduce' })
  await openRoute(page, r)
}

/** Where a new screen landed: heading, scroll, the stage and the stem relative to the viewport, and focus. */
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
    h1InView: inView(top(h1)),
    scrollY: Math.round(window.scrollY),
    maxScrollY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    stageTop: top(stage),
    stageInView: inView(top(stage)),
    stemTop: top(stem),
    stemInView: inView(top(stem)),
    activeElement: a ? describe(a) : '',
    title: document.title,
  }
})()`

interface Landing {
  readonly h1: string
  readonly h1Top: number | null
  readonly h1InView: boolean
  readonly scrollY: number
  readonly maxScrollY: number
  readonly innerHeight: number
  readonly innerWidth: number
  readonly stageTop: number | null
  readonly stageInView: boolean
  readonly stemTop: number | null
  readonly stemInView: boolean
  readonly activeElement: string
  readonly title: string
}

const landing = (page: Page): Promise<Landing> => page.evaluate<Landing>(LANDING)

async function landed(page: Page, shots: Shots, name: string, settleMs = 600): Promise<Record<string, unknown>> {
  const at0 = await landing(page)
  await page.waitForTimeout(settleMs)
  const later = await landing(page)
  const shot = await shots.shot(`${name}-viewport`, { fullPage: false })
  return { at0, later, shot, ok: later.h1InView }
}

const what = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return 'nothing (body)'
    const label = el.getAttribute('aria-label') || ((el as HTMLInputElement).labels?.[0]?.textContent ?? '') || el.textContent || ''
    return `${el.tagName.toLowerCase()}${el.getAttribute('type') ? `[${el.getAttribute('type')}]` : ''} "${label.replace(/\s+/g, ' ').trim().slice(0, 60)}"${(el as HTMLButtonElement).disabled ? ' (disabled)' : ''}${el.getAttribute('aria-disabled') === 'true' ? ' (aria-disabled)' : ''}`
  })

interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

async function rectsOf(page: Page, selector: string): Promise<Rect[]> {
  return page.evaluate<Rect[]>(`[...document.querySelectorAll(${JSON.stringify(selector)})].map((el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left * 10) / 10, y: Math.round(b.top * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 } })`)
}

async function press(_page: Page, touch: boolean, target: Locator): Promise<void> {
  if (touch) await target.tap()
  else await target.click()
}

async function scrollThenPress(page: Page, touch: boolean, target: Locator): Promise<void> {
  await page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
  await page.waitForTimeout(100)
  await press(page, touch, target)
}

async function skipFromBlock(page: Page, touch: boolean): Promise<void> {
  await press(page, touch, page.locator('header.top .actions').getByRole('button', { name: /^Skip / }))
  await press(page, touch, page.locator('section.confirm').getByRole('button', { name: /^Skip / }))
  await expect(page.locator('section.confirm')).toHaveCount(0)
}

async function answerByThumb(page: Page, touch: boolean): Promise<string> {
  const choice = page.locator('form.choice')
  const entry = page.locator('form.entry')
  let kind: string
  if ((await choice.count()) > 0) {
    kind = 'choice'
    await press(page, touch, choice.getByRole('radio').first())
    await scrollThenPress(page, touch, button(page, 'Confirm'))
  } else {
    kind = 'entry'
    const box = entry.locator('input[type=text]')
    await box.fill((await box.evaluate((el) => el.classList.contains('letter'))) ? 'A' : '1')
    await scrollThenPress(page, touch, entry.getByRole('button', { name: 'Submit', exact: true }))
  }
  await expect(page.getByRole('slider')).toBeVisible()
  await scrollThenPress(page, touch, button(page, 'Continue'))
  await expect(page.getByRole('slider')).toHaveCount(0)
  return kind
}

const bodyText = (page: Page): Promise<string> => page.locator('body').innerText()

// ------------------------------------------------------------------------------------------------ UX-001

test('verify UX-001 new screens open at their heading on a phone', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  test.skip(!touch, 'phone only')
  const shots = new Shots(page, RUN, `UX-001/${testInfo.project.name}`)
  const log = trackConsole(page)
  const facts: Record<string, unknown> = { project: testInfo.project.name, viewport: page.viewportSize() }
  for (const vp of [page.viewportSize() ?? { width: 390, height: 664 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(vp)
    const key = `${vp.width}x${vp.height}`
    const driver = new SessionDriver(page, { touch })
    await page.goto('./favicon.svg')
    await page.evaluate('localStorage.clear(); sessionStorage.clear()')
    await driver.toReady('./?fast=1')
    await page.evaluate('window.scrollTo(0, 0)')
    await press(page, touch, button(page, 'Begin'))
    await expect(h1(page)).toHaveText('Up next: Reaction time')
    facts[`${key} A interstitial from top`] = await landed(page, shots, `${key}-a-interstitial`)
    await scrollThenPress(page, touch, button(page, 'Start'))
    await expect(h1(page)).toHaveText('Reaction time')
    facts[`${key} B rt intro from bottom`] = await landed(page, shots, `${key}-b-rt-intro`)
    await skipFromBlock(page, touch)
    await expect(h1(page)).toHaveText('Up next: Matrix & Series')
    facts[`${key} C interstitial after skip`] = await landed(page, shots, `${key}-c-interstitial`, 300)
    await page.evaluate('window.scrollTo(0, 0)')
    await press(page, touch, button(page, 'Start'))
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    facts[`${key} C item1 from top`] = await landed(page, shots, `${key}-c-item1`)
    await answerByThumb(page, touch)
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    facts[`${key} D item2 after Continue at bottom`] = await landed(page, shots, `${key}-d-item2`)
    await answerByThumb(page, touch)
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    facts[`${key} D item3 after Continue at bottom`] = await landed(page, shots, `${key}-d-item3`)
    await skipFromBlock(page, touch)
    await expect(h1(page)).toHaveText('Up next: Spatial')
    await scrollThenPress(page, touch, button(page, 'Start'))
    await expect(page.locator('form.choice').or(page.locator('.unavailable'))).toBeVisible({ timeout: 60_000 })
    facts[`${key} E spatial from bottom`] = await landed(page, shots, `${key}-e-spatial`, 1500)
    await skipFromBlock(page, touch)
    await expect(h1(page)).toHaveText('Up next: Working Memory')
    await page.evaluate('window.scrollTo(0, 0)')
    await press(page, touch, button(page, 'Start'))
    await expect(page.locator('section.hb-render.span')).toBeVisible()
    facts[`${key} F memory intro from top`] = await landed(page, shots, `${key}-f-memory-intro`, 300)
    await scrollThenPress(page, touch, page.locator('section.hb-render.span').getByRole('button', { name: 'Start' }))
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 30_000 })
    facts[`${key} G memory entry from bottom`] = await landed(page, shots, `${key}-g-memory-entry`, 300)
  }
  const landings = Object.entries(facts).filter(([, v]) => typeof v === 'object' && v !== null && 'ok' in (v as object))
  facts.summary = { landings: landings.length, h1OutOfView: landings.filter(([, v]) => (v as { ok: boolean }).ok === false).map(([k]) => k) }
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[verify UX-001] ${JSON.stringify(facts.summary)}`)
})

// ------------------------------------------------------------------------------------------------ UX-002 (render, phone fit of timed blocks)

test('verify UX-002 timed blocks start with their stage on screen', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-002/${testInfo.project.name}`)
  const log = trackConsole(page)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  const viewports = touch ? [page.viewportSize() ?? { width: 390, height: 664 }, { width: 320, height: 568 }] : [{ width: 320, height: 568 }, { width: 1280, height: 800 }]
  for (const vp of viewports) {
    await page.setViewportSize(vp)
    const key = `${vp.width}x${vp.height}`
    await page.goto('./favicon.svg')
    await page.evaluate('localStorage.clear(); sessionStorage.clear()')
    // Coding: the table of shapes, the target and the keypad when the clock starts.
    await open(page, 'coding-intro')
    const coding = page.locator('section.hb-render.coding')
    await scrollThenPress(page, touch, coding.getByRole('button', { name: 'Start' }))
    await expect(page.getByRole('timer')).toBeVisible()
    await page.waitForTimeout(250)
    facts[`${key} coding`] = await page.evaluate<Record<string, unknown>>(`(() => {
      const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), w: Math.round(b.width) } }
      const legend = r('section.hb-render.coding .legend'), stage = r('section.hb-render.coding .stage'), keypad = r('section.hb-render.coding [role=group][aria-label*="keypad" i], section.hb-render.coding .keypad'), timer = r('section.hb-render.coding .timer')
      const shows = (b) => b !== null && b.top >= 0 && b.bottom <= innerHeight
      const cell = document.querySelector('section.hb-render.coding .legend .cell')
      const key = document.querySelector('section.hb-render.coding [role=group] button')
      const cs = (el) => el ? { border: getComputedStyle(el).borderTopWidth + ' ' + getComputedStyle(el).borderTopStyle, bg: getComputedStyle(el).backgroundColor, radius: getComputedStyle(el).borderTopLeftRadius } : null
      const keys = [...document.querySelectorAll('section.hb-render.coding [role=group] button')].map((b) => { const k = b.getBoundingClientRect(); return { w: Math.round(k.width), h: Math.round(k.height) } })
      return { innerHeight, scrollY: Math.round(scrollY), legend, timer, stage, keypad, span: legend && keypad ? keypad.bottom - legend.top : null, legendShown: shows(legend), stageShown: shows(stage), keypadShown: shows(keypad), allShown: shows(legend) && shows(stage) && shows(keypad), legendCellStyle: cs(cell), keyStyle: cs(key), keys, keyRows: new Set(keys.map((k) => k.h)).size, smallestKey: Math.min(...keys.map((k) => Math.min(k.w, k.h))), activeElement: document.activeElement ? document.activeElement.className : '' }
    })()`)
    await shots.shot(`${key}-coding-start-viewport`, { fullPage: false })
    // Digit span: the stage after Start from the bottom of the intro.
    await page.goto('./favicon.svg')
    await page.evaluate('localStorage.clear(); sessionStorage.clear()')
    await open(page, 'memory-intro')
    await scrollThenPress(page, touch, page.locator('section.hb-render.span').getByRole('button', { name: 'Start' }))
    await page.waitForTimeout(300)
    facts[`${key} span after Start`] = { ...(await landing(page)), stageRect: (await rectsOf(page, 'section.hb-render.span .stage'))[0] ?? null, shot: await shots.shot(`${key}-span-start-viewport`, { fullPage: false }) }
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 30_000 })
    facts[`${key} span entry`] = { ...(await landing(page)), keypad: (await rectsOf(page, 'section.hb-render.span [role=group]'))[0] ?? null, done: (await rectsOf(page, 'section.hb-render.span button.hb-primary'))[0] ?? null, shot: await shots.shot(`${key}-span-entry-viewport`, { fullPage: false }) }
    // Reaction time: the stage after Start practice from the bottom of the intro.
    await page.goto('./favicon.svg')
    await page.evaluate('localStorage.clear(); sessionStorage.clear()')
    await open(page, 'rt-intro')
    await scrollThenPress(page, touch, button(page, 'Start practice'))
    await expect(page.locator('.rt .stage')).toBeVisible()
    await page.waitForTimeout(300)
    facts[`${key} rt after Start practice`] = { ...(await landing(page)), stageRect: (await rectsOf(page, '.rt .stage'))[0] ?? null, pads: await rectsOf(page, '.rt button.pad, .rt .pad'), shot: await shots.shot(`${key}-rt-stage-viewport`, { fullPage: false }) }
  }
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[verify UX-002] ${JSON.stringify(facts).slice(0, 1200)}`)
})

// ------------------------------------------------------------------------------------------------ UX-003

test('verify UX-003 header height and notice lifetime', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-003/${testInfo.project.name}`)
  const log = trackConsole(page)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  if (!touch) await page.setViewportSize({ width: 320, height: 568 })
  const driver = new SessionDriver(page, { touch })
  await driver.toReady('./?fast=1')
  await driver.begin()
  const header = async (label: string): Promise<Record<string, unknown>> => {
    const r = await page.evaluate<Record<string, unknown>>(`(() => {
      const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top + scrollY), bottom: Math.round(b.bottom + scrollY), h: Math.round(b.height), w: Math.round(b.width) } }
      const status = document.querySelector('header.top .status')
      const cs = status ? getComputedStyle(status) : null
      const buttons = [...document.querySelectorAll('header.top .actions button')].map((b) => ({ name: b.getAttribute('aria-label') || b.textContent.trim(), shown: (b.innerText || '').trim(), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) }))
      return { header: r('header.top'), bar: r('header.top .bar'), ring: r('.ring'), h1: r('h1'), buttons, notice: status ? status.textContent.trim() : null, noticeColor: cs ? cs.color : null, noticeDisplayHeight: status ? Math.round(status.getBoundingClientRect().height) : null, noticeCalm: status ? status.classList.contains('calm') : null, innerHeight, innerWidth, headerShareOfViewport: (() => { const h = r('header.top'); return h ? Math.round((h.h / innerHeight) * 100) : null })() }
    })()`)
    const shot = await shots.shot(`${label}-viewport`, { fullPage: false })
    return { ...r, shot }
  }
  facts['1 interstitial RT'] = await header('1-interstitial-rt')
  await driver.skipPart()
  await expect(h1(page)).toHaveText('Up next: Matrix & Series')
  facts['2 interstitial Matrix after skipping RT (notice raised here)'] = await header('2-interstitial-matrix')
  await driver.press(button(page, 'Start'))
  await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
  facts['3 first item (next screen: notice may still show)'] = await header('3-item-1')
  await driver.step()
  await driver.step()
  await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
  facts['4 second item (two screen changes later: notice must be gone)'] = await header('4-item-2')
  await skipFromBlock(page, touch)
  await expect(h1(page)).toHaveText('Up next: Spatial')
  facts['5 interstitial Spatial after skipping Matrix from the block'] = await header('5-interstitial-spatial')
  await driver.skipPart()
  await expect(h1(page)).toHaveText('Up next: Working Memory')
  facts['6 interstitial WM after skipping Spatial'] = await header('6-interstitial-wm')
  await driver.press(button(page, 'Start'))
  await expect(page.locator('section.hb-render.span')).toBeVisible()
  facts['7 memory intro'] = await header('7-memory-intro')
  const entries = Object.values(facts).filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null && 'header' in v)
  facts.summary = { maxHeaderHeight: Math.max(...entries.map((e) => ((e.header as { h: number } | null)?.h ?? 0))), noticeSequence: entries.map((e) => e.notice) }
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[verify UX-003] ${JSON.stringify(facts.summary)}`)
})

// ------------------------------------------------------------------------------------------------ UX-004

test('verify UX-004 practice: focus, announcement, stop', async ({ page, browserName }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch === true, 'a touch phone has no Tab key')
  const chord = await chordFor(page, browserName)
  const shots = new Shots(page, RUN, `UX-004/${testInfo.project.name}`)
  const log = trackConsole(page)
  const facts: Record<string, unknown> = { project: testInfo.project.name, chord }
  await toReady(page)
  const tabUntil = async (target: Locator, max = 40): Promise<number> => {
    const has = (): Promise<boolean> => target.first().evaluate((el) => el === document.activeElement, undefined, { timeout: 1500 }).catch(() => false)
    if (await has()) return 0
    for (let i = 1; i <= max; i++) {
      await page.keyboard.press(chord)
      if (await has()) return i
    }
    return -1
  }
  await tabUntil(button(page, 'Try practice questions first'))
  await page.keyboard.press('Enter')
  await expect(h1(page)).toHaveText('Practice')
  await page.waitForTimeout(300)
  facts['Q1 arrival focus'] = await what(page)
  facts['Q1 buttons'] = await page.locator('main button, .hb-screen button').allInnerTexts()
  facts['Q1 has Back button'] = (await page.getByRole('button', { name: 'Back', exact: true }).count()) > 0
  facts['Q1 has Stop practice'] = (await page.getByRole('button', { name: 'Stop practice' }).count()) > 0
  const field = page.locator('form.choice input[type=radio], form.entry input[type=text]').first()
  facts['Q1 tabs from arrival to the field'] = await tabUntil(field)
  await shots.shot('q1-field-focused', { fullPage: false })
  const answer = async (): Promise<void> => {
    if ((await page.locator('form.choice').count()) > 0) {
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('Enter')
    } else {
      await page.keyboard.type('1')
      await page.keyboard.press('Enter')
      if (!(await page.getByRole('slider').isVisible({ timeout: 1500 }).catch(() => false))) {
        await page.keyboard.press('ControlOrMeta+A')
        await page.keyboard.type('A')
        await page.keyboard.press('Enter')
      }
    }
    await expect(page.getByRole('slider')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page.locator('section.feedback')).toBeVisible()
    await page.waitForTimeout(250)
  }
  await answer()
  facts['Q1 feedback focus'] = await what(page)
  facts['Q1 feedback focus is section.feedback'] = await page.evaluate(() => document.activeElement?.classList.contains('feedback') ?? false)
  facts['Q1 feedback live region'] = await page.evaluate(() => [...document.querySelectorAll('[role=status], [aria-live]')].map((el) => ({ sel: el.className, role: el.getAttribute('role'), live: el.getAttribute('aria-live'), text: (el.textContent ?? '').trim().slice(0, 100) })).filter((x) => /correct/i.test(x.text)))
  facts['Q1 feedback visible text'] = (await page.locator('section.feedback').innerText()).slice(0, 200)
  await shots.all('q1-feedback')
  await page.keyboard.press(chord)
  facts['Q1 Tab from feedback'] = await what(page)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  facts['Q2 arrival (after Enter on Next) focus'] = await what(page)
  facts['Q2 arrival counter'] = await page.locator('p.muted', { hasText: /Practice question/ }).first().innerText().catch(() => '')
  facts['Q2 h1'] = (await h1(page).innerText()).trim()
  await shots.shot('q2-arrival', { fullPage: false })
  facts['Q2 tabs from arrival to the field'] = await tabUntil(field)
  await shots.shot('q2-first-field', { fullPage: false })
  // Stop practice: one press back to Ready.
  await tabUntil(page.getByRole('button', { name: 'Stop practice' }))
  facts['Stop practice reached by Tab'] = await what(page)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  facts['after Stop practice h1'] = (await h1(page).innerText()).trim()
  facts['after Stop practice focus'] = await what(page)
  await shots.shot('after-stop-practice', { fullPage: false })
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[verify UX-004] ${JSON.stringify(facts)}`)
})

// ------------------------------------------------------------------------------------------------ UX-005a / UX-005b

test('verify UX-005a confirm panels: Keep going, Escape, double tap', async ({ page, browserName }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-005a/${testInfo.project.name}`)
  const log = trackConsole(page)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  const driver = new SessionDriver(page, { touch })
  if (!touch) {
    const chord = await chordFor(page, browserName)
    await driver.toReady('./?fast=1')
    await driver.begin()
    for (let i = 0; i < 3; i++) await driver.skipPart()
    await driver.press(button(page, 'Start'))
    const span = page.locator('section.hb-render.span')
    await span.getByRole('button', { name: 'Start' }).click()
    await page.waitForFunction(`/^Enter \\d+ digits/.test(((document.querySelector('section.hb-render.span .hb-status') || {}).textContent) || '')`, undefined, { polling: 'raf', timeout: 20_000 })
    await page.waitForTimeout(200)
    const slots = (): Promise<string> => span.locator('ol.slots').evaluate((ol) => `${ol.getAttribute('aria-label')}`).catch(() => '(no entry list)')
    facts['entry begins focus'] = await what(page)
    await page.keyboard.type('12')
    facts['typed 1 2'] = await slots()
    const opener = page.locator('.actions').getByRole('button', { name: /^Skip / })
    await opener.focus()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(250)
    facts['panel open focus'] = await what(page)
    facts['panel width'] = (await rectsOf(page, 'section.confirm'))[0] ?? null
    facts['panel h2 margin-top'] = await page.locator('section.confirm h2').evaluate((el) => getComputedStyle(el).marginTop)
    await shots.shot('span-skip-panel', { fullPage: false })
    // Escape = Keep going
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
    facts['after Escape panel open'] = (await page.locator('section.confirm').count()) > 0
    facts['after Escape focus'] = await what(page)
    await page.keyboard.type('3')
    facts['typed 3 after Escape'] = await slots()
    // Keep going by button
    await opener.focus()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(250)
    await page.locator('section.confirm').getByRole('button', { name: 'Keep going' }).focus()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(250)
    facts['after Keep going focus'] = await what(page)
    await page.keyboard.type('4')
    facts['typed 4 after Keep going'] = await slots()
    await shots.shot('span-after-keep-going', { fullPage: false })
    facts['panel open after typing'] = (await page.locator('section.confirm').count()) > 0
    // Finish panel: Escape
    await button(page, 'Finish early').focus()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(250)
    facts['finish panel open'] = (await page.locator('section.confirm').count()) > 0
    await page.keyboard.press('Escape')
    await page.waitForTimeout(250)
    facts['finish panel after Escape open'] = (await page.locator('section.confirm').count()) > 0
    facts['finish focus after Escape'] = await what(page)
    facts.chord = chord
  } else {
    await driver.toReady('./?fast=1')
    await driver.begin()
    await driver.skipPart()
    await driver.press(button(page, 'Start'))
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    const centre = async (l: Locator): Promise<{ x: number; y: number }> => {
      await l.scrollIntoViewIfNeeded()
      const b = await l.boundingBox()
      if (b === null) throw new Error('no box')
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    }
    const c = await centre(button(page, 'Finish early'))
    await page.touchscreen.tap(c.x, c.y)
    await page.waitForTimeout(60)
    await page.touchscreen.tap(c.x, c.y)
    await page.waitForTimeout(400)
    facts['Finish early double tap: panel open'] = (await page.getByText('Finish now?').count()) > 0
    await shots.shot('finish-early-double-tap', { fullPage: false })
    if ((await page.locator('section.confirm').count()) > 0) {
      // A double tap on Keep going: the second tap must not land on the item underneath.
      const k = await centre(page.locator('section.confirm').getByRole('button', { name: 'Keep going' }))
      await page.touchscreen.tap(k.x, k.y)
      await page.waitForTimeout(60)
      await page.touchscreen.tap(k.x, k.y)
      await page.waitForTimeout(400)
      facts['Keep going double tap: panel open'] = (await page.locator('section.confirm').count()) > 0
      facts['Keep going double tap: radio checked underneath'] = await page.locator('form.choice input[type=radio]:checked').count()
    }
  }
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[verify UX-005a] ${JSON.stringify(facts)}`)
})

test('verify UX-005b leave panel: Stay and save first and primary', async ({ page, browserName }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch === true, 'a touch phone has no Tab key')
  const chord = await chordFor(page, browserName)
  const shots = new Shots(page, RUN, `UX-005b/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page, 'results')
  await button(page, 'Back to the start').click()
  await expect(page.getByRole('heading', { level: 2, name: 'Leave without saving?' })).toBeVisible()
  await page.waitForTimeout(200)
  facts['panel focus on open'] = await what(page)
  facts['panel buttons in order'] = await page.evaluate(() => [...document.querySelectorAll('section.confirm button')].map((b) => ({ text: (b.textContent ?? '').trim(), primary: b.classList.contains('hb-primary'), bg: getComputedStyle(b).backgroundColor })))
  await page.keyboard.press(chord)
  facts['first Tab from the heading'] = await what(page)
  await shots.shot('leave-panel-first-tab', { fullPage: false })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  facts['after Escape panel open'] = (await page.locator('section.confirm').count()) > 0
  facts['after Escape h1'] = (await h1(page).innerText()).trim()
  facts['after Escape focus'] = await what(page)
  shots.json('facts', facts)
  console.log(`[verify UX-005b] ${JSON.stringify(facts)}`)
})

// ------------------------------------------------------------------------------------------------ UX-006

test('verify UX-006 focus and title on screen changes', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-006/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  const at = async (label: string): Promise<void> => {
    await page.waitForTimeout(250)
    facts[label] = { focus: await what(page), focusIsH1: await page.evaluate(() => document.activeElement?.tagName === 'H1'), title: await page.title(), h1: (await h1(page).innerText().catch(() => '')).trim() }
  }
  await page.goto('./')
  await at('1 welcome loaded')
  await press(page, touch, page.getByRole('main').getByRole('link', { name: 'Privacy and terms' }).first())
  await expect(h1(page)).toHaveText('Privacy and terms')
  await at('2 privacy')
  await press(page, touch, page.getByRole('link', { name: 'Back', exact: true }))
  await expect(h1(page)).toHaveText('HumanBench')
  await at('3 welcome after Back')
  await shots.shot('welcome-after-back', { fullPage: false })
  await press(page, touch, button(page, 'Start'))
  await expect(h1(page)).toHaveText('Before you start')
  await at('4 gate')
  await press(page, touch, button(page, 'Continue'))
  await expect(page.getByRole('alert')).toBeVisible()
  facts['5 gate error'] = { focus: await what(page), checkbox: await page.getByRole('checkbox', { name: /18 or older/ }).evaluate((el) => ({ invalid: el.getAttribute('aria-invalid'), describedby: el.getAttribute('aria-describedby'), describedText: (document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? '').trim() })) }
  await shots.shot('gate-error', { fullPage: false })
  await press(page, touch, page.getByRole('checkbox', { name: /18 or older/ }))
  await press(page, touch, button(page, 'Continue'))
  await expect(h1(page)).toHaveText('Honour code')
  await at('6 honour')
  await press(page, touch, button(page, 'Continue'))
  await expect(page.getByRole('alert')).toBeVisible()
  facts['7 honour error'] = { checkbox: await page.getByRole('checkbox', { name: /honour code/ }).evaluate((el) => ({ invalid: el.getAttribute('aria-invalid'), describedby: el.getAttribute('aria-describedby') })) }
  await press(page, touch, page.getByRole('checkbox', { name: /honour code/ }))
  await press(page, touch, button(page, 'Continue'))
  await expect(h1(page)).toHaveText('Check your device')
  await at('8 device')
  await expect(button(page, 'Continue')).toBeEnabled({ timeout: 20_000 })
  await press(page, touch, button(page, 'Continue'))
  await expect(h1(page)).toHaveText('Ready when you are')
  await at('9 ready')
  facts['welcome h1 translate'] = await page.evaluate(() => null)
  // Results -> Back to the start -> welcome focus
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await loadSave(page, simulatedSave(1).save)
  await press(page, touch, button(page, 'See my results'))
  await expect(h1(page)).toHaveText('Your results')
  await at('10 results view')
  await press(page, touch, button(page, 'Back to the start'))
  await page.waitForTimeout(300)
  if ((await page.locator('section.confirm').count()) > 0) await press(page, touch, button(page, 'Leave anyway'))
  await expect(h1(page)).toHaveText('HumanBench')
  await at('11 welcome after Back to the start')
  await shots.shot('welcome-after-results', { fullPage: false })
  facts['welcome h1 translate attr'] = await h1(page).getAttribute('translate')
  shots.json('facts', facts)
  console.log(`[verify UX-006] ${JSON.stringify(facts)}`)
})

// ------------------------------------------------------------------------------------------------ UX-007a / UX-007b

test('verify UX-007 checklist: one Up next, region landmark, no mid-word breaks', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-007/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  const probe = async (label: string): Promise<void> => {
    await page.waitForTimeout(200)
    const metrics = await pageMetrics(page, { touch })
    facts[label] = {
      upNextInChecklist: await page.locator('.checklist').innerText().then((t) => (t.match(/Up next/g) ?? []).length).catch(() => null),
      upNextOnPage: (await bodyText(page)).match(/Up next/g)?.length ?? 0,
      landmarks: metrics.landmarks,
      navCount: await page.locator('nav').count(),
      checklistRole: await page.locator('.checklist').evaluate((el) => `${el.tagName.toLowerCase()} role=${el.getAttribute('role')} aria-label=${el.getAttribute('aria-label')}`).catch(() => null),
      rows: await page.locator('.checklist li').evaluateAll((lis) => lis.map((li) => ({ text: (li.textContent ?? '').replace(/\s+/g, ' ').trim(), status: li.getAttribute('data-status'), h: Math.round(li.getBoundingClientRect().height) }))),
      overflowX: metrics.overflowX.px,
      clipped: metrics.clipped,
      midWordBreaks: await page.evaluate(() => {
        // A word broken across lines inside the checklist (no hyphen, no slash): the rendered line boxes of each text node.
        const out: string[] = []
        const root = document.querySelector('.checklist')
        if (!root) return out
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        const range = document.createRange()
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const data = (n as Text).data
          for (const m of data.matchAll(/[A-Za-z]{4,}/g)) {
            range.setStart(n, m.index)
            range.setEnd(n, m.index + m[0].length)
            const rects = range.getClientRects()
            if (rects.length > 1) {
              const tops = new Set([...rects].map((r) => Math.round(r.top)))
              if (tops.size > 1) out.push(m[0])
            }
          }
        }
        return out
      }),
      shot: await shots.shot(label, { fullPage: true }),
    }
  }
  if (!touch) await page.setViewportSize({ width: 320, height: 568 })
  await open(page, 'interstitial')
  await probe(touch ? '390-interstitial' : '320-interstitial')
  if (!touch) {
    await useTextZoom(page, 200)
    await page.reload()
    await page.goto('./favicon.svg')
    await page.evaluate('localStorage.clear(); sessionStorage.clear()')
    await open(page, 'interstitial')
    await probe('320-interstitial-zoom200')
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('./favicon.svg')
    await page.evaluate('localStorage.clear(); sessionStorage.clear()')
    await open(page, 'interstitial')
    await probe('1280-interstitial-zoom200')
  }
  // After a skip: the order and the "Up next" count on the next interstitial, and during a part (a cluster under way).
  await page.goto('./favicon.svg')
  await page.evaluate('localStorage.clear(); sessionStorage.clear()')
  if (!touch) await page.setViewportSize({ width: 1280, height: 800 })
  const driver = new SessionDriver(page, { touch })
  await driver.toReady('./?fast=1')
  await driver.begin()
  await driver.skipPart()
  await expect(h1(page)).toHaveText('Up next: Matrix & Series')
  await probe('after-skip-interstitial-matrix')
  await driver.press(button(page, 'Start'))
  await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
  await probe('during-matrix-item')
  shots.json('facts', facts)
  console.log(`[verify UX-007] ${JSON.stringify(Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, typeof v === 'object' && v !== null ? { upNext: (v as { upNextInChecklist: unknown }).upNextInChecklist, nav: (v as { navCount: unknown }).navCount, clipped: (v as { clipped: unknown }).clipped, breaks: (v as { midWordBreaks: unknown }).midWordBreaks, overflow: (v as { overflowX: unknown }).overflowX } : v])))}`)
})

// ------------------------------------------------------------------------------------------------ UX-008

test('verify UX-008 session time copy and the ring', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-008/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  const minutes = (t: string): string[] => t.match(/[^.\n]*\b(minutes?|min\.?)\b[^.\n]*/gi) ?? []
  await page.goto('./')
  facts.welcome = minutes(await bodyText(page))
  const driver = new SessionDriver(page, { touch })
  await driver.toReady('./?fast=1')
  facts.ready = minutes(await bodyText(page))
  await driver.begin()
  const ring = (): Promise<string> => page.locator('.ring').evaluate((el) => `${el.getAttribute('aria-valuetext')} | max ${el.getAttribute('aria-valuemax')} | text ${(el.textContent ?? '').trim()}`)
  facts['interstitial 1 ring'] = await ring()
  const leads: string[] = []
  for (let i = 0; i < SEGMENT_TITLES.length; i++) {
    await expect(h1(page)).toHaveText(`Up next: ${SEGMENT_TITLES[i]}`)
    leads.push(`${SEGMENT_TITLES[i]}: ${await page.locator('p.lead').first().innerText()}`)
    if (i === SEGMENT_TITLES.length - 1) {
      facts['last interstitial ring'] = await ring()
      await shots.shot('last-interstitial', { fullPage: false })
      break
    }
    await driver.skipPart()
  }
  facts.interstitialLeads = leads
  facts.interstitialSum = leads.reduce((n, l) => n + Number(/About (\d+)/.exec(l)?.[1] ?? 0), 0)
  // Past the target with parts still to do (the clock route): what the ring says.
  await page.goto('./favicon.svg')
  await page.evaluate('localStorage.clear(); sessionStorage.clear()')
  await open(page, 'break-offer')
  facts['break offer ring (31 min in, every part still to do)'] = await ring()
  facts['break offer text'] = await page.locator('.body').innerText().then((t) => t.slice(0, 400))
  await shots.shot('break-offer', { fullPage: false })
  facts['ring track'] = await page.locator('.ring circle.track').evaluate((el) => ({ stroke: getComputedStyle(el).stroke, opacity: getComputedStyle(el).opacity, strokeOpacity: getComputedStyle(el).strokeOpacity }))
  facts['ring text translate'] = await page.locator('.ring .text').getAttribute('translate')
  shots.json('facts', facts)
  console.log(`[verify UX-008] ${JSON.stringify(facts)}`)
})

// ------------------------------------------------------------------------------------------------ UX-009a / UX-009b / UX-010

test('verify UX-009 UX-010 results header lines and See my results', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-009-010/${testInfo.project.name}`)
  const log = trackConsole(page)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const sim = simulatedSave(1)
  const lead = (): Promise<string[]> => page.locator('p.lead').allInnerTexts()
  // A. Load a file, Begin, Finish early at once.
  await toReady(page, touch ? 'Tap or click' : 'Keyboard')
  await loadSave(page, sim.save)
  facts['ready buttons after load'] = await page.locator('.hb-actions button').allInnerTexts()
  facts['ready added-to line'] = (await bodyText(page)).match(/[^.\n]*earlier session[^.\n]*\./g)
  await shots.shot('ready-loaded', { fullPage: false })
  await press(page, touch, button(page, 'Begin'))
  await expect(h1(page)).toHaveText('Up next: Reaction time')
  await press(page, touch, button(page, 'Finish early'))
  await press(page, touch, button(page, 'Finish now'))
  await expect(h1(page)).toHaveText(/^Session (complete|ended)$/)
  await expect(button(page, 'Download save file')).toBeVisible({ timeout: 30_000 })
  facts['A finish at once after load: h1'] = (await h1(page).innerText()).trim()
  facts['A lead lines'] = await lead()
  await shots.shot('a-finished-after-load-top', { fullPage: false })
  // B. See my results from Ready: no session, nothing written.
  await page.goto('./favicon.svg')
  await page.evaluate('localStorage.clear(); sessionStorage.clear()')
  await toReady(page, touch ? 'Tap or click' : 'Keyboard')
  await loadSave(page, sim.save)
  facts['B See my results present'] = (await button(page, 'See my results').count()) > 0
  await press(page, touch, button(page, 'See my results'))
  await expect(h1(page)).toHaveText('Your results')
  await expect(button(page, 'Download save file')).toBeVisible({ timeout: 30_000 })
  facts['B h1'] = (await h1(page).innerText()).trim()
  facts['B lead lines'] = await lead()
  facts['B title'] = await page.title()
  await shots.shot('b-results-view-top', { fullPage: false })
  const [dl] = await Promise.all([page.waitForEvent('download'), press(page, touch, button(page, 'Download save file'))])
  const path = await dl.path()
  const { readFileSync } = await import('node:fs')
  const doc = JSON.parse(readFileSync(path ?? '', 'utf8')) as { sessions: { responses: unknown[] }[]; anon_id: string }
  facts['B download'] = { sessions: doc.sessions.length, responses: doc.sessions.map((s) => s.responses.length), simulatedSessions: (sim.save as { sessions: unknown[] }).sessions.length, anonIdSame: doc.anon_id === (sim.save as { anon_id: string }).anon_id }
  // C. Nothing measured.
  await page.goto('./favicon.svg')
  await page.evaluate('localStorage.clear(); sessionStorage.clear()')
  await open(page, 'finished-nothing')
  facts['C h1'] = (await h1(page).innerText()).trim()
  facts['C lead lines'] = await lead()
  facts['C visible buttons'] = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0).map((b) => `${(b.textContent ?? '').trim()}${b.classList.contains('hb-primary') ? ' [primary]' : ''}`))
  facts['C save panel inside closed details'] = await page.evaluate(() => { const p = document.querySelector('[data-section="save"]'); const d = p?.closest('details'); return d ? { summary: d.querySelector('summary')?.textContent?.trim(), open: d.open } : null })
  facts['C save panel x'] = (await rectsOf(page, '[data-section="save"]'))[0] ?? null
  await shots.all('c-finished-nothing')
  // D. One answer, then every other part skipped: the reason line.
  await page.goto('./favicon.svg')
  await page.evaluate('localStorage.clear(); sessionStorage.clear()')
  const driver = new SessionDriver(page, { touch })
  await driver.toReady('./?fast=1')
  await driver.begin()
  await driver.answerOne()
  await skipFromBlock(page, touch)
  for (let i = 2; i < SEGMENT_TITLES.length; i++) {
    await expect(h1(page)).toHaveText(`Up next: ${SEGMENT_TITLES[i]}`)
    await driver.skipPart()
  }
  await expect(h1(page)).toHaveText(/^Session (complete|ended)$/, { timeout: 30_000 })
  await page.waitForTimeout(1500)
  facts['D h1'] = (await h1(page).innerText()).trim()
  facts['D lead lines'] = await lead()
  facts['D visible buttons'] = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0).map((b) => `${(b.textContent ?? '').trim()}${b.classList.contains('hb-primary') ? ' [primary]' : ''}`))
  facts['D profile present'] = (await page.locator('svg.hb-blob').count()) > 0
  await shots.shot('d-one-answer-rest-skipped-top', { fullPage: false })
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[verify UX-009/010] ${JSON.stringify(facts)}`)
})

// ------------------------------------------------------------------------------------------------ UX-011

test('verify UX-011 leaving mid-session: Back, refresh guard, privacy link', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-011/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  await page.goto('about:blank')
  await page.goto('./?fast=1')
  // The privacy link from the welcome and from the gate: same tab, and Back returns.
  facts['welcome privacy links'] = await page.getByRole('link', { name: /Privacy and terms/ }).evaluateAll((as) => as.map((a) => ({ href: a.getAttribute('href'), target: a.getAttribute('target'), name: (a.textContent ?? '').trim(), inFooter: a.closest('footer') !== null })))
  await press(page, touch, page.getByRole('main').getByRole('link', { name: /Privacy and terms/ }).first())
  await expect(h1(page)).toHaveText('Privacy and terms')
  await press(page, touch, page.getByRole('link', { name: 'Back', exact: true }))
  await expect(h1(page)).toHaveText('HumanBench')
  const driver = new SessionDriver(page, { touch })
  await driver.toReady('./?fast=1')
  await driver.begin()
  await driver.answerOne()
  await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
  facts['in session guarded (beforeunload)'] = await unloadIsGuarded(page)
  facts['in session footer links'] = await page.evaluate(() => [...document.querySelectorAll('footer a')].map((a) => ({ text: (a.textContent ?? '').trim(), href: a.getAttribute('href'), target: a.getAttribute('target') })))
  await shots.shot('in-session', { fullPage: false })
  // Browser Back during an item.
  await page.goBack()
  await page.waitForTimeout(500)
  facts['after Back'] = { url: page.url().replace(/^.*humanbench/, ''), h1: (await h1(page).innerText().catch(() => '')).trim(), confirmOpen: (await page.locator('section.confirm').count()) > 0, confirmHeading: await page.locator('section.confirm h2').innerText().catch(() => ''), itemStillThere: (await page.locator('form.choice, form.entry').count()) > 0 }
  await shots.shot('after-browser-back', { fullPage: false })
  if ((await page.locator('section.confirm').count()) > 0) {
    await press(page, touch, page.locator('section.confirm').getByRole('button', { name: 'Keep going' }))
    await page.waitForTimeout(300)
    facts['after Keep going'] = { h1: (await h1(page).innerText().catch(() => '')).trim(), itemStillThere: (await page.locator('form.choice, form.entry').count()) > 0 }
    // A second Back: still guarded?
    await page.goBack()
    await page.waitForTimeout(500)
    facts['after second Back'] = { url: page.url().replace(/^.*humanbench/, ''), h1: (await h1(page).innerText().catch(() => '')).trim(), confirmOpen: (await page.locator('section.confirm').count()) > 0 }
    if ((await page.locator('section.confirm').count()) > 0) await press(page, touch, page.locator('section.confirm').getByRole('button', { name: 'Keep going' }))
  }
  // The privacy notice from a running session: opens in a new tab (clock untouched).
  const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: 5000 }).catch(() => null), press(page, touch, page.locator('footer').getByRole('link', { name: /Privacy and terms/ }))])
  await page.waitForTimeout(400)
  facts['privacy from session'] = { openedNewTab: popup !== null, sessionH1: (await h1(page).innerText().catch(() => '')).trim(), itemStillThere: (await page.locator('form.choice, form.entry').count()) > 0, popupH1: popup === null ? null : (await popup.locator('h1').first().innerText().catch(() => '')).trim() }
  await popup?.close()
  shots.json('facts', facts)
  console.log(`[verify UX-011] ${JSON.stringify(facts)}`)
})

// ------------------------------------------------------------------------------------------------ UX-012a / UX-012b

test('verify UX-012 ready screen: chosen file, bad file then code, error wording', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-012/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const sim = simulatedSave(1)
  const file = (name: string, text: string | Buffer, mimeType = 'application/json'): { name: string; mimeType: string; buffer: Buffer } => ({ name, mimeType, buffer: typeof text === 'string' ? Buffer.from(text) : text })
  const status = (): Promise<string> => page.locator('[role=status]', { hasText: /./ }).filter({ hasNot: page.locator('.reveal') }).first().innerText().catch(() => '')
  const fields = (): Promise<unknown> =>
    page.evaluate(() => {
      const f = document.querySelector('input[type=file]')
      const c = document.querySelector('textarea')
      const d = (el: Element | null): unknown => (el ? { invalid: el.getAttribute('aria-invalid'), describedby: el.getAttribute('aria-describedby'), describedText: (document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? '').trim().slice(0, 200) } : null)
      return { file: d(f), code: d(c), alerts: [...document.querySelectorAll('[role=alert]')].map((a) => (a.textContent ?? '').trim()), statuses: [...document.querySelectorAll('[role=status]')].map((a) => (a.textContent ?? '').trim()).filter((t) => t !== '') }
    })
  await toReady(page, touch ? 'Tap or click' : 'Keyboard')
  // 1. A chosen file, never Load: loads on change?
  await page.getByLabel('Save file').setInputFiles(file('humanbench-save.hbsave.json', JSON.stringify(sim.save)))
  await page.waitForTimeout(1500)
  facts['1 file chosen, no Load pressed'] = { ...(await fields() as object), loadedText: (await bodyText(page)).match(/Loaded \d+ earlier sessions?[^.]*\./)?.[0] ?? null }
  await shots.shot('1-file-chosen', { fullPage: true })
  // 2. A bad file, then a valid code pasted and Load.
  await page.goto('./favicon.svg')
  await page.evaluate('localStorage.clear(); sessionStorage.clear()')
  await toReady(page, touch ? 'Tap or click' : 'Keyboard')
  await page.getByLabel('Save file').setInputFiles(file('photo.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), 'image/jpeg'))
  await page.waitForTimeout(800)
  facts['2a bad file'] = { ...(await fields() as object), fileValue: await page.getByLabel('Save file').evaluate((el) => (el as HTMLInputElement).files?.length ?? 0) }
  await shots.shot('2a-bad-file', { fullPage: false })
  // A valid save code: the gzip base64 the app makes; here the raw JSON is also accepted as pasted text.
  await page.getByLabel('Or paste a save code').fill(JSON.stringify(sim.save))
  await press(page, touch, button(page, 'Load'))
  await page.waitForTimeout(1000)
  facts['2b code after bad file'] = { ...(await fields() as object), loadedText: (await bodyText(page)).match(/Loaded \d+ earlier sessions?[^.]*\./)?.[0] ?? null }
  await shots.shot('2b-code-after-bad-file', { fullPage: false })
  // 3. Error wording: truncated JSON, random text, a newer version, an empty file.
  const cases: [string, { name: string; mimeType: string; buffer: Buffer } | null, string | null][] = [
    ['truncated', file('humanbench-save.hbsave.json', JSON.stringify(sim.save).slice(0, 2000)), null],
    ['random text file', file('notes.txt', 'hello there, this is not a save', 'text/plain'), null],
    ['empty file', file('empty.hbsave.json', ''), null],
    ['newer version', file('new.hbsave.json', JSON.stringify({ ...(sim.save as object), schema_version: '2.0' })), null],
    ['random text pasted', null, 'hello there, this is not a save code'],
    ['truncated pasted', null, JSON.stringify(sim.save).slice(0, 2000)],
  ]
  const errors: Record<string, unknown> = {}
  for (const [label, f, code] of cases) {
    await page.goto('./favicon.svg')
    await page.evaluate('localStorage.clear(); sessionStorage.clear()')
    await toReady(page, touch ? 'Tap or click' : 'Keyboard')
    if (f !== null) await page.getByLabel('Save file').setInputFiles(f)
    if (code !== null) {
      await page.getByLabel('Or paste a save code').fill(code)
      await press(page, touch, button(page, 'Load'))
    }
    await page.waitForTimeout(900)
    const fx = (await fields()) as { statuses: string[]; alerts: string[] }
    const msg = [...fx.alerts, ...fx.statuses].filter((t) => !/^Loaded /.test(t))[0] ?? ''
    errors[label] = { message: msg, jargon: /json|gzip|schema|version \d|major/i.test(msg), saysWhatToDo: /choose|paste|download|try|copy|press|load/i.test(msg), fields: fx }
  }
  facts['3 errors'] = errors
  await shots.shot('3-last-error', { fullPage: false })
  facts['status'] = await status()
  shots.json('facts', facts)
  console.log(`[verify UX-012] ${JSON.stringify(facts).slice(0, 3000)}`)
})

// ------------------------------------------------------------------------------------------------ UX-013

test('verify UX-013 device check: Continue stays put, aria-disabled, measuring line', async ({ page, browserName }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-013/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  await page.goto('./?fast=1')
  await press(page, touch, button(page, 'Start'))
  await press(page, touch, page.getByRole('checkbox', { name: /18 or older/ }))
  await press(page, touch, button(page, 'Continue'))
  await press(page, touch, page.getByRole('checkbox', { name: /honour code/ }))
  await press(page, touch, button(page, 'Continue'))
  await expect(h1(page)).toHaveText('Check your device')
  const t0 = Date.now()
  const cont = button(page, 'Continue')
  const probe = async (): Promise<Record<string, unknown>> => ({
    ms: Date.now() - t0,
    continueRect: (await rectsOf(page, 'button.hb-primary'))[0] ?? null,
    ariaDisabled: await cont.getAttribute('aria-disabled'),
    disabled: await cont.isDisabled(),
    measuring: await page.locator('.measuring').evaluate((el) => ({ role: el.getAttribute('role'), text: (el.textContent ?? '').trim(), hasSpan: el.querySelector('span') !== null })).catch(() => null),
    factsShown: await page.locator('dl.facts').count(),
    scrollHeight: await page.evaluate(() => document.documentElement.scrollHeight),
  })
  facts['arrival'] = await probe()
  await shots.shot('device-measuring', { fullPage: false })
  if (!touch) {
    const chord = await chordFor(page, browserName)
    const seen: string[] = []
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press(chord)
      seen.push(`${Date.now() - t0}ms ${await what(page)}`)
    }
    facts['three quick Tabs'] = seen
    // Enter on an aria-disabled Continue must do nothing.
    if ((await cont.getAttribute('aria-disabled')) === 'true') {
      await cont.focus()
      await page.keyboard.press('Enter')
      await page.waitForTimeout(200)
      facts['Enter on aria-disabled Continue h1'] = (await h1(page).innerText()).trim()
    }
  }
  await expect(cont).toBeEnabled({ timeout: 20_000 })
  await expect.poll(() => cont.getAttribute('aria-disabled'), { timeout: 20_000 }).toBeNull()
  facts['measured'] = await probe()
  await shots.shot('device-measured', { fullPage: false })
  const a = (facts['arrival'] as { continueRect: Rect | null }).continueRect
  const b = (facts['measured'] as { continueRect: Rect | null }).continueRect
  facts['Continue moved px'] = a !== null && b !== null ? Math.round(b.y - a.y) : null
  facts['facts text'] = await page.locator('dl.facts').innerText().catch(() => '')
  facts['intro text'] = await page.locator('.hb-screen p, main p').first().innerText().catch(() => '')
  facts['order: choice before facts'] = await page.evaluate(() => { const f = document.querySelector('fieldset'); const d = document.querySelector('dl.facts'); return f && d ? f.getBoundingClientRect().top < d.getBoundingClientRect().top : null })
  shots.json('facts', facts)
  console.log(`[verify UX-013] ${JSON.stringify(facts)}`)
})

// ------------------------------------------------------------------------------------------------ UX-014

test('verify UX-014 confidence panel: Continue in view, track, held Enter, width', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-014/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  const viewports = touch ? [page.viewportSize() ?? { width: 390, height: 664 }, { width: 320, height: 568 }, { width: 390, height: 839 }] : [{ width: 320, height: 568 }, { width: 1280, height: 800 }]
  for (const vp of viewports) {
    await page.setViewportSize(vp)
    const key = `${vp.width}x${vp.height}`
    await page.goto('./favicon.svg')
    await page.evaluate('localStorage.clear(); sessionStorage.clear()')
    const driver = new SessionDriver(page, { touch })
    await driver.toReady('./?fast=1')
    await driver.begin()
    await driver.skipPart()
    await driver.press(button(page, 'Start'))
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    // Answer with the page scrolled down (the button was at the bottom), as a thumb does.
    const choice = page.locator('form.choice')
    if ((await choice.count()) > 0) {
      await press(page, touch, choice.getByRole('radio').first())
      await scrollThenPress(page, touch, button(page, 'Confirm'))
    } else {
      const box = page.locator('form.entry input[type=text]')
      await box.fill((await box.evaluate((el) => el.classList.contains('letter'))) ? 'A' : '1')
      await scrollThenPress(page, touch, page.locator('form.entry').getByRole('button', { name: 'Submit', exact: true }))
    }
    await expect(page.getByRole('slider')).toBeVisible()
    await page.waitForTimeout(400)
    facts[`${key} confidence`] = await page.evaluate<Record<string, unknown>>(`(() => {
      const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), w: Math.round(b.width) } }
      const c = r('form.confidence button.hb-primary')
      const range = document.querySelector('input[type=range]')
      const cs = range ? getComputedStyle(range) : null
      const legend = document.querySelector('form.confidence legend'), fs = document.querySelector('form.confidence fieldset')
      return { innerHeight, scrollY: Math.round(scrollY), form: r('form.confidence'), continue: c, continueInView: c !== null && c.top >= 0 && c.bottom <= innerHeight, continueNeedsScroll: c === null ? null : Math.max(0, c.bottom - innerHeight), activeElement: document.activeElement ? document.activeElement.tagName + '.' + document.activeElement.className : '', range: cs ? { height: cs.height, accent: cs.accentColor, bg: cs.backgroundColor, appearance: cs.appearance } : null, hint: (document.querySelector('form.confidence .hint') || {}).textContent || '', legendInsideFrame: legend && fs ? legend.getBoundingClientRect().top >= fs.getBoundingClientRect().top : null, outputTranslate: (document.querySelector('form.confidence output') || {}).getAttribute ? document.querySelector('form.confidence output').getAttribute('translate') : null }
    })()`)
    await shots.shot(`${key}-confidence-viewport`, { fullPage: false })
    if (!touch && vp.width === 1280) {
      // A held Enter: the OS sends keydown events with repeat=true; a repeat must not submit, a plain Enter must.
      await page.getByRole('slider').focus()
      const submitted = (): Promise<boolean> => page.getByRole('slider').count().then((n) => n === 0)
      for (let i = 0; i < 5; i++) await page.evaluate(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', repeat: true, bubbles: true, cancelable: true })))
      await page.waitForTimeout(300)
      facts['1280 five repeat Enter keydowns submitted'] = await submitted()
      facts['1280 repeat keydown default prevented'] = await page.evaluate(() => { const e = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', repeat: true, bubbles: true, cancelable: true }); document.activeElement?.dispatchEvent(e); return e.defaultPrevented })
      facts['1280 plain keydown default prevented'] = await page.evaluate(() => { const e = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', repeat: false, bubbles: true, cancelable: true }); document.activeElement?.dispatchEvent(e); return e.defaultPrevented })
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)
      facts['1280 one real Enter submitted'] = await submitted()
    }
  }
  shots.json('facts', facts)
  console.log(`[verify UX-014] ${JSON.stringify(facts)}`)
})

// ------------------------------------------------------------------------------------------------ UX-015

test('verify UX-015 legends inside frames and the printed results', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch === true, 'desktop only (print emulation)')
  const shots = new Shots(page, RUN, `UX-015/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  const LEGENDS = `[...document.querySelectorAll('fieldset')].filter((f) => f.getBoundingClientRect().height > 0).map((f) => { const l = f.querySelector('legend'); const fb = f.getBoundingClientRect(); const lb = l ? l.getBoundingClientRect() : null; const cs = l ? getComputedStyle(l) : null; return { legend: l ? (l.textContent || '').trim().slice(0, 60) : null, lines: lb && cs ? Math.round(lb.height / parseFloat(cs.lineHeight)) : null, legendTop: lb ? Math.round(lb.top) : null, frameTop: Math.round(fb.top), legendInside: lb ? lb.top >= fb.top - 1 : null, float: cs ? cs.float : null } })`
  for (const [id, w] of [['device', 390], ['confidence', 390], ['reading-questions', 390], ['device', 320], ['reading-questions', 1440]] as const) {
    await page.setViewportSize({ width: w, height: 844 })
    await page.goto('./favicon.svg')
    await page.evaluate('localStorage.clear(); sessionStorage.clear()')
    await open(page, id)
    await page.waitForTimeout(200)
    facts[`${id} ${w}`] = { legends: await page.evaluate(LEGENDS), shot: await shots.shot(`${id}-${w}`, { fullPage: true }) }
  }
  // Print: the results after the save, dark OS and light.
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('./favicon.svg')
  await page.evaluate('localStorage.clear(); sessionStorage.clear()')
  await open(page, 'results-saved')
  const { openDetails } = await import('../../e2e/flow')
  await openDetails(page)
  for (const s of ['dark', 'light'] as const) {
    await page.emulateMedia({ media: 'print', colorScheme: s, reducedMotion: 'reduce' })
    await page.waitForTimeout(300)
    facts[`print ${s}`] = await page.evaluate(() => {
      const cs = (el: Element | null): { color: string; bg: string } | null => (el ? { color: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor } : null)
      const r = (el: Element | null): { top: number; bottom: number } | null => (el ? { top: Math.round(el.getBoundingClientRect().top + scrollY), bottom: Math.round(el.getBoundingClientRect().bottom + scrollY) } : null)
      const disclaimer = [...document.querySelectorAll('p')].find((p) => /not a diagnosis|not clinical|not medical/i.test(p.textContent ?? '')) ?? null
      const resource = document.querySelector('[data-section="results-footer"] p')
      const app = document.getElementById('app')
      return { html: cs(document.documentElement), body: cs(document.body), app: app ? getComputedStyle(app).display : null, chart: cs(document.querySelector('svg.hb-blob')), notes: cs(document.querySelector('[data-slot="working-with-ai"]')), card: cs(document.querySelector('[data-share-card]')), disclaimer: r(disclaimer), resource: r(resource), colorScheme: getComputedStyle(document.documentElement).colorScheme, blobTheme: (document.querySelector('svg.hb-blob') as HTMLElement | null)?.style.cssText.slice(0, 200) ?? null }
    })
    await shots.shot(`print-${s}-top`, { fullPage: false })
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await shots.shot(`print-${s}-bottom`, { fullPage: false })
    if (testInfo.project.name === 'chromium') {
      const path = await import('node:path')
      const { UX_ROOT } = await import('../lib')
      await page.pdf({ path: path.join(UX_ROOT, RUN, 'UX-015', `results-after-save-a4-${s}.pdf`), format: 'A4', printBackground: false })
    }
  }
  shots.json('facts', facts)
  console.log(`[verify UX-015] ${JSON.stringify(facts).slice(0, 2500)}`)
})

// ------------------------------------------------------------------------------------------------ UX-016 / UX-018a / UX-018b

test('verify UX-016 UX-018 copy: nouns, apostrophes, welcome link, benefit claims', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-016-018/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  await page.goto('./')
  facts['welcome Start vs privacy link'] = await page.evaluate(() => {
    const s = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Start')
    const a = [...document.querySelectorAll('a')].find((x) => /Privacy and terms/.test(x.textContent ?? ''))
    if (!s || !a) return null
    const sb = s.getBoundingClientRect(), ab = a.getBoundingClientRect()
    return { start: { bottom: Math.round(sb.bottom), x: Math.round(sb.left) }, link: { top: Math.round(ab.top), h: Math.round(ab.height), x: Math.round(ab.left) }, gap: Math.round(ab.top - sb.bottom), sameLine: Math.abs(ab.top - sb.top) < 10 }
  })
  await shots.shot('welcome-viewport', { fullPage: false })
  facts['curly apostrophes on welcome/privacy'] = (await bodyText(page)).match(/\w’\w/g)
  await page.goto('./#/privacy')
  facts['curly apostrophes on privacy'] = (await bodyText(page)).match(/\w’\w/g)
  const driver = new SessionDriver(page, { touch })
  await driver.toReady('./?fast=1')
  await driver.begin()
  const blurbs: Record<string, string> = {}
  for (let i = 0; i < SEGMENT_TITLES.length; i++) {
    await expect(h1(page)).toHaveText(`Up next: ${SEGMENT_TITLES[i]}`)
    blurbs[SEGMENT_TITLES[i]!] = await page.locator('.body').innerText().then((t) => t.replace(/\s+/g, ' ').slice(0, 500))
    if (i < SEGMENT_TITLES.length - 1) await driver.skipPart()
  }
  facts['interstitial blurbs'] = blurbs
  facts['blurb nouns'] = Object.fromEntries(Object.entries(blurbs).map(([k, v]) => [k, { piece: /\bpiece\b/i.test(v), squares: /\bsquares?\b/i.test(v), symbols: /\bsymbols?\b/i.test(v), figure: /\bfigure\b/i.test(v), shapes: /\bshapes?\b/i.test(v), cell: /\bcell\b/i.test(v), blocks: /\bblocks?\b/i.test(v) }]))
  // Benefit claims (A22): the break offer, the focus-session text, the retest text.
  await page.goto('./favicon.svg')
  await page.evaluate('localStorage.clear(); sessionStorage.clear()')
  await open(page, 'break-offer')
  const breakText = await page.locator('.body').innerText()
  facts['break offer text'] = breakText.replace(/\s+/g, ' ').slice(0, 400)
  facts['break offer benefit claim'] = /sharp|help you|improve|better|fresh/i.test(breakText)
  await page.goto('./favicon.svg')
  await page.evaluate('localStorage.clear(); sessionStorage.clear()')
  await open(page, 'ready-returning')
  const readyText = await page.locator('details.focus').innerText()
  facts['focus text'] = readyText.replace(/\s+/g, ' ').slice(0, 300)
  facts['focus benefit claim'] = /sharpen|improve|better|boost|train/i.test(readyText)
  await page.goto('./favicon.svg')
  await page.evaluate('localStorage.clear(); sessionStorage.clear()')
  await open(page, 'results-open')
  const results = await bodyText(page)
  facts['results benefit-claim sentences'] = results.match(/[^.\n]*\b(sharpen|sharp|improve|boost|train your|helps most|you gained|describe you)\b[^.\n]*\./gi)
  facts['results focus text'] = results.match(/Pick the parts[^.]*\.[^.]*\./)?.[0] ?? null
  shots.json('facts', facts)
  console.log(`[verify UX-016/018] ${JSON.stringify(facts).slice(0, 2500)}`)
})

// ------------------------------------------------------------------------------------------------ UX-017a / UX-017b

test('verify UX-017 no-WebGL spatial state', async ({ page }, testInfo) => {
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-017/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  const viewports = touch ? [page.viewportSize() ?? { width: 390, height: 664 }, { width: 320, height: 568 }] : [{ width: 320, height: 568 }, { width: 1280, height: 800 }]
  for (const vp of viewports) {
    await page.setViewportSize(vp)
    const key = `${vp.width}x${vp.height}`
    await page.goto('./favicon.svg')
    await page.evaluate('localStorage.clear(); sessionStorage.clear()')
    await open(page, 'item-spatial-no-webgl')
    await page.waitForTimeout(300)
    const text = await bodyText(page)
    facts[key] = {
      messageCount: (text.match(/cannot be shown|cannot draw|3D|three-dimensional|WebGL/gi) ?? []).length,
      sentences: text.match(/[^.\n]*(cannot|3D|WebGL)[^.\n]*\./gi),
      skipRect: (await rectsOf(page, '.unavailable button.hb-primary'))[0] ?? null,
      innerHeight: vp.height,
      skipInFirstScreen: await page.locator('.unavailable button.hb-primary').evaluate((el) => { const r = el.getBoundingClientRect(); return r.top + scrollY >= 0 && r.bottom + scrollY <= innerHeight }),
      optionFrames: await page.locator('div.rotation .options label, div.rotation .option, form.choice label').count(),
      canvases: await page.locator('div.rotation canvas').count(),
      confirm: await page.locator('button', { hasText: 'Confirm' }).count(),
      headerNotice: await page.locator('header.top .status').innerText().catch(() => ''),
      unavailableButtons: await page.locator('.unavailable button').allInnerTexts(),
      rotationText: await page.locator('div.rotation').innerText().catch(() => '(no rotation element)'),
      panelOrder: await page.evaluate(() => { const h = document.querySelector('h1'); const u = document.querySelector('.unavailable'); const s = document.querySelector('.stage, div.rotation'); return { unavailableTop: u ? Math.round(u.getBoundingClientRect().top + scrollY) : null, h1Bottom: h ? Math.round(h.getBoundingClientRect().bottom + scrollY) : null, stageTop: s ? Math.round(s.getBoundingClientRect().top + scrollY) : null } }),
      shot: await shots.shot(`${key}-no-webgl`, { fullPage: true }),
      viewportShot: await shots.shot(`${key}-no-webgl-viewport`, { fullPage: false }),
    }
  }
  // While the three-view chunk loads: a loading line in the target box (slow network on Chromium only).
  if (testInfo.project.name === 'chromium') {
    await page.goto('./favicon.svg')
    await page.evaluate('localStorage.clear(); sessionStorage.clear()')
    const driver = new SessionDriver(page, { touch })
    await driver.toReady('./?fast=1')
    await driver.begin()
    await driver.skipPart()
    await driver.skipPart()
    await expect(h1(page)).toHaveText('Up next: Spatial')
    await page.route(/three-view/, async (route) => {
      await new Promise((r) => setTimeout(r, 2500))
      await route.continue()
    })
    await driver.press(button(page, 'Start'))
    await page.waitForTimeout(700)
    facts['loading state'] = { rotationText: await page.locator('div.rotation').innerText().catch(() => ''), loadingEl: await page.locator('div.rotation .loading').innerText().catch(() => null), shot: await shots.shot('loading-figures', { fullPage: false }) }
    await page.unroute(/three-view/)
  }
  shots.json('facts', facts)
  console.log(`[verify UX-017] ${JSON.stringify(facts).slice(0, 2500)}`)
})
