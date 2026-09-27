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

/** Whitespace-separated word count of the given texts. */
export function countWords(...texts: readonly string[]): number {
  let n = 0
  for (const t of texts) n += t.split(/\s+/).filter((w) => w.length > 0).length
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
