/**
 * What each A15 segment is called and says about itself (ROADMAP A15, M1.15; DESIGN §10 "1-screen
 * interstitial"). A segment's title is the on-screen name of the skill it measures (`axis-names.ts`,
 * Title Case: provisional default, UX-REVIEW D25), so the interstitial, the part's heading, the
 * checklist, the skip button, the notices and the profile all say the same name. Wording is plain
 * and non-diagnostic (A13).
 */

import { axisName } from '../axis-names'
import { axis as axisDef, type AxisCode, type Cluster } from '../engine/axes'
import type { SegmentId } from '../engine/selector'
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

/** The six A15 segments, in order. */
export const SEGMENT_INFO: Readonly<Record<SegmentId, SegmentInfo>> = Object.freeze({
  rt: info('rt', ['RT'], `A target appears on the screen. Respond as fast as you can once you see it. A few practice trials come first. ${needsSight('the target')}`),
  matrix_series: info('matrix_series', ['MAT'], 'Find the pattern. Pick the cell that completes a grid, or type the next term of a sequence.'),
  spatial: info('spatial', ['SPA'], `Turn objects in your mind. Decide which option is the same object as the target, rotated. ${needsSight('the figures')}`),
  memory: info('memory', ['WM'], 'Repeat short sequences of digits forwards and backwards, then the order in which blocks light up.'),
  // Paper and pencil are allowed, calculators and AI chatbots are not (owner decision 2026-10-05, UX-REVIEW D10), as the honour screen says.
  quant: info('quant', ['QR'], 'Solve short number problems and type your answer. Scratch paper and a pencil are fine; please do not use a calculator or an AI chatbot.'),
  coding_reading: info('coding_reading', ['PS'], 'Match shapes to digits against the clock, then read a short passage and answer a few questions about it.'),
})

/** The skill's on-screen name (`axis-names.ts`) for messages such as "Skip Spatial?". */
export function skipTargetName(axis: AxisCode): string {
  return axisName(axis)
}
