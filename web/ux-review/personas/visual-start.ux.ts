/// <reference lib="dom" />
/**
 * Visual designer A (package rev-visual-start; run id `visual-start`): the start funnel, the in-session screens and the
 * privacy page, photographed at 320-1440 px in light and dark, on an iPhone, and at 200% text, with metrics.
 * Each test is one chunk of routes so a run stays short:
 *
 *   UX_PORT=4619 UX_RUN=visual-start npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/visual-start.ux.ts --project=chromium --grep 'visual-start: tour start-a$'
 *
 * Output: web/test-results/ux-review/visual-start/<sub>/... where <sub> is tour-chromium, tour-iphone, tour-zoom200 or
 * details-<project>. The details tests write JSON of measured styles next to their screenshots.
 */

import { test, type Page } from '@playwright/test'
import { toReady } from '../../e2e/flow'
import { openRoute, PREVIEW_ROUTES } from '../../e2e/routes'
import { Shots, tour, trackConsole } from '../lib'

const RUN = process.env.UX_RUN ?? 'visual-start'

const CHUNKS: Readonly<Record<string, readonly string[]>> = {
  'start-a': ['welcome', 'gate', 'gate-error', 'gate-under-18', 'privacy', 'honour'],
  'start-b': ['device', 'ready', 'ready-returning', 'practice', 'practice-feedback'],
  'session-a': ['interstitial', 'rt-intro', 'rt-trial', 'item-matrix-series', 'confidence'],
  'session-b': ['confirm-skip', 'confirm-finish', 'item-spatial', 'item-spatial-no-webgl', 'memory-intro'],
  'session-c': ['memory-entry', 'memory-corsi', 'quant-item', 'coding-intro', 'coding-running'],
  'session-d': ['reading-passage', 'reading-questions', 'break-offer', 'on-break', 'finished-nothing'],
}

const DESKTOP_WIDTHS = [320, 390, 768, 1024, 1280, 1440] as const

for (const [chunk, routes] of Object.entries(CHUNKS)) {
  test(`visual-start: tour ${chunk}`, async ({ context }, testInfo) => {
    const project = testInfo.project.name
    const touch = testInfo.project.use.hasTouch === true
    await tour(context, {
      runId: RUN,
      sub: `tour-${project}`,
      routes,
      widths: touch ? undefined : DESKTOP_WIDTHS,
      schemes: ['light', 'dark'],
      touch,
      metrics: true,
    })
  })

  test(`visual-start: zoom ${chunk}`, async ({ context }, testInfo) => {
    test.skip(testInfo.project.use.hasTouch === true, 'text zoom is sampled on desktop Chromium at 390 and 1280')
    await tour(context, { runId: RUN, sub: `tour-zoom200-${testInfo.project.name}`, routes, widths: [390, 1280], schemes: ['light'], textZoom: 200, metrics: true })
  })

  test(`visual-start: axe-dark ${chunk}`, async ({ context }, testInfo) => {
    test.skip(testInfo.project.use.hasTouch === true, 'dark-mode axe is run on desktop')
    await tour(context, { runId: RUN, sub: `tour-axe-${testInfo.project.name}`, routes, widths: [1280], schemes: ['dark', 'light'], axe: true, metrics: true })
  })
}

/** Computed styles of the elements a visual review compares across screens. */
const STYLE_PROBE = `(() => {
  const pick = (el) => {
    const s = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 4).join('.') : ''),
      text: (el.innerText || el.textContent || '').trim().slice(0, 50),
      w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top + window.scrollY),
      font: s.fontSize + '/' + s.lineHeight + ' ' + s.fontWeight,
      color: s.color, bg: s.backgroundColor, border: s.borderTopWidth + ' ' + s.borderTopStyle + ' ' + s.borderTopColor, radius: s.borderTopLeftRadius,
      padding: s.padding, margin: s.margin, outline: s.outlineWidth + ' ' + s.outlineStyle + ' ' + s.outlineColor + ' off ' + s.outlineOffset,
    }
  }
  const q = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 0).map(pick)
  return {
    body: pick(document.body), html: { bg: getComputedStyle(document.documentElement).backgroundColor },
    main: q('main'), h1: q('h1'), h2: q('h2'), p: q('p').slice(0, 12), buttons: q('button'), links: q('a'), inputs: q('input, textarea, select'),
    fieldsets: q('fieldset'), labels: q('label').slice(0, 10), sections: q('section, aside, nav, header, details'),
  }
})()`

async function probe(page: Page, shots: Shots, name: string): Promise<void> {
  try {
    shots.json(name, await page.evaluate(STYLE_PROBE))
  } catch (error) {
    shots.json(name, { error: String(error) })
  }
}

/** Tab until an element matching `selector` has focus (at most `max` presses). */
async function tabTo(page: Page, selector: string, max = 12): Promise<boolean> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab')
    if (await page.evaluate((s) => document.activeElement?.matches(s) ?? false, selector)) return true
  }
  return false
}

const route = (id: string) => {
  const r = PREVIEW_ROUTES.find((x) => x.id === id)
  if (r === undefined) throw new Error(`no route ${id}`)
  return r
}

/** Open a route on a reused page: empty the app's storage first (a stored consent record skips the gate, so the route's own path would fail). */
async function openFresh(page: Page, id: string): Promise<void> {
  await page.goto('./favicon.svg')
  await page.evaluate('localStorage.clear(); sessionStorage.clear()')
  await openRoute(page, route(id))
}

test('visual-start: details focus', async ({ page }, testInfo) => {
  const shots = new Shots(page, RUN, `details-focus-${testInfo.project.name}`)
  trackConsole(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    await page.goto('./')
    await tabTo(page, 'button.hb-primary')
    await shots.shot(`welcome-focus-start-${colorScheme}`, { fullPage: false })
    await tabTo(page, 'a')
    await shots.shot(`welcome-focus-link-${colorScheme}`, { fullPage: false })
    await probe(page, shots, `welcome-styles-${colorScheme}`)
  }
  // Gate: the checkbox and the secondary button with focus.
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    await openFresh(page, 'gate')
    await tabTo(page, 'input[type=checkbox]')
    await shots.shot(`gate-focus-checkbox-${colorScheme}`, { fullPage: false })
    await tabTo(page, 'button:not(.hb-primary)')
    await shots.shot(`gate-focus-secondary-${colorScheme}`, { fullPage: false })
    await probe(page, shots, `gate-styles-${colorScheme}`)
  }
})

test('visual-start: details device-ready', async ({ page }, testInfo) => {
  const shots = new Shots(page, RUN, `details-device-${testInfo.project.name}`)
  trackConsole(page)
  await page.setViewportSize({ width: 390, height: 844 })
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    await openFresh(page, 'device')
    await tabTo(page, 'input[type=radio]')
    await shots.shot(`device-focus-radio-390-${colorScheme}`, { fullPage: true })
    await probe(page, shots, `device-styles-${colorScheme}`)
    // The device route leaves a consent record, after which the welcome screen has no Start button: start clean.
    await page.goto('./favicon.svg')
    await page.evaluate('localStorage.clear(); sessionStorage.clear()')
    await toReady(page)
    await shots.shot(`ready-viewport-390-${colorScheme}`, { fullPage: false })
    await probe(page, shots, `ready-styles-${colorScheme}`)
  }
})

test('visual-start: details session', async ({ page }, testInfo) => {
  const shots = new Shots(page, RUN, `details-session-${testInfo.project.name}`)
  trackConsole(page)
  for (const [w, h] of [
    [390, 844],
    [1280, 800],
  ] as const) {
    await page.setViewportSize({ width: w, height: h })
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
      await openFresh(page, 'interstitial')
      await shots.shot(`interstitial-viewport-${w}-${colorScheme}`, { fullPage: false })
      await probe(page, shots, `interstitial-styles-${w}-${colorScheme}`)
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 })
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    await openFresh(page, 'confidence')
    await shots.shot(`confidence-viewport-1280-${colorScheme}`, { fullPage: false })
    await probe(page, shots, `confidence-styles-${colorScheme}`)
    await openFresh(page, 'item-matrix-series')
    await tabTo(page, 'input, button.hb-primary')
    await shots.shot(`item-focus-1280-${colorScheme}`, { fullPage: false })
    await probe(page, shots, `item-styles-${colorScheme}`)
  }
})

test('visual-start: details motion', async ({ page }, testInfo) => {
  const shots = new Shots(page, RUN, `details-motion-${testInfo.project.name}`)
  trackConsole(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' })
  await openFresh(page, 'rt-intro')
  await page.getByRole('button', { name: 'Start practice' }).click()
  for (let i = 0; i < 6; i++) {
    await shots.shot(`rt-trial-motion-${i}`, { fullPage: false })
    await page.waitForTimeout(300)
  }
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' })
  for (let i = 0; i < 4; i++) {
    await shots.shot(`rt-trial-motion-dark-${i}`, { fullPage: false })
    await page.waitForTimeout(300)
  }
})

/** Where the interactive parts of a screen sit relative to the first viewport (the fold). */
const FOLD_PROBE = `(() => {
  const vh = window.innerHeight
  const rect = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top + window.scrollY), bottom: Math.round(r.bottom + window.scrollY), h: Math.round(r.height), w: Math.round(r.width) } }
  const named = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 0).map((e) => ({ sel, text: (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 30), ...rect(e) }))
  return {
    viewport: { w: window.innerWidth, h: vh }, scrollHeight: document.documentElement.scrollHeight,
    header: named('.top, .bar').slice(0, 2), status: named('p.status'), h1: named('h1'),
    stimulus: named('.stage, .board, .grid, .pads, .legend, svg.cell, canvas, .passage, fieldset'),
    buttons: named('button').map((b) => ({ ...b, belowFold: b.bottom > vh })),
    confirmH2: [...document.querySelectorAll('section.confirm h2')].map((h) => ({ marginTop: getComputedStyle(h).marginTop, top: rect(h).top, panelTop: rect(h.parentElement).top })),
    checks: [...document.querySelectorAll('[data-focus-form] .check')].map((c) => ({ margin: getComputedStyle(c).margin, ...rect(c) })),
  }
})()`

for (const [id, ids] of [
  ['small', ['coding-running', 'memory-corsi', 'rt-trial', 'item-matrix-series', 'confidence', 'item-spatial', 'memory-entry', 'reading-questions']],
  ['panels', ['confirm-skip', 'confirm-finish', 'ready-returning', 'practice', 'item-spatial-no-webgl']],
] as const) {
  test(`visual-start: fold ${id}`, async ({ browser }, testInfo) => {
    const project = testInfo.project.name
    // iphone-se is the small phone; on desktop Chromium the same check runs at 320 x 568 (the smallest common phone viewport).
    const shotsDir = `fold-${project}`
    for (const rid of ids) {
      const r = route(rid)
      const context = await browser.newContext(project.startsWith('iphone') || project === 'pixel' ? {} : { viewport: { width: 320, height: 568 } })
      const page = await context.newPage()
      const shots = new Shots(page, RUN, `${shotsDir}/${rid}`)
      trackConsole(page)
      try {
        await r.prepare?.(page)
        if (r.motion !== 'allow') await page.emulateMedia({ reducedMotion: 'reduce' })
        await openRoute(page, r)
        await page.waitForTimeout(300)
        // As shown: wherever the app's own focus moves left the scroll position.
        const scrollY = await page.evaluate('window.scrollY')
        await shots.shot('viewport-as-shown', { fullPage: false })
        shots.json('fold', { scrollYAsShown: scrollY, ...((await page.evaluate(FOLD_PROBE)) as object) })
      } catch (error) {
        shots.json('error', { error: String(error) })
      }
      await context.close()
    }
  })
}

test('visual-start: details options', async ({ page }, testInfo) => {
  const shots = new Shots(page, RUN, `details-options-${testInfo.project.name}`)
  trackConsole(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    await openFresh(page, 'practice')
    // Focus on an option card (blue ring from OptionGroup's --hb-focus) and then on Back (amber ring from --r-focus).
    await tabTo(page, 'input[type=radio]', 20)
    await page.keyboard.press('ArrowRight')
    await shots.shot(`practice-focus-option-${colorScheme}`, { fullPage: true })
    await tabTo(page, 'button', 6)
    await shots.shot(`practice-focus-confirm-${colorScheme}`, { fullPage: true })
    await tabTo(page, 'button:not([disabled])', 6)
    await shots.shot(`practice-focus-next-${colorScheme}`, { fullPage: true })
    shots.json(`practice-sizes-${colorScheme}`, await page.evaluate(`(() => ({
      matrixCells: [...document.querySelectorAll('.grid svg.cell, .grid svg')].slice(0, 9).map((s) => Math.round(s.getBoundingClientRect().width)),
      optionCells: [...document.querySelectorAll('.options svg')].map((s) => Math.round(s.getBoundingClientRect().width)),
      focused: document.activeElement ? document.activeElement.outerHTML.slice(0, 80) : '',
    }))()`))
  }
  for (const w of [390, 768]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
    await openFresh(page, 'practice')
    shots.json(`practice-sizes-${w}`, await page.evaluate(`(() => ({
      matrixCells: [...document.querySelectorAll('.grid svg')].slice(0, 9).map((s) => Math.round(s.getBoundingClientRect().width)),
      optionCells: [...document.querySelectorAll('.options svg')].map((s) => Math.round(s.getBoundingClientRect().width)),
    }))()`))
  }
})
