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
 * The acceptance (user decision 2026-09-29, ROADMAP M1.4b option 1) is DESIGN §14.3's: r ≥ .85 on
 * MAT, SPA and QR at 20 items/axis. That is the fixed-length run, asserted at full size in the slow
 * test (`npm run test:slow`, HB_SLOW; CI runs only `npm test`, so that criterion is checked only
 * when someone runs it, not on every push). At small N sampling error alone puts SPA near .84, so the
 * fast tier cannot hold it to .85; what it does hold, in the last describe below, is a REGRESSION
 * FLOOR on the same fixed-length design (r ≥ .80 at N = 150), so a broken finish scorer or
 * selector still fails `npm test`.
 *
 * The A15-budget run is accepted on time and coverage; its r is reported (the table printed
 * below), not asserted, since the budget gives only 6–13 items per CAT axis: with the
 * families' provisional parameters (a = 1.0 for every item, 3PL c = 1/4 for 4-option rotation, A9)
 * a first session gives r = .815 / .798 / .743 (MAT / SPA / QR) at N = 300 and .831 / .813 / .766
 * at N = 2,000, in line with DESIGN §7.6's projected session-1 SE of ≈ 0.57 (the precision Phase AI
 * builds on); r ≥ .85 on all three needs about a 45-minute session (.903 / .868 / .905 at 20
 * items/axis, N = 2,000).
 *
 * What holds and is asserted here: every session's simulated time is within A15's 25–30 min
 * (26.2–29.3 min at N = 300, 26.0–29.6 at N = 2,000, mean 27.3), 90% coverage is in [0.85, 0.95]
 * on every observed axis, every block yields its observation, the selector targets difficulty to
 * the person, MAT and SPA get the §7.4 coverage floor, and the block axes (WM, RT, PS) recover θ
 * with r ≥ .85. QR, which follows the span blocks, misses the floor in ≈ 5–6% of sessions
 * (high-WM takers whose longer span blocks use up its time): bounded here, a follow-up for
 * M1.15's session clock.
 *
 * ROADMAP M1.4b's "parity with Python within 0.02 on r" is the replication (a) (`m14a.test.ts`):
 * the Python side (M1.4a) is a fixed 2PL form, while this run serves the real families, so the CAT
 * r is only reported next to the Python r (`report.ts` catVsPython), not held to it.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { AXIS_INDEX, N_AXES } from '../engine/axes'
import simText from '../engine/__fixtures__/sim_m14a_v1.json?raw'
import type { Observation } from '../engine/types'
import { A15_TARGET_S, COVERAGE_FLOOR } from '../engine/selector'
import { resolveItem } from '../tasks/registry'
import { A15_MAX_S, BLOCK_AXES, CAT_AXES, M1_ITEMS_PER_AXIS, administeredB, observedAxes, runCat, sessionSeedOf, simulateSession, targetingR, type CatRun } from './cat'
import { pythonResults, type M14aFixture } from './m14a'
import { catAcceptanceFailures, catRAxes, catVsPython, formatCat } from './report'
import { SPAN_FAMILIES } from './responders'
import { COVERAGE_HI, COVERAGE_LO, R_MIN } from './stats'

const FIXTURE = JSON.parse(simText) as M14aFixture
const THETAS = FIXTURE.simulees.map((s) => s[0])
/** The fast test's sample size (marked: the full run is N = 2,000, `scripts/sim-cat.slow.test.ts`). */
const N_FAST = 300
/**
 * Minimum r(mean administered b, θ) on each CAT axis: the selector must target difficulty to the
 * person (§7.4). Measured .66 / .53 / .45 (MAT / SPA / QR, N = 300); a selector blind to the
 * responses (the in-session posterior replaced by the prior; M1.4b review mutation) gives
 * .16 / .01 / −.05 and fails this test. (The A15-budget r cannot tell such a selector apart: with
 * the provisional a = 1.0 items and ≈ 5 min per axis it gives about the same r.)
 */
const TARGETING_MIN = 0.3

/**
 * The fast tier's REGRESSION FLOOR on r at 20 items/axis (N_GUARD simulees), well under the
 * acceptance of R_MIN = .85 that only the full-size slow test holds: measured .904 / .844 / .921
 * (MAT / SPA / QR, N = 150). A finish MAP that ignores the QR items gives QR r ≈ .5–.6 and fails it.
 */
const R_FLOOR_FIXED = 0.8
const N_GUARD = 150

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
    console.log(formatCat(run, {}, catVsPython(run, pythonResults(FIXTURE, N_FAST)!)))
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

  it(`block axes recover θ with r ≥ ${R_MIN}`, () => {
    for (const k of BLOCK_AXES) expect(run.axes[AXIS_INDEX[k]]!.r, k).toBeGreaterThanOrEqual(R_MIN)
  })

  // ROADMAP M1.4b, user decision 2026-09-29: r ≥ .85 on MAT, SPA and QR is required at 20
  // items/axis (the fixed-length run, slow test), not within the A15 budget. Here r is REPORTED
  // (the table above; informational in `formatCat`), so the verdict is time and coverage only.
  it('the A15-budget acceptance is time and coverage (both pass); the CAT r is reported, not judged', () => {
    expect(catRAxes(run)).toEqual([])
    expect(catAcceptanceFailures(run)).toEqual([])
    const text = formatCat(run)
    expect(text).toMatch(/^r within the A15 time budget is informational, not an acceptance criterion \(r ≥ 0\.85 is required at 20 items\/axis/m)
    expect(text).toMatch(/: PASS$/)
    // reported for each CAT axis (finite and positive: the numbers mean something), never judged
    for (const k of CAT_AXES) {
      const r = run.axes[AXIS_INDEX[k]]!.r
      expect(Number.isFinite(r) && r > 0, k).toBe(true)
      expect(text, k).toContain(`${k} ${r.toFixed(3)}`)
    }
  })

  // Reported next to the Python M1.4a r on the same people, a different design (fixed 2PL form):
  // not held to it (module comment).
  it('the CAT r is reported next to the Python M1.4a r on every observed axis', () => {
    const rows = catVsPython(run, pythonResults(FIXTURE, N_FAST)!)
    expect(rows.map((r) => r.code).sort()).toEqual([...CAT_AXES, ...BLOCK_AXES].sort())
    for (const r of rows) expect(r.delta).toBeCloseTo(r.r_cat - r.r_py, 12)
    expect(formatCat(run, {}, rows)).toContain('python r')
  })
})

// The only fast-tier check that the CAT's items still drive θ recovery on MAT, SPA and QR. It is a
// regression floor, not the M1.4b acceptance (R_FLOOR_FIXED vs R_MIN; the acceptance is the slow
// test's), and says nothing about the A15-budget run above, whose r is reported, not asserted.
describe(`M1.4b (b) regression floor: fixed length of ${M1_ITEMS_PER_AXIS} items per CAT axis, N = ${N_GUARD} (fast)`, () => {
  let run: CatRun

  beforeAll(() => {
    run = runCat(THETAS.slice(0, N_GUARD), { seed: 'm14b', fixedLength: M1_ITEMS_PER_AXIS })
  }, 300_000)

  it('every session gives every CAT axis all 20 items, so this is the design r ≥ .85 is asked at', () => {
    expect(catRAxes(run)).toEqual(CAT_AXES)
    for (const k of CAT_AXES) expect(run.itemsPerAxis[k], k).toEqual({ min: M1_ITEMS_PER_AXIS, mean: M1_ITEMS_PER_AXIS, max: M1_ITEMS_PER_AXIS })
  })

  it(`the CAT items recover θ: r ≥ ${R_FLOOR_FIXED} on MAT, SPA and QR (a floor; ${R_MIN} is the slow test's)`, () => {
    for (const k of CAT_AXES) expect(run.axes[AXIS_INDEX[k]]!.r, k).toBeGreaterThanOrEqual(R_FLOOR_FIXED)
    expect(catAcceptanceFailures(run, { rMin: R_FLOOR_FIXED }).filter((f) => f.includes(' r = '))).toEqual([])
  })
})
