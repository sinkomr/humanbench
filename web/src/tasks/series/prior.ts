/**
 * Difficulty and time priors of the series family (ROADMAP M1.P, M1.7; DESIGN §6.ii, §7.4).
 *
 * [SPEC] v0 regression, uncalibrated until M4 (σ_b = 1.0):
 *
 *   b = −0.364 (ICAR series p = .59, b = −logit(p))
 *       + 0.70 · (family_cost − 4)       family complexity = the key rule's DL family cost
 *       + 0.25 · (max_digits − 2)        digits of the largest |value| (a letter is one symbol: 1)
 *       − 0.20 · (visible_terms − 6)     fewer terms shown = less evidence for the rule
 *       + 0.40 · has_negative            any negative term or key
 *       + 0.30 · descending              the key is below the last term (letters: step < 0)
 *       + 0.40 · wraps                   a letter series runs past Z or A
 *       + 0.20 · is_letter               letter positions must be counted
 *
 * clamped to [−4, 4]. The centres put the ICAR anchor on an ICAR-like reference item rather than
 * between families. [SPEC] reference: an ICAR letter-number series item (Condon & Revelle 2014)
 * is taken to show about six short terms whose rule has two parts (growing or alternating
 * steps), which is family cost 4 here (quadratic, interleaved, Fibonacci-type). So the numeric
 * reference series 2, 3, 5, 8, 12, 17 → 23 (quadratic, 6 terms, 2 digits, ascending, no
 * negatives) gets b = −0.364 exactly; one-part rules (arithmetic, constant-step letters,
 * geometric) come out easier and composites harder. The generated pool is spread over strata 1–5
 * on purpose, so its mean b (about +0.15 for the natural stratum mix, a stratum-3 centre; see the
 * tests) is not the anchor.
 *
 * The stratum is the §6.ii default b band of b (`stratumOfB`); the family generates strata 1–5
 * (arithmetic and letters ≈ 1–2, geometric ≈ 2–3, quadratic, interleaved and Fibonacci-type
 * ≈ 3–4, composite ≈ 4–5) and rejects draws that land in stratum 6.
 *
 * Expected time (§7.4 E[T], [SPEC] v0, range 20–44 s; series stems are too short for the
 * length-based 25 s + 4 s/50 words prior to separate them):
 *
 *   E[T] = 20 + 4 · (family_cost − 2) + 2 · (max_digits − 1) + 3 · is_letter   seconds.
 *
 * Every feature is an integer, boolean or string, so the TS and Python twins recompute them
 * exactly; b itself is compared with a 1e-9 tolerance (the anchor involves a logarithm).
 */

import type { DifficultyPrior } from '../family'
import { ICAR_ANCHOR_B, SIGMA_B_DEFAULT, clampPrior, linearB, type LinearPriorModel } from '../priors'
import { ALPHABET, FAMILY_COST, type Coefficients, type RuleName } from './rules'

export const SERIES_PRIOR: LinearPriorModel = Object.freeze({
  anchorB: ICAR_ANCHOR_B.series,
  terms: Object.freeze({
    family_cost: { beta: 0.7, centre: 4 },
    max_digits: { beta: 0.25, centre: 2 },
    visible_terms: { beta: -0.2, centre: 6 },
    has_negative: { beta: 0.4, centre: 0 },
    descending: { beta: 0.3, centre: 0 },
    wraps: { beta: 0.4, centre: 0 },
    is_letter: { beta: 0.2, centre: 0 },
  }),
})

export const SERIES_PROVENANCE =
  'series v0 [SPEC] regression, uncalibrated: b = ICAR series anchor -0.364 (p = .59) at the reference item ' +
  '(cost-4 two-part rule, 6 terms, 2 digits) + 0.70(family_cost - 4) + 0.25(max_digits - 2) - 0.20(visible_terms - 6) ' +
  '+ 0.40 has_negative + 0.30 descending + 0.40 wraps + 0.20 is_letter'

/** The named inputs of the v0 regression (plus the informational rule name). */
export interface SeriesFeatures {
  readonly rule: RuleName
  readonly family_cost: number
  readonly visible_terms: number
  readonly max_digits: number
  readonly has_negative: boolean
  readonly descending: boolean
  readonly wraps: boolean
  readonly is_letter: boolean
}

/**
 * Features of a series from its key rule and `values` = t_0 … t_m (visible terms, then the key;
 * letter series as positions 1–26).
 */
export function seriesFeatures(rule: RuleName, coefficients: Coefficients, values: readonly number[]): SeriesFeatures {
  const m = values.length - 1
  const key = values[m] as number
  const isLetter = rule === 'letter'
  const d = typeof coefficients.d === 'number' ? coefficients.d : 0
  const p0 = values[0] as number
  let wraps = false
  if (isLetter) for (let i = 0; i <= m; i++) if (p0 + i * d < 1 || p0 + i * d > ALPHABET) wraps = true
  const maxAbs = Math.max(...values.map((x) => Math.abs(x)))
  return {
    rule,
    family_cost: FAMILY_COST[rule],
    visible_terms: m,
    max_digits: isLetter ? 1 : String(maxAbs).length,
    has_negative: !isLetter && values.some((x) => x < 0),
    descending: isLetter ? d < 0 : key < (values[m - 1] as number),
    wraps,
    is_letter: isLetter,
  }
}

/** b_prior of a series item: the v0 regression, clamped to [−4, 4]. */
export function seriesB(features: SeriesFeatures): number {
  return clampPrior(linearB(SERIES_PRIOR, features as unknown as Readonly<Record<string, number | string | boolean>>))
}

export function seriesDifficulty(features: SeriesFeatures): DifficultyPrior {
  return { features: { ...features }, b_prior: seriesB(features), sd_prior: SIGMA_B_DEFAULT, provenance: SERIES_PROVENANCE }
}

/** E[T] in seconds (module comment): 20–44 s. */
export function seriesExpectedTime(features: SeriesFeatures): number {
  return 20 + 4 * (features.family_cost - 2) + 2 * (features.max_digits - 1) + (features.is_letter ? 3 : 0)
}
