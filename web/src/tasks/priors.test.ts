import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  B_PRIOR_LIMIT,
  EXPECTED_TIME_BASE_S,
  EXPECTED_TIME_PER_50_WORDS_S,
  ICAR_ANCHOR_B,
  ICAR_MEAN_P,
  SIGMA_B_DEFAULT,
  STRATUM_B_CUTS,
  STRATUM_LABELS,
  WORD_SEPARATOR_RE,
  bFromP,
  clampPrior,
  countWords,
  expectedTimeFromWords,
  linearB,
  logit,
  stratumOfB,
} from './priors'

describe('p → b link (§6.ii)', () => {
  it('bFromP = −logit(p)', () => {
    expect(bFromP(0.5)).toBe(0)
    expect(bFromP(0.25)).toBeCloseTo(Math.log(3), 15)
    expect(bFromP(0.75)).toBeCloseTo(-Math.log(3), 15)
    fc.assert(fc.property(fc.double({ min: 0.001, max: 0.999, noNaN: true }), (p) => {
      expect(bFromP(p)).toBeCloseTo(-logit(p), 12)
      expect(bFromP(1 - p)).toBeCloseTo(-bFromP(p), 9)
    }))
  })

  it('logit rejects p outside (0, 1)', () => {
    for (const bad of [0, 1, -0.1, 1.1, Number.NaN]) expect(() => logit(bad)).toThrow(RangeError)
  })

  it('ICAR anchors are the §2.2 SAPA means (rotation .19, matrix .52, series .59)', () => {
    expect(ICAR_MEAN_P).toEqual({ rotation: 0.19, matrix: 0.52, series: 0.59 })
    expect(ICAR_ANCHOR_B.rotation).toBeCloseTo(1.45, 2)
    expect(ICAR_ANCHOR_B.matrix).toBeCloseTo(-0.08, 2)
    expect(ICAR_ANCHOR_B.series).toBeCloseTo(-0.364, 3)
    expect(ICAR_ANCHOR_B.rotation).toBeGreaterThan(ICAR_ANCHOR_B.matrix)
    expect(ICAR_ANCHOR_B.matrix).toBeGreaterThan(ICAR_ANCHOR_B.series)
    expect(SIGMA_B_DEFAULT).toBe(1.0)
  })
})

describe('clampPrior', () => {
  it('clamps to ±4 and rejects non-finite b', () => {
    expect(B_PRIOR_LIMIT).toBe(4)
    expect(clampPrior(5.2)).toBe(4)
    expect(clampPrior(-9)).toBe(-4)
    expect(clampPrior(1.25)).toBe(1.25)
    expect(clampPrior(3, 2)).toBe(2)
    expect(() => clampPrior(Number.NaN)).toThrow(RangeError)
    expect(() => clampPrior(Infinity)).toThrow(RangeError)
  })
})

describe('linearB', () => {
  const model = {
    anchorB: ICAR_ANCHOR_B.rotation,
    terms: { angle: { beta: 0.01, centre: 90 }, mirror: { beta: 0.5, centre: 0.5 } },
  }

  it('b = anchor + Σ β(x − centre), booleans as 0/1', () => {
    expect(linearB(model, { angle: 90, mirror: true })).toBeCloseTo(ICAR_ANCHOR_B.rotation + 0.25, 12)
    expect(linearB(model, { angle: 150, mirror: false, note: 'extra features are ignored' })).toBeCloseTo(
      ICAR_ANCHOR_B.rotation + 0.6 - 0.25,
      12,
    )
    expect(linearB({ anchorB: -0.3, terms: {} }, {})).toBe(-0.3)
  })

  it('throws on a missing or non-numeric feature', () => {
    expect(() => linearB(model, { angle: 90 })).toThrow(RangeError)
    expect(() => linearB(model, { angle: 'wide', mirror: true })).toThrow(RangeError)
    expect(() => linearB(model, { angle: Number.NaN, mirror: true })).toThrow(RangeError)
  })
})

describe('expected time prior (§7.4)', () => {
  it('25 s + 4 s per 50 words', () => {
    expect(EXPECTED_TIME_BASE_S).toBe(25)
    expect(EXPECTED_TIME_PER_50_WORDS_S).toBe(4)
    expect(expectedTimeFromWords(0)).toBe(25)
    expect(expectedTimeFromWords(50)).toBe(29)
    expect(expectedTimeFromWords(350)).toBe(53)
    expect(() => expectedTimeFromWords(-1)).toThrow(RangeError)
    expect(() => expectedTimeFromWords(Number.NaN)).toThrow(RangeError)
  })

  it('countWords splits on whitespace across texts', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('  7 + 5 = ?  ')).toBe(5)
    expect(countWords('one two', 'three\nfour\tfive')).toBe(5)
  })

  it('countWords splits on exactly the JS \\s class (the bank mirrors it character for character)', () => {
    // Python's str.split() would give 2 for the first two and 1 for the third.
    expect(countWords('a\x1cb')).toBe(1)
    expect(countWords('a\u0085b')).toBe(1)
    expect(countWords('a\ufeffb')).toBe(2)
    expect(countWords('a\u00a0b\u2009c\u3000d')).toBe(4)
    for (let c = 0; c <= 0xffff; c++) {
      const ch = String.fromCharCode(c)
      expect(WORD_SEPARATOR_RE.test(ch)).toBe(/\s/.test(ch))
    }
  })
})

describe('strata', () => {
  it('has a §6.ii label per stratum', () => {
    expect(Object.keys(STRATUM_LABELS)).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('stratumOfB bands b at the [SPEC] cut points', () => {
    expect(STRATUM_B_CUTS).toEqual([-1.5, -0.5, 0.5, 1.5, 2.5])
    expect(stratumOfB(-4)).toBe(1)
    expect(stratumOfB(-1.5)).toBe(2)
    expect(stratumOfB(-0.51)).toBe(2)
    expect(stratumOfB(0)).toBe(3)
    expect(stratumOfB(1)).toBe(4)
    expect(stratumOfB(2)).toBe(5)
    expect(stratumOfB(2.5)).toBe(6)
    expect(stratumOfB(4)).toBe(6)
    expect(() => stratumOfB(Number.NaN)).toThrow(RangeError)
  })

  it('stratumOfB is monotone', () => {
    fc.assert(
      fc.property(fc.double({ min: -4, max: 4, noNaN: true }), fc.double({ min: -4, max: 4, noNaN: true }), (x, y) => {
        const [lo, hi] = x <= y ? [x, y] : [y, x]
        expect(stratumOfB(lo)).toBeLessThanOrEqual(stratumOfB(hi))
      }),
    )
  })
})
