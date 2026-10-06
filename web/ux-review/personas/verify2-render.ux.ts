/// <reference lib="dom" />
/**
 * Verification package 2 (run id `verify2`), render items of wave 2: UX-023 (the Corsi board at 320 x 568 and 390 x 664:
 * Done inside the first screen in every phase, no shift after Done, blocks 44 px or larger) and the OptionGroup card
 * border on paper (light whatever the screen's scheme). Evidence under web/test-results/ux-review/verify2/<item>/<project>/.
 *
 *   UX_PORT=4771 UX_RUN=verify2 npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/verify2-render.ux.ts --project=iphone
 */

import { expect, test, type Locator, type Page } from '@playwright/test'
import { CORSI_BOARD } from '../../src/tasks/span/config'
import { button, h1 } from '../../e2e/flow'
import { intoSegment, openRoute, PREVIEW_ROUTES, type Route } from '../../e2e/routes'
import { Shots, trackConsole } from '../lib'

const RUN = process.env.UX_RUN ?? 'verify2'

test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 })

function routeOf(id: string): Route {
  const r = PREVIEW_ROUTES.find((x) => x.id === id)
  if (r === undefined) throw new Error(`no route ${id}`)
  return r
}

async function open(page: Page, id: string): Promise<void> {
  await page.goto('./favicon.svg')
  await page.evaluate('localStorage.clear(); sessionStorage.clear()')
  const r = routeOf(id)
  await r.prepare?.(page)
  if (r.motion !== 'allow') await page.emulateMedia({ reducedMotion: 'reduce' })
  await openRoute(page, r)
}

async function press(touch: boolean, target: Locator): Promise<void> {
  if (touch) await target.tap()
  else await target.click()
}

interface Box {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
  readonly width: number
  readonly height: number
}

interface Sample {
  readonly status: string
  readonly board: Box
  readonly slot: Box | null
  readonly done: Box | null
  readonly undo: Box | null
  readonly scrollY: number
  readonly innerHeight: number
  readonly scrollWidth: number
  readonly clientWidth: number
  readonly docHeight: number
}

/** Records, every animation frame, where the board, the row of Undo and Done and the buttons are (viewport coordinates). */
const SAMPLER = `(() => {
  const log = []
  window.__corsiLog = log
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height } }
  const tick = () => {
    const board = document.querySelector('.corsi .board')
    if (board) {
      const buttons = [...document.querySelectorAll('.corsi .hb-actions button')]
      const named = (name) => buttons.find((b) => (b.textContent || '').trim() === name) || null
      log.push({ status: ((document.querySelector('.corsi .hb-status') || {}).textContent || '').trim(), board: box(board), slot: box(document.querySelector('.corsi .hb-actions')), done: box(named('Done')), undo: box(named('Undo')), scrollY: window.scrollY, innerHeight: window.innerHeight, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, docHeight: document.documentElement.scrollHeight })
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})()`

// ------------------------------------------------------------------------------------------------ UX-023

test('verify2 UX-023 Corsi: Done in the first screen at 320x568 and 390x664, no shift after Done, blocks 44 px', async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000)
  const touch = testInfo.project.use.hasTouch === true
  const shots = new Shots(page, RUN, `UX-023/${testInfo.project.name}`)
  const log = trackConsole(page)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  for (const vp of [{ width: 390, height: 664 }, { width: 320, height: 568 }]) {
    const key = `${vp.width}x${vp.height}`
    await page.setViewportSize(vp)
    await page.goto('./favicon.svg')
    await page.evaluate('localStorage.clear(); sessionStorage.clear()')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    // Into the Working Memory part, through the digit-span block, to the Corsi board (the route plays the digits with the driver).
    await open(page, 'memory-corsi')
    // The dev-only fast-mode banner is hidden (production has none) and the page is at its top, as the verifier measured in wave 1.
    await page.addStyleTag({ content: '.banner[role=note] { display: none !important; }' })
    await page.evaluate(() => scrollTo(0, 0))
    await page.evaluate(SAMPLER)
    await page.waitForTimeout(300)
    const rects = async (sel: string): Promise<Box[]> => page.evaluate<Box[]>(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height } })`)
    const blocks = await rects('section.hb-render.corsi button.block')
    const board = (await rects('section.hb-render.corsi .board'))[0] ?? null
    const overlaps: string[] = []
    for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) { const a = blocks[i]!, b = blocks[j]!; if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) overlaps.push(`${i + 1}/${j + 1}`) }
    const centres = board === null ? [] : blocks.map((b, i) => { const spec = CORSI_BOARD.blocks[i]; const cx = (b.left + b.width / 2 - board.left) / board.width; const cy = (b.top + b.height / 2 - board.top) / board.height; return spec === undefined ? null : { dx: Math.round((cx - spec[0]) * board.width * 10) / 10, dy: Math.round((cy - spec[1]) * board.height * 10) / 10 } })
    facts[`${key} entry screen`] = {
      h1Top: Math.round((await rects('h1'))[0]?.top ?? -1),
      scrollY: await page.evaluate(() => Math.round(scrollY)),
      board: board === null ? null : { top: Math.round(board.top), left: Math.round(board.left), w: Math.round(board.width), h: Math.round(board.height), centred: Math.abs(board.left - (vp.width - board.right)) <= 2, leftGap: Math.round(board.left), rightGap: Math.round(vp.width - board.right) },
      blocks: blocks.length,
      smallestBlock: Math.round(Math.min(...blocks.map((b) => Math.min(b.width, b.height))) * 10) / 10,
      under44: blocks.filter((b) => Math.min(b.width, b.height) < 44).length,
      overlaps,
      insideBoard: board === null ? null : blocks.every((b) => b.left >= board.left - 0.5 && b.top >= board.top - 0.5 && b.right <= board.right + 0.5 && b.bottom <= board.bottom + 0.5),
      centreError: centres,
      done: (await rects('section.hb-render.corsi button.hb-primary'))[0] ?? null,
      doneInFirstScreen: await page.locator('section.hb-render.corsi button.hb-primary').evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight }).catch(() => null),
      status: await page.locator('.corsi .hb-status').innerText(),
      overflowX: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      shot: await shots.shot(`${key}-entry-viewport`, { fullPage: false }),
    }
    // Press three blocks and Done; the pause, then the next sequence and its entry; every frame sampled.
    const before = (await rects('section.hb-render.corsi .board'))[0] ?? null
    for (const k of [0, 1, 2]) await press(touch, page.locator('section.hb-render.corsi button.block').nth(k))
    await press(touch, page.locator('section.hb-render.corsi').getByRole('button', { name: 'Done' }))
    await page.waitForTimeout(400)
    facts[`${key} right after Done`] = { scrollY: await page.evaluate(() => Math.round(scrollY)), board: (await rects('section.hb-render.corsi .board'))[0] ?? null, status: await page.locator('.corsi .hb-status').innerText(), shot: await shots.shot(`${key}-after-done-viewport`, { fullPage: false }) }
    await expect(page.locator('section.hb-render.corsi').getByRole('button', { name: 'Done' })).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(300)
    const after = (await rects('section.hb-render.corsi .board'))[0] ?? null
    const samples = (await page.evaluate<Sample[]>('window.__corsiLog')) ?? []
    const withDone = samples.filter((s) => s.done !== null)
    const spread = (xs: number[]): number => (xs.length === 0 ? 0 : Math.round((Math.max(...xs) - Math.min(...xs)) * 10) / 10)
    facts[`${key} next entry`] = { board: after, boardMovedPx: before !== null && after !== null ? Math.round(Math.hypot(after.left - before.left, after.top - before.top) * 10) / 10 : null, shot: await shots.shot(`${key}-next-entry-viewport`, { fullPage: false }) }
    facts[`${key} frames`] = {
      sampled: samples.length,
      framesWithDone: withDone.length,
      doneBottomMax: withDone.length === 0 ? null : Math.round(Math.max(...withDone.map((s) => s.done!.bottom)) * 10) / 10,
      doneAlwaysInFirstScreen: withDone.length > 0 && withDone.every((s) => s.done!.bottom <= s.innerHeight && s.done!.top >= 0),
      slotBottomMax: Math.round(Math.max(...samples.map((s) => s.slot?.bottom ?? 0)) * 10) / 10,
      scrollYMax: Math.max(...samples.map((s) => s.scrollY)),
      boardTopSpread: spread(samples.map((s) => s.board.top)),
      boardLeftSpread: spread(samples.map((s) => s.board.left)),
      boardHeightSpread: spread(samples.map((s) => s.board.height)),
      docHeightSpread: spread(samples.map((s) => s.docHeight)),
      sideways: samples.some((s) => s.scrollWidth > s.clientWidth),
      statuses: [...new Set(samples.map((s) => s.status))].slice(0, 8),
    }
  }
  const ok = (k: string): unknown => { const e = facts[`${k} entry screen`] as { doneInFirstScreen: boolean | null; under44: number; overlaps: string[] }; const f = facts[`${k} frames`] as { doneAlwaysInFirstScreen: boolean; boardTopSpread: number; scrollYMax: number }; const n = facts[`${k} next entry`] as { boardMovedPx: number | null }; return { doneInFirstScreen: e.doneInFirstScreen, doneAlwaysInFirstScreen: f.doneAlwaysInFirstScreen, under44: e.under44, overlaps: e.overlaps.length, boardTopSpread: f.boardTopSpread, scrollYMax: f.scrollYMax, boardMovedAfterDone: n.boardMovedPx } }
  facts.summary = { '390x664': ok('390x664'), '320x568': ok('320x568') }
  shots.json('facts', facts)
  shots.json('console', log)
  console.log(`[verify2 UX-023] ${JSON.stringify(facts.summary)}`)
})

// ------------------------------------------------------------------------------------------------ OptionGroup on paper

test('verify2 OptionGroup card border prints light whatever the screen scheme', async ({ page }, testInfo) => {
  test.setTimeout(5 * 60_000)
  const shots = new Shots(page, RUN, `OptionGroup-print/${testInfo.project.name}`)
  const facts: Record<string, unknown> = { project: testInfo.project.name }
  await page.setViewportSize({ width: 1024, height: 800 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  // A real spatial item (the first choice item with option cards); the practice route has cards too and needs no WebGL.
  await intoSegment(page, 2)
  const choice = page.locator('form.choice')
  await expect(choice.or(page.locator('.unavailable'))).toBeVisible({ timeout: 30_000 })
  let where = 'spatial item'
  if ((await choice.count()) === 0) {
    // No WebGL here: use the practice's first multiple-choice question instead.
    where = 'practice choice item'
    await open(page, 'practice')
    for (let i = 0; i < 6 && (await choice.count()) === 0; i++) {
      const box = page.locator('form.entry input[type=text]')
      if ((await box.count()) === 0) break
      await box.fill((await box.evaluate((el) => el.classList.contains('letter'))) ? 'A' : '1')
      await page.locator('form.entry').getByRole('button', { name: 'Submit', exact: true }).click()
      await expect(page.getByRole('slider')).toBeVisible()
      await button(page, 'Continue').click()
      await expect(page.getByText(/That was (not )?correct\./)).toBeVisible()
      const next = button(page, 'Next practice question')
      if ((await next.count()) === 0) break
      await next.click()
      await page.waitForTimeout(300)
    }
  }
  facts.where = where
  if ((await choice.count()) === 0) {
    facts.summary = 'no option cards reached'
    shots.json('facts', facts)
    return
  }
  const look = async (media: 'screen' | 'print', colorScheme: 'light' | 'dark'): Promise<Record<string, string>> => {
    await page.emulateMedia({ media, colorScheme, reducedMotion: 'reduce' })
    await page.waitForTimeout(200)
    return choice.evaluate((form) => {
      const card = form.querySelector('.card') as HTMLElement
      const cs = getComputedStyle(card)
      return { token: getComputedStyle(form).getPropertyValue('--hb-card-border').trim(), border: cs.borderTopColor, borderWidth: cs.borderTopWidth, surface: cs.backgroundColor, text: cs.color, pageBg: getComputedStyle(document.body).backgroundColor }
    })
  }
  facts['screen light'] = await look('screen', 'light')
  facts['screen dark'] = { ...(await look('screen', 'dark')), shot: await shots.shot('screen-dark', { locator: choice }) }
  facts['print light'] = await look('print', 'light')
  facts['print dark'] = { ...(await look('print', 'dark')), shot: await shots.shot('print-dark', { locator: choice }) }
  const pl = facts['print light'] as Record<string, string>
  const pd = facts['print dark'] as Record<string, string>
  const sl = facts['screen light'] as Record<string, string>
  facts.summary = { printDarkBorder: pd.border, printLightBorder: pl.border, screenLightBorder: sl.border, printDarkEqualsLight: pd.border === pl.border && pd.surface === pl.surface, printDarkSurface: pd.surface, screenDarkBorder: (facts['screen dark'] as Record<string, string>).border }
  shots.json('facts', facts)
  console.log(`[verify2 OptionGroup print] ${JSON.stringify(facts.summary)}`)
  await page.emulateMedia({ media: 'screen', colorScheme: 'light' })
  await expect(h1(page)).toBeVisible()
})
