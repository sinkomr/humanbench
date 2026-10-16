/**
 * Hard quant table 3 (stratum 6; generator 1.4.0, ROADMAP M3.12): generated items verify, worked
 * examples give the exact stem and key (the bank's `tests/gen/test_quant_hard3.py` pins the same
 * ones), and every rule has a negative case.
 */

import { describe, expect, it } from 'vitest'
import type { JsonValue } from '../../engine'
import { quant, type QuantItem } from '.'
import { Fraction } from './fraction'
import { HARD3 } from './hard3'
import { sampleOf, withGiven } from './test-helpers'
import { quantRules, verifyQuant } from './verify'

const ids = HARD3.map((v) => `${v.template}/${v.variant}`)

function rejects(item: QuantItem, check: string): void {
  const v = verifyQuant(item)
  expect(v.ok, `${check}: ${v.reason}`).toBe(false)
  expect(v.checks[check], `${check} in ${JSON.stringify(v.checks)}`).toBe(false)
}

/** 200 generated stratum-6 items of each hard3 variant (one pass over seeds, bucketed). */
function generated(n: number): Map<string, QuantItem[]> {
  const out = new Map<string, QuantItem[]>(ids.map((id) => [id, []]))
  for (let i = 0; i < 200_000; i++) {
    const item = quant.generate(`hard3-${i}`, { stratum: 6 })
    const sp = item.structural_params as { template: string; variant: string }
    const bucket = out.get(`${sp.template}/${sp.variant}`)
    if (bucket && bucket.length < n) bucket.push(item)
    if ([...out.values()].every((b) => b.length >= n)) break
  }
  return out
}

/** [template, variant, given, stem, key], worked by hand. */
const WORKED: [string, string, Record<string, JsonValue>, string, string][] = [
  // K = 84 (Heron), R = 13·14·15/(4·84) = 65/8
  ['triangle', 'circumradius', { a: 13, b: 14, c: 15 }, 'A triangle has sides of length 13, 14 and 15. What is the radius of the circle that passes through all three of its corners?', '65/8'],
  // BD = 42/11, DC = 35/11; Stewart: 25·42/11 + 36·35/11 = 7(AD² + 1470/121), AD² = 2160/121
  ['triangle', 'bisector', { a: 7, b: 5, c: 6 }, 'In triangle ABC, BC = 7, CA = 5 and AB = 6. The bisector of angle A meets side BC at D. What is the value of AD^2?', '2160/121'],
  // sides 3, 5, 4: a right triangle, area 6
  ['tangent_circles', 'centres', { a: 1, b: 2, c: 3 }, 'Three circles with radii 1, 2 and 3 each touch the other two from the outside. What is the area of the triangle whose corners are the centres of the three circles?', '6'],
  // sides 5, 8, 5: area √(9·1·4·4) = 12
  ['tangent_circles', 'centres', { a: 1, b: 4, c: 4 }, 'Three circles with radii 1, 4 and 4 each touch the other two from the outside. What is the area of the triangle whose corners are the centres of the three circles?', '12'],
  // l = 13; ρ = r·h/(r + l) = 60/18
  ['inscribed_sphere', 'cone', { r: 5, h: 12 }, 'A right circular cone has a base radius of 5 and a height of 12. A sphere sits inside the cone, touching its base and touching its curved surface all the way round. What is the radius of the sphere?', '10/3'],
  // tan C = −tan(A + B) = −(2/3 + 4)/(1 − 8/3) = 14/5
  ['tan_triangle', 'third', { p: 2, q: 3, s: 4, t: 1 }, 'In triangle ABC, tan A = 2/3 and tan B = 4. What is the value of tan C?', '14/5'],
  // tan(A + B) = (1/2 + 1/3)/(1 − 1/6) = 1, so C = 135°
  ['tan_triangle', 'third', { p: 1, q: 2, s: 1, t: 3 }, 'In triangle ABC, tan A = 1/2 and tan B = 1/3. What is the value of tan C?', '-1'],
  // 10°…80°: four pairs summing to 1
  ['sin_squares', 'sum', { first: 10, step: 10 }, 'What is the value of sin^2(10°) + sin^2(20°) + sin^2(30°) + … + sin^2(80°)?', '4'],
  // 1°, 3°, …, 89°: 22 pairs and sin² 45° = 1/2
  ['sin_squares', 'sum', { first: 1, step: 2 }, 'What is the value of sin^2(1°) + sin^2(3°) + sin^2(5°) + … + sin^2(89°)?', '45/2'],
  // p2 = 6, p3 = 3, p4 = 0·3 + 3·6 + 1·0 = 18
  ['newton', 'power4', { p: 0, q: -3, r: 1 }, 'Real numbers x, y and z satisfy x + y + z = 0, xy + yz + zx = −3 and xyz = 1. What is the value of x^4 + y^4 + z^4?', '18'],
  // p1 = 1, p2 = 9, p3 = 10, p4 = 10 + 36 − 1 = 45
  ['newton', 'power4', { p: 1, q: -4, r: -1 }, 'Real numbers x, y and z satisfy x + y + z = 1, xy + yz + zx = −4 and xyz = −1. What is the value of x^4 + y^4 + z^4?', '45'],
  // 2m + n = 5, −3m + n = −5: m = 2, n = 1
  ['remainder', 'linear', { a: 2, b: -3, ra: 5, rb: -5 }, 'When a polynomial P(x) is divided by x − 2, the remainder is 5. When P(x) is divided by x + 3, the remainder is −5. When P(x) is divided by (x − 2)(x + 3), the remainder is mx + n. What is the value of n?', '1'],
  // m + n = 2, 3m + n = 7: m = 5/2, n = −1/2
  ['remainder', 'linear', { a: 1, b: 3, ra: 2, rb: 7 }, 'When a polynomial P(x) is divided by x − 1, the remainder is 2. When P(x) is divided by x − 3, the remainder is 7. When P(x) is divided by (x − 1)(x − 3), the remainder is mx + n. What is the value of n?', '-1/2'],
  // f(2) + 2f(1/2) = 6, f(1/2) + 2f(2) = 3/2: f(2) = −1
  ['functional', 'recip', { m: 2, coef: 3, k: 2 }, 'A function f satisfies f(x) + 2f(1/x) = 3x for every x ≠ 0. What is the value of f(2)?', '-1'],
  // f(−2) − 3f(−1/2) = 2, f(−1/2) − 3f(−2) = 1/2: −8 f(−2) = 7/2
  ['functional', 'recip', { m: -3, coef: -1, k: -2 }, 'A function f satisfies f(x) − 3f(1/x) = −x for every x ≠ 0. What is the value of f(−2)?', '-7/16'],
  // (x − 6)(y − 6) = 36: one pair per divisor of 36
  ['egyptian', 'pairs', { n: 6 }, 'How many ordered pairs (x, y) of positive whole numbers satisfy 1/x + 1/y = 1/6?', '9'],
  // 150² = 2²·3²·5⁴: 3·3·5 divisors
  ['egyptian', 'pairs', { n: 150 }, 'How many ordered pairs (x, y) of positive whole numbers satisfy 1/x + 1/y = 1/150?', '45'],
  ['gcd_power', 'mersenne', { base: 2, m: 12, n: 18 }, 'What is the greatest common divisor of 2^12 − 1 and 2^18 − 1?', '63'],
  ['gcd_power', 'mersenne', { base: 3, m: 20, n: 30 }, 'What is the greatest common divisor of 3^20 − 1 and 3^30 − 1?', '59048'],
  // 4^5 = 1024 ≡ 4 (mod 6); 3^4 = 81 ≡ 4 (mod 7)
  ['tower_mod', 'remainder', { a: 3, b: 4, c: 5, m: 7 }, 'What is the remainder when 3^(4^5) is divided by 7?', '4'],
  // 13 ≡ 2 (mod 11); 2^9 = 512 ≡ 2 (mod 10); 2^2 = 4
  ['tower_mod', 'remainder', { a: 13, b: 2, c: 9, m: 11 }, 'What is the remainder when 13^(2^9) is divided by 11?', '4'],
  // (±1, ±7), (±7, ±1), (±5, ±5)
  ['lattice_circle', 'count', { n: 50 }, 'How many points (x, y) whose coordinates are both whole numbers (positive, negative or zero) lie on the circle x^2 + y^2 = 50?', '12'],
  // 65 = 1 + 64 = 16 + 49: 16 points
  ['lattice_circle', 'count', { n: 65 }, 'How many points (x, y) whose coordinates are both whole numbers (positive, negative or zero) lie on the circle x^2 + y^2 = 65?', '16'],
]

/** [template, variant, patch, rule]: a given that breaks the rule (and stays in the field ranges). */
const RULE_CASES: [string, string, Record<string, JsonValue>, string][] = [
  ['triangle', 'circumradius', { a: 14, b: 13, c: 15 }, 'ordered'],
  ['triangle', 'circumradius', { a: 3, b: 4, c: 8 }, 'triangle'],
  ['triangle', 'circumradius', { a: 5, b: 5, c: 6 }, 'scalene'],
  ['triangle', 'circumradius', { a: 3, b: 4, c: 5 }, 'not_right'],
  ['triangle', 'circumradius', { a: 4, b: 5, c: 6 }, 'integer_area'],
  ['triangle', 'bisector', { a: 10, b: 3, c: 4 }, 'triangle'],
  ['triangle', 'bisector', { a: 5, b: 4, c: 4 }, 'not_isosceles'],
  ['tangent_circles', 'centres', { a: 2, b: 1, c: 3 }, 'ordered'],
  ['tangent_circles', 'centres', { a: 3, b: 3, c: 3 }, 'not_all_equal'],
  ['tangent_circles', 'centres', { a: 1, b: 2, c: 4 }, 'integer_area'],
  ['inscribed_sphere', 'cone', { r: 3, h: 5 }, 'integer_slant'],
  ['tan_triangle', 'third', { p: 2, q: 4, s: 1, t: 3 }, 'reduced'],
  ['tan_triangle', 'third', { p: 1, q: 2, s: 2, t: 1 }, 'not_right'],
  ['tan_triangle', 'third', { p: 1, q: 2, s: 1, t: 2 }, 'distinct'],
  ['sin_squares', 'sum', { first: 10, step: 3 }, 'symmetric_steps'],
  ['sin_squares', 'sum', { first: 40, step: 5 }, 'several_terms'],
  ['newton', 'power4', { p: 0, q: 3, r: 1 }, 'three_real'],
  ['newton', 'power4', { p: 6, q: 11, r: 6 }, 'no_rational_root'],
  ['remainder', 'linear', { a: 2, b: 2, ra: 5, rb: 1 }, 'distinct'],
  ['remainder', 'linear', { a: 2, b: -3, ra: 5, rb: 5 }, 'slope'],
  ['functional', 'recip', { m: 1, coef: 3, k: 2 }, 'solvable'],
  ['functional', 'recip', { m: 2, coef: 3, k: 1 }, 'point'],
  ['egyptian', 'pairs', { n: 16 }, 'not_prime_power'],
  ['gcd_power', 'mersenne', { base: 2, m: 12, n: 12 }, 'distinct'],
  ['gcd_power', 'mersenne', { base: 2, m: 12, n: 24 }, 'not_dividing'],
  ['gcd_power', 'mersenne', { base: 2, m: 12, n: 25 }, 'shared'],
  ['gcd_power', 'mersenne', { base: 3, m: 30, n: 45 }, 'bound'],
  ['tower_mod', 'remainder', { a: 14, b: 4, c: 5, m: 7 }, 'coprime'],
  ['tower_mod', 'remainder', { a: 8, b: 4, c: 5, m: 7 }, 'not_one'],
  ['tower_mod', 'remainder', { a: 3, b: 2, c: 2, m: 7 }, 'big_exponent'],
  ['lattice_circle', 'count', { n: 26 }, 'many_points'],
  ['lattice_circle', 'count', { n: 625 }, 'not_square'],
]

describe('hard quant table 3 (stratum 6, M3.12)', () => {
  it('has the spec variants in order, all stratum 6', () => {
    expect(ids).toEqual([
      'triangle/circumradius', 'triangle/bisector', 'tangent_circles/centres', 'inscribed_sphere/cone', 'tan_triangle/third',
      'sin_squares/sum', 'newton/power4', 'remainder/linear', 'functional/recip', 'egyptian/pairs', 'gcd_power/mersenne',
      'tower_mod/remainder', 'lattice_circle/count',
    ])
    expect(HARD3.every((v) => v.stratum === 6)).toBe(true)
  })

  it('200 generated items of every variant verify, keys fit the format, stems vary', () => {
    const items = generated(200)
    for (const id of ids) {
      const bucket = items.get(id) as QuantItem[]
      expect(bucket.length, id).toBe(200)
      const format = HARD3.find((v) => `${v.template}/${v.variant}` === id)?.format
      for (const item of bucket) {
        const r = verifyQuant(item)
        expect(r.ok, `${id} ${JSON.stringify(item.spec.given)}: ${r.reason}`).toBe(true)
        const key = Fraction.parseCanonical(item.key.value) as Fraction
        if (format === 'integer') expect(key.isInteger(), id).toBe(true)
      }
      const stems = new Set(bucket.map((i) => i.spec.stem))
      expect(stems.size, `${id}: distinct stems in 200`).toBeGreaterThanOrEqual(50)
    }
  })

  it.each(WORKED)('%s/%s %j: the worked stem and key', (template, variant, given, stem, key) => {
    const item = withGiven(sampleOf(template, variant), given)
    expect(item.spec.stem).toBe(stem)
    expect(item.key.value).toBe(key)
    const r = verifyQuant(item)
    expect(r.ok, r.reason).toBe(true)
  })

  it.each(RULE_CASES)('%s/%s %j breaks rule_%s', (template, variant, patch, rule) => {
    const item = withGiven(sampleOf(template, variant), patch)
    expect(verifyQuant(item).checks.given_fields).toBe(true)
    rejects(item, `rule_${rule}`)
  })

  it('every rule of every variant has a negative case', () => {
    const tested = new Set(RULE_CASES.map(([t, v, , r]) => `${t}/${v}:${r}`))
    const missing: string[] = []
    for (const v of HARD3) {
      for (const rule of Object.keys(quantRules(v, sampleOf(v.template, v.variant).spec.given))) {
        const id = `${v.template}/${v.variant}:${rule}`
        if (!tested.has(id)) missing.push(id)
      }
    }
    expect(missing).toEqual([])
  })

  it('a wrong key is rejected', () => {
    for (const [t, v] of WORKED) {
      const item = sampleOf(t, v)
      const bad = { ...item, key: { ...item.key, value: (Fraction.parseCanonical(item.key.value) as Fraction).add(Fraction.ONE).toString() } }
      rejects(bad, 'key_matches')
    }
  })

  it('verifies each item in well under 5 ms', () => {
    const items = [...generated(20).values()].flat()
    const t0 = performance.now()
    for (const item of items) verifyQuant(item)
    expect((performance.now() - t0) / items.length).toBeLessThan(5)
  })
})
