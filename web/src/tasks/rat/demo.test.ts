/** The synthetic practice puzzles (ROADMAP M6.3, A6): three classic public ones, seeded, made up, never a bank item. */

import { describe, expect, it } from 'vitest'
import { parseItemId } from '../ids'
import { answerKey, matches } from './answers'
import { DEMO_NOTE, DEMO_PUZZLES, demoRatItem } from './demo'
import { specProblems } from './spec'

const SEEDS = Array.from({ length: 300 }, (_v, i) => i)

describe('DEMO_PUZZLES', () => {
  it('are exactly the three classic examples, for the bank generator to exclude', () => {
    expect(DEMO_PUZZLES.map((p) => [[...p.cues].sort(), p.word])).toEqual([
      [['cake', 'cottage', 'swiss'], 'cheese'],
      [['hair', 'paint', 'tooth'], 'brush'],
      [['moon', 'star', 'sun'], 'light'],
    ])
    expect(DEMO_PUZZLES.map((p) => p.compounds)).toEqual([
      ['cottage cheese', 'Swiss cheese', 'cheesecake'],
      ['toothbrush', 'hairbrush', 'paintbrush'],
      ['sunlight', 'moonlight', 'starlight'],
    ])
  })

  it('make a compound of the word with each cue, before or after it', () => {
    for (const p of DEMO_PUZZLES) {
      p.cues.forEach((cue, i) => {
        const compound = answerKey(p.compounds[i] as string)
        expect([cue + p.word, p.word + cue], `${cue}/${p.word}`).toContain(compound)
      })
    }
  })
})

describe('demoRatItem', () => {
  it('is the same puzzle for the same seed, and varies with it', () => {
    expect(demoRatItem(7)).toEqual(demoRatItem(7))
    expect(demoRatItem('7')).toEqual(demoRatItem(7))
    expect(new Set(SEEDS.map((s) => demoRatItem(s).spec.cues.join('/'))).size).toBeGreaterThan(10)
  })

  it('has a renderable spec, and uses every practice puzzle and every cue order over the seeds', () => {
    const words = new Set<string>()
    const orders = new Set<string>()
    for (const seed of SEEDS) {
      const item = demoRatItem(seed)
      expect(specProblems(item.spec), String(seed)).toEqual([])
      words.add(item.word)
      orders.add(item.spec.cues.join('/'))
    }
    expect(words).toEqual(new Set(['cheese', 'brush', 'light']))
    expect(orders.size).toBe(18) // 3 puzzles, 6 orders each
  })

  it('shuffles the cues and keeps each compound beside its cue', () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const item = demoRatItem(seed)
      item.spec.cues.forEach((cue, i) => {
        const k = answerKey(item.compounds[i] as string)
        expect([cue + item.word, item.word + cue], `${seed}: ${cue}`).toContain(k)
      })
      expect(matches(item.word, item.accept)).toBe(true)
    }
  })

  it('accepts its word, in any case and spacing, and nothing else', () => {
    const item = demoRatItem(1)
    expect(item.accept).toEqual([item.word])
    expect(matches(item.word.toUpperCase(), item.accept)).toBe(true)
    expect(matches(` ${item.word} `, item.accept)).toBe(true)
    expect(matches(`${item.word}s`, item.accept)).toBe(false)
    expect(matches(item.spec.cues[0], item.accept)).toBe(false)
  })

  it('is never a bank item: its id is not an A11 id, so it cannot be served or scored as one', () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const item = demoRatItem(seed)
      expect(item.item_id).toBe(`demo:rat:${seed}`)
      expect(parseItemId(item.item_id)).toBeNull()
    }
  })

  it('does not put the word or the accepted words inside the spec, in any field', () => {
    for (const seed of SEEDS) {
      const item = demoRatItem(seed)
      expect(Object.keys(item.spec)).toEqual(['cues'])
      for (const a of item.accept) expect(JSON.stringify(item.spec).toLowerCase(), String(seed)).not.toContain(a)
      expect(JSON.stringify(item.spec)).not.toMatch(/answer|intended|correct|key|solution|accept/i)
    }
  })

  it('marks the puzzle as practice in the words of the page', () => {
    expect(DEMO_NOTE).toBe('A practice puzzle for this page.')
  })
})
