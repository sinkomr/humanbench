import { describe, expect, it } from 'vitest'
import { validateItemInstance } from '../family'
import { runFamilyProperties, onlySpecFields, type FamilyPropertyOptions } from '../testing'
import { RT_SPEC_FIELDS, generateRtBlock, rt, type RtKey, type RtResponse, type RtSpec } from '.'
import { rtScoreCase } from './synthetic'

/** Stimulus positions are what the renderer draws, and they are the key (§14.6 ex. 12). */
const ALLOW_KEY =
  'choice-RT stimulus positions are the key by design (DESIGN §14.6 example 12: key = position); the renderer must draw them'

/** Blocks of one mode are isomorphs whatever their jitter (A11), so there are exactly 2 family_ids. */
const TWO_STRUCTURES = { min: 2 / 10_000, reason: '2 structures (simple, choice4): RT blocks differing only in jitter are isomorphs (A11)' }

const OPTS: FamilyPropertyOptions<RtSpec, RtKey, RtResponse> = {
  allowKeyInSpec: ALLOW_KEY,
  familyIdRatio: TWO_STRUCTURES,
  specLeaksKey: onlySpecFields<RtSpec, RtKey>(...RT_SPEC_FIELDS),
}

describe('rt family: property suite (DESIGN §14.3 M1 acceptance 1)', () => {
  it('passes runFamilyProperties at n = 10,000 across its strata', () => {
    const r = runFamilyProperties(rt, { ...OPTS, strata: rt.strata })
    expect(r.n).toBe(10_000)
    expect(r.distinctItemIds).toBe(10_000)
    expect(r.distinctContents).toBe(10_000)
    expect(r.distinctFamilyIds).toBe(2)
    expect(r.strataCounts[3]).toBe(10_000)
    expect(r.bPrior).toEqual({ min: 0, max: 0, mean: 0 })
  }, 180_000)

  it('passes without a requested stratum too (the family picks the mode)', () => {
    const r = runFamilyProperties(rt, { ...OPTS, n: 2_000, seedPrefix: 'free-' })
    expect(r.strataCounts[3]).toBe(2_000)
  }, 60_000)
})

describe('rt family: identity and modes', () => {
  it('is an RT block family with Gaussian params (A10) and no options_count', () => {
    expect(rt.name).toBe('rt')
    expect(rt.axis).toBe('RT')
    expect(rt.itemType).toBe('rt_block')
    expect(rt.strata).toEqual([3])
    const s = generateRtBlock('id', 'simple')
    expect(s.params).toEqual({ model: 'gaussian', lam: -0.15, d: Math.log(300), sigma: 0.05 })
    expect('options_count' in s).toBe(false)
    const c = generateRtBlock('id', 'choice4')
    expect(c.params).toEqual({ model: 'gaussian', lam: -0.15, d: Math.log(450), sigma: 0.05 })
    expect(s.family_id).not.toBe(c.family_id)
    expect(generateRtBlock('other', 'simple').family_id).toBe(s.family_id)
  })

  it('a mode tag in the seed picks the mode and survives the stratum suffix and the item id', () => {
    const c = generateRtBlock('sess-1', 'choice4')
    expect(c.seed).toBe('sess-1#choice4')
    expect(c.item_id).toBe('i:rt:1.1.0:sess-1#choice4')
    expect(c.spec.mode).toBe('choice4')
    const tagged = rt.generate('sess-1#simple', { stratum: 3 })
    expect(tagged.seed).toBe('sess-1#simple@s3')
    expect(tagged.spec.mode).toBe('simple')
    expect(rt.generate('sess-1#simple@s3')).toEqual(tagged)
    expect(() => rt.generate('x', { stratum: 2 })).toThrow(RangeError)
  })

  it('untagged seeds split about evenly between the modes', () => {
    let simple = 0
    for (let i = 0; i < 2_000; i++) if (rt.generate(`split-${i}`).spec.mode === 'simple') simple++
    expect(simple).toBeGreaterThan(900)
    expect(simple).toBeLessThan(1_100)
  })

  it('scores to { correct: null, value: x } or { correct: null } (a block, not a keyed item)', () => {
    let ok = 0
    let none = 0
    for (let i = 0; i < 300; i++) {
      const item = rt.generate(`score-${i}`)
      const c = rtScoreCase(item)
      const s = rt.score(item, c.response)
      expect(s.correct).toBeNull()
      if (c.expected.status === 'ok') {
        ok++
        expect(s.value).toBe(c.expected.observation?.x)
      } else {
        none++
        expect(s).toEqual({ correct: null })
      }
    }
    expect(ok).toBeGreaterThan(0)
    expect(none).toBeGreaterThan(0)
  })

  it('the key is the stimulus positions and nothing else (no test fixture in production keys)', () => {
    for (let i = 0; i < 500; i++) {
      const item = rt.generate(`key-${i}`)
      expect(Object.keys(item.key)).toEqual(['positions'])
      expect(item.key.positions).toEqual(item.spec.positions)
    }
  })

  it('instances are valid, JSON-stable blocks of the right length', () => {
    for (const mode of ['simple', 'choice4'] as const) {
      const item = generateRtBlock('shape', mode)
      expect(validateItemInstance(item, rt)).toEqual([])
      expect(item.spec.foreperiods_ms).toHaveLength(mode === 'simple' ? 30 : 40)
      expect(item.spec.practice_foreperiods_ms).toHaveLength(3)
      expect(item.key.positions).toHaveLength(mode === 'simple' ? 30 : 40)
      expect(JSON.parse(JSON.stringify(item))).toEqual(item)
    }
  })
})
