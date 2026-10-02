import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AXIS_INDEX } from '../engine/axes'
import { eapAxis, scoreAll } from '../engine/scorer'
import type { Observation } from '../engine/types'
import { countText, notMeasuredText } from './copy'
import { clusterFacets, FACET_MIN_ITEMS, facetLabel, unmeasuredReasons, type FacetObservation } from './facets'
import { Z90 } from './geometry'
import { axisEstimates } from './profile'
import { syntheticProfile } from './synthetic'

function items(facet: string, n: number, y: (i: number) => 0 | 1): FacetObservation[] {
  return Array.from({ length: n }, (_, i) => ({ facet, obs: { kind: '2pl', axis: 'MAT', a: 1.2, b: (i % 5) - 2, y: y(i) } satisfies Observation }))
}

describe('facet drill-down (§9.6, A12)', () => {
  it('shows an estimate only at ≥ 5 items: the EAP on the facet items with the axis posterior as prior', () => {
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
          if (mine.length >= FACET_MIN_ITEMS) {
            const want = eapAxis(mine, score.theta[k]!, score.cov[k]![k]!)
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
    expect(notMeasuredText(fwd.reason, fwd.nItems, fwd.unit)).toBe('Insufficient data (1 block; 5 needed)')
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

  it('pluralises counts', () => {
    expect(countText(1)).toBe('1 item')
    expect(countText(0)).toBe('0 items')
    expect(countText(3, 'block')).toBe('3 blocks')
    expect(notMeasuredText('insufficient_data', 1)).toBe('Insufficient data (1 item; 5 needed)')
    expect(notMeasuredText('insufficient_data', 2, 'block')).toBe('Insufficient data (2 blocks; 5 needed)')
  })

  it('names facets readably', () => {
    expect(facetLabel('3d_rotation')).toBe('3d rotation')
    expect(facetLabel('percent')).toBe('Percent')
    expect(facetLabel('digits_forward')).toBe('Digits forward')
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
