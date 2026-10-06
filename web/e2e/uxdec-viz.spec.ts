/**
 * UX review decisions D13, D14 and D15 A (web/UX-REVIEW.md §2; provisional defaults, not owner decisions),
 * on the dev-only demo route `#/dev/blob` and on the share card itself:
 * - D13 A: at a not-measured spoke the curve and the band break (a gap) and a small × sits on the 0 SD
 *   ring, instead of the curve dipping to the centre, where −3 SD is drawn.
 * - D13 B: on a narrow screen with five or more not-measured spokes, those spokes carry no label and a
 *   "Not measured: …" line under the chart names them.
 * - D14: the smallest chart text at 320 px (measured here and reported).
 * - D15 A: on the share card a credible low is drawn muted and the named peaks are ringed.
 * Screenshots for the review go to test-results/ux-review/uxdec-viz/<HB_SHOTS>/<project>/ when HB_SHOTS is set.
 */

import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { distinctivePeaks } from '../src/reveal/peaks'
import { buildCard } from '../src/viz/card'
import { axisEstimates } from '../src/viz/profile'
import { syntheticProfile } from '../src/viz/synthetic'
import { expectNoSeriousAxe } from './axe'
import { expectNoSidewaysScroll, useTextZoom } from './layout'
import { expectWideFont, useWideFont } from './wide-font'

const SHOTS = process.env.HB_SHOTS ?? ''

async function open(page: Page, profile: string): Promise<void> {
  await page.goto(`./#/dev/blob?profile=${profile}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Blob demo (development only)' })).toBeVisible()
  await expect(page.locator('svg.hb-blob').first()).toBeVisible()
}

/** Two animation frames: the chart's width reaches its layout a frame after a resize (`width.ts`). */
const settle = (page: Page): Promise<unknown> => page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))')

function shotPath(name: string, project: string): string {
  const dir = path.join(process.cwd(), 'test-results', 'ux-review', 'uxdec-viz', SHOTS, project)
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `${name}.png`)
}

/** The card SVG of a synthetic profile, with its peaks worked out over the skills on it (as `ShareCard.svelte` does). */
function cardOf(id: string, theme: 'light' | 'dark'): string {
  const input = syntheticProfile(id)!.input
  const estimates = axisEstimates(input)
  const shown = estimates.filter((e) => e.measured).map((e) => e.code)
  const peaks = distinctivePeaks(input.score, shown, { max: 17 })
  return buildCard({ estimates, peaks, sessions: 1, theme }).svg
}

test.describe('review screenshots (D13, D15)', () => {
  test.skip(SHOTS === '', 'set HB_SHOTS=before|after to write the review screenshots')

  test('blob at desktop and phone widths, and the share card', async ({ page }, info) => {
    const project = info.project.name
    for (const [profile, width, scheme] of [
      ['m1', 1280, 'light'],
      ['m1', 390, 'light'],
      ['m1', 320, 'light'],
      ['m1', 390, 'dark'],
      ['sparse', 390, 'light'],
      ['full', 320, 'light'],
    ] as const) {
      await page.setViewportSize({ width, height: 1000 })
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto('about:blank')
      await open(page, profile)
      await settle(page)
      await settle(page)
      await page.locator('figure.blob-figure').first().screenshot({ path: shotPath(`blob-${profile}-${width}-${scheme}`, project) })
    }
    await page.setViewportSize({ width: 1200, height: 630 })
    for (const theme of ['light', 'dark'] as const) {
      for (const id of ['m1', 'offscale']) {
        await page.setContent(`<!doctype html><html><body style="margin:0">${cardOf(id, theme).replace(/^<\?xml[^>]*>\s*/, '')}</body></html>`)
        await page.locator('svg').first().screenshot({ path: shotPath(`card-${id}-${theme}`, project) })
      }
    }
  })
})

/** What the main chart shows on screen (a string expression: the e2e tsconfig has no DOM lib). */
interface ChartFacts {
  /** CSS px of the chart's box, and of the circle's diameter (2R). */
  readonly chartPx: number
  readonly circlePx: number
  /** Smallest rendered chart text (ring labels, spoke labels, notes), CSS px. */
  readonly minTextPx: number
  readonly labels: string[]
  /** Spoke ids whose × centre lies on the 0 SD ring (radius R/2 in user units). */
  readonly gapOnZero: string[]
  readonly unmeasured: string[]
  /** Subpaths of the crisp curve and whether any is closed. */
  readonly crispRuns: number
  readonly crispClosed: boolean
  readonly list: string | null
  readonly listPx: number
  /** Pairs of labels whose rendered boxes overlap. */
  readonly overlaps: string[]
  /** Text elements whose box leaves the viewBox. */
  readonly outside: string[]
}

const CHART_FACTS = `(() => {
  const svg = document.querySelector('figure svg.hb-blob')
  const s = svg.getScreenCTM().a
  const [vx, vy, vw, vh] = svg.getAttribute('viewBox').split(' ').map(Number)
  const texts = [...svg.querySelectorAll('text, tspan')].filter((t) => t.textContent.trim())
  const minTextPx = Math.min(...texts.map((t) => parseFloat(getComputedStyle(t).fontSize) * s))
  const R = Math.max(...[...svg.querySelectorAll('line.spoke')].map((l) => Math.hypot(+l.getAttribute('x2'), +l.getAttribute('y2'))))
  const gapOnZero = [...svg.querySelectorAll('g.mark.unmeasured')].filter((g) => {
    const d = g.querySelector('path.gap').getAttribute('d')
    const p = [...d.matchAll(/[ML](-?[\\d.]+),(-?[\\d.]+)/g)].map((m) => [+m[1], +m[2]])
    const cx = (p[0][0] + p[1][0]) / 2, cy = (p[0][1] + p[1][1]) / 2
    return Math.abs(Math.hypot(cx, cy) - R / 2) < 0.05
  }).map((g) => g.getAttribute('data-spoke'))
  const crisp = svg.querySelector('path.crisp').getAttribute('d')
  const boxes = [...svg.querySelectorAll('text.label, text.ring-label')].map((t) => {
    const b = t.getBBox(); const fs = parseFloat(getComputedStyle(t).fontSize)
    return { text: t.textContent, x0: b.x, x1: b.x + b.width, y0: b.y + 0.2 * fs, y1: b.y + b.height - 0.1 * fs, inside: b.x >= vx - 1 && b.y >= vy - 1 && b.x + b.width <= vx + vw + 1 && b.y + b.height <= vy + vh + 1 }
  })
  const overlaps = []
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j]
    if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) overlaps.push(a.text + ' / ' + b.text)
  }
  const list = document.querySelector('figure p.stub-list')
  return {
    chartPx: svg.getBoundingClientRect().width,
    circlePx: 2 * R * s,
    minTextPx,
    labels: [...svg.querySelectorAll('text.label')].map((t) => t.textContent.trim()),
    gapOnZero,
    unmeasured: [...svg.querySelectorAll('g.mark.unmeasured')].map((g) => g.getAttribute('data-spoke')),
    crispRuns: crisp.split('M').filter(Boolean).length,
    crispClosed: crisp.includes('Z'),
    list: list ? list.textContent.trim() : null,
    listPx: list ? parseFloat(getComputedStyle(list).fontSize) : 0,
    overlaps,
    outside: boxes.filter((b) => !b.inside).map((b) => b.text),
  }
})()`

const chartFacts = (page: Page): Promise<ChartFacts> => page.evaluate<ChartFacts>(CHART_FACTS)

test.describe('a not-measured spoke is a gap with an × on the 0 SD ring (D13 A)', () => {
  test('the curve breaks at each not-measured spoke and closes when every spoke is measured', async ({ page }) => {
    await open(page, 'm1')
    const m1 = await chartFacts(page)
    expect(m1.unmeasured).toHaveLength(10)
    expect(m1.gapOnZero.sort()).toEqual([...m1.unmeasured].sort())
    // Three runs of measured neighbours in the first-session profile, none closed.
    expect(m1.crispRuns).toBe(3)
    expect(m1.crispClosed).toBe(false)
    await expect(page.locator('figcaption')).toContainText('The line breaks there, and a small × on the 0 SD ring marks the gap; it is not an estimate.')
    // The × is drawn in the stub colour over a halo in the page background.
    const colours = await page.evaluate<{ gap: string; halo: string; stub: string; bg: string }>(`(() => {
      const g = document.querySelector('figure svg.hb-blob g.mark.unmeasured')
      const probe = document.createElement('div')
      document.querySelector('.hb-profile').appendChild(probe)
      probe.style.color = 'var(--hb-stub)'; const stub = getComputedStyle(probe).color
      probe.style.color = 'var(--hb-bg)'; const bg = getComputedStyle(probe).color
      probe.remove()
      return { gap: getComputedStyle(g.querySelector('path.gap')).stroke, halo: getComputedStyle(g.querySelector('path.gap-halo')).stroke, stub, bg }
    })()`)
    expect(colours.gap).toBe(colours.stub)
    expect(colours.halo).toBe(colours.bg)
    await page.locator('button[data-profile="full"]').click()
    await expect(page.locator('button[data-profile="full"]')).toHaveAttribute('aria-pressed', 'true')
    const full = await chartFacts(page)
    expect(full.unmeasured).toHaveLength(0)
    expect(full.crispRuns).toBe(1)
    expect(full.crispClosed).toBe(true)
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`has no serious axe violations with gaps and the list (${colorScheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto('about:blank')
        await open(page, 'm1')
        await settle(page)
        await expectNoSeriousAxe(page)
      }
    })
  }
})

test.describe('on a phone many not-measured spokes give their labels to a list (D13 B, D14)', () => {
  for (const width of [390, 360, 320]) {
    test(`at ${width} px the not-measured skills are listed under the chart, and the circle and text grow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await open(page, 'm1')
      await expect.poll(async () => (await chartFacts(page)).list, { message: 'the list under the chart' }).not.toBeNull()
      const f = await chartFacts(page)
      expect(f.list).toMatch(/^Not measured: .+\.$/)
      // Every not-measured skill is named once, by its full name; none is labelled on the chart.
      const names = axisEstimates(syntheticProfile('m1')!.input).filter((e) => !e.measured).map((e) => e.name)
      expect(f.list).toBe(`Not measured: ${names.join(', ')}.`)
      expect(f.labels.filter((l) => l.includes('not measured'))).toEqual([])
      expect(f.labels).toHaveLength(7)
      // The plot gets the room: rings across ≥ 55% of the chart (VIS2-23), text ≥ 11 px (§13), no overlaps.
      expect(f.circlePx / f.chartPx, `${width}px`).toBeGreaterThanOrEqual(0.55)
      expect(f.minTextPx, `${width}px`).toBeGreaterThanOrEqual(11 - 0.05)
      expect(f.overlaps).toEqual([])
      expect(f.outside).toEqual([])
      await expectNoSidewaysScroll(page, `m1 at ${width} px`)
      console.info(`D13 B m1 ${width}px: smallest chart text ${f.minTextPx.toFixed(2)} px, rings ${(100 * f.circlePx / f.chartPx).toFixed(0)}% of the chart`)
    })
  }

  test('the list grows with the text size (UX-044) and fits a wide font at 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await open(page, 'm1')
    await expect.poll(async () => (await chartFacts(page)).listPx).toBeGreaterThan(0)
    const base = (await chartFacts(page)).listPx
    await useTextZoom(page, 200)
    await page.goto('about:blank')
    await page.goto('./#/dev/blob?profile=m1')
    await expect(page.locator('svg.hb-blob').first()).toBeVisible()
    await expect.poll(async () => (await chartFacts(page)).listPx, { message: 'list font size at 200% text' }).toBeGreaterThanOrEqual(2 * base - 0.5)
    await expectNoSidewaysScroll(page, 'm1 at 390 px, 200% text')
  })

  test('with a wide font at 320 px the list and the chart reflow', async ({ page }) => {
    await useWideFont(page)
    await page.setViewportSize({ width: 320, height: 900 })
    await open(page, 'm1')
    await expectWideFont(page)
    await expect.poll(async () => (await chartFacts(page)).list).not.toBeNull()
    const f = await chartFacts(page)
    expect(f.overlaps).toEqual([])
    expect(f.outside).toEqual([])
    await expectNoSidewaysScroll(page, 'm1 at 320 px, wide font')
  })

  for (const wide of [false, true]) {
    test(`D14: the smallest chart text at 320 px, every skill measured (main chart and the Knowledge facets)${wide ? ', wide font' : ''}`, async ({ page }) => {
      if (wide) await useWideFont(page)
      await page.setViewportSize({ width: 320, height: 900 })
      await open(page, 'full')
      if (wide) await expectWideFont(page)
      await page.getByRole('button', { name: 'Knowledge', exact: true }).click()
      await expect(page.locator('.facet-panel svg.hb-blob')).toBeVisible()
      await settle(page)
      await settle(page)
      const sizes = await page.evaluate<number[]>(`[...document.querySelectorAll('svg.hb-blob')].map((svg) => {
        const s = svg.getScreenCTM().a
        return Math.min(...[...svg.querySelectorAll('text, tspan')].filter((t) => t.textContent.trim()).map((t) => parseFloat(getComputedStyle(t).fontSize) * s))
      })`)
      console.info(`D14 full 320px${wide ? ' wide font' : ''}: smallest chart text, main ${sizes[0]!.toFixed(2)} px, Knowledge facets ${sizes[1]!.toFixed(2)} px`)
      // No list here (no skill is unmeasured), so D13 B leaves this chart as it was; it reaches 10 px (D14: the floor of e2e/blob.spec.ts).
      await expect(page.locator('figure p.stub-list')).toHaveCount(0)
      for (const px of sizes) expect(px).toBeGreaterThanOrEqual(10 - 0.05)
    })
  }
})

test.describe('the share card stresses peaks, never lows (D15 A)', () => {
  test('a credible low is drawn muted and the named peaks are ringed, in the rendered picture', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 630 })
    const input = syntheticProfile('m1')!.input
    const shown = axisEstimates(input).filter((e) => e.measured)
    const low = shown.findIndex((e) => e.relation === 'below')
    expect(low, 'the first-session profile has a credible low').toBeGreaterThanOrEqual(0)
    const peaks = distinctivePeaks(input.score, shown.map((e) => e.code), { max: 17 })
    expect(peaks.length).toBeGreaterThan(0)
    for (const theme of ['light', 'dark'] as const) {
      await page.setContent(`<!doctype html><html><body style="margin:0">${cardOf('m1', theme).replace(/^<\?xml[^>]*>\s*/, '')}</body></html>`)
      const facts = await page.evaluate<{ rings: string[]; lowMuted: boolean; lowFill: string; bg: string; bold: number; strong: number }>(`(() => {
        const svg = document.querySelector('svg')
        const marks = [...svg.querySelectorAll('g.marks > g')]
        const low = marks[${low}]
        const blob = getComputedStyle(marks.find((g) => !g.classList.contains('muted')).querySelector('circle.marker')).fill
        return {
          rings: marks.filter((g) => g.querySelector('circle.peak-ring')).map((g) => String(marks.indexOf(g))),
          lowMuted: low.classList.contains('muted'),
          lowFill: getComputedStyle(low.querySelector('circle.marker')).fill,
          bg: getComputedStyle(svg.querySelector('rect')).fill,
          bold: [...svg.querySelectorAll('text.label.peak')].filter((t) => Number(getComputedStyle(t).fontWeight) >= 700).length,
          strong: marks.filter((g) => getComputedStyle(g.querySelector('circle.marker, path.arrow')).fill === blob).length,
        }
      })()`)
      expect(facts.rings, theme).toEqual(peaks.map((p) => String(shown.findIndex((e) => e.code === p.code))).sort())
      expect(facts.bold, theme).toBe(peaks.length)
      // The credible low is hollow (filled with the card's background), and every filled mark is a range above 0 SD.
      expect(facts.lowMuted, theme).toBe(true)
      expect(facts.lowFill, theme).toBe(facts.bg)
      expect(facts.strong, theme).toBe(shown.filter((e) => e.relation === 'above').length)
    }
  })
})
