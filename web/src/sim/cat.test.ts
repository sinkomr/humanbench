/**
 * ROADMAP M1.4b (b): the adaptive CAT simulation of an M1 session (`cat.ts`) with the REAL engine
 * selector (M1.14), scorer (M1.3) and registered families, fixed blocks included, on the M1.4a
 * simulees (`engine/__fixtures__/sim_m14a_v1.json`).
 *
 * This is the fast version: the first N = 300 simulees under the A15 time rule (about 25 s). The
 * full N = 2,000 runs (A15 and the DESIGN §14.3 fixed length of 20 items per axis) are
 * `scripts/sim-cat.slow.test.ts` (`npm run test:slow`) and `npm run sim:cat`.
 *
 * Each block takes the simulated taker's own time (the family's block-time model on the
 * response), and the difference from its E[T] moves the next CAT segment's budget.
 *
 * What holds and is asserted: every session's simulated time is within A15's 25–30 min (26.2–29.3
 * min at N = 300, 26.0–29.6 at N = 2,000, mean 27.3), 90% coverage is in [0.85, 0.95] on every
 * observed axis, every block yields its observation, the selector targets difficulty to the
 * person, MAT and SPA get the §7.4 coverage floor. QR, which follows the span blocks, misses the
 * floor in ≈ 5–6% of sessions (high-WM takers whose longer span blocks use up its time): bounded
 * here, a follow-up for M1.15's session clock. What does NOT hold, and is recorded as an expected
 * failure: r ≥ .85 on MAT, SPA and QR within the A15 budget. With the families' provisional
 * parameters (a = 1.0 for every item, 3PL c = 1/4 for 4-option rotation, A9) and ≈ 5 min per CAT
 * axis (6–13 items), a first session gives r = .815 / .798 / .743 (MAT / SPA / QR) at N = 300
 * and .831 / .813 / .766 at N = 2,000, in line with DESIGN §7.6's projected session-1 SE of
 * ≈ 0.57. r ≥ .85 on all three needs about a 45-minute session; DESIGN §14.3's "at 20 items/axis"
 * (≈ 48 min) passes at N = 2,000 (.903 / .868 / .905, the slow test). The r floor below guards
 * against regressions meanwhile.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { AXIS_INDEX, N_AXES } from '../engine/axes'
import simText from '../engine/__fixtures__/sim_m14a_v1.json?raw'
import type { Observation } from '../engine/types'
import { A15_TARGET_S, COVERAGE_FLOOR } from '../engine/selector'
import { resolveItem } from '../tasks/registry'
import { A15_MAX_S, BLOCK_AXES, CAT_AXES, administeredB, observedAxes, runCat, sessionSeedOf, simulateSession, targetingR, type CatRun } from './cat'
import type { M14aFixture } from './m14a'
import { catAcceptanceFailures, formatCat } from './report'
import { SPAN_FAMILIES } from './responders'
import { COVERAGE_HI, COVERAGE_LO, R_MIN } from './stats'

const FIXTURE = JSON.parse(simText) as M14aFixture
const THETAS = FIXTURE.simulees.map((s) => s[0])
/** The fast test's sample size (marked: the full run is N = 2,000, `scripts/sim-cat.slow.test.ts`). */
const N_FAST = 300
/**
 * Regression floor of r on the CAT axes at the A15 budget, well below the measured values: it
 * catches a broken scorer or a selector serving the wrong axis, NOT the acceptance (R_MIN). Nor
 * does it catch a selector blind to the responses: with the provisional a = 1.0 items and ≈ 5 min
 * per axis such a selector gives about the same r (M1.4b review); {@link TARGETING_MIN} does.
 */
const R_FLOOR_A15 = 0.7
/**
 * Minimum r(mean administered b, θ) on each CAT axis: the selector must target difficulty to the
 * person (§7.4). Measured .66 / .53 / .45 (MAT / SPA / QR, N = 300); a selector blind to the
 * responses (the in-session posterior replaced by the prior; M1.4b review mutation) gives
 * .16 / .01 / −.05 and fails this test.
 */
const TARGETING_MIN = 0.3

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

  it("charges each block the taker's own time and moves the difference into the next CAT segment", () => {
    expect(s.timeS).toBeCloseTo(s.blocks.reduce((t, b) => t + b.time_s, 0) + s.catTimeS, 9)
    expect(s.blocks.some((b) => Math.abs(b.time_s - b.expected_time_s) > 1)).toBe(true) // not the planned E[T]
    // The last CAT segment (QR) gets the target minus every earlier step's actual time and the later
    // blocks' E[T], and stops with less than one item's time unused; so the session ends at the
    // target plus what the blocks after it (coding, reading) overran, minus that unused time.
    const trailing = s.blocks.filter((b) => b.family === 'coding' || b.family === 'reading').reduce((t, b) => t + b.time_s - b.expected_time_s, 0)
    const unused = A15_TARGET_S + trailing - s.timeS
    expect(unused).toBeGreaterThanOrEqual(-1e-9)
    expect(unused).toBeLessThan(80)
    const short = simulateSession(theta, 'unit-session', { targetS: 15 * 60 })
    expect(short.itemIds.length).toBeLessThan(s.itemIds.length)
  })

  it('a high-WM taker runs longer span blocks and so has less time for QR', () => {
    const wm = AXIS_INDEX.WM
    const lo = simulateSession(theta.map((v, k) => (k === wm ? -2.5 : v)), 'unit-wm')
    const hi = simulateSession(theta.map((v, k) => (k === wm ? 2.5 : v)), 'unit-wm')
    const spanTime = (r: typeof s): number => r.blocks.filter((b) => SPAN_FAMILIES.has(b.family)).reduce((t, b) => t + b.time_s, 0)
    expect(spanTime(hi)).toBeGreaterThan(spanTime(lo) + 120)
    const qrTime = (r: typeof s): number => r.itemIds.map((id) => resolveItem(id)!).filter((i) => i.axis === 'QR').reduce((t, i) => t + i.expected_time_s, 0)
    expect(qrTime(hi)).toBeLessThan(qrTime(lo))
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

describe('targetingR', () => {
  const sess = (axis: 'MAT' | 'QR', bs: readonly number[]): { observations: Observation[] } => ({
    observations: bs.map((b) => ({ kind: '2pl', axis, a: 1, b, y: 1 })),
  })
  const th = (v: number): number[] => Array.from({ length: N_AXES }, (_, k) => (k === AXIS_INDEX.MAT ? v : 0))

  it('is 1 when the difficulty given follows θ, ≈ 0 when it ignores θ, and skips sessions without items', () => {
    const thetas = [-2, -1, 0, 1, 2].map(th)
    expect(targetingR(thetas, [-2, -1, 0, 1, 2].map((v) => sess('MAT', [v - 0.5, v + 0.5])), 'MAT')).toBeCloseTo(1, 12)
    expect(targetingR(thetas, [0.3, -0.2, 0.4, -0.3, 0.1].map((v) => sess('MAT', [v])), 'MAT')).toBeLessThan(0.5)
    const withGap = [sess('MAT', [-2]), sess('QR', [5]), sess('MAT', [0]), sess('MAT', [1]), sess('MAT', [2])]
    expect(targetingR(thetas, withGap, 'MAT')).toBeCloseTo(1, 12)
    expect(targetingR(thetas, withGap, 'SPA')).toBeNaN()
    expect(administeredB(withGap[1]!, 'QR')).toEqual([5])
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

  it("every session's simulated time is within A15's 25–30 min, around the 27.5-min target", () => {
    expect(run.timeS.max).toBeLessThanOrEqual(A15_MAX_S)
    expect(run.timeS.min).toBeGreaterThanOrEqual(25 * 60)
    expect(Math.abs(run.timeS.mean - A15_TARGET_S)).toBeLessThan(60)
    // time is the taker's, not charged by construction: slow blocks carry some sessions past the target
    expect(run.overTarget).toBeGreaterThan(0)
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

  it('every fixed block yields its observation', () => {
    expect(Object.keys(run.blockObserved).sort()).toEqual([...BLOCK_ORDER].sort())
    expect(Object.values(run.blockObserved).every((p) => p === 1)).toBe(true)
  })

  // MAT and SPA always reach the §7.4 session-1 floor of 3 items. QR does not always: it follows
  // the span blocks, and a high-WM taker's longer span blocks can use up its time (the selector
  // stops on time before the floor, M1.14). Measured 5.3% of sessions (N = 300); a follow-up for
  // M1.15's session clock. Bounded here so it cannot grow unnoticed.
  it('MAT and SPA always get the coverage floor; QR misses it only after span blocks overran', () => {
    expect(run.floorShort.MAT).toBe(0)
    expect(run.floorShort.SPA).toBe(0)
    expect(run.itemsPerAxis.MAT!.min).toBeGreaterThanOrEqual(COVERAGE_FLOOR)
    expect(run.itemsPerAxis.SPA!.min).toBeGreaterThanOrEqual(COVERAGE_FLOOR)
    expect(run.floorShort.QR).toBeLessThan(0.1)
    for (const s of run.sessions) {
      if ((s.items.QR ?? 0) >= COVERAGE_FLOOR) continue
      const spanOver = s.blocks.filter((b) => SPAN_FAMILIES.has(b.family)).reduce((t, b) => t + b.time_s - b.expected_time_s, 0)
      expect(spanOver, s.sessionSeed).toBeGreaterThan(60)
    }
  })

  it(`the selector adapts: r(mean administered b, θ) ≥ ${TARGETING_MIN} on every CAT axis`, () => {
    for (const k of CAT_AXES) expect(run.targeting[k], k).toBeGreaterThanOrEqual(TARGETING_MIN)
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
