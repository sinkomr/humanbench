/**
 * Symbol-digit coding block: constants and types (ROADMAP M1.11, A10; DESIGN §3 row 10, §7.1).
 *
 * One {@link CodingItem} is ONE WHOLE 90 s block: a legend pairing 9 abstract glyphs with the
 * digits 1–9 (a random bijection per session, drawn from the seed) and a stream of 200 glyphs
 * with no immediate repeats and near-uniform frequencies (every glyph 22 or 23 times). The
 * taker types the digit of each glyph in turn; the score is the log rate of correct responses
 * within the window.
 *
 * The legend IS the key by design (§3 row 10: the taker must be shown the table). The key
 * repeats it as `table` (glyph → digit) for scoring; nothing else in the spec carries a digit
 * (the stream holds glyph ids only), so the spec reveals no more than the legend the taker sees.
 */

import type { ItemInstance } from '../family'

/**
 * The 9 glyph ids (render in M1.13; ids only here). Simple solid or outline shapes chosen so
 * that NONE reads as a digit 0–9, a letter or a keyboard symbol: the taker answers on digit
 * keys (0 included, never right), so a glyph that looks like a key would invite a systematic
 * error or a shortcut (symbol-digit tests use non-alphanumeric symbols for this reason). So no
 * circle outline (0 / O), vertical strokes (1 / l / ||), plus (+), angle (< > ^ v) or wave (~).
 * M1.13 must keep that property when it draws them:
 * halfdisc = filled half-disc, flat side down; star = filled five-pointed star (not the thin
 * asterisk); wedge = filled upward triangle; tridot = three filled dots at the corners of a
 * triangle; bowtie = two filled triangles tip to tip; diamond = square on its corner, outline;
 * trapezoid = outline, long side down; pentagon = regular pentagon outline, point up;
 * dotbox = square outline with a centre dot.
 */
export const CODING_SYMBOLS = Object.freeze([
  'halfdisc',
  'star',
  'wedge',
  'tridot',
  'bowtie',
  'diamond',
  'trapezoid',
  'pentagon',
  'dotbox',
] as const)

export type CodingSymbol = (typeof CODING_SYMBOLS)[number]

/** Digits of the legend, 1–9 in display order (one per glyph). */
export const CODING_DIGITS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9] as const)

/** Stimuli per block (M1.11): enough that no plausible taker exhausts them in 90 s. */
export const CODING_SEQUENCE_LENGTH = 200

/** The timed window, in seconds (§3 row 10, M1.11). */
export const CODING_DURATION_S = 90

/** Error-rate flag threshold (M1.11): flagged when errors / attempted > 20%. */
export const CODING_MAX_ERROR_RATE = 0.2
/** 1 / {@link CODING_MAX_ERROR_RATE}: the flag is `5 · errors > attempted`, exact in integers. */
export const CODING_ERROR_FLAG_DENOM = 5

/** One legend cell as shown to the taker: the glyph above its digit. */
export interface LegendEntry {
  readonly digit: number
  readonly symbol: CodingSymbol
}

/** Render payload. `legend` is in digit order 1–9; `sequence` holds glyph ids only. */
export interface CodingSpec {
  readonly legend: readonly LegendEntry[]
  readonly sequence: readonly CodingSymbol[]
  readonly duration_s: number
}

/** The scoring key: the same bijection as the legend, as glyph → digit. */
export interface CodingKey {
  readonly table: Readonly<Record<CodingSymbol, number>>
}

/**
 * One key press: the k-th response answers stimulus k (the block advances on every press,
 * right or wrong). `digit` is the key pressed (0–9; 0 is never right), `t_ms` the time since
 * block onset (performance.now based, fractional ms allowed), non-decreasing.
 */
export interface CodingResponse {
  readonly digit: number
  readonly t_ms: number
}

export type CodingResponses = readonly CodingResponse[]

export type CodingItem = ItemInstance<CodingSpec, CodingKey>

/** The spec's top-level fields, sorted (the family leak check allows exactly these). */
export const CODING_SPEC_FIELDS = Object.freeze(['duration_s', 'legend', 'sequence'] as const)

export function isCodingSymbol(v: unknown): v is CodingSymbol {
  return typeof v === 'string' && (CODING_SYMBOLS as readonly string[]).includes(v)
}
