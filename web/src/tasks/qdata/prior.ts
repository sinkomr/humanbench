/**
 * Difficulty and time priors of the qdata family (M1.P, DESIGN §6.ii, §7.4). [SPEC] v0,
 * uncalibrated until M4; the bank's `hb.gen.qdata` uses the same numbers.
 *
 * b regression v0 (a linear model over the item's features, `linearB`):
 *
 *     b = −2 + 1.0·(stratum − 1) + 0.03·(steps − 3) + 0.01·(cells_read − 8)
 *           + 0.05·percent + 0.05·non_integer + 0.05·negatives + 0.10·reversal
 *
 * - `stratum` is the template's (each template lives in one stratum), so the template base b is
 *   the stratum anchor −2, −1, 0, 1, 2, 3: the centres of the shared default b bands, as quant
 *   (`STRATUM_B_CUTS` in `priors.ts`). Strata by content: 1 read one or two values, or add a short
 *   list, or give change; 2 a range, a signed change, an integer mean, a timetable duration;
 *   3 a percent of a total, a bill split with a tip, unit prices, recipe scaling with fractions;
 *   4 percent change, a weighted mean, a conditional share as a fraction, fuel cost, discount then
 *   tax; 5 median from a frequency table, the missing value for a given mean, comparing two series,
 *   work together, mixtures; 6 compound change from a chart of percents (forward and backward),
 *   percentage points against the relative change of a share, undoing two price changes.
 * - `steps`: the template variant's judged number of separate computations (1–5);
 * - `cells_read`: how many exhibit values the question needs read (0 for a word problem, up to 14:
 *   two series of seven points), the exhibit reading load;
 * - `percent`: a percent is computed or used; `non_integer`: the key is not a whole number;
 *   `negatives`: a negative number is on the exhibit, in the stem or is the key; `reversal`: the
 *   question runs a change backwards.
 * Every term but the stratum moves b by less than ±0.5 in all (at most −0.13 and +0.46), so
 * `stratumOfB(b)` is always the template's stratum (the verifier and the tests check it).
 *
 * Expected time v0: E[T] = `expectedTimeFromWords(words of the stem)` (25 s + 4 s per 50 words,
 * §7.4) + 2 s per exhibit value read + 10 s per step: about 35 s for a stratum-1 bar reading and
 * about 90–100 s for a stratum-6 compound change. The shared cap max(180, ⌈2.5·E[T]⌉) then gives
 * 180–250 s.
 */

import { SIGMA_B_DEFAULT, clampPrior, countWords, expectedTimeFromWords, linearB, type LinearPriorModel } from '../priors'
import type { Stratum } from '../ids'

/** [SPEC v0] The b regression (see the module comment). The term order is the bank's too. */
export const QDATA_PRIOR: LinearPriorModel = Object.freeze({
  anchorB: -2.0,
  terms: Object.freeze({
    stratum: { beta: 1.0, centre: 1 },
    steps: { beta: 0.03, centre: 3 },
    cells_read: { beta: 0.01, centre: 8 },
    percent: { beta: 0.05, centre: 0 },
    non_integer: { beta: 0.05, centre: 0 },
    negatives: { beta: 0.05, centre: 0 },
    reversal: { beta: 0.1, centre: 0 },
  }),
})

/** [SPEC v0] Seconds per exhibit value read and per step, on top of the §7.4 word term. */
export const QDATA_SECONDS_PER_CELL = 2
export const QDATA_SECONDS_PER_STEP = 10

export const QDATA_PROVENANCE =
  'qdata v0 [SPEC]: b = -2 + 1.0*(stratum - 1) + 0.03*(steps - 3) + 0.01*(cells_read - 8) + 0.05*percent ' +
  '+ 0.05*non_integer + 0.05*negatives + 0.10*reversal; stratum anchors are the default b-band centres; uncalibrated until M4'

export const QDATA_SD_PRIOR = SIGMA_B_DEFAULT

/** The regression features of an item (§12 difficulty_prior inputs). */
export interface QdataFeatures {
  readonly [k: string]: string | number | boolean
  readonly template: string
  readonly variant: string
  readonly stratum: number
  readonly steps: number
  readonly cells_read: number
  readonly percent: boolean
  readonly non_integer: boolean
  readonly negatives: boolean
  readonly reversal: boolean
}

export interface QdataFeatureInput {
  readonly template: string
  readonly variant: string
  readonly stratum: number
  readonly steps: number
  readonly cells_read: number
  readonly percent: boolean
  readonly non_integer: boolean
  readonly negatives: boolean
  readonly reversal: boolean
}

/** The features in their one key order (the order the bank writes too). */
export function qdataFeatures(f: QdataFeatureInput): QdataFeatures {
  return {
    template: f.template,
    variant: f.variant,
    stratum: f.stratum,
    steps: f.steps,
    cells_read: f.cells_read,
    percent: f.percent,
    non_integer: f.non_integer,
    negatives: f.negatives,
    reversal: f.reversal,
  }
}

/** b_prior of the v0 regression, clamped to ±4 (it never reaches the clamp). */
export const qdataBPrior = (f: QdataFeatures): number => clampPrior(linearB(QDATA_PRIOR, f))

/** E[T] in seconds: the §7.4 word term for the stem, plus 2 s per value read and 10 s per step. */
export function qdataExpectedTime(stem: string, cellsRead: number, steps: number): number {
  return expectedTimeFromWords(countWords(stem)) + QDATA_SECONDS_PER_CELL * cellsRead + QDATA_SECONDS_PER_STEP * steps
}

/** The stratum anchor of the regression (for documentation and tests). */
export const anchorOf = (s: Stratum): number => -2 + (s - 1)
