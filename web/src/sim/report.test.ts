/**
 * M1.4b acceptance checks and tables (`report.ts`) on synthetic runs: which criterion applies to
 * which axis, r ≥ .85 only at 20 items/axis (the user's decision of 2026-09-29) and merely reported
 * within the A15 budget, the time rule only for A15 runs, the verdict lines, and the CAT-vs-Python
 * rows.
 */

import { describe, expect, it } from 'vitest'
import { AXIS_CODES } from '../engine/axes'
import { CAT_AXES, M1_ITEMS_PER_AXIS } from './cat'
import type { M14aAxisResult } from './m14a'
import { catAcceptanceFailures, catRAxes, catVsPython, formatCat } from './report'
import { FAKE_OBSERVED as OBSERVED, fakeCatRun as fakeRun } from './testing'

describe('catAcceptanceFailures', () => {
  it('passes a run that meets every criterion', () => {
    expect(catAcceptanceFailures(fakeRun())).toEqual([])
    expect(formatCat(fakeRun())).toMatch(/: PASS$/)
  })

  it('applies r ≥ .85 only to the CAT axes and coverage only to observed axes, at 20 items/axis', () => {
    const run = fakeRun({ QR: { r: 0.84 }, WM: { r: 0.5, coverage: 0.96 }, LR: { coverage: 0.2 } }, { fixedLength: M1_ITEMS_PER_AXIS })
    expect(catAcceptanceFailures(run)).toEqual(['QR: r = 0.840 < 0.85', 'WM: 90% coverage 0.960 outside [0.85, 0.95]'])
    expect(catAcceptanceFailures(run, { rAxes: ['MAT'] })).toEqual(['WM: 90% coverage 0.960 outside [0.85, 0.95]'])
    expect(catAcceptanceFailures(fakeRun({ SPA: { r: Number.NaN } }, { fixedLength: 20 }))).toEqual(['SPA: r = NaN < 0.85'])
    expect(catAcceptanceFailures(fakeRun({ MAT: { r: 0.85 } }, { fixedLength: 20 }))).toEqual([]) // the bound is inclusive
  })

  // ROADMAP M1.4b, user decision 2026-09-29: the criterion is r ≥ .85 at 20 items/axis (DESIGN
  // §14.3). Within the A15 budget (6–13 items per axis) r is reported, not judged.
  it('holds only a run of ≥ 20 items/axis to r ≥ .85; the A15-budget r (and a shorter fixed length) is informational', () => {
    const lowR = { MAT: { r: 0.815 }, SPA: { r: 0.798 }, QR: { r: 0.743 } }
    expect(M1_ITEMS_PER_AXIS).toBe(20) // DESIGN §14.3 M1 acceptance 2
    expect(catRAxes(fakeRun(lowR))).toEqual([])
    expect(catAcceptanceFailures(fakeRun(lowR))).toEqual([]) // A15 run: time and coverage still hold
    expect(catRAxes(fakeRun(lowR, { fixedLength: 19 }))).toEqual([])
    expect(catAcceptanceFailures(fakeRun(lowR, { fixedLength: 19 }))).toEqual([])
    for (const fixedLength of [20, 25]) {
      expect(catRAxes(fakeRun(lowR, { fixedLength }))).toEqual(CAT_AXES)
      expect(catAcceptanceFailures(fakeRun(lowR, { fixedLength }))).toEqual(['MAT: r = 0.815 < 0.85', 'SPA: r = 0.798 < 0.85', 'QR: r = 0.743 < 0.85'])
    }
    // the A15 run's other criteria still fail it, and an explicit rAxes still judges r
    expect(catAcceptanceFailures(fakeRun(lowR, { timeS: { min: 1600, mean: 1700, max: 1900 } }))).toEqual(['time: max session 31.67 min > budget 30.00 min'])
    expect(catAcceptanceFailures(fakeRun(lowR), { rAxes: ['QR'] })).toEqual(['QR: r = 0.743 < 0.85'])
    expect(catAcceptanceFailures(fakeRun({ WM: { coverage: 0.5 } }))).toEqual(['WM: 90% coverage 0.500 outside [0.85, 0.95]'])
  })

  // catRAxes() goes by the requested length; the run itself must have delivered it (the selector
  // can run dry), or r "at 20 items/axis" would be claimed for fewer items.
  it('fails a fixed-length run whose least-served session got fewer items than the length r is judged at', () => {
    const spread = (min: number, max: number) => ({ min, mean: (min + max) / 2, max })
    const ok = spread(20, 20)
    const dry = fakeRun({}, { fixedLength: 20, itemsPerAxis: { MAT: ok, SPA: spread(19, 20), QR: spread(0, 20) } })
    expect(catAcceptanceFailures(dry)).toEqual([
      'SPA: only 19 items in the least-served session, fewer than the 20 items/axis r is judged at',
      'QR: only 0 items in the least-served session, fewer than the 20 items/axis r is judged at',
    ])
    expect(catAcceptanceFailures(fakeRun({}, { fixedLength: 20, itemsPerAxis: { MAT: ok, SPA: ok } }))).toEqual([
      'QR: only 0 items in the least-served session, fewer than the 20 items/axis r is judged at', // no entry at all
    ])
    expect(catAcceptanceFailures(fakeRun({}, { fixedLength: 20, itemsPerAxis: { MAT: ok, SPA: ok, QR: ok } }))).toEqual([])
    // items are checked where r is judged: not for the A15 run (its length is the time), nor a length under 20
    expect(catAcceptanceFailures(fakeRun({}, { itemsPerAxis: { MAT: spread(1, 5), SPA: ok, QR: ok } }))).toEqual([])
    expect(catAcceptanceFailures(fakeRun({}, { fixedLength: 4, itemsPerAxis: { MAT: spread(1, 4), SPA: ok, QR: ok } }))).toEqual([])
    expect(formatCat(dry)).toMatch(/^acceptance \(.*: FAIL$/m)
  })

  it("checks an A15 run's simulated time against A15's upper end (30 min), not a fixed-length run's", () => {
    expect(catAcceptanceFailures(fakeRun({}, { timeS: { min: 1600, mean: 1700, max: 1800 } }))).toEqual([]) // over the 27.5 target, within 30
    const late = { timeS: { min: 1600, mean: 1700, max: 1830 } }
    expect(catAcceptanceFailures(fakeRun({}, late))).toEqual(['time: max session 30.50 min > budget 30.00 min'])
    expect(catAcceptanceFailures(fakeRun({}, late), { budgetS: 1830 })).toEqual([])
    expect(catAcceptanceFailures(fakeRun({}, { ...late, fixedLength: 20 }))).toEqual([])
  })

  it('reports targeting, coverage-floor shortfalls and the share over the target', () => {
    const text = formatCat(fakeRun())
    expect(text).toContain('selector targeting, r(mean administered b, θ): MAT 0.60, SPA 0.50, QR 0.55')
    expect(text).toContain('sessions under the 3-item coverage floor: MAT 0.0%, SPA 0.0%, QR 5.0%')
    expect(text).toContain('min (min / mean / max): 26.7 / 27.3 / 28.3; over the 27.5-min target 50.0%; CAT part 15.0 mean')
    expect(text).toContain('every session ≤ 30.0 min')
    expect(formatCat(fakeRun({}, { fixedLength: 20 }))).not.toContain('over the')
  })

  it('formats the verdict with every failure', () => {
    const text = formatCat(fakeRun({ MAT: { r: 0.8 } }, { fixedLength: 20 }))
    expect(text).toContain('fixed length 20 items per CAT axis (no time limit)')
    expect(text).toContain('CAT items per axis (min / mean / max): MAT 20 / 20.0 / 20, SPA 20 / 20.0 / 20, QR 20 / 20.0 / 20')
    expect(formatCat(fakeRun())).toContain('MAT 10 / 10.0 / 10, SPA 12 / 12.0 / 12, QR 6 / 6.0 / 6') // an A15 run: what the budget allowed
    expect(text).toContain('(no data: borrowing via Σ only)')
    expect(text).toContain('acceptance (r ≥ 0.85 on MAT/SPA/QR; cov90 in [0.85, 0.95] where observed): FAIL')
    expect(text).not.toContain('informational')
    expect(text.split('\n').slice(-2)).toEqual([expect.stringMatching(/: FAIL$/), '  FAIL MAT: r = 0.800 < 0.85'])
  })

  it('reports the A15-budget r as informational, and judges only time and coverage', () => {
    const run = fakeRun({ MAT: { r: 0.815 }, SPA: { r: 0.798 }, QR: { r: 0.743 } })
    const text = formatCat(run)
    expect(text).toContain('r within the A15 time budget is informational, not an acceptance criterion (r ≥ 0.85 is required at 20 items/axis, DESIGN §14.3): MAT 0.815, SPA 0.798, QR 0.743')
    expect(text).toContain('acceptance (cov90 in [0.85, 0.95] where observed; every session ≤ 30.0 min): PASS')
    expect(text).not.toContain('FAIL')
    expect(text.split('\n').slice(-2)[0]).toMatch(/^r within the A15/) // reported just before the verdict
    // a late session still fails the A15 run's verdict
    const late = formatCat(fakeRun({ MAT: { r: 0.815 } }, { timeS: { min: 1600, mean: 1700, max: 1900 } }))
    expect(late.split('\n').slice(-2)).toEqual([expect.stringMatching(/: FAIL$/), '  FAIL time: max session 31.67 min > budget 30.00 min'])
    // a fixed length under 20 says so; the explicit rAxes option brings the criterion back
    expect(formatCat(fakeRun({ QR: { r: 0.7 } }, { fixedLength: 4 }))).toContain('r at 4 items per axis is informational')
    // the caller's own empty rAxes on a run of 20 items/axis does not read as "not a criterion"
    const none = formatCat(fakeRun({ QR: { r: 0.7 } }, { fixedLength: 20 }), { rAxes: [] })
    expect(none).toContain('r at 20 items per axis is not judged here (the caller passed rAxes: []): MAT 0.900, SPA 0.900, QR 0.700')
    expect(none).not.toContain('informational')
    expect(none.split('\n').slice(-1)[0]).toMatch(/: PASS$/)
    const forced = formatCat(fakeRun({ QR: { r: 0.7 } }), { rAxes: ['QR'] })
    expect(forced).not.toContain('informational')
    expect(forced.split('\n').slice(-2)).toEqual([expect.stringMatching(/^acceptance \(r ≥ 0\.85 on QR;.*: FAIL$/), '  FAIL QR: r = 0.700 < 0.85'])
  })
})

describe('catVsPython (the CAT r next to the Python M1.4a r; a comparison, not parity)', () => {
  const py: M14aAxisResult[] = AXIS_CODES.map((code, i) => ({ code, r: 0.8 + i / 100, rmse: 0.4, mean_sd: 0.4, coverage: 0.9, model: '2pl', n_obs: 20 }))

  it('gives r_CAT − r_Python for every observed axis, in canonical order', () => {
    const run = fakeRun({ MAT: { r: 0.8 }, SPA: { r: 0.95 } })
    const rows = catVsPython(run, py)
    expect(rows.map((r) => r.code)).toEqual(AXIS_CODES.filter((c) => OBSERVED.includes(c)))
    const mat = rows.find((r) => r.code === 'MAT')!
    expect(mat).toEqual({ code: 'MAT', r_cat: 0.8, r_py: 0.8, delta: 0 })
    const spa = rows.find((r) => r.code === 'SPA')!
    expect(spa.delta).toBeCloseTo(0.95 - py.find((a) => a.code === 'SPA')!.r, 12)
    for (const r of rows) expect(r.delta).toBeCloseTo(r.r_cat - r.r_py, 12)
  })

  it('throws when the Python results lack an observed axis', () => {
    expect(() => catVsPython(fakeRun(), py.filter((a) => a.code !== 'QR'))).toThrow(/QR/)
  })

  it('shows the Python r and the signed gap on each observed axis, and says it is not parity', () => {
    const run = fakeRun({ QR: { r: 0.9 } })
    const text = formatCat(run, {}, catVsPython(run, py))
    const qrPy = py.find((a) => a.code === 'QR')!.r
    expect(text).toMatch(new RegExp(`^QR .*CAT   python r ${qrPy.toFixed(3)}  Δr \\+${(0.9 - qrPy).toFixed(3)}$`, 'm'))
    expect(text).toMatch(/^RT .*block   python r \S+  Δr [+−]\d\.\d{3}$/m)
    expect(text).toContain('not a twin; parity is part a')
    expect(text).not.toMatch(/^LR .*python r/m)
    expect(formatCat(run)).not.toContain('python r')
  })
})
