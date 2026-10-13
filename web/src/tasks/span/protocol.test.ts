import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { MalformedResponseError } from '../family'
import {
  advanceSpan,
  categoryCount,
  categoryOf,
  checkProtocol,
  isExactMatch,
  spanResponseTrials,
  spanStatus,
  spanTrialsGiven,
  trialCount,
  trialLength,
  type SpanProtocol,
  type SpanStatus,
} from './protocol'

const FWD: SpanProtocol = { start_length: 3, trials_per_length: 2, max_length: 10 }
const BWD: SpanProtocol = { start_length: 3, trials_per_length: 2, max_length: 9 }

/** The reactive procedure (generator 1.2.0 on; owner decision 2026-10-13). */
const RFWD: SpanProtocol = { ...FWD, procedure: 'reactive' }
const RBWD: SpanProtocol = { ...BWD, procedure: 'reactive' }

const T = true
const F = false

const outcome = (s: SpanStatus) => {
  if (!s.finished) throw new Error('expected a finished block')
  return s.outcome
}

describe('span protocol layout', () => {
  it('has 2 trials at each length 3 … max', () => {
    expect(trialCount(FWD)).toBe(16)
    expect(trialCount(BWD)).toBe(14)
    expect([0, 1, 2, 3, 14, 15].map((i) => trialLength(FWD, i))).toEqual([3, 3, 4, 4, 10, 10])
    expect(categoryCount(FWD)).toBe(8)
    expect(categoryCount(BWD)).toBe(7)
  })

  it('maps the longest passed length to the A10 category L − 2 (0 if none)', () => {
    expect([0, 3, 4, 7, 10].map((l) => categoryOf(FWD, l))).toEqual([0, 1, 2, 5, 8])
  })

  it('rejects impossible protocols', () => {
    expect(() => checkProtocol({ start_length: 0, trials_per_length: 2, max_length: 5 })).toThrow(RangeError)
    expect(() => checkProtocol({ start_length: 3, trials_per_length: 0, max_length: 5 })).toThrow(RangeError)
    expect(() => checkProtocol({ start_length: 6, trials_per_length: 2, max_length: 5 })).toThrow(RangeError)
    expect(() => checkProtocol({ start_length: 3, trials_per_length: 1.5, max_length: 5 })).toThrow(RangeError)
  })
})

describe('span state machine, the fixed procedure (M1.9; generator 1.1.0, kept for saved blocks)', () => {
  it('starts at length 3, trial 0', () => {
    expect(spanStatus(FWD, [])).toEqual({ finished: false, trial: 0, length: 3, longest_passed: 0 })
  })

  it('always gives the second trial of a length, even after a pass', () => {
    expect(spanStatus(FWD, [T])).toEqual({ finished: false, trial: 1, length: 3, longest_passed: 0 })
    expect(spanStatus(FWD, [F])).toEqual({ finished: false, trial: 1, length: 3, longest_passed: 0 })
    expect(spanStatus(FWD, [T, F])).toEqual({ finished: false, trial: 2, length: 4, longest_passed: 3 })
  })

  it('passes a length on ≥ 1 of 2 exactly correct trials', () => {
    expect(spanStatus(FWD, [F, T])).toEqual({ finished: false, trial: 2, length: 4, longest_passed: 3 })
    expect(spanStatus(FWD, [F, T, T, F, F, T])).toEqual({ finished: false, trial: 6, length: 6, longest_passed: 5 })
  })

  it('stops when both trials at a length fail', () => {
    expect(outcome(spanStatus(FWD, [F, F]))).toEqual({
      longest_passed: 0,
      category: 0,
      trials_given: 2,
      trials_correct: 0,
      stop: 'failed_length',
    })
    expect(outcome(spanStatus(FWD, [T, F, F, F]))).toEqual({
      longest_passed: 3,
      category: 1,
      trials_given: 4,
      trials_correct: 1,
      stop: 'failed_length',
    })
    expect(outcome(spanStatus(FWD, [T, T, F, T, T, F, F, F]))).toMatchObject({ longest_passed: 5, category: 3, trials_given: 8 })
  })

  it('stops after the maximum length: 10 forward/Corsi, 9 backward', () => {
    expect(outcome(spanStatus(FWD, Array<boolean>(16).fill(T)))).toEqual({
      longest_passed: 10,
      category: 8,
      trials_given: 16,
      trials_correct: 16,
      stop: 'max_length',
    })
    const bwd = Array.from({ length: 14 }, (_, i) => i % 2 === 1)
    expect(outcome(spanStatus(BWD, bwd))).toEqual({
      longest_passed: 9,
      category: 7,
      trials_given: 14,
      trials_correct: 7,
      stop: 'max_length',
    })
    // A failed final length still stops at max with the previous length as the outcome.
    expect(outcome(spanStatus(BWD, [...Array<boolean>(12).fill(T), F, F]))).toMatchObject({ longest_passed: 8, category: 6, stop: 'failed_length' })
  })

  it('refuses responses after the block finished', () => {
    expect(() => spanStatus(FWD, [F, F, T])).toThrow(RangeError)
    expect(() => spanStatus(FWD, Array<boolean>(17).fill(T))).toThrow(RangeError)
  })

  it('agrees with a reference model on every response stream (property)', () => {
    // Reference: walk lengths; given trials count, stop at the first all-fail length.
    const reference = (p: SpanProtocol, rs: readonly boolean[]) => {
      let i = 0
      let longest = 0
      for (let len = p.start_length; len <= p.max_length; len++) {
        const block = rs.slice(i, i + p.trials_per_length)
        i += p.trials_per_length
        if (block.length < p.trials_per_length) return { done: false as const, next: i - p.trials_per_length + block.length, longest }
        if (!block.includes(true)) return { done: true as const, used: i, longest }
        longest = len
      }
      return { done: true as const, used: i, longest }
    }
    const protocol = fc.record({
      start_length: fc.integer({ min: 1, max: 5 }),
      trials_per_length: fc.integer({ min: 1, max: 3 }),
      span: fc.integer({ min: 0, max: 8 }),
    })
    fc.assert(
      fc.property(protocol, fc.array(fc.boolean(), { maxLength: 40 }), ({ start_length, trials_per_length, span }, rs) => {
        const p = { start_length, trials_per_length, max_length: start_length + span }
        const ref = reference(p, rs)
        if (ref.done && rs.length > ref.used) {
          expect(() => spanStatus(p, rs)).toThrow(RangeError)
          return
        }
        const s = spanStatus(p, rs)
        if (!ref.done) {
          expect(s).toEqual({ finished: false, trial: ref.next, length: trialLength(p, ref.next), longest_passed: ref.longest })
        } else {
          const o = outcome(s)
          expect(o.trials_given).toBe(ref.used)
          expect(o.longest_passed).toBe(ref.longest)
          expect(o.category).toBe(categoryOf(p, ref.longest))
          expect(o.trials_correct).toBe(rs.filter(Boolean).length)
          expect(o.category).toBeGreaterThanOrEqual(0)
          expect(o.category).toBeLessThanOrEqual(categoryCount(p))
          expect(o.stop).toBe(ref.longest === p.max_length ? 'max_length' : 'failed_length')
        }
      }),
      { numRuns: 2_000 },
    )
  })

  it('reaches exactly the categories 0 … m (property over the stop length)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 11 }), (stopAt) => {
        // Pass every length below stopAt (first trial right), fail both at stopAt (if ≤ max).
        const rs: boolean[] = []
        for (let len = 3; len <= Math.min(stopAt, 10); len++) rs.push(len < stopAt, false)
        const o = outcome(spanStatus(FWD, rs))
        expect(o.category).toBe(Math.min(stopAt, 11) - 3)
      }),
    )
  })
})

describe('exact match and response streams (§14.6 examples 10–11)', () => {
  it('backward key of [7,2,9,4,1] is [1,4,9,2,7]; Corsi [3,8,1,6] matches only itself', () => {
    expect(isExactMatch([1, 4, 9, 2, 7], [1, 4, 9, 2, 7])).toBe(true)
    expect(isExactMatch([7, 2, 9, 4, 1], [1, 4, 9, 2, 7])).toBe(false)
    expect(isExactMatch([3, 8, 1, 6], [3, 8, 1, 6])).toBe(true)
    expect(isExactMatch([3, 8, 6, 1], [3, 8, 1, 6])).toBe(false)
  })

  it('is strict about length and type', () => {
    expect(isExactMatch([3, 8, 1], [3, 8, 1, 6])).toBe(false)
    expect(isExactMatch([3, 8, 1, 6, 2], [3, 8, 1, 6])).toBe(false)
    expect(isExactMatch(['3', '8', '1', '6'], [3, 8, 1, 6])).toBe(false)
    expect(isExactMatch('3816', [3, 8, 1, 6])).toBe(false)
    expect(isExactMatch(null, [3, 8, 1, 6])).toBe(false)
    expect(isExactMatch([], [])).toBe(true)
  })

  it('never matches a sparse (holey) response: blank or slot-filled entries are wrong', () => {
    expect(isExactMatch(new Array(3), [1, 2, 3])).toBe(false)
    const lastSlot: number[] = []
    lastSlot[2] = 3
    expect(isExactMatch(lastSlot, [1, 2, 3])).toBe(false)
    expect(isExactMatch([1, , 3], [1, 2, 3])).toBe(false)
    expect(isExactMatch([1, 2, undefined], [1, 2, 3])).toBe(false)
  })

  it('advances on raw responses and refuses streams longer than the block', () => {
    const p: SpanProtocol = { start_length: 3, trials_per_length: 2, max_length: 3 }
    const key = [
      [1, 2, 4],
      [5, 3, 5],
    ]
    expect(advanceSpan(p, key, [[1, 2, 4]])).toEqual({ finished: false, trial: 1, length: 3, longest_passed: 0 })
    expect(outcome(advanceSpan(p, key, [[9], [5, 3, 5]]))).toMatchObject({ longest_passed: 3, category: 1, stop: 'max_length' })
    expect(() => advanceSpan(p, key, [[1, 2, 4], [5, 3, 5], [1]])).toThrow(RangeError)
    // One error class across families (M1.F2): a MalformedResponseError, a RangeError.
    expect(() => advanceSpan(p, key, 'nope' as unknown as unknown[])).toThrow(MalformedResponseError)
    expect(() => advanceSpan(p, key, [[1, 2, 4], [5, 3, 5], [1]])).toThrow(MalformedResponseError)
    expect(() => advanceSpan(p, key, ['124'])).toThrow(MalformedResponseError)
  })
})

describe('span state machine, the reactive procedure (generator 1.2.0; owner decision 2026-10-13)', () => {
  it('a protocol without a procedure is the fixed one; an unknown procedure is refused', () => {
    expect(spanStatus(FWD, [T])).toEqual(spanStatus({ ...FWD, procedure: 'fixed' }, [T]))
    expect(() => checkProtocol({ ...FWD, procedure: 'adaptive' as never })).toThrow(RangeError)
  })

  it('one trial per length: a correct trial moves up, and the second sequence of that length is never shown', () => {
    expect(spanStatus(RFWD, [])).toEqual({ finished: false, trial: 0, length: 3, longest_passed: 0 })
    expect(spanStatus(RFWD, [T])).toEqual({ finished: false, trial: 2, length: 4, longest_passed: 3 })
    expect(spanStatus(RFWD, [T, T])).toEqual({ finished: false, trial: 4, length: 5, longest_passed: 4 })
    expect(spanTrialsGiven(RFWD, [T, T, T])).toEqual([0, 2, 4])
  })

  it('a miss gives one second attempt at the same length; right, it moves up', () => {
    expect(spanStatus(RFWD, [T, F])).toEqual({ finished: false, trial: 3, length: 4, longest_passed: 3 })
    expect(spanStatus(RFWD, [T, F, T])).toEqual({ finished: false, trial: 4, length: 5, longest_passed: 4 })
    expect(spanTrialsGiven(RFWD, [T, F, T, T])).toEqual([0, 2, 3, 4])
  })

  it('a second miss ends the block: the outcome is the longest passed length', () => {
    expect(outcome(spanStatus(RFWD, [F, F]))).toEqual({ longest_passed: 0, category: 0, trials_given: 2, trials_correct: 0, stop: 'failed_length' })
    expect(outcome(spanStatus(RFWD, [T, T, F, T, F, F]))).toEqual({ longest_passed: 5, category: 3, trials_given: 6, trials_correct: 3, stop: 'failed_length' })
    expect(() => spanStatus(RFWD, [F, F, T])).toThrow(MalformedResponseError)
  })

  it('stops after the maximum length: 8 trials forward and 7 backward for a taker who never misses', () => {
    const fwd = outcome(spanStatus(RFWD, new Array<boolean>(8).fill(T)))
    expect(fwd).toEqual({ longest_passed: 10, category: 8, trials_given: 8, trials_correct: 8, stop: 'max_length' })
    const bwd = outcome(spanStatus(RBWD, new Array<boolean>(7).fill(T)))
    expect(bwd).toEqual({ longest_passed: 9, category: 7, trials_given: 7, trials_correct: 7, stop: 'max_length' })
    expect(() => spanStatus(RBWD, new Array<boolean>(8).fill(T))).toThrow(MalformedResponseError)
    // The last length missed once and then passed still reaches the top.
    expect(outcome(spanStatus(RBWD, [T, T, T, T, T, T, F, T]))).toMatchObject({ longest_passed: 9, stop: 'max_length', trials_given: 8 })
  })

  it('agrees with a reference model on every response stream (property)', () => {
    // Reference: read the stream length by length; a length takes one result if it is true, else two.
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 0, max: 7 }), fc.array(fc.boolean(), { maxLength: 20 }), (start, extra, results) => {
        const p: SpanProtocol = { start_length: start, trials_per_length: 2, max_length: start + extra, procedure: 'reactive' }
        let i = 0
        let longest = 0
        let correct = 0
        let want: SpanStatus | null = null
        const given: number[] = []
        for (let length = start; length <= start + extra && want === null; length++) {
          const base = (length - start) * 2
          if (i >= results.length) want = { finished: false, trial: base, length, longest_passed: longest }
          else {
            given.push(base)
            if (results[i++]) {
              longest = length
              correct++
            } else if (i >= results.length) want = { finished: false, trial: base + 1, length, longest_passed: longest }
            else {
              given.push(base + 1)
              if (results[i++]) {
                longest = length
                correct++
              } else want = { finished: true, outcome: { longest_passed: longest, category: categoryOf(p, longest), trials_given: i, trials_correct: correct, stop: 'failed_length' } }
            }
          }
        }
        want ??= { finished: true, outcome: { longest_passed: longest, category: categoryOf(p, longest), trials_given: i, trials_correct: correct, stop: 'max_length' } }
        if (want.finished && results.length > i) {
          expect(() => spanStatus(p, results)).toThrow(MalformedResponseError)
          return
        }
        expect(spanStatus(p, results)).toEqual(want)
        expect(spanTrialsGiven(p, results)).toEqual(given)
        // Never more trials than sequences, never two trials at a length after a correct first one.
        expect(given.length).toBeLessThanOrEqual(trialCount(p))
        given.forEach((t, k) => {
          if (t % 2 === 1) expect(results[k - 1]).toBe(false)
        })
      }),
      { numRuns: 1000 },
    )
  })

  it('pairs each response with the sequence that was shown for it (the second attempt is compared with the second sequence)', () => {
    const key = [[1, 2, 4], [5, 7, 9], [2, 4, 6, 9], [8, 6, 3, 1]]
    const p: SpanProtocol = { start_length: 3, trials_per_length: 2, max_length: 4, procedure: 'reactive' }
    // Right at once at 3, then the first sequence of 4.
    expect(advanceSpan(p, key, [[1, 2, 4]])).toEqual({ finished: false, trial: 2, length: 4, longest_passed: 3 })
    // Missed at 3: the second sequence of 3 is what the next response is compared with.
    expect(advanceSpan(p, key, [[9, 9, 9], [5, 7, 9]])).toEqual({ finished: false, trial: 2, length: 4, longest_passed: 3 })
    expect(outcome(advanceSpan(p, key, [[9, 9, 9], [1, 2, 4]]))).toMatchObject({ longest_passed: 0, trials_given: 2 })
    expect(spanResponseTrials(p, key, [[9, 9, 9], [5, 7, 9], [2, 4, 6, 9]])).toEqual([1 - 1, 1, 2])
    expect(outcome(advanceSpan(p, key, [[1, 2, 4], [2, 4, 6, 9]]))).toMatchObject({ longest_passed: 4, stop: 'max_length', trials_given: 2 })
    expect(() => advanceSpan(p, key, [[1, 2, 4], [2, 4, 6, 9], [8, 6, 3, 1]])).toThrow(MalformedResponseError)
  })
})
