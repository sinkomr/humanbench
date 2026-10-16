/**
 * Difficulty and time priors of the series family (ROADMAP M1.P, M1.7; DESIGN §6.ii, §7.4).
 *
 * [SPEC] v0 regression, uncalibrated until M4 (σ_b = 1.0):
 *
 *   b = −0.364 (ICAR series p = .59, b = −logit(p))
 *       + 0.70 · (family_cost − 3.946)     family complexity = the key rule's DL family cost
 *       + 0.25 · (max_digits − 2.895)      digits of the largest |value| (a letter is one symbol: 1)
 *       − 0.20 · (visible_terms − 6.035)   fewer terms shown = less evidence for the rule
 *       + 0.40 · (has_negative − 0.346)    any negative term or key
 *       + 0.30 · (descending − 0.315)      the key is below the last term (letters: step < 0)
 *       + 0.40 · (wraps − 0.041)           a letter series runs past Z or A
 *       + 0.20 · (is_letter − 0.052)       letter positions must be counted
 *
 * clamped to [−4, 4]. Anchor (M1.P): the ICAR series p is the POOL mean, so every feature is
 * centred at its mean over the natural pool ({@link POOL_FEATURE_MEANS}: `generate(seed)` without a
 * requested stratum draws the key rule family from `NATURAL_MENU` in `gen.ts`, then its
 * coefficients, keeping valid unique draws), estimated over 100,000 natural draws and rounded to
 * 3 decimals; the pool mean b is then the anchor (checked at n = 2,000 in both repos). Before
 * generator 1.3.0 the anchor sat on a reference item (a cost-4 two-part rule, 6 terms, 2 digits,
 * ascending, no negatives) and the pool, drawn stratum first, had mean ≈ +0.15. The slopes are
 * unchanged: one-part rules (arithmetic, constant-step letters, geometric) come out easier and
 * composites harder.
 *
 * The stratum is the §6.ii default b band of b (`stratumOfB`); the family generates strata 1–6
 * (arithmetic and letters ≈ 1–2, geometric ≈ 2–3, quadratic, interleaved and Fibonacci-type
 * ≈ 3, composite ≈ 4–5, the hard families of generator 1.4.0 ≈ 5–6); a requested stratum draws
 * from that stratum's rule menu until b lands in its band.
 *
 * Generator 1.4.0 (M3.12): the regression, its centres and its provenance are unchanged. The hard
 * families enter it through their family cost, the fixed part of their description length
 * (`rules.ts`): three-term Fibonacci 6, Fibonacci differences 7, strands with their own ops 7,
 * weighted two-term recurrences 8, index-dependent affine steps 8, cycles of three ops 9. That is
 * the v0 reading of Simon & Kotovsky (1963), whose pattern descriptions grow with the relations a
 * series needs, and of Holzman, Pellegrino & Glaser (1983), where series difficulty grows with the
 * number of relations to find and the working-memory load of holding them (period length, earlier
 * terms an operation uses): each hard family adds one or more relations to the 1.3.0 family it
 * extends, at 0.7 logits per bit. Over the generator's draws that puts `tribonacci` at b ≈ 0.2–1.8
 * (only its rare stratum-5 draws are kept), `diff_fibonacci` and `interleaved_ops` ≈ 1.1–2.5 (stratum
 * 5), `linear_rec` and `affine_index` ≈ 1.8–3.4 (strata 5 and 6) and `cycle3` ≈ 2.2–3.7 (always 7
 * terms; mostly stratum 6). A stratum-6 item
 * is e.g. a weighted recurrence t_i = 2·t_{i−1} + 3·t_{i−2} with signs changing, or three ops in
 * turn (×3, −7, ×−2) on 7 terms of 3–4 digits, which a strong adult often misses even with time.
 * The 1.3.0 natural pool never draws them, so the pool means and its anchor are unchanged.
 *
 * Expected time (§7.4 E[T], [SPEC] v0; series stems are too short for the length-based 25 s +
 * 4 s/50 words prior to separate them):
 *
 *   E[T] = 20 + 4 · (family_cost − 2) + 6 · max(0, family_cost − 6) + 2 · (max_digits − 1)
 *          + 3 · is_letter   seconds,
 *
 * 20–44 s for the 1.3.0 families and `tribonacci` (cost ≤ 6, so the third term is 0 and the E[T]
 * of a 1.3.0 item is unchanged), 46–52 s at cost 7, 56–62 s at cost 8 and 66–72 s for `cycle3`:
 * the extra 6 s per bit above 6 is the search for a second or third relation, which Holzman et al.
 * found dominates solution time. The cap is the shared max(180, ⌈2.5·E[T]⌉) = 180 s.
 *
 * Every feature is an integer, boolean or string, so the TS and Python twins recompute them
 * exactly; b itself is compared with a 1e-9 tolerance (the anchor involves a logarithm).
 */

import type { DifficultyPrior } from '../family'
import { ICAR_ANCHOR_B, SIGMA_B_DEFAULT, clampPrior, linearB, type LinearPriorModel } from '../priors'
import { ALPHABET, FAMILY_COST, type Coefficients, type RuleName } from './rules'

/**
 * The natural pool's feature means (M1.P), estimated over 100,000 natural draws (the
 * `NATURAL_MENU` of `gen.ts`) and rounded to 3 decimals: the regression's centres, so the pool
 * mean b is the ICAR anchor. The bank's `hb.gen.series.prior` uses the same numbers.
 */
export const POOL_FEATURE_MEANS = Object.freeze({
  family_cost: 3.946,
  max_digits: 2.895,
  visible_terms: 6.035,
  has_negative: 0.346,
  descending: 0.315,
  wraps: 0.041,
  is_letter: 0.052,
})

export const SERIES_PRIOR: LinearPriorModel = Object.freeze({
  anchorB: ICAR_ANCHOR_B.series,
  terms: Object.freeze({
    family_cost: { beta: 0.7, centre: POOL_FEATURE_MEANS.family_cost },
    max_digits: { beta: 0.25, centre: POOL_FEATURE_MEANS.max_digits },
    visible_terms: { beta: -0.2, centre: POOL_FEATURE_MEANS.visible_terms },
    has_negative: { beta: 0.4, centre: POOL_FEATURE_MEANS.has_negative },
    descending: { beta: 0.3, centre: POOL_FEATURE_MEANS.descending },
    wraps: { beta: 0.4, centre: POOL_FEATURE_MEANS.wraps },
    is_letter: { beta: 0.2, centre: POOL_FEATURE_MEANS.is_letter },
  }),
})

export const SERIES_PROVENANCE =
  'series v0 [SPEC] regression, uncalibrated: b = ICAR series anchor -0.364 (p = .59) as the pool mean (M1.P) ' +
  '+ 0.70(family_cost - 3.946) + 0.25(max_digits - 2.895) - 0.20(visible_terms - 6.035) + 0.40(has_negative - 0.346) ' +
  '+ 0.30(descending - 0.315) + 0.40(wraps - 0.041) + 0.20(is_letter - 0.052), centred at the natural pool means'

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

/** E[T] in seconds (module comment): 20–44 s for the 1.3.0 families, up to 72 s for the hard ones. */
export function seriesExpectedTime(features: SeriesFeatures): number {
  const cost = features.family_cost
  return 20 + 4 * (cost - 2) + 6 * Math.max(0, cost - 6) + 2 * (features.max_digits - 1) + (features.is_letter ? 3 : 0)
}
