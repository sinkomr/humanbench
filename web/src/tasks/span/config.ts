/**
 * Working-memory span blocks (ROADMAP M1.9, A10; DESIGN §3 row 8, §7.1, §14.6 examples 10–11):
 * the three graded sub-tasks, their render payload / key types and the fixed Corsi board.
 *
 * One {@link ItemInstance} is one whole block: every stimulus sequence the block could present
 * (2 trials at each length from 3 to the task's maximum), in presentation order. The adaptive
 * part (which of those trials a taker actually sees) is the pure state machine in `protocol.ts`.
 */

import type { ItemInstance } from '../family'

/** The three WM blocks of a session (A10). */
export type SpanTask = 'digits_forward' | 'digits_backward' | 'corsi'

/** Recall order: backward digit span is keyed on the reversed sequence (§14.6 ex. 10). */
export type RecallOrder = 'forward' | 'backward'

/** M1.9: every block starts at length 3 … */
export const START_LENGTH = 3
/** … with two trials per length. */
export const TRIALS_PER_LENGTH = 2

/** Digits shown in digit span: 1–9 (no 0, M1.9). */
export const DIGITS: readonly number[] = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9])

/** Corsi block indices: 0–8, into {@link CORSI_BOARD}.blocks. */
export const CORSI_INDICES: readonly number[] = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8])

/** A block's centre `[x, y]` in the unit square (origin top-left, y down, as in SVG). */
export type BoardPoint = readonly [number, number]

export interface CorsiBoard {
  /** Side of each square block, as a fraction of the board side. */
  readonly size: number
  /** The 9 block centres; a Corsi sequence holds indices into this list. */
  readonly blocks: readonly BoardPoint[]
}

/**
 * [SPEC] The FIXED 9-block Corsi layout (M1.9, §14.6 ex. 11), in the spirit of the classic
 * Corsi board: an irregular scatter, not a grid. Coordinates are centres in the 0–1 square
 * (origin top-left, y down); blocks are squares of side 0.12. Properties (tested): every block
 * lies inside the square, centres are ≥ 0.27 apart (so blocks never touch), and no two centres
 * share a row or column (|Δx| ≥ 0.06, |Δy| ≥ 0.04). Changing it changes every Corsi item:
 * bump the Corsi generator version.
 */
export const CORSI_BOARD: CorsiBoard = Object.freeze({
  size: 0.12,
  blocks: Object.freeze([
    Object.freeze([0.3, 0.1] as const),
    Object.freeze([0.74, 0.14] as const),
    Object.freeze([0.12, 0.34] as const),
    Object.freeze([0.52, 0.3] as const),
    Object.freeze([0.88, 0.46] as const),
    Object.freeze([0.36, 0.55] as const),
    Object.freeze([0.66, 0.66] as const),
    Object.freeze([0.18, 0.8] as const),
    Object.freeze([0.46, 0.9] as const),
  ]),
})

/** Stimulus timing of one sequence element. */
export interface SpanTiming {
  /** How long each digit / block highlight is shown. */
  readonly on_ms: number
  /** Blank gap before the next element. */
  readonly off_ms: number
}

/** [SPEC] One element per second (800 ms on, 200 ms off), the classic span presentation rate. */
export const SPAN_TIMING: SpanTiming = Object.freeze({ on_ms: 800, off_ms: 200 })

/**
 * The render payload of a span block. `trials[i]` is the stimulus of trial i, whose length is
 * `start_length + ⌊i / trials_per_length⌋`. For forward digits and Corsi the stimuli are the key
 * by design, for backward digits its reversal (the runs set `allowKeyInSpec`).
 */
export interface SpanSpec {
  readonly task: SpanTask
  readonly recall: RecallOrder
  readonly start_length: number
  readonly trials_per_length: number
  readonly max_length: number
  readonly trials: readonly (readonly number[])[]
  readonly timing: SpanTiming
  /** Corsi only: the fixed board; omitted for digit tasks. */
  readonly board?: CorsiBoard
}

/** The per-trial expected responses, in presentation order (exact match, §14.6 ex. 10–11). */
export interface SpanKey {
  readonly sequences: readonly (readonly number[])[]
}

/** A block's response stream: the sequence entered on each trial given so far, in order. */
export type SpanResponse = readonly unknown[]

export type SpanItem = ItemInstance<SpanSpec, SpanKey>

/** Provisional population norm of the span score (A10, §7.3): mean μ and SD σ in items. */
export interface SpanNorm {
  readonly mu: number
  readonly sigma: number
}

/** Everything that distinguishes the three span families. */
export interface SpanTaskConfig {
  /** Family name used in ids. */
  readonly name: 'span_fwd' | 'span_bwd' | 'corsi'
  readonly task: SpanTask
  readonly recall: RecallOrder
  /** M1.9: 10 forward / 10 Corsi / 9 backward. */
  readonly maxLength: number
  /** What a sequence draws from: digits 1–9 or Corsi block indices 0–8. */
  readonly symbols: readonly number[]
  /** Digit tasks forbid ±1 runs of three (1-2-3, 8-7-6); Corsi indices have no order. */
  readonly forbidRuns: boolean
  /** Backward trials must not be palindromes (else the forward order is also exactly correct). */
  readonly forbidPalindromes: boolean
  /** [EST†]/[SPEC] provisional norm (A10). */
  readonly norm: SpanNorm
  /** [SPEC] response entry time per element, in seconds (expected-time prior). */
  readonly responseSPerElement: number
  /** Source of the norm, quoted in the prior's provenance. */
  readonly normSource: string
}

/** Forward digit span: norm 6.5 ± 1.2 (DESIGN §7.3 [EST†]: typical adult forward ≈ 6–7). */
export const SPAN_FWD: SpanTaskConfig = Object.freeze({
  name: 'span_fwd',
  task: 'digits_forward',
  recall: 'forward',
  maxLength: 10,
  symbols: DIGITS,
  forbidRuns: true,
  forbidPalindromes: false,
  norm: Object.freeze({ mu: 6.5, sigma: 1.2 }),
  responseSPerElement: 0.5,
  normSource: 'DESIGN §7.3 [EST†] typical adult forward digit span ≈ 6–7',
})

/** Backward digit span: norm 4.8 ± 1.3 (DESIGN §7.3 [EST†]: typical adult backward ≈ 4–5). */
export const SPAN_BWD: SpanTaskConfig = Object.freeze({
  name: 'span_bwd',
  task: 'digits_backward',
  recall: 'backward',
  maxLength: 9,
  symbols: DIGITS,
  forbidRuns: true,
  forbidPalindromes: true,
  norm: Object.freeze({ mu: 4.8, sigma: 1.3 }),
  responseSPerElement: 0.8,
  normSource: 'DESIGN §7.3 [EST†] typical adult backward digit span ≈ 4–5',
})

/** Corsi block span: norm 5.5 ± 1.1 ([SPEC]: DESIGN gives no Corsi norm; set near digit span). */
export const SPAN_CORSI: SpanTaskConfig = Object.freeze({
  name: 'corsi',
  task: 'corsi',
  recall: 'forward',
  maxLength: 10,
  symbols: CORSI_INDICES,
  forbidRuns: false,
  forbidPalindromes: false,
  norm: Object.freeze({ mu: 5.5, sigma: 1.1 }),
  responseSPerElement: 0.6,
  normSource: '[SPEC] no DESIGN norm for Corsi; set between the §7.3 [EST†] digit span norms',
})

export const SPAN_TASKS: readonly SpanTaskConfig[] = Object.freeze([SPAN_FWD, SPAN_BWD, SPAN_CORSI])

/** The alphabet of a span task (digits 1–9, Corsi blocks 0–8); throws a RangeError on an unknown task. */
export function spanSymbols(task: SpanTask): readonly number[] {
  const cfg = SPAN_TASKS.find((c) => c.task === task)
  if (cfg === undefined) throw new RangeError(`unknown span task ${JSON.stringify(task)}`)
  return cfg.symbols
}
