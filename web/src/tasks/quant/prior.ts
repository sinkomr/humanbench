/**
 * Difficulty and time priors of the quant family (M1.P, DESIGN §6.ii, §7.4). [SPEC] v0, uncalibrated
 * until M4; the bank's `hb.gen.quant` uses the same numbers.
 *
 * b regression v0:  b = −1.5 + 1.0·(stratum − 1) + template_offset + 0.1·non_integer
 * - stratum anchors −1.5, −0.5, 0.5, 1.5 for strata 1–4 (§6.ii content labels: middle school,
 *   high school, college entry, college);
 * - `template_offset` ∈ [−0.8, −0.2] per template variant (`VariantDef.offset`, e.g. percent
 *   change −0.3 vs percent-of −0.8), a judgement of relative step count within the stratum;
 * - `non_integer` = the key is not an integer (fractions and decimals are harder to enter), +0.1.
 * The anchors are the upper cuts of the default stratum bands (`STRATUM_B_CUTS`: stratum k is
 * [anchor − 1, anchor)), and every offset is ≤ −0.1 in total, so b always lies inside its
 * stratum's band (`stratumOfB(b) === stratum`). σ_b = 1.0.
 *
 * Expected time v0: E[T] = {30, 45, 60, 75} s for strata 1–4 plus the §7.4 length term
 * 4 s per 50 words of stem, so 30–90 s.
 */

import type { Stratum } from '../ids'
import { EXPECTED_TIME_PER_50_WORDS_S, SIGMA_B_DEFAULT, clampPrior, countWords, linearB, type LinearPriorModel } from '../priors'

/** [SPEC v0] The b regression (see the module comment). */
export const QUANT_PRIOR: LinearPriorModel = Object.freeze({
  anchorB: -1.5,
  terms: Object.freeze({
    stratum: { beta: 1.0, centre: 1 },
    template_offset: { beta: 1.0, centre: 0 },
    non_integer: { beta: 0.1, centre: 0 },
  }),
})

/** [SPEC v0] Base expected time by stratum, in seconds, before the per-word term. */
export const QUANT_TIME_BASE_S: Readonly<Record<1 | 2 | 3 | 4, number>> = Object.freeze({ 1: 30, 2: 45, 3: 60, 4: 75 })

export const QUANT_PROVENANCE =
  'quant v0 [SPEC]: b = -1.5 + 1.0*(stratum - 1) + template_offset + 0.1*non_integer; ' +
  'anchors -1.5/-0.5/0.5/1.5 for strata 1-4, offsets in [-0.8, -0.2] keep b inside the stratum band; uncalibrated until M4'

/** The regression features of an item (§12 difficulty_prior inputs). */
export interface QuantFeatures {
  readonly [k: string]: string | number | boolean
  readonly template: string
  readonly variant: string
  readonly stratum: number
  readonly template_offset: number
  readonly non_integer: boolean
}

export function quantFeatures(template: string, variant: string, stratum: Stratum, offset: number, nonInteger: boolean): QuantFeatures {
  return { template, variant, stratum, template_offset: offset, non_integer: nonInteger }
}

/** b_prior of the v0 regression, clamped to ±4 (it never reaches the clamp). */
export const quantBPrior = (f: QuantFeatures): number => clampPrior(linearB(QUANT_PRIOR, f))

/** E[T] in seconds: the stratum base plus 4 s per 50 words of stem (§7.4). */
export function quantExpectedTime(stratum: 1 | 2 | 3 | 4, stem: string): number {
  return QUANT_TIME_BASE_S[stratum] + (EXPECTED_TIME_PER_50_WORDS_S * countWords(stem)) / 50
}

export const QUANT_SD_PRIOR = SIGMA_B_DEFAULT
