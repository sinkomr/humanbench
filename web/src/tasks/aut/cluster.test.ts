import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { clusterCount, clusterIds } from './cluster'
import { normalise } from './vec'

const DIM = 24

/** The unit basis vector e_k in DIM dimensions. */
function e(k: number): Float32Array {
  const v = new Float32Array(DIM)
  v[k] = 1
  return v
}

/** normalise(Σ w_k e_k) for [k, w] pairs. */
function mix(...parts: readonly (readonly [number, number])[]): Float32Array {
  const v = new Float32Array(DIM)
  for (const [k, w] of parts) v[k] = (v[k] as number) + w
  return normalise(v)
}

/** Ids are numbered by first appearance: 0 first, and each new id is one more than the largest so far. */
function numberedByFirstAppearance(ids: readonly number[]): boolean {
  let next = 0
  for (const id of ids) {
    if (id === next) next++
    else if (id > next || id < 0) return false
  }
  return true
}

describe('clusterIds (M6.4; DESIGN §5.4 flexibility)', () => {
  it('no vectors, no clusters', () => {
    expect(clusterIds([], 0.4)).toEqual([])
  })

  it('a single vector is cluster 0', () => {
    expect(clusterIds([e(0)], 0.4)).toEqual([0])
  })

  it('orthogonal vectors stay apart; ids by first appearance', () => {
    expect(clusterIds([e(3), e(1), e(2)], 0.4)).toEqual([0, 1, 2])
  })

  it('groups two well-separated families', () => {
    // family A around e1, family B around e2 (each member adds a private direction)
    const a1 = mix([1, 1], [10, 0.6])
    const b1 = mix([2, 1], [11, 0.6])
    const a2 = mix([1, 1], [12, 0.6])
    const b2 = mix([2, 1], [13, 0.6])
    const a3 = mix([1, 1], [14, 0.6])
    expect(clusterIds([a1, b1, a2, b2, a3], 0.4)).toEqual([0, 1, 0, 1, 0])
    expect(clusterIds([b1, a1, a2, b2, a3], 0.4)).toEqual([0, 1, 1, 0, 1])
  })

  it('joins when the average linkage equals the threshold, not below it', () => {
    // cos(e1, mix(e1, e2)) = 1/√2
    const c = Math.SQRT1_2
    const vs = [e(1), mix([1, 1], [2, 1])]
    expect(clusterIds(vs, 0.7)).toEqual([0, 0])
    expect(clusterIds(vs, c + 1e-6)).toEqual([0, 1])
  })

  it('average linkage does not chain: a bridge joins one side only', () => {
    // x — y — z with cos(x,y) = cos(y,z) = 1/√2 and cos(x,z) = 0: single linkage at 0.4 would join all
    // three; average linkage joins x and y, after which ({x,y}, z) averages (0 + 1/√2)/2 ≈ 0.35
    const x = mix([1, 1])
    const y = mix([1, 1], [2, 1])
    const z = mix([2, 1])
    const ids = clusterIds([x, y, z], 0.4)
    expect(clusterCount(ids)).toBe(2)
    // tie (x,y) vs (y,z) at exactly the same cosine: the pair with the smaller names (0,1) joins first
    expect(ids).toEqual([0, 0, 1])
  })

  it('a threshold of -1 joins everything; a threshold above 1 joins nothing', () => {
    const vs = [e(0), e(1), mix([0, -1], [1, -1])]
    expect(clusterIds(vs, -1)).toEqual([0, 0, 0])
    expect(clusterIds([e(1), e(1)], 1.0001)).toEqual([0, 1])
  })

  it('identical vectors join at any threshold up to 1', () => {
    expect(clusterIds([e(4), e(4), e(4)], 1)).toEqual([0, 0, 0])
  })

  it('zero and non-finite vectors join nothing at a positive threshold', () => {
    const z = new Float32Array(DIM)
    const n = new Float32Array(DIM).fill(Number.NaN)
    expect(clusterIds([z, e(1), n, z], 0.4)).toEqual([0, 1, 2, 3])
  })

  it('accepts plain number arrays', () => {
    expect(clusterIds([[1, 0], [0.9, 0.1], [0, 1]], 0.5)).toEqual([0, 0, 1])
  })

  it('throws for a non-finite threshold or vectors of different lengths', () => {
    expect(() => clusterIds([e(0)], Number.NaN)).toThrow(RangeError)
    expect(() => clusterIds([e(0)], Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => clusterIds([[1, 0], [1, 0, 0]], 0.4)).toThrow(RangeError)
  })

  it('is deterministic', () => {
    const vs = Array.from({ length: 12 }, (_, i) => mix([i % 4, 1], [5 + i, 0.4 + (i % 3) * 0.3]))
    expect(clusterIds(vs, 0.4)).toEqual(clusterIds(vs, 0.4))
  })

  /** m well-separated families (centres e_0..e_{m-1}); member cosines within a family in about [0.4, 0.8]. */
  const families = fc.integer({ min: 1, max: 5 }).chain((m) =>
    fc.array(
      fc.record({ fam: fc.integer({ min: 0, max: m - 1 }), spread: fc.double({ min: 0.5, max: 1.2, noNaN: true }) }),
      { minLength: m, maxLength: 12 },
    ).map((members) => {
      // make sure every family is used
      const fixed = members.map((x, i) => (i < m ? { ...x, fam: i } : x))
      return { m, members: fixed }
    }),
  )

  it('property: well-separated families give one cluster each, in any order', () => {
    fc.assert(
      fc.property(families, fc.integer({ min: 0, max: 1_000_000 }), ({ m, members }, seed) => {
        const vecs = members.map((x, i) => mix([x.fam, 1], [6 + i, x.spread]))
        const ids = clusterIds(vecs, 0.4)
        expect(clusterCount(ids)).toBe(m)
        // the same family always shares an id, different families never do
        for (let i = 0; i < ids.length; i++)
          for (let j = 0; j < ids.length; j++)
            expect(ids[i] === ids[j]).toBe((members[i] as (typeof members)[number]).fam === (members[j] as (typeof members)[number]).fam)
        // a deterministic shuffle keeps the count
        const order = vecs.map((_, i) => i).sort((a, b) => ((a * 7919 + seed) % 101) - ((b * 7919 + seed) % 101) || a - b)
        expect(clusterCount(clusterIds(order.map((i) => vecs[i] as Float32Array), 0.4))).toBe(m)
      }),
    )
  })

  it('property: ids are numbered by first appearance and the count lies in [1, n]', () => {
    const vec = fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 6, maxLength: 6 })
    fc.assert(
      fc.property(fc.array(vec, { minLength: 1, maxLength: 15 }), fc.double({ min: -1, max: 1, noNaN: true }), (vs, th) => {
        const ids = clusterIds(vs, th)
        expect(ids).toHaveLength(vs.length)
        expect(ids[0]).toBe(0)
        expect(numberedByFirstAppearance(ids)).toBe(true)
        const k = clusterCount(ids)
        expect(k).toBeGreaterThanOrEqual(1)
        expect(k).toBeLessThanOrEqual(vs.length)
      }),
    )
  })

  it('property: a higher threshold never gives fewer clusters (average linkage merges monotonically)', () => {
    const vec = fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 5, maxLength: 5 })
    fc.assert(
      fc.property(fc.array(vec, { minLength: 1, maxLength: 14 }), (vecs) => {
        const counts = [-0.5, 0, 0.1, 0.3, 0.4, 0.6, 0.9].map((t) => clusterCount(clusterIds(vecs, t)))
        for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1] as number)
      }),
    )
  })
})
