import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ENTRY_VECTORS } from './entry-vectors'
import { Fraction, frac } from './fraction'
import { MAX_ENTRY_LENGTH, boundOf, checkNewEntry, isThousandsEntry, parseEntry, withinTolerance } from './numeric'

const p = (s: string): string | null => parseEntry(s)?.toString() ?? null

/**
 * The grammar as it was before the decimal comma (UX-079), frozen here as the oracle for saved
 * answers: results are re-scored from raw responses (§7.8), so every entry it read must keep its
 * value. A verbatim copy of the old `parseEntry`; never edit it.
 */
function parseEntryBefore(raw: unknown): Fraction | null {
  if (typeof raw !== 'string') return null
  const trim = (x: string): string => x.replace(/^[ \t\n\r\f\v ]+|[ \t\n\r\f\v ]+$/g, '')
  const decimal = (x: string): Fraction => {
    const [int = '', fracPart = ''] = x.split('.')
    const digits = `${int}${fracPart}`.replace(/^0+(?=\d)/, '') || '0'
    return Fraction.of(BigInt(digits), 10n ** BigInt(fracPart.length))
  }
  let s = trim(raw).replace(/−/g, '-')
  if (s.length === 0 || s.length > 32) return null
  let sign = 1n
  if (s.startsWith('-') || s.startsWith('+')) {
    if (s.startsWith('-')) sign = -1n
    s = s.slice(1)
  }
  if (s.startsWith('$')) s = s.slice(1)
  if (s.endsWith('%')) s = s.slice(0, -1)
  s = trim(s)
  let v: Fraction | null = null
  if (/^(\d+(?:\.\d*)?|\.\d+)$/.test(s)) v = decimal(s)
  else if (/^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/.test(s)) v = decimal(s.replace(/,/g, ''))
  else {
    const f = /^(\d+)[ \t]*\/[ \t]*(\d+)$/.exec(s)
    const m = /^(\d+)[ \t]+(\d+)[ \t]*\/[ \t]*(\d+)$/.exec(s)
    if (f) {
      const d = BigInt(f[2] as string)
      if (d !== 0n) v = Fraction.of(BigInt(f[1] as string), d)
    } else if (m) {
      const d = BigInt(m[3] as string)
      if (d !== 0n) v = Fraction.of(BigInt(m[1] as string)).add(Fraction.of(BigInt(m[2] as string), d))
    }
  }
  return v === null ? null : sign < 0n ? v.neg() : v
}

/** Short entries over the characters the grammar cares about, so the properties hit every branch often. */
const entryText = fc
  .array(fc.constantFrom('0', '1', '2', '5', '9', ',', ',', '.', '/', ' ', '-', '+', '−', '$', '%', 'a'), { maxLength: 12 })
  .map((cs) => cs.join(''))

describe('numeric entry parsing', () => {
  it('accepts integers, decimals, decimal commas, thousands, fractions and mixed numbers', () => {
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
      ['3,5', '7/2'],
      ['0,25', '1/4'],
      ['-1,5', '-3/2'],
      ['0,5', '1/2'],
      ['1,23', '123/100'],
      ['1,533', '1533'],
      ['1,500', '1500'],
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
    for (const s of ['', ' ', 'abc', '1/0', '12,3456', '3,14159', '1,5,0', ',5', '3,', '3, 5', '1e3', '--3', '+-3', '3-', '1/2/3', '1.2.3', '½', '3 /', '2 1/0', '$-5', '1 2', '٣', '1 2/3']) {
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

  it('reads a comma before one or two digits as a decimal point (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), fc.integer({ min: 0, max: 99 }), fc.boolean(), (n, m, two) => {
        const digits = two ? String(m).padStart(2, '0') : String(m % 10)
        const point = parseEntry(`${n}.${digits}`)
        expect(point).not.toBeNull()
        expect(parseEntry(`${n},${digits}`)?.eq(point as Fraction)).toBe(true)
        expect(checkNewEntry(`${n},${digits}`)).toBe('ok')
      }),
    )
  })
})

describe('saved answers re-score unchanged (§7.8)', () => {
  it('every entry the earlier grammar read keeps its value (property)', () => {
    fc.assert(
      fc.property(entryText, (s) => {
        const before = parseEntryBefore(s)
        const now = parseEntry(s)
        if (before !== null) expect(now?.eq(before), JSON.stringify(s)).toBe(true)
        // The only entries read now and not before are decimal commas.
        else if (now !== null) expect(s, JSON.stringify(s)).toMatch(/^[ \t\n\r\f\v ]*[-+−]?\$?[ \t\n\r\f\v ]*\d+,\d{1,2}[ \t\n\r\f\v ]*%?[ \t\n\r\f\v ]*$/)
      }),
      { numRuns: 3000 },
    )
  })

  it('thousands commas keep their old value: a saved "1,500" is 1500 (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1_000, max: 999_999_999 }), fc.boolean(), (n, neg) => {
        const grouped = `${neg ? '-' : ''}${n.toLocaleString('en-US')}`
        expect(parseEntry(grouped)?.eq(frac(neg ? -n : n))).toBe(true)
        expect(parseEntryBefore(grouped)?.eq(frac(neg ? -n : n))).toBe(true)
        expect(isThousandsEntry(grouped)).toBe(true)
        expect(checkNewEntry(grouped)).toBe('thousands')
      }),
    )
  })
})

describe('the entry box check of a new entry', () => {
  it('refuses the thousands form, reads everything else as the scoring parser does (property)', () => {
    fc.assert(
      fc.property(entryText, (s) => {
        const check = checkNewEntry(s)
        expect(check === 'unreadable', JSON.stringify(s)).toBe(parseEntry(s) === null)
        expect(check === 'thousands', JSON.stringify(s)).toBe(isThousandsEntry(s))
        // A refused thousands entry is one the earlier grammar read, so saved ones still score.
        if (check === 'thousands') expect(parseEntryBefore(s)?.eq(parseEntry(s) as Fraction)).toBe(true)
      }),
      { numRuns: 3000 },
    )
  })

  it('names "1,500", "12,345.5", "-$1,500" and "1,500%" as thousands, and not "3,5", "1500" or "1,5,0"', () => {
    for (const s of ['1,500', '12,345.5', '-$1,500', '1,500%', ' 0,500 ', '1,000,000']) expect(isThousandsEntry(s), s).toBe(true)
    for (const s of ['3,5', '0,25', '1500', '1.5', '1,5,0', '12,3456', '', 42, null]) expect(isThousandsEntry(s), String(s)).toBe(false)
  })
})

describe('shared vectors (entry-vectors.ts, the bank copy golden/ts_dumps/quant_entry.json)', () => {
  it('this parser, the entry box check and the earlier grammar give every vector', () => {
    for (const c of ENTRY_VECTORS) {
      const what = JSON.stringify(c.raw)
      expect(parseEntry(c.raw)?.toString() ?? null, what).toBe(c.value)
      expect(parseEntryBefore(c.raw)?.toString() ?? null, what).toBe(c.before)
      expect(checkNewEntry(c.raw), what).toBe(c.new_entry)
      if (c.before !== null) expect(c.value, what).toBe(c.before)
    }
  })

  it('cover every verdict, decimal commas, thousands and non-text responses', () => {
    const by = (f: (c: (typeof ENTRY_VECTORS)[number]) => boolean): number => ENTRY_VECTORS.filter(f).length
    expect(by((c) => c.new_entry === 'ok' && c.before === null)).toBeGreaterThanOrEqual(10) // new: decimal commas
    expect(by((c) => c.new_entry === 'thousands')).toBeGreaterThanOrEqual(10)
    expect(by((c) => c.new_entry === 'unreadable')).toBeGreaterThanOrEqual(20)
    expect(by((c) => typeof c.raw !== 'string')).toBeGreaterThanOrEqual(2)
    expect(new Set(ENTRY_VECTORS.map((c) => JSON.stringify(c.raw))).size).toBe(ENTRY_VECTORS.length)
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
