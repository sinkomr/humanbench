import { describe, expect, it } from 'vitest'
import { MalformedResponseError } from '../family'
import { quant } from '.'
import { Fraction, frac } from './fraction'
import { sampleOf, variantDef, withGiven } from './test-helpers'
import { quantRules } from './verify'

describe('quant scoring', () => {
  it('scores exact integer keys exactly', () => {
    const item = withGiven(sampleOf('linear_eq', 'both_sides'), { a: 7, b: -12, c: 3, d: 20 })
    expect(item.key).toEqual({ value: '8', tol: { abs: 0 } })
    for (const r of ['8', ' 8 ', '8.0', '+8', '16/2', '8.000']) expect(quant.score(item, r), r).toEqual({ correct: 1 })
    for (const r of ['7', '8.001', '-8', '', 'eight', '8 1/2']) expect(quant.score(item, r), r).toEqual({ correct: 0 })
  })

  it('accepts any equivalent form of a fraction key, but not a rounded decimal', () => {
    const item = withGiven(sampleOf('probability', 'both'), { red: 4, blue: 5, green: 3, colour: 'red' })
    expect(item.key).toEqual({ value: '1/11', tol: { abs: 0 } })
    for (const r of ['1/11', '2/22', ' 1 / 11 ']) expect(quant.score(item, r), r).toEqual({ correct: 1 })
    for (const r of ['0.0909', '0.09', '1/12', '11']) expect(quant.score(item, r), r).toEqual({ correct: 0 })
    const half = withGiven(sampleOf('exponent', 'root'), { base: 4, p: 1, q: 2, negative: true })
    expect(half.key.value).toBe('1/2')
    for (const r of ['1/2', '0.5', '.5', '2/4']) expect(quant.score(half, r), r).toEqual({ correct: 1 })
  })

  it('accepts a decimal answer to the cent (±0.005), not rounded to the dollar', () => {
    const item = withGiven(sampleOf('percent', 'discount'), { thing: 'lamp', price: 34, p: 15 })
    expect(item.key).toEqual({ value: '289/10', tol: { abs: 0.005 } })
    for (const r of ['28.9', '28.90', '$28.90', '289/10', '28.904', '28.905', '28.895']) expect(quant.score(item, r), r).toEqual({ correct: 1 })
    for (const r of ['29', '28.8', '28.906', '28.89', '29.04', '-28.9', '2890']) expect(quant.score(item, r), r).toEqual({ correct: 0 })
  })

  it('gives no credit to the classic slips on decimal items, for every valid given', () => {
    // rate/avg_speed: the plain mean of the leg speeds, (d1/t1 + d2/t2) / 2.
    const speed = sampleOf('rate', 'avg_speed')
    const speedDef = variantDef('rate', 'avg_speed')
    let speedGivens = 0
    for (let t1 = 1; t1 <= 4; t1++) {
      for (let t2 = 1; t2 <= 4; t2++) {
        for (let d1 = 5 * t1; d1 <= 45 * t1; d1++) {
          for (let d2 = 5 * t2; d2 <= 45 * t2; d2++) {
            if (!Object.values(quantRules(speedDef, { d1, t1, d2, t2 })).every(Boolean)) continue
            const item = withGiven(speed, { d1, t1, d2, t2 })
            speedGivens++
            const slip = frac(d1, t1).add(frac(d2, t2)).div(frac(2))
            expect(quant.score(item, slip.toString()), JSON.stringify(item.spec.given)).toEqual({ correct: 0 })
          }
        }
      }
    }
    expect(speedGivens).toBeGreaterThan(10_000)
    expect(quant.verify(withGiven(speed, { d1: 33, t1: 2, d2: 52, t2: 3 })).ok).toBe(true) // the review's example
    // percent/discount: p dollars off instead of p percent (right only at $100), and the dollar-rounded price.
    const sale = sampleOf('percent', 'discount')
    for (let price = 12; price <= 250; price++) {
      for (const p of [5, 10, 15, 20, 25, 30, 35, 40, 45, 60, 70]) {
        const item = withGiven(sale, { price, p })
        const key = Fraction.parseCanonical(item.key.value) as Fraction
        if (price !== 100) expect(quant.score(item, String(price - p)), `${price} ${p}`).toEqual({ correct: 0 })
        const dollars = Math.round(key.toNumber())
        if (!key.isInteger()) expect(quant.score(item, String(dollars)), `${price} ${p}`).toEqual({ correct: 0 })
      }
    }
  }, 60_000)

  it('handles negatives typed with either minus sign', () => {
    const item = withGiven(sampleOf('linear_eq', 'over'), { p: 4, b: 7, c: -3 })
    expect(item.key.value).toBe('-40')
    expect(quant.score(item, '-40')).toEqual({ correct: 1 })
    expect(quant.score(item, '−40')).toEqual({ correct: 1 })
    expect(quant.score(item, '40')).toEqual({ correct: 0 })
  })

  it('throws a MalformedResponseError on a non-string response (M1.F2); unparseable text is wrong', () => {
    const item = sampleOf('arith', 'group_mul')
    for (const bad of [42, undefined, null, ['42'], { value: '42' }]) expect(() => quant.score(item, bad as unknown as string)).toThrow(MalformedResponseError)
    expect(quant.score(item, 'forty-two')).toEqual({ correct: 0 })
  })
})
