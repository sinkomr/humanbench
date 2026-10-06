/**
 * Parity of the situational-judgment scoring and the word-links answer matching with the bank (ROADMAP M6.2, M6.3,
 * A17; DESIGN §5.3, §5.4, §14.6 ex. 15-16). `src/engine/__fixtures__/m6_scoring_v1.json` is the bank's
 * `golden/m6_scoring_v1.json` (written by `uv run python -m hb.m6golden --write`, copied here by `npm run sync:golden`,
 * and checked byte for byte against the sibling bank by `scripts/sync-golden.test.ts`). It holds made-up numbers and
 * strings only. Every number below must come out within the file's tolerance (1e-12) and every string exactly, and every
 * error case must throw.
 *
 * The bank's `tests/test_m6_golden.py` runs the same cases through `hb.sjt.scoring` and `hb.rat.answers`.
 */

import { describe, expect, it } from 'vitest'
import golden from '../engine/__fixtures__/m6_scoring_v1.json'
import { answerKey, matches } from './rat/answers'
import { mostLeastScore, ratingScore } from './sjt/scoring'

interface RatingCase {
  readonly id: string
  readonly user: readonly number[]
  readonly key: readonly number[]
  readonly score: number
}
interface MostLeastCase {
  readonly id: string
  readonly most: number
  readonly least: number
  readonly key: readonly number[]
  readonly score: number
}
/** An input both implementations must refuse. `null` inside `key` stands for `key_null_is` (JSON has no NaN). */
interface ErrorCase {
  readonly id: string
  readonly fn: 'rating' | 'most_least'
  readonly user?: unknown
  readonly most?: unknown
  readonly least?: unknown
  readonly key: unknown
  readonly key_null_is?: 'NaN' | 'Infinity' | '-Infinity'
  readonly why: string
}
interface KeyCase {
  readonly id: string
  readonly note: string
  readonly text: string
  readonly key: string
}
interface MatchCase {
  readonly id: string
  readonly note: string
  readonly response: string
  readonly accept: readonly string[]
  readonly expected: boolean
}
interface Golden {
  readonly version: string
  readonly tolerance: number
  readonly sjt: { readonly rating: RatingCase[]; readonly most_least: MostLeastCase[]; readonly errors: ErrorCase[] }
  readonly rat: { readonly answer_key: KeyCase[]; readonly matches: MatchCase[] }
}

const G = golden as unknown as Golden
const TOL = G.tolerance

const NON_FINITE = { NaN: Number.NaN, Infinity: Number.POSITIVE_INFINITY, '-Infinity': Number.NEGATIVE_INFINITY } as const

/** The key of an error case, its nulls replaced by the non-finite number the case names (only when it names one). */
function errorKey(c: ErrorCase): unknown {
  if (c.key_null_is === undefined || !Array.isArray(c.key)) return c.key
  const repl = NON_FINITE[c.key_null_is]
  return (c.key as unknown[]).map((v) => (v === null ? repl : v))
}

describe('the golden file', () => {
  it('is the version and size the bank wrote, with a 1e-12 tolerance', () => {
    expect(G.version).toBe('m6_scoring_v1')
    expect(TOL).toBe(1e-12)
    expect(G.sjt.rating.length).toBeGreaterThanOrEqual(200)
    expect(G.sjt.most_least.length).toBeGreaterThanOrEqual(100)
    expect(G.sjt.errors.length).toBeGreaterThanOrEqual(40)
    expect(G.rat.answer_key.length).toBeGreaterThanOrEqual(100)
    expect(G.rat.matches.length).toBeGreaterThanOrEqual(60)
  })

  it('has unique case ids in each list', () => {
    for (const list of [G.sjt.rating, G.sjt.most_least, G.sjt.errors, G.rat.answer_key, G.rat.matches]) {
      expect(new Set(list.map((c) => c.id)).size).toBe(list.length)
    }
  })
})

describe('ratingScore matches the bank (rating_score)', () => {
  it('reproduces every case within the tolerance', () => {
    for (const c of G.sjt.rating) {
      const got = ratingScore(c.user, c.key)
      expect(Math.abs(got - c.score), `${c.id}: ${got} vs ${c.score}`).toBeLessThanOrEqual(TOL)
    }
  })

  it('includes all 1s, all 4s, fractional keys and the extremes of the score', () => {
    const users = G.sjt.rating.map((c) => c.user.join(','))
    expect(users).toContain('1,1,1,1')
    expect(users).toContain('4,4,4,4')
    const keyValues = G.sjt.rating.flatMap((c) => c.key)
    expect(keyValues).toContain(1.5)
    expect(keyValues).toContain(2.7333333333333334)
    const scores = G.sjt.rating.map((c) => c.score)
    expect(Math.min(...scores)).toBe(0)
    expect(Math.max(...scores)).toBe(1)
  })
})

describe('mostLeastScore matches the bank (most_least_score)', () => {
  it('reproduces every case within the tolerance', () => {
    for (const c of G.sjt.most_least) {
      const got = mostLeastScore(c.most, c.least, c.key)
      expect(Math.abs(got - c.score), `${c.id}: ${got} vs ${c.score}`).toBeLessThanOrEqual(TOL)
    }
  })

  it('covers every ordered pair of different positions', () => {
    const pairs = new Set(G.sjt.most_least.map((c) => `${c.most},${c.least}`))
    expect(pairs.size).toBe(12)
  })
})

describe('the scorers refuse what the bank refuses', () => {
  it('throws a RangeError for every error case', () => {
    for (const c of G.sjt.errors) {
      const key = errorKey(c) as never
      if (c.fn === 'rating') {
        expect(() => ratingScore(c.user as never, key), `${c.id}: ${c.why}`).toThrow(RangeError)
      } else {
        expect(() => mostLeastScore(c.most as never, c.least as never, key), `${c.id}: ${c.why}`).toThrow(RangeError)
      }
    }
  })

  it('marks a non-finite key value with a null and names it, never anywhere else', () => {
    for (const c of G.sjt.errors) {
      const hasNull = Array.isArray(c.key) && c.key.includes(null)
      expect(hasNull, c.id).toBe(c.key_null_is !== undefined)
    }
    const named = new Set(G.sjt.errors.map((c) => c.key_null_is).filter((v) => v !== undefined))
    expect(named).toEqual(new Set(['NaN', 'Infinity', '-Infinity']))
  })

  it('accepts the baseline every error case was built from (so each one breaks only its own input)', () => {
    expect(() => ratingScore([3, 1, 4, 2], [3.5, 1.5, 4.0, 2.25])).not.toThrow()
    expect(() => mostLeastScore(0, 1, [3.5, 1.5, 4.0, 2.25])).not.toThrow()
  })
})

describe('answerKey matches the bank (answer_key)', () => {
  it('gives the same key for every text, exactly', () => {
    for (const c of G.rat.answer_key) {
      expect(answerKey(c.text), `${c.id}: ${c.note}`).toBe(c.key)
    }
  })

  it('keeps the strings the spec names (an accent, full-width letters, a ligature, the Kelvin sign, a dotted I)', () => {
    const byText = new Map(G.rat.answer_key.map((c) => [c.text, c.key]))
    expect(byText.get('Chéese')).toBe('cheese')
    expect(byText.get('ＢＬＯＲＦ')).toBe('blorf')
    expect(byText.get('ﬁsh')).toBe('fish')
    expect(byText.get('K')).toBe('k')
    expect(byText.get('İ')).toBe('i')
    expect(byText.get('')).toBe('')
    expect(byText.get(' \t\r\n 　')).toBe('')
  })
})

describe('matches matches the bank (matches)', () => {
  it('gives the same verdict for every response and accept list', () => {
    for (const c of G.rat.matches) {
      expect(matches(c.response, c.accept), `${c.id}: ${c.note}`).toBe(c.expected)
    }
  })

  it('accepts a listed spelling variant and nothing else (grey / gray)', () => {
    const both = ['grey', 'gray']
    for (const r of ['grey', 'gray', 'GRAY', 'Grey ', 'g-r-a-y']) expect(matches(r, both), r).toBe(true)
    expect(matches('grey', ['gray'])).toBe(false)
    expect(matches('greys', both)).toBe(false)
  })
})
