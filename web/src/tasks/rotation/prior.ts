/**
 * Difficulty and time priors of the mental-rotation family (ROADMAP M1.P, DESIGN §4.2, §6.ii, §7.4).
 *
 * [SPEC] v0 regression, provisional until M4 calibration (σ_b = 1.0):
 *
 *     b = b_ICAR(rotation) + 0.025 · (angle_deg − 138)
 *
 * - Anchor: ICAR rotation mean p = .19 → b = −logit(.19) ≈ 1.45 (`ICAR_ANCHOR_B.rotation`).
 * - Angle: +0.025 per degree of angular disparity (Shepard & Metzler 1971: RT and errors grow
 *   with angle), centred at 138° so that the default stratum bands (`STRATUM_B_CUTS`) cut the
 *   angle range at ≈ 20°, 60°, 100°, 140°, 180°: strata 2–5 are the angle bins
 *   20–60°, 60–100°, 100–140°, 140–180° ({@link ANGLE_BINS}). The exact cuts are 4·10⁻⁴° lower
 *   (the anchor is 1.45001), so the generator also checks `stratumOfB(b) = stratum`.
 * - Recorded but not (yet) in b: in-depth vs picture-plane axis, cube and arm counts, and the
 *   distractor mix (mirror-of-moved vs moved); M4 fits them.
 *
 * Expected time [SPEC] v0: E[T] = 20 s + angle_deg / 9, i.e. 20–40 s over 0–180° (RT linear in
 * angle, Shepard & Metzler 1971), in place of the length-based §7.4 default.
 */

import type { Stratum } from '../ids'
import { ICAR_ANCHOR_B, SIGMA_B_DEFAULT, clampPrior, linearB, type LinearPriorModel } from '../priors'
import type { RotationFeatures } from './spec'

/** Strata this family generates (angle bins, see {@link ANGLE_BINS}). */
export const ROTATION_STRATA: readonly Stratum[] = Object.freeze([2, 3, 4, 5] as const)

export type RotationStratum = 2 | 3 | 4 | 5

/** [SPEC] v0 angle bins [lo, hi) in degrees per stratum. */
export const ANGLE_BINS: Readonly<Record<RotationStratum, readonly [number, number]>> = Object.freeze({
  2: [20, 60],
  3: [60, 100],
  4: [100, 140],
  5: [140, 180],
})

export const ANGLE_BETA_PER_DEG = 0.025
export const ANGLE_CENTRE_DEG = 138

/** [SPEC] v0 prior model (see the module comment). */
export const ROTATION_PRIOR: LinearPriorModel = Object.freeze({
  anchorB: ICAR_ANCHOR_B.rotation,
  terms: Object.freeze({ angle_deg: Object.freeze({ beta: ANGLE_BETA_PER_DEG, centre: ANGLE_CENTRE_DEG }) }),
})

export const ROTATION_SD_PRIOR = SIGMA_B_DEFAULT

export const ROTATION_PROVENANCE =
  '[SPEC] v0: b = b_ICAR(rotation, p=.19 → 1.45) + 0.025·(angle_deg − 138); sd 1.0; ' +
  'depth axis, cube/arm counts and distractor mix recorded for M4 calibration'

/** b prior of an item with these features. */
export function rotationBPrior(features: Pick<RotationFeatures, 'angle_deg'>): number {
  return clampPrior(linearB(ROTATION_PRIOR, features))
}

export const EXPECTED_TIME_BASE_S = 20
export const EXPECTED_TIME_DEG_PER_S = 9

/** [SPEC] v0 E[T] in seconds: 20 + angle / 9 (20–40 s over 0–180°). */
export function rotationExpectedTime(angleDeg: number): number {
  return EXPECTED_TIME_BASE_S + angleDeg / EXPECTED_TIME_DEG_PER_S
}

/** Hard time limit per item (§12 example). */
export const ROTATION_TIME_LIMIT_S = 60
