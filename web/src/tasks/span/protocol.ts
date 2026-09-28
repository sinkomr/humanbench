/**
 * The span block state machine (ROADMAP M1.9, A10; DESIGN §3 row 8, §14.6 examples 10–11).
 * Pure: no UI, no clock, no randomness. The renderer asks {@link spanStatus} (or
 * {@link advanceSpan} with the raw responses) what to show next after every trial.
 *
 * Rules (M1.9): start at length 3 with 2 trials per length; BOTH trials of a length are always
 * given (the classic WAIS / Corsi administration, so trials stay binomial data, §3 row 8). A
 * length is PASSED if ≥ 1 of its trials is exactly correct. The block stops when every trial
 * of a length fails, or after the last length (10 forward / 10 Corsi / 9 backward). The graded
 * outcome is the longest passed length; its GRM category (A10) is y = longest − 2, or 0 if no
 * length was passed. Passed lengths are always contiguous from the start length, so the
 * outcome is also the last length before the stop.
 *
 * Malformed input (M1.F2: one error class across families) throws a `MalformedResponseError`,
 * a RangeError: a response stream that is not an array, a trial response that is neither an
 * entered sequence (an array) nor missing (null / a hole), or a response after the block finished.
 */

import { MalformedResponseError } from '../family'

export interface SpanProtocol {
  readonly start_length: number
  readonly trials_per_length: number
  readonly max_length: number
}

/** Why a finished block stopped. */
export type SpanStop = 'failed_length' | 'max_length'

/** The graded outcome of a finished block. */
export interface SpanOutcome {
  /** Longest length with ≥ 1 exactly correct trial, or 0 if none. */
  readonly longest_passed: number
  /** GRM category (A10): longest_passed − (start_length − 1), or 0 if none passed. */
  readonly category: number
  readonly trials_given: number
  readonly trials_correct: number
  readonly stop: SpanStop
}

export type SpanStatus =
  | {
      readonly finished: false
      /** Index into `spec.trials` / `key.sequences` of the trial to give next. */
      readonly trial: number
      readonly length: number
      /** Longest length passed so far (0 if none). */
      readonly longest_passed: number
    }
  | { readonly finished: true; readonly outcome: SpanOutcome }

const isPositiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1

/** Throws a RangeError unless the protocol is 1 ≤ start ≤ max with ≥ 1 trial per length. */
export function checkProtocol(p: SpanProtocol): void {
  if (!(isPositiveInt(p.start_length) && isPositiveInt(p.max_length) && isPositiveInt(p.trials_per_length))) {
    throw new RangeError('span protocol lengths and trials per length must be positive integers')
  }
  if (p.max_length < p.start_length) throw new RangeError(`span max_length ${p.max_length} < start_length ${p.start_length}`)
}

/** Trials in a whole block (every length given): trials_per_length × (max − start + 1). */
export function trialCount(p: SpanProtocol): number {
  checkProtocol(p)
  return p.trials_per_length * (p.max_length - p.start_length + 1)
}

/** Length of trial i: start_length + ⌊i / trials_per_length⌋. */
export function trialLength(p: SpanProtocol, i: number): number {
  return p.start_length + Math.floor(i / p.trials_per_length)
}

/** Number of GRM categories above 0 (= thresholds): one per length from start to max. */
export function categoryCount(p: SpanProtocol): number {
  checkProtocol(p)
  return p.max_length - p.start_length + 1
}

/** GRM category of a longest passed length (A10): L − 2 for start 3, 0 if none passed. */
export function categoryOf(p: SpanProtocol, longestPassed: number): number {
  return longestPassed >= p.start_length ? longestPassed - p.start_length + 1 : 0
}

/**
 * Where a block stands after `results`, the exact-match flags of the trials given so far, in
 * order. Throws a RangeError if `results` runs past the end of the block (a response after it
 * finished).
 */
export function spanStatus(p: SpanProtocol, results: readonly boolean[]): SpanStatus {
  checkProtocol(p)
  const tpl = p.trials_per_length
  let longest = 0
  let correct = 0
  const finish = (used: number, stop: SpanStop): SpanStatus => {
    if (results.length > used) {
      throw new MalformedResponseError(`span block finished after ${used} trials, but ${results.length} responses were given`)
    }
    return {
      finished: true,
      outcome: { longest_passed: longest, category: categoryOf(p, longest), trials_given: used, trials_correct: correct, stop },
    }
  }
  for (let length = p.start_length; length <= p.max_length; length++) {
    const base = (length - p.start_length) * tpl
    const given = Math.min(Math.max(results.length - base, 0), tpl)
    let passed = false
    for (let t = 0; t < given; t++) {
      if (results[base + t] === true) {
        passed = true
        correct++
      }
    }
    if (given < tpl) return { finished: false, trial: base + given, length, longest_passed: longest }
    if (!passed) return finish(base + tpl, 'failed_length')
    longest = length
  }
  return finish(trialCount(p), 'max_length')
}

/**
 * Exact match (§14.6 ex. 10–11): the response is an array equal element for element to `expected`.
 * Compared index by index, not with `every`, which skips the holes of a sparse array: a blank
 * `new Array(n)` or a slot-filled `[ , , 6]` must not match.
 */
export function isExactMatch(response: unknown, expected: readonly number[]): boolean {
  if (!Array.isArray(response) || response.length !== expected.length) return false
  for (let i = 0; i < expected.length; i++) if (response[i] !== expected[i]) return false
  return true
}

/**
 * Feed a response stream through the state machine: response i is scored against
 * `expected[i]` by {@link isExactMatch} (a missing trial response, null or a hole, is wrong).
 * Returns the next trial or the finished outcome; throws a `MalformedResponseError` (a
 * RangeError) on a stream that is not an array, a trial response that is not an array or
 * missing, or a response after the block finished or with no expected sequence.
 */
export function advanceSpan(p: SpanProtocol, expected: readonly (readonly number[])[], responses: readonly unknown[]): SpanStatus {
  if (!Array.isArray(responses)) throw new MalformedResponseError('span responses must be an array (one entry per trial given)')
  // Array.from visits every index (a hole is an undefined, i.e. wrong, response); map would skip it.
  const results = Array.from(responses, (r, i) => {
    const exp = expected[i]
    if (exp === undefined) throw new MalformedResponseError(`span response ${i} has no trial (the block has ${expected.length})`)
    if (!(r === undefined || r === null || Array.isArray(r))) {
      throw new MalformedResponseError(`span response ${i} must be the entered sequence (an array) or missing, got ${typeof r}`)
    }
    return isExactMatch(r, exp)
  })
  return spanStatus(p, results)
}
