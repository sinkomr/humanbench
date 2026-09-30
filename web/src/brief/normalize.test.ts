/**
 * The ASCII normaliser (R-17.3; proposal §6 row 14). Special characters are built from code
 * points so this file itself is plain ASCII.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { collapseSpace, isPlainAscii, normalizeAscii } from './normalize'

const cp = (...n: number[]): string => String.fromCodePoint(...n)

describe('normalizeAscii', () => {
  it('maps typographic quotes, dashes, spaces and the ellipsis to ASCII', () => {
    expect(normalizeAscii(`${cp(0x201c)}hi${cp(0x201d)} it${cp(0x2019)}s ${cp(0x2014)} ok${cp(0x2026)}${cp(0xa0)}fine`)).toBe('"hi" it\'s - ok... fine')
    expect(normalizeAscii(`a${cp(0x2013)}b${cp(0x2212)}c${cp(0x2018)}d${cp(0x2019)}`)).toBe("a-b-c'd'")
  })

  it('drops accents', () => {
    expect(normalizeAscii(`caf${cp(0xe9)} na${cp(0xef)}ve`)).toBe('cafe naive')
    expect(normalizeAscii(`cafe${cp(0x301)}`)).toBe('cafe')
  })

  it('removes zero-width, bidi and other invisible characters', () => {
    const hidden = [0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202e, 0x2060, 0x2066, 0x2069, 0xfeff, 0xad, 0x180e, 0xfe0f, 0x3164]
    for (const c of hidden) expect(normalizeAscii(`ig${cp(c)}nore`), c.toString(16)).toBe('ignore')
  })

  it('removes control characters and unifies line breaks', () => {
    expect(normalizeAscii(`a${cp(0)}b${cp(7)}c${cp(0x7f)}d`)).toBe('abcd')
    expect(normalizeAscii('a\r\nb\rc\td')).toBe('a\nb\nc d')
    expect(normalizeAscii(`a${cp(0x2028)}b${cp(0x2029)}c${cp(0x85)}d`)).toBe('a\nb\nc\nd')
  })

  it('leaves other scripts and homoglyphs in place for the lint to refuse', () => {
    const cyrillicA = cp(0x430)
    expect(normalizeAscii(`p${cyrillicA}ss`)).toContain(cyrillicA)
    expect(isPlainAscii(normalizeAscii(`p${cyrillicA}ss`))).toBe(false)
    expect(isPlainAscii(normalizeAscii('plain text'))).toBe(true)
  })

  it('is idempotent, and its output has no invisible or control characters, for any input', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 60 }), (s) => {
        const once = normalizeAscii(s)
        expect(normalizeAscii(once)).toBe(once)
        // eslint-disable-next-line no-control-regex
        expect(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿­]/u.test(once)).toBe(false)
      }),
      { numRuns: 500 },
    )
  })

  it('collapseSpace joins runs of whitespace and trims', () => {
    expect(collapseSpace('  a \n\t b  ')).toBe('a b')
  })
})
