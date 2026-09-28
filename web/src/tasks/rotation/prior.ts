/**
 * Difficulty and time priors of the mental-rotation family (ROADMAP M1.P, DESIGN §4.2, §6.ii, §7.4).
 *
 * [SPEC] v0 regression, provisional until M4 calibration (σ_b = 1.0):
 *
 *     b = b_ICAR(rotation) + 0.025 · (angle_deg − 100)
 *
 * - Anchor (M1.P): ICAR rotation mean p = .19 → b = −logit(.19) ≈ 1.45 (`ICAR_ANCHOR_B.rotation`)
 *   is the POOL mean: the family's natural pool draws the correct option's angle uniformly from
 *   {@link ANGLE_RANGE} = 20–180°, whose mean is 100° ({@link ANGLE_CENTRE_DEG}), so the pool mean
 *   b is the anchor (before generator 1.3.0 the anchor sat at a 138° reference item and the pool
 *   mean was ≈ 0.5). p = .19 lies below the 1/4 guessing floor of this 4-option 3PL item (A9), so
 *   no b reproduces it under the item's own model; the anchor is a location on the §6.ii
 *   −logit(p) link only, and calibration replaces it.
 * - Angle: +0.025 per degree of angular disparity (Shepard & Metzler 1971: RT and errors grow
 *   with angle). b spans ≈ −0.55 … 3.45 over 20–180°, and the stratum is its default band
 *   (`stratumOfB`): strata 2–6 are the angle bins ≈ 20–22°, 22–62°, 62–102°, 102–142°, 142–180°
 *   ({@link ANGLE_BINS}, derived from the band cuts, so a bin and its band always agree).
 *   Stratum 2 is a 2° sliver: ≈ 1% of the natural pool, and a requested stratum 2 draws the key's
 *   and the distractors' angles all in 20–22° (valid, but thin). It stays in the strata because
 *   natural-pool items at 20–22° are stratum 2 by the M1.P rule. The natural pool's stratum mix
 *   follows the angle distribution (≈ 1 : 24 : 25 : 25 : 24 over 2–6), not the strata, so the
 *   M1.14 selector requests a stratum when it needs one.
 * - Recorded but not (yet) in b: in-depth vs picture-plane axis, cube and arm counts, and the
 *   distractor mix (mirror-of-moved vs moved); M4 fits them.
 *
 * Expected time [SPEC] v0: E[T] = 20 s + angle_deg / 9, i.e. 20–40 s over 0–180° (RT linear in
 * angle, Shepard & Metzler 1971), in place of the length-based §7.4 default.
 */

import type { Stratum } from '../ids'
import { ICAR_ANCHOR_B, SIGMA_B_DEFAULT, STRATUM_B_CUTS, clampPrior, linearB, stratumOfB, type LinearPriorModel } from '../priors'
import type { RotationFeatures } from './spec'

/** The angles of the correct option, [lo, hi) in degrees: the natural pool draws them uniformly (M1.P). */
export const ANGLE_RANGE: readonly [number, number] = Object.freeze([20, 180] as const)

export const ANGLE_BETA_PER_DEG = 0.025
/** The pool mean angle, (20 + 180) / 2: the regression's centre, where b is the ICAR anchor (M1.P). */
export const ANGLE_CENTRE_DEG = 100

/** [SPEC] v0 prior model (see the module comment). */
export const ROTATION_PRIOR: LinearPriorModel = Object.freeze({
  anchorB: ICAR_ANCHOR_B.rotation,
  terms: Object.freeze({ angle_deg: Object.freeze({ beta: ANGLE_BETA_PER_DEG, centre: ANGLE_CENTRE_DEG }) }),
})

export const ROTATION_SD_PRIOR = SIGMA_B_DEFAULT

export const ROTATION_PROVENANCE =
  '[SPEC] v0: b = b_ICAR(rotation, p=.19 → 1.45) + 0.025·(angle_deg − 100), the ICAR anchor at the pool ' +
  'mean angle (angles uniform on 20–180°, M1.P); sd 1.0; ' +
  'depth axis, cube/arm counts and distractor mix recorded for M4 calibration'

/** b prior of an item with these features. */
export function rotationBPrior(features: Pick<RotationFeatures, 'angle_deg'>): number {
  return clampPrior(linearB(ROTATION_PRIOR, features))
}

/** The angle whose unclamped b is `b` (the inverse of the angle term). */
export function angleOfB(b: number): number {
  return ANGLE_CENTRE_DEG + (b - ROTATION_PRIOR.anchorB) / ANGLE_BETA_PER_DEG
}

/**
 * [SPEC] v0 angle bins [lo, hi) per stratum: the part of {@link ANGLE_RANGE} whose b lies in the
 * stratum's default band (`STRATUM_B_CUTS`), so the bins are derived from the prior, never set
 * by hand. The generator also checks `stratumOfB(b) = stratum` on every draw (a bin edge is a
 * float, so the draw at an edge is redrawn rather than trusted).
 */
export const ANGLE_BINS: Readonly<Partial<Record<Stratum, readonly [number, number]>>> = (() => {
  const out: Partial<Record<Stratum, readonly [number, number]>> = {}
  const [lo, hi] = ANGLE_RANGE
  const edges = [-Infinity, ...STRATUM_B_CUTS.map(angleOfB), Infinity]
  for (let k = 1; k <= 6; k++) {
    const a = Math.max(lo, edges[k - 1] as number)
    const b = Math.min(hi, edges[k] as number)
    if (a < b) out[k as Stratum] = Object.freeze([a, b] as const)
  }
  return Object.freeze(out)
})()

/** Strata this family generates: those with a non-empty angle bin (2–6). */
export const ROTATION_STRATA: readonly Stratum[] = Object.freeze(
  (Object.keys(ANGLE_BINS).map(Number) as Stratum[]).sort((x, y) => x - y),
)

/** The stratum of an angle (the default band of its b). */
export function rotationStratumOf(angleDeg: number): Stratum {
  return stratumOfB(rotationBPrior({ angle_deg: angleDeg }))
}

/** Rotation-specific; not the shared length-based `EXPECTED_TIME_BASE_S` (25 s) of `../priors`. */
export const ROTATION_EXPECTED_TIME_BASE_S = 20
export const ROTATION_EXPECTED_TIME_DEG_PER_S = 9

/** [SPEC] v0 E[T] in seconds: 20 + angle / 9 (20–40 s over 0–180°). */
export function rotationExpectedTime(angleDeg: number): number {
  return ROTATION_EXPECTED_TIME_BASE_S + angleDeg / ROTATION_EXPECTED_TIME_DEG_PER_S
}
