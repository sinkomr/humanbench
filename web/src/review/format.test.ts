/** Review-page JSON (ROADMAP M1.G7): same data as JSON.stringify, flat arrays on one line. */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { reviewJson } from './format'

describe('reviewJson', () => {
  it('parses back to the same value (property)', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        expect(JSON.parse(reviewJson(v))).toEqual(JSON.parse(JSON.stringify(v)))
      }),
    )
  })

  it('keeps flat arrays on one line and nests the rest', () => {
    expect(reviewJson({ sequences: [[4, 5, 3], [1, 2]], tol: { abs: 0 } })).toBe('{\n  "sequences": [\n    [4,5,3],\n    [1,2]\n  ],\n  "tol": {\n    "abs": 0\n  }\n}')
    expect(reviewJson({ positions: [2, 1, 3] })).toBe('{\n  "positions": [2,1,3]\n}')
  })
})
