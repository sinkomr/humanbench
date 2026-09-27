import { describe, expect, it } from 'vitest'
import { itemParamsFor, validateItemInstance, type AnyFamily, type ItemInstance } from '../family'
import { itemId } from '../ids'
import { ICAR_ANCHOR_B, stratumOfB } from '../priors'
import { runFamilyProperties } from '../testing'
import { SERIES_STRATA, acceptDraft, renderDraft, type Draft } from './gen'
import { SERIES_ITEM_TYPE, series, seriesSpecLeaksKey, type SeriesItem, type SeriesKey, type SeriesSpec } from '.'
import { SERIES_PRIOR, seriesDifficulty, seriesExpectedTime, seriesFeatures } from './prior'
import {
  EPSILON_BITS,
  RULE_NAMES,
  analyse,
  compareDl,
  descriptionLength,
  fitAll,
  fitCompositeAff,
  fitCompositeAlt,
  fitFibonacci,
  fitGeometric,
  fitInterleaved,
  fitLetter,
  fitPolynomial,
  inRuleDomain,
  interpolantDl,
  letterStep,
  toPosition,
  uniquenessChecks,
  type RuleName,
} from './rules'
import { parseIntegerResponse, parseLetterResponse } from './score'

/** A11 isomorph classes: family_id = rule + non-start coefficients, so ~1,700 families per 10k items. */
const FAMILY_ID_RATIO = {
  min: 0.1,
  reason: 'family_id = rule family + non-start coefficients (A11): e.g. every quadratic with 2nd difference 2 is one family',
}
/**
 * ~95.5% (natural mix) and ~93.6% (strata requested evenly) distinct at n = 10,000: letter series
 * have 1,248 possible contents (26 starts × 16 steps × 3 lengths), and the small-number
 * arithmetic/geometric series of strata 1–2 a few hundred to ~1,500 each.
 */
const CONTENT_RATIO = { min: 0.9, reason: 'letter series (1,248 possible) and small-number arithmetic/geometric strata have small content spaces' }

const correctResponse = (item: SeriesItem): string =>
  'letter' in item.key ? item.key.letter.toLowerCase() : ` ${String(item.key.value)} `

const OPTS = { specLeaksKey: seriesSpecLeaksKey, familyIdRatio: FAMILY_ID_RATIO, contentRatio: CONTENT_RATIO, correctResponse } as const

type Mutable = { -readonly [K in keyof SeriesItem]: unknown }

/** A full item for a hand-built series (visible terms + key as `values`; letters as positions). */
function makeItem(rule: RuleName, coefficients: Record<string, number | string>, values: readonly number[]): SeriesItem {
  const draft: Draft = { rule, coefficients, values }
  const features = seriesFeatures(rule, coefficients, values)
  const difficulty = seriesDifficulty(features)
  const stratum = stratumOfB(difficulty.b_prior)
  const seed = `hand-${rule}-${values.join('_')}`
  const { spec, key } = renderDraft(draft)
  return {
    item_id: itemId('series', '1.0.0', seed),
    family_id: series.familyIdOf({ rule, coefficients }),
    family: 'series',
    generator_version: '1.0.0',
    seed,
    axis: 'MAT',
    facet: 'series',
    item_type: SERIES_ITEM_TYPE,
    stratum,
    spec,
    key,
    structural_params: { rule, coefficients },
    params: itemParamsFor(undefined, 1, difficulty.b_prior),
    difficulty,
    expected_time_s: seriesExpectedTime(features),
  }
}

function tamper(item: SeriesItem, f: (x: Mutable) => void): SeriesItem {
  const x = JSON.parse(JSON.stringify(item)) as Mutable
  f(x)
  return x as unknown as SeriesItem
}

const failed = (item: SeriesItem): string => {
  const v = series.verify(item)
  expect(v.ok).toBe(false)
  return v.reason
}

describe('series family: property suite (DESIGN §14.3 M1 acceptance 1)', () => {
  it('passes runFamilyProperties at n = 10,000 spread over strata 1–5', () => {
    const r = runFamilyProperties(series, { ...OPTS, strata: SERIES_STRATA, seedPrefix: 'strata-' })
    expect(r.n).toBe(10_000)
    expect(r.distinctItemIds).toBe(10_000)
    expect(r.strataCounts).toEqual({ 1: 2_000, 2: 2_000, 3: 2_000, 4: 2_000, 5: 2_000, 6: 0 })
  }, 180_000)

  it('passes runFamilyProperties at n = 10,000 with the natural stratum mix', () => {
    const r = runFamilyProperties(series, OPTS)
    expect(r.n).toBe(10_000)
    for (const s of SERIES_STRATA) expect(r.strataCounts[s]).toBeGreaterThan(800)
    expect(r.strataCounts[6]).toBe(0)
    expect(r.bPrior.min).toBeLessThan(-1.5)
    expect(r.bPrior.max).toBeGreaterThan(1.5)
  }, 180_000)

  it('generates every rule family, numbers and letters, with 5–7 terms', () => {
    const rules = new Set<string>()
    const lengths = new Set<number>()
    const formats = new Set<string>()
    for (let i = 0; i < 2_000; i++) {
      const item = series.generate(`mix-${i}`)
      rules.add((item.structural_params as { rule: string }).rule)
      lengths.add(item.spec.terms.length)
      formats.add(item.spec.input_format)
      expect(item.expected_time_s).toBeGreaterThanOrEqual(20)
      expect(item.expected_time_s).toBeLessThanOrEqual(45)
    }
    expect([...rules].sort()).toEqual([...RULE_NAMES].sort())
    expect([...lengths].sort()).toEqual([5, 6, 7])
    expect([...formats].sort()).toEqual(['integer', 'letter'])
  }, 60_000)
})

describe('series family: identity, strata and params', () => {
  it('is axis MAT, facet series, one entry item type, strata 1–5', () => {
    expect(series.name).toBe('series')
    expect(series.axis).toBe('MAT')
    expect(series.facet).toBe('series')
    expect(series.itemType).toBe('series_entry')
    expect(series.strata).toEqual([1, 2, 3, 4, 5])
  })

  it('targets strata through the seed and refuses stratum 6', () => {
    const item = series.generate('demo', { stratum: 3 })
    expect(item.seed).toBe('demo@s3')
    expect(item.stratum).toBe(3)
    expect(series.generate('demo@s3')).toEqual(item)
    expect(() => series.generate('demo', { stratum: 6 })).toThrow(RangeError)
  })

  it('uses 2PL with b = b_prior and no options (A9: entry items)', () => {
    const item = series.generate('params')
    expect(item.options_count).toBeUndefined()
    expect(item.params).toEqual({ model: '2pl', a: 1, b: item.difficulty.b_prior })
    expect(item.difficulty.sd_prior).toBe(1)
    expect(item.difficulty.provenance).toMatch(/\[SPEC\]/)
  })

  it('keys integers as { value, tol: 0 } and letters as { letter }', () => {
    for (let i = 0; i < 300; i++) {
      const item = series.generate(`keys-${i}`)
      if (item.spec.input_format === 'letter') {
        expect(Object.keys(item.key)).toEqual(['letter'])
        expect((item.key as { letter: string }).letter).toMatch(/^[A-Z]$/)
        for (const t of item.spec.terms) expect(t).toMatch(/^[A-Z]$/)
      } else {
        expect(item.key).toEqual({ value: (item.key as { value: number }).value, tol: 0 })
      }
    }
  })

  it('gives isomorphs (same rule and coefficients, other start) one family_id (A11)', () => {
    const a = makeItem('arithmetic', { d: 3 }, [2, 5, 8, 11, 14, 17])
    const b = makeItem('arithmetic', { d: 3 }, [40, 43, 46, 49, 52, 55, 58])
    const c = makeItem('arithmetic', { d: 4 }, [2, 6, 10, 14, 18, 22])
    expect(a.family_id).toBe(b.family_id)
    expect(a.family_id).not.toBe(c.family_id)
    expect(validateItemInstance(a, series as unknown as AnyFamily)).toEqual([])
  })
})

describe('series description length (exact)', () => {
  it('charges the family cost plus log2(1 + |c|) + 1 per coefficient', () => {
    const dl = descriptionLength(2, [1, 3])
    expect(dl).toEqual({ bits: 4, prod: 8n, approx: 7 })
    expect(descriptionLength(4, [2, 4, 2]).approx).toBeCloseTo(4 + 3 + Math.log2(3) * 2 + Math.log2(5), 12)
    expect(descriptionLength(3, [-5, 2]).prod).toBe(18n)
  })

  it('compares DLs exactly, including ties and the ε slack', () => {
    const a = descriptionLength(4, [0, 0]) // 6 bits
    const b = descriptionLength(2, [1, 1]) // 2 + 2 + 2 = 6 bits
    expect(compareDl(a, b)).toBe(0)
    expect(compareDl(descriptionLength(2, [1, 3]), b)).toBe(1)
    expect(compareDl(b, descriptionLength(2, [1, 3]))).toBe(-1)
    expect(compareDl(descriptionLength(2, [1, 3]), b, 1)).toBe(0) // 7 ≤ 6 + 1
    expect(compareDl(descriptionLength(2, [1, 7]), b, EPSILON_BITS)).toBe(0) // 8 ≤ 6 + 2 (inside ε)
    expect(compareDl(descriptionLength(2, [1, 15]), b, EPSILON_BITS)).toBe(1) // 9 > 6 + 2
    expect(() => compareDl(a, b, 0.5)).toThrow(RangeError)
  })
})

describe('series rule fitting', () => {
  it('fits §14.6 example 2 (2, 6, 12, 20, 30 → 42) uniquely as the quadratic n(n + 1)', () => {
    const v = [2, 6, 12, 20, 30]
    const fit = fitPolynomial(v)
    expect(fit).toMatchObject({ rule: 'quadratic', coefficients: { s: 2 }, next: 42 })
    const a = analyse(v, false)
    expect(a.predictions).toEqual([42])
    const checks = uniquenessChecks(a, { rule: 'quadratic', coefficients: { s: 2 } }, 42)
    expect(checks).toMatchObject({ key_rule_fits: true, key_is_rule_prediction: true, key_rule_is_min_dl: true, min_dl_rules_agree: true, simpler_than_interpolant: true })
  })

  it('fits polynomials of minimal degree 1–3 in Newton form', () => {
    expect(fitPolynomial([4, 7, 10, 13, 16])).toMatchObject({ rule: 'arithmetic', coefficients: { d: 3 }, next: 19 })
    expect(fitPolynomial([5, 5, 5, 5, 5])).toMatchObject({ rule: 'arithmetic', coefficients: { d: 0 }, next: 5 })
    expect(fitPolynomial([1, 8, 27, 64, 125])).toMatchObject({ rule: 'cubic', coefficients: { d3: 6 }, next: 216 })
    expect(fitPolynomial([1, 2, 4, 8, 16, 32])).toBeNull()
  })

  it('computes the degree-(m − 1) interpolant from the Newton coefficients', () => {
    // 1, 2, 4, 8, 16: every difference row starts with 1 → cost 8 + 5 × 2 bits
    expect(interpolantDl([1, 2, 4, 8, 16])).toEqual({ bits: 13, prod: 32n, approx: 18 })
  })

  it('fits geometric series with integer ratios only', () => {
    expect(fitGeometric([3, -6, 12, -24, 48])).toMatchObject({ coefficients: { r: -2 }, next: -96 })
    expect(fitGeometric([4, 6, 9, 13, 20])).toBeNull()
    expect(fitGeometric([0, 1, 2, 3, 4])).toBeNull()
    expect(fitGeometric([0, 0, 0, 0, 0])).toMatchObject({ coefficients: { r: 0 }, next: 0 })
  })

  it('fits two interleaved arithmetic sequences for odd and even lengths', () => {
    expect(fitInterleaved([3, 10, 5, 13, 7, 16])).toMatchObject({ coefficients: { da: 2, db: 3 }, next: 9 })
    expect(fitInterleaved([3, 10, 5, 13, 7])).toMatchObject({ next: 16 })
    expect(fitInterleaved([3, 10, 5, 13, 8])).toBeNull()
  })

  it('fits Fibonacci-type recurrences with a constant', () => {
    expect(fitFibonacci([1, 1, 2, 3, 5, 8])).toMatchObject({ coefficients: { c: 0 }, next: 13 })
    expect(fitFibonacci([2, 3, 6, 10, 17])).toMatchObject({ coefficients: { c: 1 }, next: 28 })
    expect(fitFibonacci([2, 3, 6, 10, 18])).toBeNull()
  })

  it('fits composite alternating ops (×2 then +1) and affine steps (×2 + 1)', () => {
    const alt = fitCompositeAlt([1, 2, 3, 6, 7, 14])
    expect(alt.map((f) => [f.coefficients, f.next])).toEqual([[{ op_a: 'mul', by_a: 2, op_b: 'add', by_b: 1 }, 15]])
    expect(fitCompositeAff([1, 3, 7, 15, 31])).toEqual([expect.objectContaining({ coefficients: { m: 2, c: 1 }, next: 63 })])
    expect(fitCompositeAff([1, 3, 7, 15, 32])).toEqual([])
  })

  it('fits letter-position arithmetic mod 26 across the Z → A wrap', () => {
    // X, A, D, G, J = 24, 1, 4, 7, 10 → M = 13
    expect(fitLetter([24, 1, 4, 7, 10])).toMatchObject({ rule: 'letter', coefficients: { d: 3 }, next: 13 })
    expect(fitLetter([24, 1, 4, 7, 11])).toBeNull()
    expect(letterStep(23)).toBe(-3)
    expect(letterStep(13)).toBe(13)
    expect(letterStep(-13)).toBe(13)
    expect(toPosition(27)).toBe(1)
    expect(toPosition(0)).toBe(26)
  })

  it('reads integer-family predictions on letter positions mod 26', () => {
    // A, B, D, H, P = 1, 2, 4, 8, 16: geometric → 32 → F
    const fits = fitAll([1, 2, 4, 8, 16], true)
    expect(fits.find((f) => f.rule === 'geometric')?.next).toBe(6)
  })

  it('finds competing minimum-DL rules that disagree', () => {
    // interleaved (2, 3, 4 | 4, 4 → 4) and Fibonacci-type (c = −3 → 5) both cost exactly 12.91 bits
    const a = analyse([2, 4, 3, 4, 4], false)
    expect(a.predictions).toEqual([4, 5])
    expect(new Set(a.minSet.map((f) => f.rule))).toEqual(new Set(['interleaved', 'fibonacci']))
  })

  it('checks key-rule domains', () => {
    expect(inRuleDomain('arithmetic', { d: 0 })).toBe(false)
    expect(inRuleDomain('geometric', { r: 1 })).toBe(false)
    expect(inRuleDomain('geometric', { r: -2 })).toBe(true)
    expect(inRuleDomain('letter', { d: 13 })).toBe(false)
    expect(inRuleDomain('composite_alt', { op_a: 'mul', by_a: 1, op_b: 'add', by_b: 2 })).toBe(false)
    expect(inRuleDomain('composite_alt', { op_a: 'mul', by_a: 11, op_b: 'add', by_b: 2 })).toBe(false)
    expect(inRuleDomain('composite_alt', { op_a: 'mul', by_a: 2, op_b: 'add', by_b: 0 })).toBe(false)
    expect(inRuleDomain('composite_aff', { m: 2, c: 0 })).toBe(false)
    expect(inRuleDomain('interleaved', { da: 0, db: 0 })).toBe(false)
    expect(inRuleDomain('quadratic', { s: 2, extra: 1 })).toBe(false)
  })

  it('accepts the generator’s own drafts only when unique', () => {
    expect(acceptDraft({ rule: 'arithmetic', coefficients: { d: 3 }, values: [2, 5, 8, 11, 14, 17] })).toBe(true)
    expect(acceptDraft({ rule: 'fibonacci', coefficients: { c: -3 }, values: [2, 4, 3, 4, 4, 5] })).toBe(false)
    expect(acceptDraft({ rule: 'arithmetic', coefficients: { d: 3000 }, values: [1, 3001, 6001, 9001, 12001, 15001] })).toBe(false)
    expect(acceptDraft({ rule: 'arithmetic', coefficients: { d: 0 }, values: [7, 7, 7, 7, 7, 7] })).toBe(false)
  })
})

describe('series verify: hand-built items', () => {
  const good = makeItem('arithmetic', { d: 3 }, [2, 5, 8, 11, 14, 17])
  const letter = makeItem('letter', { d: 3 }, [24, 1, 4, 7, 10, 13])

  it('accepts valid number and letter items', () => {
    expect(series.verify(good)).toMatchObject({ ok: true, reason: 'ok' })
    expect(letter.spec).toEqual({ input_format: 'letter', terms: ['X', 'A', 'D', 'G', 'J'] })
    expect(letter.key).toEqual({ letter: 'M' })
    expect(letter.difficulty.features.wraps).toBe(true)
    expect(series.verify(letter)).toMatchObject({ ok: true })
    expect(series.verify(makeItem('quadratic', { s: 2 }, [2, 6, 12, 20, 30, 42])).ok).toBe(true)
  })

  it('rejects malformed items without throwing', () => {
    expect(failed(tamper(good, (x) => (x.spec = null)))).toMatch(/well_formed/)
    expect(failed(tamper(good, (x) => (x.key = 'x')))).toMatch(/well_formed/)
    expect(failed(tamper(good, (x) => (x.structural_params = [1, 2])))).toMatch(/well_formed/)
    expect(failed(tamper(good, (x) => (x.difficulty = null)))).toMatch(/malformed/)
  })

  it('rejects malformed specs', () => {
    const spec = (s: unknown): SeriesItem => tamper(good, (x) => (x.spec = s))
    expect(failed(spec({ input_format: 'integer', terms: [2, 5, 8, 11] }))).toMatch(/spec_well_formed/)
    expect(failed(spec({ input_format: 'integer', terms: [2, 5, 8, 11, 14, 17, 20, 23] }))).toMatch(/spec_well_formed/)
    expect(failed(spec({ input_format: 'integer', terms: [2, 5, 8, 11, 10_001] }))).toMatch(/spec_well_formed/)
    expect(failed(spec({ input_format: 'integer', terms: [2, 5, 8.5, 11, 14] }))).toMatch(/spec_well_formed/)
    expect(failed(spec({ input_format: 'integer', terms: [2, 5, '8', 11, 14] }))).toMatch(/spec_well_formed/)
    expect(failed(spec({ input_format: 'decimal', terms: [2, 5, 8, 11, 14] }))).toMatch(/spec_well_formed/)
    expect(failed(spec({ input_format: 'integer', terms: [2, 5, 8, 11, 14], hint: '+3' }))).toMatch(/spec_well_formed/)
    const lspec = (terms: unknown[]): SeriesItem => tamper(letter, (x) => (x.spec = { input_format: 'letter', terms }))
    expect(failed(lspec(['X', 'A', 'd', 'G', 'J']))).toMatch(/spec_well_formed/)
    expect(failed(lspec(['X', 'A', 'DD', 'G', 'J']))).toMatch(/spec_well_formed/)
    expect(failed(lspec(['X', 'A', 4, 'G', 'J']))).toMatch(/spec_well_formed/)
  })

  it('rejects malformed keys', () => {
    const key = (k: unknown, base: SeriesItem = good): SeriesItem => tamper(base, (x) => (x.key = k))
    expect(failed(key({ value: 20, tol: 1 }))).toMatch(/key_well_formed/)
    expect(failed(key({ value: 20.5, tol: 0 }))).toMatch(/key_well_formed/)
    expect(failed(key({ value: 20_000, tol: 0 }))).toMatch(/key_well_formed/)
    expect(failed(key({ value: 20, tol: 0, letter: 'T' }))).toMatch(/key_well_formed/)
    expect(failed(key({ letter: 'm' }, letter))).toMatch(/key_well_formed/)
    expect(failed(key({ letter: 'MM' }, letter))).toMatch(/key_well_formed/)
    expect(failed(key({ value: 13, tol: 0 }, letter))).toMatch(/key_well_formed/)
  })

  it('rejects malformed or out-of-domain key rules', () => {
    const structure = (s: unknown, base: SeriesItem = good): SeriesItem => tamper(base, (x) => (x.structural_params = s))
    expect(failed(structure({ rule: 'mystery', coefficients: { d: 3 } }))).toMatch(/structure_well_formed/)
    expect(failed(structure({ rule: 'arithmetic', coefficients: { d: [3] } }))).toMatch(/structure_well_formed/)
    expect(failed(structure({ rule: 'arithmetic', coefficients: { d: 3 }, start: 2 }))).toMatch(/structure_well_formed/)
    expect(failed(structure({ rule: 'arithmetic', coefficients: { step: 3 } }))).toMatch(/coefficients_in_domain/)
    const flat = makeItem('arithmetic', { d: 0 }, [7, 7, 7, 7, 7, 7])
    expect(failed(flat)).toMatch(/coefficients_in_domain/)
    expect(failed(structure({ rule: 'letter', coefficients: { d: 3 } }))).toMatch(/format_matches_rule/)
    expect(failed(structure({ rule: 'arithmetic', coefficients: { d: 3 } }, letter))).toMatch(/format_matches_rule/)
  })

  it('rejects a key that is not the rule’s next term', () => {
    const r = failed(tamper(good, (x) => (x.key = { value: 21, tol: 0 })))
    expect(r).toMatch(/key_is_rule_prediction/)
    expect(r).not.toMatch(/key_rule_fits/)
    expect(failed(tamper(letter, (x) => (x.key = { letter: 'N' })))).toMatch(/key_is_rule_prediction/)
  })

  it('rejects a key rule that does not fit the terms', () => {
    expect(failed(tamper(good, (x) => (x.structural_params = { rule: 'arithmetic', coefficients: { d: 4 } })))).toMatch(/key_rule_fits/)
    expect(failed(tamper(good, (x) => (x.structural_params = { rule: 'geometric', coefficients: { r: 2 } })))).toMatch(/key_rule_fits/)
  })

  it('rejects ambiguous series: minimum-DL rules that predict different next terms', () => {
    const item = makeItem('fibonacci', { c: -3 }, [2, 4, 3, 4, 4, 5])
    const r = failed(item)
    expect(r).toMatch(/min_dl_rules_agree/)
    expect(r).not.toMatch(/key_rule_is_min_dl|key_rule_fits|key_is_rule_prediction/)
  })

  it('rejects a key rule that is not of minimal DL', () => {
    // 1, 4, 7, 10, 13 is arithmetic (8.3 bits), not the pricier alternating +3, +3
    const item = makeItem('composite_alt', { op_a: 'add', by_a: 3, op_b: 'add', by_b: 3 }, [1, 4, 7, 10, 13, 16])
    const r = failed(item)
    expect(r).toMatch(/key_rule_is_min_dl/)
    expect(r).not.toMatch(/min_dl_rules_agree/)
  })

  it('rejects a key rule that is not strictly simpler than the interpolating polynomial', () => {
    // interleaved 36, 27, 18 | 32, 21 → 10 costs 25.16 bits; the degree-4 interpolant 23.85
    const item = makeItem('interleaved', { da: -9, db: -11 }, [36, 32, 27, 21, 18, 10])
    const v = series.verify(item)
    expect(v.reason).toBe('failed: simpler_than_interpolant')
  })

  it('rejects features, priors, strata and times that do not match the v0 prior', () => {
    expect(failed(tamper(good, (x) => ((x.difficulty as { features: Record<string, unknown> }).features.max_digits = 3)))).toMatch(/features_match/)
    expect(failed(tamper(good, (x) => ((x.difficulty as { b_prior: number }).b_prior += 0.01)))).toMatch(/prior_matches/)
    expect(failed(tamper(good, (x) => ((x.difficulty as { sd_prior: number }).sd_prior = 0.5)))).toMatch(/prior_sd_matches/)
    expect(failed(tamper(good, (x) => (x.stratum = good.stratum === 1 ? 2 : 1)))).toMatch(/stratum_matches/)
    expect(failed(tamper(good, (x) => (x.expected_time_s = 30)))).toMatch(/expected_time_matches/)
    expect(failed(tamper(good, (x) => (x.options_count = 6)))).toMatch(/no_options/)
  })

  it('rejects stratum-6 priors (the family generates strata 1–5)', () => {
    const x = tamper(good, (y) => {
      ;(y.difficulty as { b_prior: number }).b_prior = 2.7
      y.stratum = 6
    })
    expect(series.verify(x).checks.stratum_matches).toBe(false)
  })
})

describe('series score', () => {
  const num = makeItem('arithmetic', { d: -4 }, [10, 6, 2, -2, -6, -10])
  const let_ = makeItem('letter', { d: 2 }, [1, 3, 5, 7, 9, 11])

  it('scores integers exactly (tol 0) from numbers or text', () => {
    expect(series.score(num, -10)).toEqual({ correct: 1 })
    expect(series.score(num, ' -10 ')).toEqual({ correct: 1 })
    expect(series.score(num, '−10')).toEqual({ correct: 1 })
    expect(series.score(num, -9)).toEqual({ correct: 0 })
    expect(series.score(num, '-10.0')).toEqual({ correct: 0 })
    expect(series.score(num, '')).toEqual({ correct: 0 })
    expect(series.score(num, Number.NaN)).toEqual({ correct: 0 })
    expect(series.score(num, -10.5)).toEqual({ correct: 0 })
    expect(parseIntegerResponse('+42')).toBe(42)
    expect(parseIntegerResponse('4 2')).toBeUndefined()
  })

  it('accepts upper- or lower-case letters', () => {
    expect(let_.key).toEqual({ letter: 'K' })
    expect(series.score(let_, 'K')).toEqual({ correct: 1 })
    expect(series.score(let_, 'k')).toEqual({ correct: 1 })
    expect(series.score(let_, ' k ')).toEqual({ correct: 1 })
    expect(series.score(let_, 'L')).toEqual({ correct: 0 })
    expect(series.score(let_, 'KK')).toEqual({ correct: 0 })
    expect(series.score(let_, 11)).toEqual({ correct: 0 })
    expect(parseLetterResponse('é')).toBeUndefined()
  })
})

describe('series prior (M1.P v0)', () => {
  it('is anchored at ICAR series p = .59', () => {
    expect(SERIES_PRIOR.anchorB).toBe(ICAR_ANCHOR_B.series)
    expect(SERIES_PRIOR.anchorB).toBeCloseTo(-0.364, 3)
  })

  it('orders families by complexity and puts features in the right direction', () => {
    const f = (rule: RuleName, c: Record<string, number | string>, v: number[]) => seriesDifficulty(seriesFeatures(rule, c, v)).b_prior
    const arith = f('arithmetic', { d: 3 }, [12, 15, 18, 21, 24, 27])
    const geo = f('geometric', { r: 2 }, [12, 24, 48, 96, 192, 384])
    const fib = f('fibonacci', { c: 0 }, [12, 15, 27, 42, 69, 111])
    const comp = f('composite_alt', { op_a: 'mul', by_a: 2, op_b: 'add', by_b: 3 }, [12, 24, 27, 54, 57, 114])
    expect(arith).toBeLessThan(geo)
    expect(geo).toBeLessThan(fib)
    expect(fib).toBeLessThan(comp)
    expect(f('arithmetic', { d: -3 }, [27, 24, 21, 18, 15, 12])).toBeGreaterThan(arith)
    expect(f('arithmetic', { d: 3 }, [12, 15, 18, 21, 24])).toBeGreaterThan(arith)
  })

  it('gives expected times of 20–45 s growing with complexity', () => {
    const t = (rule: RuleName, c: Record<string, number | string>, v: number[]) => seriesExpectedTime(seriesFeatures(rule, c, v))
    expect(t('arithmetic', { d: 1 }, [1, 2, 3, 4, 5, 6])).toBe(20)
    expect(t('composite_aff', { m: 2, c: 1 }, [1, 3, 7, 15, 31, 63])).toBe(38)
    expect(t('letter', { d: 1 }, [1, 2, 3, 4, 5, 6])).toBe(23)
  })

  it('keeps the spec to input_format and the visible terms', () => {
    const item = series.generate('leak')
    expect(seriesSpecLeaksKey(item)).toBeNull()
    const leaky = { ...item, spec: { ...item.spec, next: 1 } } as unknown as ItemInstance<SeriesSpec, SeriesKey>
    expect(seriesSpecLeaksKey(leaky)).toMatch(/next/)
  })
})
