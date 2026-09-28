import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AXES, AXIS_CODES, N_AXES } from '../engine/axes'
import { scoreAll } from '../engine/scorer'
import { Z90 } from './geometry'
import { axisEstimates, interval90, stubLabel } from './profile'
import { spokeOrder } from './seriation'
import { syntheticProfile } from './synthetic'

const m1 = syntheticProfile('m1')!
const full = syntheticProfile('full')!

describe('axisEstimates (§9, A12, A15)', () => {
  it('always returns all 17 spokes, in the pinned spoke order', () => {
    for (const p of [m1, full, syntheticProfile('sparse')!]) {
      const est = axisEstimates(p.input)
      expect(est.map((e) => e.code)).toEqual([...spokeOrder()])
      expect(est).toHaveLength(N_AXES)
    }
    // Even with no observations at all: 17 "not measured" stubs.
    const none = axisEstimates({ score: scoreAll([]) })
    expect(none).toHaveLength(17)
    expect(none.every((e) => !e.measured && e.theta === undefined)).toBe(true)
  })

  it('marks an axis measured iff it has observations and was not skipped, with the stub reason', () => {
    const est = axisEstimates(m1.input)
    const observed = new Set(Object.keys(m1.input.score.eap))
    for (const e of est) {
      expect(e.measured).toBe(observed.has(e.code))
      if (!e.measured) {
        expect(e.reason).toBe(AXES.find((a) => a.code === e.code)!.status === 'v2' ? 'not_yet_available' : 'no_data')
        expect(e.theta).toBeUndefined()
      }
    }
    const skipped = axisEstimates(syntheticProfile('skipped')!.input).find((e) => e.code === 'SPA')!
    expect(skipped).toMatchObject({ measured: false, reason: 'skipped' })
    expect(stubLabel('skipped')).toBe('not measured')
    expect(stubLabel('insufficient_data')).toBe('insufficient data')
  })

  it('takes θ and SD from the correlated MAP and Laplace covariance', () => {
    for (const e of axisEstimates(full.input)) {
      const k = AXIS_CODES.indexOf(e.code)
      expect(e.theta).toBe(full.input.score.theta[k])
      expect(e.sd).toBe(Math.sqrt(full.input.score.cov[k]![k]!))
      expect(e.lo90).toBeCloseTo(e.theta! - Z90 * e.sd!, 12)
      expect(e.hi90).toBeCloseTo(e.theta! + Z90 * e.sd!, 12)
    }
  })

  it('mutes exactly the spokes whose 90% interval contains θ = 0 (§9.5, A12)', () => {
    fc.assert(
      fc.property(fc.double({ min: -4, max: 4, noNaN: true }), fc.double({ min: 0, max: 3, noNaN: true }), (theta, sd) => {
        const { lo90, hi90, relation } = interval90(theta, sd)
        const excludesZero = lo90 > 0 || hi90 < 0
        expect(relation === 'overlaps').toBe(!excludesZero)
        if (relation === 'above') expect(lo90).toBeGreaterThan(0)
        if (relation === 'below') expect(hi90).toBeLessThan(0)
      }),
    )
    for (const e of axisEstimates(full.input)) if (e.measured) expect(e.muted).toBe(e.lo90! <= 0 && e.hi90! >= 0)
    expect(() => interval90(Number.NaN, 1)).toThrow(RangeError)
  })

  it('validates the scorer output', () => {
    const s = m1.input.score
    expect(() => axisEstimates({ score: { ...s, theta: s.theta.slice(1) } })).toThrow(RangeError)
    expect(() => axisEstimates({ score: { ...s, eap: { ...s.eap, XYZ: { mean: 0, sd: 1 } } as typeof s.eap } })).toThrow(RangeError)
  })
})

