/**
 * Calibration from rated answers (ROADMAP M1.15; DESIGN §3 row 12, §7.1 "Calibration", §14.6 ex. 9;
 * `priors.ts` CAL_NORMS). The optional confidence scale itself is the session flow's (`session/calibration.ts`);
 * what a set of rated answers means is here, because both the running session and the save's
 * re-score (`save/rescore.ts`) turn them into the same observation.
 *
 * The Brier score of an answer is (c − y)² with c the stated confidence in [0, 1] and y the
 * outcome; a session's calibration is the mean Brier score over its rated answers, entered as the
 * Gaussian observation x = −B on θ_CAL once at least `CAL_NORMS.min_responses` (10) answers were rated.
 * No score is shown for a single answer.
 *
 * Rating is optional (owner decision 2026-10-13): an answer given with the scale unset has a null
 * `confidence_pct` and is not a rated answer; it is never given a default value. So the calibration is
 * over the rated answers only, and a session with fewer than ten of them leaves Calibration "not measured"
 * (why ten: `priors.ts` CAL_NORMS). Saves made with the earlier follow-up slider score the same way.
 */

import type { Observation } from '../engine/types'
import { gaussianObservationSigma } from './family'
import { CAL_NORMS, brierScore, brierStandardError, calibrationParams } from './priors'

/** One rated answer. */
export interface RatedAnswer {
  /** Stated confidence, percent. */
  readonly pct: number
  readonly correct: 0 | 1
}

export interface CalibrationSummary {
  /** Rated answers. */
  readonly n: number
  /** Mean Brier score B (0 is perfect; 0.25 is "always 50%" on coin flips). */
  readonly brier: number
  /** Mean confidence, 0–1. */
  readonly mean_confidence: number
  /** Share correct among the rated answers, 0–1. */
  readonly accuracy: number
  /** Calibration in the large: mean confidence − accuracy (positive = more sure than right). */
  readonly in_the_large: number
}

/** The summary of rated answers, or null with none. */
export function calibrationSummary(answers: readonly RatedAnswer[]): CalibrationSummary | null {
  if (answers.length === 0) return null
  const c = answers.map((a) => a.pct / 100)
  const y = answers.map((a) => a.correct)
  const n = answers.length
  const mean = c.reduce((s, v) => s + v, 0) / n
  const acc = y.reduce<number>((s, v) => s + v, 0) / n
  return { n, brier: brierScore(c, y), mean_confidence: mean, accuracy: acc, in_the_large: mean - acc }
}

/**
 * The session's calibration observation (`CAL_NORMS`, provisional until M4.8): x = −B with
 * sigma = √(SE² + τ_res²), where SE is the session's own standard error of B. Null below
 * `CAL_NORMS.min_responses` rated answers.
 */
export function calibrationObservation(answers: readonly RatedAnswer[]): Extract<Observation, { kind: 'gaussian' }> | null {
  if (answers.length < CAL_NORMS.min_responses) return null
  const c = answers.map((a) => a.pct / 100)
  const y = answers.map((a) => a.correct)
  const params = calibrationParams()
  return {
    kind: 'gaussian',
    axis: 'CAL',
    lam: params.lam,
    d: params.d,
    sigma: gaussianObservationSigma(brierStandardError(c, y), params),
    x: -brierScore(c, y),
  }
}
