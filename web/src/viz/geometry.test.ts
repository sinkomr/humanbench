import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { formatTheta, offScaleOf, polar, R_MIN_FRACTION, radiusScale, ringLabel, ringSpacing, RING_THETAS, spokeAngle, THETA_CLAMP_LOW, Z90 } from './geometry'

describe('radius (§9.1, CLAUDE.md: linear in θ over [−3, 3])', () => {
  const R = 180
  const r = radiusScale(R)

  it('is R·(θ + 3)/6 wherever the clamp is inactive', () => {
    fc.assert(
      fc.property(fc.double({ min: -3 + 6 * R_MIN_FRACTION, max: 3, noNaN: true }), (t) => {
        expect(r(t)).toBeCloseTo((R * (t + 3)) / 6, 9)
      }),
    )
  })

  it('is linear, not area-proportional: equal θ steps give equal radius steps', () => {
    fc.assert(
      fc.property(fc.double({ min: -2.7, max: 3, noNaN: true }), fc.double({ min: -2.7, max: 3, noNaN: true }), (a, b) => {
        expect(r(a) + r(b)).toBeCloseTo(2 * r((a + b) / 2), 9)
      }),
    )
  })

  it('clamps to [0.04R, R] and is monotone', () => {
    fc.assert(
      fc.property(fc.double({ min: -50, max: 50, noNaN: true }), fc.double({ min: -50, max: 50, noNaN: true }), (a, b) => {
        expect(r(a)).toBeGreaterThanOrEqual(R_MIN_FRACTION * R)
        expect(r(a)).toBeLessThanOrEqual(R)
        if (a <= b) expect(r(a)).toBeLessThanOrEqual(r(b))
      }),
    )
    expect(r(-3)).toBe(R_MIN_FRACTION * R)
    expect(r(3)).toBe(R)
    expect(r(99)).toBe(R)
  })

  it('puts the rings one SD (R/6) apart at θ = −2 … +2, with θ = −3 at the centre', () => {
    expect(ringSpacing(R)).toBe(30)
    expect(RING_THETAS.map((t) => r(t))).toEqual([30, 60, 90, 120, 150])
    expect(() => r(Number.NaN)).toThrow(RangeError)
    expect(() => radiusScale(0)).toThrow(RangeError)
  })
})

describe('off-scale estimates (UX-037)', () => {
  const R = 180
  const r = radiusScale(R)

  it('an estimate is off scale exactly where the clamp changes the radius: the radius map itself stays linear', () => {
    fc.assert(
      fc.property(fc.double({ min: -8, max: 8, noNaN: true }), (t) => {
        const linear = (R * (t + 3)) / 6
        const clamped = Math.abs(r(t) - linear) > 1e-9
        const end = offScaleOf(t)
        // Clamped at the bottom or the top ⇔ off scale there; linear everywhere else.
        expect(end !== 'none', `θ = ${t}`).toBe(clamped)
        if (end === 'low') expect(r(t)).toBeCloseTo(R_MIN_FRACTION * R, 9)
        if (end === 'high') expect(r(t)).toBe(R)
      }),
      { numRuns: 300 },
    )
    expect(THETA_CLAMP_LOW).toBeCloseTo(-3 + 6 * R_MIN_FRACTION, 12)
  })
})

describe('layout helpers', () => {
  it('places spoke k at 2πk/K clockwise from 12 o’clock', () => {
    expect(spokeAngle(0, 17)).toBe(0)
    expect(spokeAngle(17, 17)).toBeCloseTo(2 * Math.PI, 12)
    const [x, y] = polar(10, 0)
    expect(x).toBeCloseTo(0, 12)
    expect(y).toBeCloseTo(-10, 12)
    const [x2, y2] = polar(10, Math.PI / 2) // 3 o'clock
    expect(x2).toBeCloseTo(10, 12)
    expect(y2).toBeCloseTo(0, 12)
  })

  it('labels rings in SD units (A12)', () => {
    expect(RING_THETAS.map(ringLabel)).toEqual(['−2 SD', '−1 SD', '0 SD', '+1 SD', '+2 SD'])
  })

  it('formats signed estimates with a typographic minus and no negative zero', () => {
    expect(formatTheta(0.4249)).toBe('+0.42')
    expect(formatTheta(-1.3)).toBe('−1.30')
    expect(formatTheta(-0.001)).toBe('0.00')
  })

  it('uses the 95th normal percentile for 90% intervals', () => {
    expect(Z90).toBeCloseTo(1.6449, 4)
  })
})
