import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { coding, codingSpecLeaksKey } from './coding'
import { codingInvalidResponse, codingMalformedResponses, codingValidResponse } from './coding/synthetic'
import { NUMERIC_ITEM_TYPE, kindOfModel, validateItemInstance, type AnyFamily, type ProceduralFamily } from './family'
import { FAMILY_NAME_RE, GENERATOR_VERSION_RE, STRATA, isPyTwinVersion, parseItemId } from './ids'
import { matrices, matricesSpecLeaksKey } from './matrices'
import { stratumOfB } from './priors'
import { QUANT_TEMPLATES, quant, quantSpecLeaksKey } from './quant'
import { reading, type ReadingKey, type ReadingSpec } from './reading'
import { readingInvalidResponse, readingMalformedResponses, readingValidResponse } from './reading/synthetic'
import { Fraction } from './quant/fraction'
import { FAMILIES, FAMILY_NAMES, getFamily, resolveItem } from './registry'
import { rotation } from './rotation'
import { rotationSpecLeaksKey } from './rotation/verify'
import { RT_SPEC_FIELDS, rtChoice4, rtSimple, type RtKey, type RtSpec } from './rt'
import { rtInvalidResponse, rtMalformedResponses, rtValidResponse } from './rt/synthetic'
import { series, seriesSpecLeaksKey, type SeriesItem } from './series'
import { SPAN_BWD, SPAN_CORSI, SPAN_FWD, corsi, spanBwd, spanFwd, spanSpecLeaksKey } from './span'
import { spanInvalidResponse, spanMalformedResponses, spanValidResponse } from './span/synthetic'
import { onlySpecFields, runFamilyProperties, type FamilyPropertyOptions, type FamilyPropertyReport } from './testing'

const entries = Object.entries(FAMILIES)

/** Instances per family in the registration check; each family's own suite runs 10,000 (§14.3 M1). */
const REGISTRATION_N = 500

/** A registration check: the family object it is for, and its property suite over its strata at n. */
interface Check {
  readonly family: object
  readonly run: (n: number) => FamilyPropertyReport
}

const check = <S extends object, K extends object, R>(family: ProceduralFamily<S, K, R>, opts: FamilyPropertyOptions<S, K, R>): Check => ({
  family,
  run: (n) => runFamilyProperties(family, { ...opts, n, strata: family.strata, seedPrefix: 'registry-' }),
})

/*
 * Property options per registered family, mirroring each family's own suite (the waivers and
 * ratio overrides carry the same documented reasons; the leak predicates are the families' own).
 * A family added to the registry without an entry here fails the first test below.
 */
const SPAN_KEY_IN_SPEC = 'span blocks present their stimuli, which are the key (forward digits, Corsi) or its reversal (backward digits) by design (§14.6 ex. 10–11)'
const READING_SPEC_FIELDS = ['passage_id', 'paragraphs', 'word_count', 'source', 'questions'] as const
const SPAN_RESPONSES = { validResponse: spanValidResponse, invalidResponse: spanInvalidResponse, malformedResponses: spanMalformedResponses } as const
const RT_OPTS = {
  allowKeyInSpec: 'choice-RT stimulus positions are the key by design (§14.6 ex. 12)',
  familyIdRatio: { min: 1 / REGISTRATION_N, reason: 'one structure per RT family: blocks differing only in jitter are isomorphs (A11)' },
  specLeaksKey: onlySpecFields<RtSpec, RtKey>(...RT_SPEC_FIELDS),
  validResponse: rtValidResponse,
  invalidResponse: rtInvalidResponse,
  malformedResponses: rtMalformedResponses,
} as const

const CHECKS: Readonly<Record<string, Check>> = {
  rotation: check(rotation, {
    specLeaksKey: rotationSpecLeaksKey,
    familyIdRatio: { min: 0.1, reason: '1,386 target polycube classes (A11)' },
    correctResponse: (item) => item.key.index,
    incorrectResponse: (item) => (item.key.index + 1) % 4,
  }),
  matrices: check(matrices, {
    specLeaksKey: matricesSpecLeaksKey,
    familyIdRatio: { min: 0.05, reason: 'family_id = the matrix rule set (A11): 1,655 rule sets, 16 in stratum 1' },
    correctResponse: (item) => item.key.index,
    incorrectResponse: (item) => (item.key.index + 1) % 6,
  }),
  series: check(series, {
    specLeaksKey: seriesSpecLeaksKey,
    familyIdRatio: { min: 0.1, reason: 'family_id = rule family + non-start coefficients (A11)' },
    contentRatio: { min: 0.9, reason: 'letter series and small-number strata have small content spaces' },
    correctResponse: (item: SeriesItem) => ('letter' in item.key ? item.key.letter : item.key.value),
    incorrectResponse: (item: SeriesItem) => ('letter' in item.key ? (item.key.letter === 'A' ? 'B' : 'A') : `${Number(item.key.value) + 1}`),
  }),
  quant: check(quant, {
    specLeaksKey: quantSpecLeaksKey,
    familyIdRatio: { min: 0.005, reason: 'family_id = the quant template variant (A11): 53 variants' },
    contentRatio: { min: 0.85, reason: 'x ± 1/x = k, dice sums, rational powers and letter arrangements have < 200 stems each' },
    correctResponse: (item) => item.key.value,
    incorrectResponse: (item) => (Fraction.parseCanonical(item.key.value) as Fraction).add(Fraction.ONE).toString(),
  }),
  span_fwd: check(spanFwd, { allowKeyInSpec: SPAN_KEY_IN_SPEC, specLeaksKey: spanSpecLeaksKey(SPAN_FWD), ...SPAN_RESPONSES }),
  span_bwd: check(spanBwd, { allowKeyInSpec: SPAN_KEY_IN_SPEC, specLeaksKey: spanSpecLeaksKey(SPAN_BWD), ...SPAN_RESPONSES }),
  corsi: check(corsi, { allowKeyInSpec: SPAN_KEY_IN_SPEC, specLeaksKey: spanSpecLeaksKey(SPAN_CORSI), ...SPAN_RESPONSES }),
  rt_simple: check(rtSimple, RT_OPTS),
  rt_choice4: check(rtChoice4, RT_OPTS),
  coding: check(coding, {
    specLeaksKey: codingSpecLeaksKey,
    validResponse: codingValidResponse,
    invalidResponse: codingInvalidResponse,
    malformedResponses: codingMalformedResponses,
  }),
  reading: check(reading, {
    familyIdRatio: { min: 1 / REGISTRATION_N, reason: 'one family per bank passage (A11)' },
    contentRatio: { min: 0.9, reason: 'a few passages × 24³ option orders' },
    specLeaksKey: onlySpecFields<ReadingSpec, ReadingKey>(...READING_SPEC_FIELDS),
    validResponse: readingValidResponse,
    invalidResponse: readingInvalidResponse,
    malformedResponses: readingMalformedResponses,
  }),
}

describe('family registry (M1.F)', () => {
  it('is keyed by family name, with valid names and versions', () => {
    for (const [key, fam] of entries) {
      expect(fam.name).toBe(key)
      expect(key).toMatch(FAMILY_NAME_RE)
      expect(fam.generatorVersion).toMatch(GENERATOR_VERSION_RE)
      // A11: TS versions carry no build tag; `<ver>+py` names the bank's Python twin.
      expect(fam.generatorVersion).not.toContain('+')
      expect(isPyTwinVersion(fam.generatorVersion)).toBe(false)
      expect(getFamily(key)).toBe(fam)
    }
    expect(getFamily('toString')).toBeUndefined()
    expect(getFamily('example')).toBeUndefined() // the toy family is never registered
  })

  it('registers every M1 family, each with a registration check here', () => {
    expect(Object.keys(FAMILIES).sort()).toEqual(['coding', 'corsi', 'matrices', 'quant', 'reading', 'rotation', 'rt_choice4', 'rt_simple', 'series', 'span_bwd', 'span_fwd'])
    // FAMILY_NAMES is the literal the bank registry test reads (A17); it must match the registry.
    expect(Object.keys(FAMILIES)).toEqual([...FAMILY_NAMES])
    expect(Object.keys(CHECKS).sort()).toEqual(Object.keys(FAMILIES).sort())
  })

  it('marks the fixed blocks explicitly (M1.F2): items are the adaptive pool, blocks run whole (M1.14)', () => {
    const kinds = Object.fromEntries(entries.map(([name, f]) => [name, f.kind]))
    expect(kinds).toEqual({
      rotation: 'item',
      matrices: 'item',
      series: 'item',
      quant: 'item',
      span_fwd: 'block',
      span_bwd: 'block',
      corsi: 'block',
      rt_simple: 'block',
      rt_choice4: 'block',
      coding: 'block',
      reading: 'block',
    })
    for (const [name, fam] of entries) {
      const item = fam.generate(`registry-kind-${name}`)
      expect(kindOfModel(item.params.model), name).toBe(fam.kind)
    }
  })

  it('every item facet is one of its family facets; quant declares its templates as facets (M1.F2)', () => {
    for (const [name, fam] of entries) {
      expect(fam.facets.length, name).toBeGreaterThan(0)
      for (let i = 0; i < 40; i++) expect(fam.facets, name).toContain(fam.generate(`registry-facet-${i}`).facet)
    }
    expect(quant.facets).toEqual(QUANT_TEMPLATES)
    expect(quant.facets.length).toBeGreaterThan(10)
  })

  it('every registered family generates valid, verified instances (smoke; the full suite is per family)', () => {
    for (const [, fam] of entries) {
      for (let i = 0; i < 20; i++) {
        const item = fam.generate(`registry-smoke-${i}`)
        expect(validateItemInstance(item, fam)).toEqual([])
        expect(fam.verify(item).ok).toBe(true)
      }
    }
  })

  it('every registered family puts each item in the default b band of its b_prior (priors.ts STRATUM_B_CUTS)', () => {
    // The shared stratum convention, "so families agree on what a requested stratum means".
    for (const [name, fam] of entries) {
      for (const s of fam.strata) {
        for (let i = 0; i < 20; i++) {
          const item = fam.generate(`registry-band-${i}`, { stratum: s })
          expect(stratumOfB(item.difficulty.b_prior), `${name} ${item.item_id} b = ${item.difficulty.b_prior}`).toBe(item.stratum)
        }
      }
      for (let i = 0; i < 50; i++) {
        const item = fam.generate(`registry-band-free-${i}`)
        expect(stratumOfB(item.difficulty.b_prior), `${name} ${item.item_id}`).toBe(item.stratum)
      }
    }
  }, 120_000)

  it('numeric-entry families share one item_type and the NumericKey shape (family.ts)', () => {
    const entry = entries.filter(([, fam]) => fam.itemType === NUMERIC_ITEM_TYPE).map(([name]) => name)
    expect(entry.sort()).toEqual(['quant', 'series'])
    for (const name of entry) {
      for (let i = 0; i < 100; i++) {
        const key = (getFamily(name) as AnyFamily).generate(`registry-key-${i}`).key as Record<string, unknown>
        if ('letter' in key) continue // letter series: { letter }
        expect(Object.keys(key).sort(), name).toEqual(['tol', 'value'])
        expect(key.value, name).toMatch(/^-?(?:0|[1-9][0-9]*)(?:\/[1-9][0-9]*)?$/)
        expect(Object.keys(key.tol as object).length, name).toBe(1)
        expect(['abs', 'rel'], name).toContain(Object.keys(key.tol as object)[0])
      }
    }
  })

  describe('resolveItem: an item id regenerates only with the exact generator that made it (A11, R-8.1)', () => {
    it('regenerates every family item from its id, free and stratum-targeted (property)', () => {
      const names = entries.map(([name]) => name)
      fc.assert(
        fc.property(fc.constantFrom(...names), fc.string({ minLength: 1, maxLength: 12 }), fc.nat(), (name, seed, k) => {
          const fam = getFamily(name) as AnyFamily
          const stratum = k % 2 === 0 ? undefined : fam.strata[k % fam.strata.length]
          let item
          try {
            item = fam.generate(seed, stratum === undefined ? undefined : { stratum })
          } catch (e) {
            if (e instanceof RangeError) return // a seed that names another stratum (`…@s<k>`)
            throw e
          }
          expect(resolveItem(item.item_id)).toEqual(item)
        }),
        { numRuns: 300 },
      )
    })

    it('returns null for a bank twin id, another version, an unregistered family or a malformed id', () => {
      const item = quant.generate('x0')
      expect(resolveItem(item.item_id)).toEqual(item)
      const { seed } = parseItemId(item.item_id)!
      expect(resolveItem(`i:quant:${quant.generatorVersion}+py:${seed}`)).toBeNull() // the Python twin's item (A11)
      expect(resolveItem(`i:quant:0.0.1:${seed}`)).toBeNull() // before a generator bump
      expect(resolveItem('i:rt:1.1.0:x0')).toBeNull() // rt split into rt_simple / rt_choice4 at 2.0.0
      for (const bad of ['', 'x', 'i:quant', `f:quant:${seed}`, `i:Quant:${quant.generatorVersion}:x0`, `i:quant:${quant.generatorVersion}:`]) {
        expect(resolveItem(bad), bad).toBeNull()
      }
      expect(resolveItem(42 as unknown as string)).toBeNull()
    })

    it('returns null for a seed whose stratum the family cannot target', () => {
      const missing = entries.flatMap(([name, fam]) => STRATA.filter((s) => !fam.strata.includes(s)).map((s) => [name, fam, s] as const))
      expect(missing.length).toBeGreaterThan(0)
      for (const [name, fam, s] of missing) expect(resolveItem(`i:${name}:${fam.generatorVersion}:x@s${s}`), `${name} @s${s}`).toBeNull()
    })
  })

  it.each(entries.map(([name]) => name))(`registered family %s passes runFamilyProperties at n = ${REGISTRATION_N}`, (name) => {
    const c = CHECKS[name]
    expect(c, `no registration check for ${name}`).toBeDefined()
    // The registered object is the one the property suite runs on.
    expect(getFamily(name)).toBe((c as Check).family)
    const r = (c as Check).run(REGISTRATION_N)
    expect(r.family).toBe(name)
    expect(r.n).toBe(REGISTRATION_N)
    expect(r.distinctItemIds).toBe(REGISTRATION_N)
  }, 120_000)
})
