import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AXIS_CODES, AXIS_INDEX, initialSigma, N_AXES, nearestPD, type AxisCode } from './axes'
import { info2pl, infoTestlet, loglik2pl, loglikTestlet, MAX_TESTLET_ITEMS, observationInfo, observationObservedInfo, observationScore, observedInfoTestlet, scoreTestlet, TESTLET_AT_MAX, TESTLET_N_NODES, TESTLET_SD, TESTLET_Z_MAX, TESTLET_Z_STEP } from './irt'
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
  testletObservation,
} from './scorer'
import type { Observation, TestletItem } from './types'
// Bank golden/scoring_v1.json (frozen) and golden/scoring_v2.json (v1 + testlets, M3.9), copied by
// scripts/sync-golden.sh (ROADMAP A17).
import scoringV1Text from './__fixtures__/scoring_v1.json?raw'
import scoringV2Text from './__fixtures__/scoring_v2.json?raw'

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

/** One golden case: MAP, cov, log posterior and EAP within the file's tolerance (n_iter informational, A2). */
function expectGoldenCase(c: GoldenCase, sigma: number[][]): void {
  const { mu, observations: obs } = c.inputs
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
}

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

  it.each(golden.cases.map((c) => [c.id, c] as const))('%s matches to 1e-6', (_id, c) => expectGoldenCase(c, sigmaOf(c)))

  it('reaches the 3PL low-ability mode in a few Newton iterations (Fisher scoring alone would not)', () => {
    const c = golden.cases.find((x) => x.id.endsWith('3pl_low_ability_guessing'))!
    const got = mapTheta(c.inputs.observations, c.inputs.mu, sigmaOf(c))
    expect(got.nIter).toBeLessThan(10)
    expect(maxAbsVec(got.theta, c.outputs.theta_map)).toBeLessThanOrEqual(TOL)
  })
})


interface TestletTerm {
  id: string
  tau: number
  items: TestletItem[]
  theta: number[]
  loglik: number[]
  score: number[]
  info: number[]
  observed_info: number[]
}
interface GoldenDocV2 extends GoldenDoc {
  extends: string
  v1_cases: number
  testlet_seed: number
  conventions: GoldenDoc['conventions'] & {
    testlet: { tau_default: number; max_items: number; max_a_tau: number; grid: { z_max: number; z_step: number; n_nodes: number }; terms: { tolerance: number } }
  }
  testlet_terms: TestletTerm[]
}
const goldenV2 = JSON.parse(scoringV2Text) as GoldenDocV2
const goldenV1 = golden

describe('golden vectors with testlets (bank golden/scoring_v2.json, ROADMAP M3.9)', () => {
  const testletCases = goldenV2.cases.slice(goldenV2.v1_cases)

  it('extends scoring_v1: same header, same 60 cases, plus the testlet cases', () => {
    expect(goldenV2.version).toBe('scoring_v2')
    expect(goldenV2.extends).toBe('scoring_v1')
    expect(goldenV2.v1_cases).toBe(60)
    expect(goldenV2.cases).toHaveLength(84)
    expect(goldenV2.axes).toEqual(goldenV1.axes)
    expect(goldenV2.sigma).toEqual(goldenV1.sigma)
    // The non-testlet cases are the frozen v1 cases: same inputs, same outputs to 1e-9 (last-bit
    // LAPACK differences across platforms); the v1 block above still checks the v1 file itself.
    goldenV1.cases.forEach((c1, i) => {
      const c2 = goldenV2.cases[i]!
      expect(c2.id).toBe(c1.id)
      expect(c2.inputs).toEqual(c1.inputs)
      expect(maxAbsVec(c2.outputs.theta_map, c1.outputs.theta_map)).toBeLessThan(1e-9)
      expect(maxAbsDiff(c2.outputs.cov, c1.outputs.cov)).toBeLessThan(1e-9)
      expect(Math.abs(c2.outputs.log_posterior_at_map - c1.outputs.log_posterior_at_map)).toBeLessThan(1e-9)
    })
    expect(goldenV2.conventions.tolerance).toBe(1e-6)
    expect(new Set(goldenV2.cases.map((c) => c.id)).size).toBe(84)
  })

  it('records the testlet convention this port implements (grid, τ, item limit)', () => {
    const conv = goldenV2.conventions.testlet
    expect(conv.tau_default).toBe(TESTLET_SD)
    expect(conv.max_items).toBe(MAX_TESTLET_ITEMS)
    expect(conv.max_a_tau).toBe(TESTLET_AT_MAX)
    expect([conv.grid.z_max, conv.grid.z_step, conv.grid.n_nodes]).toEqual([TESTLET_Z_MAX, TESTLET_Z_STEP, TESTLET_N_NODES])
    expect(conv.terms.tolerance).toBe(1e-9)
  })

  it('exercises the testlet parameters a port could get wrong', () => {
    const testlets = testletCases.flatMap((c) => c.inputs.observations.flatMap((o) => (o.kind === 'testlet' ? [o] : [])))
    expect(testletCases).toHaveLength(24)
    for (const c of testletCases) expect(c.inputs.observations.some((o) => o.kind === 'testlet'), c.id).toBe(true)
    for (const n of [1, 2, 3, 4, 8]) expect(testlets.some((o) => o.items.length === n), `${n} items`).toBe(true)
    for (const tau of [0, 0.3, 1]) expect(testlets.some((o) => o.tau === tau), `tau ${tau}`).toBe(true)
    for (const axis of ['LG', 'RC', 'MAT']) expect(testlets.some((o) => o.axis === axis), axis).toBe(true)
    const kinds = new Set(testletCases.flatMap((c) => c.inputs.observations.map((o) => o.kind)))
    expect([...kinds].sort()).toEqual(['2pl', '3pl', 'gaussian', 'grm', 'testlet'])
    expect(testletCases.some((c) => c.inputs.sigma !== undefined)).toBe(true)
    for (const o of testlets) expect(() => checkObservation(o)).not.toThrow()
  })

  it.each(goldenV2.cases.map((c) => [c.id, c] as const))('%s matches to 1e-6', (_id, c) => expectGoldenCase(c, c.inputs.sigma ?? goldenV2.sigma))

  it('reproduces the testlet term vectors (log-likelihood, score, expected and observed information) to 1e-9', () => {
    const tol = goldenV2.conventions.testlet.terms.tolerance
    expect(goldenV2.testlet_terms.length).toBeGreaterThanOrEqual(8)
    for (const t of goldenV2.testlet_terms) {
      t.theta.forEach((th, j) => {
        const e = (got: number, want: number, what: string): void =>
          expect(Math.abs(got - want), `${t.id} ${what} at θ = ${th}`).toBeLessThanOrEqual(tol) // absolute, as the golden states
        e(loglikTestlet(th, t.tau, t.items), t.loglik[j]!, 'loglik')
        e(scoreTestlet(th, t.tau, t.items), t.score[j]!, 'score')
        e(infoTestlet(th, t.tau, t.items), t.info[j]!, 'info')
        e(observedInfoTestlet(th, t.tau, t.items), t.observed_info[j]!, 'observed info')
      })
    }
  })

  it('the tau = 0 case is the plain 2PL scoring, and the testlet effect shows in the others', () => {
    const zero = testletCases.find((c) => c.id.endsWith('_testlet_tau_zero'))!
    const plain: Observation[] = zero.inputs.observations.flatMap((o) =>
      o.kind === 'testlet' ? o.items.map((it): Observation => ({ kind: '2pl', axis: o.axis, a: it.a, b: it.b, y: it.y })) : [],
    )
    const r = mapTheta(plain, zero.inputs.mu, goldenV2.sigma)
    expect(maxAbsVec(r.theta, zero.outputs.theta_map)).toBeLessThan(1e-9)
    expect(maxAbsDiff(r.cov, zero.outputs.cov)).toBeLessThan(1e-9)
    // Scored as independent 2PL items (the pre-M3.9 behaviour) the posterior is too narrow.
    for (const suffix of ['_testlet_rc_single', '_testlet_rc_five_passages', '_testlet_max_items']) {
      const c = testletCases.find((x) => x.id.endsWith(suffix))!
      const items: Observation[] = c.inputs.observations.flatMap((o) =>
        o.kind === 'testlet' ? o.items.map((it): Observation => ({ kind: '2pl', axis: o.axis, a: it.a, b: it.b, y: it.y })) : [],
      )
      const k = AXIS_INDEX.RC
      const naive = mapTheta(items, c.inputs.mu, goldenV2.sigma)
      expect(c.outputs.cov[k]![k]! - naive.cov[k]![k]!, suffix).toBeGreaterThan(1e-3)
    }
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
    // Every golden case on the default prior that has observations (so the EAP path is non-trivial).
    const cases = golden.cases.filter(
      (x) => x.inputs.sigma === undefined && x.inputs.mu.every((v) => v === 0) && x.inputs.observations.length > 0,
    )
    expect(cases.length).toBeGreaterThan(10)
    for (const c of cases) {
      const obs = c.inputs.observations
      const got = scoreAll(obs)
      expect(got).toEqual(scoreAll(obs, zeros(), initialSigma()))
      const { eap, ...map } = got
      expect(map).toEqual(mapTheta(obs, zeros(), initialSigma()))
      expect(eap).toEqual(eapByAxis(obs, zeros(), initialSigma()))
      // …and those defaults are the golden prior: the outputs match the bank.
      expect(maxAbsVec(got.theta, c.outputs.theta_map)).toBeLessThanOrEqual(TOL)
      expect(maxAbsDiff(got.cov, c.outputs.cov)).toBeLessThanOrEqual(TOL)
      expect(Math.abs(got.logPosterior - c.outputs.log_posterior_at_map)).toBeLessThanOrEqual(TOL)
      expect(Object.keys(eap)).toEqual(Object.keys(c.outputs.eap))
      expect(Object.keys(eap).length).toBeGreaterThan(0)
      for (const [code, e] of Object.entries(c.outputs.eap)) {
        expect(Math.abs(eap[code as AxisCode]!.mean - e.mean)).toBeLessThanOrEqual(TOL)
        expect(Math.abs(eap[code as AxisCode]!.sd - e.sd)).toBeLessThanOrEqual(TOL)
      }
    }
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
      // Exactly the fields of the kind (bank observation_from_json): a 3PL mislabelled 2pl, a
      // stray y on a Gaussian, a missing field.
      { ...ok, axis: 'SPA', c: 0.25 },
      { kind: 'gaussian', axis: 'RT', lam: -1, d: 0, sigma: 1, x: 0, y: 1 },
      { kind: '2pl', axis: 'MAT', a: 1, y: 1 },
      { kind: 'gaussian', axis: 'RT', lam: -1, sigma: 1, x: 0 },
      [ok],
      null,
    ]) {
      expect(() => checkObservation(o as Observation)).toThrow(RangeError)
      expect(() => mapTheta(bad(o), zeros(), S)).toThrow(RangeError)
      expect(() => logPosterior(zeros(), bad(o), zeros(), S)).toThrow(RangeError)
    }
    expect(() => checkObservation({ ...ok, c: 0.25 } as Observation)).toThrow(/exactly the fields/)
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

// -------------------------------------------------------------------- testlet observations

describe('testlet observations (§7.1, M3.9)', () => {
  const testlet = (axis: AxisCode, rows: readonly (readonly [number, number, 0 | 1])[], tau = TESTLET_SD): Observation =>
    testletObservation(axis, rows.map(([a, b, y]) => ({ a, b, y })), tau)
  const plain = (o: Observation): Observation[] =>
    o.kind === 'testlet' ? o.items.map((it): Observation => ({ kind: '2pl', axis: o.axis, a: it.a, b: it.b, y: it.y })) : [o]
  /** log ∫ Π p_j N(γ; 0, τ²) dγ by a dense trapezoid over ±10τ (a different rule from the 65-node one). */
  const refLoglik = (t: number, tau: number, items: readonly TestletItem[]): number => {
    const n = 8001
    const h = (20 * tau) / (n - 1)
    const terms = Array.from({ length: n }, (_, i) => {
      const g = -10 * tau + i * h
      let l = -0.5 * (g / tau) ** 2 - Math.log(tau * Math.sqrt(2 * Math.PI))
      for (const it of items) l += loglik2pl(t + g, it.a, it.b, it.y)
      return l
    })
    const m = Math.max(...terms)
    return m + Math.log(terms.reduce((acc, v) => acc + Math.exp(v - m), 0) * h)
  }
  const RC = AXIS_INDEX.RC
  const LG = AXIS_INDEX.LG
  const SESSION: Observation[] = [
    testlet('RC', [[1.2, -0.5, 1], [0.9, 0.2, 1], [1.5, 0.6, 0], [1.1, 1.0, 1]]),
    testlet('RC', [[1.0, -0.2, 1], [1.3, 0.4, 0], [0.8, 0.9, 0]]),
    testlet('LG', [[1.4, -0.8, 1], [1.1, 0.0, 1], [1.7, 0.5, 0]]),
    { kind: '2pl', axis: 'RC', a: 1.1, b: 0.1, y: 1 },
    { kind: '2pl', axis: 'MAT', a: 1.2, b: 0.3, y: 1 },
    { kind: 'gaussian', axis: 'PS', lam: 1, d: 0, sigma: 0.5, x: 0.4 },
  ]

  it('testletObservation() defaults τ to 0.3, copies the items and validates', () => {
    const items: TestletItem[] = [{ a: 1, b: 0, y: 1 }]
    const o = testletObservation('RC', items)
    expect(o).toEqual({ kind: 'testlet', axis: 'RC', tau: 0.3, items })
    expect(o.kind === 'testlet' && o.items).not.toBe(items)
    expect(testletObservation('LG', items, 0)).toMatchObject({ tau: 0 })
    expect(testletObservation('RC', [{ a: 1, b: 0, y: 1, extra: 5 } as TestletItem]).kind === 'testlet').toBe(true)
    expect(() => testletObservation('RC', [])).toThrow(RangeError)
    expect(() => testletObservation('RC', new Array<TestletItem>(9).fill(items[0]!))).toThrow(RangeError)
    expect(() => testletObservation('RC', items, -1)).toThrow(RangeError)
    expect(() => testletObservation('XYZ' as AxisCode, items)).toThrow(RangeError)
    expect(() => testletObservation('RC', [{ a: 11, b: 0, y: 1 }])).toThrow(RangeError) // |a|·τ > 3
    // malformed items are a RangeError too, not a TypeError from copying them
    for (const bad of [undefined, null, 5, 'ab', {}, [null], [undefined], [5], [{ a: 1, b: 0 }], [{ a: '1', b: 0, y: 1 }]]) {
      expect(() => testletObservation('RC', bad as unknown as TestletItem[]), JSON.stringify(bad)).toThrow(RangeError)
    }
  })

  it('checkObservation takes exactly the fields tau and items, with items of exactly a, b, y', () => {
    const item = { a: 1, b: 0, y: 1 }
    const ok = { kind: 'testlet', axis: 'RC', tau: 0.3, items: [item] }
    expect(checkObservation(ok as Observation)).toBe(AXIS_INDEX.RC)
    for (const bad of [
      { kind: 'testlet', axis: 'RC', items: [item] }, // no tau
      { kind: 'testlet', axis: 'RC', tau: 0.3 }, // no items
      { ...ok, extra: 1 },
      { ...ok, items: item }, // not an array
      { ...ok, items: [] },
      { ...ok, items: new Array(9).fill(item) },
      { ...ok, items: [{ ...item, c: 0.25 }] }, // a stray 3PL field
      { ...ok, items: [{ a: 1, b: 0 }] }, // missing y
      { ...ok, items: [{ ...item, y: 2 }] },
      { ...ok, items: [{ ...item, a: Number.NaN }] },
      { ...ok, items: [null] },
      { ...ok, items: [[1, 0, 1]] },
      { ...ok, tau: -0.1 },
      { ...ok, tau: Number.NaN },
      { ...ok, tau: '0.3' },
      { ...ok, axis: 'XYZ' },
    ]) {
      expect(() => checkObservation(bad as unknown as Observation)).toThrow(RangeError)
      expect(() => mapTheta([bad as unknown as Observation], zeros(), initialSigma())).toThrow(RangeError)
    }
    expect(() => checkObservation({ ...ok, items: [{ ...item, c: 0.25 }] } as unknown as Observation)).toThrow(/testlet item needs exactly the fields/)
    expect(() => checkObservation({ ...ok, tau: 0 } as Observation)).not.toThrow()
    expect(() => checkObservation({ ...ok, items: new Array(8).fill(item) } as Observation)).not.toThrow()
  })

  it('the MAP is the mode of the independently integrated posterior; the gradient vanishes there', () => {
    const mu = AXIS_CODES.map((_, i) => 0.02 * (i - 8))
    const S = initialSigma()
    const r = mapTheta(SESSION, mu, S)
    expect(r.nIter).toBeLessThan(MAP_MAX_ITER)
    for (const g of gradLogPosterior(r.theta, SESSION, mu, S)) expect(Math.abs(g)).toBeLessThan(1e-8)
    // The log posterior with the testlets swapped for the dense integral agrees with ours.
    const others = SESSION.filter((o) => o.kind !== 'testlet')
    const viaRef = (theta: number[]): number =>
      logPosterior(theta, others, mu, S) +
      SESSION.reduce((sum, o) => (o.kind === 'testlet' ? sum + refLoglik(theta[AXIS_INDEX[o.axis]]!, o.tau, o.items) : sum), 0)
    expect(Math.abs(viaRef(r.theta) - r.logPosterior)).toBeLessThan(1e-6)
    // …and it is a maximum of that reference: no coordinate step increases it.
    for (let k = 0; k < N_AXES; k++) {
      for (const d of [-1e-3, 1e-3]) {
        const moved = r.theta.slice()
        moved[k]! += d
        expect(viaRef(moved)).toBeLessThan(viaRef(r.theta) + 1e-9)
      }
    }
  })

  it('the Laplace covariance uses the expected information of the testlets', () => {
    const r = mapTheta(SESSION, zeros(), initialSigma())
    const info = expectedInformation(r.theta, SESSION)
    const t = r.theta[RC]!
    const s0 = SESSION[0]!
    const s1 = SESSION[1]!
    if (s0.kind !== 'testlet' || s1.kind !== 'testlet') throw new Error('unreachable')
    expect(info[RC]).toBeCloseTo(infoTestlet(t, s0.tau, s0.items) + infoTestlet(t, s1.tau, s1.items) + info2pl(t, 1.1, 0.1), 12)
    expect(observedInformation(r.theta, SESSION)[RC]).toBeGreaterThan(0)
    const H = plusDiag(spdInverse(initialSigma()), info)
    expect(maxAbsDiff(matmul(r.cov, H), identity(N_AXES))).toBeLessThan(1e-9)
  })

  it('the single-pass testlet derivatives in the MAP loop equal the separate score / information functions', () => {
    // scorer.ts derivatives() takes score, expected and observed information from one pass over
    // the γ nodes (testletDerivatives); at an arbitrary θ each must equal the standalone function.
    const S = initialSigma()
    const theta = AXIS_CODES.map((_, i) => 0.15 * (i - 8) * (i % 2 === 0 ? 1 : -0.5))
    const mu = zeros()
    const sums = (f: (o: Extract<Observation, { kind: 'testlet' }>, t: number) => number, axis: number): number =>
      SESSION.reduce((s, o) => (o.kind === 'testlet' && AXIS_INDEX[o.axis] === axis ? s + f(o, theta[axis]!) : s), 0)
    const g = gradLogPosterior(theta, SESSION, mu, S)
    const priorScore = matmul([theta.map((t, i) => t - mu[i]!)], spdInverse(S))[0]!
    for (const axis of [RC, LG]) {
      const testletScore = sums((o, t) => scoreTestlet(t, o.tau, o.items), axis)
      const plainScore = SESSION.reduce((s, o) => (o.kind === '2pl' && AXIS_INDEX[o.axis] === axis ? s + observationScore(o, theta[axis]!) : s), 0)
      expect(Math.abs(g[axis]! - (testletScore + plainScore - priorScore[axis]!))).toBeLessThan(1e-12)
      const plainInfo = SESSION.reduce((s, o) => (o.kind === '2pl' && AXIS_INDEX[o.axis] === axis ? s + observationInfo(o, theta[axis]!) : s), 0)
      const plainObserved = SESSION.reduce((s, o) => (o.kind === '2pl' && AXIS_INDEX[o.axis] === axis ? s + observationObservedInfo(o, theta[axis]!) : s), 0)
      expect(expectedInformation(theta, SESSION)[axis]).toBe(sums((o, t) => infoTestlet(t, o.tau, o.items), axis) + plainInfo)
      expect(observedInformation(theta, SESSION)[axis]).toBe(sums((o, t) => observedInfoTestlet(t, o.tau, o.items), axis) + plainObserved)
    }
  })

  it('a testlet is less informative than the same items scored as independent 2PL, so its posterior is wider', () => {
    const o = testlet('RC', [[1.3, -0.6, 1], [1.1, -0.1, 1], [1.6, 0.4, 0], [1.2, 0.9, 1]])
    const together = mapTheta([o], zeros(), initialSigma())
    const apart = mapTheta(plain(o), zeros(), initialSigma())
    expect(together.cov[RC]![RC]!).toBeGreaterThan(apart.cov[RC]![RC]!)
    expect(together.cov[RC]![RC]!).toBeLessThan(apart.cov[RC]![RC]! * 1.3) // a modest discount, not a collapse
    expect(together.nIter).toBeLessThan(MAP_MAX_ITER)
    // τ = 0 is the independent 2PL scorer: MAP, cov, log posterior and EAP all agree.
    const t0 = testlet('RC', [[1.3, -0.6, 1], [1.1, -0.1, 1], [1.6, 0.4, 0], [1.2, 0.9, 1]], 0)
    const zero = scoreAll([t0])
    const ind = scoreAll(plain(o))
    expect(maxAbsVec(zero.theta, ind.theta)).toBeLessThan(1e-9)
    expect(maxAbsDiff(zero.cov, ind.cov)).toBeLessThan(1e-9)
    expect(Math.abs(zero.logPosterior - ind.logPosterior)).toBeLessThan(1e-9)
    expect(Math.abs(zero.eap.RC!.mean - ind.eap.RC!.mean)).toBeLessThan(1e-12)
    expect(Math.abs(zero.eap.RC!.sd - ind.eap.RC!.sd)).toBeLessThan(1e-12)
  })

  it('a larger τ discounts the items more', () => {
    const rows = [[1.3, -0.6, 1], [1.1, -0.1, 1], [1.6, 0.4, 1]] as const
    const sd = [0, 0.15, 0.3, 0.6, 1].map((tau) => scoreAll([testlet('RC', rows, tau)]).cov[RC]![RC]!)
    for (let i = 1; i < sd.length; i++) expect(sd[i]!).toBeGreaterThan(sd[i - 1]!)
  })

  it('the EAP of a testlet axis is the grid posterior of the integrated likelihood', () => {
    const obs = [SESSION[0]!, SESSION[1]!, SESSION[3]!]
    const S = initialSigma()
    const grid = Array.from({ length: EAP_N_GRID }, (_, i) => EAP_LO + (i * (EAP_HI - EAP_LO)) / (EAP_N_GRID - 1))
    const logw = grid.map((t) => {
      let l = (-0.5 * t * t) / S[RC]![RC]!
      for (const o of obs) l += o.kind === 'testlet' ? refLoglik(t, o.tau, o.items) : o.kind === '2pl' ? loglik2pl(t, o.a, o.b, o.y) : 0
      return l
    })
    const m = Math.max(...logw)
    const w = logw.map((v) => Math.exp(v - m))
    const total = w.reduce((s, v) => s + v, 0)
    const mean = w.reduce((s, v, i) => s + (v / total) * grid[i]!, 0)
    const sd = Math.sqrt(w.reduce((s, v, i) => s + (v / total) * (grid[i]! - mean) ** 2, 0))
    const got = eapAxis(obs, 0, S[RC]![RC]!)
    expect(Math.abs(got.mean - mean)).toBeLessThan(1e-6)
    expect(Math.abs(got.sd - sd)).toBeLessThan(1e-6)
    expect(eapByAxis(SESSION, zeros(), S).RC).toEqual(eapAxis(SESSION.filter((o) => o.axis === 'RC'), 0, S[RC]![RC]!))
    expect(() => eapAxis([SESSION[0]!, SESSION[2]!], 0, 1)).toThrow(RangeError) // RC and LG testlets
    expect(Object.keys(scoreAll(SESSION).eap)).toEqual(['MAT', 'RC', 'LG', 'PS'].sort((x, y) => AXIS_INDEX[x as AxisCode] - AXIS_INDEX[y as AxisCode]))
  })

  it('does not depend on the order of the terms or of the items within a testlet', () => {
    const rows = [[1.3, -0.6, 1], [1.1, 0.4, 0], [1.6, 0.9, 1]] as const
    const fwd = testlet('RC', rows)
    const rev = testlet('RC', [...rows].reverse())
    const a = scoreAll([fwd, SESSION[3]!])
    const b = scoreAll([SESSION[3]!, rev])
    expect(maxAbsVec(a.theta, b.theta)).toBeLessThan(1e-9)
    expect(maxAbsDiff(a.cov, b.cov)).toBeLessThan(1e-10)
  })

  it('1-item testlets and the 8-item maximum score', () => {
    const one = scoreAll([testlet('LG', [[1.5, 0.2, 1]])])
    expect(one.theta[LG]).toBeGreaterThan(0)
    const eight = testlet('RC', [[1.0, -1.2, 1], [1.3, -0.8, 1], [0.8, -0.4, 0], [1.5, 0.0, 1], [1.1, 0.3, 1], [1.2, 0.7, 0], [0.9, 1.1, 0], [1.6, 1.5, 1]])
    const r = scoreAll([eight])
    expect(r.nIter).toBeLessThan(MAP_MAX_ITER)
    expect(r.theta[RC]).toBeGreaterThan(-1)
    expect(() => testlet('RC', [[1.0, -1.2, 1], ...new Array<readonly [number, number, 0 | 1]>(8).fill([1, 0, 1])])).toThrow(RangeError) // 9 items
    expect(MAX_TESTLET_ITEMS).toBe(8)
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
  // A testlet block (M3.9): 1-6 items, τ from the default and a few others.
  fc.record({
    kind: fc.constant('testlet' as const),
    axis: axisArb,
    tau: fc.constantFrom(0, 0.15, TESTLET_SD, 0.6),
    items: fc.array(
      fc.record({
        a: fc.double({ min: 0.5, max: 2.5, noNaN: true }),
        b: fc.double({ min: -2.5, max: 2.5, noNaN: true }),
        y: fc.constantFrom<0 | 1>(0, 1),
      }),
      { minLength: 1, maxLength: 6 },
    ),
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
