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
 * ## Why the scoring model stands under the reactive procedure (generator 1.2.0)
 *
 * The block is scored as ONE graded response, the longest passed length (§3 row 8, A10), and a
 * length is passed by one exactly correct trial. Write p_L(θ) for the chance that a trial at
 * length L is exactly right, and take the trials of a length as independent given θ (the
 * assumption "trials as binomial" of §3 already makes).
 *
 * - Fixed (1.1.0): both trials are given; the length is passed unless both fail: 1 − (1 − p_L)².
 * - Reactive (1.2.0): the first trial passes it with p_L; after a miss the second does with p_L:
 *   p_L + (1 − p_L)·p_L = 1 − (1 − p_L)².
 *
 * The same number, at every length. Both procedures stop at the first length that is not passed, so
 * P(longest ≥ L | θ) = Π_{l ≤ L} (1 − (1 − p_l)²) under both: the graded outcome has ONE
 * distribution, whichever procedure gave the block. Hence the GRM of the outcome, its thresholds
 * b_L, its discrimination, the Fisher information of the block's observation (so the block's
 * score and its SE), the difficulty prior and the stratum are unchanged, and a 1.1.0 block and a
 * 1.2.0 block are observations of the same model. `procedure.test.ts` checks the identity exactly
 * (every response path of both machines, for arbitrary p_L) and by simulation with the block's own
 * GRM, and that the two procedures recover θ equally.
 *
 * What does change:
 * - **Trials given.** A passed length takes 2 − p_L/q_L trials on average under the reactive
 *   procedure instead of 2 (q_L = 1 − (1 − p_L)², the chance of passing; given a pass, the first
 *   trial was right with p_L/q_L), a failed one 2 under both. The time model below follows.
 * - **The trial record** (not scored today; M4.8 may calibrate on it). Each trial given is still a
 *   Bernoulli(p_L) draw and the stopping rule depends only on outcomes already seen, so the
 *   likelihood of a block's trials is still Π p_L^correct (1 − p_L)^wrong: a model fitted by
 *   likelihood needs no correction. A plain proportion correct per length does: the reactive block
 *   stops a length at its first success, so correct/given over-states p_L (it reads 1 for p_L = ½
 *   half the time), and there are about half as many trials per block to learn from.
 * - **What the person learns.** A second sequence of the same length tells them the first was
 *   missed. Whether that changes the second attempt (the independence above) is an empirical
 *   question for M4.8, as it was for the fixed block's two trials.
 *
 * The trial-level p_L the GRM implies: the chance of passing length L once it is reached is
 * q_L(θ) = P*(≥ L)/P*(≥ L − 1), so p_L(θ) = 1 − √(1 − q_L(θ)) ({@link spanTrialP}).
 *
 * ## Expected time ({@link spanExpectedTime}; §7.4 E[T], the median taker θ = 0)
 *
 * Instructions, then for each length L = 3 … max: P(L is reached | θ = 0) × E[trials at L] × (the
 * get-ready and pause around a trial + L elements × (1 s presentation + r s entry) + the entry's
 * fixed part). P(L is reached) = P*(≥ L − 1) (1 at L = 3). E[trials at L] is 2 for the fixed
 * procedure and 2 − p_L(0) for the reactive one (one trial, and a second with probability 1 − p_L).
 *
 * The constants are {@link SPAN_TIME_V1}, [EST] from the one full session on record (the owner's,
 * 2026-10-12, an accurate taker on the fixed procedure, one data point: 173 s for 12 forward trials to
 * length 8, 319 s for 14 backward to 9, 233 s for 14 Corsi to 9; the model gives 172, 277 and 226 s
 * for those trials): 15 s of instructions, 1.7 s around each trial (the renderer's 0.7 s lead and
 * 1 s pause), 2 s to start and confirm an entry, and r = 0.7 s (forward), 1.5 s (backward),
 * 0.9 s (Corsi) per element. That is 113.2 s, 103.0 s and 99.8 s for the three reactive blocks at
 * θ = 0; the fixed procedure on the same clock would be 156.0 s, 131.5 s and 132.2 s, so the
 * reactive procedure saves a median taker about 43, 28 and 32 s a block (about a quarter), and one
 * at θ = +2 about 79, 73 and 66 s (about a third; simulated, `procedure.test.ts`).
 * The 1.1.0 generator's [SPEC] v0 constants ({@link SPAN_TIME_V0}: 12 s, 1.5 s, no fixed part,
 * r = 0.5 / 0.8 / 0.6) are kept for the 1.1.0 blocks only; they gave 117.0 s, 87.0 s and 96.2 s
 * for blocks that took about 156, 131 and 132 s on the clock above.
 */

import { grmCumulative } from '../../engine'
import type { DifficultyPrior } from '../family'
import { SIGMA_B_DEFAULT, clampPrior, stratumOfB } from '../priors'
import type { Stratum } from '../ids'
import { SPAN_PROCEDURE, SPAN_TIMING, START_LENGTH, TRIALS_PER_LENGTH, type SpanProcedure, type SpanTaskConfig } from './config'
import type { SpanProtocol } from './protocol'

/** [SPEC] GRM discrimination of every span block (A10, provisional). */
export const SPAN_GRM_A = 1.7

/** The constants of a block's time model (module comment, "Expected time"). */
export interface SpanTimeModel {
  /** Instruction time at the start of a block, in seconds. */
  readonly instructions_s: number
  /** The get-ready lead before a sequence and the pause after its entry, in seconds per trial. */
  readonly inter_trial_s: number
  /** The part of an entry that does not grow with its length (starting it, confirming it), in seconds per trial. */
  readonly entry_base_s: number
  /** Entry time per element, in seconds. */
  readonly entry_s_per_element: (cfg: SpanTaskConfig) => number
}

/** [SPEC] v0, the 1.1.0 generator's: kept for the 1.1.0 blocks a save may hold. */
export const SPAN_TIME_V0: SpanTimeModel = Object.freeze({ instructions_s: 12, inter_trial_s: 1.5, entry_base_s: 0, entry_s_per_element: (cfg: SpanTaskConfig) => cfg.responseSPerElementV0 })

/** [EST] the 1.2.0 generator's, from the one full session on record (module comment). */
export const SPAN_TIME_V1: SpanTimeModel = Object.freeze({ instructions_s: 15, inter_trial_s: 1.7, entry_base_s: 2, entry_s_per_element: (cfg: SpanTaskConfig) => cfg.responseSPerElement })

/** The time model a procedure's generator uses: v0 for the fixed 1.1.0 blocks, v1 for the reactive ones. */
export function spanTimeModel(procedure: SpanProcedure = SPAN_PROCEDURE): SpanTimeModel {
  return procedure === 'fixed' ? SPAN_TIME_V0 : SPAN_TIME_V1
}

/** [EST] Instruction time at the start of a (reactive) block, in seconds. */
export const SPAN_INSTRUCTIONS_S = SPAN_TIME_V1.instructions_s
/** [EST] Get-ready lead and pause around a trial of a (reactive) block, in seconds. */
export const SPAN_INTER_TRIAL_S = SPAN_TIME_V1.inter_trial_s

/** The protocol of a task: start 3, 2 sequences per length, the task's max length, and the procedure (default: the current one). */
export function protocolOf(cfg: SpanTaskConfig, procedure: SpanProcedure = SPAN_PROCEDURE): SpanProtocol {
  return { start_length: START_LENGTH, trials_per_length: TRIALS_PER_LENGTH, max_length: cfg.maxLength, procedure }
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
 * The chance that one trial at each length L = start … max is exactly right at θ, as the block's
 * GRM implies it (module comment): p_L = 1 − √(1 − q_L) with q_L = P*(≥ L)/P*(≥ L − 1) the chance
 * of passing the length once it is reached. Entry k is length start + k.
 */
export function spanTrialP(theta: number, a: number, thresholds: readonly number[]): number[] {
  const reach = grmCumulative(theta, a, thresholds)
  return thresholds.map((_, k) => {
    const prev = reach[k] as number
    const q = prev > 0 ? Math.min(1, (reach[k + 1] as number) / prev) : 0
    return 1 - Math.sqrt(1 - q)
  })
}

/** Seconds one trial of `length` elements takes under a time model: lead and pause, presentation, entry. */
export function spanTrialTimeS(cfg: SpanTaskConfig, length: number, model: SpanTimeModel = SPAN_TIME_V1): number {
  const soaS = (SPAN_TIMING.on_ms + SPAN_TIMING.off_ms) / 1000
  return model.inter_trial_s + model.entry_base_s + length * (soaS + model.entry_s_per_element(cfg))
}

/**
 * E[T] of a block in seconds at θ = 0 (module comment, "Expected time"): each length's trial time,
 * weighted by the GRM probability that the block reaches it and by the trials it then takes under
 * the procedure.
 */
export function spanExpectedTime(cfg: SpanTaskConfig, procedure: SpanProcedure = SPAN_PROCEDURE, model: SpanTimeModel = spanTimeModel(procedure)): number {
  const thresholds = grmThresholds(cfg)
  // reach[k] = P(y ≥ k | θ = 0); length L is given iff y ≥ L − START_LENGTH (reach[0] = 1).
  const reach = grmCumulative(0, SPAN_GRM_A, thresholds)
  const p = spanTrialP(0, SPAN_GRM_A, thresholds)
  let t = model.instructions_s
  for (let length = START_LENGTH; length <= cfg.maxLength; length++) {
    const k = length - START_LENGTH
    const trials = procedure === 'fixed' ? TRIALS_PER_LENGTH : 2 - (p[k] as number)
    t += (reach[k] as number) * trials * spanTrialTimeS(cfg, length, model)
  }
  return t
}
