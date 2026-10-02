/**
 * M2.2 (ROADMAP M2.2; DESIGN §7.2, §11.2; ROADMAP A2, A8, A17): the PL/pgSQL scoring core is held to the
 * app's engine and to the bank's golden vectors. hb.map_theta must reproduce every case of
 * golden/scoring_v2.json (copied to web/src/engine/__fixtures__/, A17) to 1e-6 on θ, the Laplace
 * covariance, the per-axis EAP and the log posterior; the testlet terms to 1e-9; and the small pieces
 * (the per-observation terms, the linear algebra, the grid EAP) are compared with engine/irt.ts,
 * engine/linalg.ts and engine/scorer.ts on generated inputs.
 */

import { readFileSync } from 'node:fs'
import fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AXIS_CODES, initialSigma, SIGMA_VERSION, type AxisCode } from '../../src/engine/axes'
import { observationInfo, observationLoglik, observationObservedInfo, observationScore, TESTLET_N_NODES } from '../../src/engine/irt'
import { cholesky, choleskyInverse, choleskyLogDet, choleskySolve } from '../../src/engine/linalg'
import { eapAxis, mapTheta, logPosterior } from '../../src/engine/scorer'
import type { Observation } from '../../src/engine/types'
import type { TestDb } from './harness'
import { openTestDb } from './vitest'

const fixture = (name: string): string => readFileSync(new URL(`../../src/engine/__fixtures__/${name}`, import.meta.url), 'utf8')

interface GoldenCase {
  id: string
  inputs: { mu: number[]; observations: Observation[]; sigma?: number[][] }
  outputs: {
    theta_map: number[]
    cov: number[][]
    eap: Record<string, { mean: number; sd: number }>
    log_posterior_at_map: number
    n_iter: number
  }
}
interface GoldenTestlet {
  id: string
  tau: number
  items: { a: number; b: number; y: 0 | 1 }[]
  theta: number[]
  loglik: number[]
  score: number[]
  info: number[]
  observed_info: number[]
}
interface Golden {
  version: string
  axes: string[]
  sigma_version: string
  sigma: number[][]
  conventions: { tolerance: number }
  cases: GoldenCase[]
  testlet_terms: GoldenTestlet[]
}
const golden = JSON.parse(fixture('scoring_v2.json')) as Golden
const TOL = golden.conventions.tolerance

let db: TestDb
beforeAll(async () => {
  db = await openTestDb()
})
afterAll(async () => {
  await db.close()
})

const flat = (m: readonly (readonly number[])[]): number[] => m.flat()
const reshape = (v: readonly number[], n: number): number[][] => Array.from({ length: n }, (_, i) => v.slice(i * n, (i + 1) * n))
const maxDiff = (a: readonly number[], b: readonly number[]): number => a.reduce((m, x, i) => Math.max(m, Math.abs(x - b[i]!)), a.length === b.length ? 0 : Infinity)

interface MapRow {
  o_theta: number[]
  o_cov: number[]
  o_n_iter: number
  o_lp: number
}
async function sqlMap(obs: readonly Observation[], mu: readonly number[], sigma: readonly (readonly number[])[]): Promise<MapRow> {
  const { rows } = await db.owner.query<MapRow>(`select * from hb.map_theta($1::jsonb, $2::float8[], $3::float8[])`, [JSON.stringify(obs), mu, flat(sigma)])
  return rows[0]!
}
async function sqlEap(obs: readonly Observation[], mu: readonly number[], sigma: readonly (readonly number[])[]): Promise<Record<string, { mean: number; sd: number }>> {
  const { rows } = await db.owner.query<{ axis: string; mean: number; sd: number }>(`select * from hb.eap_by_axis($1::jsonb, $2::float8[], $3::float8[]) order by axis`, [JSON.stringify(obs), mu, flat(sigma)])
  return Object.fromEntries(rows.map((r) => [r.axis, { mean: r.mean, sd: r.sd }]))
}

describe('the settings the scoring uses mirror the app (A8, A17)', () => {
  it('has the axis order of engine/axes.ts', async () => {
    const { rows } = await db.owner.query<{ c: string[] }>(`select hb.axis_codes() as c`)
    expect(rows[0]!.c).toEqual([...AXIS_CODES])
  })

  it('holds the Σ_init v2 of the app and of the bank golden/sigma_v2.json, with its version', async () => {
    const { rows } = await db.owner.query<{ s: number[]; v: string; cfg: number[][]; mu: number[] }>(
      `select hb.sigma_init() as s, hb.cfg_text('scoring.sigma_version', null) as v, (select value from public.app_config where key = 'scoring.sigma') as cfg, hb.mu_init() as mu`,
    )
    const app = initialSigma()
    expect(rows[0]!.v).toBe(SIGMA_VERSION)
    expect(rows[0]!.v).toBe(golden.sigma_version)
    expect(rows[0]!.s).toEqual(flat(app))
    expect(rows[0]!.cfg).toEqual(app)
    expect(rows[0]!.cfg).toEqual(golden.sigma)
    expect(rows[0]!.mu).toEqual(new Array(17).fill(0))
  })
})

describe('golden vectors (bank golden/scoring_v2.json, ROADMAP A2)', () => {
  it('is the file the app tests against', () => {
    expect(golden.version).toBe('scoring_v2')
    expect(golden.axes).toEqual([...AXIS_CODES])
    expect(golden.cases.length).toBe(84)
    expect(TOL).toBe(1e-6)
  })

  it.each(golden.cases.map((c) => [c.id, c] as const))('%s matches to 1e-6 (θ, cov, EAP, log posterior)', async (_id, c) => {
    const sigma = c.inputs.sigma ?? golden.sigma
    const got = await sqlMap(c.inputs.observations, c.inputs.mu, sigma)
    expect(maxDiff(got.o_theta, c.outputs.theta_map), 'theta').toBeLessThan(TOL)
    expect(maxDiff(got.o_cov, flat(c.outputs.cov)), 'cov').toBeLessThan(TOL)
    expect(Math.abs(got.o_lp - c.outputs.log_posterior_at_map), 'log posterior').toBeLessThan(TOL)
    // exactly symmetric, as the app's
    const cov = reshape(got.o_cov, 17)
    for (let i = 0; i < 17; i++) for (let j = 0; j < i; j++) expect(cov[i]![j]).toBe(cov[j]![i])

    const eap = await sqlEap(c.inputs.observations, c.inputs.mu, sigma)
    expect(Object.keys(eap).sort()).toEqual(Object.keys(c.outputs.eap).sort())
    for (const [axis, want] of Object.entries(c.outputs.eap)) {
      expect(Math.abs(eap[axis]!.mean - want.mean), `eap ${axis} mean`).toBeLessThan(TOL)
      expect(Math.abs(eap[axis]!.sd - want.sd), `eap ${axis} sd`).toBeLessThan(TOL)
    }
  })

  it('also agrees with the app engine on the log posterior function itself', async () => {
    const c = golden.cases.find((x) => x.id.startsWith('22_random'))!
    const sigma = c.inputs.sigma ?? golden.sigma
    const got = await sqlMap(c.inputs.observations, c.inputs.mu, sigma)
    expect(Math.abs(got.o_lp - logPosterior(got.o_theta, c.inputs.observations, c.inputs.mu, sigma))).toBeLessThan(1e-9)
  })

  it.each(golden.testlet_terms.map((t) => [t.id, t] as const))('testlet terms %s match to 1e-9 (log L, score, expected and observed information)', async (_id, t) => {
    const ext = t.items.flatMap((it) => [it.a, it.b, it.y])
    for (let i = 0; i < t.theta.length; i++) {
      const { rows } = await db.owner.query<{ o_ll: number; o_score: number; o_info: number; o_oinfo: number }>(
        `select * from hb.obs_terms(5, $1::float8, 0, 0, $2::float8, 0, $3::float8[], 0, $4::int, 3)`,
        [t.theta[i], t.tau, ext, t.items.length],
      )
      const r = rows[0]!
      expect(Math.abs(r.o_ll - t.loglik[i]!), `loglik at ${t.theta[i]}`).toBeLessThan(1e-9)
      expect(Math.abs(r.o_score - t.score[i]!), `score at ${t.theta[i]}`).toBeLessThan(1e-9)
      expect(Math.abs(r.o_info - t.info[i]!), `info at ${t.theta[i]}`).toBeLessThan(1e-9)
      expect(Math.abs(r.o_oinfo - t.observed_info[i]!), `observed info at ${t.theta[i]}`).toBeLessThan(1e-9)
    }
  })

  it('uses the quadrature of the app: 65 nodes', async () => {
    const { rows } = await db.owner.query<{ n: number }>(`select array_length(hb.testlet_z(), 1) as n`)
    expect(rows[0]!.n).toBe(TESTLET_N_NODES)
  })
})

// ------------------------------------------------------------------------------ generated inputs
const num = (lo: number, hi: number): fc.Arbitrary<number> => fc.double({ min: lo, max: hi, noNaN: true, noDefaultInfinity: true }).map((x) => Math.round(x * 1000) / 1000)
const axisArb: fc.Arbitrary<AxisCode> = fc.constantFrom(...AXIS_CODES)
const obs2pl: fc.Arbitrary<Observation> = fc.record({ kind: fc.constant('2pl' as const), axis: axisArb, a: num(0.2, 4), b: num(-5, 5), y: fc.constantFrom(0 as const, 1 as const) })
const obs3pl: fc.Arbitrary<Observation> = fc.record({ kind: fc.constant('3pl' as const), axis: axisArb, a: num(0.2, 4), b: num(-5, 5), c: fc.constantFrom(0.2, 0.25, 1 / 3, 0.5), y: fc.constantFrom(0 as const, 1 as const) })
const obsGrm: fc.Arbitrary<Observation> = fc
  .tuple(axisArb, num(0.3, 3), fc.array(num(-3, 3), { minLength: 1, maxLength: 4 }), fc.nat(10))
  .map(([axis, a, raw, pick]) => {
    const b = [...new Set(raw)].sort((x, y) => x - y)
    return { kind: 'grm' as const, axis, a, b, y: pick % (b.length + 1) }
  })
const obsGauss: fc.Arbitrary<Observation> = fc.record({ kind: fc.constant('gaussian' as const), axis: axisArb, lam: num(-2, 2).filter((x) => x !== 0), d: num(-1, 1), sigma: num(0.1, 2).filter((x) => x > 0), x: num(-4, 4) })
const obsTestlet: fc.Arbitrary<Observation> = fc.record({
  kind: fc.constant('testlet' as const),
  axis: axisArb,
  tau: fc.constantFrom(0, 0.15, 0.3),
  items: fc.array(fc.record({ a: num(0.3, 3), b: num(-3, 3), y: fc.constantFrom(0 as const, 1 as const) }), { minLength: 1, maxLength: 5 }),
})
const anyObs: fc.Arbitrary<Observation> = fc.oneof(obs2pl, obs3pl, obsGrm, obsGauss, obsTestlet)

describe('one observation: the terms of engine/irt.ts', () => {
  it('log-likelihood, score, expected and observed information agree for every kind at generated θ (1,500 terms)', async () => {
    const sample = fc.sample(fc.tuple(anyObs, num(-4, 4)), 1500)
    const obs = sample.map(([o]) => o)
    const theta = sample.map(([, t]) => t)
    const { rows } = await db.owner.query<{ i: number; o_ll: number; o_score: number; o_info: number; o_oinfo: number }>(
      `with s as (select hb.parse_obs($1::jsonb, 17) as p), th as (select $2::float8[] as t)
       select i::int as i, o.o_ll, o.o_score, o.o_info, o.o_oinfo
         from s, th, generate_series(1, (s.p).n) i,
              lateral hb.obs_terms((s.p).kind[i], th.t[i], (s.p).pa[i], (s.p).pb[i], (s.p).pc[i], (s.p).py[i], (s.p).ext, (s.p).off[i], (s.p).len[i], 3) o
        order by i`,
      [JSON.stringify(obs), theta],
    )
    expect(rows.length).toBe(sample.length)
    const kinds = new Set<string>()
    for (const r of rows) {
      const o = obs[r.i - 1]!
      const t = theta[r.i - 1]!
      kinds.add(o.kind)
      const tol = o.kind === 'testlet' ? 1e-8 : 1e-10
      expect(Math.abs(r.o_ll - observationLoglik(o, t)), `${JSON.stringify(o)} @ ${t} ll`).toBeLessThan(tol)
      expect(Math.abs(r.o_score - observationScore(o, t)), `${JSON.stringify(o)} @ ${t} score`).toBeLessThan(tol)
      expect(Math.abs(r.o_info - observationInfo(o, t)), `${JSON.stringify(o)} @ ${t} info`).toBeLessThan(tol)
      expect(Math.abs(r.o_oinfo - observationObservedInfo(o, t)), `${JSON.stringify(o)} @ ${t} observed info`).toBeLessThan(tol)
    }
    expect([...kinds].sort()).toEqual(['2pl', '3pl', 'gaussian', 'grm', 'testlet'])
  })

  it('does not overflow or underflow at extreme logits (a = 100, b = ±50, θ = ±8)', async () => {
    const obs: Observation[] = [
      { kind: '2pl', axis: 'QR', a: 100, b: -50, y: 1 },
      { kind: '2pl', axis: 'QR', a: 100, b: 50, y: 0 },
      { kind: '2pl', axis: 'QR', a: 100, b: 50, y: 1 },
      { kind: '3pl', axis: 'SPA', a: 100, b: 50, c: 0.25, y: 1 },
      { kind: '3pl', axis: 'SPA', a: 100, b: -50, c: 0.25, y: 0 },
      { kind: 'grm', axis: 'WM', a: 100, b: [-60, 0, 60], y: 3 },
      { kind: 'grm', axis: 'WM', a: 100, b: [-60, 0, 60], y: 0 },
    ]
    for (const theta of [-8, 0, 8]) {
      const { rows } = await db.owner.query<{ i: number; o_ll: number; o_score: number; o_info: number; o_oinfo: number }>(
        `with s as (select hb.parse_obs($1::jsonb, 17) as p)
         select i::int as i, o.o_ll, o.o_score, o.o_info, o.o_oinfo from s, generate_series(1, (s.p).n) i,
           lateral hb.obs_terms((s.p).kind[i], $2::float8, (s.p).pa[i], (s.p).pb[i], (s.p).pc[i], (s.p).py[i], (s.p).ext, (s.p).off[i], (s.p).len[i], 3) o order by i`,
        [JSON.stringify(obs), theta],
      )
      for (const r of rows) {
        const o = obs[r.i - 1]!
        for (const v of [r.o_ll, r.o_score, r.o_info, r.o_oinfo]) expect(Number.isFinite(v)).toBe(true)
        // relative agreement where the value is not rounding noise
        const want = observationLoglik(o, theta)
        expect(Math.abs(r.o_ll - want) / Math.max(1, Math.abs(want))).toBeLessThan(1e-12)
      }
    }
  })
})

describe('the MAP and the grid EAP agree with the app on generated sessions', () => {
  it('matches mapTheta and eapAxis on random mixed observation sets (30 sets, 1e-6)', async () => {
    const sigma = initialSigma()
    const mu = new Array<number>(17).fill(0)
    for (const obs of fc.sample(fc.array(anyObs, { minLength: 1, maxLength: 40 }), 30)) {
      const want = mapTheta(obs, mu, sigma)
      const got = await sqlMap(obs, mu, sigma)
      expect(maxDiff(got.o_theta, want.theta), JSON.stringify(obs)).toBeLessThan(1e-6)
      expect(maxDiff(got.o_cov, flat(want.cov))).toBeLessThan(1e-6)
      expect(Math.abs(got.o_lp - want.logPosterior)).toBeLessThan(1e-6)
      const eap = await sqlEap(obs, mu, sigma)
      for (const code of new Set(obs.map((o) => o.axis))) {
        const w = eapAxis(
          obs.filter((o) => o.axis === code),
          0,
          1,
        )
        expect(Math.abs(eap[code]!.mean - w.mean)).toBeLessThan(1e-6)
        expect(Math.abs(eap[code]!.sd - w.sd)).toBeLessThan(1e-6)
      }
    }
  })

  it('MAP with K = 17 and 150 observations is fast enough for finish (well under a second)', async () => {
    const sigma = initialSigma()
    const mu = new Array<number>(17).fill(0)
    const obs = fc.sample(fc.oneof(obs2pl, obs3pl), 150)
    const t0 = performance.now()
    const got = await sqlMap(obs, mu, sigma)
    const ms = performance.now() - t0
    expect(maxDiff(got.o_theta, mapTheta(obs, mu, sigma).theta)).toBeLessThan(1e-6)
    expect(ms).toBeLessThan(1500)
  })

  it('the grid EAP from a stored log-likelihood equals eapAxis: hb.grid_ll summed, then hb.eap_from_ll', async () => {
    const obs = fc.sample(fc.oneof(obs2pl, obs3pl), 25).map((o) => ({ ...o, axis: 'QR' as const }))
    const lls = await Promise.all(
      obs.map((o) =>
        db.owner.query<{ ll: number[] }>(`select hb.grid_ll($1::int, $2::float8, $3::float8, $4::float8, $5::float8) as ll`, [o.kind === '2pl' ? 1 : 2, (o as { a: number }).a, (o as { b: number }).b, (o as { c?: number }).c ?? 0.5, (o as { y: number }).y]),
      ),
    )
    const sum = new Array<number>(61).fill(0)
    for (const r of lls) r.rows[0]!.ll.forEach((v, i) => (sum[i]! += v))
    const { rows } = await db.owner.query<{ o_mean: number; o_sd: number }>(`select * from hb.eap_from_ll($1::float8[], 0, 1)`, [sum])
    const want = eapAxis(obs, 0, 1)
    expect(Math.abs(rows[0]!.o_mean - want.mean)).toBeLessThan(1e-9)
    expect(Math.abs(rows[0]!.o_sd - want.sd)).toBeLessThan(1e-9)
    // no data: the prior
    const prior = await db.owner.query<{ o_mean: number; o_sd: number }>(`select * from hb.eap_from_ll(null, 0.3, 1)`)
    const wantPrior = eapAxis([], 0.3, 1)
    expect(Math.abs(prior.rows[0]!.o_mean - wantPrior.mean)).toBeLessThan(1e-9)
    expect(Math.abs(prior.rows[0]!.o_sd - wantPrior.sd)).toBeLessThan(1e-9)
  })
})

describe('linear algebra: the helpers of engine/linalg.ts', () => {
  const spd = fc
    .tuple(fc.integer({ min: 1, max: 8 }), fc.integer({ min: 0, max: 1_000_000 }))
    .map(([n, seed]) => {
      // A = B Bᵀ + n I from a deterministic pseudo-random B
      let s = seed + 1
      const rnd = (): number => ((s = (s * 48271) % 2147483647) / 2147483647) * 2 - 1
      const B = Array.from({ length: n }, () => Array.from({ length: n }, rnd))
      return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => B[i]!.reduce((t, _v, k) => t + B[i]![k]! * B[j]![k]!, 0) + (i === j ? 1 : 0)))
    })

  it('Cholesky, solve, inverse and log-determinant agree with the app (40 matrices)', async () => {
    for (const A of fc.sample(spd, 40)) {
      const n = A.length
      const b = A.map((_, i) => Math.sin(i + 1))
      const L = cholesky(A)
      const { rows } = await db.owner.query<{ l: number[]; x: number[]; inv: number[]; logdet: number }>(
        `select l, hb.mat_chol_solve(l, $2::float8[], $3::int) as x, hb.mat_chol_inverse(l, $3::int) as inv, hb.mat_chol_logdet(l, $3::int) as logdet
           from (select hb.mat_chol($1::float8[], $3::int) as l) t`,
        [flat(A), b, n],
      )
      const r = rows[0]!
      expect(maxDiff(r.l, flat(L))).toBeLessThan(1e-12)
      expect(maxDiff(r.x, choleskySolve(L, b))).toBeLessThan(1e-10)
      expect(maxDiff(r.inv, flat(choleskyInverse(L)))).toBeLessThan(1e-10)
      expect(Math.abs(r.logdet - choleskyLogDet(L))).toBeLessThan(1e-10)
    }
  })

  it('returns null for a matrix that is not positive definite', async () => {
    const { rows } = await db.owner.query<{ l: number[] | null }>(`select hb.mat_chol(array[1, 2, 2, 1]::float8[], 2) as l`)
    expect(rows[0]!.l).toBeNull()
    expect((await db.owner.query<{ l: number[] | null }>(`select hb.mat_chol(array[0, 0, 0, 1]::float8[], 2) as l`)).rows[0]!.l).toBeNull()
  })
})

describe('input checks (the rules of scorer.ts checkObservation)', () => {
  const rejects = async (obs: unknown, mu: number[] = new Array(17).fill(0), sigma: number[][] = initialSigma()): Promise<string | undefined> => {
    try {
      await db.owner.query(`select * from hb.map_theta($1::jsonb, $2::float8[], $3::float8[])`, [JSON.stringify(obs), mu, flat(sigma)])
    } catch (e) {
      expect((e as { code?: string }).code).toBe('22023')
      return (e as Error).message
    }
    return undefined
  }

  it.each([
    ['an unknown kind', [{ kind: 'rasch', axis: 'QR', a: 1, b: 0, y: 1 }]],
    ['an unknown axis', [{ kind: '2pl', axis: 'XX', a: 1, b: 0, y: 1 }]],
    ['an extra field', [{ kind: '2pl', axis: 'QR', a: 1, b: 0, y: 1, c: 0.2 }]],
    ['a missing field', [{ kind: '2pl', axis: 'QR', a: 1, y: 1 }]],
    ['a 3PL with c = 0', [{ kind: '3pl', axis: 'QR', a: 1, b: 0, c: 0, y: 1 }]],
    ['a 3PL with c = 1', [{ kind: '3pl', axis: 'QR', a: 1, b: 0, c: 1, y: 1 }]],
    ['y = 2', [{ kind: '2pl', axis: 'QR', a: 1, b: 0, y: 2 }]],
    ['y that is a string', [{ kind: '2pl', axis: 'QR', a: 1, b: 0, y: '1' }]],
    ['GRM thresholds not increasing', [{ kind: 'grm', axis: 'WM', a: 1, b: [0, 0], y: 1 }]],
    ['GRM with no threshold', [{ kind: 'grm', axis: 'WM', a: 1, b: [], y: 0 }]],
    ['GRM category above m', [{ kind: 'grm', axis: 'WM', a: 1, b: [0], y: 2 }]],
    ['GRM a <= 0', [{ kind: 'grm', axis: 'WM', a: 0, b: [0], y: 0 }]],
    ['Gaussian sigma = 0', [{ kind: 'gaussian', axis: 'RT', lam: -1, d: 0, sigma: 0, x: 1 }]],
    ['a testlet of 9 items', [{ kind: 'testlet', axis: 'RC', tau: 0.3, items: Array.from({ length: 9 }, () => ({ a: 1, b: 0, y: 1 })) }]],
    ['an empty testlet', [{ kind: 'testlet', axis: 'RC', tau: 0.3, items: [] }]],
    ['a testlet with |a| tau above 3', [{ kind: 'testlet', axis: 'RC', tau: 0.3, items: [{ a: 11, b: 0, y: 1 }] }]],
    ['a negative tau', [{ kind: 'testlet', axis: 'RC', tau: -0.1, items: [{ a: 1, b: 0, y: 1 }] }]],
    ['not an array', { kind: '2pl' }],
  ])('rejects %s', async (_name, obs) => {
    expect(await rejects(obs)).toBeDefined()
  })

  it('rejects a Σ that is not symmetric, not positive definite or of the wrong size', async () => {
    expect(await rejects([], new Array(2).fill(0), [[1, 0.3], [0.5, 1]])).toMatch(/symmetric/)
    expect(await rejects([], new Array(2).fill(0), [[1, 2], [2, 1]])).toMatch(/positive definite/)
    expect(await rejects([], new Array(3).fill(0), [[1, 0], [0, 1]])).toMatch(/K x K/)
  })

  it('takes a prior of any size K, with the observations on its first K axes', async () => {
    const got = await db.owner.query<{ o_theta: number[] }>(`select * from hb.map_theta($1::jsonb, $2::float8[], $3::float8[])`, [JSON.stringify([{ kind: '2pl', axis: 'LR', a: 1, b: 0, y: 1 }]), [0, 0], [1, 0.4, 0.4, 1]])
    expect(got.rows[0]!.o_theta.length).toBe(2)
    expect(await rejects([{ kind: '2pl', axis: 'QR', a: 1, b: 0, y: 1 }], [0, 0], [[1, 0.4], [0.4, 1]])).toMatch(/outside the first 2 axes/)
  })

  it('returns the prior for no observations and 1 iteration', async () => {
    const got = await sqlMap([], new Array(17).fill(0.5), initialSigma())
    expect(got.o_theta).toEqual(new Array(17).fill(0.5))
    expect(got.o_n_iter).toBe(1)
  })
})
