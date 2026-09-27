import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { frac } from './fraction'
import { MAX_ENTRY_LENGTH, boundOf, parseEntry, withinTolerance } from './numeric'

const p = (s: string): string | null => parseEntry(s)?.toString() ?? null

describe('numeric entry parsing', () => {
  it('accepts integers, decimals, fractions and mixed numbers', () => {
    const cases: [string, string][] = [
      ['42', '42'],
      ['-7', '-7'],
      ['−7', '-7'],
      ['+3', '3'],
      ['  12  ', '12'],
      ['12.5', '25/2'],
      ['.5', '1/2'],
      ['3.', '3'],
      ['0.75', '3/4'],
      ['007', '7'],
      ['1,533', '1533'],
      ['12,345.5', '24691/2'],
      ['3/8', '3/8'],
      ['6/4', '3/2'],
      ['-3 / 8', '-3/8'],
      ['2 1/3', '7/3'],
      ['-2 1/3', '-7/3'],
      ['$28.90', '289/10'],
      ['-$5', '-5'],
      ['15%', '15'],
      ['0', '0'],
      ['-0', '0'],
    ]
    for (const [s, want] of cases) expect(p(s), s).toBe(want)
  })

  it('rejects everything else', () => {
    for (const s of ['', ' ', 'abc', '1/0', '0,5', '1,23', '12,3456', '1e3', '--3', '+-3', '3-', '1/2/3', '1.2.3', '½', '3 /', '2 1/0', '$-5', '1 2', '\u0663', '1\u20082/3']) {
      expect(p(s), JSON.stringify(s)).toBeNull()
    }
    expect(parseEntry(42)).toBeNull()
    expect(parseEntry(null)).toBeNull()
    expect(p('1'.repeat(MAX_ENTRY_LENGTH + 1))).toBeNull()
    expect(p('1'.repeat(MAX_ENTRY_LENGTH))).not.toBeNull()
  })

  it('round-trips canonical fractions and decimals (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), fc.integer({ min: 1, max: 1_000 }), (n, d) => {
        const f = frac(n, d)
        expect(parseEntry(f.toString())?.eq(f)).toBe(true)
      }),
    )
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), fc.integer({ min: 0, max: 999 }), (n, m) => {
        const want = frac(n).add(frac(n < 0 ? -m : m, 1000))
        expect(parseEntry(`${n}.${String(m).padStart(3, '0')}`)?.eq(want)).toBe(true)
      }),
    )
  })
})

describe('tolerance', () => {
  it('abs 0 is exact equality of rationals', () => {
    expect(withinTolerance(frac(3, 4), frac(6, 8), { abs: 0 })).toBe(true)
    expect(withinTolerance(frac(3, 4), frac(3, 4).add(frac(1, 10 ** 12)), { abs: 0 })).toBe(false)
    expect(withinTolerance(frac(1, 3), frac(333, 1000), { abs: 0 })).toBe(false)
  })

  it('rel 0.005 is ±0.5% of the key, inclusive', () => {
    const key = frac(200)
    expect(withinTolerance(frac(201), key, { rel: 0.005 })).toBe(true)
    expect(withinTolerance(frac(199), key, { rel: 0.005 })).toBe(true)
    expect(withinTolerance(frac(20101, 100), key, { rel: 0.005 })).toBe(false)
    expect(withinTolerance(frac(-201), frac(-200), { rel: 0.005 })).toBe(true)
    expect(withinTolerance(frac(1), frac(0), { rel: 0.005 })).toBe(false)
  })

  it('abs bounds are exact decimals', () => {
    expect(boundOf(0.005).toString()).toBe('1/200')
    expect(boundOf(0.1).toString()).toBe('1/10')
    expect(withinTolerance(frac(13, 10), frac(12, 10), { abs: 0.1 })).toBe(true)
    expect(() => boundOf(-1)).toThrow(RangeError)
    expect(() => boundOf(1e-7)).toThrow(RangeError)
    expect(() => boundOf(Number.NaN)).toThrow(RangeError)
  })
})
