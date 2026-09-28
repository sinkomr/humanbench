import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AXES, AXIS_CODES, CLUSTERS, initialSigma, SIGMA_VERSION } from '../engine/axes'
import { createRng } from '../engine/prng'
import { canonicalCycle, cycleScore, isContiguous, seriate, seriateBruteForce, spokeOrder } from './seriation'

/** A random symmetric K×K weight matrix and K group labels from a seed. */
function randomCase(k: number, nGroups: number, seed: string): { w: number[][]; groups: number[] } {
  const rng = createRng(seed)
  const w = Array.from({ length: k }, () => new Array<number>(k).fill(1))
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      // Correlation-like values with deliberate ties (Σ_init v2 is full of tied rule values).
      const v = rng.next() < 0.3 ? [0.2, 0.35, 0.55][rng.int(0, 2)]! : Math.round((rng.next() * 2 - 1) * 1000) / 1000
      w[i]![j] = v
      w[j]![i] = v
    }
  }
  const groups = Array.from({ length: k }, () => rng.int(0, nGroups - 1))
  return { w, groups }
}

describe('seriation (§9.4: exact, clusters contiguous)', () => {
  it('matches brute force on random matrices and groupings, K ≤ 9', () => {
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 9 }), fc.integer({ min: 1, max: 9 }), fc.string(), (k, g, seed) => {
        const { w, groups } = randomCase(k, Math.min(g, k), seed)
        const order = seriate(w, groups)
        expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: k }, (_, i) => i))
        expect(isContiguous(order, groups)).toBe(true)
        expect(cycleScore(order, w)).toBeCloseTo(seriateBruteForce(w, groups).score, 9)
      }),
      { numRuns: 60 },
    )
  })

  it('matches brute force at K = 10 (the ROADMAP bound)', () => {
    for (const [g, seed] of [
      [4, 'k10-a'],
      [10, 'k10-b'],
      [3, 'k10-c'],
    ] as const) {
      const { w, groups } = randomCase(10, g, seed)
      const order = seriate(w, groups)
      expect(isContiguous(order, groups)).toBe(true)
      expect(cycleScore(order, w)).toBeCloseTo(seriateBruteForce(w, groups).score, 9)
    }
  }, 60_000)

  it('without real groups it is the exact cyclic TSP optimum', () => {
    const { w } = randomCase(8, 1, 'tsp')
    const distinct = Array.from({ length: 8 }, (_, i) => i) // every node its own group: no constraint
    expect(cycleScore(seriate(w, distinct), w)).toBeCloseTo(seriateBruteForce(w, distinct).score, 9)
  })

  it('handles tiny inputs and rejects bad ones', () => {
    expect(seriate([[1]], ['a'])).toEqual([0])
    expect(seriate([[1, 0.2], [0.2, 1]], ['a', 'b'])).toEqual([0, 1])
    expect(() => seriate([[1, 0.2], [0.3, 1]], ['a', 'b'])).toThrow(RangeError)
    expect(() => seriate([[1]], ['a', 'b'])).toThrow(RangeError)
  })

  it('isContiguous recognises split groups, including across the wrap', () => {
    expect(isContiguous([0, 1, 2, 3], ['a', 'a', 'b', 'b'])).toBe(true)
    expect(isContiguous([1, 2, 3, 0], ['a', 'a', 'b', 'b'])).toBe(true) // run of a wraps round
    expect(isContiguous([0, 2, 1, 3], ['a', 'a', 'b', 'b'])).toBe(false)
  })

  it('canonicalCycle keeps the cycle (score) and puts index 0 first, smaller neighbour clockwise', () => {
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 12 }), fc.string(), (k, seed) => {
        const { w } = randomCase(k, 1, seed)
        const rng = createRng(`perm-${seed}`)
        const order = rng.shuffle(Array.from({ length: k }, (_, i) => i))
        const c = canonicalCycle(order)
        expect(c[0]).toBe(0)
        expect(c[1]!).toBeLessThan(c[k - 1]!)
        expect(cycleScore(c, w)).toBeCloseTo(cycleScore(order, w), 12)
        expect(canonicalCycle(c)).toEqual(c)
        expect(canonicalCycle([...order].reverse())).toEqual(c)
      }),
    )
  })
})

describe('the 17-spoke order (§9.4, §9.5 b, A7, A8)', () => {
  const sigma = initialSigma()
  const clusterOf = AXES.map((a) => a.cluster)
  const order = spokeOrder()
  const idx = order.map((c) => AXIS_CODES.indexOf(c))

  it('is pinned for the pinned Σ, so every user sees the same order', () => {
    expect(SIGMA_VERSION).toBe('sigma-v2-2026-09-26')
    expect(order).toEqual(['MAT', 'LG', 'LR', 'RC', 'VOC', 'KHU', 'KST', 'KAP', 'SPA', 'WM', 'EMO', 'CRE', 'RT', 'PS', 'CAL', 'FER', 'QR'])
    expect(spokeOrder(SIGMA_VERSION)).toBe(order) // cached
    expect(() => spokeOrder('sigma-v9')).toThrow(/no pinned Σ/)
  })

  it('shows all 17 axes once and keeps the 8 A7 clusters contiguous', () => {
    expect([...order].sort()).toEqual([...AXIS_CODES].sort())
    expect(isContiguous(idx, clusterOf)).toBe(true)
    expect(new Set(clusterOf).size).toBe(CLUSTERS.length)
  })

  it('maximises adjacent correlation in Σ: no contiguity-preserving swap or reversal improves it', () => {
    const best = cycleScore(idx, sigma)
    for (let i = 0; i < 17; i++) {
      for (let j = i + 1; j < 17; j++) {
        const swapped = idx.slice()
        ;[swapped[i], swapped[j]] = [swapped[j]!, swapped[i]!]
        if (isContiguous(swapped, clusterOf)) expect(cycleScore(swapped, sigma)).toBeLessThanOrEqual(best + 1e-12)
        const rev = [...idx.slice(0, i), ...idx.slice(i, j + 1).reverse(), ...idx.slice(j + 1)]
        if (isContiguous(rev, clusterOf)) expect(cycleScore(rev, sigma)).toBeLessThanOrEqual(best + 1e-12)
      }
    }
  })

  it('beats every seeded random contiguous order (a sanity check of optimality at K = 17)', () => {
    const best = cycleScore(idx, sigma)
    const rng = createRng('m1.16-seriation-random')
    // Random contiguous orders: shuffle the clusters, then the members within each.
    for (let n = 0; n < 2000; n++) {
      const cyc = rng.shuffle([...CLUSTERS]).flatMap((c) => rng.shuffle(AXES.filter((a) => a.cluster === c).map((a) => a.index)))
      expect(cycleScore(cyc, sigma)).toBeLessThanOrEqual(best + 1e-12)
    }
  })
})
