/**
 * Norms, scoring-model parameters, difficulty prior and expected time of the coding block
 * (ROADMAP M1.11, M1.P, A10; DESIGN §3 row 10, §7.1, §7.4). ALL values are [SPEC],
 * provisional until online calibration (M4.8).
 *
 * ## Observation model (A10: a Gaussian observation on θ_PS)
 *
 *     x = ln(correct per minute) ~ N(s·θ + d, σ²),   d = β − s·b,   σ² = SE² + τ_res²,
 *
 * with the provisional norms β = ln 40, s = 0.25, τ_res = 0.05 and the Poisson standard error
 * SE = 1/√correct (Var ln N ≈ 1/N for a Poisson count N; §7.1 "Poisson/log-normal rate").
 * Rationale ([SPEC], to be replaced by the M4.8 fit):
 * - β = ln 40: a norm taker (θ = 0) makes 40 correct/min, 60 correct in 90 s. Paper
 *   symbol-digit tests run at roughly 35–45 correct/min in adults [EST†], and typing on a
 *   keypad instead of writing or speaking is not faster, so 40/min is a round mid value.
 * - s = 0.25: one SD of θ is a factor e^0.25 ≈ 1.28 in rate. Symbol-digit scores have a
 *   within-age CV near 0.2 [EST†]; an adult web sample spanning ages 18–80 adds age spread,
 *   hence 0.25 on the log scale.
 * - τ_res = 0.05: a floor for residual noise that the count does not carry (input device and
 *   latency, state), so σ ≥ 0.05 however many responses there are. The Poisson SE itself is
 *   conservative: inter-response times are far more regular than exponential, so real counts
 *   are under-dispersed. At the norm count (60) σ = √(1/60 + 0.05²) ≈ 0.138, i.e. a single
 *   block has reliability s²/(s² + σ²) ≈ .77 in the norm population.
 * `params.sigma` is that nominal σ at the norm count (for information-per-second planning,
 * §7.4); the observation of a finished block uses the σ of its own count.
 *
 * ## Difficulty prior ([SPEC] v0 regression, σ_b = 1.0)
 *
 *     b = 0 + 0.064 · (n_symbols − 9)
 *
 * b is the θ at which the block yields the norm rate β. Every block has the same design (9
 * glyphs, 200 stimuli, 90 s), so b = 0 and the stratum is 3 (band −0.5…0.5). The one term
 * prices legend size by a Hick–Hyman lookup cost of ≈ 150 ms per bit on the 1.5 s-per-item norm
 * pace: d ln(rate)/dn = −0.15 / (1.5 · n · ln 2) ≈ −0.016 per glyph at n = 9, i.e. +0.064 in θ
 * units (÷ s). It only matters if a later design varies the legend size.
 *
 * Expected time (§7.4 E[T] of a block): the timed window, 90 s.
 */

import type { DifficultyPrior } from '../family'
import type { ItemParams } from '../../engine'
import { SIGMA_B_DEFAULT, clampPrior, linearB, stratumOfB, type LinearPriorModel } from '../priors'
import type { Stratum } from '../ids'
import { CODING_DURATION_S, CODING_SEQUENCE_LENGTH, CODING_SYMBOLS } from './config'

/** [SPEC] Norm rate of a θ = 0 taker, correct responses per minute. */
export const CODING_NORM_CPM = 40
/** [SPEC] β = ln(norm rate): the location of x = ln(correct/min) at θ = b. */
export const CODING_BETA = Math.log(CODING_NORM_CPM)
/** [SPEC] s: the loading of x on θ_PS (log-rate change per SD of θ). */
export const CODING_RATE_SCALE = 0.25
/** [SPEC] τ_res: residual SD of x beyond the Poisson counting error. */
export const CODING_TAU_RES = 0.05

/** [SPEC] v0 difficulty regression: b = 0 + 0.064 · (n_symbols − 9). */
export const CODING_PRIOR: LinearPriorModel = Object.freeze({
  anchorB: 0,
  terms: Object.freeze({ n_symbols: Object.freeze({ beta: 0.064, centre: 9 }) }),
})

export const CODING_PROVENANCE =
  '[SPEC] v0, provisional until M4.8 (A10): b = 0 + 0.064*(n_symbols - 9) (Hick-Hyman lookup cost ~150 ms/bit on the ' +
  '1.5 s/item norm pace, in theta units of s); x = ln(correct/min) ~ N(s*theta + beta - s*b, SE^2 + tau_res^2) with ' +
  'beta = ln 40, s = 0.25, tau_res = 0.05, SE = 1/sqrt(correct) (Poisson)'

/** Correct responses a norm taker makes in the window: 40/min × 1.5 min = 60. */
export const CODING_NORM_CORRECT = (CODING_NORM_CPM * CODING_DURATION_S) / 60

/** The regression inputs of a block design (every block shares them). */
export function codingFeatures(): Record<string, number> {
  return {
    n_symbols: CODING_SYMBOLS.length,
    sequence_length: CODING_SEQUENCE_LENGTH,
    duration_s: CODING_DURATION_S,
  }
}

/** The block's difficulty prior (§6.ii, M1.P). */
export function codingDifficulty(): DifficultyPrior {
  const features = codingFeatures()
  return { features, b_prior: clampPrior(linearB(CODING_PRIOR, features)), sd_prior: SIGMA_B_DEFAULT, provenance: CODING_PROVENANCE }
}

/** The stratum of the block design: the default band of b_prior (3). */
export function codingStratum(): Stratum {
  return stratumOfB(codingDifficulty().b_prior)
}

/** σ of the observation for a count of `correct` ≥ 1: √(1/correct + τ_res²). */
export function codingSigma(correct: number): number {
  if (!(Number.isInteger(correct) && correct >= 1)) throw new RangeError(`codingSigma(): correct must be an integer ≥ 1, got ${correct}`)
  return Math.sqrt(1 / correct + CODING_TAU_RES * CODING_TAU_RES)
}

/** The block's Gaussian params (A10): lam = s, d = β − s·b, sigma = σ at the norm count. */
export function codingParams(bPrior: number): ItemParams {
  return {
    model: 'gaussian',
    lam: CODING_RATE_SCALE,
    d: CODING_BETA - CODING_RATE_SCALE * bPrior,
    sigma: codingSigma(CODING_NORM_CORRECT),
  }
}

/** E[T] of the block (§7.4): the timed window. */
export function codingExpectedTime(): number {
  return CODING_DURATION_S
}
