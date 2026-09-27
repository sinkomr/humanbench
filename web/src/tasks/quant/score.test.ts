import { describe, expect, it } from 'vitest'
import { quant } from '.'
import { sampleOf, withGiven } from './test-helpers'

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

  it('applies ±0.5% where decimals are expected', () => {
    const item = withGiven(sampleOf('percent', 'discount'), { thing: 'lamp', price: 34, p: 15 })
    expect(item.key).toEqual({ value: '289/10', tol: { rel: 0.005 } })
    // 28.9 ± 0.1445
    for (const r of ['28.9', '28.90', '$28.90', '289/10', '28.8', '29', '29.04']) expect(quant.score(item, r), r).toEqual({ correct: 1 })
    for (const r of ['28.7', '29.1', '-28.9', '2890']) expect(quant.score(item, r), r).toEqual({ correct: 0 })
  })

  it('handles negatives typed with either minus sign', () => {
    const item = withGiven(sampleOf('linear_eq', 'over'), { p: 4, b: 7, c: -3 })
    expect(item.key.value).toBe('-40')
    expect(quant.score(item, '-40')).toEqual({ correct: 1 })
    expect(quant.score(item, '−40')).toEqual({ correct: 1 })
    expect(quant.score(item, '40')).toEqual({ correct: 0 })
  })

  it('scores a non-string response as incorrect', () => {
    const item = sampleOf('arith', 'group_mul')
    expect(quant.score(item, 42 as unknown as string)).toEqual({ correct: 0 })
    expect(quant.score(item, undefined as unknown as string)).toEqual({ correct: 0 })
  })
})
