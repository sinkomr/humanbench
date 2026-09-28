/**
 * Processing speed (Gs): the symbol-digit coding block (ROADMAP M1.11, A10; DESIGN §3 row 10,
 * §7.1). Family `coding`, axis PS, facet coding, item type `coding_block`; one instance is ONE
 * WHOLE 90 s block: a legend (a seeded random bijection of 9 glyphs to the digits 1–9, i.e. a
 * new key table per session) and a 200-glyph stream with no immediate repeats and balanced
 * counts. Gaussian params per A10 (`prior.ts`), a single stratum (3). `score.ts` turns a
 * response stream into log(correct per minute), the error count and flag, and the engine
 * observation.
 *
 * INTEGRATORS: `coding.score()` returns the M1.F2 `BlockScore`: the observation (its own
 * σ = √(1/correct + τ_res²), ≈ 0.32 at 10 correct), or none with the reason, and the
 * "high_error_rate" flag; {@link codingOutcome} has the counts. `params.sigma` is τ_res only.
 *
 * Generator version 1.1.0 (contract v2, M1.F2): kind 'block', `sibling_group`, params.sigma =
 * τ_res (was the nominal σ at the norm count), `score()` returns a `BlockScore`.
 */

import { defineFamily } from '../family'
import { CODING_DURATION_S, CODING_SPEC_FIELDS, type CodingItem, type CodingKey, type CodingResponses, type CodingSpec } from './config'
import { codingStructure, drawSequence, drawTable, legendOf } from './gen'
import { codingDifficulty, codingExpectedTime, codingParams, codingStratum } from './prior'
import { scoreCoding } from './score'
import { verifyCoding } from './verify'

export * from './config'
export { balancedCounts, codingStructure, drawSequence, drawTable, legendOf, sequencePattern } from './gen'
export {
  CODING_BETA,
  CODING_NORM_CORRECT,
  CODING_NORM_CPM,
  CODING_PRIOR,
  CODING_PROVENANCE,
  CODING_RATE_SCALE,
  CODING_TAU_RES,
  codingDifficulty,
  codingExpectedTime,
  codingFeatures,
  codingParams,
  codingSigma,
  codingStratum,
} from './prior'
export { CODING_HIGH_ERROR_RATE, CODING_NO_CORRECT, checkResponses, codingObservation, codingOutcome, scoreCoding, type CodingOutcome } from './score'
export { glyphCounts, hasImmediateRepeat, verifyCoding } from './verify'

/** Current generator version of the coding family. */
export const CODING_GENERATOR_VERSION = '1.1.0'

/** The symbol-digit coding block family (M1.11). */
export const coding = defineFamily<CodingSpec, CodingKey, CodingResponses>({
  name: 'coding',
  kind: 'block',
  axis: 'PS',
  facets: ['coding'],
  generatorVersion: CODING_GENERATOR_VERSION,
  itemType: 'coding_block',
  strata: [codingStratum()],
  build(rng) {
    // Child streams, so the table and the stream are drawn independently of each other.
    const table = drawTable(rng.fork('table'))
    const sequence = drawSequence(rng.fork('sequence'))
    const difficulty = codingDifficulty()
    return {
      stratum: codingStratum(),
      spec: { legend: legendOf(table), sequence, duration_s: CODING_DURATION_S },
      key: { table },
      structural_params: codingStructure(sequence),
      params: codingParams(difficulty.b_prior),
      difficulty,
      expected_time_s: codingExpectedTime(),
      time_limit_s: CODING_DURATION_S,
    }
  },
  verify: (item) => verifyCoding(item),
  score: (item, responses) => scoreCoding(item, responses),
})

/**
 * The family's own leak check for `runFamilyProperties`: the spec holds exactly legend,
 * sequence and duration_s, every legend cell is exactly {digit, symbol} and shows the key's
 * digit for its glyph (the legend is the key by design, §3 row 10, and must not say anything
 * else), and the stream holds glyph ids only, never a digit.
 */
export function codingSpecLeaksKey(item: CodingItem): string | null {
  const fields = Object.keys(item.spec).sort().join(',')
  if (fields !== CODING_SPEC_FIELDS.join(',')) return `spec fields ${fields} are not ${CODING_SPEC_FIELDS.join(',')}`
  for (const cell of item.spec.legend) {
    if (Object.keys(cell).sort().join(',') !== 'digit,symbol') return 'a legend cell has fields other than digit, symbol'
    if (item.key.table[cell.symbol] !== cell.digit) return `the legend shows ${cell.symbol} → ${cell.digit}, not the key's digit`
  }
  if (item.spec.sequence.some((s) => typeof s !== 'string' || /\d/.test(s))) return 'the stream carries a digit'
  return null
}

export default coding
