/**
 * The span block state machine (ROADMAP M1.9, A10; DESIGN §3 row 8, §14.6 examples 10–11).
 * Pure: no UI, no clock, no randomness. The renderer asks {@link spanStatus} (or
 * {@link advanceSpan} with the raw responses) what to show next after every trial.
 *
 * Rules. Every block starts at length 3 and has 2 sequences per length. A length is PASSED by one
 * exactly correct trial. The graded outcome is the longest passed length; its GRM category (A10) is
 * y = longest − 2, or 0 if no length was passed. Passed lengths are always contiguous from the start
 * length, so the outcome is also the last length before the stop. How the trials of a length are
 * given is the protocol's `procedure`:
 *
 * - **reactive** (generator 1.2.0 on; owner decision 2026-10-13): ONE trial per length. A correct
 *   trial moves up to the next length; a miss gives one second attempt at that length, with the
 *   length's second sequence; a second miss ends the block. So a taker who makes no mistake sees
 *   3, 4, 5, …, and nobody sees a second sequence of a length they just got right.
 * - **fixed** (generator 1.1.0; M1.9, the classic WAIS / Corsi administration): BOTH trials of a
 *   length are always given, and the block stops when both fail.
 *
 * Under either the block also stops after the last length (10 forward / 10 Corsi / 9 backward).
 * A length is passed with the same probability under both (1 − (1 − p)² for a trial that succeeds
 * with probability p), so the graded outcome has one distribution: `prior.ts`, "Why the scoring
 * model stands".
 *
 * A response stream has one entry per trial GIVEN, in the order given. Under the reactive procedure
 * entry i is not sequence i of the block: {@link spanTrialsGiven} names the sequence of each.
 *
 * Malformed input (M1.F2: one error class across families) throws a `MalformedResponseError`,
 * a RangeError: a response stream that is not an array, a trial response that is neither an
 * entered sequence (an array) nor missing (null / a hole), an entered element that is neither a
 * symbol of the task (digits 1–9, Corsi blocks 0–8) nor a blank slot (null / a hole), or a
 * response after the block finished. A well-formed wrong answer (a wrong symbol, the wrong
 * length, blank slots, a missing trial) is wrong, not malformed.
 */

import { MalformedResponseError } from '../family'
import type { SpanProcedure } from './config'

export interface SpanProtocol {
  readonly start_length: number
  /** Sequences per length: the most trials a length can take. */
  readonly trials_per_length: number
  readonly max_length: number
  /** How the trials of a length are given (module comment). Default `fixed`: what a block without the field ran. */
  readonly procedure?: SpanProcedure
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

/** Throws a RangeError unless the protocol is 1 ≤ start ≤ max with ≥ 1 trial per length and a known procedure. */
export function checkProtocol(p: SpanProtocol): void {
  if (!(isPositiveInt(p.start_length) && isPositiveInt(p.max_length) && isPositiveInt(p.trials_per_length))) {
    throw new RangeError('span protocol lengths and trials per length must be positive integers')
  }
  if (!(p.procedure === undefined || p.procedure === 'fixed' || p.procedure === 'reactive')) {
    throw new RangeError(`span procedure must be fixed or reactive, got ${JSON.stringify(p.procedure)}`)
  }
  if (p.max_length < p.start_length) throw new RangeError(`span max_length ${p.max_length} < start_length ${p.start_length}`)
}

/** Sequences in a whole block, which is the most trials it can take: trials_per_length × (max − start + 1). */
export function trialCount(p: SpanProtocol): number {
  checkProtocol(p)
  return p.trials_per_length * (p.max_length - p.start_length + 1)
}

/** Length of sequence i of the block: start_length + ⌊i / trials_per_length⌋. */
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

/** A block walked through the trials given so far. */
interface Walk {
  readonly status: SpanStatus
  /** The sequence (index into `spec.trials` / `key.sequences`) each trial given so far showed, in order. */
  readonly given: readonly number[]
}

/**
 * The state machine itself: `n` trials have been given, and `correct(i, trial)` says whether the
 * i-th of them, which showed sequence `trial`, was exactly right. Throws a `MalformedResponseError`
 * when `n` runs past the end of the block.
 */
function walk(p: SpanProtocol, n: number, correct: (i: number, trial: number) => boolean): Walk {
  checkProtocol(p)
  const tpl = p.trials_per_length
  const reactive = p.procedure === 'reactive'
  const given: number[] = []
  let longest = 0
  let nCorrect = 0
  const finish = (stop: SpanStop): Walk => {
    if (n > given.length) {
      throw new MalformedResponseError(`span block finished after ${given.length} trials, but ${n} responses were given`)
    }
    const outcome: SpanOutcome = { longest_passed: longest, category: categoryOf(p, longest), trials_given: given.length, trials_correct: nCorrect, stop }
    return { status: { finished: true, outcome }, given }
  }
  for (let length = p.start_length; length <= p.max_length; length++) {
    const base = (length - p.start_length) * tpl
    let passed = false
    for (let t = 0; t < tpl; t++) {
      // Reactive: a correct trial moves up at once; the length's later sequences are never shown.
      if (reactive && passed) break
      const i = given.length
      if (i >= n) return { status: { finished: false, trial: base + t, length, longest_passed: longest }, given }
      given.push(base + t)
      if (correct(i, base + t)) {
        passed = true
        nCorrect++
      }
    }
    if (!passed) return finish('failed_length')
    longest = length
  }
  return finish('max_length')
}

/**
 * Where a block stands after `results`, the exact-match flags of the trials given so far, in the
 * order given. Throws a `MalformedResponseError` (a RangeError) if `results` runs past the end of
 * the block (a response after it finished).
 */
export function spanStatus(p: SpanProtocol, results: readonly boolean[]): SpanStatus {
  return walk(p, results.length, (i) => results[i] === true).status
}

/**
 * The sequence each trial given so far showed (indices into `spec.trials` / `key.sequences`), for
 * the same `results` as {@link spanStatus}. Fixed: 0, 1, 2, …; reactive: the first sequence of each
 * length, and its second only after a miss.
 */
export function spanTrialsGiven(p: SpanProtocol, results: readonly boolean[]): number[] {
  return [...walk(p, results.length, (i) => results[i] === true).given]
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
 * Feed a response stream through the state machine: the i-th response is scored by
 * {@link isExactMatch} against the expected sequence of the trial the machine gave i-th (a missing
 * trial response, null or a hole, is wrong). Returns the next trial or the finished outcome; throws a
 * `MalformedResponseError` (a RangeError) on a stream that is not an array, a trial response that is
 * not an array or missing, or a response after the block finished. With `symbols`
 * (the task's alphabet; the family scorer always passes it), every entered element must also be
 * one of them or a blank slot (null / a hole: a UI that fills slots by index leaves holes, which
 * JSON writes as null): a digit 10, a Corsi block 9, "3" or 1.5 is a renderer bug, not a wrong
 * answer, so it throws instead of scoring as a failed trial (M1.F2).
 */
export function advanceSpan(
  p: SpanProtocol,
  expected: readonly (readonly number[])[],
  responses: readonly unknown[],
  symbols?: readonly number[],
): SpanStatus {
  return walkResponses(p, expected, responses, symbols).status
}

/** {@link advanceSpan}'s walk, with the sequence each response answered. */
function walkResponses(p: SpanProtocol, expected: readonly (readonly number[])[], responses: readonly unknown[], symbols?: readonly number[]): Walk {
  if (!Array.isArray(responses)) throw new MalformedResponseError('span responses must be an array (one entry per trial given)')
  const alphabet = symbols === undefined ? null : new Set(symbols)
  // Indexed, not forEach / map, so the holes of a sparse stream are visited (a hole is a missing, i.e. wrong, response).
  for (let i = 0; i < responses.length; i++) {
    const r: unknown = responses[i]
    if (i >= expected.length) throw new MalformedResponseError(`span response ${i} has no trial (the block has ${expected.length})`)
    if (!(r === undefined || r === null || Array.isArray(r))) {
      throw new MalformedResponseError(`span response ${i} must be the entered sequence (an array) or missing, got ${typeof r}`)
    }
    if (alphabet !== null && Array.isArray(r)) {
      // Indexed, not for…of / every, so holes are visited (and allowed) too.
      for (let j = 0; j < r.length; j++) {
        const v: unknown = r[j]
        if (!(v === undefined || v === null || (typeof v === 'number' && alphabet.has(v)))) {
          throw new MalformedResponseError(`span response ${i} element ${j} must be a symbol of the task or blank, got ${typeof v === 'string' ? JSON.stringify(v) : String(v)}`)
        }
      }
    }
  }
  return walk(p, responses.length, (i, trial) => {
    const exp = expected[trial]
    if (exp === undefined) throw new MalformedResponseError(`span trial ${trial} has no expected sequence (the block has ${expected.length})`)
    return isExactMatch(responses[i], exp)
  })
}

/**
 * The sequence (index into `expected`) each response of a stream answered, in order: what a reader
 * of a saved block needs to pair an entry with its stimulus. Throws as {@link advanceSpan} does.
 */
export function spanResponseTrials(p: SpanProtocol, expected: readonly (readonly number[])[], responses: readonly unknown[], symbols?: readonly number[]): number[] {
  return [...walkResponses(p, expected, responses, symbols).given]
}
