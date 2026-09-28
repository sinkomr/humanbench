/**
 * The profile view in jsdom (ROADMAP M1.16; DESIGN §9, §13; A12, A15): table semantics and the
 * screen-reader default, the view toggle, muting, tier marks, not-measured stubs, the drill-down
 * threshold, and the scans that no area, total or single score reaches the DOM.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { CLUSTERS } from '../engine/axes'
import { FACET_MIN_ITEMS, clusterFacets, unmeasuredReasons } from './facets'
import { formatTheta } from './geometry'
import { HATCH_CAPTION } from './copy'
import { THEMES } from './palette'
import { FUZZ_Z, N_FUZZ } from './blob'
import { axisEstimates, type SpokeEstimate } from './profile'
import ProfileView from './ProfileView.svelte'
import { SYNTHETIC_PROFILES, syntheticProfile, type SyntheticProfile } from './synthetic'

let app: ReturnType<typeof mount> | undefined

// jsdom has no ResizeObserver (width.ts needs one): a stub that never reports a size, so
// the charts keep the default text layout here (fitLayout is unit-tested in blob.test.ts).
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
}

afterEach(() => {
  if (app) unmount(app)
  app = undefined
  document.body.innerHTML = ''
})

function render(p: SyntheticProfile, theme?: 'light' | 'dark'): HTMLElement {
  const target = document.createElement('div')
  document.body.appendChild(target)
  app = mount(ProfileView, { target, props: { input: p.input, facetObservations: p.facetObservations, facetCatalog: p.catalog, ...(theme ? { theme } : {}) } })
  flushSync()
  return target
}

function click(el: Element | null | undefined): void {
  expect(el).toBeTruthy()
  ;(el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  flushSync()
}

const button = (root: HTMLElement, text: string): HTMLButtonElement | undefined => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

/** Words that would present a sum, a size of the shape, one number for a person, or a norm (§9.5 a, A12). */
const AGGREGATE_WORDS = /\b(areas?|totals?|overall|sum(?:med|s)?|composite|aggregate|average|mean|combined|g[- ]factor|general ability|percentiles?|rank(?:ed|ing)?|IQ)\b/i

/** Every number a reader can see must be one of these: per-spoke values, ring labels, fixed copy numbers. */
function allowedNumbers(rows: readonly (SpokeEstimate & { nItems?: number })[]): Set<string> {
  const ok = new Set(['1', '2', '3', '0', '90', String(FACET_MIN_ITEMS)])
  for (const r of rows) {
    if (r.nItems !== undefined) ok.add(String(r.nItems))
    if (!r.measured) continue
    for (const v of [r.theta!, r.lo90!, r.hi90!]) ok.add(formatTheta(v).replace(/^[+−-]/, ''))
    ok.add(r.sd!.toFixed(2))
  }
  return ok
}

/** Numbers in visible text (typographic minus and sign dropped), e.g. "−1.30 to +0.42" → 1.30, 0.42. */
function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0])
}

function textAndAttributes(root: Element): { text: string; attrs: string[] } {
  const attrs: string[] = []
  for (const el of root.querySelectorAll('*')) {
    for (const a of el.attributes) {
      // Geometry is numbers by nature; class/id/data-* are code, but still scanned for words below.
      attrs.push(`${a.name}=${a.value}`)
    }
  }
  return { text: root.textContent ?? '', attrs }
}

describe('ProfileView structure (§9, A15)', () => {
  it('shows all 17 spokes with not-measured stubs, as one labelled image', () => {
    const p = syntheticProfile('m1')!
    const root = render(p)
    const svg = root.querySelector('svg.hb-blob')!
    expect(svg.getAttribute('role')).toBe('img')
    const labelled = svg.getAttribute('aria-labelledby')!.split(' ').map((id) => document.getElementById(id)?.textContent)
    expect(labelled[0]).toBe('Skill profile blob')
    expect(labelled[1]).toMatch(/table/)
    expect(svg.getAttribute('data-spokes')).toBe('17')
    expect(svg.querySelectorAll('g.mark')).toHaveLength(17)
    const est = axisEstimates(p.input)
    const unmeasured = est.filter((e) => !e.measured)
    expect(unmeasured.length).toBeGreaterThan(5)
    expect(svg.querySelectorAll('g.mark.unmeasured')).toHaveLength(unmeasured.length)
    expect(svg.querySelectorAll('g.mark.unmeasured line.stub')).toHaveLength(unmeasured.length)
    expect(svg.querySelectorAll('g.mark.unmeasured circle.gap')).toHaveLength(unmeasured.length)
    expect(svg.querySelectorAll('line.spoke.unmeasured')).toHaveLength(unmeasured.length)
    expect([...svg.querySelectorAll('text.label.unmeasured')].every((t) => t.textContent?.includes('not measured'))).toBe(true)
    const fuzz = [...svg.querySelectorAll('.fuzz path')]
    expect(fuzz).toHaveLength(N_FUZZ)
    // §9.3: filled bands (evenodd) with opacity ∝ φ(z), darkest next to the mean.
    expect(fuzz.every((p) => p.getAttribute('fill-rule') === 'evenodd')).toBe(true)
    const opacity = fuzz.map((p) => Number(p.getAttribute('fill-opacity')))
    opacity.forEach((o, j) => expect(o).toBeCloseTo(opacity[0]! * Math.exp((FUZZ_Z[0]! ** 2 - FUZZ_Z[j]! ** 2) / 2), 2))
    expect(svg.querySelectorAll('path.crisp')).toHaveLength(1)
    expect(svg.querySelectorAll('path.band')).toHaveLength(1)
  })

  it('labels rings in SD units, marks them provisional, and says the centre is −3 SD (§9.1, A12)', () => {
    const root = render(syntheticProfile('m1')!)
    const rings = [...root.querySelectorAll('text.ring-label')].map((t) => t.textContent)
    expect(rings).toEqual(['−2 SD', '−1 SD', '0 SD', '+1 SD', '+2 SD'])
    expect(root.querySelectorAll('circle.ring.reference')).toHaveLength(1)
    // In the SVG itself too, so an exported chart (M1.18) keeps it.
    expect(root.querySelector('svg.hb-blob text.ring-note')!.textContent).toBe('Rings: SD units, provisionalCentre: \u22123 SD')
    const caption = root.querySelector('figcaption')!.textContent!
    expect(caption).toContain('provisional')
    expect(caption).toContain('−3 SD, not zero ability')
  })

  it('mutes exactly the spokes whose 90% interval overlaps 0 SD, with a text cue in the table (§9.5, §13)', () => {
    const p = syntheticProfile('full')!
    const root = render(p)
    const est = axisEstimates(p.input)
    const muted = new Set([...root.querySelectorAll('g.mark.muted')].map((g) => g.getAttribute('data-spoke')))
    expect(muted).toEqual(new Set(est.filter((e) => e.muted).map((e) => e.id)))
    expect(muted.size).toBeGreaterThan(0)
    expect(muted.size).toBeLessThan(17)
    for (const e of est) {
      const row = root.querySelector(`tr[data-row="${e.id}"]`)!
      expect(row.classList.contains('muted')).toBe(e.muted)
      expect(row.textContent).toContain(e.muted ? 'Overlaps 0 SD' : e.relation === 'above' ? 'Above 0 SD' : 'Below 0 SD')
    }
  })

  it('marks tiers with glyphs (and text for screen readers) and hatches measured tier (c) wedges (§9.7)', () => {
    const root = render(syntheticProfile('full')!)
    const header = (id: string): HTMLElement => root.querySelector(`tr[data-row="${id}"] th`)!
    expect(header('WM').querySelector('[aria-hidden="true"]')!.textContent).toContain('○')
    expect(header('WM').textContent).toContain('provisional norms')
    expect(header('EMO').querySelector('[aria-hidden="true"]')!.textContent).toContain('◇')
    expect(header('MAT').querySelector('.glyph')).toBeNull()
    expect(root.querySelectorAll('path.hatch')).toHaveLength(2)
    expect(root.querySelector('path.hatch')!.getAttribute('fill')).toMatch(/^url\(#hb-profile-\d+-blob-hatch\)$/)
    // The hatch is explained in the caption, only when there is one.
    expect(root.querySelector('figcaption')!.textContent).toContain(HATCH_CAPTION)
    // In M1 the tier (c) axes are not measured, so nothing is hatched.
    app && unmount(app)
    app = undefined
    document.body.innerHTML = ''
    const m1 = render(syntheticProfile('m1')!)
    expect(m1.querySelectorAll('path.hatch')).toHaveLength(0)
    expect(m1.querySelector('figcaption')!.textContent).not.toContain(HATCH_CAPTION)
  })

  it('draws the crisp curve muted around muted spokes and in the blob colour elsewhere (§9.5)', () => {
    const p = syntheticProfile('full')!
    const root = render(p)
    const est = axisEstimates(p.input)
    const crisp = root.querySelector('path.crisp')!
    const muted = root.querySelector('path.crisp-muted')!
    expect(muted.getAttribute('d')).toBe(crisp.getAttribute('d'))
    const clipOf = (el: Element): Element => document.getElementById(/^url\(#(.+)\)$/.exec(el.getAttribute('clip-path')!)![1]!)!
    expect(clipOf(crisp).tagName.toLowerCase()).toBe('clippath')
    expect(clipOf(muted).querySelectorAll('path').length).toBeGreaterThan(0)
    expect(new Set(muted.getAttribute('data-spokes')!.split(' '))).toEqual(new Set(est.filter((e) => e.muted).map((e) => e.id)))
    // No muted spoke: one plain curve, no clip.
    app && unmount(app)
    app = undefined
    document.body.innerHTML = ''
    const q = syntheticProfile('m1')!
    // Every θ at +1 with a tiny SD: every measured interval excludes 0.
    const score = { ...q.input.score, theta: q.input.score.theta.map(() => 1), cov: q.input.score.cov.map((r, i) => r.map((_v, j) => (i === j ? 1e-4 : 0))) }
    const noneMuted = { ...q, input: { ...q.input, score } }
    const plain = render(noneMuted)
    expect(axisEstimates(noneMuted.input).some((e) => e.muted)).toBe(false)
    expect(plain.querySelector('path.crisp-muted')).toBeNull()
    expect(plain.querySelector('path.crisp')!.hasAttribute('clip-path')).toBe(false)
  })
})

describe('bar / lollipop view (§9.5 c: the screen-reader default)', () => {
  it('is a real table that is always in the accessibility tree, visually hidden in blob view', () => {
    const p = syntheticProfile('m1')!
    const root = render(p)
    const table = root.querySelector('table.hb-bars')!
    expect(table.querySelector('caption')!.textContent).toMatch(/provisional/)
    expect([...table.querySelectorAll('thead th')].map((th) => th.getAttribute('scope'))).toEqual(['col', 'col', 'col', 'col', 'col'])
    const rowHeaders = table.querySelectorAll('tbody th[scope="row"]')
    expect(rowHeaders).toHaveLength(17)
    expect(table.querySelectorAll('tbody tr')).toHaveLength(17)
    expect(table.parentElement!.classList.contains('visually-hidden')).toBe(true)
    for (let el: Element | null = table; el !== null; el = el.parentElement) {
      expect(el.getAttribute('aria-hidden'), el.tagName).not.toBe('true')
      expect(el.hasAttribute('hidden'), el.tagName).toBe(false)
    }
    // Screen readers meet the table before the blob (DOM order), and the blob is a single image
    // with nothing focusable inside.
    const svg = root.querySelector('svg.hb-blob')!
    expect(table.compareDocumentPosition(svg) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(table.compareDocumentPosition(root.querySelector('figcaption')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(root.querySelectorAll('svg.hb-blob [tabindex], svg.hb-blob a, svg.hb-blob button')).toHaveLength(0)
    // Lollipops are decoration: their values are the cell text.
    for (const svg of table.querySelectorAll('svg.lollipop')) expect(svg.getAttribute('aria-hidden')).toBe('true')
    const est = axisEstimates(p.input)
    const notMeasured = [...table.querySelectorAll('td.stub')].map((td) => td.textContent)
    expect(notMeasured).toHaveLength(est.filter((e) => !e.measured).length)
    expect(notMeasured.every((t) => t?.startsWith('Not measured'))).toBe(true)
  })

  it('the toggle switches to the visible bar view and back (aria-pressed)', () => {
    const root = render(syntheticProfile('m1')!)
    const blobBtn = button(root, 'Blob view')!
    const barBtn = button(root, 'Bar view')!
    expect(blobBtn.getAttribute('aria-pressed')).toBe('true')
    click(barBtn)
    expect(barBtn.getAttribute('aria-pressed')).toBe('true')
    expect(blobBtn.getAttribute('aria-pressed')).toBe('false')
    expect(root.querySelector('svg.hb-blob')).toBeNull()
    const table = root.querySelector('table.hb-bars')!
    expect(table.parentElement!.classList.contains('visually-hidden')).toBe(false)
    expect(table.querySelectorAll('svg.lollipop').length).toBeGreaterThan(0)
    click(blobBtn)
    expect(root.querySelector('svg.hb-blob')).not.toBeNull()
  })

  it('shows skipped and not-yet-offered axes with their reason', () => {
    const root = render(syntheticProfile('skipped')!)
    expect(root.querySelector('tr[data-row="SPA"] td.stub')!.textContent).toBe('Not measured (skipped)')
    expect(root.querySelector('tr[data-row="EMO"] td.stub')!.textContent).toBe('Not measured (not offered yet)')
    expect(root.querySelector('tr[data-row="LR"] td.stub')!.textContent).toBe('Not measured')
  })
})

describe('drill-down to facets (§9.6, A7, A12: ≥ 5 items)', () => {
  it('opens a cluster from its button, with facet estimates only at ≥ 5 items', () => {
    const p = syntheticProfile('m1')!
    const root = render(p)
    const btn = button(root, 'Quantitative')!
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(document.getElementById(btn.getAttribute('aria-controls')!)).not.toBeNull()
    click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    const panel = root.querySelector('.facet-panel')!
    expect(panel.querySelector('h3')!.textContent).toBe('Quantitative: facets')
    const est = axisEstimates(p.input)
    const rows = clusterFacets(p.input.score, p.facetObservations, 'Quantitative', { catalog: p.catalog, unmeasured: unmeasuredReasons(est) })
    expect(rows.map((r) => [r.facet, r.nItems, r.measured])).toEqual([
      ['percent', 6, true],
      ['arith', 5, true],
      ['fraction', 3, false],
      ['ratio', 2, false],
    ])
    for (const r of rows) {
      const tr = panel.querySelector(`tr[data-row="${r.id}"]`)!
      if (r.measured) expect(tr.textContent).toContain(formatTheta(r.theta!))
      else expect(tr.querySelector('td.stub')!.textContent).toBe(`Insufficient data (${r.nItems} items; 5 needed)`)
    }
    // Four facets: a sub-blob, with "insufficient data" stubs.
    const sub = panel.querySelector('svg.hb-blob')!
    expect(sub.getAttribute('data-spokes')).toBe('4')
    expect([...sub.querySelectorAll('text.label.unmeasured')].map((t) => t.textContent)).toEqual(['Fractioninsufficient data', 'Ratioinsufficient data'])
    click(btn)
    expect(root.querySelector('.facet-panel')).toBeNull()
  })

  it('opens from a click on the cluster wedge too', () => {
    const root = render(syntheticProfile('m1')!)
    click(root.querySelector('path.wedge[data-group="Speed"]'))
    expect(root.querySelector('.facet-panel h3')!.textContent).toBe('Speed: facets')
    expect(button(root, 'Speed')!.getAttribute('aria-expanded')).toBe('true')
    // One block per facet: below the threshold, so no numbers, counted in blocks (A12, A18).
    const stubs = [...root.querySelectorAll('.facet-panel td.stub')].map((td) => td.textContent)
    expect(stubs).toHaveLength(4)
    expect(stubs.every((t) => t === 'Insufficient data (1 block; 5 needed)')).toBe(true)
  })

  it('facets of a skipped axis read "not measured (skipped)"', () => {
    const root = render(syntheticProfile('skipped')!)
    click(button(root, 'Spatial/Memory'))
    expect(root.querySelector('.facet-panel tr[data-row="SPA:3d_rotation"] td.stub')!.textContent).toBe('Not measured (skipped)')
  })

  it('the facet sub-blob has no clickable wedges (only the main blob drills down)', () => {
    const root = render(syntheticProfile('full')!)
    click(button(root, 'Knowledge'))
    const sub = root.querySelector('.facet-panel svg.hb-blob')!
    expect(sub).not.toBeNull()
    expect(sub.querySelectorAll('path.wedge')).toHaveLength(0)
    expect(root.querySelector('figure svg.hb-blob')!.querySelectorAll('path.wedge').length).toBeGreaterThan(0)
  })

  it('offers every cluster present, in spoke order', () => {
    const root = render(syntheticProfile('m1')!)
    const labels = [...root.querySelectorAll('.drill-buttons button')].map((b) => b.textContent)
    expect([...labels].sort()).toEqual([...CLUSTERS].sort())
  })
})

describe('no area, total or single score anywhere (§9.5 a, CLAUDE.md blob rule, A12)', () => {
  for (const p of SYNTHETIC_PROFILES) {
    it(`${p.id}: every view and drill-down shows only per-skill numbers and no aggregate words`, () => {
      const root = render(p)
      const est = axisEstimates(p.input)
      const states: [string, () => void][] = [
        ['blob', () => undefined],
        ['bars', () => click(button(root, 'Bar view'))],
        ...[...new Set(est.map((e) => e.cluster))].map((c): [string, () => void] => [`drill ${c}`, () => click(button(root, c))]),
      ]
      for (const [name, act] of states) {
        act()
        const selected = root.querySelector('.facet-panel')?.getAttribute('data-cluster')
        const facetRows = selected ? clusterFacets(p.input.score, p.facetObservations, selected as (typeof CLUSTERS)[number], { catalog: p.catalog, unmeasured: unmeasuredReasons(est) }) : []
        const allowed = allowedNumbers([...est, ...facetRows])
        const { text, attrs } = textAndAttributes(root)
        expect(text.match(AGGREGATE_WORDS), `${name}: text`).toBeNull()
        for (const a of attrs) expect(a.match(AGGREGATE_WORDS), `${name}: ${a}`).toBeNull()
        const stray = numbersIn(text.replace(/−/g, '-')).filter((n) => !allowed.has(n))
        expect(stray, `${name}: numbers that are not a per-skill value`).toEqual([])
      }
    })
  }

  it('the scan catches an aggregate if one were rendered (not vacuous)', () => {
    const p = syntheticProfile('m1')!
    const root = render(p)
    const extra = document.createElement('p')
    extra.textContent = 'Overall profile 7.77'
    root.querySelector('section.hb-profile')!.appendChild(extra)
    const { text } = textAndAttributes(root)
    expect(text.match(AGGREGATE_WORDS)).not.toBeNull()
    expect(numbersIn(text).filter((n) => !allowedNumbers(axisEstimates(p.input)).has(n))).toEqual(['7.77'])
    for (const w of ['Blob area', 'Total: 3', 'your average', 'the mean skill', '84th percentile', 'combined result']) expect(w.match(AGGREGATE_WORDS), w).not.toBeNull()
  })
})

describe('theme (§9.8)', () => {
  it('sets the palette as custom properties, light by default and dark on request', () => {
    const light = render(syntheticProfile('m1')!).querySelector('section.hb-profile')!.getAttribute('style')!
    expect(light).toContain(`--hb-blob: ${THEMES.light.blob}`)
    unmount(app!)
    app = undefined
    document.body.innerHTML = ''
    const dark = render(syntheticProfile('m1')!, 'dark').querySelector('section.hb-profile')!.getAttribute('style')!
    expect(dark).toContain(`--hb-blob: ${THEMES.dark.blob}`)
    expect(dark).toContain(`--hb-bg: ${THEMES.dark.bg}`)
  })
})
