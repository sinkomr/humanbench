/**
 * Quantitative facets are the six topic groups (`tasks/quant/topics.ts`), not the 18 templates (UX
 * review D4, option A, a provisional default; DATA-14): counting, estimation and labels go by group.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { scoreAll } from '../engine/scorer'
import type { Observation } from '../engine/types'
import { QUANT_GROUPS, QUANT_GROUP_IDS, quantGroupOfTemplate } from '../tasks/quant/topics'
import { QUANT_TEMPLATES } from '../tasks/quant/templates'
import { FAMILIES } from '../tasks/registry'
import { clusterFacets, drillFacet, FACET_LABELS, FACET_MIN_ITEMS, facetLabel, facetLabelLines, FACET_LINE_CHARS, type FacetObservation } from './facets'
import { syntheticProfile } from './synthetic'

const quantObs = (facet: string, i: number): FacetObservation => ({ facet, obs: { kind: '2pl', axis: 'QR', a: 1.1, b: (i % 5) - 2, y: (i % 3 === 0 ? 0 : 1) as 0 | 1 } satisfies Observation })

describe('the quant template → topic group mapping (D4, DATA-14)', () => {
  it('is total: every quant template and every facet a registered QR family declares has a group', () => {
    expect(QUANT_TEMPLATES.length).toBeGreaterThanOrEqual(18)
    for (const t of QUANT_TEMPLATES) {
      expect(quantGroupOfTemplate(t), `${t} has a group`).toBeDefined()
      expect(QUANT_GROUP_IDS).toContain(drillFacet('QR', t))
    }
    const qr = Object.values(FAMILIES).filter((f) => f.axis === 'QR')
    expect(qr.length).toBeGreaterThan(0)
    for (const f of qr) for (const t of f.facets) expect(QUANT_GROUP_IDS, `${f.name}: ${t}`).toContain(drillFacet('QR', t))
    // Every group is reached by some template.
    expect(new Set(QUANT_TEMPLATES.map((t) => drillFacet('QR', t)))).toEqual(new Set(QUANT_GROUP_IDS))
  })

  it('maps a group to itself and leaves the facets of other axes alone', () => {
    for (const id of QUANT_GROUP_IDS) expect(drillFacet('QR', id)).toBe(id)
    expect(drillFacet('MAT', 'series')).toBe('series')
    expect(drillFacet('KST', 'percent')).toBe('percent')
    expect(drillFacet('QR', 'not_a_template')).toBe('not_a_template')
  })

  it('names each group by its own label, on at most two chart lines in its own words', () => {
    for (const g of QUANT_GROUPS) {
      expect(FACET_LABELS[g.id]).toBe(g.label)
      expect(facetLabel(g.id)).toBe(g.label)
      const lines = facetLabelLines(g.label)
      expect(lines.join(' ')).toBe(g.label)
      expect(lines.length).toBeLessThanOrEqual(2)
      expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(FACET_LINE_CHARS)
    }
    expect(facetLabelLines('Mental rotation (3D)')).toEqual(['Mental rotation (3D)'])
  })
})

describe('the Quantitative drill-down by group (D4, DATA-14)', () => {
  it('counts and estimates by group: the rows are the groups present, in display order, each with the sum of its templates', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...QUANT_TEMPLATES), { minLength: 1, maxLength: 40 }), (templates) => {
        const obs = templates.map(quantObs)
        const score = scoreAll(obs.map((o) => o.obs))
        const rows = clusterFacets(score, obs, 'Quantitative')
        const want = QUANT_GROUPS.filter((g) => templates.some((t) => g.templates.includes(t)))
        expect(rows.map((r) => r.id)).toEqual(want.map((g) => `QR:${g.id}`))
        for (const [i, g] of want.entries()) {
          const n = templates.filter((t) => g.templates.includes(t)).length
          expect(rows[i]).toMatchObject({ facet: g.id, name: g.label, nItems: n, unit: 'item', measured: n >= FACET_MIN_ITEMS })
        }
      }),
      { numRuns: 80 },
    )
  })

  it('lists the catalog\'s templates as their groups, once each', () => {
    const rows = clusterFacets(scoreAll([]), [], 'Quantitative', { catalog: { QR: [...QUANT_TEMPLATES].reverse() } })
    expect(rows.map((r) => r.facet)).toEqual(QUANT_GROUP_IDS)
    expect(rows.every((r) => r.reason === 'insufficient_data' && r.nItems === 0)).toBe(true)
  })

  it('reaches an estimate in the m1 profile where no template did (6 + 5 + 3 answers are one group of 14)', () => {
    const p = syntheticProfile('m1')!
    const rows = clusterFacets(p.input.score, p.facetObservations, 'Quantitative', { catalog: p.catalog })
    expect(rows.map((r) => [r.facet, r.nItems, r.measured])).toEqual([
      ['quant/arith_fractions_percent', 14, true],
      ['quant/ratios_rates_averages', 2, false],
    ])
  })

  it('takes a server estimate keyed by group, or by a lone template, and none from two templates of one group', () => {
    const score = scoreAll([])
    const one = (n: number): { mean: number; sd: number; n: number } => ({ mean: 0.4, sd: 0.5, n })
    const byGroup = clusterFacets(score, [], 'Quantitative', { precomputed: { QR: { 'quant/linear': one(6) } } })
    expect(byGroup).toHaveLength(1)
    expect(byGroup[0]).toMatchObject({ id: 'QR:quant/linear', measured: true, theta: 0.4, nItems: 6 })
    const lone = clusterFacets(score, [], 'Quantitative', { precomputed: { QR: { linear_eq: one(5) } } })
    expect(lone[0]).toMatchObject({ id: 'QR:quant/linear', measured: true, nItems: 5 })
    // Two templates of one group cannot be combined into a group estimate: the group shows its own count.
    const obs = Array.from({ length: 3 }, (_, i) => quantObs('system', i))
    const clash = clusterFacets(scoreAll(obs.map((o) => o.obs)), obs, 'Quantitative', { precomputed: { QR: { linear_eq: one(5), system: one(5) } } })
    expect(clash).toHaveLength(1)
    expect(clash[0]).toMatchObject({ id: 'QR:quant/linear', measured: false, reason: 'insufficient_data', nItems: 3 })
  })
})
