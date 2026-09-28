/**
 * M1.4b acceptance checks and tables (`report.ts`) on synthetic runs: which criterion applies to
 * which axis, the time rule only for A15 runs, and the verdict lines.
 */

import { describe, expect, it } from 'vitest'
import { AXIS_CODES, type AxisCode } from '../engine/axes'
import type { Observation } from '../engine/types'
import type { CatRun, SessionResult } from './cat'
import { catAcceptanceFailures, formatCat } from './report'
import type { AxisRecovery } from './stats'

const OBSERVED: readonly AxisCode[] = ['MAT', 'QR', 'SPA', 'WM', 'RT', 'PS']
const obs: Observation[] = OBSERVED.map((axis) => ({ kind: 'gaussian', axis, lam: 1, d: 0, sigma: 1, x: 0 }))
const session = { observations: obs } as unknown as SessionResult
const spread = (v: number) => ({ min: v, mean: v, max: v })

function fakeRun(over: Partial<Record<AxisCode, Partial<AxisRecovery>>> = {}, extra: Partial<CatRun> = {}): CatRun {
  const axes = AXIS_CODES.map((code) => ({ code, r: OBSERVED.includes(code) ? 0.9 : 0.2, rmse: 0.4, mean_sd: 0.4, coverage: OBSERVED.includes(code) ? 0.9 : 0.5, ...over[code] }))
  return {
    n: 2,
    seed: 's',
    targetS: 1650,
    fixedLength: null,
    axes,
    itemsPerAxis: { MAT: spread(10), SPA: spread(12), QR: spread(6) },
    timeS: { min: 1600, mean: 1640, max: 1700 },
    catTimeS: spread(900),
    overTarget: 0.5,
    targeting: { MAT: 0.6, SPA: 0.5, QR: 0.55 },
    floorShort: { MAT: 0, SPA: 0, QR: 0.05 },
    blockObserved: { coding: 1 },
    segmentEnds: { time: 6 },
    sessions: [session, session],
    ...extra,
  }
}

describe('catAcceptanceFailures', () => {
  it('passes a run that meets every criterion', () => {
    expect(catAcceptanceFailures(fakeRun())).toEqual([])
    expect(formatCat(fakeRun())).toMatch(/: PASS$/)
  })

  it('applies r only to the CAT axes and coverage only to observed axes', () => {
    const run = fakeRun({ QR: { r: 0.84 }, WM: { r: 0.5, coverage: 0.96 }, LR: { coverage: 0.2 } })
    expect(catAcceptanceFailures(run)).toEqual(['QR: r = 0.840 < 0.85', 'WM: 90% coverage 0.960 outside [0.85, 0.95]'])
    expect(catAcceptanceFailures(run, { rAxes: ['MAT'] })).toEqual(['WM: 90% coverage 0.960 outside [0.85, 0.95]'])
    expect(catAcceptanceFailures(fakeRun({ SPA: { r: Number.NaN } }))).toEqual(['SPA: r = NaN < 0.85'])
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
    expect(text).toContain('CAT items per axis (min / mean / max): MAT 10 / 10.0 / 10, SPA 12 / 12.0 / 12, QR 6 / 6.0 / 6')
    expect(text).toContain('(no data: borrowing via Σ only)')
    expect(text.split('\n').slice(-2)).toEqual([expect.stringMatching(/: FAIL$/), '  FAIL MAT: r = 0.800 < 0.85'])
  })
})
