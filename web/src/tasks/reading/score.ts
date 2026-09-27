/**
 * Scoring of a reading block (ROADMAP A10; DESIGN §3 row 10, §7.1, §14.6 example 13).
 *
 * - Reading time t is from reveal to "Done" (the questions come after the passage is hidden);
 *   wpm = words / (t / 60 s) with the passage's WORD RULE count, computed as words·60000 / t_ms
 *   so that whole-number inputs on the 900 boundary are exact.
 * - Gate: the three literal questions; passed iff ≥ 2 are answered correctly (an unanswered
 *   question counts as wrong).
 * - Skimming flag: wpm > 900 (§14.6 example 13), recorded in `meta.flags` for the integrity
 *   layer (M1.19, §13 client flags).
 * - Observation, only if the gate passed (A10: the reading observation is dropped otherwise)
 *   and the block is not flagged as skimming ([SPEC]: a skimmed time is not a reading time, and
 *   x = ln(wpm) above ln 900 would put θ_PS beyond +5.7, so it is dropped like a failed gate):
 *   `{ kind: 'gaussian', axis: 'PS', lam: s, d, sigma, x: ln(wpm) }` with the item's params
 *   (`prior.ts`: s = 0.25, d = ln 238 − 0.1 for pre-1928 prose, sigma = √(0.15² + τ_res²)).
 *   So `family.score()`, which has no channel for flags, never returns a skimmed wpm either.
 */

import type { Observation } from '../../engine'
import type { ItemInstance } from '../family'
import { READING_NORMS_VERSION } from './prior'
import type { ReadingKey, ReadingResponse, ReadingSpec } from './types'

/** Minimum correct gate answers for the wpm to count (§3 row 10: gate ≥ 2/3). */
export const GATE_MIN_CORRECT = 2
/** Above this wpm the block is flagged as skimming (§14.6 example 13). */
export const SKIM_WPM = 900

export type ReadingFlag = 'skimming'

/** Everything recorded about a scored block, observation or not. */
export interface ReadingBlockMeta {
  readonly passage_id: string
  readonly word_count: number
  readonly reading_time_ms: number
  readonly wpm: number
  readonly n_correct: number
  readonly n_questions: number
  readonly gate_passed: boolean
  readonly flags: readonly ReadingFlag[]
  readonly norms_version: string
}

export type ReadingBlockResult =
  | { readonly status: 'ok'; readonly observation: Extract<Observation, { kind: 'gaussian' }>; readonly meta: ReadingBlockMeta }
  | { readonly status: 'no_observation'; readonly reason: 'gate_failed' | 'skimming'; readonly detail: string; readonly meta: ReadingBlockMeta }

/** Every way `response` fails to be a well-formed response to a block of `nQuestions` × `nOptions` (empty = ok). */
export function readingResponseProblems(response: unknown, nQuestions: number, nOptions: number): string[] {
  if (typeof response !== 'object' || response === null || Array.isArray(response)) return ['response must be an object']
  const r = response as Record<string, unknown>
  const out: string[] = []
  const t = r.reading_time_ms
  if (!(typeof t === 'number' && Number.isFinite(t) && t > 0)) out.push('reading_time_ms must be a finite number > 0')
  const c = r.choices
  if (!Array.isArray(c)) out.push('choices must be an array')
  else {
    if (c.length !== nQuestions) out.push(`choices must have ${nQuestions} entries, got ${c.length}`)
    c.forEach((x: unknown, i) => {
      if (x !== null && !(typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < nOptions)) {
        out.push(`choices[${i}] must be an integer 0–${nOptions - 1} or null`)
      }
    })
  }
  return out
}

/** Words per minute: words / (t / 60 s), as words·60000 / t_ms (one rounding, exact at 360 words in 24 s). */
export function wordsPerMinute(words: number, readingTimeMs: number): number {
  if (!(Number.isFinite(readingTimeMs) && readingTimeMs > 0)) throw new RangeError(`reading time must be finite and > 0, got ${readingTimeMs}`)
  return (words * 60_000) / readingTimeMs
}

/** Score a block (see the module comment). Throws a RangeError on a malformed response. */
export function readingBlockObservation(item: ItemInstance<ReadingSpec, ReadingKey>, response: ReadingResponse): ReadingBlockResult {
  const nQ = item.spec.questions.length
  const nOptions = item.spec.questions[0]?.options.length ?? 0
  const problems = readingResponseProblems(response, nQ, nOptions)
  if (problems.length > 0) throw new RangeError(`malformed reading response: ${problems.join('; ')}`)
  const p = item.params
  if (p.model !== 'gaussian') throw new RangeError(`reading items use Gaussian params (A10), got ${p.model}`)

  let nCorrect = 0
  for (let i = 0; i < nQ; i++) if (response.choices[i] === item.key.indices[i]) nCorrect++
  const wpm = wordsPerMinute(item.spec.word_count, response.reading_time_ms)
  const gatePassed = nCorrect >= GATE_MIN_CORRECT
  const meta: ReadingBlockMeta = {
    passage_id: item.spec.passage_id,
    word_count: item.spec.word_count,
    reading_time_ms: response.reading_time_ms,
    wpm,
    n_correct: nCorrect,
    n_questions: nQ,
    gate_passed: gatePassed,
    flags: wpm > SKIM_WPM ? ['skimming'] : [],
    norms_version: READING_NORMS_VERSION,
  }
  if (!gatePassed) {
    return { status: 'no_observation', reason: 'gate_failed', detail: `${nCorrect}/${nQ} gate questions correct < ${GATE_MIN_CORRECT} required`, meta }
  }
  if (meta.flags.includes('skimming')) {
    return { status: 'no_observation', reason: 'skimming', detail: `${wpm.toFixed(1)} wpm > ${SKIM_WPM} (skimming)`, meta }
  }
  return { status: 'ok', observation: { kind: 'gaussian', axis: 'PS', lam: p.lam, d: p.d, sigma: p.sigma, x: Math.log(wpm) }, meta }
}
