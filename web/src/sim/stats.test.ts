/**
 * Recovery statistics (ROADMAP M1.4b; the TS twin of bank `hb.calib.simulate.recovery_stats`):
 * hand-checked values and fast-check properties.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { N_AXES } from '../engine/axes'
import { pearson, recoveryStats, Z_COVERAGE } from './stats'

const rows = (n: number, f: (i: number, k: number) => number): number[][] => Array.from({ length: n }, (_, i) => Array.from({ length: N_AXES }, (_, k) => f(i, k)))

describe('pearson', () => {
  it('matches a hand computation', () => {
    // x = 1..5, y = 2, 4, 5, 4, 5: sxy = 6, sxx = 10, syy = 6 → r = 6/√60
    expect(pearson([1, 2, 3, 4, 5], [2, 4, 5, 4, 5])).toBeCloseTo(6 / Math.sqrt(60), 15)
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 15)
  })

  it('rejects mismatched or too-short samples', () => {
    expect(() => pearson([1, 2], [1])).toThrow(RangeError)
    expect(() => pearson([1], [1])).toThrow(RangeError)
  })

  it('is invariant to positive affine maps and flips sign under negation (property)', () => {
    const v = fc.integer({ min: -500, max: 500 }).map((i) => i / 100) // θ-like values on a 0.01 grid (no denormals)
    const sample = fc.array(fc.tuple(v, v), { minLength: 3, maxLength: 40 })
    fc.assert(
      fc.property(sample, fc.double({ min: 0.1, max: 10, noNaN: true }), fc.double({ min: -3, max: 3, noNaN: true }), (pts, s, t) => {
        const x = pts.map((p) => p[0])
        const y = pts.map((p) => p[1])
        const r = pearson(x, y)
        fc.pre(Number.isFinite(r))
        expect(r).toBeGreaterThanOrEqual(-1 - 1e-12)
        expect(r).toBeLessThanOrEqual(1 + 1e-12)
        expect(pearson(x.map((v) => s * v + t), y)).toBeCloseTo(r, 9)
        expect(pearson(x.map((v) => -v), y)).toBeCloseTo(-r, 9)
      }),
    )
  })
})

describe('recoveryStats', () => {
  it('perfect estimates: r 1, RMSE 0, full coverage, mean SD as given', () => {
    const theta = rows(50, (i, k) => Math.sin(i * 1.3 + k))
    const stats = recoveryStats(theta, theta, rows(50, () => 0.1))
    expect(stats).toHaveLength(N_AXES)
    for (const ax of stats) {
      expect(ax.r).toBeCloseTo(1, 12)
      expect(ax.rmse).toBe(0)
      expect(ax.coverage).toBe(1)
      expect(ax.mean_sd).toBeCloseTo(0.1, 15)
    }
    expect(stats[0]!.code).toBe('MAT')
  })

  it('coverage counts |θ̂ − θ| ≤ z_.95·SD, boundary included', () => {
    const off = [0, Z_COVERAGE, Z_COVERAGE * 1.0001, -Z_COVERAGE]
    const [mat] = recoveryStats(rows(4, () => 0), rows(4, (i) => off[i]!), rows(4, () => 1))
    expect(mat!.coverage).toBe(0.75)
    expect(mat!.rmse).toBeCloseTo(Math.sqrt((2 * Z_COVERAGE ** 2 + (Z_COVERAGE * 1.0001) ** 2) / 4), 12)
    expect(mat!.r).toBeNaN() // constant truth: r is undefined, reported as NaN
  })

  it('rejects ragged, short or non-finite input', () => {
    const ok = rows(3, (i) => i)
    expect(() => recoveryStats(ok.slice(0, 1), ok.slice(0, 1), ok.slice(0, 1))).toThrow(RangeError)
    expect(() => recoveryStats(ok, ok.slice(0, 2), ok)).toThrow(RangeError)
    expect(() => recoveryStats(ok, ok, [...ok.slice(0, 2), [1, 2]])).toThrow(RangeError)
    expect(() => recoveryStats(ok, ok.map((r) => r.map(() => Number.NaN)), ok)).toThrow(RangeError)
  })

  it('RMSE² = bias² + variance of the error, and coverage lies in [0, 1] (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 30 }), fc.integer({ min: 0, max: 2 ** 31 - 1 }), (n, s) => {
        const u = (i: number, k: number, j: number): number => Math.sin(s + 12.9898 * i + 78.233 * k + 3.1 * j)
        const theta = rows(n, (i, k) => u(i, k, 1))
        const hat = rows(n, (i, k) => u(i, k, 1) + 0.5 * u(i, k, 2))
        const sd = rows(n, (i, k) => 0.2 + Math.abs(u(i, k, 3)))
        for (const [k, ax] of recoveryStats(theta, hat, sd).entries()) {
          const err = hat.map((r, i) => r[k]! - theta[i]![k]!)
          const m = err.reduce((a, b) => a + b, 0) / n
          const v = err.reduce((a, b) => a + (b - m) ** 2, 0) / n
          expect(ax.rmse ** 2).toBeCloseTo(m * m + v, 10)
          expect(ax.coverage).toBeGreaterThanOrEqual(0)
          expect(ax.coverage).toBeLessThanOrEqual(1)
        }
      }),
    )
  })
})
