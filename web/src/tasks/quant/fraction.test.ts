import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Fraction, Surd, bigGcd, exactRoot, frac } from './fraction'

const smallInt = fc.integer({ min: -10_000, max: 10_000 })
const nonZero = smallInt.filter((x) => x !== 0)
const fraction = fc.tuple(smallInt, nonZero).map(([n, d]) => frac(n, d))
const nonZeroFraction = fc.tuple(nonZero, nonZero).map(([n, d]) => frac(n, d))

describe('Fraction (BigInt rationals)', () => {
  it('normalises to lowest terms with a positive denominator', () => {
    expect(frac(6, -8).toString()).toBe('-3/4')
    expect(frac(-6, -8).toString()).toBe('3/4')
    expect(frac(0, -5).toString()).toBe('0')
    expect(frac(10, 5).toString()).toBe('2')
    expect(frac(10, 5).isInteger()).toBe(true)
    expect(frac(1n, 3n).d).toBe(3n)
  })

  it('rejects zero denominators and non-integer numbers', () => {
    expect(() => frac(1, 0)).toThrow(RangeError)
    expect(() => frac(1.5, 2)).toThrow(RangeError)
    expect(() => frac(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError)
    expect(() => frac(1, 2).div(Fraction.ZERO)).toThrow(RangeError)
  })

  it('does exact arithmetic', () => {
    expect(frac(2, 3).add(frac(5, 12)).toString()).toBe('13/12')
    expect(frac(1, 2).sub(frac(3, 4)).toString()).toBe('-1/4')
    expect(frac(2, 3).mul(frac(9, 4)).toString()).toBe('3/2')
    expect(frac(2, 3).div(frac(4, 9)).toString()).toBe('3/2')
    expect(frac(-2, 3).abs().toString()).toBe('2/3')
    expect(frac(2, 3).pow(3).toString()).toBe('8/27')
    expect(frac(2, 3).pow(-2).toString()).toBe('9/4')
    expect(frac(5).pow(0).toString()).toBe('1')
    expect(() => Fraction.ZERO.pow(-1)).toThrow(RangeError)
    expect(() => frac(2).pow(0.5)).toThrow(RangeError)
    // 1/3 + 1/3 + 1/3 is exactly 1 (floats would give 1 here too, but 0.1 + 0.2 would not).
    expect(frac(1, 10).add(frac(2, 10)).eq(frac(3, 10))).toBe(true)
  })

  it('compares', () => {
    expect(frac(1, 3).cmp(frac(1, 2))).toBe(-1)
    expect(frac(1, 2).cmp(frac(2, 4))).toBe(0)
    expect(frac(-1, 2).sign()).toBe(-1)
    expect(Fraction.ZERO.sign()).toBe(0)
    expect(frac(7, 2).toNumber()).toBe(3.5)
  })

  it('parses only canonical text', () => {
    expect(Fraction.parseCanonical('13/12')?.eq(frac(13, 12))).toBe(true)
    expect(Fraction.parseCanonical('-7')?.eq(frac(-7))).toBe(true)
    expect(Fraction.parseCanonical('0')?.isZero()).toBe(true)
    for (const bad of ['4/2', '3/1', '-0', '+3', '03', '1/-2', '1/0', '2/4', ' 3', '3.5', '', 'x', '1/02']) {
      expect(Fraction.parseCanonical(bad), bad).toBeNull()
    }
    expect(Fraction.parseCanonical(3 as unknown as string)).toBeNull()
  })

  it('satisfies the field laws (property)', () => {
    fc.assert(
      fc.property(fraction, fraction, fraction, (a, b, c) => {
        expect(a.add(b).eq(b.add(a))).toBe(true)
        expect(a.add(b).sub(b).eq(a)).toBe(true)
        expect(a.mul(b.add(c)).eq(a.mul(b).add(a.mul(c)))).toBe(true)
        expect(Fraction.parseCanonical(a.toString())?.eq(a)).toBe(true)
        expect(bigGcd(a.n, a.d)).toBe(a.n === 0n ? a.d : 1n)
        expect(a.d > 0n).toBe(true)
      }),
    )
    fc.assert(
      fc.property(fraction, nonZeroFraction, (a, b) => {
        expect(a.div(b).mul(b).eq(a)).toBe(true)
      }),
    )
  })
})

describe('exactRoot', () => {
  it('finds exact integer roots only', () => {
    expect(exactRoot(729n, 3)).toBe(9n)
    expect(exactRoot(730n, 3)).toBeNull()
    expect(exactRoot(0n, 2)).toBe(0n)
    expect(exactRoot(1n, 5)).toBe(1n)
    expect(exactRoot(-8n, 3)).toBeNull()
    expect(exactRoot(10n ** 40n, 4)).toBe(10n ** 10n)
    expect(() => exactRoot(4n, 0)).toThrow(RangeError)
  })

  it('agrees with k-th powers (property)', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 12n }), fc.integer({ min: 1, max: 6 }), (r, k) => {
        expect(exactRoot(r ** BigInt(k), k)).toBe(r)
        if (r > 1n && k > 1) expect(exactRoot(r ** BigInt(k) + 1n, k)).toBeNull()
      }),
    )
  })
})

describe('Surd (a + b√D)', () => {
  it('computes x³ + 1/x³ = 18 for x + 1/x = 3 (DESIGN §14.6 example 3)', () => {
    // x = (3 ± √5)/2
    for (const s of [1, -1]) {
      const x = new Surd(frac(3, 2), frac(s, 2), 5n)
      const k = x.add(x.inv())
      expect(k.isRational() && k.a.eq(frac(3))).toBe(true)
      const v = x.pow(3).add(x.pow(-3))
      expect(v.isRational()).toBe(true)
      expect(v.a.toString()).toBe('18')
    }
  })

  it('inverts and rejects bad radicands', () => {
    const x = new Surd(frac(1), frac(1), 2n)
    const one = x.mul(x.inv())
    expect(one.isRational() && one.a.eq(Fraction.ONE)).toBe(true)
    expect(x.sub(x).isRational()).toBe(true)
    expect(() => new Surd(frac(1), frac(1), 4n)).toThrow(RangeError)
    expect(() => new Surd(frac(1), frac(1), 0n)).toThrow(RangeError)
    expect(() => x.add(new Surd(frac(1), frac(1), 3n))).toThrow(RangeError)
    expect(() => new Surd(Fraction.ZERO, Fraction.ZERO, 2n).inv()).toThrow(RangeError)
  })

  it('pow matches repeated multiplication (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: -20, max: 20 }), fc.integer({ min: 1, max: 20 }), fc.integer({ min: 0, max: 6 }), (a, b, k) => {
        const x = new Surd(frac(a), frac(b), 7n)
        let p = new Surd(Fraction.ONE, Fraction.ZERO, 7n)
        for (let i = 0; i < k; i++) p = p.mul(x)
        const q = x.pow(k)
        expect(q.a.eq(p.a) && q.b.eq(p.b)).toBe(true)
      }),
    )
  })
})
