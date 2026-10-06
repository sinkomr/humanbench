import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { cosine, dot, isFiniteVec, norm, normalise } from './vec'

const finite = fc.double({ min: -1e3, max: 1e3, noNaN: true, noDefaultInfinity: true })

describe('vec helpers (M6.4)', () => {
  it('dot and norm on small vectors', () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32)
    expect(norm([3, 4])).toBe(5)
    expect(norm(new Float32Array([0, 0, 0]))).toBe(0)
  })

  it('accepts Float32Array and number[] alike', () => {
    const a = new Float32Array([0.5, -0.25, 1])
    const b = [0.5, -0.25, 1]
    expect(dot(a, a)).toBe(dot(b, b))
    expect(cosine(a, [1, 0, 0])).toBeCloseTo(cosine(b, [1, 0, 0]), 12)
  })

  it('throws on length mismatch', () => {
    expect(() => dot([1, 2], [1, 2, 3])).toThrow(RangeError)
    expect(() => cosine([1], [1, 0])).toThrow(RangeError)
  })

  it('normalise gives unit length, and zeros for a zero or non-finite vector', () => {
    const u = normalise([3, 4])
    expect(u).toBeInstanceOf(Float32Array)
    expect(norm(u)).toBeCloseTo(1, 6)
    expect([...normalise([0, 0])]).toEqual([0, 0])
    expect([...normalise([1, Number.NaN])]).toEqual([0, 0])
    expect([...normalise([Number.POSITIVE_INFINITY, 1])]).toEqual([0, 0])
  })

  it('cosine of a zero or non-finite vector is 0, never NaN', () => {
    expect(cosine([0, 0, 0], [1, 2, 3])).toBe(0)
    expect(cosine([1, 2, 3], new Float32Array(3))).toBe(0)
    expect(cosine([0, 0], [0, 0])).toBe(0)
    expect(cosine([Number.NaN, 1], [1, 1])).toBe(0)
    expect(cosine([Number.POSITIVE_INFINITY, 1], [1, 1])).toBe(0)
  })

  it('cosine of parallel, opposite and orthogonal vectors', () => {
    expect(cosine([1, 1], [2, 2])).toBeCloseTo(1, 12)
    expect(cosine([1, 1], [-3, -3])).toBeCloseTo(-1, 12)
    expect(cosine([1, 0], [0, 5])).toBe(0)
  })

  it('isFiniteVec', () => {
    expect(isFiniteVec([1, 2])).toBe(true)
    expect(isFiniteVec(new Float32Array([1, Number.NaN]))).toBe(false)
    expect(isFiniteVec([])).toBe(true)
  })

  it('property: cosine is symmetric, in [-1, 1], and scale-invariant', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }).chain((n) => fc.tuple(fc.array(finite, { minLength: n, maxLength: n }), fc.array(finite, { minLength: n, maxLength: n }))),
        fc.double({ min: 0.01, max: 100, noNaN: true }),
        ([a, b], k) => {
          const c = cosine(a, b)
          expect(Number.isNaN(c)).toBe(false)
          expect(c).toBeGreaterThanOrEqual(-1)
          expect(c).toBeLessThanOrEqual(1)
          expect(cosine(b, a)).toBeCloseTo(c, 9)
          // scaling keeps the angle unless it pushes components into the subnormal range
          const scaled = a.map((x) => x * k)
          if (a.every((x, i) => x === 0 || (Math.abs(x) >= 1e-300 && Math.abs(scaled[i] as number) >= 1e-300))) {
            expect(cosine(scaled, b)).toBeCloseTo(c, 6)
          }
        },
      ),
      { numRuns: 1000 },
    )
  })

  it('tiny and huge vectors still have a direction (no underflow or overflow in the squares)', () => {
    expect(cosine([1e-170, 0], [1e-170, 1e-170])).toBeCloseTo(Math.SQRT1_2, 12)
    expect(cosine([1e170, 0], [1e170, 1e170])).toBeCloseTo(Math.SQRT1_2, 12)
    expect(norm([3e-170, 4e-170]) / 5e-170).toBeCloseTo(1, 12)
    expect(norm([3e200, 4e200]) / 5e200).toBeCloseTo(1, 12)
    expect(norm([Number.NaN, 1])).toBeNaN()
    expect(norm([Number.NEGATIVE_INFINITY, 1])).toBe(Number.POSITIVE_INFINITY)
    expect(norm(normalise([1e-170, 1e-170]))).toBeCloseTo(1, 6)
    expect(norm(normalise([1e200, -1e200]))).toBeCloseTo(1, 6)
  })
})
