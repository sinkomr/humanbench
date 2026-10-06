/**
 * From scorer output to what the blob and the bar view show (DESIGN §9, §7.3; ROADMAP A12, A15,
 * M1.16).
 *
 * Input: the engine's `scoreAll` result (correlated MAP θ + Laplace covariance, and the per-axis
 * EAP of every axis with at least one observation) and the axis registry. Per axis, in spoke
 * order (§9.4, {@link spokeOrder}):
 * - measured = the axis has observations (it has an EAP entry) and was not skipped (§13). Every
 *   other axis is a "not measured" stub (§9.7, A15: all 17 spokes are always shown); the
 *   correlated model's borrowed estimate for it is never shown or interpolated;
 * - estimate θ_k and SD_k = √cov_kk from the correlated posterior, from which `blob.ts` draws the
 *   crisp curve, the ±1 SD band and the §9.3 fuzz (curves at θ_k + z·SD_k), so all three agree;
 * - the 90% interval θ_k ± 1.645·SD_k and the muting rule (§9.5, A12 θ = 0 rule): a spoke whose
 *   interval contains 0 is muted ("overlaps 0 SD"); only an interval that excludes 0 is shown as
 *   credibly above or below 0 SD.
 *
 * No function here returns or combines anything across axes (no total, mean or area: §9.5 a).
 */

import { AXES, isAxisCode, N_AXES, type AxisCode, type AxisDef, type Cluster, type GoldTier } from '../engine/axes'
import type { ScoreResult } from '../engine/scorer'
import { offScaleOf, Z90, type OffScale } from './geometry'
import { spokeOrder } from './seriation'

/**
 * Why a spoke is a stub (§9.7, §13, A15): an axis the user skipped, one not offered yet (v2), one
 * with no items; or a drill-down facet under the ≥ 5-item threshold (§9.6, A12).
 */
export type NotMeasuredReason = 'skipped' | 'not_yet_available' | 'no_data' | 'insufficient_data'

/** The stub's short label: "insufficient data" for a facet (§9.6), else "not measured" (A15). */
export function stubLabel(reason: NotMeasuredReason | undefined): string {
  return reason === 'insufficient_data' ? 'insufficient data' : 'not measured'
}

/** Where a credible interval sits relative to θ = 0 (§9.5, A12). */
export type Relation = 'above' | 'below' | 'overlaps'

/** One spoke of a blob or one row of the bar view: an axis, or a facet in the drill-down. */
export interface SpokeEstimate {
  /** Axis code, or `<axis>:<facet>` for a facet. */
  readonly id: string
  /** Full user-facing name (the table's row header). */
  readonly name: string
  /** One or two short lines for the chart label. */
  readonly shortLabel: readonly string[]
  /** One short line for the chart label on narrow screens (`blob.ts` fitLayout); axes have one. */
  readonly compactLabel?: string
  /** Contiguous group of the spoke: the A7 cluster of an axis, the axis name of a facet. */
  readonly group: string
  readonly tier: GoldTier
  /** Tier glyph (§9.7): b "○", c "◇", a none. */
  readonly glyph: string
  readonly measured: boolean
  readonly reason?: NotMeasuredReason
  /** Posterior estimate (SD units, provisional scale). */
  readonly theta?: number
  readonly sd?: number
  readonly lo90?: number
  readonly hi90?: number
  readonly relation?: Relation
  /** Measured and the 90% interval overlaps 0 (§9.5). */
  readonly muted: boolean
  /**
   * Whether the estimate lies beyond the drawn −3 … +3 SD scale (UX-037): the chart marks it with an
   * arrowhead at the clamp. Absent on a spoke that is not measured, or built without it (then the
   * chart works it out from `theta`).
   */
  readonly offScale?: OffScale
}

export interface AxisEstimate extends SpokeEstimate {
  readonly code: AxisCode
  readonly cluster: Cluster
}

/** Short chart labels (the full names stay in the table; A7: EMO keeps its R-5.6.2 name). */
export const SHORT_LABELS: Readonly<Record<AxisCode, readonly string[]>> = Object.freeze({
  MAT: ['Matrix &', 'Series'],
  LR: ['Logical', 'Reasoning'],
  LG: ['Logic', 'Games'],
  RC: ['Reading', 'Comprehension'],
  VOC: ['Vocabulary'],
  QR: ['Quantitative', 'Reasoning'],
  SPA: ['Spatial'],
  WM: ['Working', 'Memory'],
  RT: ['Reaction', 'Time'],
  PS: ['Processing &', 'Reading Speed'],
  FER: ['Fermi', 'Estimation'],
  CAL: ['Calibration'],
  KST: ['STEM', 'Knowledge'],
  KHU: ['Humanities', 'Knowledge'],
  KAP: ['Arts & Practical', 'Knowledge'],
  EMO: ['Emotion Reading', '(text scenarios)'],
  CRE: ['Creative', 'Thinking'],
})

/**
 * One-line chart labels for narrow screens, where 17 full labels cannot all fit around the circle
 * at a legible size (M1.16 review). Plain words; the table and the full labels keep the names.
 * Each is a cut of its table name, so a spoke can be matched to its row (UX-042): the first word(s)
 * of the name, or a documented abbreviation ("comp.", "mem."); no label is also a cluster name that
 * could sit next to it ("Estimation", "Speed").
 */
export const COMPACT_LABELS: Readonly<Record<AxisCode, string>> = Object.freeze({
  MAT: 'Matrix & Series',
  LR: 'Logical',
  LG: 'Logic games',
  RC: 'Reading comp.',
  VOC: 'Vocabulary',
  QR: 'Quantitative',
  SPA: 'Spatial',
  WM: 'Working mem.',
  RT: 'Reaction',
  PS: 'Processing',
  FER: 'Fermi',
  CAL: 'Calibration',
  KST: 'STEM',
  KHU: 'Humanities',
  KAP: 'Arts & practical',
  EMO: 'Emotion',
  CRE: 'Creative',
})

/** The 90% interval and relation of an estimate (§9.5, A12). */
export function interval90(theta: number, sd: number): { lo90: number; hi90: number; relation: Relation } {
  if (!Number.isFinite(theta) || !(sd >= 0) || !Number.isFinite(sd)) throw new RangeError('need a finite theta and sd ≥ 0')
  const lo90 = theta - Z90 * sd
  const hi90 = theta + Z90 * sd
  return { lo90, hi90, relation: lo90 > 0 ? 'above' : hi90 < 0 ? 'below' : 'overlaps' }
}

/** A measured spoke's estimate fields. */
export function measuredFields(theta: number, sd: number): Pick<SpokeEstimate, 'measured' | 'theta' | 'sd' | 'lo90' | 'hi90' | 'relation' | 'muted' | 'offScale'> {
  const iv = interval90(theta, sd)
  return { measured: true, theta, sd, ...iv, muted: iv.relation === 'overlaps', offScale: offScaleOf(theta) }
}

/** The scorer output the viz reads (ScoreResult without the informational fields). */
export type ProfileScore = Pick<ScoreResult, 'theta' | 'cov' | 'eap'>

export interface ProfileInput {
  readonly score: ProfileScore
  /** Axes the user skipped (§13): always "not measured", even with some data. */
  readonly skipped?: readonly AxisCode[]
  /** Σ version that fixes the spoke order (§9.4); default the pinned one. */
  readonly sigmaVersion?: string
  /**
   * The axes this build puts in front of the person (UX-048a). An axis that is not observed, not
   * skipped and not in this set is "not measured (not offered yet)" rather than plain "not measured".
   * Without it the reason follows the registry only (an axis with status 'v2' is not offered yet).
   */
  readonly offered?: ReadonlySet<AxisCode>
}

function checkScore(score: ProfileScore): void {
  const { theta, cov } = score
  if (!Array.isArray(theta) || theta.length !== N_AXES || !theta.every(Number.isFinite)) throw new RangeError(`score.theta must have ${N_AXES} finite entries`)
  if (!Array.isArray(cov) || cov.length !== N_AXES || cov.some((r) => !Array.isArray(r) || r.length !== N_AXES || !r.every(Number.isFinite))) {
    throw new RangeError(`score.cov must be ${N_AXES}×${N_AXES} and finite`)
  }
  for (let i = 0; i < N_AXES; i++) if (!(cov[i]![i]! > 0)) throw new RangeError('score.cov must have a positive diagonal')
  for (const k of Object.keys(score.eap ?? {})) if (!isAxisCode(k)) throw new RangeError(`unknown axis ${k} in score.eap`)
}

/** Per-axis display estimates in spoke order (module comment). */
export function axisEstimates(input: ProfileInput): AxisEstimate[] {
  checkScore(input.score)
  const skipped = new Set(input.skipped ?? [])
  const byCode = new Map<AxisCode, AxisDef>(AXES.map((a) => [a.code, a]))
  return spokeOrder(input.sigmaVersion).map((code): AxisEstimate => {
    const a = byCode.get(code)!
    const base = {
      id: code,
      code,
      name: a.name,
      shortLabel: SHORT_LABELS[code],
      compactLabel: COMPACT_LABELS[code],
      group: a.cluster,
      cluster: a.cluster,
      tier: a.tier,
      glyph: a.glyph,
    }
    const observed = Object.hasOwn(input.score.eap, code)
    if (skipped.has(code) || !observed) {
      // Skipped wins; then an axis the build does not offer (registry 'v2', or outside `offered`); else it just has no data.
      const unavailable = a.status === 'v2' || (input.offered !== undefined && !input.offered.has(code))
      const reason: NotMeasuredReason = skipped.has(code) ? 'skipped' : unavailable ? 'not_yet_available' : 'no_data'
      return { ...base, measured: false, reason, muted: false }
    }
    const theta = input.score.theta[a.index]!
    const sd = Math.sqrt(input.score.cov[a.index]![a.index]!)
    return { ...base, ...measuredFields(theta, sd) }
  })
}
