/**
 * Scoring of a coding block (ROADMAP M1.11, A10; DESIGN §7.1 "Processing speed (coding)"):
 * correct responses per minute over the 90 s window, errors counted and flagged above 20%,
 * and the engine observation `{ kind: 'gaussian', axis: 'PS', lam, d, sigma, x }` with
 * x = ln(correct per minute) and sigma = √(SE² + τ_res²), SE = 1/√correct (see `prior.ts`),
 * τ_res = `item.params.sigma` (the one meaning of a Gaussian block's sigma, M1.F2). Scorers take
 * the observation from `coding.score()` ({@link scoreCoding}, a `BlockScore`) or
 * {@link codingOutcome}, never rebuild it from `item.params`. A malformed stream throws a
 * `MalformedResponseError` (a RangeError, as in every family).
 *
 * [SPEC] No correct response ⇒ no observation (x = ln 0 is undefined), PS stays "not measured".
 * This is deliberate, not a gap: with nothing attempted there is no speed evidence, and a
 * block answered all wrong (flagged: error rate 100%) measured a misunderstanding or a refusal,
 * not speed. Answering all wrong gains nothing over not responding (also no observation), and
 * a taker may leave any block unmeasured anyway, so it is no route to a better estimate. A
 * continuity-corrected x = ln((correct + ½)/1.5) is the alternative if M4.8 data say
 * otherwise.
 */

import { MalformedResponseError, blockScore, type BlockObservation, type BlockScore } from '../family'
import { CODING_ERROR_FLAG_DENOM, type CodingItem, type CodingResponses, type CodingSymbol } from './config'

/** The outcome of a block's response stream (snake_case: it is dumped for the bank parity check). */
export interface CodingOutcome {
  /** Responses inside the window [0, duration). */
  readonly attempted: number
  readonly correct: number
  /** attempted − correct. */
  readonly errors: number
  /** Responses at or after the end of the window (not counted). */
  readonly late: number
  /** errors / attempted (0 when nothing was attempted). */
  readonly error_rate: number
  /** error_rate > 20% (M1.11); an integrity flag, the observation is still formed. */
  readonly high_error_rate: boolean
  /** Every stimulus was answered inside the window: the rate is at the block's ceiling. */
  readonly exhausted: boolean
  readonly correct_per_min: number
  /** The engine observation, or null when nothing was correct (ln 0 is undefined). */
  readonly observation: BlockObservation | null
}

/**
 * Check a response stream against the block: at most one response per stimulus, digits
 * 0–9, times finite, ≥ 0 and non-decreasing. Throws a `MalformedResponseError` (a RangeError)
 * on a malformed stream.
 */
export function checkResponses(item: CodingItem, responses: CodingResponses): void {
  if (!Array.isArray(responses)) throw new MalformedResponseError('coding responses must be an array')
  const n = item.spec.sequence.length
  if (responses.length > n) throw new MalformedResponseError(`${responses.length} responses for ${n} stimuli`)
  let last = 0
  // An index loop, not forEach: forEach skips the holes of a sparse array, which are malformed too.
  for (let k = 0; k < responses.length; k++) {
    const r: unknown = responses[k]
    if (typeof r !== 'object' || r === null) throw new MalformedResponseError(`response ${k} must be an object`)
    const { digit, t_ms } = r as { digit?: unknown; t_ms?: unknown }
    if (!(typeof digit === 'number' && Number.isInteger(digit) && digit >= 0 && digit <= 9)) {
      throw new MalformedResponseError(`response ${k}: digit must be an integer 0–9, got ${String(digit)}`)
    }
    if (!(typeof t_ms === 'number' && Number.isFinite(t_ms) && t_ms >= 0)) throw new MalformedResponseError(`response ${k}: t_ms must be finite and ≥ 0, got ${String(t_ms)}`)
    if (t_ms < last) throw new MalformedResponseError(`response ${k}: t_ms ${t_ms} is before the previous response (${last})`)
    last = t_ms
  }
}

/** Score a response stream (the k-th response answers stimulus k). Throws on a malformed stream. */
export function codingOutcome(item: CodingItem, responses: CodingResponses): CodingOutcome {
  checkResponses(item, responses)
  const { sequence, duration_s } = item.spec
  const windowMs = duration_s * 1000
  let attempted = 0
  let correct = 0
  for (const [k, r] of responses.entries()) {
    if (r.t_ms >= windowMs) break // times are non-decreasing: the rest are late too
    attempted++
    if (r.digit === item.key.table[sequence[k] as CodingSymbol]) correct++
  }
  const errors = attempted - correct
  const correctPerMin = correct / (duration_s / 60)
  return {
    attempted,
    correct,
    errors,
    late: responses.length - attempted,
    error_rate: attempted === 0 ? 0 : errors / attempted,
    // errors / attempted > 20% compared in integers (5·errors > attempted), so it is exact.
    high_error_rate: CODING_ERROR_FLAG_DENOM * errors > attempted,
    exhausted: attempted === sequence.length,
    correct_per_min: correctPerMin,
    observation: correct === 0 ? null : codingObservation(item, correctPerMin, correct),
  }
}

/**
 * The Gaussian observation for a block with `correct` ≥ 1 correct responses: σ = √(1/correct +
 * τ_res²), the Poisson SE of its own count and τ_res = `params.sigma` (M1.F2).
 */
export function codingObservation(item: CodingItem, correctPerMin: number, correct: number): BlockObservation {
  const p = item.params
  if (p.model !== 'gaussian') throw new RangeError(`coding item ${item.item_id} has params.model ${p.model}, not gaussian`)
  if (!(Number.isInteger(correct) && correct >= 1)) throw new RangeError(`codingObservation(): correct must be an integer ≥ 1, got ${correct}`)
  return { kind: 'gaussian', axis: item.axis, lam: p.lam, d: p.d, sigma: Math.sqrt(1 / correct + p.sigma * p.sigma), x: Math.log(correctPerMin) }
}

/** The integrity flag of a block whose error rate exceeds 20% (M1.11; §13 client flags, M1.19). */
export const CODING_HIGH_ERROR_RATE = 'high_error_rate'
/** Why a block without a correct response has no observation (ln 0 is undefined). */
export const CODING_NO_CORRECT = 'no_correct_responses'

/**
 * `score()` of a coding block (M1.F2 {@link BlockScore}): the Gaussian observation of a block
 * with ≥ 1 correct response, else none with the reason "no_correct_responses"; the flag
 * "high_error_rate" when errors / attempted > 20%, with or without an observation. The counts
 * are {@link codingOutcome}'s.
 */
export function scoreCoding(item: CodingItem, responses: CodingResponses): BlockScore {
  const outcome = codingOutcome(item, responses)
  const flags = outcome.high_error_rate ? [CODING_HIGH_ERROR_RATE] : []
  return outcome.observation === null ? blockScore(null, flags, [CODING_NO_CORRECT]) : blockScore(outcome.observation, flags)
}
