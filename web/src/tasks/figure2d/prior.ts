/**
 * Difficulty and time priors of the figure2d family (ROADMAP M1.P; DESIGN §4.2, §6.ii, §7.4). Every coefficient is a
 * dyadic rational, and every feature an integer or a flag, so b is exact in binary floating point (the bank twin gets
 * the same bits) and a stratum edge is never a rounding question.
 *
 * [SPEC] v0, provisional until M4 calibration (σ_b = 1.0). Not an ICAR-anchored family (no pool-mean anchor).
 *
 * Task 'rotate' ("which option is the figure turned in the plane, not flipped over?"):
 *
 *     b = −3 + turn_deg / 64 + 0.3125 · (n_squares − 5) + 0.5 · off_axis + 1.0 · hard_variant
 *
 * - turn_deg (15–180): the angular disparity between the target and the key as drawn. Errors and response times grow
 *   with the angle through which a figure must be turned in mind (Shepard & Metzler 1971; Cooper & Shepard 1973 for
 *   letters and 2D shapes), up to 180°: +2.8 over the range.
 * - n_squares (5–11): more squares to carry through the turn (figure complexity; Bethell-Fox & Shepard 1988).
 * - off_axis: the key is drawn tilted (turn not a multiple of 90°), so its squares no longer line up with the target's
 *   rows and columns, and every option is tilted alike.
 * - hard_variant: the moved variant V keeps the figure's squares per row and per column (up to turning and flipping),
 *   so no count tells the pair {target turned, its mirror} from {V, mirror V} and every option needs a full comparison
 *   (distractor similarity; Vandenberg & Kuse 1978). Possible only from 7 squares (exhaustive count).
 *
 * Task 'mirror' ("which option is the figure's mirror image in the dashed line?"):
 *
 *     b = −2.75 + 0.5 · (n_squares − 6) + 2.0 · diagonal + 0.5 · set_pairs + 1.25 · set_near_turn
 *
 * - diagonal: a mirror line at 45° is much harder to reflect in than a vertical or horizontal one (mirror symmetry
 *   about the vertical axis is the easiest to see, then horizontal, then oblique; Wagemans 1995, Palmer & Hemenway 1978).
 * - set_pairs / set_near_turn: the distractor set (`spec.ts` MIRROR_SETS). `basic` (the other-line reflection, the
 *   figure itself, the figure turned) needs only the right reflection; `pairs` adds a one-square-moved copy of the key
 *   and its mirror image, so the shape has to be checked square by square; `near_turn` adds the moved key and its
 *   180° turn beside the other-line reflection, the two hardest confusions together (+1.25).
 *
 * Both tasks reach every stratum 1–6 (`FIGURE2D_STRATA`): stratum 1 holds e.g. a 5-square figure turned 90° or a
 * 5–6-square one turned 15°–60°, or a 6–8-square figure mirrored in a vertical or horizontal line; stratum 6 a
 * 10–11-square figure turned 150°–180° with a hard variant, or a 10–11-square one mirrored in a diagonal line with moved
 * distractors. b spans −2.27 … 2.95 (rotate) and −2.75 … 3.0 (mirror), never clamped. Mirror figures start at 6
 * squares (`spec.ts` MIRROR_MIN_SQUARES), so the mirror anchor sits at 6.
 *
 * Expected time [SPEC] v0, seconds (§7.4; RT linear in angle and in figure complexity):
 *
 *     rotate:  E[T] = 14 + turn_deg / 16 + 2 · (n_squares − 5) + 4 · off_axis + 4 · hard_variant   (≈ 19–44 s)
 *     mirror:  E[T] = 14 + 2 · (n_squares − 6) + 8 · diagonal + 3 · set_pairs + 6 · set_near_turn     (14–38 s)
 *
 * so the cap is the shared 180 s (`powerTimeLimit`).
 */

import type { Stratum } from '../ids'
import { SIGMA_B_DEFAULT, clampPrior, linearB, stratumOfB, type LinearPriorModel } from '../priors'
import { HARD_VARIANT_MIN_SQUARES, MAX_SQUARES, MIN_SQUARES, MIRROR_MIN_SQUARES, MIRROR_SETS, type MirrorSet } from './spec'

export const ROTATE_PRIOR: LinearPriorModel = Object.freeze({
  anchorB: -3,
  terms: Object.freeze({
    turn_deg: Object.freeze({ beta: 1 / 64, centre: 0 }),
    n_squares: Object.freeze({ beta: 0.3125, centre: 5 }),
    off_axis: Object.freeze({ beta: 0.5, centre: 0 }),
    hard_variant: Object.freeze({ beta: 1, centre: 0 }),
  }),
})

export const MIRROR_PRIOR: LinearPriorModel = Object.freeze({
  anchorB: -2.75,
  terms: Object.freeze({
    n_squares: Object.freeze({ beta: 0.5, centre: 6 }),
    diagonal: Object.freeze({ beta: 2, centre: 0 }),
    set_pairs: Object.freeze({ beta: 0.5, centre: 0 }),
    set_near_turn: Object.freeze({ beta: 1.25, centre: 0 }),
  }),
})

export const FIGURE2D_SD_PRIOR = SIGMA_B_DEFAULT

export const ROTATE_PROVENANCE =
  '[SPEC] v0 figure2d rotate: b = -3 + turn_deg/64 + 0.3125*(n_squares - 5) + 0.5*off_axis + 1.0*hard_variant; sd 1.0'
export const MIRROR_PROVENANCE =
  '[SPEC] v0 figure2d mirror: b = -2.75 + 0.5*(n_squares - 6) + 2.0*diagonal + 0.5*set_pairs + 1.25*set_near_turn; sd 1.0'

/** The features the rotate prior reads. */
export interface RotatePriorInput {
  readonly turn_deg: number
  readonly n_squares: number
  readonly off_axis: boolean
  readonly hard_variant: boolean
}

/** The features the mirror prior reads. */
export interface MirrorPriorInput {
  readonly n_squares: number
  readonly diagonal: boolean
  readonly set_pairs: boolean
  readonly set_near_turn: boolean
}

export const rotateBPrior = (f: RotatePriorInput): number => clampPrior(linearB(ROTATE_PRIOR, { ...f }))
export const mirrorBPrior = (f: MirrorPriorInput): number => clampPrior(linearB(MIRROR_PRIOR, { ...f }))

export const rotateExpectedTime = (f: RotatePriorInput): number =>
  14 + f.turn_deg / 16 + 2 * (f.n_squares - 5) + (f.off_axis ? 4 : 0) + (f.hard_variant ? 4 : 0)

export const mirrorExpectedTime = (f: MirrorPriorInput): number =>
  14 + 2 * (f.n_squares - 6) + (f.diagonal ? 8 : 0) + (f.set_pairs ? 3 : 0) + (f.set_near_turn ? 6 : 0)

/** Angular disparities of the key, degrees: 15, 30, …, 180 (0 is left out: the key would be the target as drawn). */
export const TURN_DEGREES: readonly number[] = Object.freeze(Array.from({ length: 12 }, (_, i) => 15 * (i + 1)))

/** A task 'rotate' design point: the features a requested stratum is drawn from. */
export interface RotateCombo {
  readonly turn_deg: number
  readonly n_squares: number
  readonly hard_variant: boolean
}

/** A task 'mirror' design point. */
export interface MirrorCombo {
  readonly n_squares: number
  readonly diagonal: boolean
  readonly set: MirrorSet
}

export const offAxisOf = (turnDeg: number): boolean => turnDeg % 90 !== 0

export const rotateInput = (c: RotateCombo): RotatePriorInput => ({
  turn_deg: c.turn_deg,
  n_squares: c.n_squares,
  off_axis: offAxisOf(c.turn_deg),
  hard_variant: c.hard_variant,
})

export const mirrorInput = (c: MirrorCombo): MirrorPriorInput => ({
  n_squares: c.n_squares,
  diagonal: c.diagonal,
  set_pairs: c.set === 'pairs',
  set_near_turn: c.set === 'near_turn',
})

const SQUARE_COUNTS = Array.from({ length: MAX_SQUARES - MIN_SQUARES + 1 }, (_, i) => MIN_SQUARES + i)

/** Every rotate design point, in a fixed order (turn, squares, hard): hard variants only from 7 squares. */
export const ROTATE_COMBOS: readonly RotateCombo[] = Object.freeze(
  TURN_DEGREES.flatMap((turn_deg) =>
    SQUARE_COUNTS.flatMap((n_squares) =>
      [false, true].filter((h) => !h || n_squares >= HARD_VARIANT_MIN_SQUARES).map((hard_variant) => Object.freeze({ turn_deg, n_squares, hard_variant })),
    ),
  ),
)

/** Every mirror design point, in a fixed order (squares 6–11, diagonal, set). */
export const MIRROR_COMBOS: readonly MirrorCombo[] = Object.freeze(
  SQUARE_COUNTS.filter((n) => n >= MIRROR_MIN_SQUARES).flatMap((n_squares) => [false, true].flatMap((diagonal) => MIRROR_SETS.map((set) => Object.freeze({ n_squares, diagonal, set })))),
)

export const rotateComboStratum = (c: RotateCombo): Stratum => stratumOfB(rotateBPrior(rotateInput(c)))
export const mirrorComboStratum = (c: MirrorCombo): Stratum => stratumOfB(mirrorBPrior(mirrorInput(c)))

const ROTATE_BY_STRATUM = new Map<Stratum, readonly RotateCombo[]>()
const MIRROR_BY_STRATUM = new Map<Stratum, readonly MirrorCombo[]>()

/** The rotate design points of stratum k (the generator draws one uniformly; computed once per stratum). */
export function rotateCombosOf(k: Stratum): RotateCombo[] {
  let hit = ROTATE_BY_STRATUM.get(k)
  if (hit === undefined) ROTATE_BY_STRATUM.set(k, (hit = Object.freeze(ROTATE_COMBOS.filter((c) => rotateComboStratum(c) === k))))
  return [...hit]
}

/** The mirror design points of stratum k (computed once per stratum). */
export function mirrorCombosOf(k: Stratum): MirrorCombo[] {
  let hit = MIRROR_BY_STRATUM.get(k)
  if (hit === undefined) MIRROR_BY_STRATUM.set(k, (hit = Object.freeze(MIRROR_COMBOS.filter((c) => mirrorComboStratum(c) === k))))
  return [...hit]
}

/** The strata of the family: both tasks reach every one. */
export const FIGURE2D_STRATA: readonly Stratum[] = Object.freeze([1, 2, 3, 4, 5, 6] as const)
