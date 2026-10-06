/**
 * What each A15 segment is called and says about itself (ROADMAP A15, M1.15; DESIGN §10 "1-screen
 * interstitial"). Titles are the axis names of the blob (`engine/axes.ts`), so the checklist, the
 * interstitials and the profile agree. Wording is plain and non-diagnostic (A13).
 */

import { axis as axisDef, type AxisCode, type Cluster } from '../engine/axes'
import type { SegmentId } from '../engine/selector'

export interface SegmentInfo {
  readonly id: SegmentId
  /** The axis (block segments) or axes (CAT segments) the segment measures. */
  readonly axes: readonly AxisCode[]
  /** Name shown on the interstitial, e.g. "Spatial". */
  readonly title: string
  readonly cluster: Cluster
  /** One or two sentences of what to expect. */
  readonly blurb: string
}

function info(id: SegmentId, axes: readonly AxisCode[], title: string, blurb: string): SegmentInfo {
  return Object.freeze({ id, axes: Object.freeze([...axes]), title, cluster: axisDef(axes[0]!).cluster, blurb })
}

/** The six A15 segments, in order. */
export const SEGMENT_INFO: Readonly<Record<SegmentId, SegmentInfo>> = Object.freeze({
  rt: info('rt', ['RT'], 'Reaction time', 'A target appears on the screen. Respond as fast as you can once you see it. A few practice trials come first.'),
  matrix_series: info('matrix_series', ['MAT'], 'Matrix & Series', 'Find the pattern. Pick the cell that completes a grid, or type the next term of a sequence.'),
  spatial: info('spatial', ['SPA'], 'Spatial', 'Turn objects in your mind. Decide which option is the same object as the target, rotated.'),
  memory: info('memory', ['WM'], 'Working Memory', 'Repeat short sequences of digits forwards and backwards, then the order in which blocks light up.'),
  quant: info('quant', ['QR'], 'Quantitative Reasoning', 'Solve short number problems and type your answer. Keep paper and a calculator out of reach.'),
  coding_reading: info('coding_reading', ['PS'], 'Processing & Reading Speed', 'Match shapes to digits against the clock, then read a short passage and answer a few questions about it.'),
})

/** The segment's name (axis name) for messages such as "Skip Spatial?". */
export function skipTargetName(axis: AxisCode): string {
  return axisDef(axis).name
}
