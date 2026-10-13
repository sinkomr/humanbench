/**
 * What each A15 segment is called and says about itself (ROADMAP A15, M1.15; DESIGN §10 "1-screen
 * interstitial"). A segment's title is the on-screen name of the skill it measures (`axis-names.ts`,
 * Title Case: provisional default, UX-REVIEW D25), so the interstitial, the part's heading, the
 * checklist, the skip button, the notices and the profile all say the same name. Wording is plain
 * and non-diagnostic (A13).
 */

import { axisName } from '../axis-names'
import { axis as axisDef, type AxisCode, type Cluster } from '../engine/axes'
import { A15_SEGMENTS, SEGMENT_ORDER, type A15SegmentId, type SegmentId } from '../engine/plan-table'
import { INTERSTITIAL_SKIP } from './copy'

/**
 * For the parts that only work by sight (provisional default, UX-REVIEW D20, option A; WCAG 1.1.1, DESIGN
 * §13 "skip any axis"): Reaction Time is a visual target, and Spatial's options share one text
 * alternative. It names the interstitial's own Skip button. An "assistive" RT input type (option B)
 * is left for the norming work: it would need its own norms (§13 "the mode is stored and normed
 * separately"), which do not exist yet.
 */
export const needsSight = (what: string): string =>
  `This part needs you to see the screen. If you use a screen reader or cannot see ${what}, choose “${INTERSTITIAL_SKIP}”: it will show as not measured.`

/** On the knowledge parts: the honour code's rule, said where it matters (no looking things up; owner decision 2026-10-05, UX-REVIEW D10). */
const NO_LOOKUP = 'Please answer from what you know, without looking anything up.'

export interface SegmentInfo {
  readonly id: SegmentId
  /** The axis (block segments) or axes (CAT segments) the segment measures. */
  readonly axes: readonly AxisCode[]
  /** Name shown on the interstitial and as the part's heading, e.g. "Reaction Time": the name of its first axis. */
  readonly title: string
  readonly cluster: Cluster
  /** A few short sentences of what to expect (and, for the parts that need sight, how to skip them). */
  readonly blurb: string
}

function info(id: SegmentId, axes: readonly AxisCode[], blurb: string): SegmentInfo {
  return Object.freeze({ id, axes: Object.freeze([...axes]), title: axisName(axes[0]!), cluster: axisDef(axes[0]!).cluster, blurb })
}

/**
 * Every part a session can have, by id: the six A15 parts and the served text parts of M3.11
 * (`engine/plan-table.ts`). Use {@link A15_SEGMENT_INFO} for "the six parts", {@link SEGMENT_INFO_IN_ORDER}
 * for all of them in session order.
 */
export const SEGMENT_INFO: Readonly<Record<SegmentId, SegmentInfo>> = Object.freeze({
  rt: info('rt', ['RT'], `A target appears on the screen. Respond as fast as you can once you see it. A few practice trials come first. ${needsSight('the target')}`),
  matrix_series: info('matrix_series', ['MAT'], 'Find the pattern. Pick the cell that completes a grid, or type the next term of a sequence.'),
  spatial: info('spatial', ['SPA'], `Turn objects in your mind. Decide which option is the same object as the target, rotated. ${needsSight('the figures')}`),
  memory: info('memory', ['WM'], 'Repeat short sequences of digits forwards and backwards, then the order in which blocks light up.'),
  // Paper and pencil are allowed, calculators and AI chatbots are not (owner decision 2026-10-05, UX-REVIEW D10), as the honour screen says.
  quant: info('quant', ['QR'], 'Solve short number problems and type your answer. Scratch paper and a pencil are fine; please do not use a calculator or an AI chatbot.'),
  coding_reading: info('coding_reading', ['PS'], 'Match shapes to digits against the clock, then read a short passage and answer a few questions about it.'),
  // The served text parts (M3.11 phase 1): what the person does, never what an answer says about them (A13, R-5.6.x).
  logical_reasoning: info('logical_reasoning', ['LR'], 'Read a short argument and pick the answer that best fits the question about it. Take the time you need to read.'),
  // Served passages (M3.11 phase 2): the passage stays on screen while its questions are answered (owner decision 2026-10-12).
  reading_comprehension: info('reading_comprehension', ['RC'], 'Read a passage and answer a few questions about it, then a second passage. The passage stays on screen while you answer, so you can look back at it. Take the time you need to read.'),
  vocabulary: info('vocabulary', ['VOC'], 'Questions about what words mean and how they relate. Pick the answer that fits best.'),
  knowledge_stem: info('knowledge_stem', ['KST'], `Questions about science, mathematics and technology. Pick the answer you think is right. ${NO_LOOKUP}`),
  knowledge_humanities: info('knowledge_humanities', ['KHU'], `Questions about history, geography, literature and ideas. Pick the answer you think is right. ${NO_LOOKUP}`),
  knowledge_arts: info('knowledge_arts', ['KAP'], `Questions about the arts and about everyday practical matters. Pick the answer you think is right. ${NO_LOOKUP}`),
})

/** The six A15 parts, in order. */
export const A15_SEGMENT_INFO: readonly SegmentInfo[] = Object.freeze(A15_SEGMENTS.map((s) => SEGMENT_INFO[s.id as A15SegmentId]))

/** Every part in session order (the text parts after the A15 parts they follow). */
export const SEGMENT_INFO_IN_ORDER: readonly SegmentInfo[] = Object.freeze(SEGMENT_ORDER.map((id) => SEGMENT_INFO[id]))

/** The skill's on-screen name (`axis-names.ts`) for messages such as "Skip Spatial?". */
export function skipTargetName(axis: AxisCode): string {
  return axisName(axis)
}
