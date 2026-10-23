/**
 * Series verifier (gates G2/G3, DESIGN §4.1, §4.2 "Series"; ROADMAP M1.7). Recomputes everything
 * from the item alone: the terms and key are well formed and in bounds, the key rule in
 * `structural_params` is in its domain and fits, the uniqueness analysis of `rules.ts` holds
 * (one next term across the minimum-DL set, key rule of minimal DL and confirmed by the terms,
 * strictly simpler than the interpolating polynomial), and the features, b prior, provenance,
 * stratum and expected time match the v0 prior. Generator 1.5.0: a letter series of an integer
 * family carries `letters: true` in its structure, and its key rule must reach the key without
 * wrapping (every position in 1–26, `key_unwrapped`). The bank's `hb.gen.series.verify_series`
 * implements the same checks independently.
 */

import { verdict, type VerifyResult } from '../family'
import { canonicalJson } from '../ids'
import { SIGMA_B_DEFAULT, powerTimeLimit, stratumOfB } from '../priors'
import { SERIES_PROVENANCE, seriesB, seriesExpectedTime, seriesFeatures } from './prior'
import {
  CURRENT_FIT_SET,
  MAX_VISIBLE,
  MIN_VISIBLE,
  TERM_BOUND,
  allowsLetterRules,
  analyse,
  inRuleDomain,
  isRuleName,
  letterPosition,
  uniquenessChecks,
  unwrappedKeyFit,
  type FitSet,
} from './rules'
import type { SeriesItem } from './types'
import { seriesStrataOf } from './gen'

/** |b_prior − recomputed b| allowed (the anchor is a logarithm; TS and Python may differ by an ulp). */
export const PRIOR_TOLERANCE = 1e-9

const isBoundedInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && Math.abs(v) <= TERM_BOUND
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A canonical integer `NumericKey.value` ("42", "-7", "0"; no "+", "-0" or leading zeros). */
const CANONICAL_INTEGER = /^(?:0|-?[1-9][0-9]*)$/

/** The bounded integer a key value string denotes, or undefined unless it is canonical. */
const keyInteger = (v: unknown): number | undefined =>
  typeof v === 'string' && CANONICAL_INTEGER.test(v) && isBoundedInt(Number(v)) ? Number(v) : undefined

/** The exact tolerance `{ abs: 0 }`. */
const isExactTol = (t: unknown): boolean => isPlainObject(t) && canonicalJson(Object.keys(t)) === '["abs"]' && t.abs === 0

/**
 * Verify a series item of the generator version whose fit set is `fitSet` (the current one by
 * default; the kept 1.3.0 generator verifies its items with the 1.3.0 fit set, rule names and strata).
 */
export function verifySeries(item: SeriesItem, fitSet: FitSet = CURRENT_FIT_SET): VerifyResult {
  try {
    const spec = item.spec as unknown
    const key = item.key as unknown
    const structure = item.structural_params as unknown
    if (!isPlainObject(spec) || !isPlainObject(key) || !isPlainObject(structure)) {
      return verdict({ well_formed: false })
    }
    const format = spec.input_format
    const terms = spec.terms
    const letter = format === 'letter'
    const specFieldsOk = canonicalJson(Object.keys(spec).sort()) === '["input_format","terms"]'
    const formatOk = format === 'integer' || format === 'letter'
    const countOk = Array.isArray(terms) && terms.length >= MIN_VISIBLE && terms.length <= MAX_VISIBLE
    const visible: number[] = []
    let termsOk = countOk && formatOk
    if (termsOk) {
      for (const t of terms as unknown[]) {
        const v = letter ? letterPosition(t) : isBoundedInt(t) ? t : undefined
        if (v === undefined) termsOk = false
        else visible.push(v)
      }
    }
    let next: number | undefined
    let keyOk: boolean
    if (letter) {
      next = letterPosition(key.letter)
      keyOk = next !== undefined && canonicalJson(Object.keys(key).sort()) === '["letter"]'
    } else {
      next = keyInteger(key.value)
      keyOk = next !== undefined && isExactTol(key.tol) && canonicalJson(Object.keys(key).sort()) === '["tol","value"]'
    }
    const rule = structure.rule
    const coefficients = structure.coefficients
    const structureKeys = canonicalJson(Object.keys(structure).sort())
    // 1.5.0: `letters: true` marks a letter series of an integer family (never of the rule `letter`).
    const lettersFlag = structureKeys === '["coefficients","letters","rule"]'
    const structureOk =
      (structureKeys === '["coefficients","rule"]' || (lettersFlag && structure.letters === true && allowsLetterRules(fitSet) && rule !== 'letter')) &&
      isRuleName(rule, fitSet) &&
      isPlainObject(coefficients) &&
      Object.values(coefficients).every((c) => typeof c === 'number' || typeof c === 'string')
    const domainOk = structureOk && inRuleDomain(rule, coefficients as Record<string, number | string>)
    const formatMatchesRule = structureOk && (rule === 'letter' || lettersFlag) === letter
    const base = {
      spec_well_formed: specFieldsOk && formatOk && countOk && termsOk,
      key_well_formed: keyOk,
      structure_well_formed: structureOk,
      coefficients_in_domain: domainOk,
      format_matches_rule: formatMatchesRule,
    }
    if (!Object.values(base).every(Boolean) || next === undefined || !isRuleName(rule, fitSet)) return verdict(base)

    const keyRule = { rule, coefficients: coefficients as Record<string, number | string> }
    const uniqueness = uniquenessChecks(analyse(visible, letter, fitSet), keyRule, next)
    // A letter series of an integer family: the key rule itself predicts the key's position, unwrapped.
    const keyUnwrapped = !lettersFlag || unwrappedKeyFit(visible, keyRule, fitSet)?.next === next

    const values = [...visible, next]
    const features = seriesFeatures(rule, keyRule.coefficients, values, letter)
    const b = item.difficulty.b_prior
    return verdict({
      ...base,
      ...uniqueness,
      key_unwrapped: keyUnwrapped,
      features_match: canonicalJson(item.difficulty.features) === canonicalJson(features),
      prior_matches: typeof b === 'number' && Math.abs(b - seriesB(features)) <= PRIOR_TOLERANCE,
      prior_sd_matches: item.difficulty.sd_prior === SIGMA_B_DEFAULT,
      provenance_matches: item.difficulty.provenance === SERIES_PROVENANCE,
      stratum_matches: typeof b === 'number' && Number.isFinite(b) && item.stratum === stratumOfB(b) && seriesStrataOf(fitSet).includes(item.stratum),
      expected_time_matches: item.expected_time_s === seriesExpectedTime(features),
      time_limit_matches: item.time_limit_s === powerTimeLimit(item.expected_time_s),
      no_options: item.options_count === undefined,
    })
  } catch (e) {
    return { ok: false, reason: `malformed item: ${String(e)}`, checks: {} }
  }
}
