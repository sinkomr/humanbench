/**
 * The leave-facet-out prior of the drill-down (`facets.ts` module comment; UX review D4, option A,
 * a provisional default; DATA-02). A facet's items are counted once: its prior is the axis
 * posterior without them (a Laplace cavity), and a facet that holds its whole axis is the axis
 * estimate itself.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AXIS_INDEX, initialSigma, type AxisCode } from '../engine/axes'
import { observationInfo } from '../engine/irt'
import { EAP_HI, EAP_LO, EAP_N_GRID, eapAxis, mapTheta, MAP_TOL, scoreAll } from '../engine/scorer'
import type { Observation } from '../engine/types'
import { buildResults } from '../reveal/results'
import { botSave, DAY_MS, T0_MS } from '../reveal/test-support'
import { clusterFacets, leaveOutPrior, type FacetObservation } from './facets'
import { axisEstimates, interval90, type ProfileScore } from './profile'
import { syntheticProfile } from './synthetic'

const twoPl = (axis: AxisCode): fc.Arbitrary<Observation> =>
  fc.record({ a: fc.double({ min: 0.6, max: 2.2, noNaN: true }), b: fc.double({ min: -2, max: 2, noNaN: true }), y: fc.constantFrom(0 as const, 1 as const) }).map((r) => ({ kind: '2pl', axis, ...r }))

const anyItem = (axis: AxisCode): fc.Arbitrary<Observation> =>
  fc.oneof(
    twoPl(axis),
    fc
      .record({ a: fc.double({ min: 0.6, max: 2.2, noNaN: true }), b: fc.double({ min: -2, max: 2, noNaN: true }), y: fc.constantFrom(0 as const, 1 as const) })
      .map((r): Observation => ({ kind: '3pl', axis, c: 0.25, ...r })),
    fc
      .record({ d: fc.double({ min: -0.5, max: 0.5, noNaN: true }), sigma: fc.double({ min: 0.3, max: 0.8, noNaN: true }), x: fc.double({ min: -2, max: 2, noNaN: true }) })
      .map((r): Observation => ({ kind: 'gaussian', axis, lam: 1, ...r })),
  )

/** Gaussian terms whose posterior SD stays above the EAP grid step (0.13), so the grid EAP is the Gaussian's mean and SD. */
const gaussian = (axis: AxisCode): fc.Arbitrary<Observation> =>
  fc
    .record({ d: fc.double({ min: -0.5, max: 0.5, noNaN: true }), sigma: fc.double({ min: 0.5, max: 0.8, noNaN: true }), x: fc.double({ min: -2, max: 2, noNaN: true }) })
    .map((r) => ({ kind: 'gaussian', axis, lam: 1, ...r }))

const tag = (facet: string, obs: readonly Observation[], block = false): FacetObservation[] => obs.map((o) => (block ? { facet, obs: o, block: true } : { facet, obs: o }))

/** Observations on axes other than the drilled one, so the correlated model has something to borrow. */
const others = fc.tuple(fc.array(twoPl('QR'), { maxLength: 8 }), fc.array(twoPl('KST'), { maxLength: 8 }), fc.array(twoPl('VOC'), { maxLength: 6 })).map((xs) => xs.flat())

/** Σ over the facet's items of the expected information at θ, at its largest over the EAP grid. */
function maxInfo(obs: readonly Observation[]): number {
  let best = 0
  for (let i = 0; i < EAP_N_GRID; i++) {
    const t = EAP_LO + (i * (EAP_HI - EAP_LO)) / (EAP_N_GRID - 1)
    let s = 0
    for (const o of obs) s += observationInfo(o, t)
    best = Math.max(best, s)
  }
  return best
}

describe('a facet that holds its whole axis (D4: a one-facet axis shows the axis estimate itself)', () => {
  it('equals the axis estimate within the scorer tolerance, whatever the items and the other axes', () => {
    fc.assert(
      fc.property(fc.array(anyItem('MAT'), { minLength: 5, maxLength: 15 }), fc.array(anyItem('SPA'), { minLength: 5, maxLength: 15 }), others, (mat, spa, rest) => {
        const obs = [...tag('matrix', mat), ...tag('3d_rotation', spa), ...tag('x', rest)]
        const score = scoreAll(obs.map((o) => o.obs))
        for (const [cluster, axis, facet] of [
          ['Reasoning', 'MAT', 'matrix'],
          ['Spatial/Memory', 'SPA', '3d_rotation'],
        ] as const) {
          const k = AXIS_INDEX[axis]
          const row = clusterFacets(score, obs, cluster).find((r) => r.id === `${axis}:${facet}`)!
          const sd = Math.sqrt(score.cov[k]![k]!)
          expect(row.measured).toBe(true)
          expect(Math.abs(row.theta! - score.theta[k]!)).toBeLessThanOrEqual(MAP_TOL)
          expect(Math.abs(row.sd! - sd)).toBeLessThanOrEqual(MAP_TOL)
          // So it can never read "Below 0 SD" where its axis reads "Overlaps 0 SD" (DATA-02).
          expect(row.relation).toBe(interval90(score.theta[k]!, sd).relation)
        }
      }),
      { numRuns: 60 },
    )
  })
})

describe('the leave-facet-out prior (D4)', () => {
  it('never counts a facet twice: its precision is at most the facet\'s information plus the leave-out prior\'s precision', () => {
    // For 2PL items the posterior's −(log density)'' is 1/v + I_f(θ) (observed = expected information), so by
    // Cramér–Rao for a location its variance is at least 1/(1/v + E[I_f]) ≥ 1/(1/v + max I_f).
    fc.assert(
      fc.property(fc.array(twoPl('MAT'), { minLength: 5, maxLength: 14 }), fc.array(twoPl('MAT'), { minLength: 1, maxLength: 14 }), others, (matrix, series, rest) => {
        const obs = [...tag('matrix', matrix), ...tag('series', series), ...tag('x', rest)]
        const score = scoreAll(obs.map((o) => o.obs))
        for (const row of clusterFacets(score, obs, 'Reasoning')) {
          if (!row.measured) continue
          const mine = obs.filter((o) => o.facet === row.facet).map((o) => o.obs)
          const prior = leaveOutPrior(score, 'MAT', mine)
          const bound = 1 / prior.variance + maxInfo(mine)
          expect(1 / row.sd! ** 2, row.facet).toBeLessThanOrEqual(bound * (1 + 1e-9))
        }
      }),
      { numRuns: 80 },
    )
  })

  it('is the bound the old prior (the whole axis posterior, A12 as written) broke', () => {
    // The evidence profile of DATA-02 (#/dev/blob?profile=full): with the axis posterior as prior, some facet is more precise than its own items and the leave-out prior allow.
    const p = syntheticProfile('full')!
    const { score } = p.input
    let broken = 0
    for (const axis of ['MAT', 'LR', 'VOC', 'KST', 'KHU', 'KAP'] as const) {
      const k = AXIS_INDEX[axis]
      const byFacet = new Map<string, Observation[]>()
      for (const o of p.facetObservations) if (o.obs.axis === axis) byFacet.set(o.facet, [...(byFacet.get(o.facet) ?? []), o.obs])
      for (const mine of byFacet.values()) {
        if (mine.length < 5) continue
        const old = eapAxis(mine, score.theta[k]!, score.cov[k]![k]!)
        const prior = leaveOutPrior(score, axis, mine)
        if (1 / old.sd ** 2 > 1 / prior.variance + maxInfo(mine)) broken++
      }
    }
    expect(broken).toBeGreaterThan(0)
  })

  it('is the exact re-score without the facet when the terms are Gaussian, and the facet then lands on its axis', () => {
    // Gaussian terms make the posterior exactly Gaussian, so the Laplace cavity is exact, and prior × likelihood is the posterior again.
    fc.assert(
      fc.property(
        fc.array(gaussian('RT'), { minLength: 5, maxLength: 9 }),
        fc.array(gaussian('RT'), { minLength: 1, maxLength: 9 }),
        fc.array(gaussian('PS'), { maxLength: 6 }),
        fc.array(gaussian('MAT'), { maxLength: 6 }),
        (simple, choice, ps, mat) => {
          const obs = [...tag('simple_rt', simple, true), ...tag('choice_rt', choice, true), ...tag('coding', ps, true), ...tag('matrix', mat)]
          const all = obs.map((o) => o.obs)
          const score = scoreAll(all)
          const k = AXIS_INDEX.RT
          const prior = leaveOutPrior(score, 'RT', simple)
          const exact = mapTheta([...choice, ...ps, ...mat], new Array<number>(score.theta.length).fill(0), initialSigma())
          expect(Math.abs(prior.mean - exact.theta[k]!)).toBeLessThan(1e-7)
          expect(Math.abs(prior.variance - exact.cov[k]![k]!)).toBeLessThan(1e-9)
          const row = clusterFacets(score, obs, 'Speed').find((r) => r.id === 'RT:simple_rt')!
          expect(row).toMatchObject({ measured: true, unit: 'block', nItems: simple.length })
          expect(Math.abs(row.theta! - score.theta[k]!)).toBeLessThan(1e-5)
          expect(Math.abs(row.sd! - Math.sqrt(score.cov[k]![k]!))).toBeLessThan(1e-5)
        },
      ),
      { numRuns: 60 },
    )
  })

  it('makes facet intervals no narrower than their axis, where the old prior made every one narrower', () => {
    const ratios: number[] = []
    const before: number[] = []
    fc.assert(
      fc.property(fc.array(twoPl('MAT'), { minLength: 5, maxLength: 14 }), fc.array(twoPl('MAT'), { minLength: 1, maxLength: 14 }), others, (matrix, series, rest) => {
        const obs = [...tag('matrix', matrix), ...tag('series', series), ...tag('x', rest)]
        const score = scoreAll(obs.map((o) => o.obs))
        const k = AXIS_INDEX.MAT
        const axisSd = Math.sqrt(score.cov[k]![k]!)
        for (const row of clusterFacets(score, obs, 'Reasoning')) {
          if (!row.measured) continue
          const mine = obs.filter((o) => o.facet === row.facet).map((o) => o.obs)
          ratios.push(row.sd! / axisSd)
          before.push(eapAxis(mine, score.theta[k]!, score.cov[k]![k]!).sd / axisSd)
          // An EAP and a Laplace SD of the same posterior differ a little; never by a tenth.
          expect(row.sd! / axisSd, row.facet).toBeGreaterThan(0.9)
        }
      }),
      { numRuns: 100, seed: 4729 },
    )
    const median = (xs: number[]): number => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)]!
    expect(ratios.length).toBeGreaterThan(50)
    expect(median(ratios)).toBeGreaterThan(0.98)
    expect(Math.max(...before)).toBeLessThan(1)
    expect(median(before)).toBeLessThan(0.9)
  })

  it('takes out exactly the information of the removed items, is the posterior itself with nothing removed, and checks the axis', () => {
    const p = syntheticProfile('m1')!
    const { score } = p.input
    const k = AXIS_INDEX.MAT
    expect(leaveOutPrior(score, 'MAT', [])).toEqual({ mean: score.theta[k], variance: score.cov[k]![k] })
    const series = p.facetObservations.filter((o) => o.facet === 'series').map((o) => o.obs)
    const prior = leaveOutPrior(score, 'MAT', series)
    let info = 0
    for (const o of series) info += observationInfo(o, score.theta[k]!)
    expect(1 / prior.variance).toBeCloseTo(1 / score.cov[k]![k]! - info, 12)
    expect(() => leaveOutPrior(score, 'QR', series)).toThrow(RangeError)
  })

  it('uses the population prior when the posterior does not hold the removed items (inputs that do not agree)', () => {
    // A posterior without these items: taking their information off would leave less than the population prior knows.
    const items: Observation[] = Array.from({ length: 30 }, (_, i) => ({ kind: '2pl', axis: 'MAT', a: 2, b: (i % 7) - 3, y: (i % 2) as 0 | 1 }))
    const score: ProfileScore = scoreAll([{ kind: '2pl', axis: 'MAT', a: 1, b: 0, y: 1 }])
    expect(leaveOutPrior(score, 'MAT', items)).toEqual({ mean: 0, variance: initialSigma()[AXIS_INDEX.MAT]![AXIS_INDEX.MAT] })
  })
})

describe('the UX review evidence profiles (DATA-02)', () => {
  const level = { MAT: 3, SPA: 0.2, QR: -0.5, WM: -0.4, RT: -0.3, PS: -0.3, CAL: 0 } as const
  const first = botSave('s_E2ERICH00000001', { level, seed: 'e2e-rich-1' })
  const second = botSave('s_E2ERICH00000002', { level, seed: 'e2e-rich-2', base: first.save, startedMs: T0_MS + 8 * DAY_MS })
  const full = syntheticProfile('full')!
  const cases = [
    ['one session', buildResults(first.save)!],
    ['two sessions', buildResults(second.save)!],
    ['dev profile "full"', { input: full.input, facetObservations: full.facetObservations }],
  ] as const

  it.each(cases)('%s: a one-facet skill repeats its axis, and every facet sits on its axis with about its width', (_, r) => {
    const est = axisEstimates(r.input)
    let measured = 0
    for (const cluster of new Set(est.map((e) => e.cluster))) {
      for (const row of clusterFacets(r.input.score, r.facetObservations, cluster)) {
        if (!row.measured) continue
        measured++
        const axis = est.find((e) => e.code === row.axis)!
        const holdsAxis = row.nItems === r.facetObservations.filter((o) => o.obs.axis === row.axis).length
        if (holdsAxis) {
          expect(row, row.id).toMatchObject({ theta: axis.theta, sd: axis.sd, relation: axis.relation })
        } else {
          expect(Math.abs(row.theta! - axis.theta!), row.id).toBeLessThan(0.15)
          expect(row.sd! / axis.sd!, row.id).toBeGreaterThan(0.9)
        }
      }
    }
    expect(measured).toBeGreaterThan(0)
  })
})
