import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createRng } from '../../engine'
import {
  AXIS_STEPS,
  ROTATION_GROUP,
  achiralCanon,
  applyMat,
  armCount,
  canon,
  canonKey,
  chainInfo,
  chainKey,
  groupElementsMapping,
  isConnected,
  mat3FromQuat,
  mirror,
  movedVariants,
  normalise,
  quatAngleDeg,
  quatAxis,
  quatConj,
  quatFromAxisAngle,
  quatFromMat3,
  quatMul,
  quatNorm,
  randomQuat,
  sortedKey,
  symmetryOrder,
  type Cube,
  type Mat3,
} from './geometry'
import { drawTarget } from './gen'

/** The §12 item-record example target (4 arms: x2, y2, z2, x1). */
const S12: Cube[] = [
  [0, 0, 0],
  [1, 0, 0],
  [2, 0, 0],
  [2, 1, 0],
  [2, 2, 0],
  [2, 2, 1],
  [2, 2, 2],
  [3, 2, 2],
]

const matMul = (a: Mat3, b: Mat3): Mat3 =>
  [0, 1, 2].map((i) => [0, 1, 2].map((j) => [0, 1, 2].reduce((s, k) => s + a[i]![k]! * b[k]![j]!, 0))) as unknown as Mat3
const matKey = (m: Mat3): string => m.map((r) => r.join(',')).join(';')

/** Random chains from the generator's own target sampler (seeded, so failures reproduce). */
const targetArb = fc.integer({ min: 0, max: 1_000_000 }).map((s) => drawTarget(createRng(`geom-${s}`)))
const groupArb = fc.integer({ min: 0, max: 23 })
const shiftArb = fc.tuple(fc.integer({ min: -20, max: 20 }), fc.integer({ min: -20, max: 20 }), fc.integer({ min: -20, max: 20 }))

describe('the chiral octahedral group (§4.2 rotation_group)', () => {
  it('has 24 distinct proper signed permutation matrices, identity first, in §4.2 order', () => {
    expect(ROTATION_GROUP).toHaveLength(24)
    expect(new Set(ROTATION_GROUP.map(matKey)).size).toBe(24)
    // The first three elements of the §4.2 Python enumeration (itertools order, det = +1 kept).
    expect(ROTATION_GROUP.slice(0, 3)).toEqual([
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      [[1, 0, 0], [0, -1, 0], [0, 0, -1]],
      [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
    ])
  })

  it('is closed under composition', () => {
    const keys = new Set(ROTATION_GROUP.map(matKey))
    for (const a of ROTATION_GROUP) for (const b of ROTATION_GROUP) expect(keys.has(matKey(matMul(a, b)))).toBe(true)
  })

  it('maps to unit quaternions whose matrices round-trip', () => {
    for (const m of ROTATION_GROUP) {
      const q = quatFromMat3(m)
      expect(quatNorm(q)).toBeCloseTo(1, 12)
      mat3FromQuat(q).forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(m[i]![j]!, 12)))
    }
  })
})

describe('canon (§4.2)', () => {
  it('matches the §4.2 Python reference on the §12 example and its mirror', () => {
    // Computed with the DESIGN §4.2 code verbatim (numpy): canon(t) and canon(mirror(t)).
    expect(canon(S12)).toEqual([
      [0, 0, 0], [0, 0, 1], [0, 0, 2], [1, 0, 2], [2, 0, 2], [2, 1, 2], [2, 2, 2], [2, 2, 3],
    ])
    expect(canon(mirror(S12))).toEqual([
      [0, 0, 0], [0, 0, 1], [0, 0, 2], [0, 1, 2], [0, 2, 2], [1, 2, 2], [2, 2, 2], [2, 2, 3],
    ])
    expect(achiralCanon(S12)).toEqual(canon(mirror(S12)))
  })

  it('is invariant under every rotation, translation and cube order', () => {
    fc.assert(
      fc.property(targetArb, groupArb, shiftArb, fc.integer(), (t, g, [dx, dy, dz], seed) => {
        const moved = createRng(`order-${seed}`).shuffle(
          t.map((c) => applyMat(ROTATION_GROUP[g]!, c)).map(([x, y, z]): Cube => [x + dx, y + dy, z + dz]),
        )
        expect(canonKey(moved)).toBe(canonKey(t))
        expect(canon(moved)).toEqual(canon(t))
      }),
      { numRuns: 300 },
    )
  })

  it('is a sorted min-corner member of the orbit, and idempotent', () => {
    fc.assert(
      fc.property(targetArb, (t) => {
        const c = canon(t)
        expect(c).toEqual(normalise(c))
        expect(c).toEqual([...c].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]))
        expect(canon(c)).toEqual(c)
        expect(groupElementsMapping(t, c).length).toBeGreaterThan(0)
      }),
      { numRuns: 200 },
    )
  })

  it('separates mirror images of chiral shapes but not of planar ones', () => {
    expect(canonKey(mirror(S12))).not.toBe(canonKey(S12))
    const planar: Cube[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 1, 0], [2, 2, 0], [3, 2, 0], [4, 2, 0], [4, 3, 0]]
    expect(canonKey(mirror(planar))).toBe(canonKey(planar))
    expect(achiralCanon(mirror(S12))).toEqual(achiralCanon(S12))
  })
})

describe('chains and arms', () => {
  it('walks chains and counts straight runs', () => {
    expect(chainInfo(S12)?.arms).toBe(4)
    expect(armCount([[0, 0, 0], [1, 0, 0], [2, 0, 0]])).toBe(1)
    expect(chainInfo(S12)?.order).toHaveLength(8)
    expect(armCount(mirror(S12))).toBe(4)
  })

  it('rejects branches, cycles, gaps, duplicates and single cubes', () => {
    const branch: Cube[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [1, 1, 0], [1, 1, 1]]
    const cycle: Cube[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]
    const touching: Cube[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 1, 1]] // path whose ends touch
    const gap: Cube[] = [[0, 0, 0], [1, 0, 0], [3, 0, 0], [3, 1, 0]]
    const dup: Cube[] = [[0, 0, 0], [1, 0, 0], [1, 0, 0], [1, 1, 0]]
    for (const s of [branch, cycle, touching, gap, dup, [[0, 0, 0]] as Cube[]]) expect(chainInfo(s)).toBeNull()
    expect(isConnected(branch)).toBe(true)
    expect(isConnected(gap)).toBe(false)
  })
})

describe('one-cube-moved variants', () => {
  it('differ from the shape in one terminal cube and are chains with ≥ 3 arms', () => {
    fc.assert(
      fc.property(targetArb, (t) => {
        const ends = new Set(
          (chainInfo(t)?.order ?? []).filter((_, i, a) => i === 0 || i === a.length - 1).map((c) => c.join(',')),
        )
        const own = new Set(t.map((c) => c.join(',')))
        const variants = movedVariants(t)
        expect(variants.length).toBeGreaterThan(0)
        for (const v of variants) {
          const vs = new Set(v.map((c) => c.join(',')))
          const removed = t.filter((c) => !vs.has(c.join(',')))
          const added = v.filter((c) => !own.has(c.join(',')))
          expect(v).toHaveLength(t.length)
          expect(removed).toHaveLength(1)
          expect(added).toHaveLength(1)
          expect(ends.has(removed[0]!.join(','))).toBe(true)
          expect(armCount(v)).toBeGreaterThanOrEqual(3)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('is a symmetric relation: the shape is a moved variant of each of its variants', () => {
    fc.assert(
      fc.property(targetArb, (t) => {
        const key = canonKey(t)
        for (const v of movedVariants(t)) expect(movedVariants(v).map(canonKey)).toContain(key)
      }),
      { numRuns: 50 },
    )
  })

  it('finds exactly the brute-force variants on a hand-checked chain', () => {
    const l: Cube[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 1, 0], [2, 1, 1]] // x2 y1 z1
    const keys = new Set(movedVariants(l).map(sortedKey))
    // End (0,0,0) → (1,-1,0), touching only (1,0,0): steps +y +x +y +z, 4 arms, a variant.
    expect(keys.has(sortedKey([[1, -1, 0], [1, 0, 0], [2, 0, 0], [2, 1, 0], [2, 1, 1]]))).toBe(true)
    // End (0,0,0) → (1,1,0) touches (1,0,0) and (2,1,0): not a chain, never a variant.
    expect(keys.has(sortedKey([[1, 1, 0], [1, 0, 0], [2, 0, 0], [2, 1, 0], [2, 1, 1]]))).toBe(false)
    // End (2,1,1) → (-1,0,0): steps +x +x +x +y, only 2 arms, rejected.
    expect(keys.has(sortedKey([[-1, 0, 0], [0, 0, 0], [1, 0, 0], [2, 0, 0], [2, 1, 0]]))).toBe(false)
    // Every variant is one of these: remove an end, re-attach at an end of the rest.
    expect(movedVariants(l).every((v) => chainInfo(v) !== null)).toBe(true)
  })
})

describe('chain keys', () => {
  it('equal iff the §4.2 canonical forms are equal (on targets, mirrors and moved variants)', () => {
    fc.assert(
      fc.property(targetArb, targetArb, groupArb, (t, u, g) => {
        const shapes = [t, mirror(t), ...movedVariants(t), u, mirror(u), t.map((c) => applyMat(ROTATION_GROUP[g]!, c))]
        const ck = shapes.map((s) => chainKey(s))
        const cc = shapes.map((s) => canonKey(s))
        for (let i = 0; i < shapes.length; i++) {
          expect(ck[i]).not.toBeNull()
          for (let j = 0; j < i; j++) expect(ck[i] === ck[j]).toBe(cc[i] === cc[j])
        }
      }),
      { numRuns: 150 },
    )
  })

  it('is null for non-chains', () => {
    expect(chainKey([[0, 0, 0], [1, 0, 0], [2, 0, 0], [1, 1, 0]])).toBeNull()
  })
})

describe('symmetry', () => {
  it('finds the C2 symmetry of x³y²z³ (chiral but symmetric) and none for the §12 shape', () => {
    const c2: Cube[] = [[0, 0, 0]]
    for (const [d, k] of [[AXIS_STEPS[0]!, 3], [AXIS_STEPS[2]!, 2], [AXIS_STEPS[4]!, 3]] as const) {
      for (let i = 0; i < k; i++) {
        const [x, y, z] = c2[c2.length - 1]!
        c2.push([x + d[0], y + d[1], z + d[2]])
      }
    }
    expect(c2).toHaveLength(9)
    expect(symmetryOrder(c2)).toBe(2)
    expect(canonKey(mirror(c2))).not.toBe(canonKey(c2))
    expect(symmetryOrder(S12)).toBe(1)
  })
})

describe('quaternions', () => {
  it('composes, measures angles and axes', () => {
    fc.assert(
      fc.property(fc.integer(), fc.double({ min: 1, max: 179, noNaN: true }), (seed, angle) => {
        const rng = createRng(`quat-${seed}`)
        const qa = randomQuat(rng)
        expect(quatNorm(qa)).toBeCloseTo(1, 12)
        expect(qa[0]).toBeGreaterThanOrEqual(0)
        const axis = [0.6, 0, 0.8] as const
        const r = quatFromAxisAngle(axis, angle)
        const rel = quatMul(quatMul(r, qa), quatConj(qa))
        expect(quatAngleDeg(rel)).toBeCloseTo(angle, 9)
        const u = quatAxis(r)
        expect(Math.abs(u[0] * 0.6 + u[2] * 0.8)).toBeCloseTo(1, 12)
      }),
      { numRuns: 200 },
    )
  })

  it('mat3FromQuat rotates like the group matrices', () => {
    for (const m of ROTATION_GROUP) {
      const r = mat3FromQuat(quatFromMat3(m))
      for (const c of S12) {
        const a = applyMat(m, c)
        const b = [0, 1, 2].map((i) => r[i]![0] * c[0] + r[i]![1] * c[1] + r[i]![2] * c[2])
        b.forEach((v, i) => expect(v).toBeCloseTo(a[i]!, 12))
      }
    }
  })
})
