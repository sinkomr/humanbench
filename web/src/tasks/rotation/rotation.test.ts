import { describe, expect, it } from 'vitest'
import { STRATUM_B_CUTS, stratumOfB } from '../priors'
import { runFamilyProperties } from '../testing'
import { canonKey, mirror, quatAngleDeg, quatConj, quatMul, sortedKey, type Cube } from './geometry'
import { ANGLE_BINS, ROTATION_PRIOR, ROTATION_STRATA, rotationBPrior, rotationExpectedTime, type RotationStratum } from './prior'
import { analyseRotation, rotationSpecLeaksKey } from './verify'
import { rotation, type RotationFeatures, type RotationItem } from '.'

/**
 * A11: the family is the target polycube up to rotation and reflection. Chiral, asymmetric
 * Shepard–Metzler chains of 8–10 cubes with 3–5 arms form only 1,386 such classes (27 with 3
 * arms, 284 with 4, 1,075 with 5; exhaustive count), so 10,000 draws give ~1,300 distinct
 * family_ids, far below the default 50%.
 */
const SMALL_STRUCTURE = { min: 0.1, reason: '1,386 target polycube classes (8–10 cubes, 3–5 arms, chiral, asymmetric)' }

const OPTS = {
  familyIdRatio: SMALL_STRUCTURE,
  specLeaksKey: rotationSpecLeaksKey,
  correctResponse: (item: RotationItem) => item.key.index,
} as const

const features = (item: RotationItem): RotationFeatures => item.difficulty.features as unknown as RotationFeatures

const sample = (n: number, prefix: string): RotationItem[] => Array.from({ length: n }, (_, i) => rotation.generate(`${prefix}-${i}`))

/** χ² statistic of counts against a uniform distribution. */
const chiSquare = (counts: readonly number[]): number => {
  const total = counts.reduce((a, b) => a + b, 0)
  const e = total / counts.length
  return counts.reduce((s, c) => s + (c - e) ** 2 / e, 0)
}
/** χ²(3) 99.9th percentile. */
const CHI2_3_P999 = 16.27

describe('rotation family (M1.5, DESIGN §4.2)', () => {
  it('passes runFamilyProperties at n = 10,000 spread over strata 2–5', () => {
    const r = runFamilyProperties(rotation, { ...OPTS, strata: rotation.strata })
    expect(r.n).toBe(10_000)
    expect(r.distinctItemIds).toBe(10_000)
    expect(r.distinctContents).toBe(10_000)
    expect(r.distinctFamilyIds).toBeGreaterThan(1_000)
    expect(r.strataCounts).toEqual({ 1: 0, 2: 2_500, 3: 2_500, 4: 2_500, 5: 2_500, 6: 0 })
    expect(r.bPrior.min).toBeGreaterThanOrEqual(STRATUM_B_CUTS[0]!)
    expect(r.bPrior.max).toBeLessThan(STRATUM_B_CUTS[4]!)
  }, 600_000)

  it('passes runFamilyProperties when the family picks the stratum', () => {
    const r = runFamilyProperties(rotation, { ...OPTS, n: 2_000 })
    for (const k of ROTATION_STRATA) expect(r.strataCounts[k]).toBeGreaterThan(400)
  }, 300_000)

  it('has the identity of a spatial MC item with 3PL c = 1/4 (A9)', () => {
    const item = rotation.generate('identity')
    expect(item.family).toBe('rotation')
    expect(item.axis).toBe('SPA')
    expect(item.facet).toBe('3d_rotation')
    expect(item.item_type).toBe('mc_image_spec')
    expect(item.options_count).toBe(4)
    expect(item.params).toEqual({ model: '3pl', a: 1, b: item.difficulty.b_prior, c: 0.25 })
    expect(item.difficulty.sd_prior).toBe(1)
    expect(item.difficulty.provenance).toMatch(/\[SPEC\] v0/)
    expect(item.time_limit_s).toBe(60)
    expect(item.spec.camera).toBe('iso_v1')
    expect(Object.keys(item.difficulty.features).sort()).toEqual(
      ['angle_deg', 'axis_view_cos', 'in_depth', 'n_arms', 'n_cubes', 'n_mirror_moved', 'n_moved'],
    )
  })

  it('targets strata through angle bins and refuses strata 1 and 6', () => {
    for (const k of ROTATION_STRATA) {
      const item = rotation.generate('bins', { stratum: k })
      expect(item.seed).toBe(`bins@s${k}`)
      expect(rotation.generate(`bins@s${k}`)).toEqual(item)
      const [lo, hi] = ANGLE_BINS[k as RotationStratum]
      expect(features(item).angle_deg).toBeGreaterThanOrEqual(lo)
      expect(features(item).angle_deg).toBeLessThan(hi)
    }
    expect(() => rotation.generate('bins', { stratum: 1 })).toThrow(RangeError)
    expect(() => rotation.generate('bins', { stratum: 6 })).toThrow(RangeError)
  })

  it('uses the [SPEC] v0 prior: ICAR anchor at 138°, +0.025 per degree, bins = default b bands', () => {
    expect(ROTATION_PRIOR.anchorB).toBeCloseTo(1.45, 3)
    expect(rotationBPrior({ angle_deg: 138 })).toBeCloseTo(1.45, 3)
    expect(rotationBPrior({ angle_deg: 178 })).toBeCloseTo(2.45, 3)
    for (const [k, [lo, hi]] of Object.entries(ANGLE_BINS)) {
      expect(stratumOfB(rotationBPrior({ angle_deg: lo + 0.001 }))).toBe(Number(k))
      expect(stratumOfB(rotationBPrior({ angle_deg: hi - 0.001 }))).toBe(Number(k))
    }
    expect(rotationExpectedTime(0)).toBe(20)
    expect(rotationExpectedTime(180)).toBe(40)
    for (const item of sample(200, 'prior')) {
      expect(item.expected_time_s).toBeGreaterThan(22)
      expect(item.expected_time_s).toBeLessThan(40)
      expect(item.expected_time_s).toBe(rotationExpectedTime(features(item).angle_deg))
    }
  })

  it('builds the options of §4.2 / A11: the target rotated, one mirror, two moved variants', () => {
    const kinds = { moved: 0, mirror_moved: 0 }
    for (const item of sample(400, 'kinds')) {
      const a = analyseRotation(item)
      expect(a).not.toBeNull()
      const k = a!.kinds
      expect(k.filter((x) => x === 'correct')).toHaveLength(1)
      expect(k.filter((x) => x === 'mirror')).toHaveLength(1)
      expect(k.filter((x) => x === 'moved' || x === 'mirror_moved')).toHaveLength(2)
      kinds.moved += features(item).n_moved
      kinds.mirror_moved += features(item).n_mirror_moved
      const t = item.spec.target.cubes as Cube[]
      expect(canonKey(mirror(t))).not.toBe(canonKey(t))
      const canons = item.spec.options.map((o) => canonKey(o.cubes as Cube[]))
      expect(new Set(canons).size).toBe(4)
      expect(features(item).n_arms).toBeGreaterThanOrEqual(3)
      expect(features(item).n_cubes).toBeGreaterThanOrEqual(8)
      expect(features(item).n_cubes).toBeLessThanOrEqual(10)
    }
    expect(kinds.moved).toBeGreaterThan(200)
    expect(kinds.mirror_moved).toBeGreaterThan(200)
  }, 60_000)

  it('spreads the key, the mirror and the depth/picture-plane axes evenly', () => {
    const items = sample(4_000, 'spread')
    const keyCounts = [0, 0, 0, 0]
    const mirrorCounts = [0, 0, 0, 0]
    let inDepth = 0
    for (const item of items) {
      keyCounts[item.key.index]!++
      mirrorCounts[analyseRotation(item)!.kinds.indexOf('mirror')]!++
      if (features(item).in_depth) inDepth++
    }
    expect(chiSquare(keyCounts)).toBeLessThan(CHI2_3_P999)
    expect(chiSquare(mirrorCounts)).toBeLessThan(CHI2_3_P999)
    expect(inDepth / items.length).toBeGreaterThan(0.45)
    expect(inDepth / items.length).toBeLessThan(0.55)
  }, 120_000)

  it('gives option-only heuristics no edge (≤ 1.5 × chance, M1.6 rule)', () => {
    const items = sample(4_000, 'heuristics')
    const overlap = (a: readonly Cube[], b: readonly Cube[]): number => {
      const s = new Set(a.map((c) => c.join(',')))
      return b.filter((c) => s.has(c.join(','))).length
    }
    const argBest = (xs: readonly number[], better: (a: number, b: number) => boolean): number =>
      xs.reduce((best, x, i) => (better(x, xs[best]!) ? i : best), 0)
    let nearestQuat = 0
    let mostOverlap = 0
    for (const item of items) {
      const { target, options } = item.spec
      const angles = options.map((o) => quatAngleDeg(quatMul(o.quat, quatConj(target.quat))))
      if (argBest(angles, (a, b) => a < b) === item.key.index) nearestQuat++
      const overlaps = options.map((o) => overlap(target.cubes, o.cubes))
      if (argBest(overlaps, (a, b) => a > b) === item.key.index) mostOverlap++
      expect(options.every((o) => sortedKey(o.cubes) !== sortedKey(target.cubes))).toBe(true)
    }
    expect(nearestQuat / items.length).toBeLessThan(0.375)
    expect(mostOverlap / items.length).toBeLessThan(0.375)
  }, 120_000)

  it('records the angle and axis the verifier recomputes from the quaternions', () => {
    for (const item of sample(300, 'angles')) {
      const a = analyseRotation(item)!
      expect(a.angleDeg).not.toBeNull()
      expect(Math.abs(a.angleDeg! - features(item).angle_deg)).toBeLessThan(1e-9)
      expect(Math.abs(a.axisViewCos! - features(item).axis_view_cos)).toBeLessThan(1e-12)
    }
  })

  it('scores the chosen option index', () => {
    const item = rotation.generate('score')
    const k = item.key.index
    expect(rotation.score(item, k)).toEqual({ correct: 1 })
    expect(rotation.score(item, (k + 1) % 4)).toEqual({ correct: 0 })
    expect(rotation.score(item, k + 0.5)).toEqual({ correct: 0 })
    expect(rotation.score(item, Number.NaN)).toEqual({ correct: 0 })
  })
})
