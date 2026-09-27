import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { evaluate, ratPow } from './expr'
import { frac } from './fraction'

const ev = (s: string): string => evaluate(s).toString()

describe('expression evaluator', () => {
  it('follows the usual precedence and left-to-right order', () => {
    expect(ev('37 × 4 − 96 ÷ 8')).toBe('136')
    expect(ev('144 ÷ 12 × 5 + 17')).toBe('77')
    expect(ev('(49 + 56) × 8 − 82')).toBe('758')
    expect(ev('10 − 4 − 3')).toBe('3')
    expect(ev('2/3 + 5/12')).toBe('13/12')
    expect(ev('(2/3) ÷ (5/12)')).toBe('8/5')
    expect(ev('2/3 × 5/12')).toBe('5/18')
  })

  it('handles powers, unary minus and rational exponents', () => {
    expect(ev('2^7 × 2^5 ÷ 2^9')).toBe('8')
    expect(ev('(3^4)^3 ÷ 3^10')).toBe('9')
    expect(ev('2^3^2')).toBe('512') // right-associative
    expect(ev('−2^2')).toBe('-4')
    expect(ev('(−2)^2')).toBe('4')
    expect(ev('2^−2')).toBe('1/4')
    expect(ev('27^(2/3)')).toBe('9')
    expect(ev('64^(−3/2)')).toBe('1/512')
    expect(ev('(−8)^(1/3)')).toBe('-2')
    expect(ev('(4/9)^(1/2)')).toBe('2/3')
  })

  it('rejects irrational, undefined and malformed input', () => {
    expect(() => evaluate('2^(1/2)')).toThrow(RangeError)
    expect(() => evaluate('(−4)^(1/2)')).toThrow(RangeError)
    expect(() => evaluate('0^−1')).toThrow(RangeError)
    expect(() => evaluate('1 ÷ 0')).toThrow(RangeError)
    expect(() => evaluate('2^100')).toThrow(RangeError)
    expect(() => evaluate('2 +')).toThrow(SyntaxError)
    expect(() => evaluate('(2 + 3')).toThrow(SyntaxError)
    expect(() => evaluate('2 3')).toThrow(SyntaxError)
    expect(() => evaluate('2.5 + 1')).toThrow(SyntaxError)
    expect(() => evaluate('x + 1')).toThrow(SyntaxError)
    expect(() => evaluate('')).toThrow(SyntaxError)
  })

  it('ratPow is exact', () => {
    expect(ratPow(frac(729), frac(-2, 3)).toString()).toBe('1/81')
    expect(ratPow(frac(1, 8), frac(2, 3)).toString()).toBe('1/4')
    expect(() => ratPow(frac(2), frac(1, 3))).toThrow(RangeError)
  })

  it('agrees with direct Fraction arithmetic on random expressions (property)', () => {
    const n = fc.integer({ min: 1, max: 999 })
    fc.assert(
      fc.property(n, n, n, n, (a, b, c, d) => {
        expect(evaluate(`${a} × ${b} − ${c} ÷ ${d}`).eq(frac(a * b).sub(frac(c, d)))).toBe(true)
        expect(evaluate(`(${a} + ${b}) × ${c} − ${d}`).eq(frac((a + b) * c - d))).toBe(true)
        expect(evaluate(`${a}/${b} − ${c}/${d}`).eq(frac(a, b).sub(frac(c, d)))).toBe(true)
        expect(evaluate(`(${a}/${b}) ÷ (${c}/${d})`).eq(frac(a, b).div(frac(c, d)))).toBe(true)
      }),
    )
  })
})
