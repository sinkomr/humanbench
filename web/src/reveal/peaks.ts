/**
 * Credible distinctive peaks (DESIGN §10 reveal flow "your most distinctive peaks (credible only)";
 * ROADMAP A12).
 *
 * A12: "Distinctive peaks use within-person contrasts θ_k − θ̄, whose 90% interval must exclude 0."
 * θ̄ is the person's own mean over the skills that were measured (never a skipped, unavailable or
 * unmeasured one: their borrowed estimates are not shown, §9.7). The contrast is a linear
 * function c'θ of the correlated posterior N(θ̂, Σ_post), c = e_k − (1/m)·1_M, so its variance is
 * exactly c'Σ_post c, which uses the covariances between skills: two skills that the data cannot
 * tell apart (a strongly correlated posterior) are not made to look different by noise.
 *
 * A peak is a contrast whose 90% interval lies above 0. Only peaks are reported (§10; R-5.6.4: no
 * lows are picked out). The mean itself is used inside the contrast and is never returned or shown
 * (CLAUDE.md: no single score across skills, §9.5 a). Contrasts sum to 0 over the measured
 * skills, so at most m − 1 of them can be peaks, and a person whose skills are all alike has none.
 *
 * This differs on purpose from the chart's muting rule (§9.5), which compares each skill with the
 * 0 SD ring of the population; a skill can be a peak of its owner's profile without being credibly
 * above 0 SD, and the copy says so (`copy.ts` PEAKS_NOTE).
 */

import { AXIS_INDEX, axis as axisDef, type AxisCode } from '../engine/axes'
import { Z90 } from '../viz/geometry'
import type { ProfileScore } from '../viz/profile'

/** Fewest measured skills to compare (with 2, "a peak" is just the higher of two). */
export const PEAKS_MIN_MEASURED = 3
/** Most peaks reported (§9.9: "3 top strengths" on the card). */
export const PEAKS_MAX = 3

export interface Contrast {
  readonly code: AxisCode
  readonly name: string
  /** θ_k − θ̄ in SD units. */
  readonly contrast: number
  /** √(c'Σc). */
  readonly sd: number
  readonly lo90: number
  readonly hi90: number
}

/**
 * θ_k − θ̄ with its posterior SD and 90% interval for every skill in `measured` (in that order),
 * θ̄ the mean over `measured`. Throws a RangeError on fewer than two skills, a repeated skill or a
 * score of the wrong shape.
 */
export function withinPersonContrasts(score: ProfileScore, measured: readonly AxisCode[]): Contrast[] {
  const m = measured.length
  if (m < 2) throw new RangeError('within-person contrasts need at least two measured skills')
  if (new Set(measured).size !== m) throw new RangeError('measured skills must be distinct')
  const idx = measured.map((k) => AXIS_INDEX[k])
  const theta = idx.map((i) => score.theta[i])
  const cov = (i: number, j: number): number => score.cov[idx[i]!]![idx[j]!]!
  if (theta.some((v) => !Number.isFinite(v))) throw new RangeError('score.theta must be finite on the measured skills')
  const mean = (theta as number[]).reduce((s, v) => s + v, 0) / m
  // (1/m²)·ΣΣ Σ_ij and the row sums (1/m)·Σ_j Σ_kj.
  const rowSums = idx.map((_, i) => idx.reduce((s, __, j) => s + cov(i, j), 0))
  const all = rowSums.reduce((s, v) => s + v, 0)
  return measured.map((code, i) => {
    const variance = cov(i, i) - (2 / m) * rowSums[i]! + all / (m * m)
    const sd = Math.sqrt(Math.max(0, variance)) // −1e-17 from rounding is 0
    const contrast = (theta[i] as number) - mean
    return { code, name: axisDef(code).name, contrast, sd, lo90: contrast - Z90 * sd, hi90: contrast + Z90 * sd }
  })
}

export interface PeakOptions {
  readonly max?: number
  readonly minMeasured?: number
}

/**
 * The credible distinctive peaks among `measured`: contrasts whose 90% interval excludes 0 from
 * above, strongest first (ties in canonical axis order), at most `max` (default {@link PEAKS_MAX}).
 * Empty when fewer than `minMeasured` (default {@link PEAKS_MIN_MEASURED}) skills were measured.
 */
export function distinctivePeaks(score: ProfileScore, measured: readonly AxisCode[], opts: PeakOptions = {}): Contrast[] {
  const max = opts.max ?? PEAKS_MAX
  if (measured.length < (opts.minMeasured ?? PEAKS_MIN_MEASURED)) return []
  return withinPersonContrasts(score, measured)
    .filter((c) => c.lo90 > 0)
    .sort((a, b) => b.contrast - a.contrast || AXIS_INDEX[a.code] - AXIS_INDEX[b.code])
    .slice(0, max)
}
