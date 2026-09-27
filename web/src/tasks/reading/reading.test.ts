import { describe, expect, it } from 'vitest'
import { validateItemInstance } from '../family'
import { onlySpecFields, runFamilyProperties, type FamilyPropertyOptions } from '../testing'
import { PASSAGES, READING_STRATUM, reading, readingBlockObservation, type ReadingItem, type ReadingKey, type ReadingResponse, type ReadingSpec } from '.'

/** The spec fields a reading block may carry; anything new is a deliberate decision. */
const READING_SPEC_FIELDS = ['passage_id', 'paragraphs', 'word_count', 'source', 'questions'] as const

/** Extra leak check: only the known spec fields, and questions carry only id, stem and options. */
function readingSpecLeaksKey(item: ReadingItem): string | null {
  const extra = onlySpecFields<ReadingSpec, ReadingKey>(...READING_SPEC_FIELDS)(item)
  if (extra !== null) return extra
  for (const q of item.spec.questions) {
    const fields = Object.keys(q).sort().join(',')
    if (fields !== 'id,options,stem') return `question ${q.id} has fields ${fields}`
  }
  return null
}

/** One family per passage (A11: a user never reads the same passage twice, §7.7). */
const ONE_FAMILY_PER_PASSAGE = { min: 8 / 10_000, reason: `one family per bank passage (${PASSAGES.length} passages, A11)` }
/** 8 passages × 24³ option orders = 110,592 layouts, so 10,000 draws give ≈ 95.6% distinct. */
const SMALL_CONTENT = { min: 0.9, reason: `${PASSAGES.length} passages × 24³ option orders (birthday collisions at n = 10,000)` }

const OPTS: FamilyPropertyOptions<ReadingSpec, ReadingKey, ReadingResponse> = {
  familyIdRatio: ONE_FAMILY_PER_PASSAGE,
  contentRatio: SMALL_CONTENT,
  specLeaksKey: readingSpecLeaksKey,
}

/** Correct answers read at `wpm` words per minute. */
function responseAt(item: ReadingItem, wpm: number, choices: readonly (number | null)[] = item.key.indices): ReadingResponse {
  return { reading_time_ms: (item.spec.word_count / wpm) * 60_000, choices }
}

describe('reading family: property suite (DESIGN §14.3 M1 acceptance 1)', () => {
  it('passes runFamilyProperties at n = 10,000', () => {
    const r = runFamilyProperties(reading, OPTS)
    expect(r.n).toBe(10_000)
    expect(r.distinctItemIds).toBe(10_000)
    expect(r.distinctContents).toBeGreaterThan(9_300)
    expect(r.distinctFamilyIds).toBe(PASSAGES.length)
    expect(r.strataCounts[3]).toBe(10_000)
    expect(r.bPrior).toEqual({ min: 0.4, max: 0.4, mean: expect.closeTo(0.4, 12) as number })
  }, 180_000)

  it('passes with the stratum requested (its only stratum, 3)', () => {
    const r = runFamilyProperties(reading, { ...OPTS, n: 1_200, strata: reading.strata, seedPrefix: 'strat-' })
    expect(r.strataCounts[3]).toBe(1_200)
  }, 60_000)

  it('scores all 10,000 instances: correct answers give ln(wpm), a failed gate gives no value', () => {
    const problems: string[] = []
    for (let i = 0; i < 10_000; i++) {
      const item = reading.generate(`score-${i}`)
      const wpm = 150 + (i % 700)
      const ok = reading.score(item, responseAt(item, wpm))
      if (ok.correct !== null || ok.value === undefined || Math.abs(ok.value - Math.log(wpm)) > 1e-9) problems.push(`score-${i}: ${JSON.stringify(ok)}`)
      const wrong = item.key.indices.map((k) => (k + 1) % 4)
      const failed = reading.score(item, responseAt(item, wpm, wrong))
      if (failed.correct !== null || 'value' in failed) problems.push(`score-${i} (wrong): ${JSON.stringify(failed)}`)
      if (problems.length > 10) break
    }
    expect(problems).toEqual([])
  }, 120_000)
})

describe('reading family: identity, strata and randomisation', () => {
  it('is a PS reading-speed block family with Gaussian params (A10) and no options_count', () => {
    expect(reading.name).toBe('reading')
    expect(reading.axis).toBe('PS')
    expect(reading.facet).toBe('reading_speed')
    expect(reading.itemType).toBe('reading_block')
    expect(reading.strata).toEqual([READING_STRATUM])
    const item = reading.generate('identity')
    expect(item.params.model).toBe('gaussian')
    expect('options_count' in item).toBe(false)
    expect(validateItemInstance(item, reading)).toEqual([])
  })

  it('targets stratum 3 through the seed and refuses the others', () => {
    const item = reading.generate('demo', { stratum: 3 })
    expect(item.seed).toBe('demo@s3')
    expect(reading.generate('demo@s3')).toEqual(item)
    for (const k of [1, 2, 4, 5, 6]) expect(() => reading.generate('demo', { stratum: k })).toThrow(RangeError)
  })

  it('family_id is per passage: two seeds on one passage share it, different passages do not', () => {
    const byPassage = new Map<string, Set<string>>()
    for (let i = 0; i < 400; i++) {
      const item = reading.generate(`fam-${i}`)
      const set = byPassage.get(item.spec.passage_id) ?? new Set<string>()
      set.add(item.family_id)
      byPassage.set(item.spec.passage_id, set)
    }
    expect(byPassage.size).toBe(PASSAGES.length)
    for (const ids of byPassage.values()) expect(ids.size).toBe(1)
    const all = [...byPassage.values()].map((s) => [...s][0])
    expect(new Set(all).size).toBe(PASSAGES.length)
  })

  it('picks passages and keyed positions uniformly (chi-square over 10,000 blocks)', () => {
    const passageCounts = new Map<string, number>()
    const keyCounts = [0, 0, 0, 0]
    const n = 10_000
    for (let i = 0; i < n; i++) {
      const item = reading.generate(`uni-${i}`)
      passageCounts.set(item.spec.passage_id, (passageCounts.get(item.spec.passage_id) ?? 0) + 1)
      for (const k of item.key.indices) keyCounts[k] = (keyCounts[k] ?? 0) + 1
    }
    const chi2 = (counts: readonly number[]): number => {
      const total = counts.reduce((a, b) => a + b, 0)
      const e = total / counts.length
      return counts.reduce((s, c) => s + (c - e) ** 2 / e, 0)
    }
    // 99.9th percentiles: χ²(7) = 24.32, χ²(3) = 16.27.
    expect(chi2([...passageCounts.values()])).toBeLessThan(24.32)
    expect(chi2(keyCounts)).toBeLessThan(16.27)
  }, 60_000)

  it('the keyed option text is the authored key whatever the shuffle', () => {
    for (let i = 0; i < 200; i++) {
      const item = reading.generate(`keytext-${i}`)
      const p = PASSAGES.find((x) => x.id === item.spec.passage_id)
      expect(p).toBeDefined()
      item.spec.questions.forEach((q, j) => {
        const bq = p?.questions[j]
        expect(q.options[item.key.indices[j] as number]).toBe(bq?.options[bq.key_index])
        expect([...q.options].sort()).toEqual([...(bq?.options ?? [])].sort())
      })
    }
  })

  it('the observation of a passed block is the A10 Gaussian on PS', () => {
    const item = reading.generate('obs')
    const r = readingBlockObservation(item, responseAt(item, 238))
    expect(r.status).toBe('ok')
    if (r.status === 'ok') {
      const { sigma, ...rest } = r.observation
      expect(rest).toEqual({ kind: 'gaussian', axis: 'PS', lam: 0.25, d: Math.log(238) - 0.1, x: Math.log(238) })
      expect(sigma).toBeCloseTo(Math.sqrt(0.15 ** 2 + 0.1 ** 2), 15)
    }
  })
})
