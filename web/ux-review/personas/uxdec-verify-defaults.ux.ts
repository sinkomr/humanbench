/// <reference lib="dom" />
/**
 * uxdec verification, the provisional defaults (UX-REVIEW §2, D4 to D28 less the owner decisions) and the decisions
 * that were to stay unchanged (D14 outcome, D15 B, D29, D30, D31). Each test replays the scenario of its UX-REVIEW
 * entry on the production build and records facts and screenshots under
 * web/test-results/ux-review/uxdec-verify/<item>/<project>/.
 *
 *   UX_PORT=4761 UX_RUN=uxdec-verify UX_DIST=test-results/ux-review/uxdec-verify/_dist \
 *     npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/uxdec-verify-defaults.ux.ts --project=chromium
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { META_DESCRIPTION } from '../../src/copy'
import { THOUSANDS_NOTE } from '../../src/render/common/entry-copy'
import { SAVE_HOLDS_NOTES } from '../../src/reveal/copy'
import { AUTOSAVE_PREFIX } from '../../src/save/autosave'
import { CONSENT_KEY, TERMS_VERSION } from '../../src/session/constants'
import { HONOUR_LEAD, HONOUR_TEXT, WELCOME_RETURNING_LABEL } from '../../src/session/copy'
import { STUB_CAPTION } from '../../src/viz/copy'
import { answerItem, button, h1, simulatedSave, toReady, toResults } from '../../e2e/flow'
import { setTextZoomNow } from '../../e2e/layout'
import { intoSegment, PREVIEW_ROUTES, toGate, toHonour, toInterstitial, type Route } from '../../e2e/routes'
import { SessionDriver } from '../../e2e/session-driver'
import { measureResults } from '../../e2e/uxdec-reveal'
import { REPO_ROOT } from '../lib'
import { bodyText, buttonsOf, download, Facts, focused, fresh, NO_SHARE_SHEET, press, settle, SHARE_SHEET_FILES } from './uxdec-verify-shared.ux'

test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 })

const BASE_COMMIT = '9f68f49'
const QUANT_GROUPS = ['Arithmetic, fractions and percentages', 'Ratios, rates and averages', 'Linear equations and systems', 'Powers and quadratics', 'Probability and counting', 'Series and number puzzles']

function routeOf(id: string): Route {
  const r = PREVIEW_ROUTES.find((x) => x.id === id)
  if (r === undefined) throw new Error(`no route ${id}`)
  return r
}

async function resultsBuilt(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await toResults(page)
  await expect(button(page, 'Download save file')).toBeVisible()
}

/** The autosave of the running session (the one key under the prefix). */
async function autosave(page: Page): Promise<{ responses: unknown[][]; flags: Record<string, unknown> }> {
  return page.evaluate((prefix) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith(prefix))
    const save = JSON.parse(localStorage.getItem(key ?? '') ?? '{}') as { sessions?: { responses: unknown[][]; flags: Record<string, unknown> }[] }
    const s = save.sessions?.[save.sessions.length - 1]
    return { responses: s?.responses ?? [], flags: s?.flags ?? {} }
  }, AUTOSAVE_PREFIX)
}

// ------------------------------------------------------------------------------------------------ D4

test('uxdec-verify D4: facet panels carry the leave-facet-out caption; Quantitative facets are topic groups', async ({ page }, info) => {
  const f = new Facts(page, info, 'D4')
  // Two sessions a week apart: with one, no facet has its 5 questions yet and the panel shows the UX-041 line, not the caption.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await toResults(page, 2)
  await expect(button(page, 'Download save file')).toBeVisible()
  const clusters = await page.locator('.drill-buttons button').allInnerTexts()
  f.check('cluster buttons on this profile', null, clusters)
  let withCaption = 0
  for (const c of clusters) {
    await page.getByRole('button', { name: c, exact: true }).click()
    const panel = page.locator('section.facet-panel')
    await expect(panel).toBeVisible()
    // textContent: the facet chart's description and the table caption are for assistive technology (hidden from innerText).
    const text = await panel.evaluate((el) => (el.textContent ?? '').replace(/[ \t]+/g, ' '))
    if (/has enough data yet|No facets have been measured/.test(text)) {
      f.check(`${c}: no facet measured or none with enough data on this profile (UX-041 line, no caption)`, null, text.slice(0, 160))
    } else {
      withCaption++
      f.check(`${c}: caption says a facet draws on the rest of its skill`, /Each facet's range also draws on the rest of its skill/.test(text), text.slice(0, 300))
    }
    if (c === 'Quantitative') {
      const groups = QUANT_GROUPS.filter((g) => text.includes(g))
      const templates = ['Percentages', 'Arithmetic', 'Fractions of amounts', 'Linear equations', 'Averages'].filter((t) => new RegExp(`(^|\\n)${t}(\\n|$)`).test(text))
      f.check('Quantitative facets are the six topic groups (present ones), not one per template', groups.length > 0 && templates.length === 0, { groups, templates, text: text.slice(0, 400) })
    }
    await f.shot(`facets-${c}`, { locator: panel })
    await page.getByRole('button', { name: c, exact: true }).click()
  }
  f.check('at least one cluster showed facet estimates with the caption', withCaption > 0, withCaption)
  f.save()
})

// ------------------------------------------------------------------------------------------------ D6

test('uxdec-verify D6: an unfinished session is offered for continuation on the ready screen', async ({ page }, info) => {
  const f = new Facts(page, info, 'D6')
  await routeOf('ready-continue').open(page)
  const note = page.locator('[id$="-continue-note"]')
  const line = (await note.innerText()).trim()
  f.check('continue line names the part and says Begin starts a new session', /was not finished\. Continue it to go on from the start of (.+?) and keep what you have done so far\. Begin starts a new session instead\./.test(line), line)
  const part = /start of (.+?) and keep/.exec(line)?.[1] ?? ''
  f.check('continue line part name is Title Case (D25)', part !== '' && part === part.replace(/\b\w/g, (c) => c.toUpperCase()), part)
  const buttons = await buttonsOf(page.locator('main, body').first())
  f.check('"Continue your unfinished session" is a primary button; Begin is still there', buttons.some((b) => b.name === 'Continue your unfinished session' && b.primary) && buttons.some((b) => b.name === 'Begin'), buttons.filter((b) => /Continue your|Begin/.test(b.name)))
  await f.all('ready-continue')
  await f.axe('ready with the continue offer')
  await press(f.touch, button(page, 'Continue your unfinished session'))
  await expect(h1(page)).toHaveText(/^Up next: /)
  const next = ((await h1(page).textContent()) ?? '').trim()
  f.check('Continue goes to the Up next screen of the named part', next === `Up next: ${part}`, { next, part })
  await f.all('after-continue')
  f.save()
})

// ------------------------------------------------------------------------------------------------ D7

test('uxdec-verify D7: an untouched confidence slider is recorded as not rated and counted', async ({ page }, info) => {
  const f = new Facts(page, info, 'D7')
  const driver = new SessionDriver(page, { touch: f.touch })
  await driver.toReady('./?fast=1')
  await driver.begin()
  await driver.skipPart()
  await expect(h1(page)).toHaveText('Up next: Matrix & Series')
  await driver.press(button(page, 'Start'))
  await answerItem(page) // Continue with the slider where it started
  await expect.poll(async () => (await autosave(page)).responses.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1)
  let save = await autosave(page)
  const first = save.responses[save.responses.length - 1] ?? []
  f.check('untouched slider: confidence_pct is null in the response tuple', first[5] === null, first)
  f.check('untouched slider: flags.confidence_untouched_n is 1', save.flags.confidence_untouched_n === 1, save.flags)
  await f.all('after-untouched-continue')
  // The next item, with the slider moved.
  const choice = page.locator('form.choice')
  const entry = page.locator('form.entry')
  await expect(choice.or(entry)).toBeVisible()
  if ((await choice.count()) > 0) {
    await driver.tick(choice.getByRole('radio').first())
    await driver.press(button(page, 'Confirm'))
  } else {
    const box = entry.locator('input[type=text]')
    await box.fill((await box.evaluate((el) => el.classList.contains('letter'))) ? 'A' : '1')
    await driver.press(entry.getByRole('button', { name: 'Submit', exact: true }))
  }
  const slider = page.getByRole('slider')
  await expect(slider).toBeVisible()
  await slider.fill('70')
  await driver.press(button(page, 'Continue'))
  await expect.poll(async () => (await autosave(page)).responses.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2)
  save = await autosave(page)
  const second = save.responses[save.responses.length - 1] ?? []
  f.check('moved slider: confidence_pct is a number', typeof second[5] === 'number', second[5])
  f.check('moved slider: the untouched counter stays 1', save.flags.confidence_untouched_n === 1, save.flags)
  f.save()
})

// ------------------------------------------------------------------------------------------------ D8

test('uxdec-verify D8: the quantitative entry reads a decimal comma, refuses the thousands form with a note, hints say whole number', async ({ page }, info) => {
  const f = new Facts(page, info, 'D8')
  await intoSegment(page, 4)
  const entry = page.locator('form.entry')
  await expect(entry).toBeVisible()
  const box = entry.locator('input[type=text]')
  const submit = entry.getByRole('button', { name: 'Submit', exact: true })
  const hint = await entry.innerText()
  f.check('hint says "whole number", never "integer"', !/\binteger\b/i.test(hint), hint.replace(/\s+/g, ' ').slice(0, 300))
  await box.fill('1,500')
  await press(f.touch, submit)
  const thousands = await page.getByText(THOUSANDS_NOTE).isVisible({ timeout: 3000 }).catch(() => false)
  f.check('"1,500" is refused with the thousands note', thousands)
  await f.all('entry-1500-refused')
  await box.fill('3,5')
  await press(f.touch, submit)
  const slider = page.getByRole('slider')
  const accepted = await slider.isVisible({ timeout: 3000 }).catch(() => false)
  const wholeNumberItem = /whole number/i.test(hint) && !/fraction/i.test(hint)
  const noteText = accepted ? '' : (await entry.innerText()).replace(/\s+/g, ' ')
  f.check('"3,5" is read as 3.5 (or, on a whole-number item, gets the whole-number note)', accepted || (wholeNumberItem && /whole number/.test(noteText)), { accepted, wholeNumberItem, note: noteText.slice(0, 300) })
  if (!accepted) {
    await f.all('entry-3-5-on-whole-number-item')
    await box.fill('7')
    await press(f.touch, submit)
    await expect(slider).toBeVisible()
  }
  await f.all('entry-accepted')
  // On to the next items until one takes decimals or fractions: there "3,5" must be read as 3.5.
  let decimalSeen = accepted
  for (let n = 0; n < 6 && !decimalSeen; n++) {
    await press(f.touch, button(page, 'Continue'))
    const next = await Promise.race([entry.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'entry'), page.locator('form.choice').waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'choice'), h1(page).filter({ hasText: /^Up next:/ }).waitFor({ timeout: 15_000 }).then(() => 'next')]).catch(() => 'other')
    if (next !== 'entry') break
    const hintN = await entry.innerText()
    if (/whole number/i.test(hintN) && !/fraction|decimal/i.test(hintN)) {
      await box.fill('7')
      await press(f.touch, submit)
      await expect(slider).toBeVisible()
      continue
    }
    await box.fill('3,5')
    await press(f.touch, submit)
    const ok = await slider.isVisible({ timeout: 3000 }).catch(() => false)
    f.check('a decimal or fraction item reads "3,5" as an answer (decimal comma)', ok, { hint: hintN.replace(/\s+/g, ' ').slice(0, 200), note: ok ? '' : (await entry.innerText()).replace(/\s+/g, ' ').slice(0, 200) })
    await f.all('entry-3-5-decimal-item')
    decimalSeen = true
  }
  if (!decimalSeen) f.check('a decimal or fraction item within the first items', null, 'none met: the decimal-comma reading is pinned by src/tasks/quant/numeric.test.ts and e2e/uxdec-quant-entry.spec.ts', 'this session served whole-number items only')
  f.save()
})

// ------------------------------------------------------------------------------------------------ D9

test('uxdec-verify D9: the coding keypad folds into rows of five and four where nine keys would be under 40 px', async ({ page }, info) => {
  const f = new Facts(page, info, 'D9')
  await intoSegment(page, 5)
  await press(f.touch, button(page, 'Start'))
  await expect(page.getByRole('timer')).toBeVisible()
  const sizes = [
    { width: 320, height: 568 },
    { width: 390, height: 664 },
    { width: 412, height: 840 },
    { width: 430, height: 932 },
  ]
  for (const s of sizes) {
    await page.setViewportSize(s)
    await settle(page)
    await page.waitForTimeout(100)
    const m = await page.evaluate(() => {
      const keys = [...document.querySelectorAll('[role="group"][aria-label="Digit keypad"] button')].map((b) => b.getBoundingClientRect())
      const tops = [...new Set(keys.map((r) => Math.round(r.top)))].sort((a, b) => a - b)
      const rows = tops.filter((t, i) => i === 0 || t - (tops[i - 1] ?? 0) > 4).length
      const table = document.querySelector('section.hb-render.coding table, section.hb-render.coding .key, section.hb-render.coding')?.getBoundingClientRect()
      return {
        keys: keys.length,
        rows,
        minW: Math.round(Math.min(...keys.map((r) => r.width)) * 10) / 10,
        maxW: Math.round(Math.max(...keys.map((r) => r.width)) * 10) / 10,
        minH: Math.round(Math.min(...keys.map((r) => r.height)) * 10) / 10,
        block: table ? Math.round(Math.max(...keys.map((r) => r.bottom)) - table.top) : null,
        overflow: document.documentElement.scrollWidth - innerWidth,
      }
    })
    const expectRows = s.width <= 412 ? 2 : 1
    f.check(`${s.width} px: ${expectRows === 2 ? 'two rows, keys 44 px or wider' : 'one row, keys 40 px or wider'}`, m.keys === 9 && m.rows === expectRows && m.minW >= (expectRows === 2 ? 44 : 40) && m.overflow <= 0, { ...m, viewport: s })
    await f.shot(`coding-${s.width}`, { fullPage: false })
  }
  f.save()
})

// ------------------------------------------------------------------------------------------------ D11

test('uxdec-verify D11: reading passages are shown in paragraphs of at most 150 words; the reading line names first-language figures', async ({ page }, info) => {
  test.setTimeout(6 * 60_000)
  const f = new Facts(page, info, 'D11')
  await routeOf('reading-passage').open(page)
  const words = await page.locator('article.passage p').evaluateAll((ps) => ps.map((p) => (p.textContent ?? '').trim().split(/\s+/).filter(Boolean).length))
  f.check('passage paragraphs on screen', null, words)
  f.check('no paragraph over 150 words', words.length > 0 && Math.max(...words) <= 150, { max: Math.max(...words), paragraphs: words.length })
  f.check('no paragraph under 40 words except a last short one', words.slice(0, -1).every((w) => w >= 40) || words.length === 1, words)
  await f.all('reading-passage')
  const height = await page.locator('article.passage').evaluate((el) => Math.round(el.getBoundingClientRect().height))
  f.check('passage height (CSS px)', null, height)
  await fresh(page)
  await resultsBuilt(page)
  await page.evaluate(() => {
    for (const d of document.querySelectorAll('details')) d.setAttribute('open', '')
  })
  const text = await bodyText(page)
  const hasReading = /words per minute/.test(text)
  f.check('results: the reading line ends with the first-language sentence', hasReading ? /One passage is a rough guide\. The comparison figures are for people reading in their first language\./.test(text) : null, { readingLineShown: hasReading })
  await f.shot('results-numbers-open', { fullPage: true })
  f.save()
})

// ------------------------------------------------------------------------------------------------ D12

test('uxdec-verify D12: the fixation cross is drawn in the middle of the pad, not in a row above it', async ({ page }, info) => {
  const f = new Facts(page, info, 'D12')
  await routeOf('rt-trial').open(page)
  const seen = await page
    .waitForFunction(`(() => { const x = document.querySelector('.rt .fixation'); return !!x && x.textContent.trim() === '+' })()`, undefined, { polling: 'raf', timeout: 10_000 })
    .then(() => true)
    .catch(() => false)
  f.check('a fixation cross appeared during the practice trials', seen)
  const m = await page.evaluate(() => {
    const fix = document.querySelector('.rt .fixation')
    const pads = document.querySelector('.rt .pads')
    const pad = document.querySelector('.rt .pad')
    const stage = document.querySelector('.rt .stage')
    if (!fix || !pads || !pad || !stage) return null
    const r = (el: Element) => el.getBoundingClientRect()
    const glyph = (() => {
      const range = document.createRange()
      range.selectNodeContents(fix)
      const rects = [...range.getClientRects()]
      return rects[0] ?? r(fix)
    })()
    const c = (b: DOMRect) => ({ x: b.left + b.width / 2, y: b.top + b.height / 2 })
    const round = (n: number) => Math.round(n * 10) / 10
    return {
      inPads: pads.contains(fix),
      padCount: document.querySelectorAll('.rt .pad').length,
      dxToPad: round(c(glyph).x - c(r(pad)).x),
      dyToPad: round(c(glyph).y - c(r(pad)).y),
      dxToPads: round(c(glyph).x - c(r(pads)).x),
      dyToPads: round(c(glyph).y - c(r(pads)).y),
      fixationAbovePads: round(r(pads).top - r(fix).bottom),
      stageHeight: round(r(stage).height),
      pointerEvents: getComputedStyle(fix).pointerEvents,
      ariaHidden: fix.getAttribute('aria-hidden'),
    }
  })
  f.check('fixation measured', m !== null, m)
  if (m !== null) {
    f.check('the cross is inside the pads box (no separate row)', m.inPads && m.fixationAbovePads <= 0)
    f.check('one position: the cross is centred on the pad (within 1.5 px)', m.padCount !== 1 || (Math.abs(m.dxToPad) <= 1.5 && Math.abs(m.dyToPad) <= 1.5), { dx: m.dxToPad, dy: m.dyToPad })
    f.check('the cross is centred on the row of pads (within 1.5 px)', Math.abs(m.dxToPads) <= 1.5 && Math.abs(m.dyToPads) <= 1.5, { dx: m.dxToPads, dy: m.dyToPads })
    f.check('the cross takes no taps and is hidden from the accessibility tree', m.pointerEvents === 'none' && m.ariaHidden === 'true')
    f.check('stage height (CSS px; was 280 with the row)', null, m.stageHeight)
  }
  await f.shot('rt-fixation', { fullPage: false })
  f.save()
})

// ------------------------------------------------------------------------------------------------ D13 / D14

test('uxdec-verify D13/D14: gaps at not-measured spokes, the not-measured list on phones, and the chart text at 320 px', async ({ page }, info) => {
  const f = new Facts(page, info, 'D13-D14')
  await resultsBuilt(page)
  const h = page.viewportSize()?.height ?? 800
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: h })
    await settle(page)
    await page.waitForTimeout(200)
    const m = await page.evaluate(() => {
      const svg = document.querySelector('svg.hb-blob') as SVGSVGElement | null
      if (!svg) return null
      const vb = svg.viewBox.baseVal
      const scale = svg.getBoundingClientRect().width / (vb.width || 1)
      const texts = [...svg.querySelectorAll('text, tspan')].filter((t) => (t.textContent ?? '').trim() !== '')
      const minText = Math.min(...texts.map((t) => parseFloat(getComputedStyle(t).fontSize) * scale))
      const list = document.querySelector('[data-stub-list]')
      const curves = [...svg.querySelectorAll('path')].filter((p) => /curve|crisp|band/.test(p.getAttribute('class') ?? ''))
      return {
        gaps: svg.querySelectorAll('path.gap').length,
        stubs: svg.querySelectorAll('line.stub').length,
        labels: texts.length,
        minTextPx: Math.round(minText * 100) / 100,
        chartPx: Math.round(svg.getBoundingClientRect().width),
        list: list ? (list.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) : null,
        listVisible: list ? (list as HTMLElement).offsetParent !== null : false,
        curveClasses: [...new Set(curves.map((p) => p.getAttribute('class')))].slice(0, 6),
        closedCurves: curves.filter((p) => /Z\s*$/i.test(p.getAttribute('d') ?? '')).length,
        openCurves: curves.filter((p) => !/Z\s*$/i.test(p.getAttribute('d') ?? '')).length,
      }
    })
    f.check(`${width} px: chart facts`, m !== null, m)
    if (m === null) continue
    f.check(`${width} px: one × gap marker per not-measured spoke`, m.stubs > 0 && m.gaps === m.stubs, { gaps: m.gaps, stubs: m.stubs })
    f.check(`${width} px: the "Not measured: …" list is under the chart`, m.listVisible && /^Not measured: /.test(m.list ?? ''), m.list)
    f.check(`${width} px: smallest chart text at least ${width === 320 ? 10 : 11} px (D14)`, m.minTextPx >= (width === 320 ? 10 : 11), m.minTextPx)
    const caption = await bodyText(page)
    f.check(`${width} px: the stub caption says the line breaks and the × is not an estimate`, caption.includes(STUB_CAPTION))
    f.check(`${width} px: the old "drops to the centre" caption is gone`, !/drops to the centre/.test(caption))
    await f.shot(`blob-${width}`, { locator: page.locator('svg.hb-blob').first() })
    await f.shot(`results-top-${width}`, { fullPage: false })
  }
  f.save()
})

// ------------------------------------------------------------------------------------------------ D15 C

test('uxdec-verify D15 C: with a share sheet that takes files, "Share image" is the one primary button and comes first', async ({ page }, info) => {
  const f = new Facts(page, info, 'D15C')
  await page.addInitScript(SHARE_SHEET_FILES)
  await resultsBuilt(page)
  await press(f.touch, button(page, 'Download save file'))
  const card = page.locator('[data-share-card]')
  await expect(card).toBeVisible()
  await expect(page.locator('img[data-preview]')).toBeVisible()
  const buttons = (await buttonsOf(card)).filter((b) => /Share image|Download image|Download vector/.test(b.name))
  f.check('with a share sheet: Share image first, the only primary; PNG and SVG plain', buttons[0]?.name === 'Share image' && buttons[0]?.primary === true && buttons.filter((b) => b.primary).length === 1 && buttons.length === 3, buttons)
  const group = card.getByRole('group', { name: 'Save a copy' })
  f.check('with a share sheet: the downloads sit in a group labelled "Save a copy"', (await group.count()) === 1 && (await group.getByRole('button').count()) === 2)
  f.check('with a share sheet: every button 44 px tall or more', buttons.every((b) => b.h >= 44), buttons.map((b) => b.h))
  await f.shot('share-card-with-sheet', { locator: card })
  await press(f.touch, button(page, 'Share image'))
  const shared = await expect
    .poll(() => page.evaluate(() => (window as unknown as { __hbShared?: { name: string; type: string }[] }).__hbShared ?? []), { timeout: 20_000 })
    .toHaveLength(1)
    .then(() => page.evaluate(() => (window as unknown as { __hbShared?: { name: string; type: string }[] }).__hbShared ?? []))
    .catch(() => [] as { name: string; type: string }[])
  f.check('Share image hands one PNG to the sheet', shared.length === 1 && shared[0]?.type === 'image/png', shared)
  f.check('D15 B (skipped): no web address on the card panel', !/https?:\/\//.test(await card.innerText()))
  f.save()
})

test('uxdec-verify D15 C: without a share sheet the layout is the old one (PNG primary, no Share image)', async ({ page }, info) => {
  const f = new Facts(page, info, 'D15C-none')
  await page.addInitScript(NO_SHARE_SHEET)
  await resultsBuilt(page)
  await press(f.touch, button(page, 'Download save file'))
  const card = page.locator('[data-share-card]')
  await expect(card).toBeVisible()
  await expect(page.locator('img[data-preview]')).toBeVisible()
  const buttons = (await buttonsOf(card)).filter((b) => /Share image|Download image|Download vector/.test(b.name))
  f.check('without a share sheet: PNG first and primary, SVG plain, no Share image', buttons[0]?.name === 'Download image (PNG)' && buttons[0]?.primary === true && buttons.length === 2, buttons)
  f.check('without a share sheet: no "Save a copy" group', (await card.getByRole('group', { name: 'Save a copy' }).count()) === 0)
  await f.shot('share-card-without-sheet', { locator: card })
  f.save()
})

// ------------------------------------------------------------------------------------------------ D16

test('uxdec-verify D16: the compact top of the results and one column', async ({ page }, info) => {
  const f = new Facts(page, info, 'D16')
  await resultsBuilt(page)
  const widths = f.touch ? [390, 320] : [1280, 390]
  const h = page.viewportSize()?.height ?? 800
  for (const width of widths) {
    await page.setViewportSize({ width, height: f.touch ? h : width === 390 ? 664 : 800 })
    await settle(page)
    await page.waitForTimeout(200)
    const m = await measureResults(page)
    f.check(`${width} px: measurements`, null, { chartInFirstScreen: m.chartInFirstScreen, practice: m.practice, status: m.status, leftEdges: m.leftEdges, column: m.column, animButton: m.animButton?.name ?? null, pageHeight: m.pageHeight })
    f.check(`${width} px: the practice note is one line`, m.practice?.lines === 1, m.practice)
    f.check(`${width} px: "Your profile is ready." is in the tree but visually hidden`, m.status !== null && /Your profile is ready\./.test(m.status.text) && (m.status.clipped || m.status.w <= 1 || m.status.h <= 1), m.status)
    const edges = Object.entries(m.leftEdges).filter(([k, v]) => v !== null && k !== 'saveHeading') as [string, number][]
    const xs = edges.map(([, v]) => v)
    f.check(`${width} px: the h1, lines, note, heading, toggle, caption and panel share one left edge`, xs.length > 3 && Math.max(...xs) - Math.min(...xs) <= 1, Object.fromEntries(edges))
    if (width <= 390) f.check(`${width} px: part of the chart is in the first screen`, m.chartInFirstScreen.px > 0, m.chartInFirstScreen)
    f.check(`${width} px: no sideways overflow`, m.sidewaysOverflow <= 0, m.sidewaysOverflow)
    await f.shot(`results-${width}-first-screen`, { fullPage: false })
  }
  if (f.touch) {
    await page.setViewportSize({ width: 390, height: h })
    await setTextZoomNow(page, 200)
    await settle(page)
    const m = await measureResults(page)
    f.check('390 px at 200% text: measurements', null, { chartInFirstScreen: m.chartInFirstScreen, practice: m.practice, sidewaysOverflow: m.sidewaysOverflow })
    f.check('390 px at 200% text: no sideways overflow', m.sidewaysOverflow <= 0, m.sidewaysOverflow)
    await f.shot('results-390-200pct', { fullPage: false })
    await setTextZoomNow(page, null)
  }
  f.save()
})

// ------------------------------------------------------------------------------------------------ D17 / D19

test('uxdec-verify D17/D19: the results-page save holds the notes settings kept on this device; local-date file name', async ({ page }, info) => {
  const f = new Facts(page, info, 'D17')
  await routeOf('notes-kept').open(page)
  await page.goto('./')
  await resultsBuilt(page)
  if (f.touch && info.project.name === 'iphone') {
    await press(true, button(page, 'Download save file'))
    f.note('iPhone emulation: no download event; the file content is checked on chromium and webkit.')
  } else {
    const save = await download(page, () => press(f.touch, button(page, 'Download save file')))
    const doc = JSON.parse(save.text) as { brief_prefs?: { contexts?: unknown[] } }
    f.check('the downloaded save holds brief_prefs with the kept context', doc.brief_prefs !== undefined && (doc.brief_prefs.contexts?.length ?? 0) > 0, Object.keys(doc.brief_prefs ?? {}))
    f.check('no typed text in the save\'s notes settings', !/chess|Use metric units/.test(JSON.stringify(doc.brief_prefs ?? {})))
    f.check('D19: save file name carries the local date', /^humanbench-[0-9A-Za-z]{6}-\d{4}-\d{2}-\d{2}\.hbsave\.json$/.test(save.name), save.name)
  }
  const line = page.locator('[data-notes-included]')
  f.check('the save panel says the file also holds the notes settings', (await line.count()) === 1 && (await line.innerText()).trim() === SAVE_HOLDS_NOTES, await line.innerText().catch(() => ''))
  await f.shot('save-panel-notes-line', { locator: page.locator('[data-section="save"]') })
  f.save()
})

// ------------------------------------------------------------------------------------------------ D20

test('uxdec-verify D20: the Reaction Time and Spatial Up next screens tell screen-reader users that Skip is the way', async ({ page }, info) => {
  const f = new Facts(page, info, 'D20')
  await toInterstitial(page, 0)
  const rt = await bodyText(page)
  f.check('Reaction Time: needs sight, names the Skip button, shows as not measured', /This part needs you to see the screen\. If you use a screen reader or cannot see the target, choose “Skip this part”: it will show as not measured\./.test(rt))
  await f.all('up-next-rt')
  await fresh(page)
  await toInterstitial(page, 2)
  const sp = await bodyText(page)
  f.check('Spatial: needs sight, names the Skip button, shows as not measured', /This part needs you to see the screen\. If you use a screen reader or cannot see the figures, choose “Skip this part”: it will show as not measured\./.test(sp))
  f.check('Spatial Up next screen has a "Skip this part" button', await button(page, 'Skip this part').isVisible())
  await f.all('up-next-spatial')
  await f.axe('Spatial Up next')
  f.save()
})

// ------------------------------------------------------------------------------------------------ D21

test('uxdec-verify D21: the first question focuses the heading, a later one its own labelled region', async ({ page }, info) => {
  const f = new Facts(page, info, 'D21')
  await intoSegment(page, 1)
  await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
  const first = await focused(page)
  f.check('first question: focus on the h1', /^h1/.test(first), first)
  await answerItem(page)
  await expect(page.locator('form.choice, form.entry').first()).toBeVisible()
  await page.waitForTimeout(150)
  const second = await focused(page)
  f.check('second question: focus on the item region "Question 2"', /^div\.item-region.*"Question 2"/.test(second), second)
  const region = await page.evaluate(() => {
    const el = document.activeElement
    return el ? { tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), label: el.getAttribute('aria-label'), tabindex: el.getAttribute('tabindex'), outline: getComputedStyle(el).outlineStyle } : null
  })
  f.check('the region is a group, tabindex -1, no focus ring', region?.role === 'group' && region.tabindex === '-1' && region.outline === 'none', region)
  if (!f.touch) {
    await page.keyboard.press('Tab')
    const after = await focused(page)
    // Desktop WebKit follows the system's Tab setting for controls (the screen package noted it), so there it is a measurement.
    f.check('one Tab from the region reaches the answer field', info.project.name === 'webkit' ? null : /input|textarea|button/.test(after), after)
  }
  await f.all('second-question')
  f.save()
})

// ------------------------------------------------------------------------------------------------ D22

test('uxdec-verify D22: the welcome shows a row to earlier results and kept notes, and nothing on a first visit', async ({ page }, info) => {
  const f = new Facts(page, info, 'D22')
  await page.goto('./')
  await expect(h1(page)).toHaveText('HumanBench')
  f.check('first visit: no returning row', (await page.getByRole('group', { name: WELCOME_RETURNING_LABEL }).count()) === 0)
  const primaries = await page.locator('.hb-primary:visible').allInnerTexts()
  f.check('first visit: Start is the only primary button', primaries.length === 1 && primaries[0]?.trim() === 'Start', primaries)
  await f.all('welcome-first-visit')
  const group = page.getByRole('group', { name: WELCOME_RETURNING_LABEL })

  const { save } = simulatedSave(1)
  const doc = save as { sessions: { session_id: string }[] }

  // (B) Kept notes settings only (the notes page ticks 18+ itself).
  await fresh(page)
  await routeOf('notes-kept').open(page)
  await page.goto('./')
  await expect(h1(page)).toHaveText('HumanBench')
  const notesOnly = (await group.count()) === 1
  const linkB = group.getByRole('link', { name: /Notes for your AI/ })
  const consentKeys = await page.evaluate(() => Object.keys(localStorage).filter((k) => !k.startsWith('hb:save:v1:')))
  f.check('kept notes only (no session consent record yet): what the welcome shows', null, { row: notesOnly, notesLink: (await linkB.count()) === 1, otherKeys: consentKeys }, 'the row needs an adult consent record of the session flow (funnel.json: nothing is read before the gate); the notes page keeps its 18+ tick in its own save')
  await f.all('welcome-returning-notes')

  // (C) Kept notes plus a consent record and a session seeded under another identifier (the notes page minted its own).
  await page.addInitScript(
    (a) => {
      if (localStorage.getItem(a.consentKey) === null) localStorage.setItem(a.consentKey, JSON.stringify({ v: 1, terms: a.terms, adult: true }))
      if (localStorage.getItem(a.saveKey) === null) localStorage.setItem(a.saveKey, a.text)
    },
    { consentKey: CONSENT_KEY, terms: TERMS_VERSION, saveKey: AUTOSAVE_PREFIX + doc.sessions[0]!.session_id, text: JSON.stringify(doc) },
  )
  await page.goto('./')
  await expect(h1(page)).toHaveText('HumanBench')
  const rowC = (await group.count()) === 1
  const buttonsC = rowC ? await buttonsOf(group) : []
  const anonIds = await page.evaluate((prefix) => [...new Set(Object.keys(localStorage).filter((k) => k.startsWith(prefix)).map((k) => (JSON.parse(localStorage.getItem(k) ?? '{}') as { anon_id?: string }).anon_id))], AUTOSAVE_PREFIX)
  f.check('kept notes, a consent record and a session under another identifier: the row shows the notes link', rowC && (await group.getByRole('link', { name: /Notes for your AI/ }).count()) === 1, { row: rowC, buttons: buttonsC, anonIds }, 'autosaves of several identifiers are the person\'s choice on the ready screen (returning.ts), so "See my results" may be withheld here')
  await f.all('welcome-returning-both')

  // (A) An adult consent record and one earlier session, nothing else: the route's own state (its init script runs from here on).
  await fresh(page)
  await routeOf('welcome-returning').prepare?.(page)
  await routeOf('welcome-returning').open(page)
  const buttonsA = await buttonsOf(group)
  f.check('earlier session: "See my results" is in the row and not primary', buttonsA.some((b) => b.name === 'See my results' && !b.primary), buttonsA)
  f.check('earlier session, no notes: no notes link', (await group.getByRole('link', { name: /Notes for your AI/ }).count()) === 0)
  f.check('earlier session: Start is still the only primary', (await page.locator('.hb-primary:visible').allInnerTexts()).length === 1)
  await f.all('welcome-returning-session')
  await f.axe('welcome returning (session)')
  const h = page.viewportSize()?.height ?? 800
  const w = page.viewportSize()?.width ?? 1280
  await page.setViewportSize({ width: 320, height: h })
  await settle(page)
  f.check('earlier session at 320 px: no sideways overflow', (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0)
  await f.shot('welcome-returning-320', { fullPage: false })
  await page.setViewportSize({ width: w, height: h })
  await press(f.touch, button(page, 'See my results'))
  await expect(h1(page)).toHaveText(/^(Your results|Before you start|Honour code)$/)
  const next = ((await h1(page).textContent()) ?? '').trim()
  f.check('"See my results" leads to the results (the consent is kept)', next === 'Your results', next)
  await f.all('see-my-results')
  f.save()
})

// ------------------------------------------------------------------------------------------------ D23

test('uxdec-verify D23: the refresh-rate measurement starts on the gate, so the device check does not wait', async ({ page }, info) => {
  const f = new Facts(page, info, 'D23')
  await toGate(page)
  await page.getByRole('checkbox', { name: /18 or older/ }).check()
  await button(page, 'Continue').click()
  await expect(h1(page)).toHaveText('Honour code')
  await page.getByRole('checkbox', { name: /honour code/ }).check()
  await button(page, 'Continue').click()
  await expect(h1(page)).toHaveText('Check your device')
  const t0 = performance.now()
  let checking = false
  let waited = -1
  for (let i = 0; i < 200; i++) {
    const [enabled, text] = await Promise.all([button(page, 'Continue').isEnabled(), bodyText(page)])
    if (/Checking your screen/.test(text)) checking = true
    if (enabled) {
      waited = Math.round(performance.now() - t0)
      break
    }
    await page.waitForTimeout(25)
  }
  const facts = await bodyText(page)
  f.check('automation speed (gate and honour in well under a second): wait on the device screen', null, { waitedMs: waited, sawChecking: checking }, 'the probe measures for about a second from the gate; a script reaches the device screen before it ends, so the screen waits for what is left')
  f.check('the refresh rate is on the screen', /\d+ Hz/.test(facts), /\d+ Hz[^\n]*/.exec(facts)?.[0] ?? '')
  await f.all('device-check')
  // A person: the gate and the honour screen take longer than the measurement. 1.5 s on the honour screen stands for that.
  await fresh(page)
  await toGate(page)
  await page.getByRole('checkbox', { name: /18 or older/ }).check()
  await button(page, 'Continue').click()
  await expect(h1(page)).toHaveText('Honour code')
  await page.waitForTimeout(1500)
  await page.getByRole('checkbox', { name: /honour code/ }).check()
  await button(page, 'Continue').click()
  await expect(h1(page)).toHaveText('Check your device')
  const t1 = performance.now()
  let checking2 = false
  let waited2 = -1
  for (let i = 0; i < 200; i++) {
    const [enabled, text] = await Promise.all([button(page, 'Continue').isEnabled(), bodyText(page)])
    if (/Checking your screen/.test(text)) checking2 = true
    if (enabled) {
      waited2 = Math.round(performance.now() - t1)
      break
    }
    await page.waitForTimeout(25)
  }
  f.check('a person\'s pace (1.5 s on the honour screen): Continue enabled within 300 ms, no "Checking your screen"', waited2 >= 0 && waited2 <= 300 && !checking2, { waitedMs: waited2, sawChecking: checking2 })
  f.save()
})

// ------------------------------------------------------------------------------------------------ D24

test('uxdec-verify D24: the under-18 screen has a quiet way back that stores nothing', async ({ page }, info) => {
  const f = new Facts(page, info, 'D24')
  await toGate(page)
  await press(f.touch, button(page, 'I am under 18'))
  await expect(h1(page)).toHaveText('HumanBench is for adults')
  const back = button(page, 'I chose this by mistake')
  const box = await back.boundingBox()
  f.check('"I chose this by mistake" is on the under-18 screen, 44 px tall, not primary', (await back.count()) === 1 && (box?.height ?? 0) >= 44 && !(await back.evaluate((el) => el.classList.contains('hb-primary'))), box)
  await f.all('under-18')
  await f.axe('under-18 screen')
  await press(f.touch, back)
  await expect(h1(page)).toHaveText('Before you start')
  f.check('back on the gate with the box unticked', !(await page.getByRole('checkbox', { name: /18 or older/ }).isChecked()))
  f.check('nothing stored either way', (await page.evaluate(() => localStorage.length + sessionStorage.length)) === 0)
  await press(f.touch, button(page, 'I am under 18'))
  await expect(h1(page)).toHaveText('HumanBench is for adults')
  await press(f.touch, button(page, 'I chose this by mistake'))
  await expect(h1(page)).toHaveText('Before you start')
  f.check('the way back works a second time', true)
  await f.all('gate-after-way-back')
  f.save()
})

// ------------------------------------------------------------------------------------------------ D25 / D26

test('uxdec-verify D25/D26: Title Case part and skill names with plain display names; the plain welcome, meta and honour lead', async ({ page }, info) => {
  const f = new Facts(page, info, 'D25-D26')
  await page.goto('./')
  await expect(h1(page)).toHaveText('HumanBench')
  const welcome = await bodyText(page)
  f.check('D26 tagline: short tasks, a profile with ranges, not a single score', /Short tasks of reasoning, memory and speed\. Your results are shown as a profile with ranges, not as a single score\./.test(welcome))
  f.check('D26 intro: six parts, about 30 minutes, skip any part, a save file to keep', /The session has six parts and takes about 30 minutes\./.test(welcome) && /download a save file of your answers to keep/.test(welcome))
  f.check('D26: no "jagged" anywhere on the welcome', !/jagged/i.test(welcome))
  const meta = await page.locator('meta[name="description"]').getAttribute('content')
  f.check('D26 meta description is the plain one (the src/copy constant, no "jagged-blob")', meta === META_DESCRIPTION && !/jagged/.test(meta ?? ''), meta)
  await f.all('welcome')
  await toHonour(page)
  const honour = await bodyText(page)
  f.check('D26 honour lead before the §13 sentence', honour.includes(HONOUR_LEAD) && honour.indexOf(HONOUR_LEAD) < honour.indexOf(HONOUR_TEXT))
  await fresh(page)
  await toInterstitial(page, 0)
  f.check('D25: "Up next: Reaction Time"', ((await h1(page).textContent()) ?? '').trim() === 'Up next: Reaction Time')
  const checklist = await page.locator('.checklist').innerText().catch(() => '')
  f.check('D25: the checklist uses the plain display names', /Confidence Calibration/.test(checklist) && !/Calibration\/Metacognition|Analytical\/Logic Games/.test(checklist), checklist.replace(/\s+/g, ' ').slice(0, 300))
  await f.all('up-next-rt-names')
  await button(page, 'Start').click()
  await expect(h1(page)).toHaveText('Reaction Time')
  f.check('D25: part h1 and title in Title Case', (await page.title()) === 'Reaction Time · HumanBench', await page.title())
  await fresh(page)
  await resultsBuilt(page)
  const names = await page.evaluate(() => [...document.querySelectorAll('h1, h2, h3, th, td, button, label, [data-share-card] *')].map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()).filter((t) => t !== '' && t.length < 80))
  const bad = names.filter((t) => /Calibration\/Metacognition|Analytical\/Logic Games|^Reaction time$|^Spatial reasoning$/.test(t))
  f.check('D25 results: no research names or sentence-case part names in headings, cells, buttons or labels', bad.length === 0, bad.slice(0, 10))
  await page.getByRole('button', { name: 'Bar view' }).click()
  await expect(page.locator('svg.lollipop').first()).toBeVisible()
  const table = await bodyText(page)
  f.check('D25 results table: "Confidence Calibration" and "Logic Games"', /Confidence Calibration/.test(table) && /Logic Games/.test(table))
  await f.shot('results-bars-names', { fullPage: true })
  f.save()
})

// ------------------------------------------------------------------------------------------------ D27

test('uxdec-verify D27: one primary action per screen (finish panel, focus-session start, results-talk copy)', async ({ page }, info) => {
  const f = new Facts(page, info, 'D27')
  await routeOf('confirm-finish').open(page)
  const panel = page.locator('section.confirm')
  const buttons = await buttonsOf(panel)
  f.check('finish panel: "Keep going" first and the only primary; "Finish now" plain', buttons[0]?.name === 'Keep going' && buttons[0]?.primary === true && buttons.some((b) => b.name === 'Finish now' && !b.primary) && buttons.filter((b) => b.primary).length === 1, buttons)
  await f.shot('finish-panel', { fullPage: false })
  await press(f.touch, panel.getByRole('button', { name: 'Keep going' }))
  await expect(panel).toBeHidden()
  await fresh(page)
  await resultsBuilt(page)
  await press(f.touch, button(page, 'Download save file'))
  await expect(page.locator('[data-slot="working-with-ai"]')).toBeVisible()
  const focus = page.getByRole('button', { name: 'Start a 20-minute focus session' })
  f.check('results: the focus-session start is a plain button', (await focus.count()) === 1 && !(await focus.evaluate((el) => el.classList.contains('hb-primary'))))
  const copy = page.getByTestId('copy-preamble')
  f.check('results-talk: the copy button is a plain button', (await copy.count()) === 1 && !(await copy.evaluate((el) => el.classList.contains('hb-primary'))))
  const primaries = await page.locator('.hb-primary:visible').allInnerTexts()
  f.check('results after the save: visible primary buttons', null, primaries.map((t) => t.trim()))
  await f.shot('results-saved-primaries', { fullPage: true })
  f.save()
})

// ------------------------------------------------------------------------------------------------ D28

test('uxdec-verify D28: the Spatial stem says a mirror image does not count', async ({ page }, info) => {
  const f = new Facts(page, info, 'D28')
  await routeOf('item-spatial').open(page)
  const drawn = (await page.locator('form.choice').count()) > 0
  const text = await bodyText(page)
  if (drawn) {
    f.check('stem: "Which option shows the same object as the target, rotated? A mirror image does not count."', text.includes('Which option shows the same object as the target, rotated? A mirror image does not count.'))
    f.check('old "(Not mirror-imaged.)" gone', !/mirror-imaged/.test(text))
  } else {
    f.check('this engine cannot draw the figures (no WebGL): the skip panel shows instead', null, text.replace(/\s+/g, ' ').slice(0, 200))
  }
  await f.all('item-spatial')
  f.save()
})

// ------------------------------------------------------------------------------------------------ D29 / D30 / D31 unchanged

test('uxdec-verify D29/D30: option-card focus and the running RT block under a panel are unchanged', async ({ page }, info) => {
  const f = new Facts(page, info, 'D29-D30')
  const optionGroup = execFileSync('git', ['diff', '--stat', BASE_COMMIT, '--', 'web/src/render/choice/OptionGroup.svelte'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
  f.check('D29: OptionGroup.svelte unchanged from the base commit', optionGroup === '', optionGroup)
  const scriptOf = (src: string): string => /<script[^>]*>([\s\S]*?)<\/script>/.exec(src)?.[1] ?? ''
  const rtBase = scriptOf(execFileSync('git', ['show', `${BASE_COMMIT}:web/src/render/rt/RtRenderer.svelte`], { cwd: REPO_ROOT, encoding: 'utf8' }))
  const rtHead = scriptOf(readFileSync(path.join(REPO_ROOT, 'web/src/render/rt/RtRenderer.svelte'), 'utf8'))
  f.check('D30/D12: the RT renderer script (state machine, timing) is byte-identical to the base commit', rtBase !== '' && rtBase === rtHead)
  // Behaviour: the block keeps running while the Skip panel is open.
  await routeOf('rt-trial').open(page)
  await page.waitForFunction(`!!document.querySelector('.rt .pad.on') || /Trial|trial/.test((document.querySelector('.rt .hb-status') || {}).textContent || '')`, undefined, { timeout: 15_000 }).catch(() => undefined)
  await press(f.touch, page.locator('.actions').getByRole('button', { name: /^Skip / }))
  await expect(page.locator('section.confirm')).toBeVisible()
  const sample = () => page.locator('section.hb-render.rt').innerText().catch(() => '')
  const a = await sample()
  await page.waitForTimeout(3000)
  const b = await sample()
  const onCount = async () => page.evaluate(() => document.querySelectorAll('.rt .pad.on').length)
  let flashes = 0
  for (let i = 0; i < 20; i++) {
    if ((await onCount()) > 0) flashes++
    await page.waitForTimeout(100)
  }
  f.check('D30 (B kept): the RT block goes on while the Skip panel is open', a !== b || flashes > 0, { changed: a !== b, flashesSeenIn2s: flashes })
  await f.shot('rt-panel-open', { fullPage: false })
  await press(f.touch, page.locator('section.confirm').getByRole('button', { name: 'Keep going' }))
  f.save()
})

test('uxdec-verify D31: with a file loaded, a different pasted code is still ignored without a word', async ({ page }, info) => {
  const f = new Facts(page, info, 'D31')
  const ready = readFileSync(path.join(REPO_ROOT, 'web/src/session/Ready.svelte'), 'utf8')
  f.check('Ready.svelte still reads the file first, then the code', /The file first; when there is none, or it is not a save, the pasted code\./.test(ready))
  await toReady(page)
  const one = simulatedSave(1).save
  const two = simulatedSave(2).save
  await page.getByLabel('Save file').setInputFiles({ name: 'humanbench-save.txt', mimeType: 'text/plain', buffer: Buffer.from(JSON.stringify(one)) })
  await button(page, 'Load').click()
  await expect(page.getByText(/Loaded \d+ earlier sessions?/)).toBeVisible()
  const before = await page.getByText(/Loaded \d+ earlier sessions?/).innerText()
  await page.getByLabel('Or paste a save code').fill(JSON.stringify(two))
  await button(page, 'Load').click()
  await page.waitForTimeout(1500)
  const after = await page.getByText(/Loaded \d+ earlier sessions?/).innerText().catch(() => '')
  const text = await bodyText(page)
  f.check('D31 (unchanged): the file (1 session) stays loaded; the pasted 2-session code is ignored', before === after && /Loaded 1 earlier session\b/.test(after), { before, after })
  f.check('D31 (unchanged): nothing says the code was ignored', !/code (was|is) ignored|file is the one in use|chosen file/i.test(text))
  await f.all('ready-file-and-code')
  f.save()
})
