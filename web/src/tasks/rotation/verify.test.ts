/**
 * Negative tests of the rotation verifier: hand-built bad items, one per failure reason. Items are
 * built like the generator builds them (bases in the target's frame, a group element and a display
 * rotation per option), then {@link consistent} fills the bookkeeping fields from the verifier's own
 * analysis, so each spec-level defect is caught by its own check and not only by a bookkeeping one.
 */

import { describe, expect, it } from 'vitest'
import { itemParamsFor } from '../family'
import { stratumOfB } from '../priors'
import {
  AXIS_STEPS,
  ROTATION_GROUP,
  achiralCanon,
  applyMat,
  chainKey,
  groupElementsMapping,
  mirror,
  movedVariants,
  normalise,
  quatConj,
  quatFromAxisAngle,
  quatFromMat3,
  quatMul,
  quatNormalize,
  type Cube,
  type Vec3,
} from './geometry'
import { movedDistractorPool } from './gen'
import { rotationBPrior, rotationExpectedTime } from './prior'
import { ISO_V1_VIEW_AXIS, type RotationItem } from './spec'
import { analyseRotation, rotationSpecLeaksKey, verifyRotation } from './verify'
import { rotation } from '.'

// Loosely typed copies, so tests can write malformed values anywhere.
type Loose = { -readonly [K in keyof RotationItem]: any }

/** A chain from its steps (indices into AXIS_STEPS). */
const chain = (steps: readonly number[]): Cube[] => {
  const out: Cube[] = [[0, 0, 0]]
  for (const s of steps) {
    const [x, y, z] = out[out.length - 1]!
    const d = AXIS_STEPS[s]!
    out.push([x + d[0], y + d[1], z + d[2]])
  }
  return normalise(out)
}
const X = 0
const Y = 2
const Z = 4

/** The §12 example shape: +x2 +y2 +z2 +x1 (8 cubes, 4 arms, chiral, asymmetric). */
const T12 = chain([X, X, Y, Y, Z, Z, X])
const POOL = movedDistractorPool(T12)
const MOVED = POOL.filter((d) => d.kind === 'moved')
const MIRROR_MOVED = POOL.filter((d) => d.kind === 'mirror_moved')

interface OptionPlan {
  readonly base: readonly Cube[]
  /** Index into ROTATION_GROUP used to re-express the base (0 = identity). */
  readonly h: number
  readonly angle: number
  readonly axis: Vec3
}

const AXIS_DEPTH: Vec3 = [Math.SQRT1_2, -Math.SQRT1_2, 0] // ⊥ line of sight
const AXIS_PLANE: Vec3 = ISO_V1_VIEW_AXIS

/** An item with target `target` (display quat = identity) and these options; the key is `key`. */
function build(target: readonly Cube[], plans: readonly OptionPlan[], key: number): Loose {
  const base = JSON.parse(JSON.stringify(rotation.generate('negative-template', { stratum: 3 }))) as Loose
  base.spec = {
    target: { cubes: target.map((c) => [...c]), quat: [1, 0, 0, 0] },
    options: plans.map((p) => ({
      cubes: normalise(p.base.map((c) => applyMat(ROTATION_GROUP[p.h]!, c))).map((c) => [...c]),
      quat: [...quatNormalize(quatMul(quatFromAxisAngle(p.axis, p.angle), quatConj(quatFromMat3(ROTATION_GROUP[p.h]!))))],
    })),
    camera: 'iso_v1',
  }
  base.key = { index: key }
  return consistent(base)
}

/** Fill structure, features, prior, stratum and time from the verifier's own recomputation. */
function consistent(x: Loose): Loose {
  const a = analyseRotation(x as RotationItem)
  if (a === null) return x
  const target = x.spec.target.cubes as Cube[]
  const f = { ...x.difficulty.features }
  if (a.angleDeg !== null && a.axisViewCos !== null) {
    f.angle_deg = a.angleDeg
    f.axis_view_cos = a.axisViewCos
    f.in_depth = a.axisViewCos < Math.SQRT1_2
  }
  f.n_cubes = target.length
  f.n_arms = a.arms
  f.n_moved = a.kinds.filter((k) => k === 'moved').length
  f.n_mirror_moved = a.kinds.filter((k) => k === 'mirror_moved').length
  const b = rotationBPrior({ angle_deg: f.angle_deg })
  return {
    ...x,
    structural_params: { polycube: achiralCanon(target).map((c) => [...c]) },
    stratum: stratumOfB(b),
    params: itemParamsFor(4, 1, b),
    difficulty: { ...x.difficulty, features: f, b_prior: b },
    expected_time_s: rotationExpectedTime(f.angle_deg),
  }
}

/** A good item on T12: key 2; options = mirror, moved, correct, mirror-moved. */
const goodPlans = (): OptionPlan[] => [
  { base: mirror(T12), h: 5, angle: 75, axis: AXIS_DEPTH },
  { base: MOVED[0]!.cubes, h: 9, angle: 70, axis: AXIS_PLANE },
  { base: T12, h: 7, angle: 80, axis: AXIS_DEPTH },
  { base: MIRROR_MOVED[0]!.cubes, h: 13, angle: 65, axis: AXIS_DEPTH },
]
const GOOD_KEY = 2
const good = (): Loose => build(T12, goodPlans(), GOOD_KEY)

const withPlan = (i: number, plan: Partial<OptionPlan>): OptionPlan[] => goodPlans().map((p, j) => (j === i ? { ...p, ...plan } : p))

const falseChecks = (x: Loose): string[] => {
  const v = verifyRotation(x as RotationItem)
  expect(v.ok).toBe(false)
  return Object.entries(v.checks)
    .filter(([, ok]) => ok === false)
    .map(([k]) => k)
    .sort()
}
/** The item fails, and exactly these checks are false. */
const failsOnly = (x: Loose, ...checks: string[]): void => expect(falseChecks(x)).toEqual([...checks].sort())
/** The item fails, and at least these checks are false. */
const failsAtLeast = (x: Loose, ...checks: string[]): void => expect(falseChecks(x)).toEqual(expect.arrayContaining(checks))

const tamper = (x: Loose, f: (y: Loose) => void): Loose => {
  const y = JSON.parse(JSON.stringify(x)) as Loose
  f(y)
  return y
}

describe('rotation verifier: the hand-built baseline', () => {
  it('accepts a hand-built item with every check true', () => {
    expect(MOVED.length).toBeGreaterThan(0)
    expect(MIRROR_MOVED.length).toBeGreaterThan(0)
    const v = verifyRotation(good() as RotationItem)
    expect(v.reason).toBe('ok')
    expect(v.checks.distractors).toEqual(['mirror', 'moved', 'mirror_moved'])
    expect(Object.values(v.checks).filter((c) => typeof c === 'boolean')).toHaveLength(26)
    expect(good().difficulty.features.angle_deg).toBeCloseTo(80, 9)
    expect(good().stratum).toBe(3)
  })

  it('accepts a generated item and its JSON copy', () => {
    const item = rotation.generate('negative-generated')
    expect(verifyRotation(item).ok).toBe(true)
    expect(verifyRotation(JSON.parse(JSON.stringify(item)) as RotationItem).ok).toBe(true)
    expect(rotationSpecLeaksKey(item)).toBeNull()
  })
})

describe('rotation verifier rejects (one failure reason each)', () => {
  it('well_formed: malformed specs, views, cubes, quats and cameras', () => {
    const g = good()
    const bad: ((y: Loose) => void)[] = [
      (y) => (y.spec = null),
      (y) => (y.spec = { ...y.spec, extra: 1 }),
      (y) => (y.spec.camera = 'perspective'),
      (y) => delete y.spec.camera,
      (y) => (y.spec.options = 'abcd'),
      (y) => (y.spec.options[1].label = 'B'),
      (y) => (y.spec.target.cubes[0] = [0, 0.5, 0]),
      (y) => (y.spec.target.cubes[0] = [0, 0]),
      (y) => (y.spec.options[0].cubes[0] = [0, 0, 101]),
      (y) => (y.spec.options[0].cubes = []),
      (y) => (y.spec.options[0].cubes = Array.from({ length: 65 }, (_, i) => [i, 0, 0])),
      (y) => (y.spec.options[2].quat = [1, 0, 0]),
      (y) => (y.spec.options[2].quat = [1, 0, 0, '0']),
    ]
    for (const f of bad) failsOnly(tamper(g, f), 'well_formed')
    const v = verifyRotation(tamper(g, (y) => (y.spec.target.quat = [Number.NaN, 0, 0, 1])) as RotationItem)
    expect(v.checks.well_formed).toBe(false)
  })

  it('four_options: options_count ≠ 4 or ≠ 4 options', () => {
    failsOnly(tamper(good(), (y) => (y.options_count = 5)), 'four_options')
    const three = consistent(tamper(good(), (y) => y.spec.options.splice(3, 1)))
    failsAtLeast(three, 'four_options', 'moved_distractors')
  })

  it('key_in_range: out of range or not an integer', () => {
    for (const index of [4, -1, 1.5, '2', null]) {
      failsAtLeast(tamper(good(), (y) => (y.key = { index })), 'key_in_range', 'unique_rotation_match')
    }
  })

  it('cube_count: a target outside 8–10 cubes, or an option of another size', () => {
    failsAtLeast(build(chain([X, X, Y, Y, Z, Z]), goodPlans(), GOOD_KEY), 'cube_count')
    failsAtLeast(tamper(good(), (y) => y.spec.options[1].cubes.pop()), 'cube_count')
    const big = chain([X, X, Y, Y, Z, Z, X, X, Y, Y])
    failsAtLeast(build(big, goodPlans().map((p, i) => (i === GOOD_KEY ? { ...p, base: big } : p)), GOOD_KEY), 'cube_count')
  })

  it('cubes_distinct: a repeated cube', () => {
    failsAtLeast(tamper(good(), (y) => (y.spec.options[1].cubes[0] = [...y.spec.options[1].cubes[1]])), 'cubes_distinct')
  })

  it('shapes_at_origin: a shape not at its min corner', () => {
    failsOnly(
      tamper(good(), (y) => (y.spec.options[3].cubes = y.spec.options[3].cubes.map(([a, b, c]: number[]) => [a! + 1, b, c]))),
      'shapes_at_origin',
    )
    failsOnly(tamper(good(), (y) => (y.spec.target.cubes = y.spec.target.cubes.map(([a, b, c]: number[]) => [a, b, c! + 2]))), 'shapes_at_origin')
  })

  it('connected: a cube detached from an option', () => {
    const detached = tamper(good(), (y) => {
      const cubes = y.spec.options[1].cubes as number[][]
      const far = Math.max(...cubes.map((c) => c[0]!)) + 3
      cubes[cubes.length - 1] = [far, 0, 0]
    })
    failsAtLeast(detached, 'connected', 'options_are_chains', 'moved_distractors')
  })

  it('target_is_chain / options_are_chains: a branched shape', () => {
    const branch = [...T12.slice(0, 7), [T12[1]![0], T12[1]![1], T12[1]![2] + 1] as Cube]
    expect(chainKey(branch)).toBeNull()
    failsAtLeast(build(T12, withPlan(1, { base: branch }), GOOD_KEY), 'options_are_chains', 'arm_count', 'moved_distractors')
    failsAtLeast(build(branch, goodPlans(), GOOD_KEY), 'target_is_chain', 'arm_count')
  })

  it('arm_count: a target with only two arms', () => {
    const l2 = chain([X, X, X, X, Y, Y, Y, Y])
    failsAtLeast(build(l2, withPlan(GOOD_KEY, { base: l2 }), GOOD_KEY), 'arm_count')
  })

  it('target_chiral: an achiral (planar) target', () => {
    const planar = chain([X, X, Y, Y, X, X, Y])
    failsAtLeast(build(planar, withPlan(GOOD_KEY, { base: planar }).map((p, i) => (i === 0 ? { ...p, base: mirror(planar) } : p)), GOOD_KEY), 'target_chiral')
  })

  it('target_asymmetric: a chiral target with a C2 symmetry (x³y²z³)', () => {
    const c2 = chain([X, X, X, Y, Y, Z, Z, Z])
    expect(groupElementsMapping(c2, c2)).toHaveLength(2)
    const pool = movedDistractorPool(c2)
    const plans: OptionPlan[] = [
      { base: mirror(c2), h: 5, angle: 75, axis: AXIS_DEPTH },
      { base: pool[0]!.cubes, h: 9, angle: 70, axis: AXIS_PLANE },
      { base: c2, h: 7, angle: 40, axis: AXIS_DEPTH },
      { base: pool[1]!.cubes, h: 13, angle: 65, axis: AXIS_DEPTH },
    ]
    failsOnly(build(c2, plans, GOOD_KEY), 'target_asymmetric')
  })

  it('unique_rotation_match: the key on the mirror, or two rotations of the target', () => {
    failsAtLeast(tamper(good(), (y) => (y.key = { index: 0 })), 'unique_rotation_match')
    const twoCorrect = build(T12, withPlan(1, { base: T12, h: 11 }), GOOD_KEY)
    failsAtLeast(twoCorrect, 'unique_rotation_match', 'options_pairwise_distinct', 'moved_distractors')
  })

  it('options_pairwise_distinct: two distractors that are rotations of each other', () => {
    failsOnly(build(T12, withPlan(3, { base: MOVED[0]!.cubes, h: 17 }), GOOD_KEY), 'options_pairwise_distinct')
  })

  it('one_mirror: no pure mirror distractor (a third moved one instead)', () => {
    const third = POOL.find((d) => d !== MOVED[0] && d !== MIRROR_MOVED[0])!
    failsOnly(build(T12, withPlan(0, { base: third.cubes }), GOOD_KEY), 'one_mirror', 'moved_distractors')
  })

  it('moved_distractors: a distractor two cubes away from the target', () => {
    const near = new Set([T12, mirror(T12), ...POOL.map((d) => d.cubes)].map((c) => chainKey(c)))
    const twoMoved = movedVariants(MOVED[0]!.cubes).find((v) => !near.has(chainKey(v)))!
    expect(twoMoved).toBeDefined()
    failsOnly(build(T12, withPlan(1, { base: twoMoved }), GOOD_KEY), 'moved_distractors')
  })

  it('no_verbatim_target: the correct option shown in the target frame (identity element)', () => {
    failsOnly(build(T12, withPlan(GOOD_KEY, { h: 0 }), GOOD_KEY), 'no_verbatim_target')
  })

  it('unit_quaternions: a quaternion off the unit sphere', () => {
    failsOnly(tamper(good(), (y) => (y.spec.target.quat = y.spec.target.quat.map((v: number) => v * 1.001))), 'unit_quaternions')
    failsOnly(tamper(good(), (y) => (y.spec.options[3].quat = [0, 0, 0, 0.5])), 'unit_quaternions')
  })

  it('structure_matches: a wrong A11 polycube', () => {
    failsOnly(tamper(good(), (y) => (y.structural_params = { polycube: T12.map((c) => [...c]) })), 'structure_matches')
    failsOnly(tamper(good(), (y) => (y.structural_params = { polycube: achiralCanon(T12).slice(1) })), 'structure_matches')
  })

  it('features_complete: a missing, extra or mistyped feature', () => {
    failsAtLeast(tamper(good(), (y) => delete y.difficulty.features.n_arms), 'features_complete')
    failsAtLeast(tamper(good(), (y) => (y.difficulty.features.colour = 'red')), 'features_complete')
    failsAtLeast(tamper(good(), (y) => (y.difficulty.features.in_depth = 1)), 'features_complete')
  })

  it('angle_matches: a recorded angle that is not the display rotation', () => {
    const y = tamper(good(), (z) => (z.difficulty.features.angle_deg = 81))
    y.difficulty.b_prior = rotationBPrior({ angle_deg: 81 })
    y.params = itemParamsFor(4, 1, y.difficulty.b_prior)
    y.expected_time_s = rotationExpectedTime(81)
    failsOnly(y, 'angle_matches')
    // Picture-plane vs depth recomputation: the key option rotated about another axis.
    const moved = build(T12, withPlan(GOOD_KEY, { axis: AXIS_PLANE }), GOOD_KEY)
    failsOnly(tamper(moved, (z) => (z.difficulty.features = good().difficulty.features)), 'depth_matches')
  })

  it('depth_matches: a flipped in_depth flag or a wrong axis cosine', () => {
    failsOnly(tamper(good(), (y) => (y.difficulty.features.in_depth = !y.difficulty.features.in_depth)), 'depth_matches')
    failsOnly(tamper(good(), (y) => (y.difficulty.features.axis_view_cos += 0.01)), 'depth_matches')
  })

  it('counts_match: wrong cube, arm or distractor counts', () => {
    failsOnly(tamper(good(), (y) => (y.difficulty.features.n_mirror_moved = 2)), 'counts_match')
    failsOnly(tamper(good(), (y) => (y.difficulty.features.n_arms = 3)), 'counts_match')
    failsOnly(tamper(good(), (y) => (y.difficulty.features.n_cubes = 9)), 'counts_match')
  })

  it('prior_matches: a b prior or sd off the v0 model', () => {
    const shifted = tamper(good(), (y) => {
      y.difficulty.b_prior += 0.001
      y.params = itemParamsFor(4, 1, y.difficulty.b_prior)
    })
    failsOnly(shifted, 'prior_matches')
    failsOnly(tamper(good(), (y) => (y.difficulty.sd_prior = 0.8)), 'prior_matches')
  })

  it('stratum_matches: a stratum that is not the b band / angle bin', () => {
    failsOnly(tamper(good(), (y) => (y.stratum = 4)), 'stratum_matches')
    // An angle below 20° is stratum 1, which the family never makes.
    failsAtLeast(build(T12, withPlan(GOOD_KEY, { angle: 10 }), GOOD_KEY), 'stratum_matches')
  })

  it('time_matches: a wrong expected time or time limit', () => {
    failsOnly(tamper(good(), (y) => (y.expected_time_s += 1)), 'time_matches')
    failsOnly(tamper(good(), (y) => delete y.time_limit_s), 'time_matches')
  })

  it('never throws, even on garbage', () => {
    for (const garbage of [null, 1, 'x', {}, { spec: {}, key: {} }, { ...good(), difficulty: null }]) {
      expect(() => verifyRotation(garbage as unknown as RotationItem)).not.toThrow()
      expect(verifyRotation(garbage as unknown as RotationItem).ok).toBe(false)
    }
  })

  it('the leak predicate flags extra fields and a repeated target cube set', () => {
    const g = good()
    expect(rotationSpecLeaksKey(g as RotationItem)).toBeNull()
    expect(rotationSpecLeaksKey(tamper(g, (y) => (y.spec.hint = 2)) as RotationItem)).toMatch(/exactly/)
    expect(rotationSpecLeaksKey(tamper(g, (y) => (y.spec.options[0].is_mirror = true)) as RotationItem)).toMatch(/cubes and quat/)
    expect(rotationSpecLeaksKey(build(T12, withPlan(GOOD_KEY, { h: 0 }), GOOD_KEY) as RotationItem)).toMatch(/option 2/)
  })
})

