/**
 * The torsion template of generator 1.4.0 (ROADMAP M3.12: harder items at the top; requested
 * strata 5 and 6): generation, prior, option structure, option-only cues, the verifier's torsion
 * checks with hand-tampered items, and the geometry of one-joint torsion variants.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createRng } from '../../engine'
import { itemParamsFor } from '../family'
import { STRATUM_B_CUTS, stratumOfB } from '../priors'
import { runFamilyProperties } from '../testing'
import {
  ROTATION_GROUP,
  achiralCanon,
  applyMat,
  armCount,
  armLengths,
  canonKey,
  centreSpreadSq,
  chainInfo,
  chainKey,
  groupElementsMapping,
  mirror,
  movedVariants,
  normalise,
  quatAngleDeg,
  quatConj,
  quatFromAxisAngle,
  quatFromMat3,
  quatMul,
  quatNormalize,
  sortedKey,
  torsionVariantChains,
  type Cube,
} from './geometry'
import { drawHardTarget, hardMaxArms, isCompact, isHardTargetLike, torsionDistractorPairs } from './gen'
import {
  HARD_ANGLE_RANGE,
  HARD_STRATA,
  hardAngleBin,
  hardBonus,
  rotationHardBPrior,
  rotationHardExpectedTime,
} from './prior'
import { HARD_FEATURE_NAMES, ISO_V1_VIEW_AXIS, OBLIQUE_MAX_COS, OBLIQUE_MIN_COS, type HardRotationFeatures, type RotationItem } from './spec'
import { analyseRotation, rotationSpecLeaksKey, verifyRotation } from './verify'
import { rotation } from '.'

type Loose = { -readonly [K in keyof RotationItem]: any }

const OPTS = {
  familyIdRatio: { min: 0.5, reason: 'torsion targets: 10–14 cubes, 5–7 arms, a large class space' },
  specLeaksKey: rotationSpecLeaksKey,
  correctResponse: (item: RotationItem) => item.key.index,
  incorrectResponse: (item: RotationItem) => (item.key.index + 1) % 4,
  malformedResponses: () => [-1, 4, 1.5, '0', [0]],
} as const

const hf = (item: RotationItem): HardRotationFeatures => item.difficulty.features as unknown as HardRotationFeatures
const hard = (n: number, prefix: string, k: 5 | 6): RotationItem[] => Array.from({ length: n }, (_, i) => rotation.generate(`${prefix}-${i}@s${k}`))
const both = (n: number, prefix: string): RotationItem[] => [...hard(n / 2, prefix, 5), ...hard(n / 2, prefix, 6)]

const chiSquare = (counts: readonly number[]): number => {
  const total = counts.reduce((a, b) => a + b, 0)
  const e = total / counts.length
  return counts.reduce((s, c) => s + (c - e) ** 2 / e, 0)
}
const CHI2_3_P999 = 16.27
const hitRate = (scores: readonly number[], key: number): number => {
  const best = Math.max(...scores)
  const top = scores.flatMap((x, i) => (x === best ? [i] : []))
  return top.includes(key) ? 1 / top.length : 0
}
const achiralKey = (cubes: readonly Cube[]): string => achiralCanon(cubes).join(';')
const lengthsOf = (cubes: readonly Cube[]): string => armLengths(chainInfo(cubes)!).join(',')

describe('rotation 1.4.0: the torsion template of strata 5 and 6 (M3.12)', () => {
  it('passes runFamilyProperties at n = 2,000 on requested strata 5–6', () => {
    const r = runFamilyProperties(rotation, { ...OPTS, n: 2_000, strata: [5, 6], seedPrefix: 'torsion-' })
    expect(r.strataCounts).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 1_000, 6: 1_000 })
    expect(r.distinctContents).toBe(2_000)
    expect(r.distinctFamilyIds).toBeGreaterThan(1_700)
    expect(r.bPrior.min).toBeGreaterThanOrEqual(STRATUM_B_CUTS[3] as number)
    expect(r.bPrior.max).toBeLessThan(3.7)
  }, 300_000)

  it('draws every requested stratum 5 or 6 from the torsion template, and nothing else from it', () => {
    expect(HARD_STRATA).toEqual([5, 6])
    for (const item of both(200, 'which')) {
      expect(hf(item).template).toBe('torsion')
      expect(Object.keys(item.difficulty.features).sort()).toEqual([...HARD_FEATURE_NAMES].sort())
      expect(analyseRotation(item)!.template).toBe('torsion')
    }
    for (let i = 0; i < 300; i++) {
      for (const seed of [`which-${i}`, `which-${i}@s${2 + (i % 3)}`]) {
        expect((rotation.generate(seed).difficulty.features as Record<string, unknown>).template).toBeUndefined()
      }
    }
  })

  it('has b in the band (≈ 1.6–2.5 and 2.5–3.7), E[T] ≈ 47–66 s and the shared 180 s cap', () => {
    for (const k of [5, 6] as const) {
      const items = hard(300, 'band', k)
      const bs = items.map((it) => it.difficulty.b_prior)
      const ts = items.map((it) => it.expected_time_s)
      for (const it of items) {
        const f = hf(it)
        expect(it.stratum).toBe(k)
        expect(stratumOfB(it.difficulty.b_prior)).toBe(k)
        expect(it.difficulty.b_prior).toBe(rotationHardBPrior(f))
        expect(it.expected_time_s).toBe(rotationHardExpectedTime(f.angle_deg, f.n_cubes))
        expect(it.time_limit_s).toBe(180)
        expect(it.params).toEqual({ model: '3pl', a: 1, b: it.difficulty.b_prior, c: 0.25 })
        expect(f.angle_deg).toBeGreaterThanOrEqual(HARD_ANGLE_RANGE[0])
        expect(f.angle_deg).toBeLessThan(HARD_ANGLE_RANGE[1])
        expect(f.oblique).toBe(true)
        expect(f.in_depth).toBe(true)
        expect(f.axis_view_cos).toBeGreaterThanOrEqual(OBLIQUE_MIN_COS)
        expect(f.axis_view_cos).toBeLessThan(OBLIQUE_MAX_COS)
      }
      expect(Math.min(...ts)).toBeGreaterThan(46)
      expect(Math.max(...ts)).toBeLessThan(67)
      if (k === 5) expect([Math.min(...bs), Math.max(...bs)]).toEqual([expect.closeTo(1.6, 0), expect.closeTo(2.5, 1)])
      else expect(Math.max(...bs)).toBeGreaterThan(3.4)
    }
  })

  it('fills both strata for every cube and arm count: the angle bins are never empty', () => {
    for (let n = 10; n <= 14; n++) {
      for (let arms = 5; arms <= hardMaxArms(n); arms++) {
        const bonus = hardBonus({ oblique: true, n_cubes: n, n_arms: arms })
        expect(bonus).toBeGreaterThanOrEqual(0.85 - 1e-12)
        expect(bonus).toBeLessThanOrEqual(1.25 + 1e-12)
        for (const k of [5, 6] as const) {
          const bin = hardAngleBin(k, bonus)!
          expect(bin[1] - bin[0], `${n} cubes, ${arms} arms, stratum ${k}`).toBeGreaterThan(15)
          for (const a of [bin[0] + 1e-6, bin[1] - 1e-6]) expect(stratumOfB(rotationHardBPrior({ angle_deg: a, oblique: true, n_cubes: n, n_arms: arms }))).toBe(k)
        }
      }
    }
  })

  it('shows the target rotated, its mirror and a torsion pair, all with the target\'s cubes per arm', () => {
    const counts = { torsion: 0, mirror_torsion: 0 }
    const cubes = new Map<number, number>()
    const arms = new Map<number, number>()
    for (const item of both(400, 'kinds')) {
      const a = analyseRotation(item)!
      expect([...a.kinds].sort()).toEqual(['correct', 'mirror', ...(['torsion', 'mirror_torsion'] as const).flatMap((k) => a.kinds.filter((x) => x === k))].sort())
      expect(a.kinds.filter((x) => x === 'torsion' || x === 'mirror_torsion')).toHaveLength(2)
      counts.torsion += hf(item).n_torsion
      counts.mirror_torsion += hf(item).n_mirror_torsion
      const t = item.spec.target.cubes as Cube[]
      const want = lengthsOf(t)
      for (const o of item.spec.options) {
        expect(lengthsOf(o.cubes as Cube[])).toBe(want)
        expect(o.cubes).toHaveLength(t.length)
        expect(isCompact(o.cubes as Cube[])).toBe(true)
      }
      expect(isHardTargetLike(t)).toBe(true)
      expect(new Set(item.spec.options.map((o) => canonKey(o.cubes as Cube[]))).size).toBe(4)
      cubes.set(t.length, (cubes.get(t.length) ?? 0) + 1)
      arms.set(hf(item).n_arms, (arms.get(hf(item).n_arms) ?? 0) + 1)
    }
    expect(counts.torsion).toBeGreaterThan(100)
    expect(counts.mirror_torsion).toBeGreaterThan(100)
    expect([...cubes.keys()].sort()).toEqual([10, 11, 12, 13, 14])
    expect([...arms.keys()].sort()).toEqual([5, 6, 7])
  }, 60_000)

  it('spreads the key and the mirror evenly and gives option-only cues no edge', () => {
    const items = both(3_000, 'cues')
    const keyCounts = [0, 0, 0, 0]
    const mirrorCounts = [0, 0, 0, 0]
    const hits = { nearestQuat: 0, mostOverlap: 0, enantiomerPair: 0, mostArms: 0, armLengths: 0, mostCompact: 0, leastCompact: 0, mostUTurns: 0, fewestUTurns: 0 }
    const uTurns = (cubes: readonly Cube[]): number => {
      const o = chainInfo(cubes)!.order
      const d = o.slice(1).map((c, i) => [c[0] - o[i]![0], c[1] - o[i]![1], c[2] - o[i]![2]] as const)
      const runs = d.filter((s, i) => i === 0 || s.join() !== d[i - 1]!.join())
      return runs.slice(2).filter((s, i) => s.every((v, j) => v === -runs[i]![j]!)).length
    }
    for (const item of items) {
      const { target, options } = item.spec
      const k = item.key.index
      const cs = options.map((o) => o.cubes as Cube[])
      keyCounts[k]!++
      mirrorCounts[analyseRotation(item)!.kinds.indexOf('mirror')]!++
      hits.nearestQuat += hitRate(options.map((o) => -quatAngleDeg(quatMul(o.quat, quatConj(target.quat)))), k)
      const own = new Set(target.cubes.map((c) => c.join(',')))
      hits.mostOverlap += hitRate(cs.map((c) => c.filter((x) => own.has(x.join(','))).length), k)
      const achiral = cs.map(achiralKey)
      hits.enantiomerPair += hitRate(achiral.map((a) => achiral.filter((b) => b === a).length), k)
      hits.mostArms += hitRate(cs.map(armCount), k)
      hits.armLengths += hitRate(cs.map((c) => (lengthsOf(c) === lengthsOf(target.cubes as Cube[]) ? 1 : 0)), k)
      hits.mostCompact += hitRate(cs.map((c) => -centreSpreadSq(c)), k)
      hits.leastCompact += hitRate(cs.map(centreSpreadSq), k)
      hits.mostUTurns += hitRate(cs.map(uTurns), k)
      hits.fewestUTurns += hitRate(cs.map((c) => -uTurns(c)), k)
      expect(options.every((o) => sortedKey(o.cubes) !== sortedKey(target.cubes))).toBe(true)
    }
    expect(chiSquare(keyCounts)).toBeLessThan(CHI2_3_P999)
    expect(chiSquare(mirrorCounts)).toBeLessThan(CHI2_3_P999)
    for (const [name, h] of Object.entries(hits)) expect({ name, rate: h / items.length }).toEqual({ name, rate: expect.closeTo(0.25, 1) })
  }, 180_000)

  it('has well over 100 distinct structures per stratum (§7.7 exposure)', () => {
    for (const k of [5, 6] as const) {
      const ids = hard(1_000, 'fid', k).map((it) => it.family_id)
      expect(new Set(ids.slice(0, 100)).size).toBeGreaterThanOrEqual(95)
      expect(new Set(ids).size).toBeGreaterThan(900)
    }
  }, 120_000)

  it('generates a torsion item in a few ms on average', () => {
    const t0 = performance.now()
    hard(500, 'speed', 6)
    expect((performance.now() - t0) / 500).toBeLessThan(25)
  }, 60_000)

  it('draws torsion distractors as hard-target-like enantiomer pairs (target and W can swap)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (seed) => {
        const t = drawHardTarget(createRng(`tpairs-${seed}`))
        expect(isHardTargetLike(t)).toBe(true)
        const own = new Set([chainKey(t), chainKey(mirror(t))])
        const want = new Set(
          torsionVariantChains(t)
            .map((v) => v.cubes)
            .filter((v) => !own.has(chainKey(v)) && isHardTargetLike(v))
            .map(achiralKey),
        )
        const pairs = torsionDistractorPairs(t)
        expect(new Set(pairs.map(achiralKey))).toEqual(want)
        expect(pairs).toHaveLength(want.size)
        for (const w of pairs) {
          expect(new Set([t, mirror(t), w, mirror(w)].map(canonKey)).size).toBe(4)
          expect(torsionDistractorPairs(w).map(achiralKey)).toContain(achiralKey(t))
        }
      }),
      { numRuns: 100 },
    )
  }, 60_000)
})

describe('one-joint torsion variants (geometry)', () => {
  /** A chain from per-arm (axis index, length) runs. */
  const runs = (spec: readonly (readonly [number, number])[]): Cube[] => {
    const steps: [number, number, number][] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ]
    const out: Cube[] = [[0, 0, 0]]
    for (const [s, len] of spec) {
      for (let i = 0; i < len; i++) {
        const [x, y, z] = out[out.length - 1]!
        const d = steps[s]!
        out.push([x + d[0], y + d[1], z + d[2]])
      }
    }
    return normalise(out)
  }

  it('turns only after an interior arm: none for three-arm chains with one interior arm turned 0°', () => {
    // +x3 +y2 +z2: one interior arm (+y), so up to three variants (the +z arm turned about y).
    const t = runs([
      [0, 3],
      [2, 2],
      [4, 2],
    ])
    const v = torsionVariantChains(t)
    expect(v.length).toBeLessThanOrEqual(3)
    for (const x of v) expect(lengthsOf(x.cubes)).toBe(lengthsOf(t))
    // A two-arm L has no interior arm: no variant.
    expect(
      torsionVariantChains(
        runs([
          [0, 3],
          [2, 3],
        ]),
      ),
    ).toEqual([])
  })

  it('keeps cube count, arm count and cubes per arm; changes the class; is symmetric (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (seed) => {
        const t = drawHardTarget(createRng(`tv-${seed}`))
        const vs = torsionVariantChains(t)
        expect(vs.length).toBeLessThanOrEqual(3 * (armCount(t) - 2))
        // ≥ 2 cubes on each side of the turned arm, so a variant always puts ≥ 2 cubes on new cells
        // (in the target's own frame): it is never just an end cube moved.
        const cells = new Set(t.map((c) => c.join(',')))
        for (const v of vs) expect(v.cubes.filter((c) => !cells.has(c.join(','))).length).toBeGreaterThanOrEqual(2)
        for (const v of vs) {
          expect(v.cubes).toHaveLength(t.length)
          expect(v.info.arms).toBe(armCount(t))
          expect(lengthsOf(v.cubes)).toBe(lengthsOf(t))
          expect(chainKey(v.cubes)).not.toBe(chainKey(t))
          expect(torsionVariantChains(v.cubes).map((w) => chainKey(w.cubes))).toContain(chainKey(t))
        }
      }),
      { numRuns: 200 },
    )
  })

  it('armLengths reads a chain the same from either end and under any rotation or reflection', () => {
    const t = runs([
      [0, 3],
      [2, 1],
      [4, 2],
      [1, 2],
      [3, 1],
    ])
    const want = lengthsOf(t)
    expect(want).toBe('1,2,2,1,3')
    for (const g of ROTATION_GROUP) {
      expect(lengthsOf(t.map((c) => applyMat(g, c)))).toBe(want)
      expect(lengthsOf(mirror(t.map((c) => applyMat(g, c))))).toBe(want)
    }
    expect(lengthsOf([...t].reverse())).toBe(want)
  })

  it('centreSpreadSq is n² × the squared largest centroid distance', () => {
    const line = runs([[0, 3]]) // 4 cubes on a line: centroid at 1.5, max distance 1.5
    expect(centreSpreadSq(line)).toBe(16 * 2.25)
    expect(isCompact(runs([[0, 9]]))).toBe(false) // 10 in a row: 4.5 > √18
  })
})

describe('rotation verifier: the torsion template (G2/G3 for strata 5–6)', () => {
  const base = (): Loose => JSON.parse(JSON.stringify(rotation.generate('torsion-negative@s6'))) as Loose
  const tamper = (x: Loose, f: (y: Loose) => void): Loose => {
    const y = JSON.parse(JSON.stringify(x)) as Loose
    f(y)
    return y
  }
  const falseChecks = (x: Loose): string[] => {
    const v = verifyRotation(x as RotationItem)
    expect(v.ok).toBe(false)
    return Object.entries(v.checks)
      .filter(([, ok]) => ok === false)
      .map(([k]) => k)
      .sort()
  }
  const failsOnly = (x: Loose, ...checks: string[]): void => expect(falseChecks(x)).toEqual([...checks].sort())
  const failsAtLeast = (x: Loose, ...checks: string[]): void => expect(falseChecks(x)).toEqual(expect.arrayContaining(checks))
  const indexOfKind = (x: Loose, kind: string): number => analyseRotation(x as RotationItem)!.kinds.indexOf(kind as never)
  /** Show `shape` as option i (re-expressed under group element 7 and listed from its 3rd cube). */
  const showAs = (x: Loose, i: number, shape: readonly Cube[]): void => {
    const c = normalise(shape.map((p) => applyMat(ROTATION_GROUP[7]!, p)))
    x.spec.options[i].cubes = [...c.slice(3), ...c.slice(0, 3)].map((p) => [...p])
  }

  it('accepts generated torsion items with every check true, 30 of them', () => {
    const v = verifyRotation(base() as RotationItem)
    expect(v.reason).toBe('ok')
    expect(Object.keys(v.checks)).toEqual(expect.arrayContaining(['torsion_distractors', 'arm_lengths_shared', 'axis_oblique', 'compact']))
    expect(v.checks.moved_distractors).toBeUndefined()
    expect(Object.values(v.checks).filter((c) => typeof c === 'boolean')).toHaveLength(31)
  })

  it('checks the recorded template: without it the classic rules reject the item; on a classic item the torsion rules do', () => {
    failsAtLeast(tamper(base(), (y) => delete y.difficulty.features.template), 'features_complete')
    const classic = JSON.parse(JSON.stringify(rotation.generate('torsion-negative@s3'))) as Loose
    const relabelled = tamper(classic, (y) => Object.assign(y.difficulty.features, { template: 'torsion', oblique: true, n_torsion: 1, n_mirror_torsion: 1 }))
    failsAtLeast(relabelled, 'torsion_distractors', 'stratum_matches')
    failsAtLeast(tamper(base(), (y) => (y.difficulty.features.template = 'Torsion')), 'features_complete')
  })

  it('torsion_distractors / distractors_paired / arm_lengths_shared: a one-cube-moved distractor in place of a torsion one', () => {
    const x = base()
    const t = x.spec.target.cubes as Cube[]
    const i = analyseRotation(x as RotationItem)!.kinds.findIndex((k) => k === 'torsion' || k === 'mirror_torsion')
    const own = new Set(t.length ? [chainKey(t), chainKey(mirror(t))] : [])
    const moved = movedVariants(t).find((v) => !own.has(chainKey(v)) && lengthsOf(v) !== lengthsOf(t))!
    failsAtLeast(tamper(x, (y) => showAs(y, i, moved)), 'torsion_distractors', 'distractors_paired', 'arm_lengths_shared')
  })

  it('distractors_paired: two torsion distractors that are not mirror images of each other', () => {
    const x = base()
    const t = x.spec.target.cubes as Cube[]
    const a = analyseRotation(x as RotationItem)!
    const idx = a.kinds.flatMap((k, i) => (k === 'torsion' || k === 'mirror_torsion' ? [i] : []))
    const shown = new Set(x.spec.options.map((o: { cubes: Cube[] }) => chainKey(o.cubes)))
    const shownMirrors = new Set(x.spec.options.map((o: { cubes: Cube[] }) => chainKey(mirror(o.cubes))))
    const other = torsionVariantChains(t)
      .map((v) => v.cubes)
      .find((v) => !shown.has(chainKey(v)) && !shownMirrors.has(chainKey(v)) && chainKey(v) !== chainKey(mirror(t)) && isCompact(v))!
    expect(other).toBeDefined()
    const y = tamper(x, (z) => showAs(z, idx[1]!, other))
    const kinds = analyseRotation(y as RotationItem)!.kinds
    y.difficulty.features.n_torsion = kinds.filter((k) => k === 'torsion').length
    y.difficulty.features.n_mirror_torsion = kinds.filter((k) => k === 'mirror_torsion').length
    failsOnly(y, 'distractors_paired')
  })

  it('one_mirror / unique_rotation_match: the mirror replaced by a second rotation of the target', () => {
    const x = base()
    failsAtLeast(tamper(x, (y) => showAs(y, indexOfKind(x, 'mirror'), x.spec.target.cubes)), 'one_mirror', 'unique_rotation_match', 'options_pairwise_distinct')
  })

  it('axis_oblique: the key option turned about the line of sight (recorded consistently)', () => {
    const x = base()
    const k = x.key.index as number
    const t = x.spec.target.cubes as Cube[]
    const g = groupElementsMapping(t, x.spec.options[k].cubes)[0]!
    const angle = hf(x as RotationItem).angle_deg
    const y = tamper(x, (z) => {
      z.spec.options[k].quat = [...quatNormalize(quatMul(quatMul(quatFromAxisAngle(ISO_V1_VIEW_AXIS, angle), z.spec.target.quat), quatConj(quatFromMat3(ROTATION_GROUP[g]!))))]
      const a = analyseRotation(z as RotationItem)!
      const f = z.difficulty.features
      Object.assign(f, { angle_deg: a.angleDeg, axis_view_cos: a.axisViewCos, in_depth: a.axisViewCos! < Math.SQRT1_2, oblique: false })
      z.difficulty.b_prior = rotationHardBPrior(f)
      z.stratum = stratumOfB(z.difficulty.b_prior)
      z.params = itemParamsFor(4, 1, z.difficulty.b_prior)
      z.expected_time_s = rotationHardExpectedTime(f.angle_deg, f.n_cubes)
    })
    failsOnly(y, 'axis_oblique')
    failsAtLeast(tamper(x, (z) => (z.difficulty.features.oblique = false)), 'axis_oblique', 'prior_matches')
  })

  it('stratum_matches / prior_matches / counts_match / time_matches: bookkeeping off the torsion model', () => {
    failsOnly(tamper(base(), (y) => (y.stratum = 5)), 'stratum_matches')
    failsOnly(
      tamper(base(), (y) => {
        y.difficulty.b_prior += 0.001
        y.params = itemParamsFor(4, 1, y.difficulty.b_prior)
      }),
      'prior_matches',
    )
    failsOnly(tamper(base(), (y) => (y.difficulty.features.n_torsion = 3)), 'counts_match')
    failsOnly(tamper(base(), (y) => (y.difficulty.features.n_moved = 1)), 'counts_match')
    failsOnly(tamper(base(), (y) => (y.expected_time_s += 1)), 'time_matches')
    // The classic E[T] is not the torsion E[T].
    const f = hf(base() as RotationItem)
    expect(rotationHardExpectedTime(f.angle_deg, f.n_cubes)).toBeGreaterThan(20 + f.angle_deg / 9)
  })
})
