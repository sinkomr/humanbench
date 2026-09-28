import { describe, expect, it } from 'vitest'
import { MalformedResponseError, NUMERIC_ITEM_TYPE, itemParamsFor, validateItemInstance, type AnyFamily, type ItemInstance } from '../family'
import { itemId, structuralHash } from '../ids'
import { ICAR_ANCHOR_B, powerTimeLimit, stratumOfB } from '../priors'
import { runFamilyProperties } from '../testing'
import { ANALYSIS_FIXTURE_N, analysisCase, analysisFixture, serializeAnalysisFixture } from './analysis-fixture'
import { SERIES_STRATA, acceptDraft, minVisibleFor, renderDraft, type Draft } from './gen'
import { series, seriesSpecLeaksKey, type SeriesItem, type SeriesKey, type SeriesSpec } from '.'
import { POOL_FEATURE_MEANS, SERIES_PRIOR, SERIES_PROVENANCE, seriesB, seriesDifficulty, seriesExpectedTime, seriesFeatures } from './prior'
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
  keyConfirmations,
  letterStep,
  toPosition,
  uniquenessChecks,
  type RuleName,
} from './rules'
import { parseIntegerResponse, parseLetterResponse, stripSpace } from './score'

/**
 * Digest (`structuralHash`) of `serializeAnalysisFixture()`, the TS → bank analysis fixture in the
 * bank's `golden/ts_dumps/series.analysis.json`. When `analyse()` or the fixture changes, refresh
 * the bank file with the command in `analysis-fixture.ts` and update this digest.
 */
const ANALYSIS_FIXTURE_DIGEST = '4842d55c344c'

/** A11 isomorph classes: family_id = rule + non-start coefficients, so ~1,700 families per 10k items. */
const FAMILY_ID_RATIO = {
  min: 0.1,
  reason: 'family_id = rule family + non-start coefficients (A11): e.g. every quadratic with 2nd difference 2 is one family',
}
/**
 * ~95.6% (natural mix) and ~94.3% (strata requested evenly) distinct at n = 10,000: letter series
 * have 1,248 possible contents (26 starts × 16 steps × 3 lengths), and the small-number
 * arithmetic/geometric series of strata 1–2 a few hundred to ~1,500 each.
 */
const CONTENT_RATIO = { min: 0.9, reason: 'letter series (1,248 possible) and small-number arithmetic/geometric strata have small content spaces' }

const correctResponse = (item: SeriesItem): string =>
  'letter' in item.key ? item.key.letter.toLowerCase() : ` ${item.key.value} `

/** A well-formed wrong answer: the next letter, or the key + 1 (as a number: numeric keypads send numbers). */
const incorrectResponse = (item: SeriesItem): string | number =>
  'letter' in item.key ? String.fromCharCode(((item.key.letter.charCodeAt(0) - 65 + 1) % 26) + 65) : Number(item.key.value) + 1

/** Malformed series responses (M1.F2): not text and not a finite number. */
const malformedResponses = (): unknown[] => [[], ['4'], Number.POSITIVE_INFINITY, { value: '4' }]

const OPTS = {
  specLeaksKey: seriesSpecLeaksKey,
  familyIdRatio: FAMILY_ID_RATIO,
  contentRatio: CONTENT_RATIO,
  correctResponse,
  incorrectResponse,
  malformedResponses,
} as const

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
    item_id: itemId('series', series.generatorVersion, seed),
    family_id: series.familyIdOf({ rule, coefficients }),
    sibling_group: series.familyIdOf({ rule, coefficients }),
    family: 'series',
    generator_version: series.generatorVersion,
    seed,
    axis: 'MAT',
    facet: 'series',
    item_type: NUMERIC_ITEM_TYPE,
    stratum,
    spec,
    key,
    structural_params: { rule, coefficients },
    params: itemParamsFor(undefined, 1, difficulty.b_prior),
    difficulty,
    expected_time_s: seriesExpectedTime(features),
    time_limit_s: powerTimeLimit(seriesExpectedTime(features)),
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

  it('passes runFamilyProperties at n = 10,000 over the natural pool (M1.P)', () => {
    const r = runFamilyProperties(series, OPTS)
    expect(r.n).toBe(10_000)
    for (const s of SERIES_STRATA) expect(r.strataCounts[s]).toBeGreaterThan(500)
    expect(r.strataCounts[6]).toBe(0)
    expect(r.bPrior.min).toBeLessThan(-1.5)
    expect(r.bPrior.max).toBeGreaterThan(1.5)
    // The pool mean is the ICAR series anchor: the prior is centred at the pool's feature means.
    expect(Math.abs(r.bPrior.mean - ICAR_ANCHOR_B.series)).toBeLessThan(0.1)
  }, 180_000)

  it('generates every rule family, numbers and letters, with 5–7 terms (interleaved 6–7)', () => {
    const rules = new Set<string>()
    const lengths = new Set<number>()
    const formats = new Set<string>()
    for (let i = 0; i < 2_000; i++) {
      const item = series.generate(`mix-${i}`)
      const rule = (item.structural_params as { rule: RuleName }).rule
      rules.add(rule)
      lengths.add(item.spec.terms.length)
      expect(item.spec.terms.length).toBeGreaterThanOrEqual(minVisibleFor(rule))
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
  it('is axis MAT, facet series, the shared entry item type "numeric" (as quant), strata 1–5', () => {
    expect(series.name).toBe('series')
    expect(series.axis).toBe('MAT')
    expect(series.kind).toBe('item')
    expect(series.facets).toEqual(['series'])
    expect(series.itemType).toBe('numeric')
    expect(series.itemType).toBe(NUMERIC_ITEM_TYPE)
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

  it('keys integers as the shared NumericKey { value: "<int>", tol: { abs: 0 } } and letters as { letter }', () => {
    for (let i = 0; i < 300; i++) {
      const item = series.generate(`keys-${i}`)
      if (item.spec.input_format === 'letter') {
        expect(Object.keys(item.key)).toEqual(['letter'])
        expect((item.key as { letter: string }).letter).toMatch(/^[A-Z]$/)
        for (const t of item.spec.terms) expect(t).toMatch(/^[A-Z]$/)
      } else {
        const value = (item.key as { value: string }).value
        expect(item.key).toEqual({ value, tol: { abs: 0 } })
        expect(value).toMatch(/^(?:0|-?[1-9][0-9]*)$/)
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

  it('puts fits within ε (but not tied) of the minimum into the minimum-DL set', () => {
    // interleaved 3, 0, −3 | 1, −1 → −3 costs 14.58 bits; the cubic → −7 one bit more
    const a = analyse([3, 1, 0, -1, -3], false)
    expect(a.predictions).toEqual([-7, -3])
    expect(new Set(a.minSet.map((f) => f.rule))).toEqual(new Set(['interleaved', 'cubic']))
    const cubic = a.minSet.find((f) => f.rule === 'cubic')!
    expect(compareDl(cubic.dl, a.min!)).toBe(1)
    expect(compareDl(cubic.dl, a.min!, 1)).toBe(0)
    // cubic → 43 (24.22 bits) and interleaved → 75 (24.73 bits)
    expect(analyse([58, 55, 60, 65, 62], false).predictions).toEqual([43, 75])
  })

  it('counts the visible terms that confirm the part of the key rule producing t_m', () => {
    expect([5, 6, 7].map((m) => keyConfirmations('interleaved', m))).toEqual([0, 1, 1])
    expect([5, 6, 7].map((m) => keyConfirmations('composite_alt', m))).toEqual([1, 1, 2])
    expect([5, 6, 7].map((m) => keyConfirmations('arithmetic', m))).toEqual([3, 4, 5])
    expect(keyConfirmations('quadratic', 5)).toBe(2)
    expect(keyConfirmations('fibonacci', 5)).toBe(2)
    expect(keyConfirmations('composite_aff', 5)).toBe(2)
    for (const rule of RULE_NAMES) expect(minVisibleFor(rule)).toBe(rule === 'interleaved' ? 6 : 5)
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
    expect(acceptDraft({ rule: 'interleaved', coefficients: { da: -8, db: -8 }, values: [43, 4, 35, -4, 27, -12] })).toBe(false)
    expect(acceptDraft({ rule: 'interleaved', coefficients: { da: 2, db: 3 }, values: [3, 10, 5, 13, 7, 16, 9] })).toBe(true)
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
    expect(series.verify(makeItem('interleaved', { da: 2, db: 3 }, [3, 10, 5, 13, 7, 16, 9])).ok).toBe(true)
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
    expect(series.verify(key({ value: '17', tol: { abs: 0 } })).ok).toBe(true)
    expect(failed(key({ value: '20', tol: { abs: 1 } }))).toMatch(/key_well_formed/)
    expect(failed(key({ value: '20', tol: { rel: 0 } }))).toMatch(/key_well_formed/)
    expect(failed(key({ value: '20', tol: { abs: 0, rel: 0 } }))).toMatch(/key_well_formed/)
    expect(failed(key({ value: '20', tol: 0 }))).toMatch(/key_well_formed/)
    expect(failed(key({ value: 20, tol: { abs: 0 } }))).toMatch(/key_well_formed/) // the pre-1.1.0 number shape
    expect(failed(key({ value: '20.5', tol: { abs: 0 } }))).toMatch(/key_well_formed/)
    expect(failed(key({ value: '41/2', tol: { abs: 0 } }))).toMatch(/key_well_formed/)
    expect(failed(key({ value: '+20', tol: { abs: 0 } }))).toMatch(/key_well_formed/)
    expect(failed(key({ value: '020', tol: { abs: 0 } }))).toMatch(/key_well_formed/)
    expect(failed(key({ value: '-0', tol: { abs: 0 } }))).toMatch(/key_well_formed/)
    expect(failed(key({ value: '20000', tol: { abs: 0 } }))).toMatch(/key_well_formed/)
    expect(failed(key({ value: '20', tol: { abs: 0 }, letter: 'T' }))).toMatch(/key_well_formed/)
    expect(failed(key({ letter: 'm' }, letter))).toMatch(/key_well_formed/)
    expect(failed(key({ letter: 'MM' }, letter))).toMatch(/key_well_formed/)
    expect(failed(key({ value: '13', tol: { abs: 0 } }, letter))).toMatch(/key_well_formed/)
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
    const r = failed(tamper(good, (x) => (x.key = { value: '21', tol: { abs: 0 } })))
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

  it('rejects fits inside the ε band that disagree, although the key rule alone is the minimum', () => {
    // Fibonacci-type c = −5 → 39 (16.21 bits) vs the cubic → 38 (16.75 bits): 0.54 bits apart
    const item = makeItem('fibonacci', { c: -5 }, [8, 10, 13, 18, 26, 39])
    expect(series.verify(item).reason).toBe('failed: min_dl_rules_agree')
    const a = analyse([8, 10, 13, 18, 26], false)
    const cubic = a.fits.find((f) => f.rule === 'cubic')!
    expect(cubic.next).toBe(38)
    expect(compareDl(cubic.dl, a.min!)).toBe(1)
    expect(compareDl(cubic.dl, a.min!, EPSILON_BITS)).toBe(-1)
  })

  it('rejects an interleaved key resting on a two-term subsequence (m = 5)', () => {
    // t_5 continues 4, −4 (t_1, t_3) only: any step fits two terms, and "flip the sign" gives 4
    expect(series.verify(makeItem('interleaved', { da: -8, db: -8 }, [43, 4, 35, -4, 27, -12])).reason).toBe('failed: key_rule_confirmed')
    expect(series.verify(makeItem('interleaved', { da: -6, db: -6 }, [13, -3, 7, -9, 1, -15])).reason).toBe('failed: key_rule_confirmed')
  })

  it('rejects a key rule that is not of minimal DL', () => {
    // 1, 4, 7, 10, 13 is arithmetic (8.3 bits), not the pricier alternating +3, +3
    const item = makeItem('composite_alt', { op_a: 'add', by_a: 3, op_b: 'add', by_b: 3 }, [1, 4, 7, 10, 13, 16])
    const r = failed(item)
    expect(r).toMatch(/key_rule_is_min_dl/)
    expect(r).not.toMatch(/min_dl_rules_agree/)
  })

  it('pins simpler_than_interpolant as STRICT: a key rule whose DL ties the interpolant fails (M1.F2)', () => {
    // −7 ×5 is Fibonacci-type with c = 7 (t + t' + 7 = −7): DL = 7 bits + log2(8·8·8) = 16, and the
    // degree-4 interpolant (−7, 0, 0, 0, 0) = 13 bits + log2(8) = 16. An exact tie: `<` rejects it,
    // the `<=` mutant would accept it. One step down (c = 6 on −6 ×5: 7 + log2 343 ≈ 15.42 vs
    // 13 + log2 7 ≈ 15.81) is strictly simpler and passes.
    const tie = analyse([-7, -7, -7, -7, -7], false)
    const tieFit = tie.fits.find((f) => f.rule === 'fibonacci' && f.coefficients.c === 7)
    expect(tieFit).toBeDefined()
    expect(compareDl(tieFit!.dl, tie.interpolant)).toBe(0)
    expect(uniquenessChecks(tie, { rule: 'fibonacci', coefficients: { c: 7 } }, -7).simpler_than_interpolant).toBe(false)
    const below = analyse([-6, -6, -6, -6, -6], false)
    const belowFit = below.fits.find((f) => f.rule === 'fibonacci' && f.coefficients.c === 6)
    expect(compareDl(belowFit!.dl, below.interpolant)).toBe(-1)
    expect(uniquenessChecks(below, { rule: 'fibonacci', coefficients: { c: 6 } }, -6).simpler_than_interpolant).toBe(true)
  })

  it('rejects a key rule that is not strictly simpler than the interpolating polynomial', () => {
    // interleaved 900, 903, 906 | 901, 905, 909 → 909 costs 31.95 bits; the degree-5 interpolant 31.14
    const item = makeItem('interleaved', { da: 3, db: 4 }, [900, 901, 903, 905, 906, 909, 909])
    const v = series.verify(item)
    expect(v.reason).toBe('failed: simpler_than_interpolant')
  })

  it('rejects features, priors, strata and times that do not match the v0 prior', () => {
    expect(failed(tamper(good, (x) => ((x.difficulty as { features: Record<string, unknown> }).features.max_digits = 3)))).toMatch(/features_match/)
    expect(failed(tamper(good, (x) => ((x.difficulty as { b_prior: number }).b_prior += 0.01)))).toMatch(/prior_matches/)
    expect(failed(tamper(good, (x) => ((x.difficulty as { sd_prior: number }).sd_prior = 0.5)))).toMatch(/prior_sd_matches/)
    expect(failed(tamper(good, (x) => ((x.difficulty as { provenance: string }).provenance = 'hand-tuned')))).toBe('failed: provenance_matches')
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
    expect(series.score(num, -10.5)).toEqual({ correct: 0 })
    // Not text and not a finite number: malformed (M1.F2), not a wrong answer.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, null, undefined, true, [-10], { value: '-10' }]) {
      expect(() => series.score(num, bad as never), String(bad)).toThrow(MalformedResponseError)
      expect(() => series.score(let_, bad as never), String(bad)).toThrow(RangeError)
    }
    expect(parseIntegerResponse('+42')).toBe(42)
    expect(parseIntegerResponse('4 2')).toBeUndefined()
  })

  it('strips the same edge space as the bank scorer (JS \\s, not Python str.strip())', () => {
    // U+FEFF is space to JS trim() but not to str.strip(); U+001C and U+0085 the other way round
    expect(series.score(num, '\ufeff-10')).toEqual({ correct: 1 })
    expect(series.score(num, '-10\u3000\n')).toEqual({ correct: 1 })
    expect(series.score(num, '\u001c-10')).toEqual({ correct: 0 })
    expect(series.score(num, '\u0085-10')).toEqual({ correct: 0 })
    expect(series.score(num, '-10\u001f')).toEqual({ correct: 0 })
    expect(series.score(let_, '\ufeffk')).toEqual({ correct: 1 })
    expect(series.score(let_, '\u001ck')).toEqual({ correct: 0 })
    expect(series.score(let_, 'k\u0085')).toEqual({ correct: 0 })
    expect(stripSpace(' \t\u00a0 7 \u2028')).toBe('7')
    expect(stripSpace('7 7')).toBe('7 7')
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
  it('is anchored at ICAR series p = .59 as the pool mean: the centres are the natural pool means (M1.P)', () => {
    expect(SERIES_PRIOR.anchorB).toBe(ICAR_ANCHOR_B.series)
    expect(SERIES_PRIOR.anchorB).toBeCloseTo(-0.364, 3)
    for (const [k, t] of Object.entries(SERIES_PRIOR.terms)) expect(t.centre, k).toBe(POOL_FEATURE_MEANS[k as keyof typeof POOL_FEATURE_MEANS])
    // The item at the pool-mean features (a composite of the natural mix) sits at the anchor.
    expect(seriesB({ rule: 'quadratic', ...POOL_FEATURE_MEANS } as never)).toBeCloseTo(ICAR_ANCHOR_B.series, 12)
    // The pre-1.3.0 reference item 2, 3, 5, 8, 12, 17 → 23 (a cost-4 rule, 6 terms, 2 digits,
    // ascending) now sits below the anchor: the natural pool is harder than it.
    const ref = makeItem('quadratic', { s: 1 }, [2, 3, 5, 8, 12, 17, 23])
    expect(series.verify(ref).ok).toBe(true)
    expect(ref.difficulty.b_prior).toBeLessThan(ICAR_ANCHOR_B.series)
    expect(ref.difficulty.provenance).toBe(SERIES_PROVENANCE)
  })

  it('re-estimates the pool feature means within rounding over 20,000 natural draws', () => {
    // The centres were estimated over 100,000 draws (seed "natural"); an independent 20,000
    // agree within 4 SEs of each mean (and the pool mean b within 0.1 of the anchor, below).
    const sums: Record<string, number> = {}
    const n = 20_000
    let sumB = 0
    for (let i = 0; i < n; i++) {
      const item = series.generate(`centres-${i}`)
      sumB += item.difficulty.b_prior
      for (const k of Object.keys(POOL_FEATURE_MEANS)) sums[k] = (sums[k] ?? 0) + Number(item.difficulty.features[k])
    }
    const tol: Record<string, number> = { family_cost: 0.04, max_digits: 0.04, visible_terms: 0.03, has_negative: 0.02, descending: 0.02, wraps: 0.01, is_letter: 0.01 }
    for (const [k, want] of Object.entries(POOL_FEATURE_MEANS)) expect(Math.abs((sums[k] as number) / n - want), k).toBeLessThan(tol[k] as number)
    expect(Math.abs(sumB / n - ICAR_ANCHOR_B.series)).toBeLessThan(0.05)
  }, 120_000)

  it('counts a letter as one symbol, whatever its alphabet position', () => {
    const early = seriesFeatures('letter', { d: 1 }, [1, 2, 3, 4, 5, 6])
    const late = seriesFeatures('letter', { d: 1 }, [18, 19, 20, 21, 22, 23])
    expect(early.max_digits).toBe(1)
    expect(late.max_digits).toBe(1)
    expect(seriesB(late)).toBe(seriesB(early))
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

describe('series analysis fixture (TS → bank differential, A1)', () => {
  it('is pinned: refresh the bank copy when analyse() changes', () => {
    expect(structuralHash(serializeAnalysisFixture())).toBe(ANALYSIS_FIXTURE_DIGEST)
  }, 60_000)

  it('covers accepted and rejected sequences, ties, the ε band, letters and every fit family', () => {
    const f = analysisFixture()
    expect(f.count).toBe(f.cases.length)
    expect(f.cases.length).toBeGreaterThan(ANALYSIS_FIXTURE_N)
    const rules = new Set(f.cases.flatMap((c) => c.fits.map((x) => x.rule)))
    expect([...rules].sort()).toEqual([...RULE_NAMES, 'cubic'].sort())
    const ambiguous = f.cases.filter((c) => c.predictions.length > 1).length
    const unique = f.cases.filter((c) => c.predictions.length === 1).length
    const none = f.cases.filter((c) => c.min_dl === null).length
    const letters = f.cases.filter((c) => c.letter).length
    for (const count of [ambiguous, unique, none, letters]) expect(count).toBeGreaterThan(50)
    // a fit inside the ε band but not tied with the minimum
    expect(analysisCase([3, 1, 0, -1, -3], false).fits.filter((x) => x.in_min_set).map((x) => x.rule).sort()).toEqual(['cubic', 'interleaved'])
  }, 60_000)
})
