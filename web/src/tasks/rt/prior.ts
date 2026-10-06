/**
 * Norms, item parameters and priors of the `rt` family (ROADMAP M1.P, A10; DESIGN §6.ii, §7.1,
 * §7.4, §11.6). Every number here is [SPEC, provisional] until M4.8 calibrates the RT model.
 *
 * Measurement model (§7.1, A10): the block statistic x = median ln(RT) of the valid trials is
 * a Gaussian observation x ~ N(lam·θ + d, sigma²) with lam = −s and d = β, so θ̂ = (β − x)/s
 * (faster = higher). The item's `params.sigma` is the residual τ_res (the one meaning of a
 * Gaussian block's sigma, M1.F2, `family.ts`); each observation widens it with the person's own
 * SE, sigma = √(SE² + τ_res²) (see `score.ts`).
 */

import type { ItemParams } from '../../engine'
import type { DifficultyPrior, Feature } from '../family'
import { SIGMA_B_DEFAULT, clampPrior, linearB, type LinearPriorModel } from '../priors'
import type { Stratum } from '../ids'
import { RT_MODE_CONFIG, RT_PRACTICE_TRIALS, type RtMode, type RtSpec } from './types'

/** Version tag of the norm table below, stored with every observation. */
export const RT_NORMS_VERSION = 'rt-web-v1'

/** One norm row: β = ln(median RT), slope s (log-RT per θ SD) and residual τ_res. */
export interface RtNorm {
  /** Population median RT in ms; β = ln(median_rt_ms). */
  readonly median_rt_ms: number
  readonly beta: number
  readonly s: number
  readonly tau_res: number
}

/**
 * [SPEC, provisional] web norms (A10) for keyboard and mouse (and an unknown input type): simple
 * β = ln 300, choice β = ln 450, s = 0.15, τ_res = 0.05. Web RTs include device lag (§7.3), hence
 * the medians above lab values (≈ 200–250 ms simple).
 */
export const RT_WEB_NORMS: Readonly<Record<RtMode, RtNorm>> = Object.freeze({
  simple: Object.freeze({ median_rt_ms: 300, beta: Math.log(300), s: 0.15, tau_res: 0.05 }),
  choice4: Object.freeze({ median_rt_ms: 450, beta: Math.log(450), s: 0.15, tau_res: 0.05 }),
})

/**
 * [SPEC, provisional until M4.8] touch norms (owner decision 2026-10-06, UX-REVIEW D3): simple
 * β = ln 470, choice β = ln 620, s = 0.20, τ_res = 0.05. A typical touch-screen median simple RT
 * (about 450–500 ms) must not read as an extreme low (under s = 0.15 and β = ln 300, 470 ms was
 * −3 SD). Basis: the touch values add about 170 ms of touch-event and screen-pipeline delay to
 * the keyboard/mouse web norms (touch events reach the page roughly 50–100+ ms after contact on
 * phones; display and browser latency add more, and vary widely between devices, cf. Anwyl-Irvine
 * et al. 2021, Behav Res Methods, "Realistic precision and accuracy of online experiment
 * platforms, web browsers, and devices"). [SPEC]: no figure could be re-checked at the time of
 * writing, so no number here is [EST]. s = 0.20 is wider because touch device lag differs between
 * handsets on top of the usual spread between people (a population simple-RT SD of about 15–20%
 * of the median is typical of age-mixed samples). Revisit with real touch blocks at M4.8 (§11.6).
 */
export const RT_TOUCH_NORMS: Readonly<Record<RtMode, RtNorm>> = Object.freeze({
  simple: Object.freeze({ median_rt_ms: 470, beta: Math.log(470), s: 0.2, tau_res: 0.05 }),
  choice4: Object.freeze({ median_rt_ms: 620, beta: Math.log(620), s: 0.2, tau_res: 0.05 }),
})

/**
 * The norm for a mode and input type (§11.6: normed separately by input). 'touch' uses
 * {@link RT_TOUCH_NORMS}; keyboard, mouse and an unknown input type use {@link RT_WEB_NORMS}.
 * Device class does not change the norm yet (M4.8).
 */
export function rtNorm(mode: RtMode, _deviceClass?: string, inputType?: string): RtNorm {
  return inputType === 'touch' ? RT_TOUCH_NORMS[mode] : RT_WEB_NORMS[mode]
}

/** The A10 Gaussian parameters of a norm row: lam = −s, d = β, sigma = τ_res. */
export function rtParamsOfNorm(n: RtNorm): Extract<ItemParams, { model: 'gaussian' }> {
  return { model: 'gaussian', lam: -n.s, d: n.beta, sigma: n.tau_res }
}

/** The block's A10 Gaussian item parameters: lam = −s, d = β, sigma = τ_res. */
export function rtItemParams(mode: RtMode): Extract<ItemParams, { model: 'gaussian' }> {
  return rtParamsOfNorm(RT_WEB_NORMS[mode])
}

/**
 * [SPEC] v0 difficulty regression: b = 0 + 0 · choice. A fixed speed block has no item
 * difficulty on θ: its Gaussian location d = β is centred on the population norm, so both
 * modes sit at θ = 0 and the choice term is 0 until calibration says otherwise (M4.8). The
 * selector never adapts RT (M1.14 runs it as a fixed block); b only fixes the stratum.
 */
export const RT_PRIOR: LinearPriorModel = Object.freeze({
  anchorB: 0,
  terms: Object.freeze({ choice: Object.freeze({ beta: 0, centre: 0.5 }) }),
})

export const RT_PROVENANCE =
  '[SPEC] v0 fixed-block prior: b = 0 + 0*choice (location d = beta centres both modes on the provisional web norm, theta = 0); sd_prior 1.0 (M1.P, A10)'

/** The only stratum RT blocks occupy: stratumOfB(0) = 3 (§6.ii bands). */
export const RT_STRATUM: Stratum = 3

/** Integer sum (throws on a non-integer, so features stay exact in TS and Python). */
function intSum(xs: readonly number[]): number {
  let s = 0
  for (const x of xs) {
    if (!Number.isInteger(x)) throw new RangeError(`expected integer milliseconds, got ${x}`)
    s += x
  }
  return s
}

/** The v0 regression features of a block schedule. */
export function rtFeatures(spec: RtSpec): Record<string, Feature> {
  const cfg = RT_MODE_CONFIG[spec.mode]
  return {
    mode: spec.mode,
    choice: spec.mode === 'choice4',
    n_positions: cfg.n_positions,
    n_trials: cfg.n_trials,
    n_practice: RT_PRACTICE_TRIALS,
    mean_foreperiod_ms: intSum(spec.foreperiods_ms) / spec.foreperiods_ms.length,
  }
}

/** The block's difficulty prior (M1.P): features, b from {@link RT_PRIOR}, σ_b = 1.0. */
export function rtDifficulty(spec: RtSpec): DifficultyPrior {
  const features = rtFeatures(spec)
  return { features, b_prior: clampPrior(linearB(RT_PRIOR, features)), sd_prior: SIGMA_B_DEFAULT, provenance: RT_PROVENANCE }
}

/**
 * [SPEC] v0 block-time model (§7.4 E[T], for blocks the block duration): instructions, then per
 * trial (practice included) its foreperiod, the norm median RT and a fixed inter-trial interval.
 */
export const RT_TIME_MODEL = Object.freeze({ instructions_s: 15, iti_ms: 500 })

/** Expected block duration in seconds, E[T] (§7.4): 15 s + Σ (foreperiod + median RT + ITI). */
export function rtExpectedTimeS(spec: RtSpec): number {
  const fp = intSum(spec.practice_foreperiods_ms) + intSum(spec.foreperiods_ms)
  const nTotal = spec.practice_foreperiods_ms.length + spec.foreperiods_ms.length
  const perTrial = RT_WEB_NORMS[spec.mode].median_rt_ms + RT_TIME_MODEL.iti_ms
  return RT_TIME_MODEL.instructions_s + (fp + nTotal * perTrial) / 1000
}

/** The structure hashed into family_id (A11): blocks of one mode are isomorphs whatever their jitter. */
export function rtStructure(mode: RtMode): { mode: RtMode; n_positions: number; n_practice: number; n_trials: number } {
  const cfg = RT_MODE_CONFIG[mode]
  return { mode, n_positions: cfg.n_positions, n_practice: RT_PRACTICE_TRIALS, n_trials: cfg.n_trials }
}
