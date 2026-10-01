/** Reading and showing a typed magnitude (ROADMAP M5.1). */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { formatMagnitude, parseMagnitude, spokenMagnitude } from './magnitude'

const value = (text: string): number => {
  const r = parseMagnitude(text)
  if (!r.ok) throw new Error(`${JSON.stringify(text)} was not read: ${r.problem}`)
  return r.value
}

describe('parseMagnitude reads the ways people write a number', () => {
  it.each([
    ['3200000', 3200000],
    ['31,557,600', 31557600],
    ['31 557 600', 31557600],
    ['31 557 600', 31557600],
    ['3.2e6', 3.2e6],
    ['3.2E+6', 3.2e6],
    ['1e-3', 0.001],
    ['3.2 × 10^6', 3.2e6],
    ['3.2x10^6', 3.2e6],
    ['3.2 X 10 ^ 6', 3.2e6],
    ['3.2*10^6', 3.2e6],
    ['3.2 · 10^6', 3.2e6],
    ['3.2 × 10⁶', 3.2e6],
    ['3.2 × 10⁻⁶', 3.2e-6],
    ['3.2 × 10^-6', 3.2e-6],
    ['3.2 × 10^−6', 3.2e-6],
    ['10^6', 1e6],
    ['10⁹', 1e9],
    ['0.0025', 0.0025],
    ['.5', 0.5],
    ['5.', 5],
    ['  42  ', 42],
    ['+42', 42],
    ['007', 7],
    ['12,345.67', 12345.67],
  ])('%j is %d', (text, expected) => {
    expect(value(text)).toBe(expected)
  })

  it('is exact for what is typed (no float drift from the exponent)', () => {
    expect(value('6.02214076e23')).toBe(6.02214076e23)
    expect(value('6.02214076 × 10^23')).toBe(6.02214076e23)
    expect(value('1.1e-5')).toBe(1.1e-5)
  })

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['-5', 'negative'],
    ['−5', 'negative'],
    ['-3.2e6', 'negative'],
    ['0', 'zero'],
    ['0.0', 'zero'],
    ['0e5', 'zero'],
    ['2,5', 'decimal_comma'],
    ['1,5000', 'decimal_comma'],
    ['12,34', 'decimal_comma'],
    ['5 km', 'has_unit'],
    ['3 million', 'has_unit'],
    ['1e3 km', 'has_unit'],
    ['1,000 km', 'has_unit'],
    ['abc', 'unreadable'],
    ['3.2 × 10', 'unreadable'],
    ['3.2x107', 'has_unit'],
    ['1.2.3', 'unreadable'],
    ['1e', 'has_unit'],
    ['NaN', 'unreadable'],
    ['Infinity', 'unreadable'],
    ['1e31', 'range'],
    ['1e-31', 'range'],
    ['1e9999', 'range'],
    ['10^40', 'range'],
    ['9'.repeat(400), 'range'],
  ])('%j is refused as %s', (text, problem) => {
    expect(parseMagnitude(text)).toEqual({ ok: false, problem })
  })

  it('accepts the ends of the allowed range', () => {
    expect(value('1e-30')).toBe(1e-30)
    expect(value('1e30')).toBe(1e30)
  })

  it('never reads a decimal comma as thousands', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999 }), fc.integer({ min: 1, max: 99 }), (a, b) => {
        expect(parseMagnitude(`${a},${b}`).ok).toBe(false)
      }),
    )
  })

  it('refuses non-strings', () => {
    expect(parseMagnitude(5 as unknown as string)).toEqual({ ok: false, problem: 'unreadable' })
  })
})

describe('formatMagnitude', () => {
  it.each([
    [31600, '31,600'],
    [0.0025, '0.0025'],
    [1, '1'],
    [999999, '999,999'],
    [1.5, '1.5'],
    [3.15576e7, '3.15576 × 10⁷'],
    [3.2e-7, '3.2 × 10⁻⁷'],
    [6.02214076e23, '6.02214 × 10²³'],
    [1e6, '1 × 10⁶'],
  ])('%d is shown as %j', (v, text) => {
    expect(formatMagnitude(v)).toBe(text)
  })

  it('shows nothing for a number that is not a magnitude', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(formatMagnitude(bad)).toBe('')
      expect(spokenMagnitude(bad)).toBe('')
    }
  })

  it('reads aloud as words, not superscripts', () => {
    expect(spokenMagnitude(3.15576e7)).toBe('3.15576 times 10 to the 7')
    expect(spokenMagnitude(3.2e-7)).toBe('3.2 times 10 to the -7')
    expect(spokenMagnitude(31600)).toBe('31,600')
  })

  it('is read back to the same number to six figures (property over the whole range)', () => {
    fc.assert(
      fc.property(fc.double({ min: -30, max: 30, noNaN: true }), (logV) => {
        const v = 10 ** logV
        const back = value(formatMagnitude(v))
        expect(Math.abs(back - v) / v).toBeLessThanOrEqual(5.1e-6)
      }),
      { numRuns: 500 },
    )
  })
})
