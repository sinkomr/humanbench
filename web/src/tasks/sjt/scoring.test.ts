/**
 * The two SJT scores (ROADMAP M6.2; DESIGN §5.3, §14.6 ex. 15): the worked values, the malformed-input errors and the
 * properties. The bank's `hb.sjt.scoring` has the same functions; a later package adds the shared golden vectors.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { mostLeastScore, ratingScore } from './scoring'

/** The key of DESIGN §14.6 ex. 15. */
const KEY = [4, 2, 1, 1.5] as const

describe('ratingScore: 1 - sum|user - key| / (3 * 4)', () => {
  it('is 1 for ratings equal to an integer key, and 0 for the farthest ratings', () => {
    expect(ratingScore([4, 2, 1, 3], [4, 2, 1, 3])).toBe(1)
    expect(ratingScore([1, 4, 4, 1], [4, 1, 1, 4])).toBe(0)
  })

  it('has the worked value of DESIGN §14.6 ex. 15 (key [4, 2, 1, 1.5])', () => {
    // |4-4| + |3-2| + |1-1| + |2-1.5| = 1.5; 1 - 1.5 / 12
    expect(ratingScore([4, 3, 1, 2], KEY)).toBe(1 - 1.5 / 12)
    expect(ratingScore([4, 3, 1, 2], KEY)).toBeCloseTo(0.875, 12)
    // all fours: 0 + 2 + 3 + 2.5 = 7.5
    expect(ratingScore([4, 4, 4, 4], KEY)).toBe(1 - 7.5 / 12)
  })

  it('does not round, and uses the display order of the key', () => {
    expect(ratingScore([1, 1, 1, 1], [1.1, 1, 1, 1])).toBe(1 - 0.10000000000000009 / 12)
    expect(ratingScore([1, 2, 3, 4], [4, 3, 2, 1])).toBe(1 - 8 / 12)
    expect(ratingScore([4, 3, 2, 1], [1, 2, 3, 4])).toBe(1 - 8 / 12)
  })

  it('accepts a key given as any four numbers in [1, 4], including the ends', () => {
    expect(ratingScore([1, 2, 3, 4], [1, 2, 3, 4])).toBe(1)
    expect(() => ratingScore([1, 1, 1, 1], [1, 1, 1, 1])).not.toThrow()
  })

  it('throws a RangeError on a malformed answer or key', () => {
    const bad: [string, unknown, unknown][] = [
      ['three ratings', [1, 2, 3], KEY],
      ['five ratings', [1, 2, 3, 4, 4], KEY],
      ['a rating of 0', [0, 2, 3, 4], KEY],
      ['a rating of 5', [1, 2, 3, 5], KEY],
      ['a fractional rating', [1, 2, 3, 2.5], KEY],
      ['a NaN rating', [1, 2, 3, NaN], KEY],
      ['a string rating', [1, 2, 3, '4'], KEY],
      ['a boolean rating', [1, 2, 3, true], KEY],
      ['ratings that are not a list', 'abcd', KEY],
      ['no ratings', undefined, KEY],
      ['three key values', [1, 2, 3, 4], [1, 2, 3]],
      ['a key value below 1', [1, 2, 3, 4], [0.9, 2, 3, 4]],
      ['a key value above 4', [1, 2, 3, 4], [1, 2, 3, 4.1]],
      ['a NaN key value', [1, 2, 3, 4], [1, 2, 3, NaN]],
      ['an infinite key value', [1, 2, 3, 4], [1, 2, 3, Infinity]],
      ['a string key value', [1, 2, 3, 4], [1, 2, 3, '4']],
      ['no key', [1, 2, 3, 4], null],
    ]
    for (const [what, user, key] of bad) expect(() => ratingScore(user as number[], key as number[]), what).toThrow(RangeError)
  })

  it('never changes its arguments', () => {
    const user = [4, 3, 1, 2]
    const key = [4, 2, 1, 1.5]
    ratingScore(user, key)
    expect(user).toEqual([4, 3, 1, 2])
    expect(key).toEqual([4, 2, 1, 1.5])
  })
})

describe('mostLeastScore: ((key[most] - kmin) + (kmax - key[least])) / (2 * (kmax - kmin))', () => {
  it('is 1 for the best and the worst of the key, 0 for the worst as best and the best as least', () => {
    expect(mostLeastScore(0, 2, KEY)).toBe(1)
    expect(mostLeastScore(2, 0, KEY)).toBe(0)
  })

  it('has the worked values of the key [4, 2, 1, 1.5]', () => {
    // most = index 1 (2): (2 - 1) + (4 - 1.5(least index 3)) = 3.5 of 6
    expect(mostLeastScore(1, 3, KEY)).toBe(3.5 / 6)
    // most = best (4), least = index 1 (2): 3 + 2 = 5 of 6
    expect(mostLeastScore(0, 1, KEY)).toBe(5 / 6)
    // most = index 3 (1.5), least = worst (1): 0.5 + 3 = 3.5 of 6
    expect(mostLeastScore(3, 2, KEY)).toBe(3.5 / 6)
  })

  it('gives full marks to any best and any worst when the key has ties', () => {
    const tied = [4, 4, 1, 1]
    for (const most of [0, 1]) for (const least of [2, 3]) expect(mostLeastScore(most, least, tied), `${most} ${least}`).toBe(1)
    expect(mostLeastScore(0, 1, tied)).toBe(0.5)
  })

  it('throws a RangeError on a malformed choice or key', () => {
    const bad: [string, unknown, unknown, unknown][] = [
      ['most equals least', 1, 1, KEY],
      ['a position of 4', 4, 0, KEY],
      ['a negative position', -1, 0, KEY],
      ['a fractional position', 0.5, 1, KEY],
      ['a string position', '0', 1, KEY],
      ['a NaN position', NaN, 1, KEY],
      ['least out of range', 0, 7, KEY],
      ['a key that rates every response the same', 0, 1, [2.5, 2.5, 2.5, 2.5]],
      ['three key values', 0, 1, [1, 2, 3]],
      ['a key value outside [1, 4]', 0, 1, [1, 2, 3, 5]],
      ['a NaN key value', 0, 1, [1, 2, 3, NaN]],
      ['no key', 0, 1, undefined],
    ]
    for (const [what, most, least, key] of bad) expect(() => mostLeastScore(most as number, least as number, key as number[]), what).toThrow(RangeError)
  })
})

/** Integer ratings 1 to 4 for each of the four responses. */
const ratings = fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 4, maxLength: 4 })
/** Keys on a grid of eighths: every difference is exact, so "iff" statements are about the arithmetic and not about rounding. */
const gridKey = fc.array(fc.integer({ min: 8, max: 32 }).map((n) => n / 8), { minLength: 4, maxLength: 4 })
/** Any finite key in [1, 4]. */
const anyKey = fc.array(fc.double({ min: 1, max: 4, noNaN: true }), { minLength: 4, maxLength: 4 })
const position = fc.integer({ min: 0, max: 3 })

describe('properties', () => {
  it('ratingScore is in [0, 1] for any ratings and any key', () => {
    fc.assert(
      fc.property(ratings, anyKey, (user, key) => {
        const s = ratingScore(user, key)
        expect(s).toBeGreaterThanOrEqual(0)
        expect(s).toBeLessThanOrEqual(1)
      }),
      { numRuns: 500 },
    )
  })

  it('ratingScore is 1 exactly when the ratings equal an integer key', () => {
    fc.assert(
      fc.property(ratings, ratings, (user, key) => {
        const equal = user.every((u, i) => u === key[i])
        expect(ratingScore(user, key) === 1).toBe(equal)
      }),
      { numRuns: 500 },
    )
  })

  it('ratingScore never rewards a rating that moves away from the key', () => {
    fc.assert(
      fc.property(ratings, gridKey, position, (user, key, i) => {
        const u = user[i] as number
        const k = key[i] as number
        // move one rating one step away from the key value (keeping it in 1..4)
        const away = u >= k ? u + 1 : u - 1
        if (away < 1 || away > 4) return
        const moved = user.map((x, j) => (j === i ? away : x))
        expect(ratingScore(moved, key)).toBeLessThanOrEqual(ratingScore(user, key))
      }),
      { numRuns: 500 },
    )
  })

  it('mostLeastScore is in [0, 1] for any different positions and any key that is not flat', () => {
    fc.assert(
      fc.property(anyKey, position, fc.integer({ min: 1, max: 3 }), (key, most, step) => {
        fc.pre(Math.max(...key) > Math.min(...key))
        const s = mostLeastScore(most, (most + step) % 4, key)
        expect(s).toBeGreaterThanOrEqual(0)
        expect(s).toBeLessThanOrEqual(1)
      }),
      { numRuns: 500 },
    )
  })

  it('mostLeastScore is 1 exactly when most is a best-rated response and least a worst-rated one', () => {
    fc.assert(
      fc.property(gridKey, position, fc.integer({ min: 1, max: 3 }), (key, most, step) => {
        fc.pre(Math.max(...key) > Math.min(...key))
        const least = (most + step) % 4
        const ideal = key[most] === Math.max(...key) && key[least] === Math.min(...key)
        expect(mostLeastScore(most, least, key) === 1).toBe(ideal)
      }),
      { numRuns: 500 },
    )
  })

  it('swapping most and least gives the complement: s becomes 1 - s', () => {
    fc.assert(
      fc.property(gridKey, position, fc.integer({ min: 1, max: 3 }), (key, most, step) => {
        fc.pre(Math.max(...key) > Math.min(...key))
        const least = (most + step) % 4
        expect(mostLeastScore(most, least, key) + mostLeastScore(least, most, key)).toBeCloseTo(1, 12)
      }),
      { numRuns: 500 },
    )
  })
})
