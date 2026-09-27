import { describe, expect, it } from 'vitest'
import { coding, codingSpecLeaksKey } from './coding'
import { validateItemInstance, type ProceduralFamily } from './family'
import { FAMILY_NAME_RE, GENERATOR_VERSION_RE } from './ids'
import { matrices, matricesSpecLeaksKey } from './matrices'
import { reading, type ReadingKey, type ReadingSpec } from './reading'
import { FAMILIES, FAMILY_NAMES, getFamily } from './registry'
import { rotation } from './rotation'
import { rotationSpecLeaksKey } from './rotation/verify'
import { RT_SPEC_FIELDS, rt, type RtKey, type RtSpec } from './rt'
import { series, seriesSpecLeaksKey, type SeriesItem } from './series'
import { SPAN_BWD, SPAN_CORSI, SPAN_FWD, corsi, spanBwd, spanFwd, spanSpecLeaksKey } from './span'
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

const CHECKS: Readonly<Record<string, Check>> = {
  rotation: check(rotation, {
    specLeaksKey: rotationSpecLeaksKey,
    familyIdRatio: { min: 0.1, reason: '1,386 target polycube classes (A11)' },
    correctResponse: (item) => item.key.index,
  }),
  matrices: check(matrices, {
    specLeaksKey: matricesSpecLeaksKey,
    familyIdRatio: { min: 0.05, reason: 'family_id = the matrix rule set (A11): 1,655 rule sets, 16 in stratum 1' },
    correctResponse: (item) => item.key.index,
  }),
  series: check(series, {
    specLeaksKey: seriesSpecLeaksKey,
    familyIdRatio: { min: 0.1, reason: 'family_id = rule family + non-start coefficients (A11)' },
    contentRatio: { min: 0.9, reason: 'letter series and small-number strata have small content spaces' },
    correctResponse: (item: SeriesItem) => ('letter' in item.key ? item.key.letter : String(item.key.value)),
  }),
  span_fwd: check(spanFwd, { allowKeyInSpec: SPAN_KEY_IN_SPEC, specLeaksKey: spanSpecLeaksKey(SPAN_FWD) }),
  span_bwd: check(spanBwd, { allowKeyInSpec: SPAN_KEY_IN_SPEC, specLeaksKey: spanSpecLeaksKey(SPAN_BWD) }),
  corsi: check(corsi, { allowKeyInSpec: SPAN_KEY_IN_SPEC, specLeaksKey: spanSpecLeaksKey(SPAN_CORSI) }),
  rt: check(rt, {
    allowKeyInSpec: 'choice-RT stimulus positions are the key by design (§14.6 ex. 12)',
    familyIdRatio: { min: 2 / REGISTRATION_N, reason: '2 structures (simple, choice4): blocks differing only in jitter are isomorphs (A11)' },
    specLeaksKey: onlySpecFields<RtSpec, RtKey>(...RT_SPEC_FIELDS),
  }),
  coding: check(coding, { specLeaksKey: codingSpecLeaksKey }),
  reading: check(reading, {
    familyIdRatio: { min: 1 / REGISTRATION_N, reason: 'one family per bank passage (A11)' },
    contentRatio: { min: 0.9, reason: 'a few passages × 24³ option orders' },
    specLeaksKey: onlySpecFields<ReadingSpec, ReadingKey>(...READING_SPEC_FIELDS),
  }),
}

describe('family registry (M1.F)', () => {
  it('is keyed by family name, with valid names and versions', () => {
    for (const [key, fam] of entries) {
      expect(fam.name).toBe(key)
      expect(key).toMatch(FAMILY_NAME_RE)
      expect(fam.generatorVersion).toMatch(GENERATOR_VERSION_RE)
      expect(getFamily(key)).toBe(fam)
    }
    expect(getFamily('toString')).toBeUndefined()
    expect(getFamily('example')).toBeUndefined() // the toy family is never registered
  })

  it('registers every M1 family, each with a registration check here', () => {
    expect(Object.keys(FAMILIES).sort()).toEqual(['coding', 'corsi', 'matrices', 'reading', 'rotation', 'rt', 'series', 'span_bwd', 'span_fwd'])
    // FAMILY_NAMES is the literal the bank registry test reads (A17); it must match the registry.
    expect(Object.keys(FAMILIES)).toEqual([...FAMILY_NAMES])
    expect(Object.keys(CHECKS).sort()).toEqual(Object.keys(FAMILIES).sort())
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
