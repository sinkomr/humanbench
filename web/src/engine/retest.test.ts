import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AXES, AXIS_CODES, AXIS_INDEX, CLUSTERS, initialSigma, N_AXES, SIGMA_VERSION, type AxisCode } from './axes'
import { observationInfo, observationLoglik, observationScore } from './irt'
import {
  RETEST_TAU,
  RETEST_VERSION,
  RHO_MAX_BY_CLUSTER,
  RHO_MAX_FLUID,
  RHO_MAX_KNOWLEDGE,
  RHO_MAX_PRIOR,
  adjustObservation,
  nextSessionPrior,
  orderSessions,
  rescoreRetest,
  resolveRhoMax,
  retestAdjust,
  retestGain,
  sessionOrdinals,
  type RetestSession,
} from './retest'
import { eapByAxis, mapTheta, scoreAll } from './scorer'
import type { Observation } from './types'
// Bank golden/retest_v1.json, copied by scripts/sync-golden.sh (ROADMAP A17).
import retestV1Text from './__fixtures__/retest_v1.json?raw'

const zeros = (): number[] => new Array<number>(N_AXES).fill(0)
const maxAbs = (a: readonly number[], b: readonly number[]): number =>
  a.length !== b.length ? Infinity : a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i]!)), 0)
const maxAbsM = (a: readonly (readonly number[])[], b: readonly (readonly number[])[]): number =>
  a.length !== b.length ? Infinity : a.reduce((m, row, i) => Math.max(m, maxAbs(row, b[i]!)), 0)
const allAxes = (v: number): Record<AxisCode, number> => Object.fromEntries(AXIS_CODES.map((k) => [k, v])) as Record<AxisCode, number>

// ------------------------------------------------------------------------ arbitraries

const axisArb = fc.constantFrom<AxisCode>(...AXIS_CODES)
const dbl = (min: number, max: number): fc.Arbitrary<number> => fc.double({ min, max, noNaN: true })
const grmArb = (axis: fc.Arbitrary<AxisCode>): fc.Arbitrary<Observation> =>
  fc
    .record({ axis, a: dbl(0.5, 2.5), b1: dbl(-2, 1), gaps: fc.array(dbl(0.3, 1.2), { maxLength: 3 }), u: fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }) })
    .map(({ axis: ax, a, b1, gaps, u }): Observation => {
      const b = gaps.reduce<number[]>((acc, g) => [...acc, acc[acc.length - 1]! + g], [b1])
      return { kind: 'grm', axis: ax, a, b, y: Math.floor(u * (b.length + 1)) }
    })
const twoPlArb = (axis: fc.Arbitrary<AxisCode>): fc.Arbitrary<Observation> =>
  fc.record({ kind: fc.constant('2pl' as const), axis, a: dbl(0.3, 2.5), b: dbl(-2.5, 2.5), y: fc.constantFrom<0 | 1>(0, 1) })
const gaussArb = (axis: fc.Arbitrary<AxisCode>, lams: number[]): fc.Arbitrary<Observation> =>
  fc.record({ kind: fc.constant('gaussian' as const), axis, lam: fc.constantFrom(...lams), d: dbl(-1, 1), sigma: dbl(0.3, 1), x: dbl(-3, 3) })
const obsArb: fc.Arbitrary<Observation> = fc.oneof(
  twoPlArb(axisArb),
  fc.record({ kind: fc.constant('3pl' as const), axis: axisArb, a: dbl(0.3, 2.5), b: dbl(-2.5, 2.5), c: fc.constantFrom(0.25, 1 / 3, 0.5), y: fc.constantFrom<0 | 1>(0, 1) }),
  grmArb(axisArb),
  gaussArb(axisArb, [1, 0.7, 1.25, -1, -1.3]),
)

/** 1–5 sessions on distinct days (listed in time order), each with 0–6 observations. */
const sessionsArb = (obs: fc.Arbitrary<Observation> = obsArb): fc.Arbitrary<RetestSession[]> =>
  fc.array(fc.array(obs, { maxLength: 6 }), { minLength: 1, maxLength: 5 }).map((per) =>
    per.map((o, i) => ({ session_id: `s_${i}`, started_utc: `2026-10-${String(i + 1).padStart(2, '0')}T10:00:00Z`, observations: o })),
  )

// ----------------------------------------------------------------------- the §7.8 curve

describe('retest gain ρ_k(s) (§7.8)', () => {
  it('uses the §7.8 constants and priors', () => {
    expect(RETEST_TAU).toBe(1.2)
    expect([RHO_MAX_FLUID, RHO_MAX_KNOWLEDGE]).toEqual([0.45, 0.25])
    for (const k of ['MAT', 'LR', 'LG', 'SPA', 'RT', 'PS'] as const) expect(RHO_MAX_PRIOR[k], k).toBe(0.45) // reasoning, spatial, speed
    for (const k of ['KST', 'KHU', 'KAP'] as const) expect(RHO_MAX_PRIOR[k], k).toBe(0.25) // knowledge
    expect(Object.keys(RHO_MAX_BY_CLUSTER).sort()).toEqual([...CLUSTERS].sort())
    for (const a of AXES) expect(RHO_MAX_PRIOR[a.code]).toBe(RHO_MAX_BY_CLUSTER[a.cluster])
  })

  it('is 0 at the first test and ≈ 1/3 SD at the second, near the plateau by the fourth', () => {
    expect(retestGain(0.45, 1)).toBe(0)
    expect(Object.is(retestGain(-0.3, 1), 0)).toBe(true) // never −0
    expect(retestGain(0.45, 2)).toBeCloseTo(0.45 * (1 - Math.exp(-1 / 1.2)), 15)
    expect(retestGain(0.45, 2)).toBeGreaterThan(0.2)
    expect(retestGain(0.45, 2)).toBeLessThan(0.35)
    expect(retestGain(0.45, 4) / 0.45).toBeGreaterThan(0.9)
  })

  it('property: ρ(1) = 0, monotone in s, bounded by ρ^max, odd in ρ^max', () => {
    fc.assert(
      fc.property(dbl(0, 2), dbl(1, 50), dbl(0, 10), (rmax, s, ds) => {
        expect(retestGain(rmax, 1)).toBe(0)
        const g = retestGain(rmax, s)
        const g2 = retestGain(rmax, s + ds)
        expect(g).toBeGreaterThanOrEqual(0)
        expect(g2).toBeGreaterThanOrEqual(g)
        expect(g2).toBeLessThanOrEqual(rmax)
        expect(retestGain(-rmax, s)).toBeCloseTo(-g, 14)
      }),
    )
  })

  it('rejects s < 1 and non-finite input; resolveRhoMax overrides the prior per axis', () => {
    for (const s of [0, 0.999, Number.NaN, Infinity]) expect(() => retestGain(0.45, s)).toThrow(RangeError)
    expect(() => retestGain(Number.NaN, 2)).toThrow(RangeError)
    expect(resolveRhoMax()).toEqual(RHO_MAX_PRIOR)
    expect(resolveRhoMax({ MAT: 0.1 })).toMatchObject({ MAT: 0.1, LR: 0.45 })
    expect(() => resolveRhoMax({ XYZ: 0.1 } as never)).toThrow(/unknown axis/)
    expect(() => resolveRhoMax({ MAT: Infinity })).toThrow(RangeError)
  })
})

// --------------------------------------------------------------- adjusting observations

describe('adjustObservation (exact re-expression on θ_k)', () => {
  it('property: the adjusted likelihood at θ equals the original at θ + ρ (every kind)', () => {
    fc.assert(
      fc.property(obsArb, dbl(-1, 1), dbl(-3, 3), (o, rho, theta) => {
        const adj = adjustObservation(o, rho)
        expect(adj.kind).toBe(o.kind)
        expect(adj.axis).toBe(o.axis)
        expect(observationLoglik(adj, theta)).toBeCloseTo(observationLoglik(o, theta + rho), 9)
        expect(observationScore(adj, theta)).toBeCloseTo(observationScore(o, theta + rho), 9)
        expect(observationInfo(adj, theta)).toBeCloseTo(observationInfo(o, theta + rho), 9)
      }),
    )
  })

  it('property: a zero gain changes nothing, and the input is never modified', () => {
    // Compared as JSON: a Gaussian d = −0 comes back as d + λ·0 = +0, the same value, but toEqual
    // tells −0 from +0 (fast-check generates −0).
    fc.assert(
      fc.property(obsArb, dbl(-1, 1), (o, rho) => {
        const before = JSON.stringify(o)
        expect(JSON.stringify(adjustObservation(o, 0))).toBe(before)
        adjustObservation(o, rho)
        expect(JSON.stringify(o)).toBe(before)
      }),
    )
  })

  it('shifts every item of a testlet by ρ, keeping τ and the responses (M3.9)', () => {
    const o: Observation = {
      kind: 'testlet',
      axis: 'RC',
      tau: 0.3,
      items: [
        { a: 1.2, b: -0.5, y: 1 },
        { a: 0.9, b: 0.2, y: 0 },
        { a: 1.5, b: 0.6, y: 1 },
      ],
    }
    const before = JSON.stringify(o)
    const adj = adjustObservation(o, 0.35)
    expect(JSON.stringify(o)).toBe(before)
    expect(adj).toMatchObject({ kind: 'testlet', axis: 'RC', tau: 0.3 })
    if (adj.kind !== 'testlet') throw new Error('unreachable')
    expect(adj.items.map((it) => [it.a, it.y])).toEqual([[1.2, 1], [0.9, 0], [1.5, 1]])
    adj.items.forEach((it, j) => expect(it.b).toBeCloseTo([-0.5, 0.2, 0.6][j]! - 0.35, 15))
    for (const t of [-1, 0, 1.3]) {
      expect(observationLoglik(adj, t)).toBeCloseTo(observationLoglik(o, t + 0.35), 12)
      expect(observationScore(adj, t)).toBeCloseTo(observationScore(o, t + 0.35), 12)
      expect(observationInfo(adj, t)).toBeCloseTo(observationInfo(o, t + 0.35), 12)
    }
    expect(() => adjustObservation({ ...o, tau: -1 }, 0.1)).toThrow(RangeError)
  })

  it('shifts b (2PL/3PL), every GRM threshold, and a Gaussian d by λ·ρ', () => {
    expect(adjustObservation({ kind: '2pl', axis: 'MAT', a: 1, b: 0.5, y: 1 }, 0.2)).toMatchObject({ b: 0.3 })
    expect(adjustObservation({ kind: 'grm', axis: 'WM', a: 1, b: [-1, 1], y: 1 }, 0.5)).toMatchObject({ b: [-1.5, 0.5] })
    const g = adjustObservation({ kind: 'gaussian', axis: 'RT', lam: -1, d: 0.1, sigma: 0.4, x: -0.5 }, 0.3)
    expect(g.kind === 'gaussian' && g.d).toBeCloseTo(-0.2, 15)
    expect(() => adjustObservation({ kind: '2pl', axis: 'MAT', a: 1, b: 0, y: 1 }, Number.NaN)).toThrow(RangeError)
  })
})

// ---------------------------------------------------------- ordering and test numbers

describe('session order and test numbers', () => {
  const o = (axis: AxisCode, y: 0 | 1 = 1): Observation => ({ kind: '2pl', axis, a: 1, b: 0, y })

  it('numbers tests per axis, skipping sessions that did not observe it', () => {
    const s: RetestSession[] = [
      { session_id: 's_1', started_utc: '2026-10-01T00:00:00Z', observations: [o('MAT')] },
      { session_id: 's_2', started_utc: '2026-10-02T00:00:00Z', observations: [o('KST')] },
      { session_id: 's_3', started_utc: '2026-10-03T00:00:00Z', observations: [o('KST', 0), o('MAT', 0), o('MAT')] },
      { session_id: 's_4', started_utc: '2026-10-04T00:00:00Z', observations: [] },
    ]
    expect(sessionOrdinals(s)).toEqual([{ MAT: 1 }, { KST: 1 }, { MAT: 2, KST: 2 }, {}])
    const adj = retestAdjust(s)
    expect(adj.next_ordinals).toMatchObject({ MAT: 3, KST: 3, LR: 1 })
    expect(adj.sessions[2]!.rho).toEqual({ MAT: retestGain(0.45, 2), KST: retestGain(0.25, 2) })
    expect(adj.sessions.map((x) => x.n_observations)).toEqual([1, 1, 3, 0])
    expect(Object.keys(adj.sessions[2]!.ordinals)).toEqual(['MAT', 'KST']) // canonical axis order
  })

  it('orders by start time, then id; ids must be unique and non-empty', () => {
    // The earliest session has the largest id, so sorting by id alone (or by time alone, keeping
    // the listed order of the tie) gives a different order.
    const a = { session_id: 's_b', started_utc: '2026-10-02T08:00:00Z', observations: [] }
    const b = { session_id: 's_a', started_utc: '2026-10-02T08:00:00Z', observations: [] }
    const c = { session_id: 's_z', started_utc: '2026-10-01T08:00:00Z', observations: [] }
    expect(orderSessions([a, b, c]).map((s) => s.session_id)).toEqual(['s_z', 's_a', 's_b'])
    expect(() => orderSessions([a, a])).toThrow(/duplicate/)
    expect(() => orderSessions([{ ...a, session_id: '' }])).toThrow(RangeError)
  })

  it('a session that took an axis but scored nothing on it is still a test of it (exposure, not scorability)', () => {
    const later: RetestSession = { session_id: 's_2', started_utc: '2026-10-08T00:00:00Z', observations: [{ kind: '3pl', axis: 'SPA', a: 1.2, b: 0, c: 0.25, y: 1 }, o('MAT')] }
    const exposed: RetestSession = { session_id: 's_1', started_utc: '2026-10-01T00:00:00Z', observations: [], exposed_axes: ['SPA'] }
    expect(sessionOrdinals([exposed, later])).toEqual([{ SPA: 1 }, { MAT: 1, SPA: 2 }])
    const adj = retestAdjust([later, exposed])
    expect(adj.sessions[1]!.rho.SPA).toBe(retestGain(0.45, 2))
    expect(adj.sessions[0]!.n_observations).toBe(0)
    expect(adj.next_ordinals.SPA).toBe(3)
    // Without the exposure the same responses are test 1, with no practice credit: θ̂ is higher.
    const spa = AXIS_INDEX.SPA
    expect(rescoreRetest([exposed, later]).theta[spa]!).toBeLessThan(rescoreRetest([later]).theta[spa]!)
    expect(() => sessionOrdinals([{ ...exposed, exposed_axes: ['XYZ' as AxisCode] }])).toThrow(/unknown axis/)
  })

  it('property: exposed axes that the session also observed change nothing', () => {
    const caseArb = sessionsArb().chain((sessions) =>
      fc.tuple(
        fc.constant(sessions),
        fc.tuple(...sessions.map((s) => (s.observations.length === 0 ? fc.constant([] as AxisCode[]) : fc.array(fc.constantFrom(...s.observations.map((x) => x.axis)), { maxLength: 4 })))),
      ),
    )
    fc.assert(
      fc.property(caseArb, ([sessions, extra]) => {
        const widened = sessions.map((s, i) => ({ ...s, exposed_axes: extra[i]! }))
        expect(sessionOrdinals(widened)).toEqual(sessionOrdinals(sessions))
        const a = rescoreRetest(sessions)
        const b = rescoreRetest(widened)
        expect(b.theta).toEqual(a.theta)
        expect(b.next_ordinals).toEqual(a.next_ordinals)
      }),
      { numRuns: 40 },
    )
  })

  it('property: an earlier exposure moves every later test number on that axis up by one', () => {
    fc.assert(
      fc.property(sessionsArb(), axisArb, (sessions, k) => {
        const first: RetestSession = { session_id: 's_first', started_utc: '2026-09-01T00:00:00Z', observations: [], exposed_axes: [k] }
        const before = sessionOrdinals(sessions)
        const after = sessionOrdinals([first, ...sessions])
        expect(after[0]).toEqual({ [k]: 1 })
        before.forEach((b, i) => {
          expect(after[i + 1]).toEqual(Object.fromEntries(Object.entries(b).map(([ax, n]) => [ax, n + (ax === k ? 1 : 0)])))
        })
      }),
      { numRuns: 40 },
    )
  })

  it('property: the listed order of the sessions does not matter', () => {
    fc.assert(
      fc.property(sessionsArb(), fc.integer(), (sessions, seed) => {
        const shuffled = [...sessions].sort((x, y) => ((x.session_id.charCodeAt(2) * 7919 + seed) % 13) - ((y.session_id.charCodeAt(2) * 7919 + seed) % 13))
        const a = rescoreRetest(sessions)
        const b = rescoreRetest(shuffled)
        expect(maxAbs(a.theta, b.theta)).toBeLessThan(1e-12)
        expect(b.sessions).toEqual(a.sessions)
      }),
      { numRuns: 40 },
    )
  })
})

// ------------------------------------------------------------------ rescoring properties

describe('rescoreRetest (§7.8 aggregation)', () => {
  const Sigma = initialSigma()

  it('property: ρ^max = 0 pools every session as one (no practice effect)', () => {
    fc.assert(
      fc.property(sessionsArb(), (sessions) => {
        const r = rescoreRetest(sessions, { rhoMax: allAxes(0) })
        const plain = mapTheta(
          sessions.flatMap((s) => s.observations),
          zeros(),
          Sigma,
        )
        expect(maxAbs(r.theta, plain.theta)).toBeLessThan(1e-12)
        expect(maxAbsM(r.cov, plain.cov)).toBeLessThan(1e-12)
      }),
      { numRuns: 40 },
    )
  })

  it('property: a single session is scored exactly as scoreAll, whatever ρ^max (s = 1, ρ = 0)', () => {
    fc.assert(
      fc.property(fc.array(obsArb, { maxLength: 12 }), dbl(-0.5, 1), (obs, rm) => {
        const r = rescoreRetest([{ session_id: 's_1', started_utc: '2026-10-01T00:00:00Z', observations: obs }], { rhoMax: allAxes(rm) })
        const plain = scoreAll(obs)
        expect(r.theta).toEqual(plain.theta)
        expect(r.cov).toEqual(plain.cov)
        expect(r.eap).toEqual(plain.eap)
        expect(r.practice_adjusted).toBe(true)
        expect(r.retest_version).toBe(RETEST_VERSION)
      }),
      { numRuns: 40 },
    )
  })

  it('property: more practice credit (larger ρ^max_k) never raises θ̂_k (log-concave terms)', () => {
    const concave = (k: AxisCode): fc.Arbitrary<Observation> => fc.oneof(twoPlArb(fc.constant(k)), grmArb(fc.constant(k)), gaussArb(fc.constant(k), [1, 0.7, -1]))
    const caseArb = fc
      .constantFrom<AxisCode>('MAT', 'RT', 'KST')
      .chain((k) => fc.tuple(fc.constant(k), fc.array(fc.array(concave(k), { minLength: 1, maxLength: 4 }), { minLength: 2, maxLength: 4 })))
    fc.assert(
      fc.property(caseArb, dbl(0, 1), dbl(0.01, 1), ([k, per], lo, d) => {
        const sessions: RetestSession[] = per.map((o, j) => ({ session_id: `s_${j}`, started_utc: `2026-10-0${j + 1}T00:00:00Z`, observations: o }))
        const i = AXIS_INDEX[k]
        const tLo = rescoreRetest(sessions, { rhoMax: { [k]: lo } }).theta[i]!
        const tHi = rescoreRetest(sessions, { rhoMax: { [k]: lo + d } }).theta[i]!
        expect(tHi).toBeLessThanOrEqual(tLo + 1e-9)
      }),
      { numRuns: 60 },
    )
  })

  it('repeating the same responses: credited partly to practice, still evidence of a high trait', () => {
    const items: Observation[] = [-0.5, 0.2, 0.9].map((b) => ({ kind: '2pl', axis: 'MAT', a: 1.1, b, y: 1 }))
    const one = rescoreRetest([{ session_id: 's_1', started_utc: '2026-10-01T00:00:00Z', observations: items }])
    const two: RetestSession[] = [
      { session_id: 's_1', started_utc: '2026-10-01T00:00:00Z', observations: items },
      { session_id: 's_2', started_utc: '2026-10-08T00:00:00Z', observations: items },
    ]
    const pooled = rescoreRetest(two, { rhoMax: { MAT: 0 } })
    const adjusted = rescoreRetest(two)
    const m = AXIS_INDEX.MAT
    expect(adjusted.theta[m]!).toBeLessThan(pooled.theta[m]!)
    expect(adjusted.theta[m]!).toBeGreaterThan(one.theta[m]!)
  })
})

describe('nextSessionPrior', () => {
  it('with no sessions is the population prior', () => {
    const { mu, sigma } = nextSessionPrior(rescoreRetest([]))
    expect(mu).toEqual(zeros())
    expect(maxAbsM(sigma, initialSigma())).toBeLessThan(1e-12)
  })

  it('property: ρ^max = 0 carries the posterior over unchanged; otherwise μ_k moves by ρ_k(next test)', () => {
    fc.assert(
      fc.property(sessionsArb(), (sessions) => {
        const r0 = rescoreRetest(sessions, { rhoMax: allAxes(0) })
        const p0 = nextSessionPrior(r0)
        expect(p0.mu).toEqual(r0.theta)
        expect(p0.sigma).toEqual(r0.cov)
        const r = rescoreRetest(sessions)
        const p = nextSessionPrior(r)
        AXIS_CODES.forEach((k, i) => {
          expect(p.mu[i]! - r.theta[i]!).toBeCloseTo(retestGain(RHO_MAX_PRIOR[k], r.next_ordinals[k]), 12)
          expect(p.mu[i] === r.theta[i]).toBe(r.next_ordinals[k] === 1)
        })
      }),
      { numRuns: 30 },
    )
  })

  it('its EAP prior plugs into the per-axis estimator (a later session scored against it)', () => {
    const items: Observation[] = [{ kind: '2pl', axis: 'MAT', a: 1.2, b: 0.3, y: 1 }]
    const r = rescoreRetest([{ session_id: 's_1', started_utc: '2026-10-01T00:00:00Z', observations: items }])
    const { mu, sigma } = nextSessionPrior(r)
    const eap = eapByAxis(items, mu, sigma).MAT!
    expect(eap.sd).toBeLessThan(Math.sqrt(r.cov[AXIS_INDEX.MAT]![AXIS_INDEX.MAT]!))
  })
})

// ------------------------------------------------------------------------ golden parity

interface GoldenSession {
  session_id: string
  started_utc: string
  observations: Observation[]
  exposed_axes?: AxisCode[]
}
interface GoldenCase {
  id: string
  inputs: { sessions: GoldenSession[]; mu?: number[]; sigma?: number[][]; rho_max?: Partial<Record<AxisCode, number>> }
  outputs: {
    sessions: { session_id: string; started_utc: string; n_observations: number; ordinals: Record<string, number>; rho: Record<string, number> }[]
    adjusted_observations: Observation[]
    theta_map: number[]
    cov: number[][]
    n_iter: number
    eap: Record<string, { mean: number; sd: number }>
    log_posterior_at_map: number
    next_ordinals: Record<string, number>
    next_prior_mu: number[]
  }
}
interface GoldenDoc {
  version: string
  conventions: { tolerance: number }
  tau: number
  rho_max_by_cluster: Record<string, number>
  rho_max_prior: Record<string, number>
  gain_table: { rho_max: number; s: number[]; gain: number[] }[]
  axes: string[]
  sigma_version: string
  cases: GoldenCase[]
}
const golden = JSON.parse(retestV1Text) as GoldenDoc
const TOL = golden.conventions.tolerance

/** |a − b| ≤ tol·(1 + |b|), the golden comparison (abs + rel). */
const close = (a: number, b: number): boolean => Math.abs(a - b) <= TOL * (1 + Math.abs(b))
const closeDeep = (a: unknown, b: unknown): boolean => {
  if (typeof b === 'number') return typeof a === 'number' && close(a, b)
  if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && b.every((v, i) => closeDeep(a[i], v))
  if (b !== null && typeof b === 'object') {
    if (a === null || typeof a !== 'object' || Array.isArray(a)) return false
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    return ka.length === kb.length && kb.every((k, i) => ka[i] === k && closeDeep((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  }
  return a === b
}

describe('golden vectors (bank golden/retest_v1.json, ROADMAP M1.Q, A17)', () => {
  it('records the model this port implements', () => {
    expect(golden.version).toBe(RETEST_VERSION)
    expect(TOL).toBe(1e-9)
    expect(golden.tau).toBe(RETEST_TAU)
    expect(golden.rho_max_by_cluster).toEqual(RHO_MAX_BY_CLUSTER)
    expect(golden.rho_max_prior).toEqual(RHO_MAX_PRIOR)
    expect(golden.axes).toEqual([...AXIS_CODES])
    expect(golden.sigma_version).toBe(SIGMA_VERSION)
    for (const row of golden.gain_table) row.s.forEach((s, i) => expect(close(retestGain(row.rho_max, s), row.gain[i]!), `${row.rho_max} s=${s}`).toBe(true))
  })

  it('covers every observation kind, custom priors and ρ^max, unsorted input, exposure and 10 tests', () => {
    const obs = golden.cases.flatMap((c) => c.inputs.sessions.flatMap((s) => s.observations))
    expect(new Set(obs.map((o) => o.kind))).toEqual(new Set(['2pl', '3pl', 'grm', 'gaussian']))
    expect(golden.cases.some((c) => c.inputs.rho_max !== undefined)).toBe(true)
    expect(golden.cases.some((c) => c.inputs.sigma !== undefined)).toBe(true)
    expect(golden.cases.some((c) => c.inputs.mu !== undefined)).toBe(true)
    expect(golden.cases.some((c) => c.inputs.sessions[0]?.session_id !== c.outputs.sessions[0]?.session_id)).toBe(true)
    expect(Math.max(...golden.cases.flatMap((c) => c.outputs.sessions.flatMap((s) => Object.values(s.ordinals))))).toBe(10)
    const exposed = golden.cases.flatMap((c) => c.inputs.sessions.filter((s) => s.exposed_axes !== undefined))
    expect(exposed.length).toBeGreaterThanOrEqual(5)
    expect(exposed.some((s) => s.observations.length === 0)).toBe(true) // exposure only
  })

  it(`every case matches to ${1e-9} (ordinals, gains, adjusted observations, θ, cov, EAP, lp, next prior)`, () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(30)
    for (const c of golden.cases) {
      const { mu, sigma, rho_max: rhoMax } = c.inputs
      const opts = { ...(mu ? { mu } : {}), ...(sigma ? { sigma } : {}), ...(rhoMax ? { rhoMax } : {}) }
      const r = rescoreRetest(c.inputs.sessions, opts)
      const adj = retestAdjust(c.inputs.sessions, rhoMax)
      const want = c.outputs
      expect(r.sessions.map((s) => [s.session_id, s.started_utc, s.n_observations, s.ordinals]), c.id).toEqual(
        want.sessions.map((s) => [s.session_id, s.started_utc, s.n_observations, s.ordinals]),
      )
      expect(closeDeep(r.sessions.map((s) => s.rho), want.sessions.map((s) => s.rho)), `${c.id} rho`).toBe(true)
      expect(closeDeep(adj.observations, want.adjusted_observations), `${c.id} adjusted observations`).toBe(true)
      expect(maxAbs(r.theta, want.theta_map), `${c.id} theta`).toBeLessThanOrEqual(TOL)
      expect(maxAbsM(r.cov, want.cov), `${c.id} cov`).toBeLessThanOrEqual(TOL)
      expect(closeDeep(r.eap, want.eap), `${c.id} eap`).toBe(true)
      expect(close(r.logPosterior, want.log_posterior_at_map), `${c.id} lp ${r.logPosterior} vs ${want.log_posterior_at_map}`).toBe(true)
      expect(r.next_ordinals, c.id).toEqual(want.next_ordinals)
      expect(maxAbs(nextSessionPrior(r).mu, want.next_prior_mu), `${c.id} next prior`).toBeLessThanOrEqual(TOL)
    }
  })
})
