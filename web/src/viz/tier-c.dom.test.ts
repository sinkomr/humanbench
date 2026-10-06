/**
 * Tier (c) marks in the real DOM (ROADMAP M6.4 "hatch rendering"; DESIGN §5.4, §9.6, §9.7): the
 * profile view hatches the wedges of measured EMO and CRE and puts ◇ on their labels, and the
 * Social-Creative drill-down carries the M6 facet labels, "Unusual uses (experimental)" included,
 * with the same marks on the facet sub-blob. Before M6 (the M1 session) nothing is hatched and
 * the same facets, if listed, are "not measured" stubs. The layout model itself is tested in
 * `tier-c.test.ts`.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { scoreAll } from '../engine/scorer'
import type { Observation } from '../engine/types'
import { FACET_GROUP, HATCH_CAPTION, TIER_TEXT } from './copy'
import type { FacetObservation } from './facets'
import ProfileView from './ProfileView.svelte'
import { syntheticProfile, type SyntheticProfile } from './synthetic'

let app: ReturnType<typeof mount> | undefined

// jsdom has no ResizeObserver (width.ts needs one): a stub that never reports a size, so the
// charts keep the default text layout here.
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

const GLYPH_C = '◇'

function twoPl(axis: 'EMO' | 'CRE', n: number, y: (i: number) => 0 | 1): Observation[] {
  return Array.from({ length: n }, (_, i) => ({ kind: '2pl', axis, a: 1.2, b: (i % 5) - 2, y: y(i) }) satisfies Observation)
}
function gaussian(axis: 'CRE', n: number): Observation[] {
  return Array.from({ length: n }, (_, i) => ({ kind: 'gaussian', axis, lam: 1, d: 0, sigma: 0.45, x: 0.4 + 0.1 * (i % 3) }) satisfies Observation)
}
const tag = (facet: string, obs: readonly Observation[]): FacetObservation[] => obs.map((o) => ({ facet, obs: o }))

const M6_CATALOG = { EMO: ['appraisal_vignettes', 'situational_judgment'], CRE: ['remote_associates', 'alternative_uses'] } as const

/** The M1 axes as in the synthetic "every skill" profile, with the tier (c) axes answered through the four M6 facets. */
function m6Profile(): SyntheticProfile {
  const base = syntheticProfile('full')!
  const facetObservations: FacetObservation[] = [
    ...base.facetObservations.filter((o) => o.obs.axis !== 'EMO' && o.obs.axis !== 'CRE'),
    ...tag('appraisal_vignettes', twoPl('EMO', 6, (i) => (i % 3 === 0 ? 0 : 1))),
    ...tag('situational_judgment', twoPl('EMO', 3, () => 1)),
    ...tag('remote_associates', twoPl('CRE', 5, (i) => (i % 2 === 0 ? 1 : 0))),
    ...tag('alternative_uses', gaussian('CRE', 5)),
  ]
  return {
    id: 'm6',
    label: 'Tier (c) skills measured through the M6 facets',
    input: { score: scoreAll(facetObservations.map((o) => o.obs)), skipped: [] },
    facetObservations,
    catalog: { ...base.catalog, ...M6_CATALOG },
  }
}

function render(p: SyntheticProfile): HTMLElement {
  const target = document.createElement('div')
  document.body.appendChild(target)
  app = mount(ProfileView, { target, props: { input: p.input, facetObservations: p.facetObservations, facetCatalog: p.catalog } })
  flushSync()
  return target
}

function click(el: Element | null | undefined): void {
  expect(el).toBeTruthy()
  ;(el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
  flushSync()
}

const button = (root: HTMLElement, text: string): HTMLButtonElement | undefined => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

/** A label's text with the no-break space before its glyph read as a space. */
const labelText = (t: Element): string => t.textContent!.replace(/ /g, ' ')

describe('the profile view hatches measured tier (c) skills (§9.7, M6.4)', () => {
  it('hatches the wedges of measured EMO and CRE, and marks both with ◇ on the chart label and in the table', () => {
    const root = render(m6Profile())
    const main = root.querySelector('figure svg.hb-blob')!
    expect(main.querySelectorAll('path.hatch')).toHaveLength(2)
    const marked = [...main.querySelectorAll('text.label')].filter((t) => labelText(t).includes(` ${GLYPH_C}`))
    expect(marked.map((t) => labelText(t).replace(/\s+/g, ' ').trim()).filter((t) => /Emotion|Creative/.test(t))).toHaveLength(2)
    for (const id of ['EMO', 'CRE']) {
      const header = root.querySelector(`tr[data-row="${id}"] th`)!
      expect(header.querySelector('[aria-hidden="true"]')!.textContent).toContain(GLYPH_C)
      // The ◇ is read out as the tier (c) wording (UX review copy, `copy.ts`).
      expect(header.textContent).toContain(TIER_TEXT.c)
    }
    expect(root.querySelector('figcaption')!.textContent).toContain(HATCH_CAPTION)
  })

  it('the M1 session hatches nothing: EMO and CRE are "not measured" stubs, still marked ◇', () => {
    const root = render(syntheticProfile('m1')!)
    const main = root.querySelector('figure svg.hb-blob')!
    expect(main.querySelectorAll('path.hatch')).toHaveLength(0)
    expect(root.querySelector('figcaption')!.textContent).not.toContain(HATCH_CAPTION)
    for (const id of ['EMO', 'CRE']) {
      const row = root.querySelector(`tr[data-row="${id}"]`)!
      expect(row.querySelector('td.stub')!.textContent).toBe('Not measured (not offered yet)')
      expect(row.querySelector('th [aria-hidden="true"]')!.textContent).toContain(GLYPH_C)
    }
    const stubs = [...main.querySelectorAll('text.label.unmeasured')].map(labelText).filter((t) => /Emotion|Creative/.test(t))
    expect(stubs).toHaveLength(2)
    for (const t of stubs) expect(t).toMatch(new RegExp(` ${GLYPH_C}.*not measured`))
  })
})

describe('the Social-Creative drill-down carries the M6 facet labels (§5.4, §9.6)', () => {
  it('labels the four facets, marks alternative uses "experimental", and hatches the measured ones', () => {
    const root = render(m6Profile())
    click(button(root, 'Social-Creative'))
    const panel = root.querySelector('.facet-panel')!
    expect(panel.getAttribute('data-cluster')).toBe('Social-Creative')
    expect(panel.querySelector('h3')!.textContent).toBe('Social-Creative: facets')

    const rowName = (id: string): string => panel.querySelector(`tr[data-row="${id}"] th`)!.textContent!.replace(/[​ ]/g, ' ')
    // UX-040: a facet row is named by its label alone; the skill it belongs to is the next column.
    const skillOf = (id: string): string => panel.querySelector(`tr[data-row="${id}"] td.group-col`)!.textContent!.replace(/[​ ]/g, ' ')
    expect(panel.querySelectorAll('thead th')[1]!.textContent).toBe(FACET_GROUP)
    const named = [
      ['EMO:appraisal_vignettes', 'Emotion scenarios', 'Emotion Reading'],
      ['EMO:situational_judgment', 'Situational judgment', 'Emotion Reading'],
      ['CRE:remote_associates', 'Word links', 'Creative Thinking'],
      ['CRE:alternative_uses', 'Unusual uses (experimental)', 'Creative Thinking'],
    ] as const
    for (const [id, label, skill] of named) {
      expect(rowName(id).startsWith(label), id).toBe(true)
      expect(rowName(id)).not.toContain(skill)
      expect(skillOf(id)).toContain(skill)
    }
    // Every facet row carries the tier (c) mark; the raw facet keys are never shown.
    for (const id of ['EMO:appraisal_vignettes', 'EMO:situational_judgment', 'CRE:remote_associates', 'CRE:alternative_uses']) {
      expect(panel.querySelector(`tr[data-row="${id}"] th [aria-hidden="true"]`)!.textContent).toContain(GLYPH_C)
    }
    expect(panel.textContent).not.toMatch(/alternative_uses|appraisal_vignettes|remote_associates|situational_judgment/)

    // The facet sub-blob: four spokes, a hatch on the three measured facets, a stub for the one under 5 items.
    const sub = panel.querySelector('svg.hb-blob')!
    expect(sub.getAttribute('data-spokes')).toBe('4')
    expect(sub.querySelectorAll('path.hatch')).toHaveLength(3)
    const labels = [...sub.querySelectorAll('text.label')].map((t) => labelText(t).replace(/\s+/g, ' ').trim())
    expect(labels.some((t) => t.startsWith(`Unusual uses (experimental) ${GLYPH_C}`))).toBe(true)
    expect(labels.some((t) => t.startsWith(`Word links ${GLYPH_C}`))).toBe(true)
    expect(labels.filter((t) => /experimental/.test(t))).toHaveLength(1)
    const stub = [...sub.querySelectorAll('text.label.unmeasured')].map(labelText)
    expect(stub).toHaveLength(1)
    expect(stub[0]).toMatch(/^Situational judgment .*insufficient data$/)
    expect(panel.querySelector('tr[data-row="EMO:situational_judgment"] td.stub')!.textContent).toBe('Insufficient data (3 questions; 5 needed)')
    // Measured facets show numbers in the table, in SD units like every other row.
    for (const id of ['EMO:appraisal_vignettes', 'CRE:remote_associates', 'CRE:alternative_uses']) {
      expect(panel.querySelector(`tr[data-row="${id}"] td.stub`)).toBeNull()
      expect(panel.querySelector(`tr[data-row="${id}"]`)!.textContent).toMatch(/[+−-]\d\.\d{2}/)
    }
  })

  it('before M6 the same facets, if listed, are "not measured" stubs: no number, no chart, no hatch, label unchanged', () => {
    const m1 = syntheticProfile('m1')!
    const root = render({ ...m1, catalog: { ...m1.catalog, ...M6_CATALOG } })
    click(button(root, 'Social-Creative'))
    const panel = root.querySelector('.facet-panel')!
    for (const id of ['EMO:appraisal_vignettes', 'EMO:situational_judgment', 'CRE:remote_associates', 'CRE:alternative_uses']) {
      expect(panel.querySelector(`tr[data-row="${id}"] td.stub`)!.textContent).toBe('Not measured (not offered yet)')
    }
    // The labels and the ◇ are the same as when measured.
    expect(panel.querySelector('tr[data-row="CRE:alternative_uses"] th')!.textContent).toContain('Unusual uses (experimental)')
    for (const id of ['EMO:appraisal_vignettes', 'EMO:situational_judgment', 'CRE:remote_associates', 'CRE:alternative_uses']) {
      expect(panel.querySelector(`tr[data-row="${id}"] th [aria-hidden="true"]`)!.textContent).toContain(GLYPH_C)
    }
    // UX-041: a facet chart needs measured facets (3 or more); with none there is only the table, so nothing is hatched.
    expect(panel.querySelector('svg.hb-blob')).toBeNull()
    expect(root.querySelectorAll('path.hatch')).toHaveLength(0)
  })
})
