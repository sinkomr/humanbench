/**
 * Scoring of a coding block (ROADMAP M1.11, A10; DESIGN §7.1 "Processing speed (coding)"):
 * correct responses per minute over the 90 s window, errors counted and flagged above 20%,
 * and the engine observation `{ kind: 'gaussian', axis: 'PS', lam, d, sigma, x }` with
 * x = ln(correct per minute) and sigma = √(SE² + τ_res²), SE = 1/√correct (see `prior.ts`).
 *
 * The observation's sigma is the block's OWN (1/correct), not `item.params.sigma` (the nominal
 * σ at the norm count, 60 correct, for planning only): at 10 correct σ ≈ 0.32, not 0.138.
 * Scorers must take the observation from {@link codingOutcome} (or the `observation` field
 * of {@link scoreCoding}'s result), never rebuild it from `item.params` and `value`.
 *
 * [SPEC] No correct response ⇒ no observation (x = ln 0 is undefined), PS stays "not measured".
 * This is deliberate, not a gap: with nothing attempted there is no speed evidence, and a
 * block answered all wrong (flagged: error rate 100%) measured a misunderstanding or a refusal,
 * not speed. Answering all wrong gains nothing over not responding (also no observation), and
 * a taker may leave any block unmeasured anyway, so it is no route to a better estimate. A
 * continuity-corrected x = ln((correct + ½)/1.5) is the alternative if M4.8 data say
 * otherwise.
 */

import type { Observation } from '../../engine'
import type { ItemScore } from '../family'
import { CODING_ERROR_FLAG_DENOM, type CodingItem, type CodingResponses, type CodingSymbol } from './config'
import { codingSigma } from './prior'

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
  readonly observation: Observation | null
}

/**
 * Check a response stream against the block: at most one response per stimulus, digits
 * 0–9, times finite, ≥ 0 and non-decreasing. Throws a RangeError on a malformed stream.
 */
export function checkResponses(item: CodingItem, responses: CodingResponses): void {
  if (!Array.isArray(responses)) throw new RangeError('coding responses must be an array')
  const n = item.spec.sequence.length
  if (responses.length > n) throw new RangeError(`${responses.length} responses for ${n} stimuli`)
  let last = 0
  responses.forEach((r, k) => {
    if (typeof r !== 'object' || r === null) throw new RangeError(`response ${k} must be an object`)
    const { digit, t_ms } = r
    if (!(Number.isInteger(digit) && digit >= 0 && digit <= 9)) throw new RangeError(`response ${k}: digit must be an integer 0–9, got ${String(digit)}`)
    if (!(typeof t_ms === 'number' && Number.isFinite(t_ms) && t_ms >= 0)) throw new RangeError(`response ${k}: t_ms must be finite and ≥ 0, got ${String(t_ms)}`)
    if (t_ms < last) throw new RangeError(`response ${k}: t_ms ${t_ms} is before the previous response (${last})`)
    last = t_ms
  })
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

/** The Gaussian observation for a block with `correct` ≥ 1 correct responses (σ from its own count). */
export function codingObservation(item: CodingItem, correctPerMin: number, correct: number): Observation {
  const p = item.params
  if (p.model !== 'gaussian') throw new RangeError(`coding item ${item.item_id} has params.model ${p.model}, not gaussian`)
  return { kind: 'gaussian', axis: item.axis, lam: p.lam, d: p.d, sigma: codingSigma(correct), x: Math.log(correctPerMin) }
}

/**
 * `score()` result of a coding block. The contract's {@link ItemScore} has room for the value
 * only, but a block's observation needs its own σ (1/correct) and the error flag, so the result
 * also carries them: `observation` (the engine observation, null when nothing was correct) and
 * `outcome` (counts and flags). It is an ItemScore subtype, so `ProceduralFamily.score` returns
 * it unchanged; typing these fields in the contract is an integration follow-up.
 */
export interface CodingScoreResult extends ItemScore {
  readonly correct: null
  readonly observation: Observation | null
  readonly outcome: CodingOutcome
}

/**
 * `score()` of a coding block: `correct` is always null (a block, §8); `value` is
 * x = ln(correct per minute), omitted when nothing was correct (no observation).
 */
export function scoreCoding(item: CodingItem, responses: CodingResponses): CodingScoreResult {
  const outcome = codingOutcome(item, responses)
  const o = outcome.observation
  const base = { correct: null, observation: o, outcome } as const
  return o === null || o.kind !== 'gaussian' ? base : { ...base, value: o.x }
}
