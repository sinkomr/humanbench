/**
 * The interim topic taxonomy (ROADMAP AI.3 seam; proposal §5.2, ADR A23): ids, labels, the floor
 * flags, and the label lists that the parser reads back. These invariants are the contract a
 * replacement vocabulary (`schema/topics-v1.json`) must keep.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { lintLine } from './lint'
import {
  AREAS,
  MAX_TOPICS_PER_CONTEXT,
  SUGGESTED_TOPICS,
  TOPICS,
  canonicalTopics,
  inlineLabel,
  isTopicId,
  joinTopicLabels,
  parseTopicLabels,
  resolveTopicId,
  splitTopicLabels,
  topicById,
  topicIndex,
} from './topics'
import { PRESETS } from './types'

const ids = TOPICS.map((t) => t.id)

describe('taxonomy', () => {
  it('has unique ids and labels, and every area is known and used in order', () => {
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(TOPICS.map((t) => t.label)).size).toBe(TOPICS.length)
    const order = AREAS.map((a) => a.id)
    const seen = TOPICS.map((t) => order.indexOf(t.area))
    expect(seen.every((i) => i >= 0)).toBe(true)
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
  })

  it('uses <axis>/<facet> ids, with the six M1 quant groups of proposal 5.2 verbatim', () => {
    for (const t of TOPICS) expect(t.id, t.id).toMatch(/^(?:quant|lr|kst|khu|kap|other)\/[a-z0-9_]+(?:\/[a-z0-9_]+)?$/)
    expect(TOPICS.filter((t) => t.id.startsWith('quant/')).map((t) => [t.id, t.label])).toEqual([
      ['quant/arith_fractions_percent', 'Arithmetic, fractions and percentages'],
      ['quant/ratios_rates_averages', 'Ratios, rates and averages'],
      ['quant/linear', 'Linear equations and systems'],
      ['quant/powers_quadratics', 'Powers and quadratics'],
      ['quant/probability_counting', 'Probability and counting'],
      ['quant/series_number', 'Series and number puzzles'],
    ])
  })

  it('flags exactly the two lowest quant groups for the floor rule', () => {
    expect(TOPICS.filter((t) => t.floor === true).map((t) => t.id)).toEqual(['quant/arith_fractions_percent', 'quant/ratios_rates_averages'])
  })

  it('has labels that are digit-free, plain, lint-clean and free of ability, reading, memory, speed, language-background and school-level words', () => {
    const DENY = /\b(?:abilit\w*|reading|memory|speed|verbal|reasoning|language|english|native|grade|elementary|primary|secondary|school|college|university|undergraduate|graduate|advanced|basic|intro\w*|beginner|remedial|level\w*|iq|intelligence|smart|health\w*|religio\w*)\b/iu
    for (const t of TOPICS) {
      expect(t.label, t.id).toMatch(/^[A-Z][A-Za-z ,]+$/)
      expect(DENY.test(t.label), t.label).toBe(false)
      expect(lintLine(t.label), t.label).toEqual([])
    }
  })

  it('gives notation topics and knowledge topics their own wording family', () => {
    expect(topicById('lr/notation')?.domain).toBe('notation')
    expect(TOPICS.filter((t) => /^(?:kst|khu|kap)\//.test(t.id)).every((t) => t.domain === 'knowledge')).toBe(true)
    expect(TOPICS.filter((t) => t.id.startsWith('quant/')).every((t) => t.domain === 'method')).toBe(true)
  })

  it('suggests only real topics, within the cap, for every context', () => {
    for (const p of PRESETS) {
      expect(SUGGESTED_TOPICS[p].every(isTopicId), p).toBe(true)
      expect(new Set(SUGGESTED_TOPICS[p]).size, p).toBe(SUGGESTED_TOPICS[p].length)
    }
    expect(MAX_TOPICS_PER_CONTEXT).toBe(5)
  })

  it('orders canonically and drops unknown ids and repeats', () => {
    expect(canonicalTopics(['other/statistics', 'nope', 'quant/linear', 'other/statistics'])).toEqual(['quant/linear', 'other/statistics'])
    expect(topicIndex('nope')).toBe(-1)
  })
})

describe('resolveTopicId (aliases)', () => {
  it('resolves current ids to themselves, retired ids through the alias map, and unknown ids to nothing', () => {
    const aliases = { 'old/one': ['quant/linear'], 'old/split': ['kst/physics', 'old/one'], 'loop/a': ['loop/b'], 'loop/b': ['loop/a'] }
    expect(resolveTopicId('quant/linear', aliases)).toEqual(['quant/linear'])
    expect(resolveTopicId('old/one', aliases)).toEqual(['quant/linear'])
    expect(resolveTopicId('old/split', aliases)).toEqual(['kst/physics', 'quant/linear'])
    expect(resolveTopicId('gone/away', aliases)).toEqual([])
    expect(resolveTopicId('loop/a', aliases)).toEqual([])
  })
})

describe('label lists', () => {
  it('reads inline labels with a lower-case first letter', () => {
    expect(inlineLabel('Probability and counting')).toBe('probability and counting')
    expect(joinTopicLabels(['other/programming', 'other/statistics'], true)).toBe('Programming and statistics')
    expect(joinTopicLabels(['quant/probability_counting'], false)).toBe('probability and counting')
    expect(joinTopicLabels(['quant/arith_fractions_percent', 'quant/linear', 'kst/biology'], true)).toBe('Arithmetic, fractions and percentages, linear equations and systems and biology')
  })

  it('has exactly one reading for every list of one, two or three topics', () => {
    for (const cap of [true, false]) {
      for (let a = 0; a < ids.length; a++) {
        const one = [ids[a] as string]
        expect(splitTopicLabels(joinTopicLabels(one, cap), cap), one.join()).toEqual([one])
        for (let b = a + 1; b < ids.length; b++) {
          const two = [ids[a] as string, ids[b] as string]
          expect(splitTopicLabels(joinTopicLabels(two, cap), cap), two.join()).toEqual([two])
        }
      }
    }
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        for (let c = b + 1; c < ids.length; c++) {
          const three = [ids[a] as string, ids[b] as string, ids[c] as string]
          expect(parseTopicLabels(joinTopicLabels(three, true), true), three.join()).toEqual(three)
        }
      }
    }
  })

  it('reads back any list of up to five topics', () => {
    fc.assert(
      fc.property(fc.subarray(ids, { minLength: 1, maxLength: 5 }), fc.boolean(), (subset, cap) => {
        const canonical = canonicalTopics(subset)
        expect(parseTopicLabels(joinTopicLabels(canonical, cap), cap)).toEqual(canonical)
      }),
      { numRuns: 2000 },
    )
  })

  it('refuses text that is not a canonical list', () => {
    expect(parseTopicLabels('Statistics and programming', true)).toBeNull() // wrong order
    expect(parseTopicLabels('Programming and programming', true)).toBeNull()
    expect(parseTopicLabels('Programming, statistics', true)).toBeNull() // needs "and" before the last
    expect(parseTopicLabels('Cooking', true)).toBeNull()
    expect(parseTopicLabels('', true)).toBeNull()
    expect(parseTopicLabels('programming', true)).toBeNull() // first label keeps its capital when asked
  })
})
