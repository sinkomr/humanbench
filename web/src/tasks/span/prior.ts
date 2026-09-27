/**
 * Scoring-model parameters, difficulty prior and expected time of the span blocks
 * (ROADMAP M1.9, M1.P, A10; DESIGN §7.1, §7.3, §7.4). ALL values are provisional until online
 * calibration (M4.8).
 *
 * [SPEC] v0 GRM (A10): P(longest passed ≥ L | θ) = σ(a(θ − b_L)) with a = 1.7 and
 *
 *     b_L = (L − 0.5 − μ) / σ,   L = 3 … max,
 *
 * i.e. a linear length → b regression with slope 1/σ per item of span and intercept
 * −(μ + 0.5)/σ, from the task's norm μ ± σ (continuity-corrected by 0.5). With a = 1.7 the
 * logistic is close to the normal ogive, so θ reads as the z-score of span in the norm
 * population: θ = 0 passes length μ + 0.5 with probability ½. Norms (μ, σ): forward 6.5/1.2,
 * backward 4.8/1.3 (DESIGN §7.3 L566 [EST†]: adult forward ≈ 6–7, backward ≈ 4–5), Corsi
 * 5.5/1.1 ([SPEC]; no DESIGN value).
 *
 * The block's `difficulty.b_prior` is the same regression at the mean threshold length
 * (start + max)/2, i.e. the mean GRM threshold, with σ_b = 1.0; its stratum follows from the
 * default bands (`stratumOfB`), so each span family has exactly one stratum.
 *
 * [SPEC] v0 expected time (§7.4 E[T], the median taker θ = 0) under the block's own GRM: 12 s
 * of instructions plus, for each length L = 3 … max, P(L is given | θ = 0) × 2 trials ×
 * (L elements × (1 s presentation + r s entry) + 1.5 s between trials), with r = 0.5 s
 * (forward), 0.8 s (backward), 0.6 s (Corsi). The block always gives one length past the
 * longest passed one, so L is given iff longest ≥ L − 1: P = P(y ≥ L − 3 | θ = 0), i.e. 1 at
 * L = 3 and σ(−a·b_{L−1}) above. That is ≈ 117.0 s, 87.0 s and 96.2 s.
 */

import { grmCumulative } from '../../engine'
import type { DifficultyPrior } from '../family'
import { SIGMA_B_DEFAULT, clampPrior, stratumOfB } from '../priors'
import type { Stratum } from '../ids'
import { SPAN_TIMING, START_LENGTH, TRIALS_PER_LENGTH, type SpanTaskConfig } from './config'
import type { SpanProtocol } from './protocol'

/** [SPEC] GRM discrimination of every span block (A10, provisional). */
export const SPAN_GRM_A = 1.7

/** [SPEC] Instruction time at the start of a block, in seconds. */
export const SPAN_INSTRUCTIONS_S = 12
/** [SPEC] Feedback + get-ready gap between trials, in seconds. */
export const SPAN_INTER_TRIAL_S = 1.5

/** The M1.9 protocol of a task: start 3, 2 trials per length, the task's max length. */
export function protocolOf(cfg: SpanTaskConfig): SpanProtocol {
  return { start_length: START_LENGTH, trials_per_length: TRIALS_PER_LENGTH, max_length: cfg.maxLength }
}

/** The length → b regression: b(L) = (L − 0.5 − μ)/σ ([SPEC] v0, A10). */
export function spanB(cfg: SpanTaskConfig, length: number): number {
  return (length - 0.5 - cfg.norm.mu) / cfg.norm.sigma
}

/** GRM thresholds b_L for L = start … max (strictly increasing, one per category above 0). */
export function grmThresholds(cfg: SpanTaskConfig): number[] {
  const out: number[] = []
  for (let length = START_LENGTH; length <= cfg.maxLength; length++) out.push(spanB(cfg, length))
  return out
}

/** Mean threshold length (start + max)/2: where b_prior is evaluated. */
export function meanLength(cfg: SpanTaskConfig): number {
  return (START_LENGTH + cfg.maxLength) / 2
}

/** Provenance of the prior (§12 `difficulty_prior.provenance`). */
export function spanProvenance(cfg: SpanTaskConfig): string {
  const { mu, sigma } = cfg.norm
  return (
    `[SPEC] v0, provisional until M4.8 (A10): GRM a = ${SPAN_GRM_A}, thresholds b_L = (L - 0.5 - mu)/sigma ` +
    `for L = ${START_LENGTH}..${cfg.maxLength} (slope 1/sigma, intercept -(mu + 0.5)/sigma) with norm ` +
    `mu = ${mu}, sigma = ${sigma} (${cfg.normSource}); b_prior = b at the mean length ${meanLength(cfg)}`
  )
}

/** The block's difficulty prior (M1.P): features, b_prior = mean threshold, σ_b = 1.0. */
export function spanDifficulty(cfg: SpanTaskConfig): DifficultyPrior {
  return {
    features: {
      task: cfg.task,
      start_length: START_LENGTH,
      trials_per_length: TRIALS_PER_LENGTH,
      max_length: cfg.maxLength,
      norm_mu: cfg.norm.mu,
      norm_sigma: cfg.norm.sigma,
      mean_length: meanLength(cfg),
    },
    b_prior: clampPrior(spanB(cfg, meanLength(cfg))),
    sd_prior: SIGMA_B_DEFAULT,
    provenance: spanProvenance(cfg),
  }
}

/** The single stratum of a span family: the default band of its b_prior. */
export function spanStratum(cfg: SpanTaskConfig): Stratum {
  return stratumOfB(clampPrior(spanB(cfg, meanLength(cfg))))
}

/**
 * [SPEC] v0 E[T] of a block in seconds at θ = 0 (see the module comment): each length's trial
 * time weighted by the GRM probability that the block reaches it.
 */
export function spanExpectedTime(cfg: SpanTaskConfig): number {
  const soaS = (SPAN_TIMING.on_ms + SPAN_TIMING.off_ms) / 1000
  // reach[k] = P(y ≥ k | θ = 0); length L is given iff y ≥ L − START_LENGTH (reach[0] = 1).
  const reach = grmCumulative(0, SPAN_GRM_A, grmThresholds(cfg))
  let t = SPAN_INSTRUCTIONS_S
  for (let length = START_LENGTH; length <= cfg.maxLength; length++) {
    const given = reach[length - START_LENGTH] as number
    t += given * TRIALS_PER_LENGTH * (length * (soaS + cfg.responseSPerElement) + SPAN_INTER_TRIAL_S)
  }
  return t
}
