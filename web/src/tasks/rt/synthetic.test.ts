/**
 * The rt scoring parity dump (`synthetic.ts`; M1.10, A1, A17): the synthetic responses, what the
 * dump covers, and that each case is its own block's TS result. The bank copy's drift check is
 * `scripts/rt-scores-dump.test.ts`.
 */

import { describe, expect, it } from 'vitest'
import { createRng } from '../../engine'
import { expectedOf, generateRtBlock, rt, scoreRtResponse } from '.'
import {
  RT_SCORE_DUMP_FILE,
  RT_SCORE_DUMP_SEED_PREFIX,
  SYNTHETIC_DEVICE_CLASSES,
  buildRtScoreDump,
  drawSyntheticResponses,
  rtScoreCase,
  serializeRtScoreDump,
  type RtScoreDump,
} from './synthetic'

describe('synthetic RT responses', () => {
  it('are whole tenths of a ms (integer draws, the same on every engine), with every lapse kind', () => {
    const kinds = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const item = rt.generate(`tenths-${i}`)
      const r = drawSyntheticResponses(createRng(`tenths-${i}`), item.spec)
      expect(r.rt_ms).toHaveLength(item.spec.positions.length)
      expect(r.practice_rt_ms).toHaveLength(3)
      for (const v of [...r.practice_rt_ms, ...r.rt_ms]) {
        if (v === null) {
          kinds.add('miss')
          continue
        }
        expect(Math.round(v * 10) / 10).toBe(v)
        kinds.add(v < 0 ? 'anticipation' : v === 0 ? 'zero' : 'rt')
      }
    }
    expect([...kinds].sort()).toEqual(['anticipation', 'miss', 'rt', 'zero'])
  })

  it('are deterministic in the stream and never touch the item', () => {
    const item = generateRtBlock('det', 'choice4')
    const before = JSON.stringify(item)
    expect(rtScoreCase(item)).toEqual(rtScoreCase(item))
    expect(JSON.stringify(item)).toBe(before)
    expect(Object.keys(item.key)).toEqual(['positions'])
  })
})

describe('rt scoring parity dump (A1, A17)', () => {
  const N = 1_000
  const dump = buildRtScoreDump(N)

  it('has a header naming the item dump, and one case per dumped block dump-<i>', () => {
    expect(RT_SCORE_DUMP_FILE).toBe('rt_scores.json')
    expect(dump).toMatchObject({ family: 'rt', generator_version: rt.generatorVersion, items_file: 'rt.json', count: N })
    expect(dump.cases.map((c) => c.item_id)).toEqual(dump.cases.map((_, i) => `i:rt:${rt.generatorVersion}:${RT_SCORE_DUMP_SEED_PREFIX}${i}`))
    expect(() => buildRtScoreDump(0)).toThrow(RangeError)
  })

  it('each case is the TS result of its own responses on its own block', () => {
    for (const [i, c] of dump.cases.entries()) {
      const item = rt.generate(`${RT_SCORE_DUMP_SEED_PREFIX}${i}`)
      expect(c.expected).toEqual(expectedOf(scoreRtResponse(item.spec.mode, item.key.positions, c.response, { device_class: c.device_class })))
      expect(c.response.rt_ms).toHaveLength(item.key.positions.length)
    }
  }, 60_000)

  it('covers both outcomes, every trimming rule, both modes and every device class', () => {
    const totals = { ok: 0, none: 0, misses: 0, anticipations: 0, errors: 0, fast: 0, slow: 0 }
    const devices = new Set<string>()
    const modes = new Set<number>()
    for (const c of dump.cases) {
      devices.add(c.device_class)
      modes.add(c.response.rt_ms.length)
      const x = c.expected
      if (x.status === 'ok') totals.ok++
      else totals.none++
      totals.misses += x.n_misses
      totals.anticipations += x.n_anticipations
      totals.errors += x.n_errors
      totals.fast += x.n_too_fast
      totals.slow += x.n_too_slow
    }
    for (const v of Object.values(totals)) expect(v).toBeGreaterThan(20)
    expect(totals.ok).toBeGreaterThan(N / 2)
    expect([...devices].sort()).toEqual([...SYNTHETIC_DEVICE_CLASSES].sort())
    expect([...modes].sort()).toEqual([30, 40])
  })

  it('serialises one canonical case per line and survives JSON', () => {
    const small = buildRtScoreDump(5)
    const text = serializeRtScoreDump(small)
    expect(text.split('\n')).toHaveLength(small.cases.length + 3)
    expect(JSON.parse(text) as RtScoreDump).toEqual(JSON.parse(JSON.stringify(small)))
  })
})
