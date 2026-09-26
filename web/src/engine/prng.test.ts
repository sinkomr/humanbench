import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createRng, cyrb128, forkSeed, seedString, sfc32, WARMUP_ROUNDS } from './prng'

const draws = (seed: string, n: number): number[] => {
  const rng = createRng(seed)
  return Array.from({ length: n }, () => rng.next())
}

/** Pearson correlation of two equal-length samples. */
const pearson = (x: number[], y: number[]): number => {
  const n = x.length
  const mx = x.reduce((s, v) => s + v, 0) / n
  const my = y.reduce((s, v) => s + v, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = (x[i] as number) - mx
    const dy = (y[i] as number) - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  return sxy / Math.sqrt(sxx * syy)
}

describe('known-answer vectors', () => {
  // Pinned from an independent Python implementation of cyrb128 + sfc32 (not from this code).
  it('cyrb128 hashes seeds to the reference words', () => {
    expect(cyrb128('humanbench')).toEqual([755935199, 3936245873, 3033289367, 3413175006])
    expect(cyrb128('i:mat:f0182:v3')).toEqual([1737185062, 2424497008, 2947368252, 494100252])
    expect(cyrb128('')).toEqual([41608494, 3485963809, 1435736333, 1262568316])
  })

  it('pins the first outputs after warm-up for two seeds', () => {
    const a = createRng('humanbench')
    expect(Array.from({ length: 5 }, () => a.uint32())).toEqual([
      676465160, 303335099, 2138928947, 3791498738, 2753021823,
    ])
    const b = createRng('i:mat:f0182:v3')
    expect(Array.from({ length: 5 }, () => b.uint32())).toEqual([
      175100256, 4084670431, 2035451338, 1013100397, 1922565833,
    ])
    expect(draws('humanbench', 3)).toEqual([
      0.1575018186122179, 0.07062570634298027, 0.4980082034599036,
    ])
  })

  it('discards exactly WARMUP_ROUNDS raw outputs', () => {
    const raw = sfc32(...cyrb128('humanbench'))
    for (let i = 0; i < WARMUP_ROUNDS; i++) raw()
    expect(raw()).toBe(676465160)
  })
})

describe('determinism', () => {
  it('same seed gives the same stream across all methods', () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const run = () => {
          const r = createRng(seed)
          return [
            r.next(),
            r.int(-5, 5),
            r.pick(['a', 'b', 'c']),
            r.shuffle([1, 2, 3, 4]),
            r.normal(),
            r.normal(2, 3),
          ]
        }
        expect(run()).toEqual(run())
      }),
      { numRuns: 200 },
    )
  })

  it('different seeds give different streams', () => {
    expect(draws('seed-1', 8)).not.toEqual(draws('seed-2', 8))
    expect(draws('a', 8)).not.toEqual(draws('b', 8))
  })

  it('next() stays in [0, 1)', () => {
    fc.assert(
      fc.property(fc.string(), (seed) => {
        const r = createRng(seed)
        for (let i = 0; i < 200; i++) {
          const x = r.next()
          expect(x).toBeGreaterThanOrEqual(0)
          expect(x).toBeLessThan(1)
        }
      }),
      { numRuns: 100 },
    )
  })
})

describe('uniformity sanity', () => {
  it('chi-square over 20 bins of 10k draws is within a loose bound', () => {
    for (const seed of ['humanbench', 'uniformity', '']) {
      const bins = new Array<number>(20).fill(0)
      const r = createRng(seed)
      const n = 10_000
      for (let i = 0; i < n; i++) {
        const k = Math.floor(r.next() * 20)
        bins[k] = (bins[k] as number) + 1
      }
      const expected = n / 20
      const chi2 = bins.reduce((s, o) => s + (o - expected) ** 2 / expected, 0)
      // df = 19: the 0.999 quantile is 43.8. A loose bound that a broken generator still fails.
      expect(chi2).toBeLessThan(50)
    }
  })

  it('consecutive draws are uncorrelated', () => {
    const x = draws('lag-1', 10_001)
    expect(Math.abs(pearson(x.slice(0, -1), x.slice(1)))).toBeLessThan(0.05)
  })
})

describe('int()', () => {
  it('stays within inclusive bounds', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1000 }),
        (seed, lo, width) => {
          const r = createRng(seed)
          const hi = lo + width
          for (let i = 0; i < 50; i++) {
            const v = r.int(lo, hi)
            expect(Number.isInteger(v)).toBe(true)
            expect(v).toBeGreaterThanOrEqual(lo)
            expect(v).toBeLessThanOrEqual(hi)
          }
        },
      ),
    )
  })

  it('hits both endpoints and every value of a small range', () => {
    const r = createRng('endpoints')
    const seen = new Set<number>()
    for (let i = 0; i < 1000; i++) seen.add(r.int(3, 9))
    expect([...seen].sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7, 8, 9])
  })

  it('handles a degenerate range and the full 2^32 range', () => {
    const r = createRng('edge')
    expect(r.int(7, 7)).toBe(7)
    const v = r.int(0, 2 ** 32 - 1)
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThan(2 ** 32)
  })

  it('rejects invalid bounds', () => {
    const r = createRng('bad')
    expect(() => r.int(5, 4)).toThrow(RangeError)
    expect(() => r.int(0.5, 4)).toThrow(RangeError)
    expect(() => r.int(0, 2 ** 32)).toThrow(RangeError)
  })

  it('is roughly uniform over a range that does not divide 2^32', () => {
    const r = createRng('int-uniform')
    const counts = new Array<number>(6).fill(0)
    const n = 12_000
    for (let i = 0; i < n; i++) {
      const k = r.int(0, 5)
      counts[k] = (counts[k] as number) + 1
    }
    const chi2 = counts.reduce((s, o) => s + (o - n / 6) ** 2 / (n / 6), 0)
    expect(chi2).toBeLessThan(25) // df = 5: 0.999 quantile is 20.5
  })
})

describe('pick() and shuffle()', () => {
  it('pick returns an element of the array and throws on empty', () => {
    fc.assert(
      fc.property(fc.string(), fc.array(fc.integer(), { minLength: 1 }), (seed, arr) => {
        expect(arr).toContain(createRng(seed).pick(arr))
      }),
    )
    expect(() => createRng('x').pick([])).toThrow(RangeError)
  })

  it('shuffle returns a permutation and leaves the input untouched', () => {
    fc.assert(
      fc.property(fc.string(), fc.array(fc.integer()), (seed, arr) => {
        const before = arr.slice()
        const out = createRng(seed).shuffle(arr)
        expect(out).not.toBe(arr)
        expect(arr).toEqual(before)
        expect(out.slice().sort((a, b) => a - b)).toEqual(before.slice().sort((a, b) => a - b))
      }),
    )
  })

  it('shuffle reaches every permutation of 3 elements about equally often', () => {
    const r = createRng('perm')
    const counts = new Map<string, number>()
    const n = 6000
    for (let i = 0; i < n; i++) {
      const key = r.shuffle(['a', 'b', 'c']).join('')
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    expect(counts.size).toBe(6)
    for (const c of counts.values()) expect(Math.abs(c - n / 6)).toBeLessThan(150)
  })
})

describe('normal()', () => {
  it('has mean ≈ 0 and sd ≈ 1 over 10k draws, and honours mean/sd', () => {
    const r = createRng('normal')
    const xs = Array.from({ length: 10_000 }, () => r.normal())
    const m = xs.reduce((s, v) => s + v, 0) / xs.length
    const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)
    expect(Math.abs(m)).toBeLessThan(0.05)
    expect(Math.abs(Math.sqrt(v) - 1)).toBeLessThan(0.05)
    expect(xs.every(Number.isFinite)).toBe(true)

    const r2 = createRng('normal-scaled')
    const ys = Array.from({ length: 10_000 }, () => r2.normal(10, 0.5))
    const m2 = ys.reduce((s, y) => s + y, 0) / ys.length
    expect(Math.abs(m2 - 10)).toBeLessThan(0.03)
  })

  it('caches the second Box–Muller deviate (one pair per two calls)', () => {
    const a = createRng('bm')
    a.normal()
    a.normal()
    const b = createRng('bm')
    b.next()
    b.next()
    expect(a.next()).toBe(b.next())
  })
})

describe('fork()', () => {
  it('is deterministic and does not advance the parent', () => {
    const p1 = createRng('parent')
    const p2 = createRng('parent')
    const c1 = p1.fork('mat')
    p2.next()
    p2.next()
    const c2 = p2.fork('mat')
    expect(Array.from({ length: 5 }, () => c1.next())).toEqual(
      Array.from({ length: 5 }, () => c2.next()),
    )
    expect(p1.next()).toBe(createRng('parent').next())
  })

  it('children are independent of the parent and of each other', () => {
    const parent = createRng('parent')
    const a = parent.fork('a')
    const b = parent.fork('b')
    const n = 5000
    const xp = Array.from({ length: n }, () => parent.next())
    const xa = Array.from({ length: n }, () => a.next())
    const xb = Array.from({ length: n }, () => b.next())
    expect(xa).not.toEqual(xp)
    expect(xa).not.toEqual(xb)
    expect(Math.abs(pearson(xp, xa))).toBeLessThan(0.06)
    expect(Math.abs(pearson(xa, xb))).toBeLessThan(0.06)
  })

  it('derives unambiguous child seeds', () => {
    expect(forkSeed('a/b', 'c')).not.toBe(forkSeed('a', 'b/c'))
    expect(createRng('s').fork('x').seed).toBe(forkSeed('s', 'x'))
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.string(), fc.string(), (s1, l1, s2, l2) => {
        fc.pre(s1 !== s2 || l1 !== l2)
        expect(forkSeed(s1, l1)).not.toBe(forkSeed(s2, l2))
      }),
    )
  })
})

describe('seed handling (§12 source.seed is a JSON number)', () => {
  it('canonicalises safe-integer seeds to their decimal string', () => {
    // The §12 example record, as loaded from JSON (where the seed is typed `any`).
    const record = JSON.parse('{"source":{"seed":918273}}') as { source: { seed: number } }
    const fromNumber = createRng(record.source.seed)
    const fromString = createRng('918273')
    expect(fromNumber.seed).toBe('918273')
    expect(Array.from({ length: 5 }, () => fromNumber.uint32())).toEqual(
      Array.from({ length: 5 }, () => fromString.uint32()),
    )
    expect(seedString(-7)).toBe('-7')
    expect(seedString(0)).toBe('0')
    fc.assert(
      fc.property(fc.maxSafeInteger(), (n) => {
        expect(createRng(n).next()).toBe(createRng(String(n)).next())
      }),
      { numRuns: 200 },
    )
  })

  it('distinct integer seeds give distinct streams, none equal to the empty-string stream', () => {
    const empty = draws('', 4)
    const seen = new Set<string>()
    for (const n of [0, 1, 42, 918273, 918274, -1]) {
      const r = createRng(n)
      const xs = Array.from({ length: 4 }, () => r.next())
      expect(xs).not.toEqual(empty)
      seen.add(xs.join(','))
    }
    expect(seen.size).toBe(6)
  })

  it('rejects seeds that are neither strings nor safe integers', () => {
    for (const bad of [1.5, Number.NaN, Infinity, 2 ** 53, null, undefined, {}, ['a'], true, 1n]) {
      expect(() => createRng(bad as unknown as string)).toThrow(TypeError)
      expect(() => seedString(bad)).toThrow(TypeError)
    }
    expect(() => cyrb128(42 as unknown as string)).toThrow(TypeError)
    expect(() => createRng('s').fork(1 as unknown as string)).toThrow(TypeError)
  })
})
