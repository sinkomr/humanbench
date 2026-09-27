/**
 * Series verifier (gates G2/G3, DESIGN §4.1, §4.2 "Series"; ROADMAP M1.7). Recomputes everything
 * from the item alone: the terms and key are well formed and in bounds, the key rule in
 * `structural_params` is in its domain and fits, the uniqueness analysis of `rules.ts` holds
 * (one next term across the minimum-DL set, key rule of minimal DL and confirmed by the terms,
 * strictly simpler than the interpolating polynomial), and the features, b prior, provenance,
 * stratum and expected time match the v0 prior. The bank's `hb.gen.series.verify_series`
 * implements the same checks independently.
 */

import { verdict, type VerifyResult } from '../family'
import { canonicalJson } from '../ids'
import { SIGMA_B_DEFAULT, stratumOfB } from '../priors'
import { SERIES_PROVENANCE, seriesB, seriesExpectedTime, seriesFeatures } from './prior'
import { MAX_VISIBLE, MIN_VISIBLE, TERM_BOUND, analyse, inRuleDomain, isRuleName, letterPosition, uniquenessChecks } from './rules'
import type { SeriesItem } from './types'
import { SERIES_STRATA } from './gen'

/** |b_prior − recomputed b| allowed (the anchor is a logarithm; TS and Python may differ by an ulp). */
export const PRIOR_TOLERANCE = 1e-9

const isBoundedInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && Math.abs(v) <= TERM_BOUND
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function verifySeries(item: SeriesItem): VerifyResult {
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
      next = isBoundedInt(key.value) ? key.value : undefined
      keyOk = next !== undefined && key.tol === 0 && canonicalJson(Object.keys(key).sort()) === '["tol","value"]'
    }
    const rule = structure.rule
    const coefficients = structure.coefficients
    const structureOk =
      canonicalJson(Object.keys(structure).sort()) === '["coefficients","rule"]' &&
      isRuleName(rule) &&
      isPlainObject(coefficients) &&
      Object.values(coefficients).every((c) => typeof c === 'number' || typeof c === 'string')
    const domainOk = structureOk && inRuleDomain(rule, coefficients as Record<string, number | string>)
    const formatMatchesRule = structureOk && (rule === 'letter') === letter
    const base = {
      spec_well_formed: specFieldsOk && formatOk && countOk && termsOk,
      key_well_formed: keyOk,
      structure_well_formed: structureOk,
      coefficients_in_domain: domainOk,
      format_matches_rule: formatMatchesRule,
    }
    if (!Object.values(base).every(Boolean) || next === undefined || !isRuleName(rule)) return verdict(base)

    const keyRule = { rule, coefficients: coefficients as Record<string, number | string> }
    const uniqueness = uniquenessChecks(analyse(visible, letter), keyRule, next)

    const values = [...visible, next]
    const features = seriesFeatures(rule, keyRule.coefficients, values)
    const b = item.difficulty.b_prior
    return verdict({
      ...base,
      ...uniqueness,
      features_match: canonicalJson(item.difficulty.features) === canonicalJson(features),
      prior_matches: typeof b === 'number' && Math.abs(b - seriesB(features)) <= PRIOR_TOLERANCE,
      prior_sd_matches: item.difficulty.sd_prior === SIGMA_B_DEFAULT,
      provenance_matches: item.difficulty.provenance === SERIES_PROVENANCE,
      stratum_matches: typeof b === 'number' && Number.isFinite(b) && item.stratum === stratumOfB(b) && SERIES_STRATA.includes(item.stratum),
      expected_time_matches: item.expected_time_s === seriesExpectedTime(features),
      no_options: item.options_count === undefined,
    })
  } catch (e) {
    return { ok: false, reason: `malformed item: ${String(e)}`, checks: {} }
  }
}
