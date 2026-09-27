import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { GATE_MIN_CORRECT, SKIM_WPM, reading, readingBlockObservation, readingResponseProblems, wordsPerMinute, type ReadingItem, type ReadingResponse } from '.'

const item: ReadingItem = reading.generate('score-tests')
const W = item.spec.word_count
const keys = item.key.indices
const wrong = (k: number): number => (k + 1) % 4

/** Choices with the first `nRight` questions right and the rest wrong. */
const choicesWith = (nRight: number): number[] => keys.map((k, i) => (i < nRight ? k : wrong(k)))

const resp = (readingTimeMs: number, choices: readonly (number | null)[] = keys): ReadingResponse => ({ reading_time_ms: readingTimeMs, choices })

describe('wpm = words / (t / 60)', () => {
  it('350 words in 60 s is 350 wpm; in 30 s 700 wpm', () => {
    expect(wordsPerMinute(350, 60_000)).toBe(350)
    expect(wordsPerMinute(350, 30_000)).toBe(700)
    expect(wordsPerMinute(360, 24_000)).toBe(900)
    expect(wordsPerMinute(W, 90_000)).toBeCloseTo((W * 60) / 90, 12)
  })

  it('rejects a non-positive or non-finite time', () => {
    for (const t of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => wordsPerMinute(350, t)).toThrow(RangeError)
  })
})

describe('gate ≥ 2/3 (§3 row 10, A10)', () => {
  it.each([
    [3, true],
    [2, true],
    [1, false],
    [0, false],
  ])('%i of 3 correct → gate passed = %s', (nRight, passed) => {
    const r = readingBlockObservation(item, resp(60_000, choicesWith(nRight)))
    expect(r.meta.n_correct).toBe(nRight)
    expect(r.meta.gate_passed).toBe(passed)
    expect(r.status).toBe(passed ? 'ok' : 'no_observation')
    expect(reading.score(item, resp(60_000, choicesWith(nRight)))).toEqual(passed ? { correct: null, value: Math.log(W) } : { correct: null })
  })

  it('GATE_MIN_CORRECT is 2 of 3', () => {
    expect(GATE_MIN_CORRECT).toBe(2)
  })

  it('an unanswered question counts as wrong', () => {
    const r = readingBlockObservation(item, resp(60_000, [keys[0] as number, null, null]))
    expect(r.meta.n_correct).toBe(1)
    expect(r.status).toBe('no_observation')
    if (r.status === 'no_observation') {
      expect(r.reason).toBe('gate_failed')
      expect(r.detail).toBe('1/3 gate questions correct < 2 required')
    }
    const two = readingBlockObservation(item, resp(60_000, [keys[0] as number, keys[1] as number, null]))
    expect(two.status).toBe('ok')
  })
})

describe('skimming flag (wpm > 900): recorded in meta, no observation', () => {
  /** The block with its word count set to 360, so 24,000 ms is exactly 900 wpm. */
  const item360: ReadingItem = { ...item, spec: { ...item.spec, word_count: 360 } }

  it('exactly 900 wpm is not skimming; one millisecond faster is', () => {
    expect(SKIM_WPM).toBe(900)
    const at = readingBlockObservation(item360, resp(24_000))
    expect(at.meta.wpm).toBe(900)
    expect(at.meta.flags).toEqual([])
    expect(at.status).toBe('ok')
    const over = readingBlockObservation(item360, resp(23_999))
    expect(over.meta.wpm).toBeGreaterThan(900)
    expect(over.meta.flags).toEqual(['skimming'])
    expect(over).toMatchObject({ status: 'no_observation', reason: 'skimming' })
  })

  it('a skimmed block gives no observation and no score value, even with the gate passed', () => {
    const fast = readingBlockObservation(item, resp((W / 1_200) * 60_000))
    expect(fast.meta.flags).toEqual(['skimming'])
    expect(fast.meta.gate_passed).toBe(true)
    expect(fast).toMatchObject({ status: 'no_observation', reason: 'skimming' })
    expect(reading.score(item, resp((W / 1_200) * 60_000))).toEqual({ correct: null })
    // The review's probe: the whole passage "read" in 1 s with every key right (≈ 21,700 wpm).
    expect(reading.score(item, resp(1_000))).toEqual({ correct: null })
    const slow = readingBlockObservation(item, resp((W / 250) * 60_000))
    expect(slow.meta.flags).toEqual([])
    expect(slow.status).toBe('ok')
    // A failed gate is reported first; the flag is still recorded.
    const fastFailed = readingBlockObservation(item, resp((W / 2_000) * 60_000, choicesWith(0)))
    expect(fastFailed.meta.flags).toEqual(['skimming'])
    expect(fastFailed).toMatchObject({ status: 'no_observation', reason: 'gate_failed' })
  })

  it('a passed, unflagged block gives x = ln(wpm) with the item Gaussian params on PS (A10)', () => {
    fc.assert(
      fc.property(fc.double({ min: 1_000, max: 3_600_000, noNaN: true }), fc.integer({ min: 2, max: 3 }), (t, nRight) => {
        const r = readingBlockObservation(item, resp(t, choicesWith(nRight)))
        const s = reading.score(item, resp(t, choicesWith(nRight)))
        const wpm = (W * 60_000) / t
        expect(r.meta.wpm).toBe(wpm)
        expect(r.meta.norms_version).toBe('reading-v0')
        if (wpm > SKIM_WPM) {
          expect(r).toMatchObject({ status: 'no_observation', reason: 'skimming' })
          expect(s).toEqual({ correct: null })
          return
        }
        expect(r.status).toBe('ok')
        if (r.status !== 'ok' || item.params.model !== 'gaussian') return
        expect(r.observation).toEqual({ kind: 'gaussian', axis: 'PS', lam: item.params.lam, d: item.params.d, sigma: item.params.sigma, x: Math.log(wpm) })
        expect(s).toEqual({ correct: null, value: Math.log(wpm) })
      }),
      { numRuns: 300 },
    )
  })

  it('records the block meta', () => {
    const r = readingBlockObservation(item, resp(75_000))
    expect(r.meta).toEqual({
      passage_id: item.spec.passage_id,
      word_count: W,
      reading_time_ms: 75_000,
      wpm: W / 1.25,
      n_correct: 3,
      n_questions: 3,
      gate_passed: true,
      flags: [],
      norms_version: 'reading-v0',
    })
  })
})

describe('malformed responses', () => {
  it('lists every problem and scoring throws a RangeError', () => {
    expect(readingResponseProblems(null, 3, 4)).toEqual(['response must be an object'])
    expect(readingResponseProblems({ reading_time_ms: 0, choices: [0, 1, 2] }, 3, 4)).toEqual(['reading_time_ms must be a finite number > 0'])
    expect(readingResponseProblems({ reading_time_ms: 1000, choices: [0, 1] }, 3, 4)).toEqual(['choices must have 3 entries, got 2'])
    expect(readingResponseProblems({ reading_time_ms: 1000, choices: [0, 4, 1.5] }, 3, 4)).toEqual([
      'choices[1] must be an integer 0–3 or null',
      'choices[2] must be an integer 0–3 or null',
    ])
    expect(readingResponseProblems({ reading_time_ms: 1000 }, 3, 4)).toEqual(['choices must be an array'])
    for (const bad of [{ reading_time_ms: -5, choices: keys }, { reading_time_ms: 1000, choices: [0] }, { reading_time_ms: Number.NaN, choices: keys }]) {
      expect(() => readingBlockObservation(item, bad as ReadingResponse)).toThrow(RangeError)
      expect(() => reading.score(item, bad as ReadingResponse)).toThrow(RangeError)
    }
  })
})
