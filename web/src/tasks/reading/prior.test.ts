import { describe, expect, it } from 'vitest'
import { stratumOfB } from '../priors'
import {
  NORM_WPM,
  PASSAGES,
  PRE_1928_SHIFT,
  READING_PRIOR,
  READING_PROVENANCE,
  READING_S,
  TAU_RES,
  countPassageWords,
  reading,
  readingDifficulty,
  readingExpectedTimeS,
  readingFeatures,
  readingItemParams,
} from '.'

describe('provisional PS reading norms (A10, §7.1, §7.3)', () => {
  it('β = ln 238 (Brysbaert 2019) with the −0.1 pre-1928 shift, s = 0.25, sigma = √(0.15² + τ_res²)', () => {
    expect(NORM_WPM).toBe(238)
    expect(READING_S).toBe(0.25)
    expect(PRE_1928_SHIFT).toBe(-0.1)
    expect(TAU_RES).toBe(0.05)
    const p = readingItemParams(0.4)
    expect(p.model).toBe('gaussian')
    expect(p.lam).toBe(0.25)
    expect(p.d).toBe(Math.log(238) - 0.1)
    expect(Math.exp(p.d)).toBeCloseTo(215.35, 2)
    expect(p.sigma).toBeCloseTo(Math.sqrt(0.025), 15)
  })

  it('d = ln 238 − s·b keeps the location and the prior consistent', () => {
    for (const b of [-1, 0, 0.4, 2]) expect(readingItemParams(b).d).toBeCloseTo(Math.log(238) - 0.25 * b, 15)
    expect(readingItemParams(0).d).toBe(Math.log(238))
  })
})

describe('[SPEC] v0 difficulty prior (M1.P)', () => {
  it('b = 0.4·pre_1928 (the −0.1 shift / s), readability terms at 0, σ_b = 1', () => {
    expect(READING_PRIOR.anchorB).toBe(0)
    expect(READING_PRIOR.terms.pre_1928).toEqual({ beta: 0.4, centre: 0 })
    expect(READING_PRIOR.terms.mean_sentence_words).toEqual({ beta: 0, centre: 25 })
    expect(READING_PRIOR.terms.letters_per_word).toEqual({ beta: 0, centre: 4.5 })
    for (const p of PASSAGES) {
      const d = readingDifficulty(p)
      expect(d.b_prior).toBe(0.4)
      expect(d.sd_prior).toBe(1)
      expect(d.provenance).toBe(READING_PROVENANCE)
      expect(stratumOfB(d.b_prior)).toBe(3)
    }
    expect(READING_PROVENANCE).toMatch(/\[SPEC\] v0/)
    expect(READING_PROVENANCE).toMatch(/Brysbaert 2019/)
  })

  it('a post-1927 work would sit at b = 0, d = ln 238 (the era term switches at 1928)', () => {
    const p = PASSAGES[0]
    if (!p) throw new Error('empty bank')
    const at = (year: number): number => readingDifficulty({ ...p, source: { ...p.source, year, era: `${Math.floor(year / 10) * 10}s` } }).b_prior
    expect(at(1950)).toBe(0)
    expect(at(1928)).toBe(0)
    expect(at(1927)).toBe(0.4)
    expect(readingItemParams(at(1950)).d).toBe(Math.log(238))
  })

  it('records the regression features of each passage', () => {
    const f = readingFeatures(PASSAGES.find((p) => p.id === 'franklin-autobiography-1868') as (typeof PASSAGES)[number])
    expect(f).toEqual({
      passage_id: 'franklin-autobiography-1868',
      year: 1868,
      era: '1860s',
      pre_1928: true,
      words: 362,
      sentences: 9,
      mean_sentence_words: 362 / 9,
      letters_per_word: f.letters_per_word,
      n_questions: 3,
    })
    expect(f.letters_per_word).toBeGreaterThan(3.5)
    expect(f.letters_per_word).toBeLessThan(5.5)
  })
})

describe('[SPEC] v0 block time E[T] (§7.4)', () => {
  it('is 10 s + reading at exp(d) wpm + per question 5 s + 4 s per 50 words', () => {
    const item = reading.generate('time')
    const d = Math.log(238) - 0.1
    let expected = 10 + (60 * item.spec.word_count) / Math.exp(d)
    for (const q of item.spec.questions) expected += 5 + (4 * countPassageWords(q.stem) + 4 * q.options.reduce((s, o) => s + countPassageWords(o), 0)) / 50
    expect(item.expected_time_s).toBeCloseTo(expected, 9)
    expect(item.expected_time_s).toBe(readingExpectedTimeS(item.spec.word_count, d, item.spec.questions))
    expect(item.expected_time_s).toBeGreaterThan(100)
    expect(item.expected_time_s).toBeLessThan(160)
  })
})
