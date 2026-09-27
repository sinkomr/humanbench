import { describe, expect, it } from 'vitest'
import { validateItemInstance, type AnyFamily } from '../family'
import { parseItemId } from '../ids'
import { runFamilyProperties } from '../testing'
import {
  CODING_DURATION_S,
  CODING_SEQUENCE_LENGTH,
  CODING_SYMBOLS,
  coding,
  codingSpecLeaksKey,
  verifyCoding,
  type CodingItem,
} from '.'

const OPTS = { specLeaksKey: codingSpecLeaksKey } as const

describe('family coding (M1.11)', () => {
  it('passes runFamilyProperties at n = 10,000', () => {
    const r = runFamilyProperties(coding, OPTS)
    expect(r.family).toBe('coding')
    expect(r.n).toBe(10_000)
    expect(r.distinctItemIds).toBe(10_000)
    expect(r.distinctContents).toBe(10_000)
    expect(r.distinctFamilyIds).toBe(10_000)
    expect(r.strataCounts[3]).toBe(10_000)
    expect(r.bPrior).toEqual({ min: 0, max: 0, mean: 0 })
  }, 180_000)

  it('passes with its (single) requested stratum', () => {
    const r = runFamilyProperties(coding, { ...OPTS, n: 1_000, strata: coding.strata, seedPrefix: 'strat-' })
    expect(coding.strata).toEqual([3])
    expect(r.strataCounts[3]).toBe(1_000)
  }, 60_000)

  it('has the A10 identity, a Gaussian model on PS and the 90 s window', () => {
    const item = coding.generate('identity')
    expect(validateItemInstance(item, coding as unknown as AnyFamily)).toEqual([])
    expect(item).toMatchObject({ family: 'coding', axis: 'PS', facet: 'coding', item_type: 'coding_block', stratum: 3 })
    expect(item.options_count).toBeUndefined()
    expect(item.params.model).toBe('gaussian')
    expect(item.expected_time_s).toBe(CODING_DURATION_S)
    expect(item.time_limit_s).toBe(CODING_DURATION_S)
    expect(Object.keys(item.spec).sort()).toEqual(['duration_s', 'legend', 'sequence'])
    expect(item.spec.sequence).toHaveLength(CODING_SEQUENCE_LENGTH)
    expect(item.spec.legend.map((e) => e.digit)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(Object.keys(item.key)).toEqual(['table'])
  })

  it('regenerates from the item id alone, and refuses the strata it cannot make', () => {
    const item = coding.generate('regen', { stratum: 3 })
    expect(item.seed).toBe('regen@s3')
    expect(coding.generate(parseItemId(item.item_id)?.seed ?? '')).toEqual(item)
    for (const s of [1, 2, 4, 5, 6]) expect(() => coding.generate('x', { stratum: s })).toThrow(RangeError)
  })

  it('draws a new key table per session: tables differ across seeds', () => {
    const tables = new Set<string>()
    for (let i = 0; i < 500; i++) tables.add(JSON.stringify(coding.generate(`table-${i}`).key.table))
    expect(tables.size).toBeGreaterThan(495) // 9! = 362,880 tables
  })

  it('the family leak check rejects every extra channel for the key', () => {
    const item = coding.generate('leak')
    const leak = (spec: object): string | null => codingSpecLeaksKey({ ...item, spec } as CodingItem)
    expect(codingSpecLeaksKey(item)).toBeNull()
    expect(leak({ ...item.spec, digits: [1, 2] })).toMatch(/spec fields/)
    const legend = item.spec.legend.map((e, i) => (i === 0 ? { ...e, hint: 'x' } : e))
    expect(leak({ ...item.spec, legend })).toMatch(/other than digit, symbol/)
    const swapped = item.spec.legend.map((e, i, all) => (i < 2 ? { digit: e.digit, symbol: (all[1 - i] as typeof e).symbol } : e))
    expect(leak({ ...item.spec, legend: swapped })).toMatch(/not the key's digit/)
    expect(leak({ ...item.spec, sequence: ['star', 'star3'] })).toMatch(/carries a digit/)
  })

  it('every glyph id is a distinct lowercase id with no digit (they render in M1.13)', () => {
    expect(new Set(CODING_SYMBOLS).size).toBe(9)
    for (const s of CODING_SYMBOLS) expect(s).toMatch(/^[a-z]+$/)
  })

  it('no glyph is a shape that reads as a digit, a letter or a key (0 is a key the taker can press)', () => {
    // Circle outline = 0/O, vertical strokes = 1/l/||, plus = +, angle = < > ^ v, wave = ~.
    const lookalikes = ['ring', 'circle', 'bars', 'bar', 'line', 'cross', 'plus', 'chevron', 'angle', 'caret', 'wave', 'tilde', 'slash', 'hash']
    for (const s of CODING_SYMBOLS) expect(lookalikes).not.toContain(s)
  })

  it('verify() accepts what generate() makes (spot check beside the property suite)', () => {
    for (let i = 0; i < 50; i++) expect(verifyCoding(coding.generate(`spot-${i}`)).ok).toBe(true)
  })
})
