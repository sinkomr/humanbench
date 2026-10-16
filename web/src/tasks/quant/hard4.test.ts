import { describe, expect, it } from 'vitest'
import { HARD4 } from './hard4'
import { clone, sampleOf, samplesOf, variantDef, withGiven } from './test-helpers'
import { CHECKS_HARD4 } from './verify-hard4'
import { quantSolve, verifyQuant } from './verify'
import type { Given } from './kit'

/**
 * Hard quant table 4 (generator 1.4.0, ROADMAP M3.12): every variant's generated items verify,
 * hand-worked givens give the expected stem and key (the bank's `test_quant_hard4.py` checks the
 * same givens), and every template rule rejects a given that breaks it.
 */

const ID = (v: { template: string; variant: string }): string => `${v.template}/${v.variant}`

/** The item of variant `id` rebuilt around `given`. */
const itemOf = (id: string, given: Given) => {
  const [t, v] = id.split('/') as [string, string]
  return withGiven(sampleOf(t, v), given)
}

/** Hand-worked examples: [variant, given, stem, key]. */
const EXAMPLES: readonly (readonly [string, Given, string, string])[] = [
  // f′ = (c² + 2bc − a)/(c + b)² = (16 − 72 − 2)/25
  ['derivative/quotient', { a: 2, b: -9, c: 4 }, 'Let f(x) = (x^2 + 2)/(x − 9). What is the value of f′(4)?', '-58/25'],
  // −5·(1 + 8)/3 − 5·(1 − 4)/2 = −15 + 15/2
  ['integral/poly', { a: -5, b: -5, c: 0, lo: -2, hi: 1 }, 'What is the value of the integral of −5x^2 − 5x with respect to x, from x = −2 to x = 1?', '-15/2'],
  // (x − 3)(x + 2) / ((x − 3)(x − 5)) → (3 + 2)/(3 − 5)
  ['limit/factor', { p1: -1, q1: -6, p2: -8, q2: 15, at: 3 }, 'What is the limit of (x^2 − x − 6)/(x^2 − 8x + 15) as x → 3?', '-5/2'],
  // intercepts (6, 0) and (0, 10): area 30
  ['optimise/tangent_triangle', { a: 3, b: 5 }, 'A straight line passes through the point (3, 5) and crosses both the positive x-axis and the positive y-axis, cutting off a triangle with the two axes. What is the smallest possible area of this triangle?', '30'],
  // C(21, 3) − 4·C(11, 3) = 1330 − 660
  ['digit_sum/count', { digits: 4, s: 18 }, 'How many whole numbers from 1 to 9999 have digits that add up to 18?', '670'],
  ['digit_sum/count', { digits: 3, s: 10 }, 'How many whole numbers from 1 to 999 have digits that add up to 10?', '63'],
  // 380 triples of 9880: n = 2m gives 3/(2(n − 1)) = 3/78
  ['ap_triples/prob', { n: 40 }, 'Three different numbers are chosen at random from the whole numbers 1 to 40. What is the probability that the three numbers, in some order, form an arithmetic sequence?', '1/26'],
  // ρ = 4: (1 − 4^4)/(1 − 4^8) = 255/65535
  ['ruin/biased', { p: 1, q: 5, a: 4, b: 4 }, 'Ana and Ben play a series of rounds. Ana wins each round with probability 1/5, independently of the other rounds; otherwise Ben wins it. After each round the loser gives the winner one coin. Ana starts with 4 coins and Ben with 4 coins. They stop as soon as one of them has no coins. What is the probability that Ana ends up with all the coins?', '1/257'],
  // ρ = 1/2: (1 − 1/64)/(1 − 1/128)
  ['ruin/biased', { p: 2, q: 3, a: 6, b: 1 }, 'Ana and Ben play a series of rounds. Ana wins each round with probability 2/3, independently of the other rounds; otherwise Ben wins it. After each round the loser gives the winner one coin. Ana starts with 6 coins and Ben with 1 coin. They stop as soon as one of them has no coins. What is the probability that Ana ends up with all the coins?', '126/127'],
  // 8 places × C(7, 2)/C(9, 2) = 8 × 21/36
  ['adjacent/expect', { red: 7, blue: 2 }, '7 red beads and 2 blue beads are put in a row in a random order. What is the expected number of places in the row where two red beads are next to each other?', '14/3'],
  // x² + 9x + 8 = (x + 1)(x + 8): width 7, area 7³/6
  ['area_between/parabola_line', { b: 11, c: 8, m: 2, k: 0 }, 'What is the area of the region enclosed by the parabola y = x^2 + 11x + 8 and the line y = 2x?', '343/6'],
  ['area_between/parabola_line', { b: 0, c: -4, m: 0, k: 0 }, 'What is the area of the region enclosed by the parabola y = x^2 − 4 and the line y = 0?', '32/3'],
  // 3!·2!/6! = 12/720
  ['beta/integral', { m: 3, n: 2 }, 'What is the value of the integral of x^3(1 − x)^2 with respect to x, from x = 0 to x = 1?', '1/60'],
  ['beta/integral', { m: 1, n: 1 }, 'What is the value of the integral of x(1 − x) with respect to x, from x = 0 to x = 1?', '1/6'],
  // (1/2)(1/2 + 1/3)
  ['telescoping/infinite', { s: 1, a: 2 }, 'What is the value of the infinite sum 1/(2 × 4) + 1/(3 × 5) + 1/(4 × 6) + …?', '5/12'],
  // y-axis: k⁴/(6a³) = 256/162
  ['revolution/volume', { a: 3, k: 4, axis: 'y' }, 'The region enclosed by the curve y = 3x^2 and the line y = 4x is turned about the y-axis. The volume of the solid formed is cπ. What is c?', '128/81'],
  // x-axis: 2k⁵/(15a³) = 64/15
  ['revolution/volume', { a: 1, k: 2, axis: 'x' }, 'The region enclosed by the curve y = x^2 and the line y = 2x is turned about the x-axis. The volume of the solid formed is cπ. What is c?', '64/15'],
  // (4^8 + 4^4 + 2·4^2 + 4·4)/8 = 65840/8
  ['necklace/rotations', { n: 8, colours: 4 }, 'A necklace has 8 beads equally spaced around a loop, and each bead is one of 4 colours. Two necklaces count as the same if one can be turned (rotated, without flipping it over) to match the other. How many different necklaces are there?', '8230'],
  // (2^6 + 2^3 + 2·2^2 + 2·2)/6 = 84/6
  ['necklace/rotations', { n: 6, colours: 2 }, 'A necklace has 6 beads equally spaced around a loop, and each bead is one of 2 colours. Two necklaces count as the same if one can be turned (rotated, without flipping it over) to match the other. How many different necklaces are there?', '14'],
  // 3·300 − 400: speeds 3 : 2, passes at t = 1 (300 from west) and t = 3 (100 from west)
  ['ferries/width', { d1: 300, d2: 400 }, 'Two ferries leave opposite banks of a river at the same moment, each crossing at its own constant speed. They first pass each other 300 metres from the west bank. Each turns back at once on reaching the far bank, and they pass each other again 400 metres from the east bank. How wide is the river, in metres?', '500'],
]

/** [variant, given, the one rule it breaks]. */
const BROKEN: readonly (readonly [string, Given, string])[] = [
  ['derivative/quotient', { a: 2, b: -4, c: 4 }, 'defined'],
  ['integral/poly', { a: 1, b: 2, c: 3, lo: 1, hi: 1 }, 'ordered'],
  ['limit/factor', { p1: -1, q1: -5, p2: -8, q2: 15, at: 3 }, 'zero_over_zero'],
  ['limit/factor', { p1: -1, q1: -6, p2: -6, q2: 9, at: 3 }, 'finite'],
  ['limit/factor', { p1: -1, q1: -6, p2: -1, q2: -6, at: 3 }, 'different'],
  ['limit/factor', { p1: -6, q1: 9, p2: -8, q2: 15, at: 3 }, 'nonzero_limit'],
  ['digit_sum/count', { digits: 3, s: 18 }, 'two_sided'],
  ['ruin/biased', { p: 4, q: 2, a: 1, b: 1 }, 'proper'],
  ['ruin/biased', { p: 1, q: 2, a: 1, b: 1 }, 'not_fair'],
  ['ruin/biased', { p: 1, q: 3, a: 5, b: 4 }, 'total'],
  ['area_between/parabola_line', { b: 11, c: 8, m: 2, k: 1 }, 'two_crossings'],
  ['area_between/parabola_line', { b: 0, c: 0, m: 0, k: 0 }, 'two_crossings'],
  ['revolution/volume', { a: 2, k: 4, axis: 'x' }, 'reduced'],
  ['ferries/width', { d1: 305, d2: 400 }, 'tens'],
  // W = 440: B is more than twice as slow, so A overtakes it before B reaches the west bank
  ['ferries/width', { d1: 300, d2: 460 }, 'consistent'],
  ['ferries/width', { d1: 300, d2: 300 }, 'unequal'],
]

describe('hard quant table 4 (M3.12)', () => {
  it('lists the spec variants in order, stratum 5 first', () => {
    expect(HARD4.map(ID)).toEqual([
      'derivative/quotient', 'integral/poly', 'limit/factor', 'optimise/tangent_triangle',
      'digit_sum/count', 'ap_triples/prob', 'ruin/biased', 'adjacent/expect', 'area_between/parabola_line', 'beta/integral',
      'telescoping/infinite', 'revolution/volume', 'necklace/rotations', 'ferries/width',
    ])
    expect(HARD4.map((v) => v.stratum)).toEqual([5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6])
    expect(Object.keys(CHECKS_HARD4).sort()).toEqual(HARD4.map(ID).sort())
  })

  for (const v of HARD4) {
    it(`${ID(v)}: 200 generated items verify, with keys of the right format`, () => {
      const items = samplesOf(v.template, v.variant, 200)
      for (const item of items) {
        const r = verifyQuant(clone(item))
        expect(r.ok, `${item.spec.stem}: ${r.reason}`).toBe(true)
        if (v.format === 'integer') expect(item.key.value).toMatch(/^-?\d+$/)
      }
      expect(new Set(items.map((i) => i.spec.stem)).size).toBeGreaterThanOrEqual(Math.min(15, items.length))
    })
  }

  it('gives the hand-worked stem and key for chosen givens', () => {
    for (const [id, given, stem, key] of EXAMPLES) {
      const item = itemOf(id, given)
      expect(item.spec.stem, id).toBe(stem)
      expect(item.key.value, id).toBe(key)
      // (withGiven keeps the old time limit, so only the content checks are asserted here)
      const r = verifyQuant(item)
      const failed = Object.entries(r.checks).filter(([k, x]) => x === false && k !== 'time_matches')
      expect(failed, id).toEqual([])
    }
  })

  it('rejects a given that breaks each rule, naming that rule only', () => {
    for (const [id, given, rule] of BROKEN) {
      const item = itemOf(id, given)
      const r = verifyQuant(item)
      expect(r.ok, id).toBe(false)
      expect(r.checks[`rule_${rule}`], `${id} ${JSON.stringify(given)}`).toBe(false)
      const others = Object.entries(r.checks).filter(([k, x]) => k.startsWith('rule_') && k !== `rule_${rule}` && x === false)
      expect(others, `${id} ${JSON.stringify(given)}`).toEqual([])
    }
    // every rule has a negative case
    const named = new Set(BROKEN.map(([id, , rule]) => `${id}:${rule}`))
    for (const v of HARD4) {
      const sample = sampleOf(v.template, v.variant)
      for (const rule of Object.keys((CHECKS_HARD4[ID(v)] as (typeof CHECKS_HARD4)[string]).rules(sample.spec.given))) {
        if (ID(v) === 'necklace/rotations') continue // below
        expect(named.has(`${ID(v)}:${rule}`), `${ID(v)}:${rule}`).toBe(true)
      }
    }
  })

  it('necklace bound: holds on all of the field ranges (4^8 = 65536), fails beyond them', () => {
    const rules = (CHECKS_HARD4['necklace/rotations'] as (typeof CHECKS_HARD4)[string]).rules
    for (let n = 4; n <= 8; n++) for (let c = 2; c <= 4; c++) expect(rules({ n, colours: c }).bound).toBe(true)
    expect(rules({ n: 9, colours: 4 }).bound).toBe(false)
    expect(rules({ n: 8, colours: 5 }).bound).toBe(false)
  })

  it('rejects a tampered key and an overtaking ferry story', () => {
    const item = itemOf('ferries/width', { d1: 300, d2: 400 })
    const bad = { ...clone(item), key: { ...item.key, value: '501' } }
    expect(verifyQuant(bad).checks.key_matches).toBe(false)
    expect(quantSolve(variantDef('ferries', 'width'), { d1: 300, d2: 460 })).toBeNull()
    expect(quantSolve(variantDef('ferries', 'width'), { d1: 300, d2: 450 })).toBeNull() // A catches B at the bank
  })

  it('the verifier route agrees with the generator on every given of the small variants', () => {
    const grid: [string, Given[]][] = [
      ['digit_sum/count', [3, 4].flatMap((d) => Array.from({ length: 9 * d - 19 }, (_, i) => ({ digits: d, s: 10 + i })))],
      ['ap_triples/prob', Array.from({ length: 35 }, (_, i) => ({ n: 6 + i }))],
      ['beta/integral', Array.from({ length: 36 }, (_, i) => ({ m: 1 + (i % 6), n: 1 + Math.floor(i / 6) }))],
      ['telescoping/infinite', Array.from({ length: 35 }, (_, i) => ({ s: i % 7, a: 2 + Math.floor(i / 7) }))],
      ['necklace/rotations', Array.from({ length: 15 }, (_, i) => ({ n: 4 + (i % 5), colours: 2 + Math.floor(i / 5) }))],
      ['revolution/volume', Array.from({ length: 64 }, (_, i) => ({ a: 1 + (i % 4), k: 1 + (Math.floor(i / 4) % 8), axis: i < 32 ? 'x' : 'y' }))],
      ['adjacent/expect', Array.from({ length: 196 }, (_, i) => ({ red: 2 + (i % 14), blue: 2 + Math.floor(i / 14) }))],
    ]
    for (const [id, givens] of grid) {
      const [t, vv] = id.split('/') as [string, string]
      const v = variantDef(t, vv)
      for (const g of givens) expect(quantSolve(v, g)?.toString(), `${id} ${JSON.stringify(g)}`).toBe(v.compute(g).toString())
    }
  })

  it('keeps every drawn item a hand calculation (telescoping denominators, ruin powers)', () => {
    for (const item of samplesOf('telescoping', 'infinite', 200)) {
      const { s, a } = item.spec.given as { s: number; a: number }
      let l = 1
      for (let i = s + 1; i <= s + a; i++) {
        let [x, y] = [l, i]
        while (y) [x, y] = [y, x % y]
        l = (l * i) / x
      }
      expect(l).toBeLessThanOrEqual(840)
    }
    for (const item of samplesOf('ruin', 'biased', 200)) {
      const { p, q, a, b } = item.spec.given as { p: number; q: number; a: number; b: number }
      if (p > 1 && q - p > 1) expect(a + b).toBeLessThanOrEqual(6)
    }
  })
})
