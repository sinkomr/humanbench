/** The synthetic practice situations (ROADMAP M6.2, A6): seeded, made up, low-stakes, and never a bank item. */

import { describe, expect, it } from 'vitest'
import { parseItemId } from '../ids'
import { demoSjtItem } from './demo'
import { mostLeastScore, ratingScore } from './scoring'
import { SJT_OPTIONS, specProblems } from './spec'

const SEEDS = Array.from({ length: 300 }, (_v, i) => i)

describe('demoSjtItem', () => {
  it('is the same situation for the same seed, and varies with it', () => {
    expect(demoSjtItem(7)).toEqual(demoSjtItem(7))
    expect(demoSjtItem('7')).toEqual(demoSjtItem(7))
    const items = SEEDS.map((s) => demoSjtItem(s))
    expect(new Set(items.map((i) => i.spec.scenario)).size).toBeGreaterThan(30)
    expect(new Set(items.map((i) => i.spec.responses.join('|'))).size).toBeGreaterThan(100)
  })

  it('has a renderable spec of four distinct responses and a question', () => {
    for (const seed of SEEDS) {
      const item = demoSjtItem(seed)
      expect(specProblems(item.spec), String(seed)).toEqual([])
      expect(item.spec.responses).toHaveLength(SJT_OPTIONS)
      expect(item.spec.question).toBe('How well would each response work?')
      expect(item.explanation).not.toContain('{name}')
      expect(JSON.stringify(item.spec)).not.toContain('{name}')
    }
  })

  it('has intended ratings that the scores accept: four numbers in [1, 4] in display order, with a best and a worst', () => {
    for (const seed of SEEDS) {
      const { ratings } = demoSjtItem(seed)
      expect(ratings, String(seed)).toHaveLength(SJT_OPTIONS)
      for (const r of ratings) {
        expect(r).toBeGreaterThanOrEqual(1)
        expect(r).toBeLessThanOrEqual(4)
      }
      expect(Math.max(...ratings)).toBeGreaterThan(Math.min(...ratings))
      expect(ratingScore([1, 2, 3, 4], ratings)).toBeGreaterThanOrEqual(0)
      expect(mostLeastScore(ratings.indexOf(Math.max(...ratings)), ratings.indexOf(Math.min(...ratings)), ratings)).toBe(1)
    }
  })

  it('puts the best-rated response in every position over the seeds (nothing follows from the template)', () => {
    const positions = new Set(SEEDS.map((s) => demoSjtItem(s).ratings.indexOf(4)))
    expect(positions).toEqual(new Set([0, 1, 2, 3]))
    const worst = new Set(SEEDS.map((s) => demoSjtItem(s).ratings.indexOf(1)))
    expect(worst.size).toBeGreaterThan(1)
  })

  it('rates the same response text the same way whatever its position (the shuffle moves the rating with it)', () => {
    const byText = new Map<string, Set<number>>()
    for (const seed of SEEDS) {
      const { spec, ratings } = demoSjtItem(seed)
      spec.responses.forEach((text, i) => {
        const key = text.replace(/\b(Ada|Bo|Cleo|Dev|Eli|Fay|Gus|Ida|Jo|Kit|Lou|Max)\b/g, 'NAME')
        byText.set(key, (byText.get(key) ?? new Set<number>()).add(ratings[i] as number))
      })
    }
    for (const [text, set] of byText) expect(set.size, text).toBe(1)
  })

  it('says it is made up, and is never a bank item: its id is not an A11 id, so it cannot be served or scored as one', () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const item = demoSjtItem(seed)
      expect(item.spec.scenario.startsWith('A practice situation made up for this page:')).toBe(true)
      expect(item.item_id).toBe(`demo:sjt:${seed}`)
      expect(parseItemId(item.item_id)).toBeNull()
    }
  })

  it('does not put the intended ratings inside the spec, in any field', () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const item = demoSjtItem(seed)
      expect(Object.keys(item.spec).sort()).toEqual(['question', 'responses', 'scenario'])
      expect(JSON.stringify(item.spec)).not.toMatch(/rating|intended|correct|key|answer|best|worst|effective/i)
      expect(JSON.stringify(item.spec)).not.toContain(item.explanation)
    }
  })

  it('stays with everyday, low-stakes situations: no health, money hardship, violence or loss', () => {
    const heavy = /\b(ill|illness|sick|hospital|doctor|medic\w*|pain|injur\w*|debt|rent|afford\w*|bills?|poor|poverty|evict\w*|hit|fight\w*|attack\w*|weapon\w*|hurt|kill\w*|die|died|dead|death|funeral|grief|lost|loss|mourn\w*|accident|emergency|police|danger\w*)\b/i
    for (const seed of SEEDS) {
      const item = demoSjtItem(seed)
      const text = [item.spec.scenario, ...item.spec.responses, item.explanation].join(' ')
      expect(text, String(seed)).not.toMatch(heavy)
    }
  })
})
