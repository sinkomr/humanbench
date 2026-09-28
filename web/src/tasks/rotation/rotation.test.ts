import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createRng } from '../../engine'
import { STRATUM_B_CUTS, stratumOfB } from '../priors'
import { runFamilyProperties } from '../testing'
import {
  achiralCanon,
  armCount,
  canonKey,
  chainKey,
  indexAligned,
  mirror,
  movedVariants,
  quatAngleDeg,
  quatConj,
  quatMul,
  sortedKey,
  type Cube,
} from './geometry'
import { drawTarget, isTargetLike, movedDistractorPairs } from './gen'
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
/** χ²(3) and χ²(11) 99.9th percentiles. */
const CHI2_3_P999 = 16.27
const CHI2_11_P999 = 31.26

/** Expected hit rate of picking uniformly among the options with the highest score. */
const hitRate = (scores: readonly number[], key: number): number => {
  const best = Math.max(...scores)
  const top = scores.flatMap((x, i) => (x === best ? [i] : []))
  return top.includes(key) ? 1 / top.length : 0
}

/** Consecutive list entries that are face neighbours (every one in a chain listed in path order). */
const adjacentInList = (cubes: readonly Cube[]): number =>
  cubes.slice(1).filter((c, i) => Math.abs(c[0] - cubes[i]![0]) + Math.abs(c[1] - cubes[i]![1]) + Math.abs(c[2] - cubes[i]![2]) === 1).length

const achiralKey = (cubes: readonly Cube[]): string => achiralCanon(cubes).join(';')

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
    expect(item.time_limit_s).toBe(180) // the shared power-item cap (§13, POWER_TIME_LIMIT_S)
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

  it('spreads the key, the mirror, their joint positions and the depth/picture-plane axes evenly', () => {
    const items = sample(4_000, 'spread')
    const keyCounts = [0, 0, 0, 0]
    const mirrorCounts = [0, 0, 0, 0]
    const joint = new Map<string, number>()
    let inDepth = 0
    for (const item of items) {
      const m = analyseRotation(item)!.kinds.indexOf('mirror')
      keyCounts[item.key.index]!++
      mirrorCounts[m]!++
      joint.set(`${item.key.index},${m}`, (joint.get(`${item.key.index},${m}`) ?? 0) + 1)
      if (features(item).in_depth) inDepth++
    }
    expect(chiSquare(keyCounts)).toBeLessThan(CHI2_3_P999)
    expect(chiSquare(mirrorCounts)).toBeLessThan(CHI2_3_P999)
    // The option order must not encode the key through the mirror's position (e.g. a cyclic
    // order with the mirror always right after the key): all 12 ordered pairs equally often.
    expect(joint.size).toBe(12)
    expect(chiSquare([...joint.values()])).toBeLessThan(CHI2_11_P999)
    expect(inDepth / items.length).toBeGreaterThan(0.45)
    expect(inDepth / items.length).toBeLessThan(0.55)
  }, 120_000)

  it('gives option-only and display heuristics no edge (≤ 1.5 × chance, M1.6 rule)', () => {
    const items = sample(4_000, 'heuristics')
    const overlap = (a: readonly Cube[], b: readonly Cube[]): number => {
      const s = new Set(a.map((c) => c.join(',')))
      return b.filter((c) => s.has(c.join(','))).length
    }
    const hits = { nearestQuat: 0, mostOverlap: 0, enantiomerPair: 0, mostArms: 0, fewestArms: 0 }
    for (const item of items) {
      const { target, options } = item.spec
      const k = item.key.index
      const cubes = options.map((o) => o.cubes)
      // Target-relative cues the generator randomises: display pose and raw coordinates.
      hits.nearestQuat += hitRate(options.map((o) => -quatAngleDeg(quatMul(o.quat, quatConj(target.quat)))), k)
      hits.mostOverlap += hitRate(cubes.map((c) => overlap(target.cubes, c)), k)
      // Option-only cues (review M1.5): an option whose mirror image is also offered (once only
      // the key and the mirror were such a pair: ~49%), and arm counts (target vs moved variant).
      const achiral = cubes.map(achiralKey)
      hits.enantiomerPair += hitRate(achiral.map((a) => achiral.filter((b) => b === a).length), k)
      const arms = cubes.map(armCount)
      hits.mostArms += hitRate(arms, k)
      hits.fewestArms += hitRate(arms.map((a) => -a), k)
      expect(options.every((o) => sortedKey(o.cubes) !== sortedKey(target.cubes))).toBe(true)
    }
    // Within ±0.05 of chance: stricter than ≤ 1.5 × chance, and a cue that works *against* the
    // key (e.g. "fewest arms", 10% before the review fix) is a leak as well.
    for (const [name, h] of Object.entries(hits)) expect({ name, rate: h / items.length }).toEqual({ name, rate: expect.closeTo(0.25, 1) })
  }, 120_000)

  it('shuffles every cube list, so no option lines up with the target (§4.2 no leak)', () => {
    let adjTarget = 0
    let pairsTarget = 0
    let adjOptions = 0
    let pairsOptions = 0
    for (const item of sample(2_000, 'order')) {
      const t = item.spec.target.cubes
      adjTarget += adjacentInList(t)
      pairsTarget += t.length - 1
      for (const o of item.spec.options) {
        adjOptions += adjacentInList(o.cubes)
        pairsOptions += o.cubes.length - 1
        expect(indexAligned(t, o.cubes)).toBe(false)
      }
    }
    // Listed in path order every consecutive pair is adjacent; shuffled, a fraction ≈ 2/n.
    expect(adjTarget / pairsTarget).toBeLessThan(0.35)
    expect(adjOptions / pairsOptions).toBeLessThan(0.35)
  }, 60_000)

  it('draws the moved distractors as target-like enantiomer pairs (target and V can swap)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (seed) => {
        const t = drawTarget(createRng(`pairs-${seed}`))
        const pairs = movedDistractorPairs(t)
        const own = new Set([chainKey(t), chainKey(mirror(t))])
        // Exactly the target-like variant classes (up to reflection) outside the target's own.
        const want = new Set(movedVariants(t).filter((v) => !own.has(chainKey(v)) && isTargetLike(v)).map(achiralKey))
        expect(new Set(pairs.map(achiralKey))).toEqual(want)
        expect(pairs).toHaveLength(want.size)
        for (const v of pairs) {
          expect(new Set([t, mirror(t), v, mirror(v)].map(canonKey)).size).toBe(4)
          // The relation is symmetric, so V could have been the target with t among its pairs.
          expect(movedDistractorPairs(v).map(achiralKey)).toContain(achiralKey(t))
        }
      }),
      { numRuns: 100 },
    )
  }, 60_000)

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
