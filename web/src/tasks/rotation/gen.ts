/**
 * Generator of the mental-rotation family (DESIGN §4.2 "Mental rotation", §12; ROADMAP A9, A11).
 *
 * 1. Target: a Shepard–Metzler chain of 8–10 cubes, built as 3–5 straight arms (a random
 *    composition of the n − 1 steps) turning at right angles. Kept only if it is a chain (no two
 *    non-consecutive cubes touch), chiral (canon(mirror) ≠ canon, §4.2; this also rules out every
 *    planar chain) and asymmetric (no non-identity rotation maps it onto itself, so the angle
 *    between the target and the correct option is well defined).
 * 2. Distractors (A11): exactly one pure mirror image, plus two distinct one-cube-moved variants
 *    of the target or of its mirror (`movedVariants`), all with distinct canonical forms.
 * 3. Display: the target gets a uniformly random orientation q_T. Every option i shows its base
 *    shape B_i (the target, its mirror, or a variant, all in the target's frame) as
 *    R_i · q_T · B_i: the target's pose followed by a rotation R_i whose angle is uniform in the
 *    stratum's angle bin and whose axis is in depth or in the picture plane with probability ½.
 *    The option's cubes are B_i re-expressed under a random non-identity group element h_i
 *    (min corner, shuffled), so its quat is R_i ⊗ q_T ⊗ h_i⁻¹. Every option is treated the same
 *    way, so neither the cube lists nor the orientations single out the key.
 * 4. The key index is uniform over 0–3 (the four options are shuffled).
 */

import type { JsonValue, Rng } from '../../engine'
import type { BuildContext, BuiltItem } from '../family'
import { stratumOfB } from '../priors'
import {
  AXIS_STEPS,
  ROTATION_GROUP,
  achiralCanon,
  applyMat,
  canonKey,
  chainInfo,
  chainKey,
  chainKeyOf,
  dot,
  mirror,
  movedVariantChains,
  normalise,
  quatConj,
  quatFromAxisAngle,
  quatFromMat3,
  quatMul,
  quatNormalize,
  randomQuat,
  randomUnitVector,
  symmetryOrder,
  type Cube,
  type Mat3,
  type Quat,
  type Vec3,
} from './geometry'
import {
  ANGLE_BINS,
  ROTATION_PROVENANCE,
  ROTATION_SD_PRIOR,
  ROTATION_STRATA,
  ROTATION_TIME_LIMIT_S,
  rotationBPrior,
  rotationExpectedTime,
  type RotationStratum,
} from './prior'
import {
  IN_DEPTH_MAX_COS,
  ISO_V1_VIEW_AXIS,
  MAX_CUBES,
  MIN_CUBES,
  ROTATION_OPTIONS,
  CAMERA_ISO_V1,
  type DistractorKind,
  type PolycubeView,
  type RotationFeatures,
  type RotationKey,
  type RotationSpec,
  type RotationStructure,
} from './spec'

/** Arm counts of generated targets, drawn uniformly from this list (so 4–5 arms are favoured). */
export const TARGET_ARM_CHOICES: readonly number[] = Object.freeze([3, 4, 4, 5, 5])

const MAX_ATTEMPTS = 10_000

/** Quaternions of the group elements (index-aligned with ROTATION_GROUP). */
const GROUP_QUATS: readonly Quat[] = ROTATION_GROUP.map(quatFromMat3)

const perpendicularSteps = (d: Vec3): Vec3[] => AXIS_STEPS.filter((s) => dot(s, d) === 0)

/**
 * A random chain of `n` cubes with `arms` straight runs: the n − 1 steps split into `arms`
 * positive run lengths, each run turning 90° from the previous one. Null if it self-intersects
 * or two non-consecutive cubes touch.
 */
export function drawChain(rng: Rng, n: number, arms: number): Cube[] | null {
  const steps = n - 1
  const cuts = rng
    .shuffle(Array.from({ length: steps - 1 }, (_, i) => i + 1))
    .slice(0, arms - 1)
    .sort((a, b) => a - b)
  const bounds = [0, ...cuts, steps]
  let dir = rng.pick(AXIS_STEPS)
  const cubes: Cube[] = [[0, 0, 0]]
  for (let a = 0; a < arms; a++) {
    if (a > 0) dir = rng.pick(perpendicularSteps(dir))
    const len = (bounds[a + 1] as number) - (bounds[a] as number)
    for (let k = 0; k < len; k++) {
      const [x, y, z] = cubes[cubes.length - 1] as Cube
      cubes.push([x + dir[0], y + dir[1], z + dir[2]])
    }
  }
  const info = chainInfo(cubes)
  return info !== null && info.arms === arms ? cubes : null
}

/** A target chain (min corner): 8–10 cubes, chiral, no rotational symmetry. */
export function drawTarget(rng: Rng): Cube[] {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const n = rng.int(MIN_CUBES, MAX_CUBES)
    const arms = rng.pick(TARGET_ARM_CHOICES)
    const cubes = drawChain(rng, n, arms)
    if (cubes === null) continue
    if (canonKey(mirror(cubes)) === canonKey(cubes)) continue // achiral (every planar chain is)
    if (symmetryOrder(cubes) !== 1) continue
    return normalise(cubes)
  }
  throw new Error('rotation: no valid target after many attempts')
}

export interface Distractor {
  readonly cubes: readonly Cube[]
  readonly kind: DistractorKind
}

/**
 * Every admissible one-cube-moved distractor of `target`, one per rotation class: the variants
 * of the target ("moved") and of its mirror ("mirror_moved"; a shape in both sets counts as
 * "moved"), excluding anything rotation-equivalent to the target or its mirror. Classes are
 * compared by {@link chainKeyOf} (equivalent to §4.2 canon for chains, and O(n)).
 */
export function movedDistractorPool(target: readonly Cube[]): Distractor[] {
  const mirrored = normalise(mirror(target))
  const fromTarget = movedVariantChains(target).map((v) => ({ cubes: v.cubes, key: chainKeyOf(v.info) }))
  const fromMirror = movedVariantChains(mirrored).map((v) => ({ cubes: v.cubes, key: chainKeyOf(v.info) }))
  const movedKeys = new Set(fromTarget.map((v) => v.key))
  const seen = new Set([chainKey(target), chainKey(mirrored)])
  const pool: Distractor[] = []
  for (const v of [...fromTarget, ...fromMirror]) {
    if (seen.has(v.key)) continue
    seen.add(v.key)
    pool.push({ cubes: v.cubes, kind: movedKeys.has(v.key) ? 'moved' : 'mirror_moved' })
  }
  return pool
}

/** A random rotation axis that is in depth (|axis · view| < cos 45°) or not, as requested. */
function drawAxis(rng: Rng, inDepth: boolean): Vec3 {
  for (;;) {
    const u = randomUnitVector(rng)
    if ((Math.abs(dot(u, ISO_V1_VIEW_AXIS)) < IN_DEPTH_MAX_COS) === inDepth) return u
  }
}

interface Display {
  readonly view: PolycubeView
  readonly angleDeg: number
  readonly axis: Vec3
}

/** Show `base` (in the target's frame) as R · q_T · base, re-expressed under a random h ≠ identity. */
function display(rng: Rng, base: readonly Cube[], qT: Quat, angleDeg: number): Display {
  const h = rng.int(1, ROTATION_GROUP.length - 1) // index 0 is the identity
  const cubes = rng.shuffle(normalise(base.map((c) => applyMat(ROTATION_GROUP[h] as Mat3, c))))
  const axis = drawAxis(rng, rng.next() < 0.5)
  const qRel = quatFromAxisAngle(axis, angleDeg)
  const quat = quatNormalize(quatMul(quatMul(qRel, qT), quatConj(GROUP_QUATS[h] as Quat)))
  return { view: { cubes, quat }, angleDeg, axis }
}

const drawAngle = (rng: Rng, [lo, hi]: readonly [number, number]): number => lo + (hi - lo) * rng.next()

export function buildRotation(rng: Rng, ctx: BuildContext): BuiltItem<RotationSpec, RotationKey> {
  const stratum = (ctx.stratum ?? rng.pick(ROTATION_STRATA)) as RotationStratum
  const bin = ANGLE_BINS[stratum]
  if (bin === undefined) throw new RangeError(`rotation cannot generate stratum ${stratum}`)

  let target: Cube[] = []
  let pool: Distractor[] = []
  for (let attempt = 0; pool.length < 2; attempt++) {
    if (attempt >= MAX_ATTEMPTS) throw new Error('rotation: no target with two moved distractors')
    target = drawTarget(rng)
    pool = movedDistractorPool(target)
  }
  const [d1, d2] = rng.shuffle(pool).slice(0, 2) as [Distractor, Distractor]

  // The correct option's angle fixes b and so the stratum; redraw the (measure-zero-ish) angles
  // whose b falls just outside the band (the exact cuts sit 4e-4° below the nominal bin edges).
  let angle = drawAngle(rng, bin)
  while (stratumOfB(rotationBPrior({ angle_deg: angle })) !== stratum) angle = drawAngle(rng, bin)

  const qT = randomQuat(rng)
  const bases: readonly (readonly Cube[])[] = [target, normalise(mirror(target)), d1.cubes, d2.cubes]
  const shown = bases.map((b, i) => display(rng, b, qT, i === 0 ? angle : drawAngle(rng, bin)))
  const order = rng.shuffle([0, 1, 2, 3])
  const options = order.map((i) => (shown[i] as Display).view)

  const correct = shown[0] as Display
  const axisViewCos = Math.abs(dot(correct.axis, ISO_V1_VIEW_AXIS))
  const nMirrorMoved = [d1, d2].filter((d) => d.kind === 'mirror_moved').length
  const features: RotationFeatures = {
    angle_deg: correct.angleDeg,
    axis_view_cos: axisViewCos,
    in_depth: axisViewCos < IN_DEPTH_MAX_COS,
    n_cubes: target.length,
    n_arms: chainInfo(target)?.arms ?? 0,
    n_moved: 2 - nMirrorMoved,
    n_mirror_moved: nMirrorMoved,
  }
  const bPrior = rotationBPrior(features)
  const structure: RotationStructure = { polycube: achiralCanon(target) }
  const structuralParams: JsonValue = { polycube: structure.polycube.map(([x, y, z]) => [x, y, z]) }
  return {
    stratum,
    spec: { target: { cubes: rng.shuffle(target), quat: qT }, options, camera: CAMERA_ISO_V1 },
    key: { index: order.indexOf(0) },
    structural_params: structuralParams,
    options_count: ROTATION_OPTIONS,
    difficulty: { features: { ...features }, b_prior: bPrior, sd_prior: ROTATION_SD_PRIOR, provenance: ROTATION_PROVENANCE },
    expected_time_s: rotationExpectedTime(features.angle_deg),
    time_limit_s: ROTATION_TIME_LIMIT_S,
  }
}
