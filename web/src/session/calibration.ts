/**
 * The optional confidence scale and calibration (ROADMAP M1.15; DESIGN §3 row 12, §7.1 "Calibration", §14.6
 * ex. 9; `tasks/priors.ts` CAL_NORMS).
 *
 * Every counted power question carries an optional scale for how sure the person is that the answer is
 * right, on the question screen itself (owner decision 2026-10-13: no step of its own after the answer).
 * It offers {@link CONFIDENCE_LEVELS} points from the chance level 1/k for a k-option multiple-choice item
 * ("a guess") to 100% ("certain"), and from 0 for typed entry (a wrong entry is not a lucky guess). It
 * starts unset; an answer given with it unset is recorded without a confidence (null), never with a default. The Brier score of an answer is (c − y)² with c the
 * stated confidence in [0, 1] and y the outcome. What the rated answers of a session mean (the
 * summary and the calibration observation) is `tasks/calibration.ts`, shared with the save's
 * re-score.
 */

/** How many points the scale offers, from the floor to 100% (owner decision 2026-10-13: one tap sets it). */
export const CONFIDENCE_LEVELS = 5

/**
 * The lowest confidence the scale offers, in percent: 0 for typed entry (`optionsCount`
 * undefined), else the chance level 100/k rounded up, so a stated confidence is never below 1/k.
 */
export function confidenceFloorPct(optionsCount: number | undefined): number {
  if (optionsCount === undefined) return 0
  if (!(Number.isInteger(optionsCount) && optionsCount >= 2)) throw new RangeError(`confidenceFloorPct(): options count must be an integer ≥ 2, got ${optionsCount}`)
  return Math.ceil(100 / optionsCount)
}

/**
 * The points of the scale for a floor of `floorPct`, in whole percent: {@link CONFIDENCE_LEVELS} points evenly
 * spaced from the floor to 100, both included (0, 25, 50, 75, 100 for typed entry; 25, 44, 63, 81, 100 with
 * four options). Strictly increasing for every floor below 100.
 */
export function confidenceLevels(floorPct: number): number[] {
  if (!(Number.isInteger(floorPct) && floorPct >= 0 && floorPct < 100)) throw new RangeError(`confidenceLevels(): floor must be a whole percent from 0 to 99, got ${floorPct}`)
  const n = CONFIDENCE_LEVELS - 1
  return Array.from({ length: CONFIDENCE_LEVELS }, (_, i) => Math.round(floorPct + ((100 - floorPct) * i) / n))
}

/**
 * True iff `pct` is a confidence the session records for a floor of `floorPct`: a whole percent from the floor
 * to 100 (the scale offers {@link confidenceLevels}; saves made with the earlier slider hold any whole percent).
 */
export function isConfidencePct(pct: unknown, floorPct: number): pct is number {
  return typeof pct === 'number' && Number.isInteger(pct) && pct >= floorPct && pct <= 100
}

/** Brier score of one answer: (c − y)² with c = pct / 100. */
export function brierOfAnswer(pct: number, correct: 0 | 1): number {
  const c = pct / 100
  return (c - correct) * (c - correct)
}
