/**
 * ROADMAP M1.4b (a): the non-adaptive replication of the bank's M1.4a θ-recovery run in TS, on
 * the SAME simulees (`engine/__fixtures__/sim_m14a_v1.json`, the A17 copy of the bank's
 * `golden/sim_m14a_v1.json`). Parity: per-axis |r_TS − r_Python| ≤ 0.02 (in fact identical to
 * rounding: the same responses and the same scorer, so this repeats the M1.3 golden parity).
 *
 * This is NOT the adaptive CAT simulation of M1.4b (b) (`cat.test.ts`): that run serves the real
 * families (SPA 3PL, other item counts), so its r is a different design's and is only reported
 * next to the Python r (`report.ts` catVsPython; post-merge audit, ADR pending).
 *
 * This is the fast version: the first N = 300 simulees (the fixture carries the Python results
 * for exactly this prefix). The full N = 2,000 run is `scripts/sim-cat.slow.test.ts`
 * (`npm run test:slow`) and `npm run sim:cat -- --part a`.
 */

import { describe, expect, it } from 'vitest'
import { AXIS_CODES, N_AXES, SIGMA_VERSION } from '../engine/axes'
import simText from '../engine/__fixtures__/sim_m14a_v1.json?raw'
import { M14A_VERSION, PARITY_R_TOL, m14aFixtureProblems, m14aObservations, parity, pythonResults, runM14a, type M14aFixture } from './m14a'
import { COVERAGE_HI, COVERAGE_LO, R_MIN, Z_COVERAGE } from './stats'

const FIXTURE = JSON.parse(simText) as M14aFixture
/** The fast test's sample size (marked: the fixture's small Python result). */
const N_FAST = 300

describe('the M1.4a fixture (A17 copy of the bank golden file)', () => {
  it('is usable by this engine: version, Σ version, axis order, shapes', () => {
    expect(m14aFixtureProblems(FIXTURE)).toEqual([])
    expect(FIXTURE.version).toBe(M14A_VERSION)
    expect(FIXTURE.sigma_version).toBe(SIGMA_VERSION)
    expect(FIXTURE.n).toBe(2000)
    expect(FIXTURE.results.map((r) => r.n)).toEqual([N_FAST, 2000])
  })

  it('states the M1.4a design and the acceptance constants this module uses', () => {
    const d = FIXTURE.design
    expect(d.item_axes).toEqual(['MAT', 'LR', 'LG', 'RC', 'VOC', 'QR', 'SPA', 'KST', 'KHU', 'KAP'])
    expect([d.n_items, d.a_log_mean, d.a_log_sd, d.b_sd]).toEqual([20, 0.2, 0.3, 1.2])
    expect(d.wm).toEqual({ axis: 'WM', n_items: 3, a: 1.7, thresholds: [-1.2, -0.4, 0.4, 1.2] })
    expect(d.gaussian.map((g) => g.axis)).toEqual(['RT', 'RT', 'PS', 'PS', 'FER', 'FER', 'FER', 'FER', 'FER', 'FER', 'CAL'])
    expect(d.z_coverage).toBe(Z_COVERAGE)
    expect([d.r_min, d.coverage_lo, d.coverage_hi]).toEqual([R_MIN, COVERAGE_LO, COVERAGE_HI])
  })

  it('flags a fixture this engine cannot use', () => {
    const bad = { ...FIXTURE, version: 'sim_m14a_v0', sigma_version: 'sigma-v1', simulees: FIXTURE.simulees.slice(0, 3) }
    const problems = m14aFixtureProblems(bad)
    expect(problems.some((p) => p.includes('version sim_m14a_v0'))).toBe(true)
    expect(problems.some((p) => p.includes('sigma_version'))).toBe(true)
    expect(problems.some((p) => p.includes('3 simulees'))).toBe(true)
    const ragged = { ...FIXTURE, simulees: [[[0], '01', [1], []], ...FIXTURE.simulees.slice(1)] as unknown as M14aFixture['simulees'] }
    expect(m14aFixtureProblems(ragged).length).toBeGreaterThanOrEqual(3)
  })
})

describe('m14aObservations', () => {
  it("rebuilds a simulee's 214 observations in the bank's order", () => {
    const obs = m14aObservations(FIXTURE, 7)
    expect(obs).toHaveLength(10 * 20 + 3 + 11)
    const [, bits, wm, x] = FIXTURE.simulees[7]!
    expect(obs[0]).toEqual({ kind: '2pl', axis: 'MAT', a: FIXTURE.a[0]![0], b: FIXTURE.b[0]![0], y: bits[0] === '1' ? 1 : 0 })
    expect(obs[199]).toMatchObject({ kind: '2pl', axis: 'KAP', a: FIXTURE.a[9]![19], y: bits[199] === '1' ? 1 : 0 })
    expect(obs.slice(200, 203).map((o) => (o.kind === 'grm' ? o.y : -1))).toEqual(wm)
    expect(obs.slice(203).map((o) => (o.kind === 'gaussian' ? [o.axis, o.lam, o.x] : null))).toEqual(FIXTURE.design.gaussian.map((g, k) => [g.axis, g.lam, x[k]]))
    expect(() => m14aObservations(FIXTURE, FIXTURE.n)).toThrow(RangeError)
  })
})

describe(`M1.4b (a): TS replication of M1.4a on the same simulees, N = ${N_FAST} (fast)`, () => {
  const run = runM14a(FIXTURE, N_FAST)
  const rows = parity(FIXTURE, run)

  it(`replication parity: per-axis r matches the Python result within ${PARITY_R_TOL} on every axis (the fixed form, not the CAT)`, () => {
    expect(rows.map((r) => r.code)).toEqual([...AXIS_CODES])
    for (const r of rows) expect(r.diff, r.code).toBeLessThanOrEqual(PARITY_R_TOL)
    expect(rows.every((r) => r.ok)).toBe(true)
  })

  it('in fact reproduces every Python statistic to rounding (same people, same scorer, A2)', () => {
    const py = pythonResults(FIXTURE, N_FAST)!
    for (const [k, ax] of run.axes.entries()) {
      const ref = py[k]!
      expect(ax.code).toBe(ref.code)
      expect(Math.abs(ax.r - ref.r), ax.code).toBeLessThan(1e-9)
      expect(Math.abs(ax.rmse - ref.rmse), ax.code).toBeLessThan(1e-9)
      expect(Math.abs(ax.mean_sd - ref.mean_sd), ax.code).toBeLessThan(1e-9)
      expect(ax.coverage, ax.code).toBe(ref.coverage)
    }
  })

  it("matches the head simulees' Python MAP θ̂ and SDs to 1e-6 (the A2 golden tolerance)", () => {
    for (const h of FIXTURE.head) {
      expect(h.theta_hat).toHaveLength(N_AXES)
      for (let k = 0; k < N_AXES; k++) {
        expect(Math.abs(run.thetaHat[h.i]![k]! - h.theta_hat[k]!)).toBeLessThan(1e-6)
        expect(Math.abs(run.sd[h.i]![k]! - h.sd[k]!)).toBeLessThan(1e-6)
      }
    }
  })

  it('meets the M1.4a acceptance in TS too: r ≥ .85 on the item axes, cov90 in [0.85, 0.95] where observed', () => {
    const py = pythonResults(FIXTURE, N_FAST)!
    for (const ax of run.axes) {
      const ref = py.find((p) => p.code === ax.code)!
      if (ref.model === '2pl') expect(ax.r, ax.code).toBeGreaterThanOrEqual(R_MIN)
      if (ref.n_obs > 0) {
        expect(ax.coverage, ax.code).toBeGreaterThanOrEqual(COVERAGE_LO)
        expect(ax.coverage, ax.code).toBeLessThanOrEqual(COVERAGE_HI)
      }
    }
  })

  it('reports a parity failure when the Python r differs by more than the tolerance', () => {
    const shifted = { ...FIXTURE, results: FIXTURE.results.map((r) => ({ ...r, axes: r.axes.map((a) => (a.code === 'QR' ? { ...a, r: a.r - 0.021 } : a)) })) }
    const bad = parity(shifted, run).filter((r) => !r.ok)
    expect(bad.map((r) => r.code)).toEqual(['QR'])
    expect(() => parity(FIXTURE, runM14a(FIXTURE, 5))).toThrow(/n = 300, 2000, not 5/)
  })

  it('rejects n outside 2..N', () => {
    expect(() => runM14a(FIXTURE, 1)).toThrow(RangeError)
    expect(() => runM14a(FIXTURE, FIXTURE.n + 1)).toThrow(RangeError)
  })
})
