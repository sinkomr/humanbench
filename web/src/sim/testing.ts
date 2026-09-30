/**
 * Test support for the M1.4b simulation modules: a synthetic {@link CatRun} whose numbers a test
 * sets directly (no simulation), so the acceptance checks, tables and CLI verdicts can be exercised
 * in milliseconds. SIMULATION SUPPORT ONLY: never imported by the app.
 */

import { AXIS_CODES, type AxisCode } from '../engine/axes'
import type { Observation } from '../engine/types'
import type { CatRun, SessionResult } from './cat'
import type { AxisRecovery } from './stats'

/** The axes a synthetic run has observations on (the M1 CAT and block axes). */
export const FAKE_OBSERVED: readonly AxisCode[] = ['MAT', 'QR', 'SPA', 'WM', 'RT', 'PS']

const obs: Observation[] = FAKE_OBSERVED.map((axis) => ({ kind: 'gaussian', axis, lam: 1, d: 0, sigma: 1, x: 0 }))
const session = { observations: obs } as unknown as SessionResult
const spread = (v: number) => ({ min: v, mean: v, max: v })

/**
 * A run that meets every criterion (r .9 and 90% coverage on the observed axes, sessions within
 * 30 min); `over` overrides per-axis recovery numbers, `extra` the run's own fields (for example
 * `fixedLength: 20`, which also gives every CAT axis exactly that many items unless `extra`
 * overrides `itemsPerAxis`).
 */
export function fakeCatRun(over: Partial<Record<AxisCode, Partial<AxisRecovery>>> = {}, extra: Partial<CatRun> = {}): CatRun {
  const axes = AXIS_CODES.map((code) => ({
    code,
    r: FAKE_OBSERVED.includes(code) ? 0.9 : 0.2,
    rmse: 0.4,
    mean_sd: 0.4,
    coverage: FAKE_OBSERVED.includes(code) ? 0.9 : 0.5,
    ...over[code],
  }))
  return {
    n: 2,
    seed: 's',
    targetS: 1650,
    fixedLength: null,
    axes,
    itemsPerAxis: extra.fixedLength == null ? { MAT: spread(10), SPA: spread(12), QR: spread(6) } : { MAT: spread(extra.fixedLength), SPA: spread(extra.fixedLength), QR: spread(extra.fixedLength) },
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
