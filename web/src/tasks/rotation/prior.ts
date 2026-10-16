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
 *
 * **Torsion template** (generator 1.4.0, requested strata 5 and 6 only; ROADMAP M3.12). The
 * classic items above stay exactly as they were (the natural pool and strata 2–4 are 1.3.0's code
 * path). A torsion item adds to the same angle term the effect of what makes it hard:
 *
 *     b = b_ICAR + 0.025 · (angle_deg − 100) + 0.75 + 0.10 · oblique
 *         + 0.05 · (n_cubes − 10) + 0.10 · (n_arms − 5)
 *
 * - +0.75, distractor similarity: the two non-mirror distractors are one-joint torsion variants
 *   with every arm length of the target, so no count of cubes or arms removes them and each of the
 *   four options needs a full comparison. Classic items lose half their options to counting (the
 *   moved pair) and become a two-way mirror judgement; MRT-A-style items whose distractors are
 *   mirror images or structurally similar shapes are the hard ones (Vandenberg & Kuse 1978;
 *   Peters et al. 1995), and error rates rise with distractor similarity (Bethell-Fox & Shepard
 *   1988; Yuille & Steiger 1982).
 * - +0.10, oblique axis (45°–75° from the line of sight, spec.ts `OBLIQUE_MIN_COS`): neither a
 *   picture-plane turn nor a turn in depth about an axis in the picture (Parsons 1987).
 * - +0.05 per cube above 10 (10–14) and +0.10 per arm above 5 (5–7): figure complexity, more
 *   segments to carry through the turn (Bethell-Fox & Shepard 1988: complexity matters unless the
 *   figure can be rotated as one familiar unit; Shepard & Metzler figures have 3–5 arms).
 *
 * The bonuses total 0.85–1.25. The correct option's angle is drawn uniformly in the part of the
 * torsion range {@link HARD_ANGLE_RANGE} = 70–140° whose b lies in the requested stratum's band
 * ({@link hardAngleBin}), so stratum 5 holds 70–92…108° and stratum 6 92…108–140°, and b spans
 * ≈ 1.6–3.7 (never clamped). Expected time [SPEC] v0 for torsion items: E[T] = 35 s +
 * angle_deg / 6 + 2 s per cube above 10, ≈ 47–66 s (more segments and a longer turn take longer;
 * the classic slope 1/9 s per degree is for 8–10 cubes with the counting shortcut), so the cap
 * stays the shared 180 s (`powerTimeLimit`).
 */

import type { Stratum } from '../ids'
import { ICAR_ANCHOR_B, SIGMA_B_DEFAULT, STRATUM_B_CUTS, clampPrior, linearB, stratumOfB, type LinearPriorModel } from '../priors'
import type { HardRotationFeatures, RotationFeatures } from './spec'

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

// --- the torsion template (generator 1.4.0, requested strata 5 and 6) ---------------------------

/** Strata whose requested items are drawn from the torsion template (1.4.0; classic in 1.3.0). */
export const HARD_STRATA: readonly Stratum[] = Object.freeze([5, 6] as const)

/** The correct option's angles [lo, hi) in degrees for torsion items (large, never near 0° or 180°). */
export const HARD_ANGLE_RANGE: readonly [number, number] = Object.freeze([70, 140] as const)

/** b added for the one-joint torsion distractor pair (distractor similarity; see the module comment). */
export const HARD_TORSION_B = 0.75
/** b added for an oblique rotation axis. */
export const HARD_OBLIQUE_B = 0.1
/** b added per cube above {@link HARD_CUBE_CENTRE}. */
export const HARD_CUBE_B = 0.05
export const HARD_CUBE_CENTRE = 10
/** b added per arm above {@link HARD_ARM_CENTRE}. */
export const HARD_ARM_B = 0.1
export const HARD_ARM_CENTRE = 5

export const ROTATION_HARD_PROVENANCE =
  '[SPEC] v0 torsion template (M3.12): b = b_ICAR(rotation, p=.19 → 1.45) + 0.025·(angle_deg − 100) + 0.75 ' +
  '(one-joint torsion distractors sharing every arm length) + 0.10·oblique + 0.05·(n_cubes − 10) + 0.10·(n_arms − 5); ' +
  'sd 1.0; angle 70–140°'

/** The features the torsion prior reads. */
export type HardPriorFeatures = Pick<HardRotationFeatures, 'angle_deg' | 'oblique' | 'n_cubes' | 'n_arms'>

/** The torsion template's b terms other than the angle (0.85–1.25 for generated items). */
export function hardBonus(f: Pick<HardPriorFeatures, 'oblique' | 'n_cubes' | 'n_arms'>): number {
  return HARD_TORSION_B + (f.oblique ? HARD_OBLIQUE_B : 0) + HARD_CUBE_B * (f.n_cubes - HARD_CUBE_CENTRE) + HARD_ARM_B * (f.n_arms - HARD_ARM_CENTRE)
}

/** b prior of a torsion item: the classic angle term plus {@link hardBonus}, clamped. */
export function rotationHardBPrior(f: HardPriorFeatures): number {
  return clampPrior(linearB(ROTATION_PRIOR, { angle_deg: f.angle_deg }) + hardBonus(f))
}

/**
 * The angles [lo, hi) of {@link HARD_ANGLE_RANGE} whose torsion b (with this bonus) lies in the
 * stratum's default band, or null if none do. The generator draws the correct option's angle and
 * the distractors' angles uniformly in it (redrawing a float-edge draw whose band differs).
 */
export function hardAngleBin(stratum: Stratum, bonus: number): readonly [number, number] | null {
  const at = (b: number): number => angleOfB(b - bonus)
  const cuts = [-Infinity, ...STRATUM_B_CUTS, Infinity]
  const lo = Math.max(HARD_ANGLE_RANGE[0], at(cuts[stratum - 1] as number))
  const hi = Math.min(HARD_ANGLE_RANGE[1], at(cuts[stratum] as number))
  return lo < hi ? [lo, hi] : null
}

export const ROTATION_HARD_TIME_BASE_S = 35
export const ROTATION_HARD_TIME_DEG_PER_S = 6
export const ROTATION_HARD_TIME_PER_CUBE_S = 2

/** [SPEC] v0 E[T] of a torsion item: 35 s + angle / 6 + 2 s per cube above 10 (≈ 47–66 s). */
export function rotationHardExpectedTime(angleDeg: number, nCubes: number): number {
  return ROTATION_HARD_TIME_BASE_S + angleDeg / ROTATION_HARD_TIME_DEG_PER_S + ROTATION_HARD_TIME_PER_CUBE_S * (nCubes - HARD_CUBE_CENTRE)
}
