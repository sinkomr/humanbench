import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AXES, AXIS_CODES, N_AXES, type AxisCode } from '../engine/axes'
import { scoreAll } from '../engine/scorer'
import { syntheticProfile } from '../viz/synthetic'
import { PEAKS_MAX, PEAKS_MIN_MEASURED, distinctivePeaks, withinPersonContrasts } from './peaks'

const diag = (sd: number): number[][] => Array.from({ length: N_AXES }, (_, i) => Array.from({ length: N_AXES }, (_, j) => (i === j ? sd * sd : 0)))
const score = (theta: number[], cov: number[][]) => ({ theta, cov, eap: {} })
const at = (v: Partial<Record<AxisCode, number>>): number[] => AXIS_CODES.map((k) => v[k] ?? 0)

describe('within-person contrasts (A12)', () => {
  it('are θ_k minus the mean of the measured skills, and sum to 0', () => {
    const m: AxisCode[] = ['MAT', 'QR', 'SPA', 'WM']
    const c = withinPersonContrasts(score(at({ MAT: 1, QR: 0.2, SPA: -0.4, WM: 0.2 }), diag(0.3)), m)
    expect(c.map((x) => x.code)).toEqual(m)
    expect(c[0]!.contrast).toBeCloseTo(1 - 0.25, 12)
    expect(c.reduce((s, x) => s + x.contrast, 0)).toBeCloseTo(0, 12)
  })

  it('has the variance c′Σc of the correlated posterior: independent skills give sd·√(1 − 1/m)', () => {
    const m: AxisCode[] = ['MAT', 'QR', 'SPA', 'WM', 'RT']
    const c = withinPersonContrasts(score(at({}), diag(0.5)), m)
    for (const x of c) expect(x.sd).toBeCloseTo(0.5 * Math.sqrt(1 - 1 / 5), 12)
  })

  it('a strongly correlated pair is not made to differ by noise: the contrast between them is tighter', () => {
    const cov = diag(0.5)
    const [i, j] = [AXES[0]!.index, AXES[5]!.index] // MAT, QR
    cov[i]![j] = cov[j]![i] = 0.24 // r = .96
    const m: AxisCode[] = ['MAT', 'QR', 'SPA']
    const corr = withinPersonContrasts(score(at({}), cov), m)
    const indep = withinPersonContrasts(score(at({}), diag(0.5)), m)
    expect(corr[0]!.sd).toBeLessThan(indep[0]!.sd)
  })

  it('needs two distinct skills', () => {
    expect(() => withinPersonContrasts(score(at({}), diag(1)), ['MAT'])).toThrow(RangeError)
    expect(() => withinPersonContrasts(score(at({}), diag(1)), ['MAT', 'MAT'])).toThrow(RangeError)
  })
})

describe('distinctive peaks (A12)', () => {
  const m: AxisCode[] = ['MAT', 'QR', 'SPA', 'WM', 'RT', 'PS']

  it('are the skills whose 90% contrast interval lies above 0, strongest first', () => {
    const s = score(at({ MAT: 1.5, QR: 1.0, SPA: 0.1, WM: -0.1, RT: 0, PS: -0.2 }), diag(0.25))
    const p = distinctivePeaks(s, m)
    expect(p.map((x) => x.code)).toEqual(['MAT', 'QR'])
    for (const x of p) expect(x.lo90).toBeGreaterThan(0)
  })

  it('are none when every range overlaps: noisy skills do not produce peaks', () => {
    const s = score(at({ MAT: 0.6, QR: 0.3, SPA: 0, WM: -0.2, RT: 0.1, PS: 0 }), diag(0.9))
    expect(distinctivePeaks(s, m)).toEqual([])
  })

  it('are none when the skills are all alike, however precise', () => {
    expect(distinctivePeaks(score(at({ MAT: 1, QR: 1, SPA: 1, WM: 1, RT: 1, PS: 1 }), diag(0.05)), m)).toEqual([])
  })

  it('stay at most PEAKS_MAX, and none with fewer than three measured skills', () => {
    const many: AxisCode[] = ['MAT', 'QR', 'SPA', 'WM', 'RT', 'PS', 'CAL', 'LR']
    const s = score(at({ MAT: 2, QR: 2, SPA: 2, WM: 2, RT: 2, PS: 2, CAL: -3, LR: -3 }), diag(0.1))
    expect(distinctivePeaks(s, many)).toHaveLength(PEAKS_MAX)
    expect(distinctivePeaks(s, ['MAT', 'CAL'])).toEqual([])
    expect(PEAKS_MIN_MEASURED).toBe(3)
  })

  it('never returns a mean, a total or an area: only per-skill contrasts', () => {
    const p = distinctivePeaks(score(at({ MAT: 2, QR: 0, SPA: 0, WM: 0 }), diag(0.1)), ['MAT', 'QR', 'SPA', 'WM'])
    expect(Object.keys(p[0]!).sort()).toEqual(['code', 'contrast', 'hi90', 'lo90', 'name', 'sd'])
  })

  it('works on real scorer output (the synthetic profiles)', () => {
    const prof = syntheticProfile('full')!
    const est = prof.input.score
    const measured = AXIS_CODES.filter((k) => Object.hasOwn(est.eap, k))
    const p = distinctivePeaks(est, measured)
    expect(p.length).toBeLessThanOrEqual(PEAKS_MAX)
    for (const x of p) expect(x.lo90).toBeGreaterThan(0)
  })

  it('uses only the measured skills: a stub’s borrowed estimate never moves the peaks', () => {
    const cov = diag(0.25)
    const a = distinctivePeaks(score(at({ MAT: 1.5, QR: 0, SPA: 0, WM: 0, EMO: 0 }), cov), ['MAT', 'QR', 'SPA', 'WM'])
    const b = distinctivePeaks(score(at({ MAT: 1.5, QR: 0, SPA: 0, WM: 0, EMO: -3 }), cov), ['MAT', 'QR', 'SPA', 'WM'])
    expect(b).toEqual(a)
  })
})

describe('distinctive peaks: properties', () => {
  const thetas = fc.array(fc.double({ min: -2.5, max: 2.5, noNaN: true }), { minLength: N_AXES, maxLength: N_AXES })
  const subsets = fc.subarray([...AXIS_CODES], { minLength: 3 })
  const sds = fc.double({ min: 0.05, max: 1, noNaN: true })

  it('contrasts sum to 0, so a profile cannot be all peaks (at most m − 1)', () => {
    fc.assert(
      fc.property(thetas, subsets, sds, (th, m, sd) => {
        const c = withinPersonContrasts(score(th, diag(sd)), m)
        expect(Math.abs(c.reduce((s, x) => s + x.contrast, 0))).toBeLessThan(1e-9)
        expect(distinctivePeaks(score(th, diag(sd)), m, { max: 99 }).length).toBeLessThanOrEqual(m.length - 1)
      }),
      { numRuns: 200 },
    )
  })

  it('are invariant to adding a constant to every skill (they compare a person with themselves)', () => {
    fc.assert(
      fc.property(thetas, subsets, sds, fc.double({ min: -2, max: 2, noNaN: true }), (th, m, sd, shift) => {
        const a = distinctivePeaks(score(th, diag(sd)), m, { max: 99 })
        const b = distinctivePeaks(score(th.map((v) => v + shift), diag(sd)), m, { max: 99 })
        // The same set of clear peaks (a contrast within rounding of the boundary may go either way).
        const codes = (ps: typeof a): Set<string> => new Set(ps.filter((x) => x.lo90 > 1e-6).map((x) => x.code))
        for (const k of codes(a)) expect(b.map((x) => x.code)).toContain(k)
        for (const k of codes(b)) expect(a.map((x) => x.code)).toContain(k)
      }),
      { numRuns: 200 },
    )
  })

  it('can only gain peaks when the posterior tightens (scaling Σ down keeps every peak)', () => {
    fc.assert(
      fc.property(thetas, subsets, sds, (th, m, sd) => {
        const wide = new Set(distinctivePeaks(score(th, diag(sd)), m, { max: 99 }).map((x) => x.code))
        const narrow = new Set(distinctivePeaks(score(th, diag(sd / 2)), m, { max: 99 }).map((x) => x.code))
        for (const k of wide) expect(narrow.has(k)).toBe(true)
      }),
      { numRuns: 200 },
    )
  })

  it('the sorted list is by contrast, descending, with an interval strictly above 0', () => {
    fc.assert(
      fc.property(thetas, subsets, sds, (th, m, sd) => {
        const p = distinctivePeaks(score(th, diag(sd)), m, { max: 99 })
        for (let i = 1; i < p.length; i++) expect(p[i - 1]!.contrast).toBeGreaterThanOrEqual(p[i]!.contrast)
        for (const x of p) expect(x.lo90).toBeGreaterThan(0)
      }),
      { numRuns: 200 },
    )
  })

  it('is exact on scorer output: covariance from real observations gives finite intervals', () => {
    const o = AXIS_CODES.slice(0, 6).flatMap((axis, i) => [1, 2, 3].map((n) => ({ kind: '2pl' as const, axis, a: 1.2, b: 0.2 * n, y: ((i + n) % 2) as 0 | 1 })))
    const r = scoreAll(o)
    const p = withinPersonContrasts(r, AXIS_CODES.slice(0, 6))
    for (const x of p) {
      expect(Number.isFinite(x.sd)).toBe(true)
      expect(x.sd).toBeGreaterThan(0)
    }
  })
})
