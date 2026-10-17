import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { initialSigma } from './axes'
import { selectionAim } from './selector'
import type { Observation } from './types'
import { DEVICE_AXES, DEVICE_MEAN_BOUND, DEVICE_SD_MIN, boundedDeviceTerm, deviceEstimate, deviceEvidence, gridPosterior, summaryEvidence } from './xskill'

const sigma = initialSigma()
const est = fc.record({
  axis: fc.constantFrom(...DEVICE_AXES),
  mean: fc.double({ min: -1e6, max: 1e6, noNaN: true }),
  sd: fc.double({ min: 1e-9, max: 1e6, noNaN: true }),
})

describe('device estimates for the aim (DESIGN §7.4, amended 2026-10-17; public.device_estimates)', () => {
  it('names the timed skills only: the ones the server never serves', () => {
    expect([...DEVICE_AXES]).toEqual(['WM', 'RT', 'PS'])
  })

  it('summarises a skill\'s blocks as its grid posterior under the scoring prior, and nothing for a skill without one', () => {
    const obs: Observation[] = [
      { kind: 'gaussian', axis: 'RT', lam: 1, d: 0, sigma: 0.6, x: 1.1 },
      { kind: 'gaussian', axis: 'PS', lam: 1, d: 0, sigma: 0.5, x: -0.4 },
      { kind: '2pl', axis: 'MAT', a: 1, b: 0, y: 1 },
    ]
    const rt = deviceEstimate('RT', obs, { sigma })!
    const one = gridPosterior(Array.from({ length: 61 }, (_, i) => { const t = -4 + (8 * i) / 60; return -0.5 * ((1.1 - t) / 0.6) ** 2 }), 0, 1)
    expect(rt.axis).toBe('RT')
    expect(rt.mean).toBeCloseTo(one.mean, 9)
    expect(rt.sd).toBeCloseTo(one.sd, 9)
    expect(deviceEstimate('WM', obs, { sigma })).toBeNull()
  })

  it('bounds every estimate: λ in (0, 1/sd_min² − 1/v0], |x| ≤ 4, sd ≥ sd_min, |mean| ≤ 4 (fast-check)', () => {
    const v0 = gridPosterior(null, 0, 1).sd ** 2
    fc.assert(
      fc.property(est, (e) => {
        const t = boundedDeviceTerm(e)
        if (t === null) return
        expect(t.lam).toBeGreaterThan(0)
        expect(t.lam).toBeLessThanOrEqual(1 / DEVICE_SD_MIN ** 2 - 1 / v0 + 1e-12)
        expect(Math.abs(t.x)).toBeLessThanOrEqual(DEVICE_MEAN_BOUND)
        expect(Math.abs(t.mean)).toBeLessThanOrEqual(DEVICE_MEAN_BOUND)
        expect(t.sd).toBeGreaterThanOrEqual(DEVICE_SD_MIN)
      }),
    )
  })

  it('says nothing for an sd at or above the prior\'s, and refuses what is not a finite estimate', () => {
    expect(boundedDeviceTerm({ axis: 'WM', mean: 1, sd: 1.2 })).toBeNull()
    expect(deviceEvidence({ axis: 'WM', mean: 1, sd: 5 })).toEqual([])
    expect(() => boundedDeviceTerm({ axis: 'WM', mean: Number.NaN, sd: 0.5 })).toThrow(RangeError)
    expect(() => boundedDeviceTerm({ axis: 'WM', mean: 0, sd: 0 })).toThrow(RangeError)
  })

  it('inside the bounds it is exactly the earlier-session evidence of the same summary (one message, one rule)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...DEVICE_AXES), fc.double({ min: -1.5, max: 1.5, noNaN: true }), fc.double({ min: 0.45, max: 0.9, noNaN: true }), (axis, mean, sd) => {
        const a = deviceEvidence({ axis, mean, sd })
        const b = summaryEvidence(axis, mean, sd, 0, 1)
        if (b.length === 0 || b[0]!.kind !== 'gaussian' || Math.abs(b[0]!.x) > DEVICE_MEAN_BOUND) return
        expect(a).toHaveLength(1)
        const [x, y] = [a[0]!, b[0]!]
        if (x.kind !== 'gaussian' || y.kind !== 'gaussian') throw new Error('gaussian')
        expect(x.sigma).toBeCloseTo(y.sigma, 12)
        expect(x.x).toBeCloseTo(y.x, 12)
      }),
    )
  })

  it('a strong memory block moves the aim of a reasoning part up; the scores are not the evidence\'s business', () => {
    const blocks: Observation[] = [{ kind: 'gaussian', axis: 'WM', lam: 1, d: 0, sigma: 0.35, x: 2 }]
    const e = deviceEstimate('WM', blocks, { sigma })!
    const aim = selectionAim([], { earlier: deviceEvidence(e) })
    expect(aim.MAT!).toBeGreaterThan(0.3)
    expect(selectionAim([]).MAT).toBe(0)
  })
})
