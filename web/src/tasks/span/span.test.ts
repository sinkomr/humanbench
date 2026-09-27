import { describe, expect, it } from 'vitest'
import { validateItemInstance, type AnyFamily } from '../family'
import { runFamilyProperties } from '../testing'
import {
  SPAN_BWD,
  SPAN_CORSI,
  SPAN_FAMILIES,
  SPAN_FWD,
  SPAN_GRM_A,
  corsi,
  hasImmediateRepeat,
  hasRunOfThree,
  isPalindrome,
  runBlock,
  spanBwd,
  spanFwd,
  spanSpecLeaksKey,
  type SpanTaskConfig,
} from '.'

/** The stimuli are the key (forward, Corsi) or its reversal (backward) by design (§14.6 ex. 10–11). */
const KEY_IN_SPEC =
  'span blocks present their stimuli, which are the key (forward digits, Corsi) or its reversal (backward digits) by design; A1 allows client-side procedural keys in M1'

const CASES: readonly [string, (typeof SPAN_FAMILIES)[number], SpanTaskConfig][] = [
  ['span_fwd', spanFwd, SPAN_FWD],
  ['span_bwd', spanBwd, SPAN_BWD],
  ['corsi', corsi, SPAN_CORSI],
]

describe.each(CASES)('family %s (M1.9)', (name, family, cfg) => {
  const opts = { allowKeyInSpec: KEY_IN_SPEC, specLeaksKey: spanSpecLeaksKey(cfg) } as const

  it('passes runFamilyProperties at n = 10,000', () => {
    const r = runFamilyProperties(family, opts)
    expect(r.family).toBe(name)
    expect(r.n).toBe(10_000)
    expect(r.distinctItemIds).toBe(10_000)
    expect(r.distinctContents).toBe(10_000)
    expect(r.distinctFamilyIds).toBe(10_000)
    expect(r.strataCounts[family.strata[0] as 1]).toBe(10_000)
  }, 120_000)

  it('passes with its (single) requested stratum', () => {
    const r = runFamilyProperties(family, { ...opts, n: 1_000, strata: family.strata, seedPrefix: 'strat-' })
    expect(family.strata).toHaveLength(1)
    expect(r.strataCounts[family.strata[0] as 1]).toBe(1_000)
  }, 60_000)

  it('has the A10 identity and GRM parameters', () => {
    const item = family.generate('identity')
    expect(validateItemInstance(item, family as unknown as AnyFamily)).toEqual([])
    expect(item).toMatchObject({ family: name, axis: 'WM', facet: cfg.task, item_type: 'span' })
    expect(item.options_count).toBeUndefined()
    expect(item.params).toMatchObject({ model: 'grm', a: SPAN_GRM_A })
    expect(item.spec.trials).toHaveLength(2 * (cfg.maxLength - 2))
    expect(item.spec.max_length).toBe(cfg.maxLength)
  })

  it('draws every sequence under the rules over 2,000 blocks, using the whole alphabet', () => {
    const used = new Set<number>()
    let trials = 0
    for (let i = 0; i < 2_000; i++) {
      const item = family.generate(`rules-${i}`)
      const seqs = item.spec.trials
      expect(new Set(seqs.map((s) => s.join(','))).size).toBe(seqs.length)
      for (const s of seqs) {
        trials++
        s.forEach((x) => used.add(x))
        expect(hasImmediateRepeat(s)).toBe(false)
        if (cfg.forbidRuns) expect(hasRunOfThree(s)).toBe(false)
        if (cfg.forbidPalindromes) expect(isPalindrome(s)).toBe(false)
      }
    }
    expect(trials).toBe(2_000 * 2 * (cfg.maxLength - 2))
    expect([...used].sort()).toEqual([...cfg.symbols].sort())
  })

  it('scores its own key stream at the top category and an empty stream as unfinished', () => {
    const item = family.generate('score')
    expect(family.score(item, item.key.sequences)).toEqual({ correct: null, value: cfg.maxLength - 2 })
    expect(family.score(item, [])).toEqual({ correct: null })
    const status = runBlock(item, [])
    expect(status).toEqual({ finished: false, trial: 0, length: 3, longest_passed: 0 })
  })
})

describe('span families together', () => {
  it('are three distinct families with distinct names', () => {
    expect(SPAN_FAMILIES.map((f) => f.name)).toEqual(['span_fwd', 'span_bwd', 'corsi'])
  })

  it('give different sequences to different tasks from one seed (per-task child stream)', () => {
    const [f, b] = [spanFwd.generate('same-seed'), spanBwd.generate('same-seed')]
    expect(f.spec.trials.slice(0, 14)).not.toEqual(b.spec.trials)
  })

  it('backward keys are the reversed stimuli; forward and Corsi keys are the stimuli', () => {
    const f = spanFwd.generate('keys')
    const b = spanBwd.generate('keys')
    const c = corsi.generate('keys')
    expect(f.key.sequences).toEqual(f.spec.trials)
    expect(c.key.sequences).toEqual(c.spec.trials)
    expect(b.key.sequences).toEqual(b.spec.trials.map((t) => [...t].reverse()))
  })

  it('only Corsi carries the fixed board', () => {
    expect('board' in spanFwd.generate('b').spec).toBe(false)
    expect('board' in spanBwd.generate('b').spec).toBe(false)
    expect(corsi.generate('b').spec.board?.blocks).toHaveLength(9)
  })

  it('are strata 3 / 4 / 3 by the default bands of their b_prior', () => {
    expect([spanFwd.strata, spanBwd.strata, corsi.strata]).toEqual([[3], [4], [3]])
    expect(() => spanFwd.generate('x', { stratum: 4 })).toThrow(RangeError)
  })
})
