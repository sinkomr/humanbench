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
 *
 * Those are the checks of the classic template (no `template` feature: 1.3.0, and 1.4.0's natural
 * pool and strata 2–4). An item recording `template: "torsion"` (1.4.0, requested strata 5–6) is
 * checked against the torsion template instead, with these differences:
 *
 * - `cube_count`: 10–14 cubes; `compact`: every shape's cube centres within √18 of its centroid
 *   (spec.ts `HARD_MAX_CENTRE_RADIUS_SQ`, legibility); `arm_count`: the target has 5–7 arms and every option as many;
 *   `arm_lengths_shared`: every option has exactly the target's cubes per arm (geometry
 *   `armLengths`), so counting tells no option apart;
 * - `torsion_distractors` (in place of `moved_distractors`): the two non-mirror distractors are
 *   one-joint torsion variants of the target ("torsion") or of its mirror ("mirror_torsion"),
 *   neither rotation-equivalent to the target; `distractors_paired`: they are mirror images of each
 *   other. With `unique_rotation_match`, `one_mirror` and `options_pairwise_distinct` this proves
 *   the key (G2) and that each distractor fails for its documented reason (G3);
 * - `axis_oblique`: the key's rotation axis is oblique (cos 75° ≤ |axis · view| < cos 45°) and
 *   `oblique` records it;
 * - `counts_match` also checks `n_torsion` / `n_mirror_torsion` (and `n_moved` = `n_mirror_moved` = 0);
 *   `prior_matches`, `time_matches`: the torsion prior and E[T] (`prior.ts`); `stratum_matches`:
 *   stratum 5 or 6, the band of b, and the angle in 70–140°.
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
  armLengths,
  centreSpreadSq,
  torsionVariantChains,
  type Cube,
  type Quat,
} from './geometry'
import {
  ANGLE_BINS,
  HARD_ANGLE_RANGE,
  HARD_STRATA,
  ROTATION_SD_PRIOR,
  ROTATION_STRATA,
  rotationBPrior,
  rotationExpectedTime,
  rotationHardBPrior,
  rotationHardExpectedTime,
} from './prior'
import {
  ANGLE_TOL_DEG,
  CAMERA_ISO_V1,
  COS_TOL,
  FEATURE_NAMES,
  HARD_FEATURE_NAMES,
  HARD_MAX_ARMS,
  HARD_MAX_CENTRE_RADIUS_SQ,
  HARD_MAX_CUBES,
  HARD_MIN_ARMS,
  HARD_MIN_CUBES,
  IN_DEPTH_MAX_COS,
  OBLIQUE_MAX_COS,
  OBLIQUE_MIN_COS,
  TORSION_TEMPLATE,
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
  type RotationTemplate,
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
  /** The template the item records (`features.template`), whose distractor kinds `kinds` uses. */
  readonly template: RotationTemplate
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

/** The template an item records: torsion iff `features.template` is "torsion". */
const templateOf = (features: unknown): RotationTemplate =>
  isPlainObject(features) && features.template === TORSION_TEMPLATE ? 'torsion' : 'classic'

function analyse(target: View, options: readonly View[], keyIndex: unknown, template: RotationTemplate): Analysis {
  const T = target.cubes
  const keyOk = isInt(keyIndex) && keyIndex >= 0 && keyIndex < options.length
  const canonTarget = canonKey(T)
  const canonMirror = canonKey(mirror(T))
  const optionCanons = options.map((o) => canonKey(o.cubes))
  const matches = optionCanons.flatMap((k, i) => (k === canonTarget ? [i] : []))
  // Variant classes by chain key (a complete rotation invariant of chains, = canon equality):
  // one-cube-moved variants (classic) or one-joint torsion variants (torsion template).
  const variants = template === 'torsion' ? torsionVariantChains : movedVariantChains
  const [own, ofMirror] = template === 'torsion' ? (['torsion', 'mirror_torsion'] as const) : (['moved', 'mirror_moved'] as const)
  const fromT = new Set(variants(T).map((v) => chainKeyOf(v.info)))
  const fromM = new Set(variants(mirror(T)).map((v) => chainKeyOf(v.info)))
  const kinds = options.map((o, i): RotationAnalysis['kinds'][number] => {
    if (keyOk && i === keyIndex) return 'correct'
    if (optionCanons[i] === canonTarget) return 'other' // a second rotation of the target is no distractor
    if (optionCanons[i] === canonMirror) return 'mirror'
    const k = chainKey(o.cubes)
    if (k !== null && fromT.has(k)) return own
    return k !== null && fromM.has(k) ? ofMirror : 'other'
  })
  const rel = keyOk && matches.includes(keyIndex) ? relativeRotation(target, options[keyIndex] as View) : null
  return {
    template,
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
  const { template, kinds, angleDeg, axisViewCos, arms } = analyse(parsed.target, parsed.options, item.key.index, templateOf(item.difficulty?.features))
  return { template, kinds, angleDeg, axisViewCos, arms }
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
  // The recorded template picks the rules (module comment): classic, or torsion (1.4.0, strata 5–6).
  const torsion = templateOf(item.difficulty?.features) === 'torsion'
  const a = analyse(target, options, keyIndex, torsion ? 'torsion' : 'classic')
  const [own, ofMirror] = torsion ? (['torsion', 'mirror_torsion'] as const) : (['moved', 'mirror_moved'] as const)
  const tInfo = chainInfo(T)
  const oInfos = opts.map(chainInfo)
  const distractorKinds = a.kinds.filter((k) => k !== 'correct')
  const variantIdx = a.kinds.flatMap((k, i) => (k === own || k === ofMirror ? [i] : []))
  const count = (kind: string): number => a.kinds.filter((k) => k === kind).length

  const f: Readonly<Record<string, unknown>> = isPlainObject(item.difficulty?.features) ? item.difficulty.features : {}
  const featuresComplete =
    hasExactly(f, torsion ? HARD_FEATURE_NAMES : FEATURE_NAMES) &&
    isFiniteNumber(f.angle_deg) &&
    isFiniteNumber(f.axis_view_cos) &&
    typeof f.in_depth === 'boolean' &&
    [f.n_cubes, f.n_arms, f.n_moved, f.n_mirror_moved].every(isInt) &&
    (!torsion || (typeof f.oblique === 'boolean' && [f.n_torsion, f.n_mirror_torsion].every(isInt)))
  const angle = featuresComplete ? (f.angle_deg as number) : NaN
  const cos = featuresComplete ? (f.axis_view_cos as number) : NaN
  const nCubes = f.n_cubes as number
  const bPrior = item.difficulty?.b_prior
  const stratum = item.stratum
  const bin = torsion ? HARD_ANGLE_RANGE : (ANGLE_BINS[stratum] as readonly [number, number] | undefined)
  const wantB = !featuresComplete
    ? NaN
    : torsion
      ? rotationHardBPrior({ angle_deg: angle, oblique: f.oblique as boolean, n_cubes: nCubes, n_arms: f.n_arms as number })
      : rotationBPrior({ angle_deg: angle })
  const wantT = torsion ? rotationHardExpectedTime(angle, nCubes) : rotationExpectedTime(angle)
  const tLengths = tInfo === null ? null : armLengths(tInfo).join(',')
  const [minCubes, maxCubes] = torsion ? [HARD_MIN_CUBES, HARD_MAX_CUBES] : [MIN_CUBES, MAX_CUBES]

  return verdict({
    well_formed: true,
    four_options: options.length === ROTATION_OPTIONS && item.options_count === ROTATION_OPTIONS,
    key_in_range: a.keyOk,
    cube_count: n >= minCubes && n <= maxCubes && opts.every((o) => o.length === n),
    cubes_distinct: shapes.every(allDistinct),
    shapes_at_origin: shapes.every(atOrigin),
    connected: shapes.every(isConnected),
    target_is_chain: tInfo !== null,
    options_are_chains: oInfos.every((i) => i !== null),
    arm_count: torsion
      ? tInfo !== null && tInfo.arms >= HARD_MIN_ARMS && tInfo.arms <= HARD_MAX_ARMS && oInfos.every((i) => i?.arms === tInfo.arms)
      : [tInfo, ...oInfos].every((i) => (i?.arms ?? 0) >= MIN_ARMS),
    ...(torsion && {
      compact: shapes.every((sh) => centreSpreadSq(sh) <= HARD_MAX_CENTRE_RADIUS_SQ * sh.length * sh.length),
      arm_lengths_shared: tLengths !== null && oInfos.every((i) => i !== null && armLengths(i).join(',') === tLengths),
    }),
    // §4.2 verify_rotation_item
    unique_rotation_match: a.keyOk && a.matches.length === 1 && a.matches[0] === keyIndex,
    target_chiral: a.canonMirror !== a.canonTarget,
    target_asymmetric: groupElementsMapping(T, T).length === 1,
    // A11
    options_pairwise_distinct: new Set(a.optionCanons).size === a.optionCanons.length,
    one_mirror: a.optionCanons.filter((k) => k === a.canonMirror).length === 1,
    [torsion ? 'torsion_distractors' : 'moved_distractors']:
      distractorKinds.length === ROTATION_OPTIONS - 1 && variantIdx.length === ROTATION_OPTIONS - 2,
    distractors_paired:
      variantIdx.length === 2 && canonKey(mirror(opts[variantIdx[0] as number] as Cube[])) === a.optionCanons[variantIdx[1] as number],
    no_verbatim_target: opts.every((o) => sortedKey(o) !== sortedKey(T)),
    order_hidden: opts.every((o) => !indexAligned(T, o)),
    unit_quaternions: [target, ...options].every((v) => Math.abs(quatNorm(v.quat) - 1) <= QUAT_NORM_TOL),
    structure_matches:
      canonicalJson(item.structural_params) === canonicalJson({ polycube: achiralCanon(T).map((c) => [...c]) }),
    features_complete: featuresComplete,
    angle_matches: a.angleDeg !== null && Math.abs(angle - a.angleDeg) <= ANGLE_TOL_DEG,
    depth_matches:
      a.axisViewCos !== null && Math.abs(cos - a.axisViewCos) <= COS_TOL && f.in_depth === (cos < IN_DEPTH_MAX_COS),
    ...(torsion && { axis_oblique: featuresComplete && f.oblique === true && cos >= OBLIQUE_MIN_COS && cos < OBLIQUE_MAX_COS }),
    counts_match:
      featuresComplete &&
      f.n_cubes === n &&
      f.n_arms === a.arms &&
      f.n_moved === count('moved') &&
      f.n_mirror_moved === count('mirror_moved') &&
      (!torsion || (f.n_torsion === count('torsion') && f.n_mirror_torsion === count('mirror_torsion'))),
    prior_matches:
      featuresComplete && isFiniteNumber(bPrior) && Math.abs(bPrior - wantB) <= PRIOR_TOL && item.difficulty.sd_prior === ROTATION_SD_PRIOR,
    stratum_matches:
      (torsion ? HARD_STRATA : ROTATION_STRATA).includes(stratum) &&
      isFiniteNumber(bPrior) &&
      stratumOfB(bPrior) === stratum &&
      bin !== undefined &&
      angle >= bin[0] &&
      angle < bin[1],
    time_matches:
      featuresComplete && Math.abs(item.expected_time_s - wantT) <= TIME_TOL && item.time_limit_s === powerTimeLimit(item.expected_time_s),
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
