/**
 * θ-recovery statistics of a simulation run (ROADMAP M1.4a/M1.4b; DESIGN §14.3 M1 acceptance 2).
 * The TS twin of the bank's `hb.calib.simulate.recovery_stats`: per axis, Pearson r(θ̂, θ), RMSE,
 * the mean posterior SD and the coverage of the 90% intervals θ̂ ± z_.95·SD.
 */

import { AXIS_CODES, N_AXES, type AxisCode } from '../engine/axes'

/** Nominal level of the reported intervals (M1.4a: 90%). */
export const COVERAGE_LEVEL = 0.9
/**
 * z_.95 = Φ⁻¹(0.95), the half-width of a 90% interval in posterior SDs: the bank's `Z_COVERAGE`
 * (scipy `ndtri(0.95)`) to the bit, so coverage counts match the Python run exactly.
 */
export const Z_COVERAGE = 1.644853626951472
/** Acceptance: r(θ̂, θ) ≥ .85 (§14.3 M1 acceptance 2, ROADMAP M1.4a/b). */
export const R_MIN = 0.85
/** Acceptance: 90% coverage within [0.85, 0.95] (ROADMAP M1.4a/b). */
export const COVERAGE_LO = 0.85
export const COVERAGE_HI = 0.95

/** Recovery statistics of one axis. */
export interface AxisRecovery {
  readonly code: AxisCode
  /** Pearson r(θ̂, θ); NaN when either column is constant. */
  readonly r: number
  readonly rmse: number
  /** Mean posterior SD. */
  readonly mean_sd: number
  /** Share of simulees with θ inside θ̂ ± z_.95·SD (nominal 0.90). */
  readonly coverage: number
}

/** Pearson correlation of two equal-length samples (two-pass, centred sums). */
export function pearson(x: readonly number[], y: readonly number[]): number {
  if (x.length !== y.length) throw new RangeError(`pearson(): lengths differ (${x.length} vs ${y.length})`)
  const n = x.length
  if (n < 2) throw new RangeError('pearson(): need at least 2 points')
  let mx = 0
  let my = 0
  for (let i = 0; i < n; i++) {
    mx += x[i]!
    my += y[i]!
  }
  mx /= n
  my /= n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx
    const dy = y[i]! - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  return sxy / Math.sqrt(sxx * syy)
}

function column(rows: readonly (readonly number[])[], k: number): number[] {
  return rows.map((r, i) => {
    const v = r[k]
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new RangeError(`row ${i}, axis ${k}: not a finite number`)
    return v
  })
}

/**
 * Per-axis recovery statistics of n simulees: `theta`, `thetaHat` and `sd` are n × K rows in the
 * canonical axis order (K = 17). Throws a RangeError on ragged or non-finite input or n < 2.
 */
export function recoveryStats(theta: readonly (readonly number[])[], thetaHat: readonly (readonly number[])[], sd: readonly (readonly number[])[]): AxisRecovery[] {
  const n = theta.length
  if (n < 2) throw new RangeError('recoveryStats(): need at least 2 simulees')
  if (thetaHat.length !== n || sd.length !== n) throw new RangeError('recoveryStats(): theta, thetaHat and sd need the same number of rows')
  for (const rows of [theta, thetaHat, sd]) {
    for (const r of rows) if (r.length !== N_AXES) throw new RangeError(`recoveryStats(): every row needs ${N_AXES} axes`)
  }
  return AXIS_CODES.map((code, k) => {
    const t = column(theta, k)
    const h = column(thetaHat, k)
    const s = column(sd, k)
    let se = 0
    let sumSd = 0
    let covered = 0
    for (let i = 0; i < n; i++) {
      const err = h[i]! - t[i]!
      se += err * err
      sumSd += s[i]!
      if (Math.abs(err) <= Z_COVERAGE * s[i]!) covered++
    }
    return { code, r: pearson(h, t), rmse: Math.sqrt(se / n), mean_sd: sumSd / n, coverage: covered / n }
  })
}
