/**
 * ROADMAP M1.4b (b): the adaptive CAT simulation of an M1 session (`cat.ts`) with the REAL engine
 * selector (M1.14), scorer (M1.3) and registered families, fixed blocks included, on the M1.4a
 * simulees (`engine/__fixtures__/sim_m14a_v1.json`).
 *
 * This is the fast version: the first N = 300 simulees under the A15 time rule (about 25 s). The
 * full N = 2,000 runs (A15 and the DESIGN §14.3 fixed length of 20 items per axis) are
 * `scripts/sim-cat.slow.test.ts` (`npm run test:slow`) and `npm run sim:cat`.
 *
 * What holds and is asserted: every session stays within the A15 target, 90% coverage is in
 * [0.85, 0.95] on every observed axis, every block yields its observation, the coverage floor
 * holds. What does NOT hold, and is recorded as an expected failure: r ≥ .85 on MAT, SPA and QR
 * within the A15 budget. With the families' provisional parameters (a = 1.0 for every item, 3PL
 * c = 1/4 for 4-option rotation, A9) and ≈ 5 min per CAT axis (6–13 items), a first session
 * gives r = .82 / .80 / .75 (MAT / SPA / QR) at N = 300 and .833 / .814 / .770 at N = 2,000, in
 * line with DESIGN §7.6's projected session-1 SE of ≈ 0.57. r ≥ .85 on all three needs about a
 * 45-minute session; DESIGN §14.3's "at 20 items/axis" (≈ 48 min) passes at N = 2,000 (.903 /
 * .868 / .905, the slow test). The r floor below guards against regressions meanwhile.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { AXIS_INDEX, N_AXES } from '../engine/axes'
import simText from '../engine/__fixtures__/sim_m14a_v1.json?raw'
import { A15_TARGET_S, COVERAGE_FLOOR, planSession } from '../engine/selector'
import { resolveItem } from '../tasks/registry'
import { BLOCK_AXES, CAT_AXES, observedAxes, runCat, sessionSeedOf, simulateSession, type CatRun } from './cat'
import type { M14aFixture } from './m14a'
import { catAcceptanceFailures, formatCat } from './report'
import { COVERAGE_HI, COVERAGE_LO, R_MIN } from './stats'

const FIXTURE = JSON.parse(simText) as M14aFixture
const THETAS = FIXTURE.simulees.map((s) => s[0])
/** The fast test's sample size (marked: the full run is N = 2,000, `scripts/sim-cat.slow.test.ts`). */
const N_FAST = 300
/**
 * Regression floor of r on the CAT axes at the A15 budget: well below the measured .82 / .80 /
 * .75 (N = 300), far above what a broken selector or scorer gives. NOT the acceptance (R_MIN).
 */
const R_FLOOR_A15 = 0.7

const BLOCK_ORDER = ['rt_simple', 'rt_choice4', 'span_fwd', 'span_bwd', 'corsi', 'coding', 'reading']

describe('simulateSession', () => {
  const theta = THETAS[3]!
  const s = simulateSession(theta, 'unit-session')

  it('runs the A15 plan: every fixed block in order, CAT items only on MAT, SPA and QR', () => {
    expect(s.blocks.map((b) => b.family)).toEqual(BLOCK_ORDER)
    expect(s.blocks.every((b) => b.observed && b.reasons.length === 0)).toBe(true)
    expect(Object.keys(s.items).sort()).toEqual([...CAT_AXES].sort())
    const catObs = s.observations.filter((o) => o.kind === '2pl' || o.kind === '3pl')
    expect(catObs).toHaveLength(s.itemIds.length)
    expect(s.observations).toHaveLength(s.itemIds.length + BLOCK_ORDER.length)
    expect(new Set(s.observations.map((o) => o.axis))).toEqual(new Set([...CAT_AXES, ...BLOCK_AXES]))
    expect(s.segmentEnds).toHaveLength(3)
  })

  it('serves real registry items that regenerate from their ids (A11), each family at most once', () => {
    const families = s.itemIds.map((id) => {
      const item = resolveItem(id)
      expect(item, id).not.toBeNull()
      expect(['matrices', 'series', 'rotation', 'quant']).toContain(item!.family)
      return item!.family_id
    })
    expect(new Set(families).size).toBe(families.length) // §7.7 family exclusion
  })

  it('charges E[T] and never exceeds the session target; unused CAT time carries over', () => {
    const plan = planSession({ sessionSeed: 'unit-session' })
    const blockTime = plan.reduce((t, p) => t + (p.kind === 'block' ? p.item.expected_time_s : 0), 0)
    expect(s.timeS).toBeCloseTo(blockTime + s.catTimeS, 9)
    expect(s.timeS).toBeLessThanOrEqual(A15_TARGET_S)
    expect(A15_TARGET_S - s.timeS).toBeLessThan(80) // the last segment uses what the others left
    const short = simulateSession(theta, 'unit-session', { targetS: 15 * 60 })
    expect(short.timeS).toBeLessThanOrEqual(15 * 60)
    expect(short.itemIds.length).toBeLessThan(s.itemIds.length)
  })

  it('finishes with the correlated MAP over all 17 axes', () => {
    expect(s.thetaHat).toHaveLength(N_AXES)
    expect(s.sd).toHaveLength(N_AXES)
    expect(s.sd.every((v) => v > 0 && v <= 1)).toBe(true)
    // borrowing through Σ moves an axis with no data (LR) off its prior mean 0
    expect(s.thetaHat[AXIS_INDEX.LR]).not.toBe(0)
  })

  it('is deterministic in (θ, session seed) and differs across seeds', () => {
    expect(simulateSession(theta, 'unit-session')).toEqual(s)
    expect(simulateSession(theta, 'unit-session-2').itemIds).not.toEqual(s.itemIds)
  })

  it('fixed length: every CAT axis gets exactly that many items, without a time limit', () => {
    const f = simulateSession(theta, 'unit-fixed', { fixedLength: 4 })
    expect(f.items).toEqual({ MAT: 4, SPA: 4, QR: 4 })
    expect(f.segmentEnds).toEqual(['length', 'length', 'length'])
    expect(() => simulateSession(theta, 'x', { fixedLength: 0 })).toThrow(RangeError)
  })

  it('rejects a θ of the wrong size', () => {
    expect(() => simulateSession(theta.slice(1), 'x')).toThrow(RangeError)
    expect(() => simulateSession(theta.map(() => Number.NaN), 'x')).toThrow(RangeError)
  })
})

describe(`M1.4b (b): adaptive session under the A15 time rule, N = ${N_FAST} (fast)`, () => {
  let run: CatRun

  beforeAll(() => {
    run = runCat(THETAS.slice(0, N_FAST), { seed: 'm14b' })
    console.log(formatCat(run))
  }, 300_000)

  it('uses the M1.4a simulees with one session seed each', () => {
    expect(run.n).toBe(N_FAST)
    expect(run.sessions.map((s) => s.sessionSeed)).toEqual(THETAS.slice(0, N_FAST).map((_, i) => sessionSeedOf('m14b', i)))
    expect(run.fixedLength).toBeNull()
    expect(run.targetS).toBe(A15_TARGET_S)
  })

  it('keeps every session within the A15 time budget', () => {
    expect(run.timeS.max).toBeLessThanOrEqual(A15_TARGET_S)
    expect(run.timeS.min).toBeGreaterThan(A15_TARGET_S - 120)
    expect(run.segmentEnds).toEqual({ time: 3 * N_FAST })
  })

  it('90% coverage is in [0.85, 0.95] on every observed axis (MAT, SPA, QR, WM, RT, PS)', () => {
    const observed = observedAxes(run)
    expect(observed.sort()).toEqual([...CAT_AXES, ...BLOCK_AXES].sort())
    for (const k of observed) {
      const c = run.axes[AXIS_INDEX[k]]!.coverage
      expect(c, k).toBeGreaterThanOrEqual(COVERAGE_LO)
      expect(c, k).toBeLessThanOrEqual(COVERAGE_HI)
    }
  })

  it('every fixed block yields its observation, and each CAT axis gets at least the coverage floor', () => {
    expect(Object.keys(run.blockObserved).sort()).toEqual([...BLOCK_ORDER].sort())
    expect(Object.values(run.blockObserved).every((p) => p === 1)).toBe(true)
    for (const k of CAT_AXES) expect(run.itemsPerAxis[k]!.min, k).toBeGreaterThanOrEqual(COVERAGE_FLOOR)
  })

  it(`block axes recover θ with r ≥ ${R_MIN}; CAT axes stay above the regression floor ${R_FLOOR_A15}`, () => {
    for (const k of BLOCK_AXES) expect(run.axes[AXIS_INDEX[k]]!.r, k).toBeGreaterThanOrEqual(R_MIN)
    for (const k of CAT_AXES) expect(run.axes[AXIS_INDEX[k]]!.r, k).toBeGreaterThanOrEqual(R_FLOOR_A15)
  })

  it('the only acceptance failures are the CAT axes r criterion (time and coverage pass)', () => {
    const fails = catAcceptanceFailures(run)
    expect(fails.every((f) => /^(MAT|SPA|QR): r = /.test(f))).toBe(true)
  })

  // Expected failure (see the module comment): r ≥ .85 on MAT, SPA and QR within the A15 budget is
  // not reachable with the provisional item parameters. When it starts passing, drop `.fails`.
  it.fails(`acceptance: r ≥ ${R_MIN} on MAT, SPA and QR within the A15 budget (NOT MET with provisional params)`, () => {
    expect(catAcceptanceFailures(run)).toEqual([])
  })
})
