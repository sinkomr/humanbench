/**
 * Difficulty and time priors of the cube-net family (ROADMAP M1.P, DESIGN §3 row 7, §4.2, §6.ii,
 * §7.4).
 *
 * [SPEC] v0 regression, provisional until M4 calibration (σ_b = 1.0); no ICAR anchor (ICAR has no
 * cube-net items), so the anchor places the easiest items in stratum 1:
 *
 *     b = −1.65 + 1.2 · n_mirror + 0.2 · net_hard + 0.1 · (key_spread − 2)
 *
 * - `n_mirror` (0–3): the number of mirror distractors (three marks of a real corner, all pairwise
 *   adjacent, in the reversed turn). An opposite-pair distractor is rejected by finding one pair
 *   of marks that face each other on the cube, often visible on the net (two squares with one
 *   between them in a straight line); a mirror distractor can only be rejected by working out the
 *   turn of three faces round a corner, the handedness judgement that makes mirror-image
 *   distractors the hard ones in spatial visualisation tests (surface development and mental
 *   rotation: Shepard & Feng 1972, mental paper folding; Ekstrom et al. 1976, Surface Development
 *   VZ-3; Vandenberg & Kuse 1978). +1.2 per mirror distractor.
 * - `net_hard`: a net without a row of four ("231", "222", "33": 5 of the 11 nets) +0.2. In a "141"
 *   net the four-row wraps round the cube in one direction and three of the four opposite pairs
 *   can be read off as squares two apart in a line; the other nets need more folds to imagine
 *   (Shepard & Feng 1972: time grows with the squares carried in each fold).
 * - `key_spread` (2–5): the largest number of hinges between two of the key's three squares on
 *   the net. +0.1 per hinge above 2 (the three squares are then not an L round one corner square,
 *   and the solver must carry a face through more folds).
 *
 * Ranges (never clamped): n_mirror = 0 → −1.65 … −1.15 (strata 1–2: only opposite-pair
 * distractors), 1 → −0.45 … 0.05 (stratum 3), 2 → 0.75 … 1.25 (stratum 4), 3 → 1.95 … 2.45
 * (stratum 5: only mirror distractors). Every b is ≥ 0.05 from a band cut (`STRATUM_B_CUTS`),
 * so float rounding never moves an item across a stratum. No stratum 6: four options of which
 * three are mirror views is the hardest form of this task, and calling it expert-level would be a
 * claim without data. The natural pool draws n_mirror uniformly from 0–3, so it spreads over
 * strata 1–5 (≈ 10 / 15 / 25 / 25 / 25%).
 *
 * Recorded but not in b: `layout` (pairs / singles, for n_mirror = 1), `net_class`, `n_opposite`.
 *
 * Expected time [SPEC] v0: E[T] = 20 s + 9 s · n_mirror + 3 s · net_hard + 3 s · (key_spread − 2),
 * whole seconds, 20–59 s (each mirror distractor needs its own turn check; long-range folds take
 * longer), in place of the length-based §7.4 default. The cap is the shared 180 s (`powerTimeLimit`).
 */

import type { Stratum } from '../ids'
import { SIGMA_B_DEFAULT, clampPrior, linearB, type LinearPriorModel } from '../priors'
import type { CubenetFeatures } from './spec'

export const CUBENET_PRIOR: LinearPriorModel = Object.freeze({
  anchorB: -1.65,
  terms: Object.freeze({
    n_mirror: Object.freeze({ beta: 1.2, centre: 0 }),
    net_hard: Object.freeze({ beta: 0.2, centre: 0 }),
    key_spread: Object.freeze({ beta: 0.1, centre: 2 }),
  }),
})

export const CUBENET_SD_PRIOR = SIGMA_B_DEFAULT

export const CUBENET_PROVENANCE =
  '[SPEC] v0: b = -1.65 + 1.2·n_mirror + 0.2·net_hard + 0.1·(key_spread − 2) (mirror distractors need a ' +
  'handedness judgement; nets without a row of four and widely spread key faces need more folds); sd 1.0; ' +
  'layout, net_class recorded for M4 calibration'

/** The strata this family makes (1–5, see the module comment). */
export const CUBENET_STRATA: readonly Stratum[] = Object.freeze([1, 2, 3, 4, 5] as const)

/** The mirror-distractor count of the items of each stratum. */
export const MIRRORS_OF_STRATUM: Readonly<Record<number, number>> = Object.freeze({ 1: 0, 2: 0, 3: 1, 4: 2, 5: 3 })

/** b prior of an item with these features. */
export function cubenetBPrior(f: Pick<CubenetFeatures, 'n_mirror' | 'net_hard' | 'key_spread'>): number {
  return clampPrior(linearB(CUBENET_PRIOR, { n_mirror: f.n_mirror, net_hard: f.net_hard, key_spread: f.key_spread }))
}

export const CUBENET_TIME_BASE_S = 20
export const CUBENET_TIME_PER_MIRROR_S = 9
export const CUBENET_TIME_HARD_NET_S = 3
export const CUBENET_TIME_PER_HINGE_S = 3

/** [SPEC] v0 E[T] in whole seconds (20–59 s). */
export function cubenetExpectedTime(f: Pick<CubenetFeatures, 'n_mirror' | 'net_hard' | 'key_spread'>): number {
  return (
    CUBENET_TIME_BASE_S +
    CUBENET_TIME_PER_MIRROR_S * f.n_mirror +
    (f.net_hard ? CUBENET_TIME_HARD_NET_S : 0) +
    CUBENET_TIME_PER_HINGE_S * (f.key_spread - 2)
  )
}
