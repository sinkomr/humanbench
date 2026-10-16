/**
 * Hard quant table 2 (generator 1.4.0, ROADMAP M3.12): every variant's generated items verify,
 * hand-worked stems and keys (the same givens as the bank's `tests/gen/test_quant_hard2.py`), a
 * negative case for every rule, and the key formats.
 */

import { describe, expect, it } from 'vitest'
import type { JsonValue } from '../../engine'
import type { QuantItem } from '.'
import { HARD2 } from './hard2'
import { sampleOf, samplesOf, variantDef, withGiven } from './test-helpers'
import { CHECKS_HARD2 } from './verify-hard2'
import { quantRules, verifyQuant } from './verify'

const ids = HARD2.map((v) => `${v.template}/${v.variant}`)
const split = (id: string): [string, string] => id.split('/') as [string, string]
const sample = (id: string): QuantItem => sampleOf(...split(id))

const rejects = (item: QuantItem, check: string): void => {
  const r = verifyQuant(item)
  expect(r.ok, `${check}: ${r.reason}`).toBe(false)
  expect(r.checks[check], `${check} in ${JSON.stringify(r.checks)}`).toBe(false)
}

/** Hand-worked examples: [variant, given, stem, key]. The bank test has the same rows. */
const EXAMPLES: [string, Record<string, JsonValue>, string, string][] = [
  ['vieta/sum_squares', { a: 2, b: -3, c: -12, d: 5 },
    'The equation 2x^3 − 3x^2 − 12x + 5 = 0 has three different real solutions. What is the sum of their squares?', '57/4'],
  ['vieta/sum_squares', { a: 1, b: -3, c: -6, d: 1 },
    'The equation x^3 − 3x^2 − 6x + 1 = 0 has three different real solutions. What is the sum of their squares?', '21'],
  ['vieta/sum_recip', { a: 2, b: -3, c: -12, d: 5 },
    'The equation 2x^3 − 3x^2 − 12x + 5 = 0 has three different real solutions. What is the sum of their reciprocals?', '12/5'],
  ['log_eq/product', { base: 2, k: 4, m: 5 }, 'Solve for x: log_2(x) + log_2(x − 4) = 5.', '8'],
  ['log_eq/product', { base: 10, k: 15, m: 2 }, 'Solve for x: log_10(x) + log_10(x − 15) = 2.', '20'],
  ['recurrence/fib_diff', { p: 3, q: -5, n: 100 },
    'A sequence has a(1) = 3, a(2) = −5, and a(n) = a(n − 1) − a(n − 2) for every n ≥ 3. What is a(100)?', '-3'],
  ['recurrence/lyness', { p: 2, q: 5, n: 104 },
    'A sequence has a(1) = 2, a(2) = 5, and a(n) = (1 + a(n − 1))/a(n − 2) for every n ≥ 3. What is a(104)?', '4/5'],
  ['stars_bars/at_least', { n: 20, k: 4, m: 3 },
    'In how many ways can 20 identical sweets be shared among 4 children so that every child gets at least 3?', '165'],
  ['grid_paths/avoid', { m: 6, n: 5, p: 2, q: 3 },
    'A path on a square grid goes from (0, 0) to (6, 5) in steps of one unit, each step either to the right or up. How many such paths do not pass through the point (2, 3)?', '312'],
  ['conditional/bayes', { share: 60, fault_a: 5, fault_b: 10 },
    "Machine A makes 60% of the bolts in a factory and machine B makes the rest. Of the bolts made by machine A, 5% are faulty; of those made by machine B, 10% are faulty. A bolt chosen at random from the factory's output is faulty. What is the probability that it was made by machine A?", '3/7'],
  ['meet/wait', { hours: 1, wait: 15 },
    'Two friends plan to meet at a café. Each arrives at a time chosen uniformly at random between 12:00 and 1:00, independently of the other, waits 15 minutes for the other, and then leaves. What is the probability that they meet?', '7/16'],
  ['divisors/count', { n: 7200 }, 'How many positive divisors does 7200 have?', '54'],
  ['divisors/squares', { n: 7200 }, 'How many of the positive divisors of 7200 are perfect squares?', '12'],
  ['crt/three', { m1: 3, m2: 5, m3: 7, r1: 2, r2: 3, r3: 2 },
    'What is the smallest positive integer that leaves a remainder of 2 when divided by 3, a remainder of 3 when divided by 5, and a remainder of 2 when divided by 7?', '23'],
  ['legendre/zeros', { n: 2026 }, 'How many zeros are at the end of the number 2026! (the product 1 × 2 × 3 × … × 2026)?', '505'],
  ['legendre/prime_power', { p: 3, n: 100 },
    'What is the largest whole number k for which 3^k divides 100! (the product 1 × 2 × 3 × … × 100)?', '48'],
  ['mod100/power', { a: 7, e: 2026 }, 'What is the remainder when 7^2026 is divided by 100?', '49'],
  ['candles/ratio', { a: 3, b: 4, k: 2 },
    'Two candles are the same length. One burns down completely in 3 hours and the other in 4 hours, each at a steady rate. Both are lit at the same time. After how many hours is one candle exactly 2 times as long as the other?', '12/5'],
] // prettier-ignore

/** One hand-made given per rule that breaks exactly that rule (fields in range). The bank test has the same rows. */
const RULE_CASES: [string, Record<string, JsonValue>, string][] = [
  ['vieta/sum_squares', { a: 1, b: 0, c: 1, d: 1 }, 'three_real'],
  ['vieta/sum_squares', { a: 1, b: 0, c: -7, d: 6 }, 'no_rational_root'],
  ['vieta/sum_squares', { a: 2, b: -4, c: -12, d: 6 }, 'coprime'],
  ['vieta/sum_recip', { a: 1, b: 0, c: 1, d: 1 }, 'three_real'],
  ['vieta/sum_recip', { a: 1, b: 0, c: -7, d: 6 }, 'no_rational_root'],
  ['vieta/sum_recip', { a: 2, b: -4, c: -12, d: 6 }, 'coprime'],
  ['log_eq/product', { base: 2, k: 3, m: 2 }, 'power_bound'],
  ['log_eq/product', { base: 2, k: 5, m: 5 }, 'integer_solution'],
  ['recurrence/fib_diff', { p: 4, q: 4 }, 'distinct'],
  ['recurrence/fib_diff', { p: 4, q: -4 }, 'not_opposite'],
  ['recurrence/lyness', { p: 3, q: 3 }, 'distinct'],
  ['stars_bars/at_least', { n: 13, k: 4, m: 3 }, 'enough'],
  ['grid_paths/avoid', { m: 4, n: 4, p: 4, q: 2 }, 'inside'],
  ['conditional/bayes', { share: 50, fault_a: 5, fault_b: 10 }, 'share_step'],
  ['conditional/bayes', { share: 33, fault_a: 5, fault_b: 10 }, 'share_step'],
  ['conditional/bayes', { share: 60, fault_a: 5, fault_b: 5 }, 'different_rates'],
  ['meet/wait', { hours: 1, wait: 17 }, 'wait_step'],
  ['divisors/count', { n: 156 }, 'smooth'],
  ['divisors/count', { n: 108 }, 'rich'],
  ['divisors/count', { n: 210 }, 'squareful'],
  ['divisors/squares', { n: 156 }, 'smooth'],
  ['divisors/squares', { n: 108 }, 'rich'],
  ['divisors/squares', { n: 210 }, 'squareful'],
  ['crt/three', { m1: 5, m2: 3, m3: 7, r1: 3, r2: 2, r3: 2 }, 'increasing'],
  ['crt/three', { m1: 3, m2: 4, m3: 6, r1: 1, r2: 2, r3: 3 }, 'coprime'],
  ['crt/three', { m1: 3, m2: 5, m3: 7, r1: 3, r2: 1, r3: 2 }, 'residues'],
  ['crt/three', { m1: 9, m2: 11, m3: 13, r1: 1, r2: 2, r3: 3 }, 'product_bound'],
  ['crt/three', { m1: 3, m2: 5, m3: 7, r1: 2, r2: 2, r3: 2 }, 'not_uniform'],
  ['crt/three', { m1: 3, m2: 5, m3: 7, r1: 1, r2: 3, r3: 5 }, 'not_shifted'],
  ['mod100/power', { a: 30 }, 'not_multiple_of_10'],
  ['mod100/power', { a: 76 }, 'not_fixed'],
  ['mod100/power', { a: 25 }, 'not_fixed'],
  ['candles/ratio', { a: 5, b: 5 }, 'ordered'],
] // prettier-ignore

describe('hard quant table 2 (M3.12)', () => {
  it('has the spec’s sixteen variants in table order, all stratum 5', () => {
    expect(ids).toEqual([
      'vieta/sum_squares', 'vieta/sum_recip', 'log_eq/product', 'recurrence/fib_diff', 'recurrence/lyness',
      'stars_bars/at_least', 'grid_paths/avoid', 'conditional/bayes', 'meet/wait', 'divisors/count',
      'divisors/squares', 'crt/three', 'legendre/zeros', 'legendre/prime_power', 'mod100/power', 'candles/ratio',
    ])
    expect(HARD2.every((v) => v.stratum === 5)).toBe(true)
    expect(Object.keys(CHECKS_HARD2).sort()).toEqual([...ids].sort())
  })

  it.each(ids)('%s: 200 generated items verify, with keys of the right format', (id) => {
    const v = variantDef(...split(id))
    const items = samplesOf(...split(id), 200)
    for (const item of items) {
      const r = verifyQuant(item)
      expect(r.ok, `${item.spec.stem}: ${r.reason}`).toBe(true)
      if (v.format === 'integer') expect(item.key.value).toMatch(/^-?\d+$/)
    }
    const t1 = performance.now()
    for (const item of items) verifyQuant(item)
    expect((performance.now() - t1) / items.length, 'ms per verification').toBeLessThan(5)
    // Content variety: many distinct stems.
    expect(new Set(items.map((i) => i.spec.stem)).size).toBeGreaterThan(id === 'meet/wait' ? 25 : 100)
  })

  it.each(EXAMPLES)('%s: a hand-worked example %j', (id, given, stem, key) => {
    const item = withGiven(sample(id), given)
    expect(item.spec.stem).toBe(stem)
    expect(item.key.value).toBe(key)
    expect(verifyQuant(item).ok, verifyQuant(item).reason).toBe(true)
  })

  it.each(RULE_CASES)('%s: %j breaks rule %s', (id, patch, rule) => {
    const item = withGiven(sample(id), patch)
    const r = verifyQuant(item)
    expect(r.checks.given_fields).toBe(true)
    rejects(item, `rule_${rule}`)
    // exactly that rule
    const broken = Object.entries(r.checks).filter(([k, x]) => k.startsWith('rule_') && x === false).map(([k]) => k)
    expect(broken).toEqual([`rule_${rule}`])
  })

  it('every rule has a negative case (meet/wait wait_shorter: outside the field ranges, below)', () => {
    const covered = new Set(RULE_CASES.map(([id, , rule]) => `${id}:${rule}`))
    const missing = ids.flatMap((id) => Object.keys(quantRules(variantDef(...split(id)), sample(id).spec.given)).map((r) => `${id}:${r}`)).filter((k) => !covered.has(k))
    expect(missing).toEqual(['meet/wait:wait_shorter'])
  })

  it('meet/wait: wait_shorter fails only outside the field ranges', () => {
    expect(CHECKS_HARD2['meet/wait']!.rules({ hours: 1, wait: 60 })).toEqual({ wait_step: true, wait_shorter: false })
    expect(verifyQuant(withGiven(sample('meet/wait'), { hours: 1, wait: 60 })).checks.given_fields).toBe(false)
  })

  it('the legendre variants have no rules', () => {
    expect(quantRules(variantDef('legendre', 'zeros'), { n: 100 })).toEqual({})
    expect(quantRules(variantDef('legendre', 'prime_power'), { p: 2, n: 100 })).toEqual({})
  })

  it('a wrong key is rejected (key_matches)', () => {
    for (const id of ids) {
      const item = sample(id)
      const bad = { ...item, key: { ...item.key, value: item.key.value === '1' ? '2' : '1' } }
      rejects(bad, 'key_matches')
    }
  })

  it('tightened draws: stars-and-bars counts ≤ 20,000, no mod-100 base ending in 5', () => {
    for (const item of samplesOf('stars_bars', 'at_least', 200)) expect(Number(item.key.value)).toBeLessThanOrEqual(20_000)
    for (const item of samplesOf('mod100', 'power', 200)) expect((item.spec.given.a as number) % 10).not.toBe(5)
  })
})
