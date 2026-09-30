/**
 * The confidence slider and calibration (ROADMAP M1.15; DESIGN §3 row 12, §7.1 "Calibration", §14.6
 * ex. 9; `tasks/priors.ts` CAL_NORMS).
 *
 * Every counted power answer is followed by a slider for how sure the person is that the answer
 * is right. Its floor is the chance level 1/k for a k-option multiple-choice item and 0 for typed
 * entry (a wrong entry is not a lucky guess). The Brier score of an answer is (c − y)² with c the
 * stated confidence in [0, 1] and y the outcome. What the rated answers of a session mean (the
 * summary and the calibration observation) is `tasks/calibration.ts`, shared with the save's
 * re-score.
 */

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
