/**
 * The session's parts, as plain tables (ROADMAP A15, M3.11 phase 1; DESIGN §3, §7.4 "Session
 * composition"). Constants and types only, with no import of the task registry, so the copy
 * (`session/copy.ts`), the build (`vite.config.ts`) and the selector can all read the same figures.
 *
 * Two tables:
 *
 * - {@link A15_SEGMENTS}: the six parts of the M1 session, on every device and in both versions.
 *   Their time is {@link A15_TARGET_S}, shared as before (`planSession`). **Nothing below changes
 *   them**: a session without served text parts is planned, budgeted and timed exactly as in M1.
 * - {@link TEXT_PARTS}: the parts of served text multiple choice (M3.11 phase 1). They exist only in
 *   the online version, only for the axes the build names (`backend/config.ts`, `HB_TEXT_AXES`), and
 *   only when the server has questions for the axis: a part whose first request is answered "no
 *   items" is dropped without a word (`session/run.ts`). Each has a planned share of its own, **on
 *   top of** the six parts' time.
 *
 * ## The shares (owner: change them here)
 *
 * `share_s` is the planned time of a text part in seconds; it is what its "Up next" screen says
 * ("About 2 minutes"), what the progress ring's target grows by, and when the part stops asking
 * once its minimum is met. The figures are provisional defaults (open owner decision, ROADMAP M3.11):
 *
 * | Part | Axis | Share | Why |
 * |---|---|---|---|
 * | Logical Reasoning | LR | 5 min | an argument to read per question (the bank's expected time is 60 s) |
 * | Vocabulary | VOC | 2 min | a word per question (15 s) |
 * | STEM knowledge | KST | 2 min 10 s | a fact per question (20 s) |
 * | Humanities knowledge | KHU | 2 min 10 s | the same |
 * | Arts & Practical | KAP | 2 min 10 s | the same |
 *
 * All five together are 13.5 minutes, so a session with all of them is planned at 41 minutes (27.5 +
 * 13.5), which the copy rounds to "about 40 minutes" ({@link aboutMinutes}).
 *
 * ## Why five answers ({@link PUBLISH_MIN_ITEMS})
 *
 * The server publishes a skill's score only from a session that holds at least five scored answers
 * on it (`rescore.min_axis_items`, supabase/README.md "What `rescore` does not tell": fewer would
 * read single answers out). A text part that stopped at the §7.4 floor of three would therefore
 * measure nothing the person ever sees. So a text part goes on past its share until five questions
 * are answered ({@link TextPart.min_items}), and at most {@link MIN_ITEMS_SLACK} more are shown to
 * get there when some ran out of time. The six M1 parts keep their own rule (the floor of three).
 */

import type { AxisCode } from './axes'

/** Default M1 session length for `planSession`: A15's target of about 25–30 min, taken at the midpoint. */
export const A15_TARGET_S = 27.5 * 60

/** The six parts of the M1 session (A15). */
export type A15SegmentId = 'rt' | 'matrix_series' | 'spatial' | 'memory' | 'quant' | 'coding_reading'

/** The parts of served text multiple choice (M3.11 phase 1). */
export type TextSegmentId = 'logical_reasoning' | 'vocabulary' | 'knowledge_stem' | 'knowledge_humanities' | 'knowledge_arts'

/** Every part a session can have. */
export type SegmentId = A15SegmentId | TextSegmentId

/** One fixed block of a segment: a block family (one per sub-task, M1.F2). */
export interface BlockDef {
  readonly family: string
}

/** One A15 segment: fixed blocks, or a CAT segment on some axes. */
export type SegmentDef =
  | { readonly id: A15SegmentId; readonly kind: 'block'; readonly axis: AxisCode; readonly blocks: readonly BlockDef[] }
  | { readonly id: A15SegmentId; readonly kind: 'cat'; readonly axes: readonly AxisCode[] }

/**
 * The M1 session order (A15): RT → Matrix/Series → Spatial → Memory → Quant → Coding/Reading.
 * RT runs simple then 4-choice (M1.10); Memory runs digits forward, digits backward, Corsi (M1.9).
 * Each sub-task is its own block family (M1.F2).
 */
export const A15_SEGMENTS: readonly SegmentDef[] = Object.freeze([
  { id: 'rt', kind: 'block', axis: 'RT', blocks: [{ family: 'rt_simple' }, { family: 'rt_choice4' }] },
  { id: 'matrix_series', kind: 'cat', axes: ['MAT'] },
  { id: 'spatial', kind: 'cat', axes: ['SPA'] },
  { id: 'memory', kind: 'block', axis: 'WM', blocks: [{ family: 'span_fwd' }, { family: 'span_bwd' }, { family: 'corsi' }] },
  { id: 'quant', kind: 'cat', axes: ['QR'] },
  { id: 'coding_reading', kind: 'block', axis: 'PS', blocks: [{ family: 'coding' }, { family: 'reading' }] },
] as const satisfies readonly SegmentDef[])

/** Answers on one skill in one session from which the server publishes its score (`rescore.min_axis_items`). */
export const PUBLISH_MIN_ITEMS = 5

/** Questions a text part may show beyond its minimum to reach it (some may run out of time). */
export const MIN_ITEMS_SLACK = 2

/** The axes of served text multiple choice, in the canonical axis order. */
export const TEXT_AXES = ['LR', 'VOC', 'KST', 'KHU', 'KAP'] as const satisfies readonly AxisCode[]
export type TextAxis = (typeof TEXT_AXES)[number]

export function isTextAxis(code: unknown): code is TextAxis {
  return typeof code === 'string' && (TEXT_AXES as readonly string[]).includes(code)
}

export interface TextPart {
  readonly id: TextSegmentId
  readonly axis: TextAxis
  /** The A15 part it comes after (the §7.4 order: Reasoning → Knowledge → Spatial → Verbal → Memory → Quant → Knowledge). */
  readonly after: A15SegmentId
  /** Planned seconds, on top of the six parts' time (module comment: "The shares"). */
  readonly share_s: number
  /** Answered questions before the part's time may end it (module comment: "Why five answers"). */
  readonly min_items: number
}

/**
 * THE table of the text parts: which, where in the session, and how long. In session order (two parts
 * after the same A15 part run in the order listed here).
 */
export const TEXT_PARTS: readonly TextPart[] = Object.freeze([
  { id: 'logical_reasoning', axis: 'LR', after: 'matrix_series', share_s: 300, min_items: PUBLISH_MIN_ITEMS },
  { id: 'knowledge_stem', axis: 'KST', after: 'matrix_series', share_s: 130, min_items: PUBLISH_MIN_ITEMS },
  { id: 'vocabulary', axis: 'VOC', after: 'spatial', share_s: 120, min_items: PUBLISH_MIN_ITEMS },
  { id: 'knowledge_humanities', axis: 'KHU', after: 'quant', share_s: 130, min_items: PUBLISH_MIN_ITEMS },
  { id: 'knowledge_arts', axis: 'KAP', after: 'quant', share_s: 130, min_items: PUBLISH_MIN_ITEMS },
] as const satisfies readonly TextPart[])

/** The text part of an axis, or undefined. */
export function textPartOf(axis: AxisCode): TextPart | undefined {
  return TEXT_PARTS.find((p) => p.axis === axis)
}

/** The text part with this id, or undefined (an A15 part). */
export function textPartById(id: SegmentId): TextPart | undefined {
  return TEXT_PARTS.find((p) => p.id === id)
}

/** Every part id in session order: the A15 parts with the text parts after the ones they follow. */
export const SEGMENT_ORDER: readonly SegmentId[] = Object.freeze(A15_SEGMENTS.flatMap((s): SegmentId[] => [s.id, ...TEXT_PARTS.filter((p) => p.after === s.id).map((p) => p.id)]))

/** What a session is planned to be, for the words that say so before it starts. */
export interface SessionOutline {
  /** Parts at most: the six of A15 plus the text parts asked for. */
  readonly parts: number
  /** Planned seconds with every part present. */
  readonly planned_s: number
  /** Some parts depend on what the server has, so the count is "up to". */
  readonly upTo: boolean
}

/** The plan of a session that asks for the text parts of `textAxes` (none: the M1 session). */
export function sessionOutline(textAxes: readonly AxisCode[] = []): SessionOutline {
  const parts = TEXT_PARTS.filter((p) => textAxes.includes(p.axis))
  return { parts: A15_SEGMENTS.length + parts.length, planned_s: A15_TARGET_S + parts.reduce((t, p) => t + p.share_s, 0), upTo: parts.length > 0 }
}

/**
 * The figure a planned length is said as: whole minutes, to the nearest five from three minutes up
 * ("about 30" for 27.5, "about 40" for 41), the rule of the progress ring (UX-008).
 */
export function aboutMinutes(plannedS: number): number {
  const m = Math.max(1, Math.round(plannedS / 60))
  return m < 3 ? m : Math.round(m / 5) * 5
}
