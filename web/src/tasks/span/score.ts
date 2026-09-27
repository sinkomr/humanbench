/**
 * Scoring of a span block (ROADMAP M1.9, A10; DESIGN §7.1 GRM, §14.6 examples 10–11): exact
 * match per trial, the state machine for the graded outcome, and the engine observation
 * `{ kind: 'grm', axis: 'WM', a, b, y }` with the item's (provisional) GRM parameters.
 */

import type { Observation } from '../../engine'
import type { ScoreResult } from '../family'
import type { SpanItem, SpanResponse } from './config'
import { advanceSpan, type SpanOutcome, type SpanProtocol, type SpanStatus } from './protocol'

/** The protocol recorded in a block's spec. */
export function itemProtocol(item: SpanItem): SpanProtocol {
  const { start_length, trials_per_length, max_length } = item.spec
  return { start_length, trials_per_length, max_length }
}

/**
 * Run a block's response stream (one entry per trial given, in order) through the state
 * machine: the next trial to give, or the finished outcome. Throws a RangeError on a response
 * after the block finished.
 */
export function runBlock(item: SpanItem, responses: SpanResponse): SpanStatus {
  return advanceSpan(itemProtocol(item), item.key.sequences, responses)
}

/**
 * The engine observation of a finished block: `{ kind: 'grm', axis, a, b, y }` with the item's
 * GRM parameters and y = the outcome's category. Throws if the item is not a GRM block or y is
 * outside 0 … thresholds.
 */
export function spanObservation(item: SpanItem, outcome: SpanOutcome): Observation {
  const p = item.params
  if (p.model !== 'grm') throw new RangeError(`span item ${item.item_id} has params.model ${p.model}, not grm`)
  const y = outcome.category
  if (!(Number.isInteger(y) && y >= 0 && y <= p.b.length)) {
    throw new RangeError(`span category ${y} is outside 0..${p.b.length}`)
  }
  return { kind: 'grm', axis: item.axis, a: p.a, b: [...p.b], y }
}

/**
 * `score()` of a span block: `correct` is always null (a block, §8); `value` is the GRM category
 * of a finished block and is omitted while the block is unfinished (no observation yet).
 */
export function scoreSpan(item: SpanItem, responses: SpanResponse): ScoreResult {
  const status = runBlock(item, responses)
  return status.finished ? { correct: null, value: status.outcome.category } : { correct: null }
}
