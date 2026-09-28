/**
 * Pure scene description of the mental-rotation renderer (ROADMAP M1.13, A3, A11; DESIGN §4.2
 * "Mental rotation" rendering, §12 `polycube_v1`). No Three.js here: this module turns a
 * {@link RotationSpec} into plain numbers (cube offsets, the display quaternion, the fixed
 * `iso_v1` camera, the lighting), so the geometry is unit-tested in Node without WebGL, and
 * `three-view.ts` (the only Three.js import) just draws what it is given.
 *
 * - **Figures.** A figure is its unit cubes centred on their centroid (cube c spans [c, c + 1],
 *   so its centre is c + ½), rotated by the view's `quat` about that centroid (spec.ts: "applied
 *   to the shape about its centre"). The centroid-centred circumradius is rotation-invariant, so
 *   every orientation of a shape fits the same frame.
 * - **One scale.** The target and the four options share one camera whose half-extent is the
 *   largest circumradius of the five (times {@link FRAME_MARGIN}): a cube is drawn the same size
 *   in every figure, so the size of a figure never hints at which option it is.
 * - **Camera `iso_v1`** (spec.ts {@link CAMERA_ISO_V1}): orthographic, on the +(1, 1, 1)
 *   diagonal looking at the origin, +z up. {@link ISO_BASIS} is the camera frame exactly as
 *   Three.js `lookAt` builds it (right = up × back, true up = back × right); the tests check it
 *   against Three.js.
 * - **Lighting** ({@link LIGHTING}) is fixed in the camera's frame (upper left, in front), so it
 *   is the same for every figure and every item: an ambient term plus one directional light,
 *   Lambert faces and unlit dark edges. {@link shade} is the linear-light factor Three.js applies
 *   to the face albedo (`three-view.ts` passes the intensities times π, because Three.js's
 *   Lambert BRDF divides by π).
 *
 * Nothing here depends on an option's position or on the key (the renderer never has the key):
 * each figure is a pure function of its own view, and the shared scale is a function of all five.
 */

import { mat3FromQuat, type Quat, type Vec3 } from '../../tasks/rotation/geometry'
import { CAMERA_ISO_V1, type PolycubeView, type RotationSpec } from '../../tasks/rotation/spec'

/** Half the space diagonal of a unit cube: a cube's corners are this far from its centre. */
export const CUBE_HALF_DIAGONAL = Math.sqrt(3) / 2

/** Frame half-extent = the largest circumradius of the item's figures × this (a small border). */
export const FRAME_MARGIN = 1.06

/** A figure ready to draw: centred cube offsets and the display rotation. */
export interface FigureScene {
  /** Cube centres relative to the figure's centroid, in the view's own frame (before `quat`). */
  readonly offsets: readonly Vec3[]
  /** The display rotation as spec.ts writes it, `[w, x, y, z]`. */
  readonly quat: Quat
  /** The same rotation in Three.js `Quaternion(x, y, z, w)` order. */
  readonly quaternionXyzw: readonly [number, number, number, number]
  /** Radius of the centroid-centred sphere that holds every cube corner (rotation-invariant). */
  readonly radius: number
}

/** The fixed orthographic camera of one item (every figure of the item uses it). */
export interface IsoCamera {
  readonly name: typeof CAMERA_ISO_V1
  readonly position: Vec3
  readonly up: Vec3
  readonly lookAt: Vec3
  /** Orthographic frustum: left = −h, right = h, bottom = −h, top = h (square canvases). */
  readonly halfExtent: number
  readonly near: number
  readonly far: number
}

export interface RotationScene {
  readonly target: FigureScene
  /** One figure per `spec.options` entry, in display order. */
  readonly options: readonly FigureScene[]
  readonly camera: IsoCamera
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
const unit = (a: Vec3): Vec3 => scale(a, 1 / norm(a))
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** World up of `iso_v1` (+z). */
export const ISO_UP: Vec3 = Object.freeze([0, 0, 1] as const)

/**
 * The `iso_v1` camera frame, as Three.js `Object3D.lookAt` builds it for a camera at +(1, 1, 1)
 * looking at the origin: `back` (the camera's +z, towards the viewer) = (1, 1, 1)/√3,
 * `right` = normalise(up × back) = (−1, 1, 0)/√2, `up` = back × right = (−1, −1, 2)/√6.
 */
export const ISO_BASIS: { readonly right: Vec3; readonly up: Vec3; readonly back: Vec3 } = Object.freeze(
  (() => {
    const back = unit([1, 1, 1])
    const right = unit(cross(ISO_UP, back))
    const up = cross(back, right)
    return { right, up, back }
  })(),
)

/** Screen coordinates (right, up) of a world point under `iso_v1` (orthographic: depth dropped). */
export function toScreen(p: Vec3): readonly [number, number] {
  return [dot3(p, ISO_BASIS.right), dot3(p, ISO_BASIS.up)]
}

/** Depth of a world point towards the viewer (larger = nearer) under `iso_v1`. */
export function toDepth(p: Vec3): number {
  return dot3(p, ISO_BASIS.back)
}

/**
 * Lighting of every figure (deterministic, fixed in the camera frame). Colours are sRGB hex; the
 * canvas background is the paper white of the matrices renderer, so stimuli look the same in the
 * light and dark themes (the page around them follows the theme).
 */
export const LIGHTING = Object.freeze({
  background: '#ffffff',
  /** Face albedo (a light cool grey, so every shade stays well above the edge colour). */
  face: '#c9ced8',
  /** Cube edges, unlit (≥ 3:1 against every face shade and the background, see the tests). */
  edge: '#1f1f24',
  /** Linear-light ambient term (faces turned away from the light get only this). */
  ambient: 0.3,
  /** Linear-light directional term at normal incidence (ambient + directional = 1: no clipping). */
  directional: 0.7,
  /** Unit vector towards the directional light, in world coordinates: upper left, in front. */
  direction: unit(add(add(scale(ISO_BASIS.right, -0.35), scale(ISO_BASIS.up, 0.6)), scale(ISO_BASIS.back, 0.7))),
})

/** Linear-light factor on the face albedo for a world-space face normal (ambient + Lambert). */
export function shade(normal: Vec3): number {
  return LIGHTING.ambient + LIGHTING.directional * Math.max(0, dot3(unit(normal), LIGHTING.direction))
}

/** R(q)·v for a spec quaternion `[w, x, y, z]`. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  const [r0, r1, r2] = mat3FromQuat(q)
  return [dot3(r0, v), dot3(r1, v), dot3(r2, v)]
}

/** A view as a centred figure (throws a RangeError on an empty view or a non-unit quaternion). */
export function figureScene(view: PolycubeView): FigureScene {
  const n = view.cubes.length
  if (n === 0) throw new RangeError('polycube renderer: a view needs at least one cube')
  const q = view.quat
  const qn = Math.hypot(q[0], q[1], q[2], q[3])
  if (!(Math.abs(qn - 1) < 1e-6)) throw new RangeError(`polycube renderer: quat must be a unit quaternion, |q| = ${qn}`)
  const centroid: Vec3 = scale(
    view.cubes.reduce<Vec3>((s, c) => [s[0] + c[0], s[1] + c[1], s[2] + c[2]], [0, 0, 0]),
    1 / n,
  )
  const offsets = view.cubes.map((c) => sub([c[0], c[1], c[2]], centroid))
  const radius = Math.max(...offsets.map(norm)) + CUBE_HALF_DIAGONAL
  return { offsets, quat: [q[0], q[1], q[2], q[3]], quaternionXyzw: [q[1], q[2], q[3], q[0]], radius }
}

/** World-space cube centres of a figure (the offsets rotated by its quat). */
export function worldCentres(figure: FigureScene): Vec3[] {
  return figure.offsets.map((o) => rotate(figure.quat, o))
}

/** The `iso_v1` camera framing figures of circumradius ≤ `maxRadius`. */
export function isoCamera(camera: string, maxRadius: number): IsoCamera {
  if (camera !== CAMERA_ISO_V1) throw new RangeError(`polycube renderer: unknown camera ${JSON.stringify(camera)} (only ${CAMERA_ISO_V1})`)
  if (!(maxRadius > 0 && Number.isFinite(maxRadius))) throw new RangeError(`polycube renderer: bad figure radius ${maxRadius}`)
  const distance = 4 * maxRadius + 10
  return {
    name: CAMERA_ISO_V1,
    position: scale(ISO_BASIS.back, distance),
    up: ISO_UP,
    lookAt: [0, 0, 0],
    halfExtent: maxRadius * FRAME_MARGIN,
    near: 0.5,
    far: 2 * distance,
  }
}

/** The whole item: the target, the options in display order, and the one shared camera. */
export function rotationScene(spec: RotationSpec): RotationScene {
  const target = figureScene(spec.target)
  const options = spec.options.map(figureScene)
  const maxRadius = Math.max(target.radius, ...options.map((o) => o.radius))
  return { target, options, camera: isoCamera(spec.camera, maxRadius) }
}

/** The eight corners of the unit cube centred on `c`, rotated with its figure. */
export function cubeCorners(figure: FigureScene, offset: Vec3): Vec3[] {
  const out: Vec3[] = []
  for (const dx of [-0.5, 0.5]) for (const dy of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) out.push(rotate(figure.quat, [offset[0] + dx, offset[1] + dy, offset[2] + dz]))
  return out
}
