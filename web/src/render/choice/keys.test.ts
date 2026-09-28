/**
 * Keyboard map of the option group (ROADMAP M1.13; DESIGN §13 keyboard navigation).
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { MAX_OPTIONS, OPTION_LETTERS, optionIndexForKey, optionLetter } from './keys'

describe('option keys', () => {
  it('labels positions A, B, C, … in order', () => {
    expect([0, 1, 2, 3, 4, 5].map(optionLetter).join('')).toBe('ABCDEF')
    expect(MAX_OPTIONS).toBe(OPTION_LETTERS.length)
    for (const bad of [-1, MAX_OPTIONS, 1.5]) expect(() => optionLetter(bad)).toThrow(RangeError)
  })

  it('maps digits 1–9 and letters a–i (either case) to positions 0–8, within the option count', () => {
    expect(optionIndexForKey('1', 4)).toBe(0)
    expect(optionIndexForKey('4', 4)).toBe(3)
    expect(optionIndexForKey('5', 4)).toBeNull()
    expect(optionIndexForKey('a', 6)).toBe(0)
    expect(optionIndexForKey('F', 6)).toBe(5)
    expect(optionIndexForKey('g', 6)).toBeNull()
    for (const k of ['0', 'Enter', 'ArrowDown', ' ', 'j', 'z', '10', 'aa', '']) expect(optionIndexForKey(k, 9)).toBeNull()
  })

  it('is consistent: the digit and the letter of a position pick that position', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: MAX_OPTIONS }), fc.integer({ min: 0, max: MAX_OPTIONS - 1 }), (count, i) => {
        const want = i < count ? i : null
        expect(optionIndexForKey(String(i + 1), count)).toBe(want)
        expect(optionIndexForKey(optionLetter(i), count)).toBe(want)
        expect(optionIndexForKey(optionLetter(i).toLowerCase(), count)).toBe(want)
      }),
    )
  })
})
