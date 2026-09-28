/**
 * Negative tests of the quant verifier: for every check and every template rule, a hand-built
 * bad item that verify() must reject for that reason. The bank's `tests/gen/test_quant.py` runs
 * the same cases against the Python verifier.
 */

import { describe, expect, it } from 'vitest'
import type { JsonValue } from '../../engine'
import { quant, type QuantItem } from '.'
import { VARIANTS } from './templates'
import { clone, sampleOf, variantDef, withGiven } from './test-helpers'
import { quantRules, verifyQuant } from './verify'

type Mutable = { -readonly [K in keyof QuantItem]: unknown }

const mutate = (item: QuantItem, f: (x: Mutable) => void): QuantItem => {
  const x = clone(item) as unknown as Mutable
  f(x)
  return x as unknown as QuantItem
}

/** verify() rejects `item` and names `check` as a failed check. */
function rejects(item: QuantItem, check: string): void {
  const v = verifyQuant(item)
  expect(v.ok, `${check}: ${v.reason}`).toBe(false)
  expect(v.checks[check], `${check} in ${JSON.stringify(v.checks)}`).toBe(false)
}

describe('quant verify: accepts good items', () => {
  it('accepts a sample of every variant (TS or JSON-loaded)', () => {
    for (const v of VARIANTS) {
      const item = sampleOf(v.template, v.variant)
      const r = verifyQuant(clone(item))
      expect(r.ok, `${v.template}/${v.variant}: ${r.reason}`).toBe(true)
      expect(r.checks.template).toBe(`${v.template}/${v.variant}`)
    }
  })
})

describe('quant verify: generic checks (negative)', () => {
  const item = sampleOf('linear_eq', 'both_sides')

  it('structure_known', () => {
    rejects(mutate(item, (x) => (x.structural_params = { template: 'nope', variant: 'both_sides' })), 'structure_known')
    rejects(mutate(item, (x) => (x.structural_params = { template: 'linear_eq', variant: 'both_sides', extra: 1 })), 'structure_known')
    rejects(mutate(item, (x) => (x.structural_params = 'linear_eq')), 'structure_known')
  })

  it('spec_fields', () => {
    rejects(mutate(item, (x) => (x.spec = { ...item.spec, worked: 'x = 8' })), 'spec_fields')
    rejects(mutate(item, (x) => (x.spec = { stem: item.spec.stem, hint: item.spec.hint, given: item.spec.given })), 'spec_fields')
    rejects(mutate(item, (x) => (x.spec = null)), 'spec_fields')
  })

  it('given_fields: missing, extra, out of range, wrong type, zero where non-zero', () => {
    rejects(withGiven(item, { d: null }), 'given_fields')
    rejects(withGiven(item, { x: 8 }), 'given_fields')
    rejects(withGiven(item, { a: 13 }), 'given_fields')
    rejects(withGiven(item, { a: '7' }), 'given_fields')
    rejects(withGiven(item, { a: 7.5 }), 'given_fields')
    rejects(withGiven(item, { b: 0 }), 'given_fields')
    rejects(withGiven(sampleOf('percent', 'discount'), { thing: 'umbrella' }), 'given_fields')
    rejects(withGiven(sampleOf('mean', 'missing'), { known: [1, 2] }), 'given_fields')
    rejects(withGiven(sampleOf('mean', 'missing'), { known: [1, 2, 61] }), 'given_fields')
  })

  it('stratum_matches: the template stratum and the default b band of b_prior (priors.ts)', () => {
    rejects(mutate(item, (x) => (x.stratum = 3)), 'stratum_matches')
    // b = −1.1 (stratum 2, band −1.5…−0.5) moved to −0.4, in stratum 3's band.
    expect(item.difficulty.b_prior).toBeCloseTo(-1.1, 12)
    rejects(mutate(item, (x) => (x.difficulty = { ...item.difficulty, b_prior: item.difficulty.b_prior + 0.7 })), 'stratum_matches')
  })

  it('input_format_matches and hint_matches', () => {
    rejects(mutate(item, (x) => (x.spec = { ...item.spec, input_format: 'decimal' })), 'input_format_matches')
    rejects(mutate(item, (x) => (x.spec = { ...item.spec, hint: 'Enter anything.' })), 'hint_matches')
  })

  it('stem_matches', () => {
    rejects(mutate(item, (x) => (x.spec = { ...item.spec, stem: item.spec.stem.replace('Solve', 'Find') })), 'stem_matches')
    rejects(mutate(item, (x) => (x.spec = { ...item.spec, stem: 7 })), 'stem_matches')
  })

  it('key_shape: non-canonical, non-string, extra fields, missing', () => {
    const [n, d] = [Number(item.key.value), 1]
    rejects(mutate(item, (x) => (x.key = { value: `${2 * n}/2`, tol: { abs: 0 } })), 'key_shape')
    rejects(mutate(item, (x) => (x.key = { value: n / d, tol: { abs: 0 } })), 'key_shape')
    rejects(mutate(item, (x) => (x.key = { value: item.key.value, tol: { abs: 0 }, why: 'x' })), 'key_shape')
    rejects(mutate(item, (x) => (x.key = { tol: { abs: 0 } })), 'key_shape')
    rejects(mutate(item, (x) => (x.key = null)), 'key_shape')
  })

  it('key_matches: a wrong key', () => {
    rejects(mutate(item, (x) => (x.key = { value: String(Number(item.key.value) + 1), tol: { abs: 0 } })), 'key_matches')
    const frac = sampleOf('probability', 'same')
    rejects(mutate(frac, (x) => (x.key = { value: '1/2', tol: { abs: 0 } })), 'key_matches')
  })

  it('tolerance_matches', () => {
    rejects(mutate(item, (x) => (x.key = { value: item.key.value, tol: { abs: 0.5 } })), 'tolerance_matches')
    rejects(mutate(item, (x) => (x.key = { value: item.key.value, tol: { rel: 0.005 } })), 'tolerance_matches')
    rejects(mutate(item, (x) => (x.key = { value: item.key.value, tol: { abs: 0, rel: 0 } })), 'tolerance_matches')
    rejects(mutate(item, (x) => (x.key = { value: item.key.value, tol: 0 })), 'tolerance_matches')
    const dec = sampleOf('percent', 'discount')
    rejects(mutate(dec, (x) => (x.key = { value: dec.key.value, tol: { abs: 0 } })), 'tolerance_matches')
    rejects(mutate(dec, (x) => (x.key = { value: dec.key.value, tol: { rel: 0.005 } })), 'tolerance_matches')
    rejects(mutate(dec, (x) => (x.key = { value: dec.key.value, tol: { abs: 0.05 } })), 'tolerance_matches')
  })

  it('answer_fits_format: a non-integer answer for integer entry, a long decimal', () => {
    rejects(withGiven(item, { a: 3, b: 1, c: 1, d: 2 }), 'answer_fits_format') // x = 1/2
    rejects(withGiven(sampleOf('rate', 'avg_speed'), { d1: 20, t1: 1, d2: 45, t2: 2 }), 'answer_fits_format') // 65/3
  })

  it('answer_magnitude: an answer above 10^7', () => {
    // 30 + 150 + … + 30·5^9 = 73,242,180 (the rules cap the last term, so this also breaks last_term_range).
    const big = withGiven(sampleOf('geom_series', 'finite'), { first: 30, ratio: 5, count: 10 })
    expect(big.key.value).toBe('73242180')
    rejects(big, 'answer_magnitude')
    // The boundary: 4·(5^10 − 1)/4 = 9,765,624 passes, 5·(5^10 − 1)/4 = 12,207,030 does not.
    expect(verifyQuant(withGiven(big, { first: 4 })).checks.answer_magnitude).toBe(true)
    rejects(withGiven(big, { first: 5 }), 'answer_magnitude')
  })

  it('solved: a given the verifier cannot solve', () => {
    rejects(withGiven(sampleOf('system', 'sum'), { a1: 1, b1: 2, a2: 2, b2: 4 }), 'solved')
    rejects(withGiven(sampleOf('geom_series', 'infinite'), { p: 3, q: 2 }), 'solved') // diverges: no sum
  })

  it('features_match, prior_matches, time_matches, no_options', () => {
    rejects(mutate(item, (x) => (x.difficulty = { ...item.difficulty, features: { ...item.difficulty.features, template_offset: 0 } })), 'features_match')
    rejects(mutate(item, (x) => (x.difficulty = { ...item.difficulty, features: { ...item.difficulty.features, non_integer: true } })), 'features_match')
    rejects(mutate(item, (x) => (x.difficulty = { ...item.difficulty, features: { ...item.difficulty.features, extra: 1 } })), 'features_match')
    rejects(mutate(item, (x) => (x.difficulty = { ...item.difficulty, features: { ...item.difficulty.features, non_integer: 0 } })), 'features_match')
    rejects(mutate(item, (x) => (x.difficulty = { ...item.difficulty, features: { ...item.difficulty.features, stratum: '2' } })), 'features_match')
    rejects(mutate(item, (x) => (x.difficulty = { ...item.difficulty, b_prior: item.difficulty.b_prior + 0.5 })), 'prior_matches')
    rejects(mutate(item, (x) => (x.difficulty = { ...item.difficulty, sd_prior: 0.5 })), 'prior_matches')
    rejects(mutate(item, (x) => (x.difficulty = { ...item.difficulty, provenance: 'guess' })), 'prior_matches')
    rejects(mutate(item, (x) => (x.expected_time_s = item.expected_time_s + 1)), 'time_matches')
    rejects(mutate(item, (x) => (x.options_count = 5)), 'no_options')
  })

  it('never throws on malformed input', () => {
    for (const bad of [null, 1, 'x', [], { spec: {} }]) {
      const v = quant.verify(mutate(item, (x) => (x.spec = bad)))
      expect(v.ok).toBe(false)
    }
    expect(quant.verify(mutate(item, (x) => (x.difficulty = null))).ok).toBe(false)
  })
})

/** [template, variant, given patch, the rule that must fail]. Each given is inside the field ranges. */
const RULE_CASES: [string, string, Record<string, JsonValue>, string][] = [
  ['arith', 'mul_sub_div', { c: 50, d: 7 }, 'divides'],
  ['arith', 'mul_sub_div', { c: 12, d: 4 }, 'quotient_range'],
  ['arith', 'mul_sub_div', { c: 160, d: 8 }, 'quotient_range'],
  ['arith', 'group_mul', { a: 11, b: 11, c: 3, e: 99 }, 'positive'],
  ['arith', 'div_chain', { a: 13, b: 3 }, 'divides'],
  ['arith', 'div_chain', { a: 180, b: 3 }, 'quotient_range'],
  ['arith', 'div_chain', { a: 48, b: 3 }, 'quotient_range'],
  ['percent', 'of', { p: 50, n: 20 }, 'percent_choice'],
  ['percent', 'of', { p: 7, n: 100 }, 'percent_choice'],
  ['percent', 'of', { p: 5, n: 11 }, 'whole_result'],
  ['percent', 'change', { before: 100, after: 100 }, 'changed'],
  ['percent', 'change', { before: 100, after: 133 }, 'whole_percent'],
  ['percent', 'change', { before: 100, after: 185 }, 'whole_percent'],
  ['percent', 'change', { before: 100, after: 35 }, 'whole_percent'],
  ['fraction', 'add_sub', { a: 5, b: 3, c: 1, d: 4, op: 'add' }, 'proper'],
  ['fraction', 'add_sub', { a: 2, b: 4, c: 1, d: 3, op: 'add' }, 'lowest_terms'],
  ['fraction', 'add_sub', { a: 1, b: 5, c: 2, d: 5, op: 'add' }, 'distinct_denominators'],
  ['fraction', 'add_sub', { a: 1, b: 3, c: 1, d: 2, op: 'sub' }, 'positive'],
  ['fraction', 'mul_div', { a: 3, b: 2, c: 1, d: 4, op: 'mul' }, 'proper'],
  ['fraction', 'mul_div', { a: 3, b: 6, c: 1, d: 4, op: 'div' }, 'lowest_terms'],
  ['fraction_of', 'rest', { total: 13, a: 1, b: 2, c: 1, d: 3 }, 'whole_steps'],
  ['fraction_of', 'rest', { total: 12, a: 2, b: 2, c: 1, d: 3 }, 'proper'],
  ['fraction_of', 'rest', { total: 12, a: 2, b: 4, c: 1, d: 3 }, 'lowest_terms'],
  ['fraction_of', 'spent', { total: 12, a: 3, b: 2, c: 1, d: 3 }, 'proper'],
  ['fraction_of', 'spent', { total: 12, a: 2, b: 4, c: 1, d: 3 }, 'lowest_terms'],
  ['fraction_of', 'spent', { total: 20, a: 1, b: 2, c: 1, d: 3 }, 'whole_steps'],
  ['ratio', 'share', { name1: 'Sam', name2: 'Sam' }, 'distinct_names'],
  ['ratio', 'share', { a: 2, b: 4, total: 60 }, 'ratio_reduced'],
  ['ratio', 'share', { a: 1, b: 2, total: 7 }, 'whole_parts'],
  ['ratio', 'share', { a: 1, b: 2, total: 123 }, 'whole_parts'],
  ['ratio', 'total', { colour1: 'red', colour2: 'red' }, 'distinct_colours'],
  ['ratio', 'total', { a: 3, b: 3, count: 9 }, 'ratio_reduced'],
  ['ratio', 'total', { a: 3, b: 4, count: 10 }, 'whole_parts'],
  ['ratio', 'total', { a: 1, b: 2, count: 31 }, 'whole_parts'],
  ['ratio', 'three_way', { a: 2, b: 2, c: 2, total: 60 }, 'ratio_reduced'],
  ['ratio', 'three_way', { a: 1, b: 2, c: 3, total: 61 }, 'whole_parts'],
  ['ratio', 'three_way', { a: 1, b: 2, c: 3, total: 186 }, 'whole_parts'],
  ['rate', 'unit', { t1: 5, t2: 5, count: 50 }, 'distinct_times'],
  ['rate', 'unit', { t1: 2, t2: 5, count: 7 }, 'whole_rate'],
  ['rate', 'unit', { t1: 2, t2: 5, count: 82 }, 'whole_rate'],
  ['rate', 'avg_speed', { d1: 100, t1: 1, d2: 40, t2: 3 }, 'leg_speeds'],
  ['rate', 'avg_speed', { d1: 20, t1: 1, d2: 40, t2: 2 }, 'legs_differ'],
  ['rate', 'avg_speed', { d1: 5, t1: 1, d2: 17, t2: 3 }, 'average_range'],
  ['rate', 'avg_speed', { d1: 20, t1: 2, d2: 60, t2: 2 }, 'distinct_times'],
  ['rate', 'avg_speed', { d1: 20, t1: 1, d2: 45, t2: 2 }, 'half_units'],
  ['rate', 'together', { a: 6, b: 6 }, 'ordered'],
  ['rate', 'together', { a: 9, b: 6 }, 'ordered'],
  ['linear_eq', 'both_sides', { a: 5, c: 5 }, 'unique_solution'],
  ['linear_eq', 'both_sides', { a: 3, b: 1, c: 1, d: 2 }, 'solution_range'],
  ['linear_eq', 'both_sides', { a: 3, b: 1, c: 1, d: 41 }, 'solution_range'],
  ['linear_eq', 'both_sides', { a: 3, b: 1, c: 1, d: 33 }, 'solution_range'],
  ['linear_eq', 'brackets', { a: 4, c: 4 }, 'unique_solution'],
  ['linear_eq', 'brackets', { a: 3, b: 1, c: 1, d: 4 }, 'solution_range'],
  ['linear_eq', 'brackets', { a: 3, b: 1, c: 1, d: 29 }, 'solution_range'],
  ['linear_eq', 'over', { b: 5, c: 5 }, 'nonzero_solution'],
  ['mean', 'missing', { count: 5, known: [1, 2, 3] }, 'list_length'],
  ['mean', 'missing', { count: 4, mean: 8, known: [60, 60, 60] }, 'missing_range'],
  ['mean', 'missing', { count: 4, mean: 40, known: [20, 20, 20] }, 'missing_range'],
  ['mean', 'target', { scores: [50, 50, 50], mean: 95 }, 'score_range'],
  ['mean', 'target', { scores: [50, 50, 51], mean: 63 }, 'score_range'],
  ['system', 'solve', { a1: 1, b1: 2, a2: 2, b2: 4 }, 'unique_solution'],
  ['system', 'solve', { a1: 1, b1: 1, c1: 10, a2: 1, b2: -1, c2: 10, ask: 'x' }, 'solution_range'],
  ['system', 'sum', { a1: 1, b1: 2, a2: 2, b2: 4 }, 'unique_solution'],
  ['system', 'sum', { a1: 2, b1: 2, c1: 1, a2: 1, b2: -1, c2: 0 }, 'solution_range'],
  ['system', 'product', { a1: 1, b1: 2, a2: 2, b2: 4 }, 'unique_solution'],
  ['system', 'product', { a1: 1, b1: 1, c1: 30, a2: 1, b2: -1, c2: 0 }, 'solution_range'],
  ['quadratic', 'root', { b: 2, c: 1 }, 'two_solutions'],
  ['quadratic', 'root', { b: 1, c: -1 }, 'rational_roots'],
  ['quadratic', 'root', { b: -16, c: 0 }, 'roots_range'],
  ['quadratic', 'sum_squares', { b: 2, c: 1 }, 'two_solutions'],
  ['quadratic', 'sum_squares', { b: 1, c: -1 }, 'rational_roots'],
  ['quadratic', 'sum_squares', { b: -16, c: 0 }, 'roots_range'],
  ['quadratic', 'scaled', { a: 2, b: -1, c: -1 }, 'roots_range'],
  ['quadratic', 'scaled', { a: 2, b: -22, c: 0 }, 'roots_range'],
  ['quadratic', 'scaled', { a: 2, b: 0, c: 1 }, 'two_solutions'],
  ['quadratic', 'scaled', { a: 2, b: 1, c: -2 }, 'rational_roots'],
  ['exponent', 'product', { e1: 2, e2: 2, e3: 24 }, 'result_exponent'],
  ['exponent', 'product', { e1: 2, e2: 2, e3: 3 }, 'result_exponent'],
  ['exponent', 'power', { e1: 5, e2: 5, e3: 2 }, 'result_exponent'],
  ['exponent', 'power', { e1: 2, e2: 2, e3: 3 }, 'result_exponent'],
  ['exponent', 'root', { base: 16, p: 2, q: 2 }, 'non_integer_exponent'],
  ['exponent', 'root', { base: 10, p: 1, q: 2 }, 'perfect_power'],
  ['exponent', 'root', { base: 729, p: 1, q: 2 }, 'perfect_power'],
  ['exponent', 'solve', { base: 3, value: 100 }, 'exact_power'],
  ['exponent', 'solve', { base: 2, m: 2, k: 0, value: 8 }, 'solution_range'],
  ['exponent', 'solve', { base: 2, m: 1, k: 0, value: 128 }, 'solution_range'],
  ['probability', 'dice', { faces: 4, total: 8 }, 'total_possible'],
  ['symmetric', 'sum_sq', { s: 2, p: 1 }, 'real_distinct_roots'],
  ['symmetric', 'diff_sq', { s: 2, p: 1 }, 'real_distinct_roots'],
  ['symmetric', 'sum_cube', { s: 1, p: 5 }, 'real_distinct_roots'],
  ['arith_series', 'first_n', { diff: 1 }, 'difference'],
  ['arith_series', 'multiples', { m: 7, lo: 21, hi: 100 }, 'ends_not_multiples'],
  ['arith_series', 'multiples', { m: 7, lo: 20, hi: 30 }, 'span'],
  ['geom_series', 'finite', { first: 30, ratio: 5, count: 10 }, 'last_term_range'],
  ['geom_series', 'infinite', { p: 3, q: 2 }, 'convergent'],
  ['geom_series', 'infinite', { p: 2, q: 4 }, 'ratio_reduced'],
  ['modular', 'power', { base: 12, mod: 4 }, 'base_not_multiple'],
  ['modular', 'last_digit', { base: 15 }, 'interesting_digit'],
  ['modular', 'congruence', { a: 16, c: 1, mod: 5 }, 'residues'],
  ['modular', 'congruence', { a: 2, c: 1, mod: 6 }, 'invertible'],
  ['modular', 'congruence', { a: 3, c: 3, mod: 7 }, 'not_trivial'],
  ['counting', 'choose', { n: 6, k: 5 }, 'group_size'],
  ['counting', 'two_groups', { adults: 4, pick_adults: 4 }, 'proper_picks'],
  ['counting', 'two_groups', { pick_adults: 1, pick_children: 1 }, 'team_size'],
  ['counting', 'arrange', { counts: [1, 1] }, 'letter_total'],
  ['counting', 'arrange', { counts: [1, 1, 1, 1] }, 'repeated_letter'],
]

describe('quant verify: template rules (negative)', () => {
  it.each(RULE_CASES)('%s/%s %j breaks rule_%s', (template, variant, patch, rule) => {
    rejects(withGiven(sampleOf(template, variant), patch), `rule_${rule}`)
  })

  it('covers every rule of every variant (keyed on the variant, not the template)', () => {
    const tested = new Set(RULE_CASES.map(([t, v, , r]) => `${t}/${v}:${r}`))
    const untestable = new Set(['recip/*:real_distinct_roots', 'recip/*:irrational_roots'])
    const missing: string[] = []
    for (const v of VARIANTS) {
      for (const rule of Object.keys(quantRules(v, sampleOf(v.template, v.variant).spec.given))) {
        const id = `${v.template}/${v.variant}:${rule}`
        if (!tested.has(id) && !untestable.has(`${v.template}/*:${rule}`)) missing.push(id)
      }
    }
    expect(missing).toEqual([])
  })

  it('recip rules hold only for real, irrational roots (k outside the field range)', () => {
    // The field ranges (k ≥ 3 for x + 1/x, k ≥ 1 for x − 1/x) already exclude these, so verify()
    // rejects them as given_fields; the rules are checked directly.
    const plus = variantDef('recip', 'plus3')
    expect(quantRules(plus, { k: 2 })).toEqual({ real_distinct_roots: false, irrational_roots: false })
    expect(quantRules(plus, { k: 1 })).toEqual({ real_distinct_roots: false, irrational_roots: false })
    expect(quantRules(variantDef('recip', 'minus2'), { k: 0 })).toEqual({ real_distinct_roots: true, irrational_roots: false })
    rejects(withGiven(sampleOf('recip', 'plus3'), { k: 2 }), 'given_fields')
    rejects(withGiven(sampleOf('recip', 'minus2'), { k: 0 }), 'given_fields')
  })

  it('every rule case is otherwise well-formed (the given passes the field checks)', () => {
    for (const [t, v, patch] of RULE_CASES) {
      const r = verifyQuant(withGiven(sampleOf(t, v), patch))
      expect(r.checks.given_fields, `${t}/${v} ${JSON.stringify(patch)}`).toBe(true)
    }
  })
})

/**
 * [variant, full given, the checks that fail]: the same table as PARITY_CASES in the bank's
 * tests/gen/test_quant.py, so a failure reason means the same thing on both sides even for items
 * that fail several checks (review fix: the verifiers once differed on some of these).
 */
const PARITY_CASES: [string, Record<string, JsonValue>, string[]][] = [
  ['mean/missing', { count: 5, mean: 20, known: [1, 2, 3] }, ['answer_fits_format', 'answer_magnitude', 'key_matches', 'rule_list_length', 'solved']],
  ['geom_series/infinite', { first: 10, p: 3, q: 2 }, ['answer_fits_format', 'answer_magnitude', 'key_matches', 'rule_convergent', 'solved']],
  ['arith_series/multiples', { m: 3, lo: 40, hi: 25 }, ['key_matches', 'rule_span']],
  ['geom_series/finite', { first: 30, ratio: 5, count: 10 }, ['answer_magnitude', 'rule_last_term_range']],
  [
    'system/sum',
    { a1: 1, b1: 2, c1: 3, a2: 2, b2: 4, c2: 6 },
    ['answer_fits_format', 'answer_magnitude', 'key_matches', 'rule_solution_range', 'rule_unique_solution', 'solved'],
  ],
  ['rate/avg_speed', { d1: 20, t1: 1, d2: 45, t2: 2 }, ['answer_fits_format', 'rule_half_units']],
  ['rate/avg_speed', { d1: 20, t1: 2, d2: 60, t2: 2 }, ['rule_distinct_times']],
  ['linear_eq/both_sides', { a: 3, b: 1, c: 1, d: 2 }, ['answer_fits_format', 'rule_solution_range']],
  [
    'exponent/solve',
    { base: 3, m: 1, k: 0, value: 100 },
    ['answer_fits_format', 'answer_magnitude', 'key_matches', 'rule_exact_power', 'rule_solution_range', 'solved'],
  ],
  ['symmetric/diff_sq', { s: 2, p: 1 }, ['answer_fits_format', 'answer_magnitude', 'key_matches', 'rule_real_distinct_roots', 'solved']],
  ['exponent/product', { base: 2, e1: 2, e2: 2, e3: 3 }, ['rule_result_exponent']],
]

describe('quant verify: failure sets shared with the bank', () => {
  it.each(PARITY_CASES)('%s %j fails exactly %j', (id, given, failed) => {
    const [t, v] = id.split('/') as [string, string]
    const item = withGiven(sampleOf(t, v), given)
    expect(Object.keys(item.spec.given).sort()).toEqual(Object.keys(variantDef(t, v).fields).sort()) // the given is complete
    const checks = verifyQuant(item).checks
    expect(
      Object.entries(checks)
        .filter(([, ok]) => ok === false)
        .map(([k]) => k)
        .sort(),
    ).toEqual(failed)
  })
})
