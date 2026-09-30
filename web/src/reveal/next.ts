/**
 * Retest motivation (DESIGN §10 "Retest motivation", §7.6, §7.8; ROADMAP M1.R): what another
 * session would buy, where the picture is fuzziest, which parts a 20-minute focus session could
 * cover, and how long to wait.
 *
 * **Predicted shrinkage (§7.6).** The table assumes about 6 scored items per power skill per
 * session at mean information Ī = 0.35, i.e. 2.1 precision units per session on a prior of variance
 * 1: SE after s sessions = 1/√(1 + 2.1·s) (0.57, 0.44, 0.37, 0.33, … for s = 1, 2, 3, 4). The next
 * session therefore tightens the ranges by 1 − SE(s+1)/SE(s): 23% after one session, which
 * §10 words as "~25%". The figure is rounded to the nearest 5%, never below 5%, and is a typical
 * one for question-based skills; the copy says so. Sessions with no scored data do not count.
 *
 * **Fuzziest skills**: measured skills by descending posterior SD (the width of the blob's fuzz).
 *
 * **Focus sessions**: the A15 parts (segments) offered for a 20-minute session; the parts holding
 * the fuzziest skills are suggested. A focus session runs only the chosen parts: `RunConfig.focus`
 * takes their skills.
 *
 * **Spacing**: ≥ 7 days between sessions (§10: reduces practice effects, matches the literature on
 * intervals; §7.8 models the practice gain by test number, not by the gap).
 */

import type { AxisCode } from '../engine/axes'
import type { SegmentId } from '../engine/selector'
import { SEGMENT_INFO } from '../session/segments'
import type { AxisEstimate } from '../viz/profile'

/** §7.6: precision gained per session by a question-based skill (6 items × Ī 0.35). */
export const PRECISION_PER_SESSION = 2.1

/** §10: the advised gap between sessions, in days. */
export const SPACING_DAYS = 7

/** A focus session's target length (§10), in seconds. */
export const FOCUS_TARGET_S = 20 * 60

/** §7.6 SE after `sessions` sessions on a prior of variance 1. */
export function projectedSe(sessions: number): number {
  if (!(Number.isFinite(sessions) && sessions >= 0)) throw new RangeError('sessions must be a finite number ≥ 0')
  return 1 / Math.sqrt(1 + PRECISION_PER_SESSION * sessions)
}

/** The fraction by which one more session shrinks the SE, from `sessions` sessions so far (§7.6). */
export function predictedShrinkage(sessions: number): number {
  return 1 - projectedSe(sessions + 1) / projectedSe(sessions)
}

/** {@link predictedShrinkage} in whole percent, to the nearest 5 and at least 5. */
export function shrinkagePercent(sessions: number): number {
  return Math.max(5, Math.round((predictedShrinkage(sessions) * 100) / 5) * 5)
}

/**
 * How many sessions the typical measured skill has had: the lower median, over `measured`, of the
 * sessions that took each skill (`next_ordinals − 1`, §7.8). The shrinkage line is worded for the
 * profile as a whole, so a 20-minute focus session on one part must not count as another session
 * for the skills it did not cover. At least 1 (the session just finished measured something), 0
 * for no measured skill.
 */
export function typicalSessions(nextOrdinals: Readonly<Record<AxisCode, number>>, measured: readonly AxisCode[]): number {
  if (measured.length === 0) return 0
  const taken = measured.map((k) => Math.max(1, nextOrdinals[k] - 1)).sort((a, b) => a - b)
  return taken[Math.floor((taken.length - 1) / 2)]!
}

export interface Fuzzy {
  readonly code: AxisCode
  readonly name: string
  readonly sd: number
  readonly lo90: number
  readonly hi90: number
}

/** The `n` measured skills with the widest ranges (largest SD first; ties in spoke order). */
export function fuzziestAxes(estimates: readonly AxisEstimate[], n = 3): Fuzzy[] {
  return estimates
    .filter((e) => e.measured && e.sd !== undefined && e.lo90 !== undefined && e.hi90 !== undefined)
    .map((e) => ({ code: e.code, name: e.name, sd: e.sd!, lo90: e.lo90!, hi90: e.hi90! }))
    .sort((a, b) => b.sd - a.sd)
    .slice(0, n)
}

export interface FocusOption {
  readonly segment: SegmentId
  /** The part's name, as on its interstitial ("Spatial"). */
  readonly title: string
  readonly axes: readonly AxisCode[]
  /** Holds one of the fuzziest skills. */
  readonly suggested: boolean
}

/** The six A15 parts as focus options, in session order; the parts of the fuzziest skills are suggested. */
export function focusOptions(estimates: readonly AxisEstimate[], nFuzzy = 3): FocusOption[] {
  const fuzzy = new Set(fuzziestAxes(estimates, nFuzzy).map((f) => f.code))
  return Object.values(SEGMENT_INFO).map((s) => ({
    segment: s.id,
    title: s.title,
    axes: s.axes,
    suggested: s.axes.some((k) => fuzzy.has(k)),
  }))
}

/** Changes when the options do (which parts, which suggested): the picker is keyed on it, so new options start it afresh. */
export const focusOptionsKey = (options: readonly FocusOption[]): string => options.map((o) => `${o.segment}:${o.suggested}`).join()

/** The skills of the chosen parts, canonical order, no repeats. */
export function focusAxes(options: readonly FocusOption[], chosen: ReadonlySet<SegmentId>): AxisCode[] {
  return [...new Set(options.filter((o) => chosen.has(o.segment)).flatMap((o) => o.axes))]
}
