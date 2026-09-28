/**
 * The `reading` family: reading-speed blocks gated by comprehension (ROADMAP M1.12, A10, A14;
 * DESIGN §3 row 10, §6.i Gutenberg row, §7.1, §14.6 example 13). One instance is one block
 * (item_type `reading_block`): a public-domain Gutenberg passage of 330–370 words from the
 * runtime bank (`passages.render.json`, `bank.ts`, projected from the authored `passages.json`
 * that only `authoring.ts` reads), three literal gate questions with seeded option
 * order (`gen.ts`), its verifier (`verify.ts`), the gate / wpm / skimming scorer (`score.ts`)
 * and the provisional norms and priors (`prior.ts`).
 *
 * `score(item, response)` returns `{ correct: null, value: ln(wpm) }` when the gate passed
 * (≥ 2/3 correct) and the block is not flagged as skimming (wpm > 900), else `{ correct: null }`.
 * The scorer input is {@link readingBlockObservation}, which also returns the wpm, gate result
 * and flags (the integrity layer, M1.19, should take the §13 client flags from `meta.flags`).
 *
 * generatorVersion 1.1.0: the review rewrite of the bank (`reading-passages-v2`: three gate
 * questions replaced, five re-optioned, two passages re-dated) and τ_res = 0.05 (A11, A17).
 * 1.2.0: the key is `{ indices }` only; the evidence spans stay in the authored bank, out of the
 * runtime payload (A14). 1.3.0: bank `reading-passages-v3`, three gate questions rewritten after
 * the independent solves found them guessable without the passage (franklin q2, darwin q1,
 * faraday q3; A14).
 */

import { defineFamily, type ItemInstance } from '../family'
import { buildReading } from './gen'
import { readingBlockObservation } from './score'
import type { ReadingKey, ReadingResponse, ReadingSpec } from './types'
import { verifyReading } from './verify'

export type ReadingItem = ItemInstance<ReadingSpec, ReadingKey>

export const reading = defineFamily<ReadingSpec, ReadingKey, ReadingResponse>({
  name: 'reading',
  axis: 'PS',
  facet: 'reading_speed',
  generatorVersion: '1.3.0',
  itemType: 'reading_block',
  strata: [3],
  build: buildReading,
  verify: verifyReading,
  score(item, response) {
    const r = readingBlockObservation(item, response)
    return r.status === 'ok' ? { correct: null, value: r.observation.x } : { correct: null }
  },
})

export { PASSAGES, READING_BANK, passageById, serializeRenderBank, toRenderBank } from './bank'
export { READING_OPTIONS, READING_QUESTIONS, READING_STRATUM, buildFromPassage, buildReading, readingStructure } from './gen'
export {
  NORM_WPM,
  PRE_1928_SHIFT,
  PUBLIC_DOMAIN_BEFORE,
  READING_NORMS_VERSION,
  READING_PRIOR,
  READING_PROVENANCE,
  READING_S,
  READING_TIME_MODEL,
  SIGMA_MEASUREMENT,
  TAU_RES,
  readingDifficulty,
  readingExpectedTimeS,
  readingFeatures,
  readingItemParams,
  readingStratum,
} from './prior'
export { GATE_MIN_CORRECT, SKIM_WPM, readingBlockObservation, readingResponseProblems, wordsPerMinute } from './score'
export type { ReadingBlockMeta, ReadingBlockResult, ReadingFlag } from './score'
export * from './text'
export type * from './types'
export { FLOAT_TOL, MAX_WORDS, MIN_PASSAGES, MIN_WORDS, passageChecks, verifyReading } from './verify'
export type { PassageUnderTest } from './verify'

export default reading
