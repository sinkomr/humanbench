import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AXIS_CODES, AXIS_INDEX, initialSigma, N_AXES, nearestPD, type AxisCode } from './axes'
import { choleskyLogDet, cholesky, identity, isSymmetric, matmul, maxAbsDiff, spdInverse, tryCholesky } from './linalg'
import {
  checkObservation,
  EAP_HI,
  EAP_LO,
  EAP_N_GRID,
  eapAxis,
  eapByAxis,
  expectedInformation,
  gradLogPosterior,
  logPosterior,
  MAP_LP_SLACK,
  MAP_MAX_HALVINGS,
  MAP_MAX_ITER,
  MAP_TOL,
  mapTheta,
  observedInformation,
  scoreAll,
} from './scorer'
import type { Observation } from './types'
// Bank golden/scoring_v1.json, copied by scripts/sync-golden.sh (ROADMAP A17).
import scoringV1Text from './__fixtures__/scoring_v1.json?raw'

interface GoldenCase {
  id: string
  description: string
  inputs: { mu: number[]; observations: Observation[]; sigma?: number[][] }
  outputs: {
    theta_map: number[]
    cov: number[][]
    n_iter: number
    eap: Record<string, { mean: number; sd: number }>
    log_posterior_at_map: number
  }
}
interface GoldenDoc {
  version: string
  conventions: {
    tolerance: number
    map: { start: string; max_iter: number; tol: number; max_halvings: number; lp_slack: number }
    eap: { n_grid: number; lo: number; hi: number }
  }
  axes: string[]
  sigma: number[][]
  cases: GoldenCase[]
}
const golden = JSON.parse(scoringV1Text) as GoldenDoc
const TOL = golden.conventions.tolerance

const zeros = (n = N_AXES): number[] => new Array<number>(n).fill(0)
const maxAbsVec = (a: readonly number[], b: readonly number[]): number =>
  a.length !== b.length ? Infinity : a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i]!)), 0)
const sigmaOf = (c: GoldenCase): number[][] => c.inputs.sigma ?? golden.sigma
const byAxis = (obs: readonly Observation[], code: AxisCode): Observation[] => obs.filter((o) => o.axis === code)
/** Σ⁻¹ + diag(d). */
const plusDiag = (P: number[][], d: readonly number[]): number[][] =>
  P.map((row, i) => row.map((v, j) => (i === j ? v + d[i]! : v)))

describe('golden vectors (bank golden/scoring_v1.json, ROADMAP A2)', () => {
  it('records the convention this port implements', () => {
    expect(golden.version).toBe('scoring_v1')
    expect(golden.axes).toEqual([...AXIS_CODES])
    expect(TOL).toBe(1e-6)
    const { map, eap } = golden.conventions
    expect(map.start).toBe('mu')
    expect(map.max_iter).toBe(MAP_MAX_ITER)
    expect(map.tol).toBe(MAP_TOL)
    expect(map.max_halvings).toBe(MAP_MAX_HALVINGS)
    expect(map.lp_slack).toBe(MAP_LP_SLACK)
    expect(MAP_LP_SLACK).toBe(2 ** -46)
    expect([eap.n_grid, eap.lo, eap.hi]).toEqual([EAP_N_GRID, EAP_LO, EAP_HI])
  })

  it('exercises every observation kind and parameter the scorer supports', () => {
    const all = golden.cases.flatMap((c) => c.inputs.observations)
    expect(new Set(all.map((o) => o.kind))).toEqual(new Set(['2pl', '3pl', 'grm', 'gaussian']))
    const lams = new Set(all.flatMap((o) => (o.kind === 'gaussian' ? [o.lam] : [])))
    expect([...lams].some((l) => Math.abs(l) !== 1)).toBe(true) // λ other than ±1
    const cs = new Set(all.flatMap((o) => (o.kind === '3pl' ? [o.c] : [])))
    expect(cs.size).toBeGreaterThanOrEqual(3) // several c values (1/4, 1/3, 1/2)
    expect(all.some((o) => o.kind === 'grm' && o.b.length === 1)).toBe(true) // one threshold
    expect(golden.cases.some((c) => c.inputs.sigma !== undefined)).toBe(true) // per-case Σ
    for (const o of all) expect(() => checkObservation(o)).not.toThrow()
  })

  it.each(golden.cases.map((c) => [c.id, c] as const))('%s matches to 1e-6', (_id, c) => {
    const { mu, observations: obs } = c.inputs
    const sigma = sigmaOf(c)
    const want = c.outputs
    const got = scoreAll(obs, mu, sigma)

    expect(maxAbsVec(got.theta, want.theta_map)).toBeLessThanOrEqual(TOL)
    expect(maxAbsDiff(got.cov, want.cov)).toBeLessThanOrEqual(TOL)
    expect(Math.abs(got.logPosterior - want.log_posterior_at_map)).toBeLessThanOrEqual(TOL)
    expect(Object.keys(got.eap)).toEqual(Object.keys(want.eap)) // observed axes, canonical order
    for (const [code, e] of Object.entries(want.eap)) {
      const g = got.eap[code as AxisCode]!
      expect(Math.abs(g.mean - e.mean)).toBeLessThanOrEqual(TOL)
      expect(Math.abs(g.sd - e.sd)).toBeLessThanOrEqual(TOL)
      // eapAxis on its own, with the marginal prior N(μ_k, Σ_kk).
      const k = AXIS_INDEX[code as AxisCode]
      const direct = eapAxis(byAxis(obs, code as AxisCode), mu[k]!, sigma[k]![k]!)
      expect(Math.abs(direct.mean - e.mean)).toBeLessThanOrEqual(TOL)
      expect(Math.abs(direct.sd - e.sd)).toBeLessThanOrEqual(TOL)
    }
    // logPosterior on its own, at the golden MAP.
    expect(Math.abs(logPosterior(want.theta_map, obs, mu, sigma) - want.log_posterior_at_map)).toBeLessThanOrEqual(TOL)
    // n_iter is informational only (A2).
    expect(got.nIter).toBeGreaterThanOrEqual(1)
    expect(got.nIter).toBeLessThanOrEqual(MAP_MAX_ITER)
    if (obs.length === 0) expect(got.nIter).toBe(1)
  })

  it('reaches the 3PL low-ability mode in a few Newton iterations (Fisher scoring alone would not)', () => {
    const c = golden.cases.find((x) => x.id.endsWith('3pl_low_ability_guessing'))!
    const got = mapTheta(c.inputs.observations, c.inputs.mu, sigmaOf(c))
    expect(got.nIter).toBeLessThan(10)
    expect(maxAbsVec(got.theta, c.outputs.theta_map)).toBeLessThanOrEqual(TOL)
  })
})

describe('mapTheta', () => {
  it('with no observations returns θ = μ, cov = Σ, the prior log-density at its mode, one iteration', () => {
    const S = initialSigma()
    const mu = AXIS_CODES.map((_, i) => 0.1 * (i - 8))
    const r = mapTheta([], mu, S)
    expect(r.theta).toEqual(mu)
    expect(maxAbsDiff(r.cov, S)).toBeLessThan(1e-12)
    expect(r.nIter).toBe(1)
    const logdet = choleskyLogDet(cholesky(S))
    expect(r.logPosterior).toBeCloseTo(-0.5 * (N_AXES * Math.log(2 * Math.PI) + logdet), 12)
    expect(scoreAll([], mu, S).eap).toEqual({})
  })

  it('solves the conjugate normal case exactly (Gaussian terms, diagonal Σ)', () => {
    const sd = AXIS_CODES.map((_, i) => 0.6 + 0.05 * i)
    const S = sd.map((s, i) => sd.map((_, j) => (i === j ? s * s : 0)))
    const mu = AXIS_CODES.map((_, i) => (i % 3) * 0.2 - 0.2)
    const k = AXIS_INDEX.RT
    const obs: Observation[] = [
      { kind: 'gaussian', axis: 'RT', lam: -1, d: 0.1, sigma: 0.5, x: -0.6 },
      { kind: 'gaussian', axis: 'RT', lam: -1.3, d: 0, sigma: 0.8, x: -0.2 },
      { kind: 'gaussian', axis: 'RT', lam: 0.7, d: -0.2, sigma: 0.6, x: 0.9 },
    ]
    let prec = 1 / S[k]![k]!
    let num = mu[k]! / S[k]![k]!
    for (const o of obs) {
      if (o.kind !== 'gaussian') throw new Error('unreachable')
      prec += (o.lam * o.lam) / (o.sigma * o.sigma)
      num += (o.lam * (o.x - o.d)) / (o.sigma * o.sigma)
    }
    const r = scoreAll(obs, mu, S)
    const want = mu.slice()
    want[k] = num / prec
    expect(maxAbsVec(r.theta, want)).toBeLessThan(1e-12)
    expect(r.cov[k]![k]).toBeCloseTo(1 / prec, 14)
    for (let i = 0; i < N_AXES; i++) if (i !== k) expect(r.cov[i]![k]).toBe(0)
    expect(r.nIter).toBeLessThanOrEqual(2) // Newton is exact on a quadratic
    // The grid EAP of a Gaussian posterior well inside [−4, 4] is the posterior mean and SD.
    expect(Object.keys(r.eap)).toEqual(['RT'])
    expect(r.eap.RT!.mean).toBeCloseTo(num / prec, 9)
    expect(r.eap.RT!.sd).toBeCloseTo(Math.sqrt(1 / prec), 9)
  })

  it('borrows strength through the prior correlations; the EAP does not', () => {
    const obs: Observation[] = Array.from({ length: 6 }, (_, i) => ({
      kind: '2pl' as const,
      axis: 'MAT' as const,
      a: 1.4,
      b: -1 + 0.4 * i,
      y: 1 as const,
    }))
    const r = scoreAll(obs)
    const th = (c: AxisCode): number => r.theta[AXIS_INDEX[c]]!
    expect(th('MAT')).toBeGreaterThan(0.5)
    expect(th('QR')).toBeGreaterThan(0) // Σ_init: MAT–QR .60
    expect(th('QR')).toBeGreaterThan(th('CAL')) // MAT–CAL .20
    expect(th('CAL')).toBeGreaterThan(0)
    // The unobserved axes shrink less than MAT's own variance: posterior SD < prior SD = 1.
    expect(r.cov[AXIS_INDEX.QR]![AXIS_INDEX.QR]).toBeLessThan(1)
    expect(Object.keys(r.eap)).toEqual(['MAT'])
  })

  it('defaults to μ = 0 and the pinned Σ_init (A8) in scoreAll', () => {
    const c = golden.cases.find((x) => x.inputs.sigma === undefined && x.inputs.mu.every((v) => v === 0))!
    const obs = c.inputs.observations
    expect(scoreAll(obs)).toEqual(scoreAll(obs, zeros(), initialSigma()))
    const { eap, ...map } = scoreAll(obs)
    expect(map).toEqual(mapTheta(obs, zeros(), initialSigma()))
    expect(eap).toEqual(eapByAxis(obs, zeros(), initialSigma()))
  })

  it('works for K < 17 (the first K axes)', () => {
    const S = [
      [1, 0.5],
      [0.5, 1],
    ]
    const obs: Observation[] = [
      { kind: '2pl', axis: 'MAT', a: 1.2, b: 0, y: 1 },
      { kind: '3pl', axis: 'LR', a: 1, b: 0.5, c: 0.25, y: 0 },
    ]
    const r = scoreAll(obs, [0, 0], S)
    expect(r.theta).toHaveLength(2)
    expect(r.cov).toHaveLength(2)
    expect(maxAbsVec(gradLogPosterior(r.theta, obs, [0, 0], S), [0, 0])).toBeLessThan(1e-9)
    expect(() => mapTheta([{ kind: '2pl', axis: 'LG', a: 1, b: 0, y: 1 }], [0, 0], S)).toThrow(RangeError)
  })

  it('respects maxIter and tol', () => {
    const c = golden.cases.find((x) => x.id.endsWith('inconsistent_extreme'))!
    const { mu, observations: obs } = c.inputs
    const one = mapTheta(obs, mu, golden.sigma, { maxIter: 1 })
    expect(one.nIter).toBe(1)
    expect(maxAbsVec(one.theta, c.outputs.theta_map)).toBeGreaterThan(1e-3)
    const loose = mapTheta(obs, mu, golden.sigma, { tol: 1e-2 })
    expect(loose.nIter).toBeLessThan(c.outputs.n_iter)
    expect(() => mapTheta(obs, mu, golden.sigma, { maxIter: 0 })).toThrow(RangeError)
    expect(() => mapTheta(obs, mu, golden.sigma, { maxIter: 1.5 })).toThrow(RangeError)
    expect(() => mapTheta(obs, mu, golden.sigma, { tol: Number.NaN })).toThrow(RangeError)
  })

  it('rejects invalid priors and observations', () => {
    const S = initialSigma()
    const ok: Observation = { kind: '2pl', axis: 'MAT', a: 1, b: 0, y: 1 }
    const bad = (o: unknown): Observation[] => [o as Observation]
    // Prior shape, finiteness, symmetry, positive definiteness.
    expect(() => mapTheta([ok], [], [])).toThrow(RangeError)
    expect(() => mapTheta([ok], zeros(16), S)).toThrow(RangeError)
    expect(() => mapTheta([ok], [Number.NaN, ...zeros(16)], S)).toThrow(RangeError)
    const asym = S.map((row) => row.slice())
    asym[0]![1] = 0.56
    expect(() => mapTheta([ok], zeros(), asym)).toThrow(RangeError)
    const indefinite = [
      [1, 0.9, -0.9],
      [0.9, 1, 0.9],
      [-0.9, 0.9, 1],
    ]
    expect(tryCholesky(indefinite)).toBeNull()
    expect(() => mapTheta([ok], zeros(3), indefinite)).toThrow(RangeError)
    expect(() => eapByAxis([ok], zeros(3), indefinite)).toThrow(RangeError)
    // Observations.
    for (const o of [
      { ...ok, axis: 'XYZ' },
      { ...ok, kind: '2pl_testlet' },
      { ...ok, a: Number.NaN },
      { ...ok, y: 2 },
      { kind: '3pl', axis: 'SPA', a: 1, b: 0, c: 1, y: 1 },
      { kind: '3pl', axis: 'SPA', a: 1, b: 0, c: 0.25, y: 0.5 },
      { kind: 'grm', axis: 'WM', a: 1, b: [0.5, 0.1], y: 1 },
      { kind: 'grm', axis: 'WM', a: 1, b: [0.5], y: 2 },
      { kind: 'gaussian', axis: 'RT', lam: -1, d: 0, sigma: 0, x: 0 },
      { kind: 'gaussian', axis: 'RT', lam: -1, d: 0, sigma: 1, x: Infinity },
      null,
    ]) {
      expect(() => mapTheta(bad(o), zeros(), S)).toThrow(RangeError)
      expect(() => logPosterior(zeros(), bad(o), zeros(), S)).toThrow(RangeError)
    }
    expect(() => logPosterior(zeros(3), [ok], zeros(), S)).toThrow(RangeError)
  })
})

describe('eapAxis', () => {
  it('with no observations gives the (grid-truncated) prior', () => {
    const r = eapAxis([], 0, 1)
    expect(Math.abs(r.mean)).toBeLessThan(1e-15)
    expect(r.sd).toBeGreaterThan(0.998)
    expect(r.sd).toBeLessThan(1)
    const shifted = eapAxis([], 0.5, 0.25)
    expect(shifted.mean).toBeCloseTo(0.5, 9)
    expect(shifted.sd).toBeCloseTo(0.5, 9)
  })

  it('uses the grid options and the marginal prior variance', () => {
    const obs: Observation[] = [
      { kind: '2pl', axis: 'VOC', a: 1.3, b: 0.5, y: 1 },
      { kind: 'grm', axis: 'VOC', a: 1.1, b: [-0.7, 0.3], y: 1 },
    ]
    const base = eapAxis(obs, 0, 1)
    const fine = eapAxis(obs, 0, 1, { nGrid: 401, lo: -6, hi: 6 })
    expect(Math.abs(fine.mean - base.mean)).toBeLessThan(1e-3)
    expect(Math.abs(fine.sd - base.sd)).toBeLessThan(1e-3)
    // A wider prior lets the (positive) evidence pull the mean further.
    expect(eapAxis(obs, 0, 2.5).mean).toBeGreaterThan(base.mean)
  })

  it('rejects mixed axes and bad grids or priors', () => {
    const o: Observation = { kind: '2pl', axis: 'VOC', a: 1, b: 0, y: 1 }
    expect(() => eapAxis([o, { ...o, axis: 'MAT' }], 0, 1)).toThrow(RangeError)
    expect(() => eapAxis([o], 0, 0)).toThrow(RangeError)
    expect(() => eapAxis([o], Number.NaN, 1)).toThrow(RangeError)
    expect(() => eapAxis([o], 0, 1, { nGrid: 1 })).toThrow(RangeError)
    expect(() => eapAxis([o], 0, 1, { nGrid: 10.5 })).toThrow(RangeError)
    expect(() => eapAxis([o], 0, 1, { lo: 1, hi: 1 })).toThrow(RangeError)
  })
})

// ------------------------------------------------------------------------ properties

const axisArb = fc.constantFrom<AxisCode>(...AXIS_CODES)
const obsArb: fc.Arbitrary<Observation> = fc.oneof(
  fc.record({
    kind: fc.constant('2pl' as const),
    axis: axisArb,
    a: fc.double({ min: 0.3, max: 2.5, noNaN: true }),
    b: fc.double({ min: -2.5, max: 2.5, noNaN: true }),
    y: fc.constantFrom<0 | 1>(0, 1),
  }),
  fc.record({
    kind: fc.constant('3pl' as const),
    axis: axisArb,
    a: fc.double({ min: 0.3, max: 2.5, noNaN: true }),
    b: fc.double({ min: -2.5, max: 2.5, noNaN: true }),
    c: fc.constantFrom(0.25, 1 / 3, 0.5),
    y: fc.constantFrom<0 | 1>(0, 1),
  }),
  fc
    .record({
      axis: axisArb,
      a: fc.double({ min: 0.5, max: 2.5, noNaN: true }),
      b1: fc.double({ min: -2, max: 1, noNaN: true }),
      gaps: fc.array(fc.double({ min: 0.3, max: 1.2, noNaN: true }), { maxLength: 3 }),
      u: fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }),
    })
    .map(({ axis, a, b1, gaps, u }): Observation => {
      const b = gaps.reduce<number[]>((acc, g) => [...acc, acc[acc.length - 1]! + g], [b1])
      return { kind: 'grm', axis, a, b, y: Math.floor(u * (b.length + 1)) }
    }),
  fc.record({
    kind: fc.constant('gaussian' as const),
    axis: axisArb,
    lam: fc.constantFrom(1, 0.7, 1.25, -1, -1.3),
    d: fc.double({ min: -1, max: 1, noNaN: true }),
    sigma: fc.double({ min: 0.3, max: 1, noNaN: true }),
    x: fc.double({ min: -3, max: 3, noNaN: true }),
  }),
)

/** A random prior: 3-factor correlation (through nearestPD) scaled by SDs in [0.6, 1.6], as bank. */
const randomPriorArb = fc
  .record({
    mu: fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: N_AXES, maxLength: N_AXES }),
    w: fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 3 * N_AXES, maxLength: 3 * N_AXES }),
    u: fc.array(fc.double({ min: 0.3, max: 1, noNaN: true }), { minLength: N_AXES, maxLength: N_AXES }),
    sd: fc.array(fc.double({ min: 0.6, max: 1.6, noNaN: true }), { minLength: N_AXES, maxLength: N_AXES }),
  })
  .map(({ mu, w, u, sd }) => {
    const W = Array.from({ length: N_AXES }, (_, i) => w.slice(3 * i, 3 * i + 3).map((v) => 0.5 * v))
    const raw = W.map((wi, i) => W.map((wj, j) => wi.reduce((s, v, f) => s + v * wj[f]!, 0) + (i === j ? u[i]! : 0)))
    const C = nearestPD(raw)
    return { mu, sigma: C.map((row, i) => row.map((v, j) => sd[i]! * sd[j]! * v)) }
  })
const priorArb = fc.oneof(fc.constant({ mu: zeros(), sigma: initialSigma() }), randomPriorArb)

describe('MAP properties (fast-check)', () => {
  it('the MAP is a strict local maximum: |∇ lp| < 1e-6 and −∇² lp is PD there', () => {
    fc.assert(
      fc.property(fc.array(obsArb, { maxLength: 40 }), priorArb, (obs, { mu, sigma }) => {
        const r = mapTheta(obs, mu, sigma)
        expect(r.nIter).toBeLessThan(MAP_MAX_ITER)
        const g = gradLogPosterior(r.theta, obs, mu, sigma)
        for (const v of g) expect(Math.abs(v)).toBeLessThan(1e-6)
        const precision = spdInverse(sigma)
        expect(tryCholesky(plusDiag(precision, observedInformation(r.theta, obs)))).not.toBeNull()
        // Ascent from the start: lp(MAP) ≥ lp(μ) (up to the halving slack).
        expect(r.logPosterior).toBeGreaterThanOrEqual(logPosterior(mu, obs, mu, sigma) - 1e-9)
        expect(r.logPosterior).toBe(logPosterior(r.theta, obs, mu, sigma))
      }),
      { numRuns: 200 },
    )
  })

  it('the Laplace covariance is symmetric PD and inverts Σ⁻¹ + diag(expected information)', () => {
    fc.assert(
      fc.property(fc.array(obsArb, { maxLength: 40 }), priorArb, (obs, { mu, sigma }) => {
        const { theta, cov } = mapTheta(obs, mu, sigma)
        expect(isSymmetric(cov)).toBe(true)
        expect(tryCholesky(cov)).not.toBeNull()
        const H = plusDiag(spdInverse(sigma), expectedInformation(theta, obs))
        expect(maxAbsDiff(matmul(cov, H), identity(N_AXES))).toBeLessThan(1e-9)
        // Observations only add information: every posterior variance ≤ its prior variance.
        cov.forEach((row, i) => expect(row[i]!).toBeLessThanOrEqual(sigma[i]![i]! * (1 + 1e-12)))
      }),
      { numRuns: 200 },
    )
  })

  it('does not depend on the order of the observations', () => {
    fc.assert(
      fc.property(
        fc.array(obsArb, { minLength: 1, maxLength: 30 }).chain((obs) =>
          fc.tuple(fc.constant(obs), fc.shuffledSubarray(obs, { minLength: obs.length, maxLength: obs.length })),
        ),
        ([obs, shuffled]) => {
          const a = scoreAll(obs)
          const b = scoreAll(shuffled)
          expect(maxAbsVec(a.theta, b.theta)).toBeLessThan(1e-7)
          expect(maxAbsDiff(a.cov, b.cov)).toBeLessThan(1e-7)
          expect(Object.keys(a.eap)).toEqual(Object.keys(b.eap))
          for (const [code, e] of Object.entries(a.eap)) {
            expect(Math.abs(e.mean - b.eap[code as AxisCode]!.mean)).toBeLessThan(1e-12)
          }
        },
      ),
      { numRuns: 100 },
    )
  })
})
