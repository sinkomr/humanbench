import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AXIS_INDEX } from '../engine/axes'
import { eapAxis, scoreAll } from '../engine/scorer'
import type { Observation } from '../engine/types'
import { clusterFacets, FACET_MIN_ITEMS, facetLabel, type FacetObservation } from './facets'
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
    const muted = clusterFacets(p.input.score, p.facetObservations, 'Reasoning', { unmeasured: ['MAT'] })
    expect(muted.every((r) => !r.measured)).toBe(true)
  })

  it('names facets readably', () => {
    expect(facetLabel('3d_rotation')).toBe('3d rotation')
    expect(facetLabel('percent')).toBe('Percent')
    expect(facetLabel('digits_forward')).toBe('Digits forward')
  })
})
