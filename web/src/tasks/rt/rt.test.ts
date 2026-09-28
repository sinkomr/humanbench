import { describe, expect, it } from 'vitest'
import { MalformedResponseError, validateItemInstance } from '../family'
import { runFamilyProperties, onlySpecFields, type FamilyPropertyOptions } from '../testing'
import { RT_FAMILIES, RT_FAMILY_LIST, RT_GENERATOR_VERSION, RT_SPEC_FIELDS, generateRtBlock, rtChoice4, rtSimple, type RtKey, type RtResponse, type RtSpec } from '.'
import { rtInvalidResponse, rtMalformedResponses, rtScoreCase, rtValidResponse } from './synthetic'

/** Stimulus positions are what the renderer draws, and they are the key (§14.6 ex. 12). */
const ALLOW_KEY =
  'choice-RT stimulus positions are the key by design (DESIGN §14.6 example 12: key = position); the renderer must draw them'

/** Blocks of one mode are isomorphs whatever their jitter (A11), so each family has exactly 1 family_id. */
const ONE_STRUCTURE = { min: 1 / 10_000, reason: 'one structure per RT family: blocks differing only in jitter are isomorphs (A11)' }

const OPTS: FamilyPropertyOptions<RtSpec, RtKey, RtResponse> = {
  allowKeyInSpec: ALLOW_KEY,
  familyIdRatio: ONE_STRUCTURE,
  specLeaksKey: onlySpecFields<RtSpec, RtKey>(...RT_SPEC_FIELDS),
  validResponse: rtValidResponse,
  invalidResponse: rtInvalidResponse,
  malformedResponses: rtMalformedResponses,
}

describe.each(RT_FAMILY_LIST.map((f) => [f.name, f] as const))('%s family: property suite (DESIGN §14.3 M1 acceptance 1)', (_name, family) => {
  it('passes runFamilyProperties at n = 10,000 across its strata', () => {
    const r = runFamilyProperties(family, { ...OPTS, strata: family.strata })
    expect(r.kind).toBe('block')
    expect(r.n).toBe(10_000)
    expect(r.distinctItemIds).toBe(10_000)
    expect(r.distinctContents).toBe(10_000)
    expect(r.distinctFamilyIds).toBe(1)
    expect(r.strataCounts[3]).toBe(10_000)
    expect(r.bPrior).toEqual({ min: 0, max: 0, mean: 0 })
  }, 180_000)

  it('passes without a requested stratum too', () => {
    const r = runFamilyProperties(family, { ...OPTS, n: 2_000, seedPrefix: 'free-' })
    expect(r.strataCounts[3]).toBe(2_000)
  }, 60_000)
})

describe('RT families: identity and modes (M1.F2: one block family per sub-task)', () => {
  it('are RT block families with Gaussian params (A10) and no options_count', () => {
    expect([rtSimple.name, rtChoice4.name]).toEqual(['rt_simple', 'rt_choice4'])
    expect(RT_FAMILY_LIST).toEqual([rtSimple, rtChoice4])
    for (const f of RT_FAMILY_LIST) {
      expect(f.kind).toBe('block')
      expect(f.axis).toBe('RT')
      expect(f.itemType).toBe('rt_block')
      expect(f.strata).toEqual([3])
      expect(f.generatorVersion).toBe(RT_GENERATOR_VERSION)
    }
    expect(rtSimple.facets).toEqual(['simple_rt'])
    expect(rtChoice4.facets).toEqual(['choice_rt'])
    const s = generateRtBlock('id', 'simple')
    expect(s.params).toEqual({ model: 'gaussian', lam: -0.15, d: Math.log(300), sigma: 0.05 })
    expect('options_count' in s).toBe(false)
    const c = generateRtBlock('id', 'choice4')
    expect(c.params).toEqual({ model: 'gaussian', lam: -0.15, d: Math.log(450), sigma: 0.05 })
    expect(s.family_id).not.toBe(c.family_id)
    expect(generateRtBlock('other', 'simple').family_id).toBe(s.family_id)
  })

  it('each family always makes its own mode; the seed carries no mode', () => {
    for (let i = 0; i < 200; i++) {
      expect(rtSimple.generate(`m-${i}`).spec.mode).toBe('simple')
      expect(rtChoice4.generate(`m-${i}`).spec.mode).toBe('choice4')
    }
    const c = generateRtBlock('sess-1', 'choice4')
    expect(c.seed).toBe('sess-1')
    expect(c.item_id).toBe(`i:rt_choice4:${RT_GENERATOR_VERSION}:sess-1`)
    expect(c).toEqual(RT_FAMILIES.choice4.generate('sess-1'))
    expect(rtSimple.generate('sess-1@s3')).toEqual(rtSimple.generate('sess-1', { stratum: 3 }))
    expect(() => rtSimple.generate('x', { stratum: 2 })).toThrow(RangeError)
  })

  it('verify rejects a block of the other mode', () => {
    const c = rtChoice4.generate('other-mode')
    expect(rtSimple.verify(c).ok).toBe(false)
    expect(rtSimple.verify(c).reason).toMatch(/mode_matches_family/)
    expect(rtChoice4.verify(c).ok).toBe(true)
  })

  it('scores to a BlockScore: the observation or none with the reason (M1.F2)', () => {
    let ok = 0
    let none = 0
    for (const family of RT_FAMILY_LIST) {
      for (let i = 0; i < 150; i++) {
        const item = family.generate(`score-${i}`)
        const c = rtScoreCase(item)
        const s = family.score(item, c.response)
        expect(s.correct).toBeNull()
        expect(s.flags).toEqual([])
        if (c.expected.status === 'ok') {
          ok++
          expect(s).toEqual({ correct: null, observation: c.expected.observation, flags: [], reasons: [] })
        } else {
          none++
          expect(s).toEqual({ correct: null, flags: [], reasons: ['too_few_valid_trials'] })
        }
      }
    }
    expect(ok).toBeGreaterThan(0)
    expect(none).toBeGreaterThan(0)
  })

  it('throws a MalformedResponseError (a RangeError) on malformed responses', () => {
    const item = rtChoice4.generate('malformed')
    for (const bad of [null, undefined, 1, 'x', {}, ...rtMalformedResponses(item)]) {
      expect(() => rtChoice4.score(item, bad as RtResponse), JSON.stringify(bad)).toThrow(MalformedResponseError)
    }
  })

  it('the key is the stimulus positions and nothing else (no test fixture in production keys)', () => {
    for (let i = 0; i < 250; i++) {
      for (const family of RT_FAMILY_LIST) {
        const item = family.generate(`key-${i}`)
        expect(Object.keys(item.key)).toEqual(['positions'])
        expect(item.key.positions).toEqual(item.spec.positions)
      }
    }
  })

  it('instances are valid, JSON-stable blocks of the right length', () => {
    for (const mode of ['simple', 'choice4'] as const) {
      const item = generateRtBlock('shape', mode)
      expect(validateItemInstance(item, RT_FAMILIES[mode])).toEqual([])
      expect(item.spec.foreperiods_ms).toHaveLength(mode === 'simple' ? 30 : 40)
      expect(item.spec.practice_foreperiods_ms).toHaveLength(3)
      expect(item.key.positions).toHaveLength(mode === 'simple' ? 30 : 40)
      expect(JSON.parse(JSON.stringify(item))).toEqual(item)
    }
  })
})
