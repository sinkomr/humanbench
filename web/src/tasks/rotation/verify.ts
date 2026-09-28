/**
 * Verifier of the mental-rotation family (gates G2/G3; DESIGN §4.2 `verify_rotation_item`, A11).
 *
 * Everything is recomputed from the item alone, so the same function checks generated items,
 * JSON-loaded items and hand-built bad ones. Checks (all must hold):
 *
 * - `well_formed`: spec is exactly `{ target, options, camera: "iso_v1" }`, every view exactly
 *   `{ cubes, quat }` with 1–64 cubes, cubes are integer triples with |c| ≤ COORD_LIMIT (100),
 *   quats four finite numbers;
 * - `four_options`, `key_in_range`: 4 options, `options_count` 4 (A9: 3PL, c = 1/4), key index 0–3;
 * - `cube_count`: the target has 8–10 cubes and every option as many; `cubes_distinct`;
 *   `shapes_at_origin` (every cube list is at its min corner); `connected` (every shape);
 * - `target_is_chain`, `options_are_chains`, `arm_count` (every shape has ≥ 3 arms);
 * - §4.2: `unique_rotation_match` (exactly the key option is rotation-equivalent to the target)
 *   and `target_chiral` (canon(mirror(target)) ≠ canon(target));
 * - `target_asymmetric`: no non-identity rotation maps the target onto itself (the angle feature
 *   is then unique);
 * - A11: `options_pairwise_distinct` (4 distinct canonical forms, so no two distractors are
 *   rotations of each other), `one_mirror` (exactly one option is the target's mirror image),
 *   `moved_distractors` (the other two distractors are one-cube-moved variants of the target or
 *   of its mirror, neither rotation-equivalent to the target: kind "moved" if a variant of the
 *   target, else "mirror_moved"), `distractors_paired` (those two are mirror images of each
 *   other, so the options form two enantiomer pairs and "which two are mirror images?" does not
 *   single out {key, mirror}; review M1.5);
 * - no leak: `no_verbatim_target` (no option's cube set equals the target's), `order_hidden` (no
 *   option's cube *list* is index-aligned with the target's under a rotation or reflection plus
 *   a translation, {@link indexAligned}: shuffled lists); `unit_quaternions` (|‖q‖ − 1| ≤ 1e-9);
 * - bookkeeping: `structure_matches` (A11 polycube), `features_complete`, `angle_matches`,
 *   `depth_matches`, `counts_match`, `prior_matches`, `stratum_matches`, `time_matches`.
 */

import { verdict, type VerifyResult } from '../family'
import { canonicalJson } from '../ids'
import { powerTimeLimit, stratumOfB } from '../priors'
import {
  COORD_LIMIT,
  MIN_ARMS,
  ROTATION_GROUP,
  achiralCanon,
  allDistinct,
  canonKey,
  chainInfo,
  chainKey,
  chainKeyOf,
  dot,
  groupElementsMapping,
  indexAligned,
  isConnected,
  mirror,
  movedVariantChains,
  quatAngleDeg,
  quatAxis,
  quatConj,
  quatFromMat3,
  quatMul,
  quatNorm,
  sortedKey,
  type Cube,
  type Quat,
} from './geometry'
import {
  ANGLE_BINS,
  ROTATION_SD_PRIOR,
  ROTATION_STRATA,
  rotationBPrior,
  rotationExpectedTime,
  type RotationStratum,
} from './prior'
import {
  ANGLE_TOL_DEG,
  CAMERA_ISO_V1,
  COS_TOL,
  FEATURE_NAMES,
  IN_DEPTH_MAX_COS,
  ISO_V1_VIEW_AXIS,
  MAX_CUBES,
  MAX_VIEW_CUBES,
  MIN_CUBES,
  PRIOR_TOL,
  QUAT_NORM_TOL,
  ROTATION_OPTIONS,
  TIME_TOL,
  type DistractorKind,
  type RotationItem,
} from './spec'

const GROUP_QUATS: readonly Quat[] = ROTATION_GROUP.map(quatFromMat3)

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const hasExactly = (o: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k))
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

interface View {
  readonly cubes: Cube[]
  readonly quat: Quat
}

function parseView(v: unknown): View | null {
  if (!isPlainObject(v) || !hasExactly(v, ['cubes', 'quat'])) return null
  const { cubes, quat } = v
  if (!Array.isArray(cubes) || cubes.length === 0 || cubes.length > MAX_VIEW_CUBES) return null
  const out: Cube[] = []
  for (const c of cubes) {
    if (!Array.isArray(c) || c.length !== 3 || !c.every((x) => isInt(x) && Math.abs(x) <= COORD_LIMIT)) return null
    out.push([c[0], c[1], c[2]] as Cube)
  }
  if (!Array.isArray(quat) || quat.length !== 4 || !quat.every(isFiniteNumber)) return null
  return { cubes: out, quat: [quat[0], quat[1], quat[2], quat[3]] as Quat }
}

function parseSpec(spec: unknown): { target: View; options: View[] } | null {
  if (!isPlainObject(spec) || !hasExactly(spec, ['target', 'options', 'camera'])) return null
  if (spec.camera !== CAMERA_ISO_V1 || !Array.isArray(spec.options)) return null
  const target = parseView(spec.target)
  const options = spec.options.map(parseView)
  if (target === null || options.some((o) => o === null)) return null
  return { target, options: options as View[] }
}

const atOrigin = (cubes: readonly Cube[]): boolean =>
  [0, 1, 2].every((k) => Math.min(...cubes.map((c) => c[k] as number)) === 0)

const unitQuat = (q: Quat): Quat => {
  const n = quatNorm(q)
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]
}

/** What the verifier recomputes from an item (null fields when they cannot be computed). */
export interface RotationAnalysis {
  /** Per option: 'correct' for the key option, otherwise its distractor kind ('other' if none fits). */
  readonly kinds: readonly (DistractorKind | 'correct' | 'other')[]
  /** Angle (degrees) and |axis · line of sight| of the rotation from the target's display to the key option's. */
  readonly angleDeg: number | null
  readonly axisViewCos: number | null
  readonly arms: number
}

/**
 * The display rotation from the target to option `c`: the least-angle R = q_C ⊗ g ⊗ q_T⁻¹ over
 * the group elements g with g·target = c's cubes (one when the target is asymmetric).
 */
function relativeRotation(target: View, c: View): { angleDeg: number; axisViewCos: number } | null {
  const gs = groupElementsMapping(target.cubes, c.cubes)
  let best: { angleDeg: number; axisViewCos: number } | null = null
  const qT = unitQuat(target.quat)
  const qC = unitQuat(c.quat)
  for (const g of gs) {
    const rel = quatMul(quatMul(qC, GROUP_QUATS[g] as Quat), quatConj(qT))
    const angleDeg = quatAngleDeg(rel)
    if (best !== null && angleDeg >= best.angleDeg) continue
    const axisViewCos = angleDeg > 0 ? Math.abs(dot(quatAxis(rel), ISO_V1_VIEW_AXIS)) : 0
    best = { angleDeg, axisViewCos }
  }
  return best
}

interface Analysis extends RotationAnalysis {
  readonly keyOk: boolean
  readonly matches: readonly number[]
  readonly canonTarget: string
  readonly canonMirror: string
  readonly optionCanons: readonly string[]
}

function analyse(target: View, options: readonly View[], keyIndex: unknown): Analysis {
  const T = target.cubes
  const keyOk = isInt(keyIndex) && keyIndex >= 0 && keyIndex < options.length
  const canonTarget = canonKey(T)
  const canonMirror = canonKey(mirror(T))
  const optionCanons = options.map((o) => canonKey(o.cubes))
  const matches = optionCanons.flatMap((k, i) => (k === canonTarget ? [i] : []))
  // Moved-variant classes by chain key (a complete rotation invariant of chains, = canon equality).
  const movedT = new Set(movedVariantChains(T).map((v) => chainKeyOf(v.info)))
  const movedM = new Set(movedVariantChains(mirror(T)).map((v) => chainKeyOf(v.info)))
  const kinds = options.map((o, i): RotationAnalysis['kinds'][number] => {
    if (keyOk && i === keyIndex) return 'correct'
    if (optionCanons[i] === canonTarget) return 'other' // a second rotation of the target is no distractor
    if (optionCanons[i] === canonMirror) return 'mirror'
    const k = chainKey(o.cubes)
    if (k !== null && movedT.has(k)) return 'moved'
    return k !== null && movedM.has(k) ? 'mirror_moved' : 'other'
  })
  const rel = keyOk && matches.includes(keyIndex) ? relativeRotation(target, options[keyIndex] as View) : null
  return {
    kinds,
    angleDeg: rel?.angleDeg ?? null,
    axisViewCos: rel?.axisViewCos ?? null,
    arms: chainInfo(T)?.arms ?? 0,
    keyOk,
    matches,
    canonTarget,
    canonMirror,
    optionCanons,
  }
}

/** The verifier's recomputation, for tests and the review page (null if the spec is malformed). */
export function analyseRotation(item: RotationItem): RotationAnalysis | null {
  const parsed = parseSpec(item.spec)
  if (parsed === null) return null
  const { kinds, angleDeg, axisViewCos, arms } = analyse(parsed.target, parsed.options, item.key.index)
  return { kinds, angleDeg, axisViewCos, arms }
}

/** Verify a rotation item; never throws. */
export function verifyRotation(item: RotationItem): VerifyResult {
  try {
    return verifyUnsafe(item)
  } catch (e) {
    return { ok: false, reason: `malformed item: ${String(e)}`, checks: {} }
  }
}

function verifyUnsafe(item: RotationItem): VerifyResult {
  const parsed = parseSpec(item.spec)
  if (parsed === null) return verdict({ well_formed: false })
  const { target, options } = parsed
  const T = target.cubes
  const opts = options.map((o) => o.cubes)
  const shapes = [T, ...opts]
  const n = T.length
  const keyIndex = (item.key as { index?: unknown }).index
  const a = analyse(target, options, keyIndex)
  const tInfo = chainInfo(T)
  const oInfos = opts.map(chainInfo)
  const distractorKinds = a.kinds.filter((k) => k !== 'correct')
  const movedIdx = a.kinds.flatMap((k, i) => (k === 'moved' || k === 'mirror_moved' ? [i] : []))

  const f: Readonly<Record<string, unknown>> = isPlainObject(item.difficulty?.features) ? item.difficulty.features : {}
  const featuresComplete =
    hasExactly(f, FEATURE_NAMES) &&
    isFiniteNumber(f.angle_deg) &&
    isFiniteNumber(f.axis_view_cos) &&
    typeof f.in_depth === 'boolean' &&
    [f.n_cubes, f.n_arms, f.n_moved, f.n_mirror_moved].every(isInt)
  const angle = featuresComplete ? (f.angle_deg as number) : NaN
  const cos = featuresComplete ? (f.axis_view_cos as number) : NaN
  const bPrior = item.difficulty?.b_prior
  const stratum = item.stratum as RotationStratum
  const bin = ANGLE_BINS[stratum] as readonly [number, number] | undefined

  return verdict({
    well_formed: true,
    four_options: options.length === ROTATION_OPTIONS && item.options_count === ROTATION_OPTIONS,
    key_in_range: a.keyOk,
    cube_count: n >= MIN_CUBES && n <= MAX_CUBES && opts.every((o) => o.length === n),
    cubes_distinct: shapes.every(allDistinct),
    shapes_at_origin: shapes.every(atOrigin),
    connected: shapes.every(isConnected),
    target_is_chain: tInfo !== null,
    options_are_chains: oInfos.every((i) => i !== null),
    arm_count: [tInfo, ...oInfos].every((i) => (i?.arms ?? 0) >= MIN_ARMS),
    // §4.2 verify_rotation_item
    unique_rotation_match: a.keyOk && a.matches.length === 1 && a.matches[0] === keyIndex,
    target_chiral: a.canonMirror !== a.canonTarget,
    target_asymmetric: groupElementsMapping(T, T).length === 1,
    // A11
    options_pairwise_distinct: new Set(a.optionCanons).size === a.optionCanons.length,
    one_mirror: a.optionCanons.filter((k) => k === a.canonMirror).length === 1,
    moved_distractors:
      distractorKinds.length === ROTATION_OPTIONS - 1 &&
      distractorKinds.filter((k) => k === 'moved' || k === 'mirror_moved').length === ROTATION_OPTIONS - 2,
    distractors_paired:
      movedIdx.length === 2 && canonKey(mirror(opts[movedIdx[0] as number] as Cube[])) === a.optionCanons[movedIdx[1] as number],
    no_verbatim_target: opts.every((o) => sortedKey(o) !== sortedKey(T)),
    order_hidden: opts.every((o) => !indexAligned(T, o)),
    unit_quaternions: [target, ...options].every((v) => Math.abs(quatNorm(v.quat) - 1) <= QUAT_NORM_TOL),
    structure_matches:
      canonicalJson(item.structural_params) === canonicalJson({ polycube: achiralCanon(T).map((c) => [...c]) }),
    features_complete: featuresComplete,
    angle_matches: a.angleDeg !== null && Math.abs(angle - a.angleDeg) <= ANGLE_TOL_DEG,
    depth_matches:
      a.axisViewCos !== null && Math.abs(cos - a.axisViewCos) <= COS_TOL && f.in_depth === (cos < IN_DEPTH_MAX_COS),
    counts_match:
      featuresComplete &&
      f.n_cubes === n &&
      f.n_arms === a.arms &&
      f.n_moved === a.kinds.filter((k) => k === 'moved').length &&
      f.n_mirror_moved === a.kinds.filter((k) => k === 'mirror_moved').length,
    prior_matches:
      featuresComplete &&
      isFiniteNumber(bPrior) &&
      Math.abs(bPrior - rotationBPrior({ angle_deg: angle })) <= PRIOR_TOL &&
      item.difficulty.sd_prior === ROTATION_SD_PRIOR,
    stratum_matches:
      ROTATION_STRATA.includes(stratum) &&
      isFiniteNumber(bPrior) &&
      stratumOfB(bPrior) === stratum &&
      bin !== undefined &&
      angle >= bin[0] &&
      angle < bin[1],
    time_matches:
      featuresComplete &&
      Math.abs(item.expected_time_s - rotationExpectedTime(angle)) <= TIME_TOL &&
      item.time_limit_s === powerTimeLimit(item.expected_time_s),
    distractors: distractorKinds,
  })
}

/**
 * The family's own `specLeaksKey` (runFamilyProperties): the spec holds only target, options and
 * camera, each view only cubes and quat, no option's cube set equals the target's (the correct
 * option is always re-expressed under a non-identity rotation) and no option's cube list is
 * index-aligned with the target's ({@link indexAligned}: the lists are shuffled).
 */
export function rotationSpecLeaksKey(item: RotationItem): string | null {
  const spec = item.spec as unknown
  if (!isPlainObject(spec) || !hasExactly(spec, ['target', 'options', 'camera'])) return 'spec fields must be exactly target, options, camera'
  const views = [spec.target, ...(Array.isArray(spec.options) ? spec.options : [])]
  if (!views.every((v) => isPlainObject(v) && hasExactly(v, ['cubes', 'quat']))) return 'every view must hold exactly cubes and quat'
  const parsed = parseSpec(spec)
  if (parsed === null) return 'malformed spec'
  const own = sortedKey(parsed.target.cubes)
  const same = parsed.options.findIndex((o) => sortedKey(o.cubes) === own)
  if (same >= 0) return `option ${same} repeats the target's cube set`
  const aligned = parsed.options.findIndex((o) => indexAligned(parsed.target.cubes, o.cubes))
  return aligned < 0 ? null : `option ${aligned}'s cube list is index-aligned with the target's`
}
