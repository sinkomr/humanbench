/**
 * Difficulty and time priors of the paper-folding family (ROADMAP M1.P, DESIGN §3 row 7, §6.ii, §7.4).
 *
 * [SPEC] v0 linear regression, provisional until M4 calibration (σ_b = 1.0):
 *
 *     b = −2.25 + 1.25 · (n_folds − 1) + 0.5 · (n_punches − 1) + 0.0625 · holes
 *         + 1.25 · diagonal + 0.25 · near_miss + 0.125 · (grid − 4)
 *
 * - n_folds (1–3): each fold doubles the layers to carry back through the unfolding, the main driver
 *   of paper-folding difficulty (Ekstrom et al. 1976, VZ-2; Burte et al. 2017 and Harris et al. 2021:
 *   accuracy falls and time rises with the number of folds).
 * - n_punches (1–3) and holes (= 2^n_folds · n_punches): more holes to place and to compare across
 *   the options.
 * - diagonal: a fold along a diagonal line (a triangle results), the hardest fold to carry back
 *   (Harris et al. 2021: diagonal and asymmetric folds are harder than vertical/horizontal halves).
 * - near_miss: every distractor has the key's number of holes, so counting removes none of them.
 * - grid (+0.25 for 6 × 6): more slots to tell apart and to name, a small effect.
 *
 * Every coefficient is a multiple of 1/16 and every feature an integer, so b is an exact binary
 * fraction (no rounding in either repo). It is never clamped in practice (b spans −2.125 … 3.5 over
 * the generated configurations; `clampPrior` is applied anyway). Paper folding has no ICAR anchor (ICAR
 * has no folding items), so the anchor is set from the strata the design asks for (DESIGN §3 row 7;
 * the scope-variety brief). The generator enumerates every configuration it uses and files it under
 * the stratum of its b (`gen.ts`), so a stratum is always the default band of the item's b (M1.P):
 *
 *     stratum | configurations (sheet, folds f with D = a diagonal, punches p, lures)        | b
 *     1       | 4×4 or 6×6, f1, p1                                                          | −2.125 … −1.625
 *     2       | f1 p2–3; f1D p1; 4×4 f2 p1 mixed                                            | −1.5 … −0.625
 *     3       | f2 p1–2; f1D p2–3; 6×6 f1 p3 near                                           | −0.5 … 0.375
 *     4       | 4×4 f3 p1; f2D p1; f1D p3; 6×6 f2 p2–3                                      | 0.5 … 1.25
 *     5       | 6×6: f3D p1 mixed; f2D p2; f2D p3 mixed                                     | 1.5 … 2.25
 *     6       | 6×6: f3D p1 near; f3D p2; f2D p3 near                                       | 2.5 … 3.5
 *
 * (48 classes, `gen.ts` FOLDING_CLASSES; on a 4 × 4 sheet three folds with a diagonal leave one inner
 * slot, which the "one inner slot stays unpunched" rule excludes.)
 *
 * Expected time [SPEC] v0: E[T] = 20 s + 10 s per fold + 5 s per punch (35–65 s), in place of the
 * length-based §7.4 default (the stem is fixed; the work is in the folds and the holes).
 */

import { SIGMA_B_DEFAULT, clampPrior, linearB, type LinearPriorModel } from '../priors'
import type { FoldingFeatures } from './spec'

export const FOLDING_PRIOR: LinearPriorModel = Object.freeze({
  anchorB: -2.25,
  terms: Object.freeze({
    n_folds: Object.freeze({ beta: 1.25, centre: 1 }),
    n_punches: Object.freeze({ beta: 0.5, centre: 1 }),
    holes: Object.freeze({ beta: 0.0625, centre: 0 }),
    diagonal: Object.freeze({ beta: 1.25, centre: 0 }),
    near_miss: Object.freeze({ beta: 0.25, centre: 0 }),
    grid: Object.freeze({ beta: 0.125, centre: 4 }),
  }),
})

export const FOLDING_SD_PRIOR = SIGMA_B_DEFAULT

export const FOLDING_PROVENANCE =
  '[SPEC] v0: b = -2.25 + 1.25(n_folds - 1) + 0.5(n_punches - 1) + 0.0625 holes + 1.25 diagonal + 0.25 near_miss + 0.125(grid - 4); ' +
  'sd 1.0; no ICAR anchor (set from the design strata); provisional until M4 calibration'

/** b prior of an item with these features. */
export function foldingBPrior(f: Pick<FoldingFeatures, 'n_folds' | 'n_punches' | 'holes' | 'diagonal' | 'near_miss' | 'grid'>): number {
  return clampPrior(linearB(FOLDING_PRIOR, f))
}

export const FOLDING_TIME_BASE_S = 20
export const FOLDING_TIME_PER_FOLD_S = 10
export const FOLDING_TIME_PER_PUNCH_S = 5

/** [SPEC] v0 E[T] in seconds: 20 + 10 · n_folds + 5 · n_punches (35–65 s). */
export function foldingExpectedTime(nFolds: number, nPunches: number): number {
  return FOLDING_TIME_BASE_S + FOLDING_TIME_PER_FOLD_S * nFolds + FOLDING_TIME_PER_PUNCH_S * nPunches
}
