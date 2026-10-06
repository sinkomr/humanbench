/**
 * The count-aware wording of the checker (UX-052): "line 14" against "lines 14 and 15", and a list said
 * the way a person says it.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { lineRef, sayList } from './format'

describe('sayList', () => {
  it('joins the way a person says a list', () => {
    expect(sayList([])).toBe('')
    expect(sayList([14])).toBe('14')
    expect(sayList([14, 15])).toBe('14 and 15')
    expect(sayList([14, 15, 16])).toBe('14, 15 and 16')
    expect(sayList(['a', 'b', 'c', 'd'])).toBe('a, b, c and d')
  })

  it('keeps every item in order, with no comma before the last "and"', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 999 }), { minLength: 2, maxLength: 12 }), (items) => {
        const said = sayList(items)
        expect(said).not.toMatch(/, and /)
        expect(said.split(/, | and /).map(Number)).toEqual(items)
      }),
    )
  })
})

describe('lineRef', () => {
  it('uses "line" for one and "lines" for several', () => {
    expect(lineRef([14])).toBe('line 14')
    expect(lineRef([14, 15])).toBe('lines 14 and 15')
    expect(lineRef([3, 9, 12])).toBe('lines 3, 9 and 12')
  })

  it('is singular exactly when there is one line', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 999 }), { minLength: 1, maxLength: 10 }), (lines) => {
        expect(lineRef(lines).startsWith(lines.length === 1 ? 'line ' : 'lines ')).toBe(true)
      }),
    )
  })
})
