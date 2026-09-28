/**
 * Synthetic reading responses for the block-aware property suite (ROADMAP M1.12, M1.F2). TEST
 * SUPPORT ONLY: used by the reading and registry tests, never by the app (not re-exported from
 * `index.ts`).
 */

import type { Rng } from '../../engine'
import type { ReadingItem } from '.'
import type { ReadingResponse } from './types'

/** Reading time in ms for the passage at `wpm` words per minute (whole ms, at least 1). */
const timeAt = (item: ReadingItem, wpm: number): number => Math.max(1, Math.round((item.spec.word_count * 60_000) / wpm))

/** A reader at 120–600 wpm who answers ≥ 2 of the 3 gate questions: always an observation (M1.F2 `validResponse`). */
export function readingValidResponse(item: ReadingItem, rng: Rng): ReadingResponse {
  const wrong = rng.int(-1, item.key.indices.length - 1) // at most one wrong answer
  const nOptions = item.spec.questions[0]?.options.length ?? 4
  return {
    reading_time_ms: timeAt(item, rng.int(120, 600)),
    choices: item.key.indices.map((k, i) => (i === wrong ? (k + 1) % nOptions : k)),
  }
}

/** A well-formed block without an observation: a failed gate (≤ 1 right) or skimming (> 900 wpm) (M1.F2 `invalidResponse`). */
export function readingInvalidResponse(item: ReadingItem, rng: Rng): ReadingResponse {
  const nOptions = item.spec.questions[0]?.options.length ?? 4
  if (rng.next() < 0.5) {
    return { reading_time_ms: timeAt(item, rng.int(120, 600)), choices: item.key.indices.map((k, i) => (i === 0 ? null : (k + 1) % nOptions)) }
  }
  return { reading_time_ms: timeAt(item, rng.int(950, 3000)), choices: [...item.key.indices] }
}

/** Malformed responses (M1.F2): wrong shapes, out-of-range choices, non-positive times. */
export function readingMalformedResponses(item: ReadingItem): unknown[] {
  const choices = [...item.key.indices]
  const nOptions = item.spec.questions[0]?.options.length ?? 4
  return [
    [],
    { choices },
    { reading_time_ms: 60_000 },
    { reading_time_ms: 0, choices },
    { reading_time_ms: -5, choices },
    { reading_time_ms: 60_000, choices: choices.slice(1) },
    { reading_time_ms: 60_000, choices: [nOptions, ...choices.slice(1)] },
    { reading_time_ms: 60_000, choices: ['0', ...choices.slice(1)] },
  ]
}
