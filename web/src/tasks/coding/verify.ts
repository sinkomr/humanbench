/**
 * Verifier of a coding block (ROADMAP M1.11; gates G2/G3, DESIGN §4.1). It recomputes every
 * property from the instance alone, so it also accepts or rejects hand-built and loaded items:
 *
 * - the key is a bijection glyph → digit 1–9 and the legend (digits 1–9 in order) shows
 *   exactly that bijection;
 * - the stream has 200 known glyph ids, no immediate repeat, and balanced counts (every glyph
 *   22 or 23 times: max − min ≤ 1);
 * - no key leakage beyond the legend: the spec has exactly the fields legend, sequence and
 *   duration_s, each legend cell exactly {digit, symbol}, and the stream holds glyph ids only
 *   (no per-stimulus digit anywhere);
 * - the 90 s window, the structure (A11), the prior, the Gaussian params (A10) and the
 *   stratum match the block design.
 */

import { canonicalJson } from '../ids'
import { stratumOfB } from '../priors'
import { verdict, type VerifyResult } from '../family'
import {
  CODING_DIGITS,
  CODING_DURATION_S,
  CODING_SEQUENCE_LENGTH,
  CODING_SPEC_FIELDS,
  CODING_SYMBOLS,
  isCodingSymbol,
  type CodingItem,
} from './config'
import { codingStructure } from './gen'
import { codingDifficulty, codingParams } from './prior'

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const sortedKeys = (v: Record<string, unknown>): string => Object.keys(v).sort().join(',')

/** True if some neighbouring pair of `seq` is equal. */
export function hasImmediateRepeat(seq: readonly unknown[]): boolean {
  for (let i = 1; i < seq.length; i++) if (seq[i] === seq[i - 1]) return true
  return false
}

/** Occurrences of each glyph of {@link CODING_SYMBOLS} in `seq`, in that order. */
export function glyphCounts(seq: readonly unknown[]): number[] {
  return CODING_SYMBOLS.map((s) => seq.filter((x) => x === s).length)
}

/** Verify a coding block; never throws (a malformed item fails with reason "malformed item"). */
export function verifyCoding(item: CodingItem): VerifyResult {
  try {
    const spec: unknown = item.spec
    const key: unknown = item.key
    if (!isObject(spec) || !isObject(key)) return verdict({ spec_and_key_are_objects: false })
    const legend = spec.legend
    const sequence = spec.sequence
    const table = key.table

    const legendWellFormed =
      Array.isArray(legend) &&
      legend.length === CODING_DIGITS.length &&
      legend.every((e) => isObject(e) && sortedKeys(e) === 'digit,symbol')
    const cells = legendWellFormed ? (legend as Record<string, unknown>[]) : []
    const legendGlyphs = cells.map((e) => e.symbol)

    const keyWellFormed =
      sortedKeys(key) === 'table' && isObject(table) && sortedKeys(table) === [...CODING_SYMBOLS].sort().join(',')
    const digits = keyWellFormed ? CODING_SYMBOLS.map((s) => (table as Record<string, unknown>)[s]) : []
    const keyBijection =
      keyWellFormed &&
      digits.every((d) => Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 9) &&
      new Set(digits).size === CODING_DIGITS.length

    const seqArray = Array.isArray(sequence) ? (sequence as unknown[]) : []
    const counts = glyphCounts(seqArray)
    const minCount = Math.min(...counts)
    const maxCount = Math.max(...counts)
    const glyphIdsOnly = Array.isArray(sequence) && seqArray.every(isCodingSymbol)

    const want = codingDifficulty()
    const d = item.difficulty
    const params = codingParams(want.b_prior)

    return verdict({
      identity_matches:
        item.family === 'coding' &&
        item.axis === 'PS' &&
        item.facet === 'coding' &&
        item.item_type === 'coding_block' &&
        !('options_count' in item),
      spec_fields_exact: sortedKeys(spec) === CODING_SPEC_FIELDS.join(','),
      legend_well_formed: legendWellFormed,
      legend_digits_in_order: legendWellFormed && cells.every((e, i) => e.digit === CODING_DIGITS[i]),
      legend_glyphs_bijective:
        legendWellFormed && legendGlyphs.every(isCodingSymbol) && new Set(legendGlyphs).size === CODING_SYMBOLS.length,
      key_well_formed: keyWellFormed,
      key_bijection: keyBijection,
      legend_matches_key:
        legendWellFormed && keyBijection && cells.every((e) => isCodingSymbol(e.symbol) && (table as Record<string, unknown>)[e.symbol] === e.digit),
      sequence_length: Array.isArray(sequence) && seqArray.length === CODING_SEQUENCE_LENGTH,
      sequence_glyph_ids_only: glyphIdsOnly,
      no_immediate_repeats: Array.isArray(sequence) && !hasImmediateRepeat(seqArray),
      counts_balanced: glyphIdsOnly && minCount >= 1 && maxCount - minCount <= 1,
      window_matches:
        spec.duration_s === CODING_DURATION_S && item.time_limit_s === CODING_DURATION_S && item.expected_time_s === CODING_DURATION_S,
      structure_matches: glyphIdsOnly && canonicalJson(item.structural_params) === canonicalJson(codingStructure(seqArray as string[])),
      difficulty_matches:
        isObject(d) &&
        canonicalJson(d.features) === canonicalJson(want.features) &&
        d.b_prior === want.b_prior &&
        d.sd_prior === want.sd_prior &&
        d.provenance === want.provenance,
      params_match: canonicalJson(item.params) === canonicalJson(params),
      stratum_matches: item.stratum === stratumOfB(want.b_prior),
      min_count: minCount,
      max_count: maxCount,
    })
  } catch (e) {
    return { ok: false, reason: `malformed item: ${String(e)}`, checks: {} }
  }
}
