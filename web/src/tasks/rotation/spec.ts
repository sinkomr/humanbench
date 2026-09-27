/**
 * Wire types and constants of the mental-rotation family (DESIGN §4.2, §12; ROADMAP A9, A11).
 *
 * Render payload (`spec`): `{ target: { cubes, quat }, options: [{ cubes, quat }] × 4, camera }`.
 * - `cubes`: the shape's unit cubes as integer [x, y, z], translated to the min corner (0, 0, 0),
 *   in shuffled order. Each option is re-expressed in its own frame (a non-identity element of
 *   the 24-element group), so no option's cube list equals the target's.
 * - `quat`: the display orientation, a unit quaternion [w, x, y, z] (w ≥ 0) applied to the shape
 *   about its centre (Three.js: `new Quaternion(x, y, z, w)`).
 * - `camera`: {@link CAMERA_ISO_V1}, a fixed orthographic camera on the +(1, 1, 1) diagonal
 *   looking at the origin with +z up ({@link ISO_V1_VIEW_AXIS}). The renderer (M1.13) must use
 *   exactly this view: the `in_depth` feature measures rotation axes against its line of sight.
 *
 * Key (`key`): `{ index }`, the option that is the target rotated (never in `spec`).
 */

import type { ItemInstance } from '../family'
import type { Cube, Quat, Vec3 } from './geometry'

export const ROTATION_OPTIONS = 4
export const MIN_CUBES = 8
export const MAX_CUBES = 10
/** A well-formed view has at most this many cubes (bounds the verifier's work on garbage). */
export const MAX_VIEW_CUBES = 64

/** The fixed isometric camera of the polycube renderer. */
export const CAMERA_ISO_V1 = 'iso_v1'

/** Line of sight of {@link CAMERA_ISO_V1} (unit vector along +(1, 1, 1)). */
export const ISO_V1_VIEW_AXIS: Vec3 = Object.freeze([1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)] as const)

/**
 * A rotation is "in depth" when its axis is within 45° of the picture plane, i.e.
 * |axis · line of sight| < cos 45°; otherwise it is mostly a picture-plane rotation (§4.2).
 */
export const IN_DEPTH_MAX_COS = Math.SQRT1_2

/** |‖quat‖ − 1| allowed by the verifier. */
export const QUAT_NORM_TOL = 1e-9

/** Recorded vs recomputed float features (different code paths in TS and Python agree far closer). */
export const ANGLE_TOL_DEG = 1e-6
export const COS_TOL = 1e-9
export const PRIOR_TOL = 1e-9
export const TIME_TOL = 1e-9

/** A polycube as displayed: min-corner cubes and a display orientation. */
export interface PolycubeView {
  readonly cubes: readonly Cube[]
  readonly quat: Quat
}

export interface RotationSpec {
  readonly target: PolycubeView
  /** Four options in display order: the target rotated, its mirror image, two one-cube-moved variants. */
  readonly options: readonly PolycubeView[]
  readonly camera: typeof CAMERA_ISO_V1
}

export interface RotationKey {
  /** Index of the option that is the target rotated. */
  readonly index: number
}

/** The chosen option index. */
export type RotationResponse = number

export type RotationItem = ItemInstance<RotationSpec, RotationKey>

/** A11 structure: the target polycube up to rotation and reflection (enantiomers are isomorphs). */
export interface RotationStructure {
  readonly polycube: readonly Cube[]
}

/** How a distractor differs from the target (A11: exactly one pure mirror). */
export type DistractorKind = 'mirror' | 'moved' | 'mirror_moved'

/** Difficulty features (§4.2 drivers; only `angle_deg` enters the v0 prior, the rest are for M4). */
export interface RotationFeatures {
  /** Angular disparity between the target's and the correct option's display orientations, 0–180°. */
  readonly angle_deg: number
  /** |cos| between that rotation's axis and the camera's line of sight (1 = picture plane). */
  readonly axis_view_cos: number
  /** axis_view_cos < cos 45°: the rotation is mostly in depth. */
  readonly in_depth: boolean
  readonly n_cubes: number
  /** Arms (straight runs) of the target chain. */
  readonly n_arms: number
  /** One-cube-moved distractors of the target's handedness. */
  readonly n_moved: number
  /** Distractors that are the mirror image of a one-cube-moved variant. */
  readonly n_mirror_moved: number
}

export const FEATURE_NAMES: readonly (keyof RotationFeatures)[] = Object.freeze([
  'angle_deg',
  'axis_view_cos',
  'in_depth',
  'n_cubes',
  'n_arms',
  'n_moved',
  'n_mirror_moved',
])
