/// <reference lib="dom" />
/**
 * Verification package 2 (run id `verify2`), the wave-1 coverage gaps: the 20 major wave-1 items are replayed on desktop
 * WebKit and on the Pixel 7 project by running the wave-1 verify specs themselves (`verify-*.ux.ts` with UX_RUN=verify2
 * and `--project=webkit --project=pixel`). The wave-1 UX-001 scenario is phone-only (it taps), so desktop WebKit gets a
 * variant here: the same landings at a 390 x 664 and a 320 x 568 window, by mouse, the page scrolled to the bottom
 * before each press as a thumb leaves it. Evidence under web/test-results/ux-review/verify2/UX-001/webkit/.
 *
 *   UX_PORT=4775 UX_RUN=verify2 npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/verify2-gaps.ux.ts --project=webkit
 */

import { expect, test, type Locator, type Page } from '@playwright/test'
import { button, h1 } from '../../e2e/flow'
import { chordFor } from '../../e2e/keyboard'
import { openRoute, PREVIEW_ROUTES } from '../../e2e/routes'
import { SessionDriver } from '../../e2e/session-driver'
import { Shots, trackConsole } from '../lib'

const RUN = process.env.UX_RUN ?? 'verify2'

test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 })

const LANDING = `(() => {
  const describe = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : '')
  const top = (el) => (el ? Math.round(el.getBoundingClientRect().top) : null)
  const h1 = document.querySelector('h1')
  const stage = document.querySelector('form.choice, form.entry, section.hb-render.rt, section.hb-render.span, section.hb-render.corsi, section.hb-render.coding, section.hb-render.reading, div.rotation')
  const inView = (t) => t !== null && t >= 0 && t < window.innerHeight
  const a = document.activeElement
  return { h1: h1 ? h1.textContent.trim() : '', h1Top: top(h1), h1InView: inView(top(h1)), scrollY: Math.round(window.scrollY), maxScrollY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight), innerHeight: window.innerHeight, stageTop: top(stage), stageInView: inView(top(stage)), activeElement: a ? describe(a) : '' }
})()`

interface Landing {
  readonly h1: string
  readonly h1InView: boolean
  readonly scrollY: number
  readonly stageInView: boolean
}

async function scrollThenClick(page: Page, target: Locator): Promise<void> {
  await page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
  await page.waitForTimeout(100)
  await target.click()
}

async function skipFromBlock(page: Page): Promise<void> {
  await page.locator('header.top .actions').getByRole('button', { name: /^Skip / }).click()
  await page.locator('section.confirm').getByRole('button', { name: /^Skip / }).click()
  await expect(page.locator('section.confirm')).toHaveCount(0)
}

async function answerByThumb(page: Page): Promise<void> {
  const choice = page.locator('form.choice')
  const entry = page.locator('form.entry')
  if ((await choice.count()) > 0) {
    await choice.getByRole('radio').first().click()
    await scrollThenClick(page, button(page, 'Confirm'))
  } else {
    const box = entry.locator('input[type=text]')
    await box.fill((await box.evaluate((el) => el.classList.contains('letter'))) ? 'A' : '1')
    await scrollThenClick(page, entry.getByRole('button', { name: 'Submit', exact: true }))
  }
  await expect(page.getByRole('slider')).toBeVisible()
  await scrollThenClick(page, button(page, 'Continue'))
  await expect(page.getByRole('slider')).toHaveCount(0)
}

test('verify2 UX-001 on desktop WebKit at phone sizes: new screens open at their heading', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch === true, 'the wave-1 spec covers touch projects')
  test.setTimeout(8 * 60_000)
  const shots = new Shots(page, RUN, `UX-001/${testInfo.project.name}`)
  const log = trackConsole(page)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  const landed = async (name: string, settleMs = 600): Promise<Record<string, unknown>> => {
    const at0 = (await page.evaluate(LANDING)) as Landing
    await page.waitForTimeout(settleMs)
    const later = (await page.evaluate(LANDING)) as Landing
    const shot = await shots.shot(`${name}-viewport`, { fullPage: false })
    return { at0, later, shot, ok: later.h1InView }
  }
  for (const vp of [{ width: 390, height: 664 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(vp)
    const key = `${vp.width}x${vp.height}`
    const driver = new SessionDriver(page, { touch: false })
    await page.goto('./favicon.svg')
    await page.evaluate('localStorage.clear(); sessionStorage.clear()')
    await driver.toReady('./?fast=1')
    await page.evaluate('window.scrollTo(0, 0)')
    await button(page, 'Begin').click()
    await expect(h1(page)).toHaveText('Up next: Reaction time')
    facts[`${key} A interstitial from top`] = await landed(`${key}-a-interstitial`)
    await scrollThenClick(page, button(page, 'Start'))
    await expect(h1(page)).toHaveText('Reaction time')
    facts[`${key} B rt intro from bottom`] = await landed(`${key}-b-rt-intro`)
    await skipFromBlock(page)
    await expect(h1(page)).toHaveText('Up next: Matrix & Series')
    facts[`${key} C interstitial after skip`] = await landed(`${key}-c-interstitial`, 300)
    await page.evaluate('window.scrollTo(0, 0)')
    await button(page, 'Start').click()
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    facts[`${key} C item1 from top`] = await landed(`${key}-c-item1`)
    await answerByThumb(page)
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    facts[`${key} D item2 after Continue at bottom`] = await landed(`${key}-d-item2`)
    await answerByThumb(page)
    await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
    facts[`${key} D item3 after Continue at bottom`] = await landed(`${key}-d-item3`)
    await skipFromBlock(page)
    await expect(h1(page)).toHaveText('Up next: Spatial')
    await scrollThenClick(page, button(page, 'Start'))
    await expect(page.locator('form.choice').or(page.locator('.unavailable'))).toBeVisible({ timeout: 60_000 })
    facts[`${key} E spatial from bottom`] = await landed(`${key}-e-spatial`, 1500)
    await skipFromBlock(page)
    await expect(h1(page)).toHaveText('Up next: Working Memory')
    await page.evaluate('window.scrollTo(0, 0)')
    await button(page, 'Start').click()
    await expect(page.locator('section.hb-render.span')).toBeVisible()
    facts[`${key} F memory intro from top`] = await landed(`${key}-f-memory-intro`, 300)
    await scrollThenClick(page, page.locator('section.hb-render.span').getByRole('button', { name: 'Start' }))
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 30_000 })
    facts[`${key} G memory entry from bottom`] = await landed(`${key}-g-memory-entry`, 300)
  }
  const landings = Object.entries(facts).filter(([, v]) => typeof v === 'object' && v !== null && 'ok' in (v as object))
  facts.summary = { landings: landings.length, h1OutOfView: landings.filter(([, v]) => (v as { ok: boolean }).ok === false).map(([k]) => k) }
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[verify2 UX-001 webkit] ${JSON.stringify(facts.summary)}`)
})

// ------------------------------------------------------------------------------------------------ UX-021 on desktop WebKit

/** The focused option: the radio, its card's outline and shadow, and whether the engine counts the focus as keyboard-made. */
const CARD = `(() => {
  const el = document.activeElement
  const input = el && el.matches('input[type=radio]') ? el : null
  const card = input ? input.nextElementSibling : null
  const cs = card ? getComputedStyle(card) : null
  const ics = input ? getComputedStyle(input) : null
  const r = input ? input.getBoundingClientRect() : null
  return {
    active: el ? el.tagName.toLowerCase() + (el.getAttribute('type') ? '[' + el.getAttribute('type') + ']' : '') : '',
    name: input ? (input.getAttribute('aria-label') || '').slice(0, 40) : '',
    checked: input ? input.checked : null,
    focusVisible: input ? input.matches(':focus-visible') : null,
    cardOutline: cs ? cs.outlineWidth + ' ' + cs.outlineStyle + ' ' + cs.outlineColor : null,
    cardOutlineOffset: cs ? cs.outlineOffset : null,
    cardBoxShadow: cs ? cs.boxShadow.slice(0, 100) : null,
    inputOutline: ics ? ics.outlineWidth + ' ' + ics.outlineStyle + ' ' + ics.outlineColor : null,
    inputSize: r ? Math.round(r.width) + 'x' + Math.round(r.height) : null,
    inputOpacity: ics ? ics.opacity : null,
    inputPosition: ics ? ics.position : null,
  }
})()`

const ringShown = (c: { cardOutline: string | null }): boolean => c.cardOutline !== null && !/\bnone\b/.test(c.cardOutline) && !/^0px/.test(c.cardOutline)

test('verify2 UX-021 option card focus ring by keyboard on desktop: Tab in, arrow keys, then a mouse click', async ({ page, browserName }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch === true, 'keyboard scenario')
  test.setTimeout(5 * 60_000)
  const shots = new Shots(page, RUN, `UX-021-focus/${testInfo.project.name}`)
  const log = trackConsole(page)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  const chord = await chordFor(page, browserName)
  facts.chord = chord
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('./favicon.svg')
  await page.evaluate('localStorage.clear(); sessionStorage.clear()')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const route = PREVIEW_ROUTES.find((r) => r.id === 'item-spatial')
  if (route === undefined) throw new Error('no route item-spatial')
  await openRoute(page, route)
  const choice = page.locator('form.choice')
  if ((await choice.count()) === 0) {
    facts.summary = 'no option cards (no WebGL in this browser)'
    shots.json('facts', facts)
    return
  }
  const what = (): Promise<string> => page.evaluate(() => { const el = document.activeElement; return el ? `${el.tagName.toLowerCase()}${el.getAttribute('type') ? `[${el.getAttribute('type')}]` : ''} "${(el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)}"` : '' })
  type Card = { cardOutline: string | null; focusVisible: boolean | null; checked: boolean | null; cardBoxShadow: string | null }
  // A. Tab from wherever the screen put the focus until a radio has it.
  const path: string[] = []
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press(chord)
    path.push(await what())
    if (await page.evaluate(() => document.activeElement?.matches('input[type=radio]') === true)) break
  }
  facts['tab path'] = path
  await page.waitForTimeout(100)
  const a = (await page.evaluate(CARD)) as Card
  facts['A Tab into the group'] = { ...a, ringShown: ringShown(a), shot: await shots.shot('a-tab-into-group', { locator: choice }) }
  // B. ArrowRight twice: the next options, checked as the arrows go.
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(100)
  const b = (await page.evaluate(CARD)) as Card
  facts['B ArrowRight'] = { ...b, ringShown: ringShown(b), shot: await shots.shot('b-arrow-right', { locator: choice }) }
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(100)
  const c = (await page.evaluate(CARD)) as Card
  facts['C ArrowRight again'] = { ...c, ringShown: ringShown(c) }
  // D. Tab away and Shift+Tab back: the checked option gets the focus back.
  await page.keyboard.press(chord)
  const away = await what()
  await page.keyboard.press(chord === 'Tab' ? 'Shift+Tab' : 'Alt+Shift+Tab')
  await page.waitForTimeout(100)
  const d = (await page.evaluate(CARD)) as Card
  facts['D Tab away and back'] = { away, ...d, ringShown: ringShown(d), shot: await shots.shot('d-shift-tab-back', { locator: choice }) }
  // E. The mouse: a click on the first option (the radio lies over its card; a pointer focus should not draw the keyboard ring in either engine).
  await choice.getByRole('radio').first().click()
  await page.waitForTimeout(100)
  const e = (await page.evaluate(CARD)) as Card
  facts['E mouse click on a card'] = { ...e, ringShown: ringShown(e), shot: await shots.shot('e-mouse-click', { locator: choice }) }
  // F. The keyboard again after the mouse: ArrowRight from the clicked option.
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(100)
  const f = (await page.evaluate(CARD)) as Card
  facts['F ArrowRight after the click'] = { ...f, ringShown: ringShown(f), shot: await shots.shot('f-arrow-after-click', { locator: choice }) }
  facts.summary = { chord, tabIn: { ringShown: ringShown(a), focusVisible: a.focusVisible, checked: a.checked, outline: a.cardOutline }, arrow: { ringShown: ringShown(b), focusVisible: b.focusVisible, checked: b.checked, outline: b.cardOutline, shadow: b.cardBoxShadow }, back: { ringShown: ringShown(d), focusVisible: d.focusVisible }, mouse: { ringShown: ringShown(e), focusVisible: e.focusVisible }, arrowAfterMouse: { ringShown: ringShown(f), focusVisible: f.focusVisible } }
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[verify2 UX-021 focus] ${JSON.stringify(facts.summary)}`)
})
