import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { STATIC_BANK_VERSION, laterBankVersion, latestBankVersion } from './bank-version'
import { VERSION_TAG_RE } from './validate'

describe('the bank version at the top of a save (DESIGN §8)', () => {
  it('the device’s label loses to any served bank; dated tags order by date, then by build number as a number', () => {
    expect(STATIC_BANK_VERSION).toBe('m1-static')
    expect(laterBankVersion('m1-static', '2026.10.12-b1')).toBe('2026.10.12-b1')
    expect(laterBankVersion('2026.10.12-b2', 'm1-static')).toBe('2026.10.12-b2')
    expect(laterBankVersion('2026.10.12-b2', '2026.10.12-b10')).toBe('2026.10.12-b10')
    expect(laterBankVersion('2026.10.12-b10', '2026.10.13-b1')).toBe('2026.10.13-b1')
    expect(laterBankVersion('2025.12.31-b9', '2026.01.01-b1')).toBe('2026.01.01-b1')
    // a tag of another shape (a test bank) is above the device's label and below a dated one
    expect(laterBankVersion('bank-test', 'm1-static')).toBe('bank-test')
    expect(laterBankVersion('bank-test', '2026.10.12-b1')).toBe('2026.10.12-b1')
    expect(laterBankVersion('bank-a', 'bank-b')).toBe('bank-b')
    expect(latestBankVersion(['m1-static', '2026.10.12-b1', '2026.10.12-b2', 'm1-static'])).toBe('2026.10.12-b2')
    expect(latestBankVersion(['m1-static'])).toBe('m1-static')
    expect(() => latestBankVersion([])).toThrow(RangeError)
  })

  it('property: taking the later one is idempotent, commutative and associative, and picks one of its inputs (so a merge in any order gives one label)', () => {
    const tag = fc.oneof(
      fc.constant(STATIC_BANK_VERSION),
      fc.tuple(fc.integer({ min: 2026, max: 2028 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }), fc.integer({ min: 1, max: 120 })).map(([y, m, d, b]) => `${y}.${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')}-b${b}`),
      fc.stringMatching(/^[0-9A-Za-z][0-9A-Za-z._+-]{0,12}$/u),
    )
    fc.assert(
      fc.property(tag, tag, tag, (a, b, c) => {
        for (const t of [a, b, c]) expect(VERSION_TAG_RE.test(t)).toBe(true)
        expect(laterBankVersion(a, a)).toBe(a)
        expect(laterBankVersion(a, b)).toBe(laterBankVersion(b, a))
        expect(laterBankVersion(laterBankVersion(a, b), c)).toBe(laterBankVersion(a, laterBankVersion(b, c)))
        expect([a, b]).toContain(laterBankVersion(a, b))
        expect(latestBankVersion([a, b, c])).toBe(latestBankVersion([c, a, b]))
      }),
      { numRuns: 500 },
    )
  })
})
