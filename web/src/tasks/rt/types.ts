/**
 * Reaction-time blocks: constants and wire types of the `rt` family (ROADMAP M1.10, A10;
 * DESIGN §3 row 9, §7.1, §11.6, §14.6 example 12).
 *
 * One item instance is one whole block (family contract, `family.ts`): a simple-RT block
 * (30 scored trials, one stimulus location) or a 4-choice block (40 scored trials, positions
 * 0–3), each preceded by 3 practice trials that are never scored. All JSON is snake_case.
 */

import type { Observation } from '../../engine'

/** Block variants: simple RT and 4-choice RT (§3 row 9). */
export type RtMode = 'simple' | 'choice4'

export const RT_MODES: readonly RtMode[] = Object.freeze(['simple', 'choice4'] as const)

export function isRtMode(v: unknown): v is RtMode {
  return v === 'simple' || v === 'choice4'
}

/** Per-mode block layout and trimming window (§7.1, A10). */
export interface RtModeConfig {
  /** Stimulus locations: 1 (simple) or 4 (choice; positions 0–3). */
  readonly n_positions: number
  /** Scored trials per block (§3 row 9). */
  readonly n_trials: number
  /** Fewest valid trials that still yield an observation (A10); below it the block yields none. */
  readonly min_valid: number
  /** Valid RT window in ms, both ends inclusive (§7.1 trimming). */
  readonly min_rt_ms: number
  readonly max_rt_ms: number
}

export const RT_MODE_CONFIG: Readonly<Record<RtMode, RtModeConfig>> = Object.freeze({
  simple: Object.freeze({ n_positions: 1, n_trials: 30, min_valid: 20, min_rt_ms: 150, max_rt_ms: 1500 }),
  choice4: Object.freeze({ n_positions: 4, n_trials: 40, min_valid: 30, min_rt_ms: 200, max_rt_ms: 2000 }),
})

/** Practice trials before the scored trials; excluded from scoring. */
export const RT_PRACTICE_TRIALS = 3

/** Foreperiod (trial start → stimulus onset) bounds in integer ms, uniform, both inclusive (§14.6 ex. 12). */
export const FOREPERIOD_MIN_MS = 800
export const FOREPERIOD_MAX_MS = 2000

/**
 * Choice blocks: the same position on at most this many consecutive trials as shown, i.e. over
 * the practice trials followed by the scored trials (no run of 4 across that boundary either).
 */
export const MAX_POSITION_RUN = 3

/**
 * Render payload of one block. Stimulus positions are the key by design (§14.6 ex. 12: "key =
 * position"): the renderer must know where to draw each stimulus. Simple blocks use position 0.
 */
export interface RtSpec {
  readonly mode: RtMode
  readonly n_positions: number
  readonly practice_foreperiods_ms: readonly number[]
  readonly practice_positions: readonly number[]
  readonly foreperiods_ms: readonly number[]
  readonly positions: readonly number[]
}

/**
 * A block's responses as parallel arrays over the scored trials (and, optionally, the practice
 * trials, which scoring ignores). `rt_ms[i]` is the response time from the onset frame in ms
 * (negative = pressed before the onset frame ran, an anticipation: `responseRtMs` in
 * `timing.ts`) or null for no response; `choice[i]` is
 * the position pressed (always 0 in simple blocks), null exactly when `rt_ms[i]` is null.
 */
export interface RtResponse {
  readonly rt_ms: readonly (number | null)[]
  readonly choice: readonly (number | null)[]
  readonly practice_rt_ms?: readonly (number | null)[]
  readonly practice_choice?: readonly (number | null)[]
}

/** Device context stored with an RT observation (§11.6: norm within device class). */
export interface RtDevice {
  /** e.g. "desktop", "tablet", "phone" (the device check of M1.15 decides the vocabulary). */
  readonly device_class: string
  /** "keyboard", "mouse" or "touch" (§11.6 item 5, §13). */
  readonly input_type?: string
  /** Refresh-rate estimate from `estimateRefreshRate` (§11.6 item 2). */
  readonly refresh_hz_est?: number
}

/** How one scored trial counts. The first matching outcome in this order wins. */
export type TrialOutcome = 'miss' | 'anticipation' | 'error' | 'too_fast' | 'too_slow' | 'valid'

/** Trial counts of a scored block, one per {@link TrialOutcome}. */
export interface RtTrialCounts {
  readonly n_valid: number
  readonly n_misses: number
  readonly n_anticipations: number
  readonly n_errors: number
  readonly n_too_fast: number
  readonly n_too_slow: number
}

/** The scorer's Gaussian observation (engine `Observation`, wire names `lam`, `d`, `sigma`, `x`). */
export type GaussianObservation = Extract<Observation, { kind: 'gaussian' }>

/** Metadata stored beside an RT observation (never inside it: the scorer's observation schema is closed). */
export interface RtObservationMeta extends RtTrialCounts {
  readonly mode: RtMode
  readonly n_trials: number
  readonly min_valid: number
  readonly device_class: string
  readonly input_type?: string
  readonly refresh_hz_est?: number
  /** Version of the norm table that set β, s and τ_res (`RT_NORMS_VERSION`). */
  readonly norms_version: string
}

/** Why a block yields no observation. */
export type RtNoObservationReason = 'too_few_valid_trials'

/** Result of scoring one block (A10). */
export type RtBlockResult =
  | {
      readonly status: 'ok'
      readonly observation: GaussianObservation
      /** SE of the median log-RT, before τ_res is added (sigma = √(SE² + τ_res²)). */
      readonly se: number
      readonly meta: RtObservationMeta
    }
  | {
      readonly status: 'no_observation'
      readonly reason: RtNoObservationReason
      /** Human-readable detail, e.g. "17 valid simple trials < 20 required". */
      readonly detail: string
      readonly meta: RtObservationMeta
    }

/** What scoring the reference responses must give (the §12-style scoring self-check). */
export interface RtExpected extends RtTrialCounts {
  readonly status: 'ok' | 'no_observation'
  /** status "no_observation" only. */
  readonly reason?: RtNoObservationReason
  /** status "ok" only. */
  readonly observation?: GaussianObservation
  /** status "ok" only. */
  readonly se?: number
}

/**
 * A synthetic worked scoring example carried in the key: responses for every trial (drawn from
 * a lapse-prone mixture so both outcomes and every trimming rule occur) and the result they
 * must score to. `verify()` recomputes it, and the bank's Python twin recomputes it from the TS
 * dump to 1e-12 (A1). Never rendered and never scored as a person.
 */
export interface RtReference {
  readonly device_class: string
  readonly practice_rt_ms: readonly (number | null)[]
  readonly practice_choice: readonly (number | null)[]
  readonly rt_ms: readonly (number | null)[]
  readonly choice: readonly (number | null)[]
  readonly expected: RtExpected
}

/** The block key: the correct response per scored trial (= stimulus position) plus the reference. */
export interface RtKey {
  readonly positions: readonly number[]
  readonly reference: RtReference
}
