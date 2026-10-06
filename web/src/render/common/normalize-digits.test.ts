/**
 * Typed-entry normalisation (ROADMAP M1.13, A18; UX-024): digits of other scripts and full-width
 * forms become the ASCII digits the bank's parsers read, white space inside a plain number goes, and
 * nothing else about an entry changes (so a mixed number or a decimal comma is still what it was).
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { parseEntry } from '../../tasks/quant/numeric'
import { normalizeDigits, normalizeEntry, normalizeNumber, usesDecimalComma } from './normalize-digits'

/** First digit of each supported script (its ten digits follow in code-point order); '0' is plain ASCII. */
const SCRIPTS: Readonly<Record<string, number>> = {
  ascii: 0x30,
  fullwidth: 0xff10,
  'arabic-indic': 0x0660,
  'extended-arabic-indic': 0x06f0,
  devanagari: 0x0966,
}

const inScript = (text: string, zero: number): string => text.replace(/\d/g, (d) => String.fromCodePoint(zero + Number(d)))

const SPACES = [' ', ' ', ' ', '\t', ' ']

describe('normalizeDigits', () => {
  it('maps every digit of every supported script to its ASCII digit', () => {
    for (const [name, zero] of Object.entries(SCRIPTS)) {
      const typed = Array.from({ length: 10 }, (_, d) => String.fromCodePoint(zero + d)).join('')
      expect(normalizeDigits(typed), name).toBe('0123456789')
    }
  })

  it('leaves ASCII text, letters and other scripts alone', () => {
    for (const text of ['', 'abc', '3/8', '2 1/3', '1,533', '12.5', '−7', 'ß', 'あ']) expect(normalizeDigits(text)).toBe(text)
  })

  it('turns the full-width forms of the sign, the point and the slash into ASCII (NFKC)', () => {
    expect(normalizeDigits('－１２．５')).toBe('-12.5')
    expect(normalizeDigits('３／８')).toBe('3/8')
  })
})

describe('normalizeNumber', () => {
  it('for any integer, in any supported script, with spaces of any kind anywhere inside, is its plain decimal text (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -999_999_999, max: 999_999_999 }),
        fc.constantFrom(...Object.values(SCRIPTS)),
        fc.array(fc.tuple(fc.nat(12), fc.constantFrom(...SPACES)), { maxLength: 5 }),
        (n, zero, gaps) => {
          let typed = inScript(String(n), zero)
          for (const [at, space] of gaps) typed = `${typed.slice(0, at % (typed.length + 1))}${space}${typed.slice(at % (typed.length + 1))}`
          expect(normalizeNumber(typed)).toBe(String(n))
        },
      ),
    )
  })

  it('does the same for decimals: the point stays, the digits and the spaces go through', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99_999 }), fc.integer({ min: 0, max: 9999 }), fc.constantFrom(...Object.values(SCRIPTS)), (whole, frac, zero) => {
        const plain = `${whole}.${frac}`
        expect(normalizeNumber(inScript(`${whole} . ${frac}`, zero))).toBe(plain)
        expect(normalizeNumber(` ${inScript(plain, zero)} `)).toBe(plain)
      }),
    )
  })

  it('removes the spaces that group digits: "1 000" is 1000, "1 000" and "1 000" too', () => {
    for (const typed of ['1 000', '1 000', '1 000', ' 1 0 0 0 ']) expect(normalizeNumber(typed)).toBe('1000')
  })

  it('keeps the spacing of anything that is not a plain number, so a mixed number is never read as another value', () => {
    expect(normalizeNumber('2 1/3')).toBe('2 1/3')
    expect(parseEntry(normalizeNumber('2 1/3'))?.toString()).toBe('7/3')
    expect(normalizeNumber('3 / 8')).toBe('3 / 8')
    expect(normalizeNumber('$ 12.50')).toBe('$ 12.50')
    expect(normalizeNumber('1 000,5')).toBe('1 000,5')
    expect(normalizeNumber('abc def')).toBe('abc def')
  })

  it('never turns text the parser cannot read into text it can, unless the text was a plain number to begin with (property)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 10 }), (text) => {
        const out = normalizeNumber(text)
        if (parseEntry(out) !== null && parseEntry(text) === null) expect(out).toMatch(/^[+\-−]?\d*\.?\d*$/)
      }),
      { numRuns: 300 },
    )
  })

  it('is idempotent (property)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 12 }), (text) => {
        expect(normalizeNumber(normalizeNumber(text))).toBe(normalizeNumber(text))
      }),
      { numRuns: 300 },
    )
  })
})

describe('normalizeEntry', () => {
  it('integers and decimals are normalised as numbers, fractions only in their digits, letters not at all', () => {
    expect(normalizeEntry('٣٥', 'integer')).toBe('35')
    expect(normalizeEntry('１ ２', 'integer')).toBe('12')
    expect(normalizeEntry('1 2.5', 'decimal')).toBe('12.5')
    expect(normalizeEntry('２ １/３', 'fraction')).toBe('2 1/3')
    expect(normalizeEntry(' k ', 'letter')).toBe(' k ')
  })
})

describe('usesDecimalComma', () => {
  it('is true for languages that write 1,5 and false for those that write 1.5', () => {
    for (const locale of ['de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'ru-RU']) expect(usesDecimalComma(locale), locale).toBe(true)
    for (const locale of ['en-GB', 'en-US', 'ja-JP', 'zh-CN']) expect(usesDecimalComma(locale), locale).toBe(false)
  })

  it('is false for a locale it cannot read', () => {
    expect(usesDecimalComma('not a locale!!')).toBe(false)
  })
})
