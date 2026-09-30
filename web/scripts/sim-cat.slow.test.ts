/**
 * ROADMAP M1.4b at full size: all N = 2,000 M1.4a simulees. SLOW (about 7 minutes): skipped
 * unless `HB_SLOW=1`; run it with `npm run test:slow`. The fast versions are
 * `src/sim/m14a.test.ts` and `src/sim/cat.test.ts` (N = 300); `npm run sim:cat` prints the same
 * tables.
 *
 * - (a) the non-adaptive TS replication of M1.4a matches the Python r within 0.02 on every axis
 *   (in fact to rounding: the same people and the same scorer). This is ROADMAP M1.4b's "parity
 *   with Python within 0.02 on r".
 * - (b) the adaptive session with the real selector, scorer and families, under the A15 time
 *   rule: every session's simulated time within A15's 25–30 min, 90% coverage in [0.85, 0.95] on
 *   every observed axis, the selector targets difficulty to the person. Its r on MAT, SPA and QR
 *   (.831 / .813 / .766: 6–13 items per axis) is REPORTED, not asserted: the M1 criterion is r ≥
 *   .85 at 20 items/axis (user decision 2026-09-29, ROADMAP M1.4b option 1), which is (b').
 * - (b') the same with the DESIGN §14.3 M1 acceptance's fixed length of 20 items per CAT axis
 *   (no time limit, about 48 min): the ACCEPTANCE r ≥ .85 on MAT, SPA and QR and coverage as above
 *   (measured .903 / .868 / .905; at N = 300 SPA is .844, so this criterion is checked at full
 *   size only). Next to the Python M1.4a r on the same people (.931 / .918 / .890) the CAT r is
 *   within {@link CAT_PY_R_DROP_MAX} (a regression guard, not parity): M1.4a is a fixed 2PL form,
 *   the CAT serves the real families (SPA 3PL with c = 1/4, A9), so its r is a different design's.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { AXIS_INDEX } from '../src/engine/axes'
import { A15_TARGET_S, COVERAGE_FLOOR } from '../src/engine/selector'
import { A15_MAX_S, BLOCK_AXES, CAT_AXES, M1_ITEMS_PER_AXIS, observedAxes, runCat, type CatRun } from '../src/sim/cat'
import { PARITY_R_TOL, parity, pythonResults, runM14a } from '../src/sim/m14a'
import { CAT_PY_R_DROP_MAX, catAcceptanceFailures, catRAxes, catVsPython, formatCat, formatParity } from '../src/sim/report'
import { COVERAGE_HI, COVERAGE_LO, R_MIN } from '../src/sim/stats'
import { loadFixture } from './sim-cat'

const SLOW = process.env.HB_SLOW === '1'
const FIXTURE = loadFixture()
const N_FULL = 2000
const THETAS = FIXTURE.simulees.slice(0, N_FULL).map((s) => s[0])
const RUN_TIMEOUT = 20 * 60_000

function expectCoverage(run: CatRun): void {
  expect(observedAxes(run).sort()).toEqual([...CAT_AXES, ...BLOCK_AXES].sort())
  for (const k of observedAxes(run)) {
    const c = run.axes[AXIS_INDEX[k]]!.coverage
    expect(c, k).toBeGreaterThanOrEqual(COVERAGE_LO)
    expect(c, k).toBeLessThanOrEqual(COVERAGE_HI)
  }
}

describe.runIf(SLOW)(`M1.4b full run, N = ${N_FULL} (slow; npm run test:slow)`, () => {
  it(`(a) TS replication of M1.4a: per-axis r within ${PARITY_R_TOL} of Python on every axis`, () => {
    const run = runM14a(FIXTURE, N_FULL)
    const rows = parity(FIXTURE, run)
    console.log(formatParity(run, rows))
    expect(rows.filter((r) => !r.ok)).toEqual([])
    expect(Math.max(...rows.map((r) => r.diff))).toBeLessThan(1e-9)
  })

  describe('(b) adaptive session, A15 time rule (the CAT r is reported, not asserted)', () => {
    let run: CatRun
    beforeAll(() => {
      run = runCat(THETAS, { seed: 'm14b' })
      console.log(formatCat(run, {}, catVsPython(run, pythonResults(FIXTURE, N_FULL)!)))
    }, RUN_TIMEOUT)

    it("every session's simulated time within A15's 25–30 min; coverage in range on every observed axis; every block observed", () => {
      expect(run.timeS.max).toBeLessThanOrEqual(A15_MAX_S)
      expect(run.timeS.min).toBeGreaterThanOrEqual(25 * 60)
      expect(Math.abs(run.timeS.mean - A15_TARGET_S)).toBeLessThan(60)
      expectCoverage(run)
      expect(Object.values(run.blockObserved).every((p) => p === 1)).toBe(true)
      for (const k of BLOCK_AXES) expect(run.axes[AXIS_INDEX[k]]!.r, k).toBeGreaterThanOrEqual(R_MIN)
    })

    // ROADMAP M1.4b, user decision 2026-09-29: r ≥ .85 is asked at 20 items/axis (b'), so the
    // budget run's verdict (time and coverage) holds while its r (table above) is informational.
    it('the acceptance verdict is time and coverage only: no r criterion within the budget', () => {
      expect(catRAxes(run)).toEqual([])
      expect(catAcceptanceFailures(run)).toEqual([])
      expect(formatCat(run)).toMatch(/^r within the A15 time budget is informational/m)
    })

    it('the selector targets difficulty to the person; only QR (after the span blocks) can miss the coverage floor', () => {
      for (const k of CAT_AXES) expect(run.targeting[k], k).toBeGreaterThanOrEqual(0.3)
      expect(run.floorShort.MAT).toBe(0)
      expect(run.floorShort.SPA).toBe(0)
      expect(run.itemsPerAxis.SPA!.min).toBeGreaterThanOrEqual(COVERAGE_FLOOR)
      expect(run.floorShort.QR).toBeLessThan(0.1)
    })
  })

  describe("(b') fixed length of 20 items per CAT axis (DESIGN §14.3 M1 acceptance 2): the M1.4b criterion", () => {
    let run: CatRun
    beforeAll(() => {
      run = runCat(THETAS, { seed: 'm14b', fixedLength: M1_ITEMS_PER_AXIS })
      console.log(formatCat(run, {}, catVsPython(run, pythonResults(FIXTURE, N_FULL)!)))
    }, RUN_TIMEOUT)

    it(`acceptance: every CAT axis gets 20 items, r ≥ ${R_MIN} on MAT, SPA and QR, coverage in range`, () => {
      expect(catRAxes(run)).toEqual(CAT_AXES) // r is judged on this run
      for (const k of CAT_AXES) expect(run.itemsPerAxis[k], k).toEqual({ min: 20, mean: 20, max: 20 })
      for (const k of CAT_AXES) expect(run.axes[AXIS_INDEX[k]]!.r, k).toBeGreaterThanOrEqual(R_MIN)
      expectCoverage(run)
      expect(catAcceptanceFailures(run)).toEqual([])
      expect(formatCat(run)).toMatch(/^acceptance \(r ≥ 0\.85 on MAT\/SPA\/QR;.*: PASS$/m)
    })

    it(`the CAT r stays within ${CAT_PY_R_DROP_MAX} below the Python M1.4a r on MAT, SPA and QR (regression guard, not parity)`, () => {
      const rows = catVsPython(run, pythonResults(FIXTURE, N_FULL)!).filter((r) => CAT_AXES.includes(r.code))
      expect(rows).toHaveLength(CAT_AXES.length)
      for (const r of rows) expect(r.delta, r.code).toBeGreaterThanOrEqual(-CAT_PY_R_DROP_MAX)
    })
  })
})

describe.skipIf(SLOW)('M1.4b full run (slow)', () => {
  it.skip('skipped: set HB_SLOW=1 (npm run test:slow)', () => {})
})
