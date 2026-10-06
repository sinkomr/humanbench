/// <reference lib="dom" />
/**
 * uxdec verification, the regression sweep: every product route of `e2e/routes.ts` at 390 and 1280 px (the phone at its
 * own 390), light and dark, with metrics (overflow, clipped text, targets under 44 px, console) and axe; the layout
 * routes again at 320 px and with the text at 200%; the preview dev routes; and a quick run of the RT self-test page.
 * Verification 4 (the merged head, dev M6.2 to M6.4) adds the M6 dev routes (sjt, rat, aut, emotion) at 390 and 1280 px
 * in both schemes and a check that they name the skill and the facets through the display-name layer (D25) and that
 * the tier (c) marks of the blob demo show (hatch, glyph, caption).
 * Output: web/test-results/ux-review/<UX_RUN>/sweep/<project>/summary.json (+ one folder per route), layout-320/,
 * layout-200/, dev/, m6/ and selftest/<project>/facts.json, M6-names/<project>/facts.json.
 *
 *   UX_PORT=4761 UX_RUN=uxdec-verify UX_DIST=test-results/ux-review/uxdec-verify/_dist \
 *     npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/uxdec-verify-sweep.ux.ts --project=chromium
 */

import { expect, test, type Page } from '@playwright/test'
import { axisName } from '../../src/axis-names'
import { EMO_AXIS_NAME } from '../../src/copy'
import { ENTRY_COPY as AUT_COPY } from '../../src/tasks/aut/copy'
import { ENTRY_COPY as RAT_COPY } from '../../src/tasks/rat/copy'
import { HATCH_CAPTION, TIER_TEXT } from '../../src/viz/copy'
import { facetLabel } from '../../src/viz/facets'
import { openRoute, PREVIEW_ROUTES, type Route } from '../../e2e/routes'
import { AUT_ROUTES } from '../../e2e/routes-aut'
import { RAT_ROUTES } from '../../e2e/routes-rat'
import { SJT_ROUTES } from '../../e2e/routes-sjt'
import { PRODUCT_ROUTES, tour, trackConsole } from '../lib'
import { bodyText, Facts, fresh, RUN, settle } from './uxdec-verify-shared.ux'

test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 })

const GROUPS = ['start', 'session', 'results', 'notes', 'selftest'] as const

/** Routes whose layout the decisions touched: checked again at 320 px and with the text at 200%. */
const LAYOUT_ROUTES = ['welcome', 'welcome-returning', 'gate-under-18', 'honour', 'privacy', 'ready-continue', 'interstitial', 'break-offer', 'on-break', 'quant-item', 'coding-intro', 'rt-trial', 'results', 'results-bars', 'results-drilldown', 'results-saved', 'share-card-dark']

/** The M6 dev routes (ROADMAP M6.1 to M6.4): the emotion, situational judgment, word links and unusual uses entries. */
const M6_ROUTES: readonly string[] = [...PREVIEW_ROUTES.filter((r) => r.id.startsWith('dev-emotion')), ...SJT_ROUTES, ...RAT_ROUTES, ...AUT_ROUTES].map((r) => r.id)

const GLYPH_C = '◇'

function routeOf(id: string): Route {
  const r = PREVIEW_ROUTES.find((x) => x.id === id)
  if (r === undefined) throw new Error(`no route ${id}`)
  return r
}

/** What the blob demo draws for the tier (c) skills: hatched wedges, the labels and table headers of EMO and CRE, the caption and the stub list. */
async function tierCFacts(page: Page): Promise<{ hatch: number; marked: string[]; stubs: string[]; headers: Record<string, string>; caption: string; stubList: string }> {
  await expect(page.locator('figure svg.hb-blob').first()).toBeVisible()
  await settle(page)
  return page.evaluate((glyph) => {
    const clean = (s: string | null | undefined): string => (s ?? '').replace(/[ ​]/g, ' ').replace(/\s+/g, ' ').trim()
    const main = document.querySelector('figure svg.hb-blob')
    const labels = main === null ? [] : [...main.querySelectorAll('text.label')].map((t) => clean(t.textContent))
    const headers: Record<string, string> = {}
    for (const id of ['EMO', 'CRE']) headers[id] = clean(document.querySelector(`tr[data-row="${id}"] th`)?.textContent)
    return {
      hatch: main === null ? -1 : main.querySelectorAll('path.hatch').length,
      marked: labels.filter((t) => t.includes(` ${glyph}`) && /Emotion|Creative/.test(t)),
      stubs: main === null ? [] : [...main.querySelectorAll('text.label.unmeasured')].map((t) => clean(t.textContent)).filter((t) => /Emotion|Creative/.test(t)),
      headers,
      caption: clean(document.querySelector('figure figcaption')?.textContent),
      stubList: clean(document.querySelector('[data-stub-list]')?.textContent),
    }
  }, GLYPH_C)
}

for (const group of GROUPS) {
  test(`uxdec-verify sweep: ${group} routes at 390 and 1280 px, light and dark`, async ({ context }, info) => {
    test.setTimeout(15 * 60_000)
    const touch = info.project.use.hasTouch === true
    const ids = PRODUCT_ROUTES.filter((r) => r.group === group).map((r) => r.id)
    const entries = await tour(context, { runId: RUN, routes: ids, widths: touch ? [390] : [390, 1280], schemes: ['light', 'dark'], axe: true, touch: true, sub: `sweep/${info.project.name}` })
    expect(entries.length).toBe(ids.length)
  })
}

test('uxdec-verify sweep: the preview dev routes at 1280 px', async ({ context }, info) => {
  test.setTimeout(15 * 60_000)
  test.skip(info.project.use.hasTouch === true, 'the dev tools are desktop pages')
  const ids = PREVIEW_ROUTES.filter((r) => r.group === 'dev').map((r) => r.id)
  await tour(context, { runId: RUN, routes: ids, widths: [1280], schemes: ['light', 'dark'], axe: true, touch: false, sub: `dev/${info.project.name}` })
})

test('uxdec-verify sweep: the layout routes at 320 px', async ({ context }, info) => {
  test.setTimeout(15 * 60_000)
  await tour(context, { runId: RUN, routes: LAYOUT_ROUTES, widths: [320], schemes: ['light'], axe: false, touch: true, sub: `layout-320/${info.project.name}` })
})

test('uxdec-verify sweep: the layout routes with the text at 200%', async ({ context }, info) => {
  test.setTimeout(15 * 60_000)
  const touch = info.project.use.hasTouch === true
  await tour(context, { runId: RUN, routes: LAYOUT_ROUTES, widths: touch ? [390] : [1280, 390], schemes: ['light'], textZoom: 200, axe: false, touch: true, sub: `layout-200/${info.project.name}` })
})

test('uxdec-verify sweep: the RT self-test page passes a quick run', async ({ page }, info) => {
  test.setTimeout(5 * 60_000)
  const f = new Facts(page, info, 'selftest')
  const log = trackConsole(page)
  await page.goto('./rt-selftest.html?quick=1')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('RT timing self-test')
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByRole('heading', { name: 'Key presses' })).toBeVisible({ timeout: 60_000 })
  if (f.touch) {
    await page.getByRole('button', { name: 'Skip: no keyboard' }).tap()
  } else {
    await expect(page.getByText(/^Press the Space bar/)).toBeFocused()
    for (let i = 0; i < 3; i++) await page.keyboard.press('Space')
  }
  await expect(page.getByRole('heading', { name: 'Pointer presses' })).toBeVisible({ timeout: 30_000 })
  const target = page.getByRole('button', { name: 'Tap target' })
  for (let i = 0; i < 3; i++) {
    if (f.touch) await target.tap()
    else await target.click()
  }
  await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible({ timeout: 30_000 })
  const box = page.getByLabel('JSON report')
  await expect(box).toBeVisible()
  const report = JSON.parse(await box.inputValue()) as { report_version?: string; pass?: boolean; refresh?: { hz?: number }; metrics?: Record<string, { pass?: boolean | null; summary?: { p50?: number; p95?: number; max?: number } }> }
  f.check('report version', null, report.report_version)
  f.check('self-test verdict: pass', report.pass === true, { pass: report.pass, hz: report.refresh?.hz, metrics: Object.fromEntries(Object.entries(report.metrics ?? {}).map(([k, v]) => [k, { pass: v.pass, p95: v.summary?.p95 }])) })
  f.check('no console errors on the self-test page', log.errors.length === 0 && log.pageErrors.length === 0, { errors: log.errors.slice(0, 3), pageErrors: log.pageErrors.slice(0, 3) })
  await f.all('selftest-results')
  await f.axe('self-test results')
  f.save()
})

// ------------------------------------------------------------------------------------------------ M6 (verification 4)

test('uxdec-verify sweep: the M6 dev routes (sjt, rat, aut, emotion) at 390 and 1280 px, light and dark', async ({ context }, info) => {
  test.setTimeout(15 * 60_000)
  test.skip(info.project.use.hasTouch === true, 'the dev tools are desktop pages')
  const entries = await tour(context, { runId: RUN, routes: M6_ROUTES, widths: [390, 1280], schemes: ['light', 'dark'], axe: true, touch: true, sub: `m6/${info.project.name}` })
  expect(entries.length).toBe(M6_ROUTES.length)
})

test('uxdec-verify sweep: the M6 entries name the skill and the facets through the display layer (D25); the tier (c) marks of the blob demo show', async ({ page }, info) => {
  test.setTimeout(5 * 60_000)
  test.skip(info.project.use.hasTouch === true, 'the dev tools are desktop pages')
  const f = new Facts(page, info, 'M6-names')
  const research = /Calibration\/Metacognition|Analytical\/Logic Games/
  // Each demo is opened from a neutral page of the app's origin, as the tour opens every route on a fresh page: a hash change
  // from one dev demo to the next is a same-document navigation, and the blob demo reads `?profile=` once.
  const open = async (id: string): Promise<void> => {
    await fresh(page)
    await openRoute(page, routeOf(id))
  }

  // The situational judgment entry (M6.2): the skill name goes through axisName (merge-dev reconciliation 1dc7dc7).
  await open('dev-sjt')
  const sjt = await bodyText(page)
  f.check('SJT entry names the skill as axisName("EMO")', sjt.includes(axisName('EMO')), axisName('EMO'))
  f.check('axisName("EMO") is the R-5.6.2 name word for word (EMO_AXIS_NAME)', axisName('EMO') === EMO_AXIS_NAME, EMO_AXIS_NAME)
  f.check('SJT entry: no §3 research name', !research.test(sjt))
  await f.all('sjt')

  // The word links entry (M6.3): the facet name, sentence case (D25 open note: facet labels stay sentence case).
  await open('dev-rat')
  const rat = await bodyText(page)
  f.check('word links entry is named by facetLabel("remote_associates")', rat.includes(RAT_COPY.name) && RAT_COPY.name === facetLabel('remote_associates'), { onScreen: rat.includes(RAT_COPY.name), name: RAT_COPY.name, facetLabel: facetLabel('remote_associates') })
  await f.all('rat')

  // The unusual uses entry (M6.4): named, labelled experimental; the facet label keeps "(experimental)" (DESIGN §5.4).
  await open('dev-aut')
  const aut = await bodyText(page)
  f.check('unusual uses entry is named and labelled experimental', aut.includes(AUT_COPY.name) && aut.includes(AUT_COPY.experimental), { name: AUT_COPY.name, experimental: AUT_COPY.experimental })
  f.check('facetLabel("alternative_uses") keeps "(experimental)"', facetLabel('alternative_uses') === 'Unusual uses (experimental)', facetLabel('alternative_uses'))
  await f.all('aut')
  await open('dev-aut-results')
  const autResults = await bodyText(page)
  f.check('unusual uses results: no total, overall or single score, percentile or rank wording', !/total score|overall score|single score|percentile|\brank\b/i.test(autResults))
  f.check('unusual uses results: the experimental label is on the results too', /experimental/i.test(autResults))
  await f.all('aut-results')

  // The emotion entry (M6.1, on this branch before the merge): EMO_AXIS_NAME directly, the same string (merge-dev open issue).
  await open('dev-emotion')
  const emo = await bodyText(page)
  f.check('emotion entry names the skill with the R-5.6.2 name (same string as axisName("EMO"))', emo.includes(EMO_AXIS_NAME))
  await f.all('emotion')

  // The blob demo: every skill measured (EMO and CRE included) at 1280 and 390 px, then the M1-like profile.
  const h = page.viewportSize()?.height ?? 720
  for (const [profile, width] of [['full', 1280], ['full', 390], ['m1', 1280], ['m1', 390]] as const) {
    await fresh(page)
    await page.setViewportSize({ width, height: h })
    await page.goto(`./#/dev/blob?profile=${profile}`)
    const t = await tierCFacts(page)
    const key = `blob ${profile} at ${width} px`
    if (profile === 'full') {
      f.check(`${key}: two hatched wedges (EMO and CRE measured)`, t.hatch === 2, t.hatch)
      f.check(`${key}: ${GLYPH_C} on the Emotion and Creative chart labels`, t.marked.length === 2, t.marked)
      f.check(`${key}: the hatch caption is shown`, t.caption.includes(HATCH_CAPTION), t.caption)
    } else {
      f.check(`${key}: nothing hatched (EMO and CRE not measured)`, t.hatch === 0, t.hatch)
      f.check(`${key}: no hatch caption`, !t.caption.includes(HATCH_CAPTION))
      // D13 B: on a narrow chart with five or more not-measured spokes the stubs have no labels and a list names them (merge-dev open issue: without the glyph).
      f.check(`${key}: the not-measured EMO and CRE are named on the chart label (with ${GLYPH_C}) or in the stub list`, t.stubs.length === 2 ? t.stubs.every((s) => s.includes(GLYPH_C)) : /Emotion Reading/.test(t.stubList) && /Creative Thinking/.test(t.stubList), { labels: t.stubs, stubList: t.stubList })
    }
    f.check(`${key}: ${GLYPH_C} and the tier (c) wording in the EMO and CRE table rows`, ['EMO', 'CRE'].every((id) => t.headers[id]?.includes(GLYPH_C) === true && t.headers[id]?.includes(TIER_TEXT.c) === true), t.headers)
    const table = await page.locator('table').first().innerText()
    f.check(`${key}: the table names the skills through the display layer (Logic Games, Confidence Calibration; no research name)`, table.includes(axisName('LG')) && table.includes(axisName('CAL')) && !research.test(table), { LG: axisName('LG'), CAL: axisName('CAL') })
    await f.shot(`blob-${profile}-${width}`, { fullPage: false })
  }
  f.check('every tier (c) skill name on the blob demo pages is the R-5.6.2 name', (await bodyText(page)).includes(EMO_AXIS_NAME))
  f.save()
})
