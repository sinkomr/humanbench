/**
 * Hard quant table 1 (stratum 5 geometry and trigonometry; generator 1.4.0, ROADMAP M3.12):
 * generated items verify, hand-worked stems and keys, a negative case for every rule, and the
 * variety of the draw tables. The bank's `tests/gen/test_quant_hard1.py` checks the same examples
 * and negative cases against the Python twin.
 */

import { describe, expect, it } from 'vitest'
import { quant } from '.'
import { HARD1, hard1TableSizes } from './hard1'
import { samplesOf, sampleOf, variantDef, withGiven } from './test-helpers'
import { quantRules, verifyQuant } from './verify'

const IDS = HARD1.map((v) => `${v.template}/${v.variant}`)
const split = (id: string): [string, string] => id.split('/') as [string, string]

describe('hard1: the table', () => {
  it('has the spec’s twelve variants, all stratum 5, in order', () => {
    expect(IDS).toEqual([
      'heron/area', 'heron/inradius', 'chords/same_side', 'chords/opposite', 'coord/point_line', 'coord/reflect_path',
      'solid/cone_volume', 'trig_sin/tan', 'trig_sin/cos_double', 'trig_sin/sin_double', 'angle_sum/sin_sum', 'law_cosines/side',
    ])
    expect(HARD1.map((v) => [v.format, v.offset])).toEqual([
      ['integer', -0.2], ['fraction', 0.1], ['integer', 0.2], ['integer', 0], ['fraction', -0.2], ['integer', 0],
      ['integer', -0.2], ['fraction', -0.3], ['fraction', -0.1], ['fraction', 0], ['fraction', 0.1], ['integer', 0],
    ])
    expect(new Set(HARD1.map((v) => v.stratum))).toEqual(new Set([5]))
  })

  it('draws from tables large enough for variety', () => {
    expect(hard1TableSizes()).toEqual({ heron: 115, chords: 63, path: 98, cone: 103, law: 202 })
  })
})

describe('hard1: generated items', () => {
  for (const id of IDS) {
    it(`${id}: 200 items verify, with keys of the variant's format`, () => {
      const [t, v] = split(id)
      const items = samplesOf(t, v, 200)
      const stems = new Set<string>()
      for (const item of items) {
        const r = quant.verify(item)
        expect(r.ok, `${id} ${JSON.stringify(item.spec.given)}: ${r.reason}`).toBe(true)
        if (variantDef(t, v).format === 'integer') expect(item.key.value).toMatch(/^-?\d+$/)
        stems.add(item.spec.stem)
      }
      // trig_sin has 32 givens (a leg and the hypotenuse of the 16 primitive triples), chords 63
      expect(stems.size, id).toBeGreaterThanOrEqual(id.startsWith('trig_sin/') ? 25 : id.startsWith('chords/') ? 50 : 60)
    })
  }

  it('verifies each item in well under 5 ms', () => {
    const items = IDS.flatMap((id) => samplesOf(...split(id), 50))
    const t0 = performance.now()
    for (const item of items) verifyQuant(item)
    expect((performance.now() - t0) / items.length).toBeLessThan(5)
  })
})

/** Hand-worked examples; the bank test has the same stems and keys. */
const EXAMPLES: [string, Record<string, number>, string, string][] = [
  ['heron/area', { a: 13, b: 14, c: 15 }, 'A triangle has sides of length 13, 14 and 15. What is its area?', '84'],
  ['heron/inradius', { a: 4, b: 13, c: 15 }, 'A triangle has sides of length 4, 13 and 15. What is the radius of the circle inscribed in it?', '3/2'],
  [
    'chords/same_side', { long: 48, short: 14, d: 17 },
    'Two parallel chords of a circle have lengths 48 and 14. They lie on the same side of the centre of the circle, 17 apart. What is the radius of the circle?', '25',
  ],
  [
    'chords/opposite', { long: 48, short: 14, d: 31 },
    'Two parallel chords of a circle have lengths 48 and 14. They lie on opposite sides of the centre of the circle, 31 apart. What is the radius of the circle?', '25',
  ],
  ['coord/point_line', { x: -3, y: 2, A: -5, B: 12, C: -7 }, 'What is the distance from the point (−3, 2) to the line −5x + 12y = −7?', '46/13'],
  ['coord/point_line', { x: 7, y: 4, A: 3, B: 4, C: 10 }, 'What is the distance from the point (7, 4) to the line 3x + 4y = 10?', '27/5'],
  [
    'coord/reflect_path', { ax: -3, ay: 5, bx: 9, by: 4 },
    'A path goes from the point A(−3, 5) to a point P on the x-axis and then on to the point B(9, 4). What is the shortest possible length of the path?', '15',
  ],
  ['solid/cone_volume', { r: 5, slant: 13 }, 'A right circular cone has a base radius of 5 and a slant height of 13. Its volume is kπ. What is k?', '100'],
  ['trig_sin/tan', { p: 5, r: 13 }, 'The angle θ is between 90° and 180°, and sin θ = 5/13. What is the value of tan θ?', '-5/12'],
  ['trig_sin/cos_double', { p: 5, r: 13 }, 'The angle θ is between 90° and 180°, and sin θ = 5/13. What is the value of cos 2θ?', '119/169'],
  ['trig_sin/sin_double', { p: 5, r: 13 }, 'The angle θ is between 90° and 180°, and sin θ = 5/13. What is the value of sin 2θ?', '-120/169'],
  [
    'angle_sum/sin_sum', { a: 3, c: 5, d: 5, f: 13 },
    'The angles α and β are both between 0° and 90°, with sin α = 3/5 and cos β = 5/13. What is the value of sin(α + β)?', '63/65',
  ],
  ['law_cosines/side', { b: 3, c: 8, angle: 60 }, 'In triangle ABC, AB = 8, AC = 3 and angle BAC = 60°. What is the length of BC?', '7'],
  ['law_cosines/side', { b: 3, c: 5, angle: 120 }, 'In triangle ABC, AB = 5, AC = 3 and angle BAC = 120°. What is the length of BC?', '7'],
]

describe('hard1: hand-worked examples', () => {
  for (const [id, given, stem, key] of EXAMPLES) {
    it(`${id} ${JSON.stringify(given)}`, () => {
      const item = withGiven(sampleOf(...split(id)), given)
      expect(item.spec.stem).toBe(stem)
      expect(item.key).toEqual({ value: key, tol: { abs: 0 } })
      const r = quant.verify(item)
      expect(r.ok, r.reason).toBe(true)
    })
  }
})

/**
 * For every rule a given inside the field ranges that breaks it, and the full set of rules it
 * breaks (exactly that rule where the rules allow it). Some rules cannot fail alone: a < b < c
 * implies a ≤ b ≤ c; for ordered sides, a + b ≤ c makes Heron's product ≤ 0; an odd chord leaves
 * no integer radius; a Pythagorean triple always has a leg divisible by 3, so integer_k fails only
 * with integer_height.
 */
const NEGATIVE: [string, Record<string, number>, string, string[]][] = [
  ['heron/area', { a: 3, b: 5, c: 4 }, 'ordered', ['ordered', 'scalene']],
  ['heron/area', { a: 3, b: 4, c: 7 }, 'triangle', ['triangle', 'integer_area']],
  ['heron/area', { a: 5, b: 5, c: 6 }, 'scalene', ['scalene']],
  ['heron/area', { a: 3, b: 4, c: 5 }, 'not_right', ['not_right']],
  ['heron/area', { a: 3, b: 4, c: 6 }, 'integer_area', ['integer_area']],
  ['heron/inradius', { a: 5, b: 5, c: 6 }, 'scalene', ['scalene']],
  ['heron/inradius', { a: 3, b: 4, c: 5 }, 'not_right', ['not_right']],
  ['heron/inradius', { a: 3, b: 5, c: 4 }, 'ordered', ['ordered', 'scalene']],
  ['heron/inradius', { a: 3, b: 4, c: 7 }, 'triangle', ['triangle', 'integer_area']],
  ['heron/inradius', { a: 3, b: 4, c: 6 }, 'integer_area', ['integer_area']],
  ['chords/same_side', { long: 3, short: 2, d: 1 }, 'even', ['even', 'integer_radius']],
  ['chords/same_side', { long: 6, short: 6, d: 8 }, 'longer', ['longer', 'placed']],
  ['chords/same_side', { long: 8, short: 6, d: 7 }, 'placed', ['placed']],
  ['chords/same_side', { long: 48, short: 14, d: 31 }, 'placed', ['placed']], // the opposite-sides circle
  ['chords/same_side', { long: 4, short: 2, d: 1 }, 'integer_radius', ['integer_radius']],
  ['chords/opposite', { long: 3, short: 2, d: 2 }, 'even', ['even', 'integer_radius']],
  ['chords/opposite', { long: 6, short: 6, d: 8 }, 'longer', ['longer']],
  ['chords/opposite', { long: 48, short: 14, d: 17 }, 'placed', ['placed']], // the same-side circle
  ['chords/opposite', { long: 4, short: 2, d: 2 }, 'integer_radius', ['integer_radius']],
  ['coord/point_line', { x: 1, y: 1, A: 3, B: 8, C: 0 }, 'hypotenuse', ['hypotenuse']],
  ['coord/point_line', { x: 1, y: 1, A: 6, B: 8, C: 0 }, 'primitive', ['primitive']],
  ['coord/point_line', { x: 1, y: 1, A: 3, B: 4, C: 7 }, 'off_line', ['off_line']],
  ['coord/reflect_path', { ax: -3, ay: 1, bx: -3, by: 1 }, 'distinct_x', ['distinct_x']],
  ['coord/reflect_path', { ax: -3, ay: 1, bx: -2, by: 1 }, 'integer_length', ['integer_length']],
  ['solid/cone_volume', { r: 5, slant: 5 }, 'taller', ['taller', 'integer_height', 'integer_k']],
  ['solid/cone_volume', { r: 3, slant: 6 }, 'integer_height', ['integer_height', 'integer_k']],
  ['solid/cone_volume', { r: 4, slant: 7 }, 'integer_k', ['integer_height', 'integer_k']],
  ['trig_sin/tan', { p: 1, r: 5 }, 'pythagorean', ['pythagorean']],
  ['trig_sin/tan', { p: 6, r: 10 }, 'reduced', ['reduced']],
  ['trig_sin/cos_double', { p: 4, r: 13 }, 'pythagorean', ['pythagorean']],
  ['trig_sin/cos_double', { p: 10, r: 26 }, 'reduced', ['reduced']],
  ['trig_sin/sin_double', { p: 2, r: 7 }, 'pythagorean', ['pythagorean']],
  ['trig_sin/sin_double', { p: 9, r: 15 }, 'reduced', ['reduced']],
  ['angle_sum/sin_sum', { a: 2, c: 5, d: 3, f: 5 }, 'pythagorean_alpha', ['pythagorean_alpha']],
  ['angle_sum/sin_sum', { a: 3, c: 5, d: 2, f: 7 }, 'pythagorean_beta', ['pythagorean_beta']],
  ['angle_sum/sin_sum', { a: 4, c: 5, d: 6, f: 10 }, 'reduced', ['reduced']],
  ['angle_sum/sin_sum', { a: 3, c: 5, d: 3, f: 5 }, 'not_complementary', ['not_complementary']],
  ['law_cosines/side', { b: 1, c: 1, angle: 60 }, 'distinct', ['distinct']],
  ['law_cosines/side', { b: 1, c: 2, angle: 60 }, 'integer_side', ['integer_side']],
]

describe('hard1: every rule rejects a bad given', () => {
  for (const [id, given, rule, failing] of NEGATIVE) {
    it(`${id}: rule_${rule} ${JSON.stringify(given)}`, () => {
      const [t, v] = split(id)
      const item = withGiven(sampleOf(t, v), given)
      const r = verifyQuant(item)
      expect(r.checks.given_fields, 'only rules are broken').toBe(true)
      expect(r.ok).toBe(false)
      expect(r.checks[`rule_${rule}`]).toBe(false)
      const rules = quantRules(variantDef(t, v), item.spec.given)
      expect(Object.keys(rules).filter((k) => !rules[k]).sort()).toEqual([...failing].sort())
    })
  }

  it('covers every rule of every variant', () => {
    const covered = new Set(NEGATIVE.map(([id, , rule]) => `${id}:${rule}`))
    const missing = IDS.flatMap((id) => Object.keys(quantRules(variantDef(...split(id)), sampleOf(...split(id)).spec.given)).map((r) => `${id}:${r}`)).filter(
      (k) => !covered.has(k),
    )
    expect(missing).toEqual([])
  })

  it('the stem decides the side of the centre: a same-side circle is not an opposite-sides answer', () => {
    // 48 and 14 at distance 17 fit only on the same side; the opposite variant's verifier cannot solve it.
    const item = withGiven(sampleOf('chords', 'opposite'), { long: 48, short: 14, d: 17 })
    expect(verifyQuant(item).checks.solved).toBe(false)
  })
})
