import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AXIS_INDEX } from '../engine/axes'
import { eapAxis, scoreAll } from '../engine/scorer'
import type { Observation } from '../engine/types'
import { countText, facetCaption, notMeasuredText } from './copy'
import { FAMILIES } from '../tasks/registry'
import { clusterFacets, FACET_LABELS, FACET_MIN_ITEMS, facetLabel, leaveOutPrior, unmeasuredReasons, type FacetObservation } from './facets'
import { Z90 } from './geometry'
import { axisEstimates } from './profile'
import { syntheticProfile } from './synthetic'

function items(facet: string, n: number, y: (i: number) => 0 | 1): FacetObservation[] {
  return Array.from({ length: n }, (_, i) => ({ facet, obs: { kind: '2pl', axis: 'MAT', a: 1.2, b: (i % 5) - 2, y: y(i) } satisfies Observation }))
}

describe('facet drill-down (§9.6, A12, UX review D4)', () => {
  it('shows an estimate only at ≥ 5 items: the EAP on the facet items with the leave-facet-out prior (the axis itself for a facet that holds the axis)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 12 }), fc.integer({ min: 0, max: 12 }), (nMatrix, nSeries) => {
        const obs = [...items('matrix', nMatrix, (i) => (i % 3 === 0 ? 0 : 1)), ...items('series', nSeries, (i) => (i % 2 === 0 ? 1 : 0))]
        if (obs.length === 0) return
        const score = scoreAll(obs.map((o) => o.obs))
        const rows = clusterFacets(score, obs, 'Reasoning')
        const k = AXIS_INDEX.MAT
        for (const row of rows) {
          const mine = obs.filter((o) => o.facet === row.facet).map((o) => o.obs)
          expect(row.nItems).toBe(mine.length)
          if (mine.length >= FACET_MIN_ITEMS && mine.length === obs.length) {
            expect(row).toMatchObject({ measured: true, theta: score.theta[k], sd: Math.sqrt(score.cov[k]![k]!) })
          } else if (mine.length >= FACET_MIN_ITEMS) {
            const prior = leaveOutPrior(score, 'MAT', mine)
            const want = eapAxis(mine, prior.mean, prior.variance)
            expect(row).toMatchObject({ measured: true, theta: want.mean, sd: want.sd })
          } else {
            expect(row).toMatchObject({ measured: false, reason: 'insufficient_data' })
            expect(row.theta).toBeUndefined()
          }
        }
      }),
      { numRuns: 60 },
    )
  })

  it('treats the threshold as exactly 5 items', () => {
    const four = items('matrix', 4, () => 1)
    const five = items('matrix', 5, () => 1)
    expect(clusterFacets(scoreAll(four.map((o) => o.obs)), four, 'Reasoning')[0]).toMatchObject({ measured: false, nItems: 4 })
    expect(clusterFacets(scoreAll(five.map((o) => o.obs)), five, 'Reasoning')[0]).toMatchObject({ measured: true, nItems: 5 })
    expect(FACET_MIN_ITEMS).toBe(5)
  })

  it('lists catalog facets without items, groups by axis, and gives no number on an unmeasured axis', () => {
    const p = syntheticProfile('m1')!
    const rows = clusterFacets(p.input.score, p.facetObservations, 'Reasoning', { catalog: { MAT: ['matrix', 'series', 'odd_one_out'], LG: ['ordering'] } })
    expect(rows.map((r) => r.id)).toEqual(['MAT:matrix', 'MAT:series', 'MAT:odd_one_out', 'LG:ordering'])
    expect(rows.map((r) => r.measured)).toEqual([true, true, false, false])
    expect(rows[0]!.group).toBe('Matrix & Series')
    const off = clusterFacets(p.input.score, p.facetObservations, 'Reasoning', { unmeasured: { MAT: 'skipped' } })
    expect(off.every((r) => !r.measured)).toBe(true)
  })

  it('gives facets of an unmeasured axis the axis reason, never "insufficient data"', () => {
    const p = syntheticProfile('skipped')!
    const est = axisEstimates(p.input)
    expect(unmeasuredReasons(est)).toMatchObject({ SPA: 'skipped', EMO: 'not_yet_available', LR: 'no_data' })
    const rows = clusterFacets(p.input.score, p.facetObservations, 'Spatial/Memory', { catalog: p.catalog, unmeasured: unmeasuredReasons(est) })
    const spa = rows.find((r) => r.id === 'SPA:3d_rotation')!
    // 16 items, but the axis was skipped: not measured (skipped), not "insufficient data (16 items)".
    expect(spa).toMatchObject({ measured: false, reason: 'skipped', nItems: 16 })
    expect(notMeasuredText(spa.reason, spa.nItems, spa.unit)).toBe('Not measured (skipped)')
    // A facet of an axis never offered yet, and of one with no data.
    const emo = clusterFacets(p.input.score, [], 'Social-Creative', { catalog: { EMO: ['appraisal'] }, unmeasured: unmeasuredReasons(est) })
    expect(emo[0]).toMatchObject({ measured: false, reason: 'not_yet_available' })
    const lr = clusterFacets(p.input.score, [], 'Reasoning', { catalog: { LR: ['flaw'] }, unmeasured: unmeasuredReasons(est) })
    expect(lr[0]).toMatchObject({ measured: false, reason: 'no_data' })
  })

  it('counts a block as one observation toward the threshold and says "block" (A12, A18)', () => {
    const p = syntheticProfile('m1')!
    const rows = clusterFacets(p.input.score, p.facetObservations, 'Spatial/Memory', { catalog: p.catalog, unmeasured: unmeasuredReasons(axisEstimates(p.input)) })
    const fwd = rows.find((r) => r.id === 'WM:digits_forward')!
    expect(fwd).toMatchObject({ measured: false, reason: 'insufficient_data', nItems: 1, unit: 'block' })
    expect(notMeasuredText(fwd.reason, fwd.nItems, fwd.unit)).toBe('Insufficient data (1 timed task; 5 needed)')
    expect(rows.find((r) => r.id === 'SPA:3d_rotation')).toMatchObject({ measured: true, unit: 'item' })
    // Five blocks reach the threshold like five items.
    const blocks: FacetObservation[] = Array.from({ length: FACET_MIN_ITEMS }, (_, i) => ({
      facet: 'corsi',
      block: true,
      obs: { kind: 'grm', axis: 'WM', a: 1.5, b: [-1, 0, 1], y: i % 4 } satisfies Observation,
    }))
    const five = clusterFacets(scoreAll(blocks.map((o) => o.obs)), blocks, 'Spatial/Memory')
    expect(five.find((r) => r.id === 'WM:corsi')).toMatchObject({ measured: true, nItems: 5, unit: 'block' })
  })

  it('pluralises counts in the person\'s words: questions and timed tasks (UX-040)', () => {
    expect(countText(1)).toBe('1 question')
    expect(countText(0)).toBe('0 questions')
    expect(countText(3, 'block')).toBe('3 timed tasks')
    expect(notMeasuredText('insufficient_data', 1)).toBe('Insufficient data (1 question; 5 needed)')
    expect(notMeasuredText('insufficient_data', 2, 'block')).toBe('Insufficient data (2 timed tasks; 5 needed)')
  })

  it('names facets in plain words, never the generator code (UX-040)', () => {
    expect(facetLabel('3d_rotation')).toBe('Mental rotation (3D)')
    expect(facetLabel('percent')).toBe('Percentages')
    expect(facetLabel('digits_forward')).toBe('Digits, same order')
    expect(facetLabel('simple_rt')).toBe('Simple reaction time')
    expect(facetLabel('linear_eq')).toBe('Linear equations')
    // An id nobody mapped falls back to the id as words.
    expect(facetLabel('odd_one_out')).toBe('Odd one out')
    expect(facetLabel('constructor')).toBe('Constructor')
  })

  it('has a plain name for every facet the registered task families declare', () => {
    const ids = [...new Set(Object.values(FAMILIES).flatMap((f) => [...f.facets]))]
    expect(ids.length).toBeGreaterThan(25)
    for (const id of ids) {
      expect(Object.hasOwn(FACET_LABELS, id), `${id} has an entry in FACET_LABELS`).toBe(true)
      // Words, not a code: no underscore, no digit-first id, and a capital letter to start.
      expect(facetLabel(id), id).toMatch(/^[A-Z]/)
      expect(facetLabel(id), id).not.toMatch(/_/)
    }
    // No two facets of one axis share a name (they sit side by side in one table).
    for (const f of Object.values(FAMILIES)) expect(new Set(f.facets.map(facetLabel)).size).toBe(f.facets.length)
    const all = Object.values(FACET_LABELS)
    expect(new Set(all).size).toBe(all.length)
  })

  it('names a facet row by its label alone: the skill is the next column', () => {
    const p = syntheticProfile('m1')!
    const rows = clusterFacets(p.input.score, p.facetObservations, 'Quantitative', { catalog: p.catalog, unmeasured: unmeasuredReasons(axisEstimates(p.input)) })
    // The quant templates (percent, arith, fraction; ratio) show as their topic groups (D4, DATA-14).
    expect(rows.map((r) => r.name)).toEqual(['Arithmetic, fractions and percentages', 'Ratios, rates and averages'])
    expect(rows.every((r) => !r.name.includes('('))).toBe(true)
    // A long name takes two chart lines, in its own words.
    expect(rows.map((r) => r.shortLabel.join(' '))).toEqual(rows.map((r) => r.name))
    expect(rows[0]!.shortLabel).toEqual(['Arithmetic, fractions', 'and percentages'])
  })
})

describe('facets that arrive computed (the server’s, M2.7)', () => {
  const p = syntheticProfile('m1')!

  it('shows a given facet estimate with its count, in place of a local one, on a measured axis', () => {
    const rows = clusterFacets(p.input.score, [], 'Reasoning', { precomputed: { MAT: { series: { mean: 0.5, sd: 0.4, n: 6 } } } })
    const row = rows.find((r) => r.id === 'MAT:series')!
    expect(row).toMatchObject({ measured: true, theta: 0.5, sd: 0.4, nItems: 6, unit: 'item', axis: 'MAT' })
    expect(row.lo90).toBeCloseTo(0.5 - Z90 * 0.4, 9)
    // a local estimate of the same facet gives way to it
    const obs = items('series', 8, () => 1)
    const both = clusterFacets(p.input.score, obs, 'Reasoning', { precomputed: { MAT: { series: { mean: -1, sd: 0.3, n: 5 } } } })
    expect(both.find((r) => r.id === 'MAT:series')).toMatchObject({ theta: -1, nItems: 5 })
    // facets it does not give are as before
    expect(both.find((r) => r.id === 'MAT:matrix')).toBeUndefined()
  })

  it('gives no number on an axis that is not measured, however the facet came', () => {
    const rows = clusterFacets(p.input.score, [], 'Reasoning', {
      precomputed: { MAT: { series: { mean: 0.5, sd: 0.4, n: 6 } } },
      unmeasured: { MAT: 'skipped' },
    })
    expect(rows.find((r) => r.id === 'MAT:series')).toMatchObject({ measured: false, reason: 'skipped' })
  })
})

describe('the facet caption (UX review D4)', () => {
  it('says why a facet sits close to its skill under the leave-facet-out prior, in plain words', () => {
    const text = facetCaption('Quantitative')
    expect(text).toContain('Facets of Quantitative, in SD units on a provisional scale.')
    expect(text).toContain("Each facet's range also draws on the rest of its skill, so for now a facet sits close to its skill.")
    expect(text).not.toMatch(/TODO|\{|\}|undefined/)
  })
})
