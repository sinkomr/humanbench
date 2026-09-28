/**
 * Synthetic span responses for the block-aware property suite (ROADMAP M1.9, M1.F2). TEST
 * SUPPORT ONLY: used by the span and registry tests, never by the app (not re-exported from
 * `index.ts`).
 */

import type { Rng } from '../../engine'
import { spanSymbols, type SpanItem } from './config'
import { runBlock } from './score'

/**
 * A wrong entry for `expected`: the same length, first element changed to another symbol of
 * the task (never an exact match, never malformed: Corsi 8 → 7, digit 9 → 8).
 */
function wrongEntry(item: SpanItem, expected: readonly number[]): number[] {
  const out = [...expected]
  const top = Math.max(...spanSymbols(item.spec.task))
  out[0] = (expected[0] as number) === top ? top - 1 : (expected[0] as number) + 1
  return out
}

/**
 * A taker with span `level` (3 … max + 1, drawn from `rng`) who enters trial i exactly iff its
 * length ≤ level and misses the first trial of each longer length, run until the block finishes:
 * a finished block, so it always yields an observation (M1.F2 `validResponse`).
 */
export function spanValidResponse(item: SpanItem, rng: Rng): number[][] {
  const level = rng.int(item.spec.start_length - 1, item.spec.max_length + 1)
  const out: number[][] = []
  for (;;) {
    const status = runBlock(item, out)
    if (status.finished) return out
    const expected = item.key.sequences[status.trial] as readonly number[]
    out.push(status.length <= level && rng.next() < 0.95 ? [...expected] : wrongEntry(item, expected))
  }
}

/** A well-formed block that has not finished (0 or 1 trials given): no observation yet (M1.F2 `invalidResponse`). */
export function spanInvalidResponse(item: SpanItem, rng: Rng): (number[] | null)[] {
  const first = item.key.sequences[0] as readonly number[]
  return rng.next() < 0.5 ? [] : [rng.next() < 0.5 ? [...first] : null]
}

/**
 * Malformed streams (M1.F2): not an array, a non-array trial entry, an entered element outside
 * the task's symbols (the first key with one element replaced: 10, −1, 1.5, "3", {}), a response
 * after the block finished.
 */
export function spanMalformedResponses(item: SpanItem, rng: Rng): unknown[] {
  const done = spanValidResponse(item, rng)
  const first = item.key.sequences[0] as readonly number[]
  const withElement = (v: unknown): unknown[] => [[v, ...first.slice(1)]]
  return [
    '1 2 3',
    [123],
    [{ digits: [1, 2, 3] }],
    ...[10, -1, 9.5, Number.NaN, '3', {}, true].map(withElement),
    [...done, [...first]],
    item.key.sequences.map((s) => [...s]).concat([[1]]),
  ]
}
