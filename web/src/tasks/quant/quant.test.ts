import { describe, expect, it } from 'vitest'
import { NUMERIC_ITEM_TYPE, validateItemInstance } from '../family'
import { stratumOfB } from '../priors'
import { KEY_ECHO_MAX_CHANCE, KEY_ECHO_MIN_SEEN, runFamilyProperties, type FamilyPropertyOptions } from '../testing'
import { quant, quantSpecLeaksKey, type QuantItem, type QuantKey, type QuantResponse, type QuantSpec } from '.'
import { Fraction } from './fraction'
import { QUANT_PRIOR, QUANT_TIME_BASE_S, quantBPrior, quantFeatures } from './prior'
import { HINTS, TEMPLATES_BY_STRATUM, VARIANTS, lin, listText, paren, ratTerm, signed } from './templates'
import {
  QUANT_ECHO_MAX_CHANCE,
  QUANT_ECHO_MIN_SEEN,
  QuantKeyEcho,
  clone,
  sampleOf,
  samplesOf,
  stemNumbers,
  variantDef,
  withGiven,
} from './test-helpers'
import { quantSolve } from './verify'

/** A11: family_id = the template variant, so the structural space is the 53 variants. */
const VARIANT_SPACE = { min: 0.005, reason: `${VARIANTS.length} template variants (A11: family_id = quant template variant)` }

/**
 * Some template variants have small content spaces by design: x ± 1/x = k has one stem per
 * integer k (10–30 per variant), two-dice sums ~150, rational powers ~65, letter arrangements ~90.
 * Over 10,000 draws ~90% of contents are distinct (the other ~50 variants are large).
 */
const SMALL_TEMPLATES = { min: 0.85, reason: 'x ± 1/x = k, dice sums, rational powers and letter arrangements have < 200 stems each' }

const OPTS: FamilyPropertyOptions<QuantSpec, QuantKey, QuantResponse> = {
  specLeaksKey: quantSpecLeaksKey,
  familyIdRatio: VARIANT_SPACE,
  contentRatio: SMALL_TEMPLATES,
  correctResponse: (item) => item.key.value,
  // The key + 1, outside every tolerance (abs ≤ 0.005).
  incorrectResponse: (item) => (Fraction.parseCanonical(item.key.value) as Fraction).add(Fraction.ONE).toString(),
  // Typed entries are text (M1.F2): a number, an array or an object is malformed.
  malformedResponses: (item) => [Number(item.key.value), [item.key.value], { value: item.key.value }],
}

/** The family leak check, feeding every checked item to a run-level {@link QuantKeyEcho} too. */
const echoing =
  (echo: QuantKeyEcho) =>
  (item: QuantItem): string | null => {
    echo.observe(item)
    return quantSpecLeaksKey(item)
  }

const variantKey = (item: QuantItem): string => {
  const sp = item.structural_params as { template: string; variant: string }
  return `${sp.template}/${sp.variant}`
}

describe('quant family (M1.8)', () => {
  it('passes runFamilyProperties at n = 10,000 across strata 1–4', () => {
    const echo = new QuantKeyEcho()
    const r = runFamilyProperties(quant, { ...OPTS, strata: quant.strata, specLeaksKey: echoing(echo) })
    expect(echo.problems()).toEqual([])
    expect(echo.judged().length).toBe(VARIANTS.length)
    expect(r.n).toBe(10_000)
    expect(r.distinctItemIds).toBe(10_000)
    expect(r.strataCounts).toEqual({ 1: 2_500, 2: 2_500, 3: 2_500, 4: 2_500, 5: 0, 6: 0 })
    expect(r.distinctFamilyIds).toBe(VARIANTS.length)
    expect(r.distinctContents).toBeGreaterThan(8_500)
    expect(r.bPrior.min).toBeGreaterThanOrEqual(-2.3)
    expect(r.bPrior.max).toBeLessThanOrEqual(1.4)
  }, 300_000)

  it('passes with the family choosing the stratum', () => {
    const r = runFamilyProperties(quant, { ...OPTS, n: 2_000, seedPrefix: 'free-' })
    for (const s of [1, 2, 3, 4] as const) expect(r.strataCounts[s]).toBeGreaterThan(400)
    expect(r.strataCounts[5] + r.strataCounts[6]).toBe(0)
  }, 120_000)

  it('has ≥ 12 templates over strata 1–4, every variant generated and solvable', () => {
    const templates = new Set(VARIANTS.map((v) => v.template))
    expect(templates.size).toBeGreaterThanOrEqual(12)
    for (const s of [1, 2, 3, 4] as const) expect(TEMPLATES_BY_STRATUM[s].length).toBeGreaterThanOrEqual(4)
    const ids = VARIANTS.map((v) => `${v.template}/${v.variant}`)
    expect(new Set(ids).size).toBe(ids.length)
    for (const v of VARIANTS) {
      const item = sampleOf(v.template, v.variant)
      expect(item.stratum).toBe(v.stratum)
      expect(item.spec.input_format).toBe(v.format)
      expect(quantSolve(v, item.spec.given)?.toString(), variantKey(item)).toBe(item.key.value)
      expect(quant.verify(item).ok, variantKey(item)).toBe(true)
    }
  })

  it('is a 2PL numeric-entry item on QR (A9) with an exact key and per-item tolerance', () => {
    const item = quant.generate('shape', { stratum: 3 })
    expect(item.axis).toBe('QR')
    expect(item.item_type).toBe(NUMERIC_ITEM_TYPE)
    expect(NUMERIC_ITEM_TYPE).toBe('numeric') // DESIGN §14.6 ex. 2, shared with series
    expect(item.options_count).toBeUndefined()
    expect(item.params).toEqual({ model: '2pl', a: 1, b: item.difficulty.b_prior })
    expect(Fraction.parseCanonical(item.key.value)).not.toBeNull()
    expect(item.family_id).toBe(quant.familyIdOf({ template: variantKey(item).split('/')[0] as string, variant: variantKey(item).split('/')[1] as string }))
    expect(validateItemInstance(item, quant)).toEqual([])
    for (let i = 0; i < 400; i++) {
      const it = quant.generate(`tol-${i}`)
      expect(it.key.tol).toEqual(it.spec.input_format === 'decimal' ? { abs: 0.005 } : { abs: 0 })
      expect(it.spec.hint).toBe(HINTS[it.spec.input_format])
      if (it.spec.input_format === 'integer') expect(it.key.value).toMatch(/^-?\d+$/)
    }
  })

  it('targets strata through the seed and refuses 5–6', () => {
    const item = quant.generate('demo', { stratum: 4 })
    expect(item.seed).toBe('demo@s4')
    expect(quant.generate('demo@s4')).toEqual(item)
    expect(() => quant.generate('demo', { stratum: 5 })).toThrow(RangeError)
    expect(() => quant.generate('demo', { stratum: 6 })).toThrow(RangeError)
  })

  it('keeps the key out of the render payload', () => {
    for (let i = 0; i < 300; i++) {
      const item = quant.generate(`leak-${i}`)
      expect(quantSpecLeaksKey(item)).toBeNull()
      expect(Object.keys(item.spec).sort()).toEqual(['given', 'hint', 'input_format', 'stem'])
    }
    const item = sampleOf('linear_eq', 'both_sides')
    const leaky = clone(item) as unknown as { spec: Record<string, unknown> }
    leaky.spec.given = { ...item.spec.given, x: 3 }
    expect(quantSpecLeaksKey(leaky as unknown as QuantItem)).toMatch(/given fields/)
    leaky.spec = { ...item.spec, worked: 'x = 3' }
    expect(quantSpecLeaksKey(leaky as unknown as QuantItem)).toMatch(/spec fields/)
  })

  it('flags a given value or a stem number that is the key in every instance of a variant (run level)', () => {
    expect([QUANT_ECHO_MIN_SEEN, QUANT_ECHO_MAX_CHANCE]).toEqual([KEY_ECHO_MIN_SEEN, KEY_ECHO_MAX_CHANCE])
    type Loose = { spec: { stem: string; given: Record<string, unknown> } }
    const leak = (items: QuantItem[], f: (x: Loose, item: QuantItem, i: number) => void): QuantKeyEcho => {
      const echo = new QuantKeyEcho()
      items.forEach((item, i) => {
        const x = clone(item) as unknown as Loose
        f(x, item, i)
        echo.observe(x as unknown as QuantItem)
      })
      return echo
    }
    // A number field holding x₀ (the mutation the shared value checks cannot see: "8" vs 8).
    const lin = samplesOf('linear_eq', 'both_sides', 30)
    expect(leak(lin, (x, it) => (x.spec.given.root = Number(it.key.value))).problems()).toEqual([
      'linear_eq/both_sides: given.root equals the key in all 30 instances',
    ])
    // A fraction key as text, a decimal key as a number, a nested leaf, and a stem that states it.
    const prob = samplesOf('probability', 'same', 25)
    expect(leak(prob, (x, it) => (x.spec.given.note = it.key.value)).problems()).toEqual([
      'probability/same: given.note equals the key in all 25 instances',
    ])
    const dec = samplesOf('rate', 'avg_speed', 25)
    expect(leak(dec, (x, it) => (x.spec.given.legs = [1, Fraction.parseCanonical(it.key.value)?.toNumber() ?? 0])).problems()).toEqual([
      'rate/avg_speed: given.legs[1] equals the key in all 25 instances',
    ])
    expect(leak(lin, (x, it) => (x.spec.stem = `${x.spec.stem} (x = ${signed(Number(it.key.value))})`)).problems()).toEqual([
      'linear_eq/both_sides: the stem shows the key in all 30 instances',
    ])
    // Not flagged: a copy in all but one instance, too few instances, or no copy at all.
    expect(leak(lin, (x, it, i) => (x.spec.given.root = i === 17 ? 99 : Number(it.key.value))).problems()).toEqual([])
    expect(leak(lin.slice(0, 19), (x, it) => (x.spec.given.root = Number(it.key.value))).problems()).toEqual([])
    expect(leak(lin, () => undefined).problems()).toEqual([])
    expect(stemNumbers('If x − 1/x = 5, what is x^3 − 1/x^3? Sum 12 + 4/3 + (−6) + 2.5.').map(String)).toEqual([
      '1', '5', '3', '1', '3', '12', '4/3', '-6', '5/2',
    ])
  })
})

describe('quant prior and time (M1.P) [SPEC v0]', () => {
  it('centres b on the default band centres −2, −1, 0, 1 with small template offsets, inside the band', () => {
    expect(QUANT_PRIOR.anchorB).toBe(-2)
    for (const v of VARIANTS) {
      expect(v.offset, `${v.template}/${v.variant}`).toBeGreaterThanOrEqual(-0.3)
      expect(v.offset).toBeLessThanOrEqual(0.3)
      for (const nonInteger of [false, true]) {
        const b = quantBPrior(quantFeatures(v.template, v.variant, v.stratum, v.offset, nonInteger))
        const anchor = -2 + (v.stratum - 1)
        expect(b).toBeCloseTo(anchor + v.offset + (nonInteger ? 0.1 : 0), 12)
        // The shared stratum convention (priors.ts STRATUM_B_CUTS): the stratum is b's band.
        expect(stratumOfB(b), `${v.template}/${v.variant}`).toBe(v.stratum)
      }
    }
    for (const s of [1, 2, 3, 4] as const) {
      const offsets = VARIANTS.filter((v) => v.stratum === s).map((v) => v.offset)
      expect(Math.abs(offsets.reduce((a, o) => a + o, 0) / offsets.length), `stratum ${s}`).toBeLessThanOrEqual(0.1)
    }
  })

  it('expected time is 30–90 s: the stratum base plus 4 s per 50 words', () => {
    expect(QUANT_TIME_BASE_S).toEqual({ 1: 30, 2: 45, 3: 60, 4: 75 })
    for (let i = 0; i < 2_000; i++) {
      const item = quant.generate(`time-${i}`)
      expect(item.expected_time_s).toBeGreaterThanOrEqual(30)
      expect(item.expected_time_s).toBeLessThanOrEqual(90)
      expect(item.expected_time_s).toBeGreaterThan(QUANT_TIME_BASE_S[item.stratum as 1 | 2 | 3 | 4])
      expect(item.difficulty.sd_prior).toBe(1)
      expect(item.difficulty.features.non_integer).toBe(item.key.value.includes('/'))
    }
  })
})

describe('quant stems', () => {
  it('render signs, terms and lists', () => {
    expect(lin([[7, 'x'], [-12, '']])).toBe('7x − 12')
    expect(lin([[-1, 'x'], [1, 'y']])).toBe('−x + y')
    expect(lin([[1, 'x^2'], [0, 'x'], [-16, '']])).toBe('x^2 − 16')
    expect(lin([[0, 'x']])).toBe('0')
    expect(signed(-3)).toBe('−3')
    expect(paren(-6)).toBe('(−6)')
    expect(paren(6)).toBe('6')
    expect(ratTerm(Fraction.of(-3, 2))).toBe('(−3/2)')
    expect(listText(['1', '2', '3'])).toBe('1, 2 and 3')
  })

  it('renders the §14.6 example 3 and its key 18', () => {
    const base = sampleOf('recip', 'plus3')
    const item = withGiven(base, { k: 3 })
    expect(item.spec.stem).toBe('If x + 1/x = 3, what is the value of x^3 + 1/x^3?')
    expect(item.key).toEqual({ value: '18', tol: { abs: 0 } })
    expect(quant.verify(item).ok).toBe(true)
  })

  it('renders every variant from its given (examples)', () => {
    const cases: [string, string, Record<string, number | string | boolean | number[]>, string, string][] = [
      ['arith', 'mul_sub_div', { a: 37, b: 4, c: 96, d: 8 }, 'Compute 37 × 4 − 96 ÷ 8.', '136'],
      ['arith', 'div_chain', { a: 144, b: 12, c: 5, e: 17 }, 'Compute 144 ÷ 12 × 5 + 17.', '77'],
      ['percent', 'discount', { thing: 'lamp', price: 34, p: 15 }, 'A lamp costs $34. In a sale, its price is cut by 15%. What is the sale price, in dollars?', '289/10'],
      ['percent', 'change', { thing: 'kettle', before: 40, after: 30 }, 'The price of a kettle falls from $40 to $30. By what percentage did the price fall?', '25'],
      ['fraction', 'add_sub', { a: 2, b: 3, c: 5, d: 12, op: 'add' }, 'Compute 2/3 + 5/12.', '13/12'],
      ['linear_eq', 'both_sides', { a: 7, b: -12, c: 3, d: 20 }, 'Solve for x: 7x − 12 = 3x + 20.', '8'],
      ['linear_eq', 'over', { p: 4, b: 7, c: -3 }, 'Solve for x: x/4 + 7 = −3.', '-40'],
      ['system', 'sum', { a1: 2, b1: 3, c1: 13, a2: 1, b2: -1, c2: -1 }, 'If 2x + 3y = 13 and x − y = −1, what is the value of x + y?', '5'],
      ['quadratic', 'root', { b: -5, c: -14, ask: 'larger' }, 'The equation x^2 − 5x − 14 = 0 has two solutions. What is the larger solution?', '7'],
      ['exponent', 'solve', { base: 3, m: 2, k: 1, value: 243 }, 'Solve for x: 3^(2x + 1) = 243.', '2'],
      ['exponent', 'root', { base: 27, p: 2, q: 3, negative: true }, 'Compute 27^(−2/3).', '1/9'],
      ['probability', 'both', { red: 4, blue: 5, green: 3, colour: 'red' }, 'A bag holds 4 red, 5 blue and 3 green marbles. Two marbles are drawn at random without replacement. What is the probability that both are red?', '1/11'],
      ['arith_series', 'sum', { first: 7, diff: 4, count: 20 }, 'What is the value of the sum 7 + 11 + 15 + … + 83?', '900'],
      ['geom_series', 'infinite', { first: 12, p: 1, q: 3 }, 'What is the sum of the infinite geometric series 12 + 4 + 4/3 + 4/9 + …?', '18'],
      ['modular', 'power', { base: 7, exp: 123, mod: 5 }, 'What is the remainder when 7^123 is divided by 5?', '3'],
      ['counting', 'arrange', { counts: [2, 3, 1] }, 'In how many different orders can the letters A, A, B, B, B and C be written in a row?', '60'],
    ]
    for (const [t, v, given, stem, value] of cases) {
      const item = withGiven(sampleOf(t, v), given)
      expect(item.spec.stem, `${t}/${v}`).toBe(stem)
      expect(item.key.value, `${t}/${v}`).toBe(value)
      expect(quant.verify(item).ok, `${t}/${v}: ${quant.verify(item).reason}`).toBe(true)
      expect(variantDef(t, v).render(item.spec.given)).toBe(stem)
    }
  })
})
