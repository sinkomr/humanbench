/**
 * Difficulty and time priors for procedural families (ROADMAP M1.P, DESIGN §6.ii, §7.4).
 *
 * Every procedural item carries a prior on its 2PL location, b ~ N(b_prior, sd_prior²), from a
 * v0 linear feature → b model anchored to published ICAR proportion-correct values, and a
 * length-based expected time E[T] for information-per-second selection. All values are
 * provisional until online calibration replaces them (§6.iii, M4).
 *
 * The p → b link is b ≈ −logit(p)/a with a = 1 and an anchor population θ mean of 0, a [SPEC]
 * link (§6.ii step 5). It ignores guessing, so for 3PL items it slightly overstates difficulty.
 */

import type { Stratum } from './ids'

/** logit(p) = ln(p / (1 − p)); throws a RangeError unless 0 < p < 1. */
export function logit(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError(`logit(): p must be in (0, 1), got ${p}`)
  return Math.log(p / (1 - p))
}

/** b from a proportion correct: b = −logit(p), assuming θ-mean 0 and a = 1 ([SPEC] link, §6.ii). */
export function bFromP(p: number): number {
  return 0 - logit(p) // 0 − x, not −x, so p = .5 gives +0
}

/**
 * ICAR mean proportion correct by item type in the SAPA sample: Condon & Revelle (2014),
 * *Intelligence* 43:52–64, as quoted in DESIGN §2.2 (Rotation .19, Matrix .52, Series .59).
 * Anchors only: ICAR items are never served (§2.2).
 */
export const ICAR_MEAN_P = Object.freeze({ rotation: 0.19, matrix: 0.52, series: 0.59 } as const)

export type IcarType = keyof typeof ICAR_MEAN_P

/** The ICAR anchors on the b scale, bFromP(ICAR_MEAN_P[type]): rotation ≈ 1.45, matrix ≈ −0.08, series ≈ −0.36. */
export const ICAR_ANCHOR_B: Readonly<Record<IcarType, number>> = Object.freeze({
  rotation: bFromP(ICAR_MEAN_P.rotation),
  matrix: bFromP(ICAR_MEAN_P.matrix),
  series: bFromP(ICAR_MEAN_P.series),
})

/** Initial prior SD of b (σ_b = 1.0, §6.ii), shrinking once the predictor's validity is measured. */
export const SIGMA_B_DEFAULT = 1.0

/** |b_prior| never exceeds this; the scorer's EAP grid spans [−4, 4] (ROADMAP A2). */
export const B_PRIOR_LIMIT = 4

/** Clamp a prior location into [−limit, limit]; throws a RangeError on a non-finite b. */
export function clampPrior(b: number, limit = B_PRIOR_LIMIT): number {
  if (!Number.isFinite(b)) throw new RangeError(`clampPrior(): b must be finite, got ${b}`)
  return Math.min(limit, Math.max(-limit, b))
}

/** One term of a linear difficulty model: contributes beta · (feature − centre). */
export interface PriorTerm {
  readonly beta: number
  readonly centre: number
}

/** A v0 linear feature → b model: b = anchorB + Σ_i beta_i · (feature_i − centre_i). */
export interface LinearPriorModel {
  readonly anchorB: number
  readonly terms: Readonly<Record<string, PriorTerm>>
}

/**
 * Evaluate a {@link LinearPriorModel}. Boolean features count as 0/1. Every term needs a finite
 * feature value; extra features (e.g. informational strings) are ignored. The result is not
 * clamped: pass it through {@link clampPrior}.
 */
export function linearB(
  model: LinearPriorModel,
  features: Readonly<Record<string, number | string | boolean>>,
): number {
  let b = model.anchorB
  for (const [name, term] of Object.entries(model.terms)) {
    const raw = features[name]
    const x = typeof raw === 'boolean' ? Number(raw) : raw
    if (typeof x !== 'number' || !Number.isFinite(x)) {
      throw new RangeError(`linearB(): feature ${JSON.stringify(name)} must be a finite number or boolean`)
    }
    b += term.beta * (x - term.centre)
  }
  if (!Number.isFinite(b)) throw new RangeError('linearB(): non-finite result')
  return b
}

/** Base of the length-based expected-time prior, in seconds (§7.4: 25 s + 4 s per 50 words). */
export const EXPECTED_TIME_BASE_S = 25
/** Seconds added per 50 words of stem/passage/options (§7.4). */
export const EXPECTED_TIME_PER_50_WORDS_S = 4

/** Length-based expected time E[T] in seconds: 25 + 4 · words / 50 (§7.4). */
export function expectedTimeFromWords(words: number): number {
  if (!(Number.isFinite(words) && words >= 0)) {
    throw new RangeError(`expectedTimeFromWords(): words must be a finite number ≥ 0, got ${words}`)
  }
  return EXPECTED_TIME_BASE_S + (EXPECTED_TIME_PER_50_WORDS_S * words) / 50
}

/**
 * The floor of the one shared time cap of power items, in seconds (DESIGN §13: "no time limits
 * on power items beyond a generous cap"; the §12 record's `time_limit_s`). See
 * {@link powerTimeLimit}.
 */
export const POWER_TIME_LIMIT_S = 180

/** A power item's cap is at least this multiple of its expected time E[T] (§13 "generous"). */
export const POWER_TIME_LIMIT_MIN_RATIO = 2.5

/**
 * The one shared time cap of every power item (kind 'item', M1.F2; DESIGN §13, §12
 * `time_limit_s int`): max(180 s, ⌈2.5 · E[T]⌉) whole seconds. It only ends a stalled item and
 * never paces a slow but engaged taker: at least 180 s, and at least 2.5 × E[T] for the rare
 * long item (quant stems at E[T] > 72 s). `defineFamily` sets it on every item and
 * `validateItemInstance` requires it; the bank's `hb.gen.priors.power_time_limit` is the same
 * rule. Timed blocks (coding's 90 s window) are speed tasks, not power items, and keep their
 * own durations.
 */
export function powerTimeLimit(expectedTimeS: number): number {
  if (!(Number.isFinite(expectedTimeS) && expectedTimeS > 0)) {
    throw new RangeError(`powerTimeLimit(): expected time must be finite and > 0, got ${expectedTimeS}`)
  }
  return Math.max(POWER_TIME_LIMIT_S, Math.ceil(POWER_TIME_LIMIT_MIN_RATIO * expectedTimeS))
}

/**
 * Word separators of {@link countWords}: exactly the characters of JS `\s`, spelled out so the
 * bank's `count_words` uses the identical class (Python's `str.split()` also splits on
 * U+001C–U+001F and U+0085 but not on U+FEFF, which would change expected_time_s). The bank
 * test `test_word_separators_match_ts` compares this source line with the Python pattern.
 */
export const WORD_SEPARATOR_RE = /[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/

/** Word count of the given texts, split on {@link WORD_SEPARATOR_RE}. */
export function countWords(...texts: readonly string[]): number {
  let n = 0
  for (const t of texts) n += t.split(WORD_SEPARATOR_RE).filter((w) => w.length > 0).length
  return n
}

/** Content labels of the difficulty strata (§6.ii step 1). */
export const STRATUM_LABELS: Readonly<Record<Stratum, string>> = Object.freeze({
  1: 'middle school',
  2: 'high school',
  3: 'college entry',
  4: 'college',
  5: 'graduate / professional',
  6: 'olympiad / expert',
})

/**
 * [SPEC] Default b bands for the strata, so families agree on what a requested stratum means:
 * stratum k covers [STRATUM_B_CUTS[k−2], STRATUM_B_CUTS[k−1]) with open ends, i.e. roughly
 * b < −1.5, −1.5…−0.5, −0.5…0.5, 0.5…1.5, 1.5…2.5, ≥ 2.5. Provisional until M4 calibration.
 */
export const STRATUM_B_CUTS: readonly number[] = Object.freeze([-1.5, -0.5, 0.5, 1.5, 2.5])

/** The stratum whose default b band contains `b` ({@link STRATUM_B_CUTS}). */
export function stratumOfB(b: number): Stratum {
  if (!Number.isFinite(b)) throw new RangeError(`stratumOfB(): b must be finite, got ${b}`)
  let k = 1
  for (const cut of STRATUM_B_CUTS) if (b >= cut) k++
  return k as Stratum
}
