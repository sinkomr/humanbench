/**
 * The confidence slider and calibration (ROADMAP M1.15; DESIGN §3 row 12, §7.1 "Calibration", §14.6
 * ex. 9; `tasks/priors.ts` CAL_NORMS).
 *
 * Every counted power answer is followed by a slider for how sure the person is that the answer
 * is right. Its floor is the chance level 1/k for a k-option multiple-choice item and 0 for typed
 * entry (a wrong entry is not a lucky guess). The Brier score of an answer is (c − y)² with c the
 * stated confidence in [0, 1] and y the outcome; the session's calibration is the mean Brier score
 * over its rated answers, entered as the Gaussian observation x = −B on θ_CAL once at least
 * `CAL_NORMS.min_responses` answers were rated. No score is shown for a single answer.
 */

import type { ResponseTuple } from '../engine/types'
import type { Observation } from '../engine/types'
import { CAL_NORMS, brierScore, brierStandardError, calibrationParams } from '../tasks/priors'
import { gaussianObservationSigma } from '../tasks/family'

/** Slider step in percentage points. */
export const CONFIDENCE_STEP_PCT = 1

/**
 * The lowest confidence the slider offers, in percent: 0 for typed entry (`optionsCount`
 * undefined), else the chance level 100/k rounded up, so a stated confidence is never below 1/k.
 */
export function confidenceFloorPct(optionsCount: number | undefined): number {
  if (optionsCount === undefined) return 0
  if (!(Number.isInteger(optionsCount) && optionsCount >= 2)) throw new RangeError(`confidenceFloorPct(): options count must be an integer ≥ 2, got ${optionsCount}`)
  return Math.ceil(100 / optionsCount)
}

/** The slider's starting position: the middle of its range, on the step. */
export function confidenceStartPct(floorPct: number): number {
  return Math.round((floorPct + 100) / 2 / CONFIDENCE_STEP_PCT) * CONFIDENCE_STEP_PCT
}

/** True iff `pct` is an offered slider value for a floor of `floorPct`. */
export function isConfidencePct(pct: unknown, floorPct: number): pct is number {
  return typeof pct === 'number' && Number.isInteger(pct) && pct >= floorPct && pct <= 100
}

/** Brier score of one answer: (c − y)² with c = pct / 100. */
export function brierOfAnswer(pct: number, correct: 0 | 1): number {
  const c = pct / 100
  return (c - correct) * (c - correct)
}

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

/** The rated answers of a session's response tuples: those with a stored 0/1 `correct` and a confidence. */
export function ratedAnswersOf(responses: readonly ResponseTuple[]): RatedAnswer[] {
  const out: RatedAnswer[] = []
  for (const t of responses) {
    const correct = t[3]
    const pct = t[5]
    if ((correct === 0 || correct === 1) && pct !== null) out.push({ pct, correct })
  }
  return out
}
