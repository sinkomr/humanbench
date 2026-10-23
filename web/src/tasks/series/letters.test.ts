/**
 * Series generator 1.5.0: letter series of any rule family (DESIGN §4.2 "Series", §3 row 1
 * "letter/number series"). Letter templates (`gen.ts` LETTER_TEMPLATES) are drawn only for
 * requested strata 2–6, one item in four; the natural pool and stratum 1 are those of 1.4.0, and
 * 1.4.0 and 1.3.0 are kept whole (`SERIES_LEGACY_FAMILIES`).
 */

import { describe, expect, it } from 'vitest'
import { NUMERIC_ITEM_TYPE, itemParamsFor, type AnyFamily, type JsonObject, validateItemInstance } from '../family'
import { canonicalJson, itemId, structuralHash } from '../ids'
import { powerTimeLimit, stratumOfB } from '../priors'
import { generatorOf, resolveItem } from '../registry'
import { runFamilyProperties } from '../testing'
import { seriesSolution } from '../../reveal/worked/series'
import legacy140 from './__fixtures__/legacy-1.4.0.json'
import { LETTER_MENUS, LETTER_MENU_SHARE, LETTER_TEMPLATES, acceptDraft, minVisibleFor, renderDraft, sampleTemplate, type Draft } from './gen'
import { SERIES_LEGACY_FAMILIES, series, seriesSpecLeaksKey, type SeriesItem } from '.'
import { seriesDifficulty, seriesExpectedTime, seriesFeatures } from './prior'
import { allowsLetterRules, analyse, type RuleName } from './rules'
import { createRng } from '../../engine'

type Mutable = { -readonly [K in keyof SeriesItem]: unknown }

const v140 = SERIES_LEGACY_FAMILIES['1.4.0']
const v130 = SERIES_LEGACY_FAMILIES['1.3.0']

/** A full 1.5.0 item for a hand-built letter series (positions, the key last); `letters` unless the rule is `letter`. */
function letterItem(rule: RuleName, coefficients: Record<string, number | string>, values: readonly number[], version: string = series.generatorVersion): SeriesItem {
  const letters = rule !== 'letter'
  const draft: Draft = letters ? { rule, coefficients, values, letters: true } : { rule, coefficients, values }
  const features = seriesFeatures(rule, coefficients, values, true)
  const difficulty = seriesDifficulty(features)
  const structure: JsonObject = letters ? { rule, coefficients, letters: true } : { rule, coefficients }
  const seed = `hand-letters-${rule}-${values.join('_')}`
  const { spec, key } = renderDraft(draft)
  return {
    item_id: itemId('series', version, seed),
    family_id: series.familyIdOf(structure),
    sibling_group: series.familyIdOf(structure),
    family: 'series',
    generator_version: version,
    seed,
    axis: 'MAT',
    facet: 'series',
    item_type: NUMERIC_ITEM_TYPE,
    stratum: stratumOfB(difficulty.b_prior),
    spec,
    key,
    structural_params: structure,
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

const failed = (item: SeriesItem, family: AnyFamily = series as unknown as AnyFamily): string => {
  const v = family.verify(item)
  expect(v.ok).toBe(false)
  return v.reason
}

const isTemplate = (item: SeriesItem): boolean => item.spec.input_format === 'letter' && (item.structural_params as { letters?: true }).letters === true

/** The worked examples of the brief and DESIGN §4.2, one per letter template. */
const EXAMPLES: readonly (readonly [RuleName, Record<string, number | string>, readonly number[], string, string])[] = [
  ['quadratic', { s: 1 }, [1, 2, 4, 7, 11, 16, 22], 'A B D G K P', 'V'],
  ['interleaved', { da: 1, db: -1 }, [1, 26, 2, 25, 3, 24, 4], 'A Z B Y C X', 'D'],
  // B D E G H J is also two strands of +3, but +2, +1 in turn is shorter: the analysis keys that
  ['composite_alt', { op_a: 'add', by_a: 2, op_b: 'add', by_b: 1 }, [2, 4, 5, 7, 8, 10, 11], 'B D E G H J', 'K'],
  ['composite_alt', { op_a: 'add', by_a: 2, op_b: 'add', by_b: -1 }, [1, 3, 2, 4, 3, 5, 4], 'A C B D C E', 'D'],
  ['fibonacci', { c: 0 }, [1, 2, 3, 5, 8, 13, 21], 'A B C E H M', 'U'],
  ['cycle3', { op_a: 'add', by_a: 2, op_b: 'mul', by_b: 2, op_c: 'add', by_c: -4 }, [1, 3, 6, 2, 4, 8, 4, 6], 'A C F B D H D', 'F'],
  ['letter', { d: -9 }, [25, 16, 7, 24, 15, 6], 'Y P G X O', 'F'],
]

describe('series 1.5.0 letter templates: examples', () => {
  it.each(EXAMPLES)('%s %j: %s → %s verifies, and the worked solution reaches the key', (rule, c, values, shown, next) => {
    const item = letterItem(rule, c, values)
    expect(item.spec).toEqual({ input_format: 'letter', terms: shown.split(' ') })
    expect(item.key).toEqual({ letter: next })
    expect(series.verify(item)).toMatchObject({ ok: true })
    expect(validateItemInstance(item, series as unknown as AnyFamily)).toEqual([])
    expect(seriesSolution(item).exact).toBe(next)
    expect(seriesSolution(item).steps[0]).toMatch(/place in the alphabet/)
    // Letters for the prior: one symbol, never negative, wraps only for the rule `letter`.
    expect(item.difficulty.features).toMatchObject({ is_letter: true, max_digits: 1, has_negative: false, wraps: rule === 'letter' })
    // Not an item of 1.4.0 or 1.3.0 (letters flag unknown there); the rule `letter` is.
    if (rule !== 'letter') {
      expect(v140.verify({ ...item, generator_version: '1.4.0' }).checks.structure_well_formed).toBe(false)
      expect(v130.verify({ ...item, generator_version: '1.3.0' }).ok).toBe(false)
    }
  })

  it('gives a letter series and a number series of one rule different families; letter isomorphs share one (A11)', () => {
    const a = letterItem('quadratic', { s: 1 }, [1, 2, 4, 7, 11, 16, 22])
    const b = letterItem('quadratic', { s: 1 }, [3, 4, 6, 9, 13, 18, 24])
    expect(a.family_id).toBe(b.family_id)
    expect(a.family_id).not.toBe(series.familyIdOf({ rule: 'quadratic', coefficients: { s: 1 } }))
  })

  it('puts the letter terms of the prior on every letter series (generalised from the rule `letter`)', () => {
    const asNumbers = seriesFeatures('quadratic', { s: 1 }, [1, 2, 4, 7, 11, 16, 22])
    const asLetters = seriesFeatures('quadratic', { s: 1 }, [1, 2, 4, 7, 11, 16, 22], true)
    expect(asNumbers).toMatchObject({ is_letter: false, max_digits: 2 })
    expect(asLetters).toMatchObject({ is_letter: true, max_digits: 1, descending: false, wraps: false })
    expect(seriesExpectedTime(asLetters)).toBe(seriesExpectedTime(asNumbers) - 2 + 3)
    // descending: the key's position below the last one
    expect(seriesFeatures('interleaved', { da: 1, db: -1 }, [1, 26, 2, 25, 3, 24, 4], true).descending).toBe(true)
    // the rule `letter` keeps its own reading (step sign, wraps), as in 1.4.0
    expect(seriesFeatures('letter', { d: -9 }, [25, 16, 7, 24, 15, 6])).toMatchObject({ descending: true, wraps: true, is_letter: true })
  })
})

describe('series 1.5.0 letter templates: tampering', () => {
  const quad = letterItem('quadratic', { s: 1 }, [1, 2, 4, 7, 11, 16, 22])

  it('rejects a wrong key letter', () => {
    expect(failed(tamper(quad, (x) => (x.key = { letter: 'W' })))).toMatch(/key_is_rule_prediction/)
    expect(failed(tamper(quad, (x) => (x.key = { letter: 'v' })))).toMatch(/key_well_formed/)
  })

  it('rejects a broken structure: flag missing, wrong, on a number series or on the rule `letter`', () => {
    expect(failed(tamper(quad, (x) => (x.structural_params = { rule: 'quadratic', coefficients: { s: 1 } })))).toMatch(/format_matches_rule/)
    expect(failed(tamper(quad, (x) => (x.structural_params = { rule: 'quadratic', coefficients: { s: 1 }, letters: 'yes' })))).toMatch(/structure_well_formed/)
    expect(failed(tamper(quad, (x) => (x.structural_params = { rule: 'quadratic', coefficients: { s: 1 }, letters: false })))).toMatch(/structure_well_formed/)
    expect(failed(tamper(quad, (x) => (x.structural_params = { rule: 'quadratic', coefficients: { s: 2 }, letters: true })))).toMatch(/key_rule_fits/)
    const wide = letterItem('letter', { d: -9 }, [25, 16, 7, 24, 15, 6])
    expect(failed(tamper(wide, (x) => (x.structural_params = { rule: 'letter', coefficients: { d: -9 }, letters: true })))).toMatch(/structure_well_formed/)
    const numbers = tamper(quad, (x) => {
      x.spec = { input_format: 'integer', terms: [1, 2, 4, 7, 11, 16] }
      x.key = { value: '22', tol: { abs: 0 } }
    })
    expect(failed(numbers)).toMatch(/format_matches_rule/)
  })

  it('rejects swapped terms and features that are not those of a letter series', () => {
    expect(failed(tamper(quad, (x) => (x.spec = { input_format: 'letter', terms: ['A', 'B', 'G', 'D', 'K', 'P'] })))).toMatch(/key_rule_fits/)
    expect(failed(tamper(quad, (x) => ((x.difficulty as { features: Record<string, unknown> }).features.is_letter = false)))).toMatch(/features_match/)
  })

  it('rejects a key the rule reaches only by wrapping past Z (only the rule `letter` counts mod 26)', () => {
    // J L O S X = 10, 12, 15, 19, 24: the quadratic gives 30, read as D only mod 26
    const wrapped = letterItem('quadratic', { s: 1 }, [10, 12, 15, 19, 24, 30])
    expect(wrapped.key).toEqual({ letter: 'D' })
    expect(analyse([10, 12, 15, 19, 24], true).predictions).toContain(4)
    const v = series.verify(wrapped)
    expect(v.ok).toBe(false)
    expect(v.checks.key_unwrapped).toBe(false)
    expect(acceptDraft({ rule: 'quadratic', coefficients: { s: 1 }, values: [10, 12, 15, 19, 24, 30], letters: true })).toBe(false)
  })

  it('never draws a ×2 strand on letters, and a cycle’s blank always follows an addition (blind panel)', () => {
    // A B D (×2 → H) reads as well as growing additions (+1, +2 → G): no letter template draws it
    expect(Object.values(LETTER_MENUS).flat().map(([t]) => t)).not.toContain('letter_interleaved_ops')
    const rng = createRng('panel-cycle3')
    for (let i = 0; i < 300; i++) expect(sampleTemplate(rng, 'letter_cycle3').coefficients.op_a).toBe('add')
    for (let i = 0; i < 400; i++) {
      const item = series.generate(`panel-${i}`, { stratum: ([4, 5, 6] as const)[i % 3] })
      if (isTemplate(item)) expect((item.structural_params as { rule: string }).rule).not.toBe('interleaved_ops')
    }
  })

  it('accepts letter drafts only in 1.5.0', () => {
    const draft: Draft = { rule: 'quadratic', coefficients: { s: 1 }, values: [1, 2, 4, 7, 11, 16, 22], letters: true }
    expect(acceptDraft(draft)).toBe(true)
    expect(acceptDraft(draft, '1.4.0')).toBe(false)
    expect(acceptDraft(draft, '1.3.0')).toBe(false)
    expect([allowsLetterRules('1.3.0'), allowsLetterRules('1.4.0'), allowsLetterRules('1.5.0')]).toEqual([false, false, true])
  })
})

describe('series 1.5.0 letter templates: generation', () => {
  it('every template draws positions 1–26 with the visible terms its rule needs', () => {
    const rng = createRng('letter-templates')
    for (const t of LETTER_TEMPLATES) {
      for (let i = 0; i < 200; i++) {
        const d = sampleTemplate(rng, t)
        expect(d.values.every((p) => p >= 1 && p <= 26), `${t} ${d.values.join(',')}`).toBe(true)
        expect(d.values.length - 1).toBeGreaterThanOrEqual(minVisibleFor(d.rule))
        expect(d.letters === true).toBe(t !== 'letter_wide')
      }
    }
  })

  it('passes runFamilyProperties at n = 10,000 over the requested strata 2–6, one item in four a letter template', () => {
    const r = runFamilyProperties(series, {
      specLeaksKey: seriesSpecLeaksKey,
      familyIdRatio: { min: 0.1, reason: 'family_id = rule family + non-start coefficients (A11)' },
      // ~89.7% distinct: a letter template has a few hundred contents per stratum (26 positions, small steps)
      contentRatio: { min: 0.85, reason: 'letter templates (positions 1–26) and small-number strata have small content spaces' },
      correctResponse: (it: SeriesItem) => ('letter' in it.key ? it.key.letter.toLowerCase() : it.key.value),
      incorrectResponse: (it: SeriesItem) => ('letter' in it.key ? String.fromCharCode(((it.key.letter.charCodeAt(0) - 64) % 26) + 65) : Number(it.key.value) + 1),
      strata: [2, 3, 4, 5, 6],
      seedPrefix: 'letters-',
    })
    expect(r.n).toBe(10_000)
    expect(r.strataCounts).toEqual({ 1: 0, 2: 2_000, 3: 2_000, 4: 2_000, 5: 2_000, 6: 2_000 })
  }, 240_000)

  it('draws each stratum’s letter templates, about a quarter of its items, each where its prior lands', () => {
    const n = 800
    const ruleOf: Record<string, string> = { letter_quadratic: 'quadratic', letter_interleaved: 'interleaved', letter_fibonacci: 'fibonacci', letter_alt: 'composite_alt', letter_cycle3: 'cycle3' }
    for (const s of [2, 3, 4, 5, 6] as const) {
      const want = new Set(LETTER_MENUS[s]!.map(([t]) => ruleOf[t]).filter((r) => r !== undefined))
      const rules = new Set<string>()
      let templates = 0
      for (let i = 0; i < n; i++) {
        const item = series.generate(`share-${i}`, { stratum: s })
        if (!isTemplate(item)) continue
        templates++
        rules.add((item.structural_params as { rule: string }).rule)
        expect(item.stratum).toBe(s)
      }
      // `letter_wide` items carry the rule `letter` (no flag), so stratum 2 counts a little below a quarter
      expect(Math.abs(templates / n - LETTER_MENU_SHARE), `stratum ${s}: ${templates}`).toBeLessThan(0.06)
      expect([...rules].sort(), `stratum ${s}`).toEqual([...want].sort())
    }
  }, 120_000)

  it('keeps the natural pool and stratum 1 of 1.4.0 byte for byte (but the version)', () => {
    const strip = (x: SeriesItem): string => canonicalJson({ ...x, item_id: '', generator_version: '' })
    for (let i = 0; i < 1_500; i++) {
      for (const suffix of ['', '@s1']) expect(strip(series.generate(`nat-${i}${suffix}`))).toBe(strip(v140.generate(`nat-${i}${suffix}`)))
    }
    for (let i = 0; i < 300; i++) expect(isTemplate(series.generate(`nat-${i}`))).toBe(false)
  }, 60_000)
})

describe('series: the kept 1.4.0 generator (A11, R-8.1)', () => {
  it('is reached through generatorOf and refuses letter templates', () => {
    expect(v140.generatorVersion).toBe('1.4.0')
    expect(v140.strata).toEqual([1, 2, 3, 4, 5, 6])
    expect(generatorOf('series', '1.4.0')).toBe(v140)
    for (let i = 0; i < 300; i++) for (const s of [2, 4, 6] as const) expect(isTemplate(v140.generate(`old-${i}`, { stratum: s }))).toBe(false)
  })

  it('rebuilds the 1,000 items of the 1.4.0 dump byte for byte through resolveItem', () => {
    const lines: string[] = []
    for (let i = 0; i < legacy140.count; i++) {
      const item = resolveItem(`i:series:1.4.0:dump-${i}`)
      expect(item).not.toBeNull()
      lines.push(canonicalJson(item))
    }
    expect(lines.slice(0, 3)).toEqual(legacy140.items.map((x) => canonicalJson(x)))
    expect(structuralHash(lines.join('\n'))).toBe(legacy140.digest)
    for (const x of legacy140.items) expect(v140.verify(x as unknown as SeriesItem).ok).toBe(true)
  }, 60_000)

  it('rebuilds 1.4.0 strata 1–6 and its natural pool as the 1.4.0 code did (pinned digest)', () => {
    // Digest computed with the 1.4.0 source of this directory, before generator 1.5.0.
    const lines: string[] = []
    for (const suffix of ['', '@s1', '@s2', '@s3', '@s4', '@s5', '@s6']) {
      for (let i = 0; i < 50; i++) lines.push(canonicalJson(resolveItem(`i:series:1.4.0:legacy-${i}${suffix}`)))
    }
    expect(structuralHash(lines.join('\n'))).toBe('cc1b052c76ee')
  }, 60_000)
})
