/// <reference lib="dom" />
/**
 * One form for part and skill names (web/UX-REVIEW.md D25, a provisional default: option A with option C's display
 * names; DESIGN §3, §10; ROADMAP A7), in a real browser on the production build:
 *
 * - every part and skill name is Title Case, the same on the interstitial ("Up next: Reaction Time"), the part's
 *   heading and page title, the checklist, the skip question ("Skip Reaction Time"), the results table, the chart
 *   labels (full and the one-line labels of a phone) and the share card;
 * - the two research names of DESIGN §3 never reach a page, in text, in a name, in an alt text or in the card picture:
 *   "Calibration/Metacognition" is shown as "Confidence Calibration" and "Analytical/Logic Games" as "Logic Games".
 *
 * The names come from `src/axis-names.ts`; the unit side is `src/axis-names.test.ts` (the names, and a scan that no
 * screen reads a registry name) and `src/axis-names.dom.test.ts`.
 */

import { expect, test, type Page } from '@playwright/test'
import { AXIS_NAMES } from '../src/axis-names'
import { button, h1 } from './flow'
import { intoSegment, openRoute, ROUTES, SEGMENT_TITLES, toInterstitial } from './routes'

/** The research names, and their parts, that no page may show. */
const JARGON = /Calibration\/Metacognition|Analytical\/Logic Games|Metacognition|Analytical/
/** The sentence-case spellings the part and skill names had before (UX-060). */
const SENTENCE_CASE = /\b(?:Reaction time|Working memory|Matrix & series|Quantitative reasoning|Processing & reading speed|Logic games|Confidence calibration|Reading comp\.|Working mem\.|Arts & practical)/

/**
 * Everything a person can read or hear: the page title, all text (hidden text too: the table is the screen-reader
 * default), the attributes that name or describe something, and the share card picture's SVG.
 */
function readable(page: Page): Promise<string> {
  return page.evaluate(() => {
    const out = [document.title, document.body.textContent ?? '']
    for (const el of document.querySelectorAll('*')) {
      for (const a of ['aria-label', 'alt', 'title', 'aria-valuetext', 'placeholder']) {
        const v = el.getAttribute(a)
        if (v) out.push(v)
      }
    }
    for (const img of document.querySelectorAll('img[src^="data:image/svg"]')) {
      const src = img.getAttribute('src') ?? ''
      out.push(decodeURIComponent(src.slice(src.indexOf(',') + 1)))
    }
    return out.join('\n')
  })
}

/** Title Case, as `src/axis-names.test.ts` checks it: each word capitalised, "&" between words; the R-5.6.2 "(text scenarios)" as pinned. */
const titleCase = (s: string): boolean => {
  const rest = s.replace(/\s*\(text scenarios\)$/, '')
  return rest === '' || rest.split(/[\s/-]+/).every((w) => w === '&' || /^[A-Z0-9]/.test(w))
}

/** The routes where part or skill names are on screen. */
const ROUTE_IDS = ['interstitial', 'rt-intro', 'item-matrix-series', 'confirm-skip', 'results', 'results-bars', 'results-drilldown', 'share-card-dark', 'dev-blob', 'dev-blob-m1'] as const

test.describe('no research name and no sentence-case name on any screen that names a part or skill (D25)', () => {
  for (const id of ROUTE_IDS) {
    test(id, async ({ page }) => {
      const route = ROUTES.find((r) => r.id === id)
      expect(route, id).toBeDefined()
      await openRoute(page, route!)
      const text = await readable(page)
      expect(text).not.toMatch(JARGON)
      expect(text.match(SENTENCE_CASE)?.[0] ?? null).toBeNull()
    })
  }
})

test.describe('the session says each part name one way (D25)', () => {
  test('interstitial, checklist, skip question, heading and page title', async ({ page }) => {
    await toInterstitial(page, 0)
    await expect(h1(page)).toHaveText(`Up next: ${SEGMENT_TITLES[0]}`)
    expect(SEGMENT_TITLES[0]).toBe('Reaction Time')
    const checklist = page.locator('section.checklist')
    await expect(checklist).toContainText('Reaction Time')
    await expect(checklist).toContainText(AXIS_NAMES.CAL)
    await button(page, 'Skip this part').click()
    await expect(page.locator('section.confirm').getByRole('button', { name: 'Skip Reaction Time', exact: true })).toBeVisible()
  })

  test('the part heading and the page title inside a part', async ({ page }) => {
    await intoSegment(page, 0)
    await expect(h1(page)).toHaveText('Reaction Time')
    await expect(page).toHaveTitle('Reaction Time · HumanBench')
  })
})

test.describe('the results name every skill in Title Case (D25)', () => {
  test('table rows and chart labels', async ({ page }) => {
    await openRoute(page, ROUTES.find((r) => r.id === 'results')!)
    const rows = await page.locator('tbody th.name').evaluateAll((ths) => ths.map((th) => (th.firstChild?.textContent ?? '').replace(/​/g, '').trim()))
    expect(rows.length).toBeGreaterThanOrEqual(17)
    expect(rows).toContain(AXIS_NAMES.CAL)
    expect(rows).toContain(AXIS_NAMES.LG)
    for (const r of rows) expect(titleCase(r), r).toBe(true)
  })

  for (const width of [1280, 320] as const) {
    test(`chart labels of the every-skill profile at ${width} px are Title Case cuts of the names`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await openRoute(page, ROUTES.find((r) => r.id === 'dev-blob')!)
      const lines = await page.locator('svg.hb-blob').first().locator('g.labels tspan').evaluateAll((ts) => ts.map((t) => (t.textContent ?? '').replace(/[ \s]*[○◇]$/, '').trim()).filter(Boolean))
      expect(lines.length).toBeGreaterThanOrEqual(17)
      for (const l of lines) expect(titleCase(l), l).toBe(true)
      // The display name of Confidence Calibration, whole on a wide chart, cut to "Calibration" on a phone's one-line labels.
      expect(lines).toContain('Calibration')
      expect(lines.join('\n')).not.toMatch(JARGON)
    })
  }
})
