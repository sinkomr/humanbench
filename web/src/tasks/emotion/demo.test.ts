/** The synthetic demo vignette (ROADMAP M6.1, A6): seeded, made up, and never a bank item. */

import { describe, expect, it } from 'vitest'
import { parseItemId } from '../ids'
import { demoEmotionItem } from './demo'
import { EMOTION_OPTIONS, specProblems, splitStem } from './spec'

const SEEDS = Array.from({ length: 300 }, (_v, i) => i)

describe('demoEmotionItem', () => {
  it('is the same situation for the same seed, and varies with it', () => {
    expect(demoEmotionItem(7)).toEqual(demoEmotionItem(7))
    expect(demoEmotionItem('7')).toEqual(demoEmotionItem(7))
    expect(new Set(SEEDS.map((s) => demoEmotionItem(s).spec.stem)).size).toBeGreaterThan(30)
  })

  it('has a renderable spec of five distinct options, a question, and an answer among them', () => {
    for (const seed of SEEDS) {
      const item = demoEmotionItem(seed)
      expect(specProblems(item.spec), String(seed)).toEqual([])
      expect(item.spec.options).toHaveLength(EMOTION_OPTIONS)
      expect(splitStem(item.spec.stem).question, String(seed)).toMatch(/^How is \S+ most likely to feel\?$/)
      expect(item.answer_index).toBeGreaterThanOrEqual(0)
      expect(item.answer_index).toBeLessThan(EMOTION_OPTIONS)
      expect(item.explanation).not.toContain('{name}')
      expect(item.spec.stem).not.toContain('{name}')
    }
  })

  it('puts the intended answer in every position over the seeds (nothing follows from the template)', () => {
    const positions = new Set(SEEDS.map((s) => demoEmotionItem(s).answer_index))
    expect(positions).toEqual(new Set([0, 1, 2, 3, 4]))
  })

  it('says it is made up, and is never a bank item: its id is not an A11 id, so it cannot be served or scored as one', () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const item = demoEmotionItem(seed)
      expect(item.spec.stem).toContain('A practice situation made up for this page')
      expect(item.item_id).toBe(`demo:emotion:${seed}`)
      expect(parseItemId(item.item_id)).toBeNull()
    }
  })

  it('does not put the intended answer inside the spec, in any field', () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const item = demoEmotionItem(seed)
      expect(Object.keys(item.spec).sort()).toEqual(['options', 'stem'])
      expect(JSON.stringify(item.spec)).not.toMatch(/answer|intended|correct|key/i)
    }
  })

  it('never names a feeling in the situation itself (the options carry the feelings)', () => {
    const feelings = /\b(joy|joyful|angry|anger|afraid|fear|scared|proud|pride|sad|sadness|happy|furious|guilt|guilty|regret|relief|relieved)\b/i
    for (const seed of SEEDS.slice(0, 60)) {
      const { scenario } = splitStem(demoEmotionItem(seed).spec.stem)
      expect(scenario).not.toMatch(feelings)
    }
  })
})
