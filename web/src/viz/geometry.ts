/**
 * Blob geometry (DESIGN §9.1, §7.3; CLAUDE.md blob rule): K spokes at φ_k = 2πk/K, clockwise from
 * 12 o'clock; radius LINEAR in θ over [−3, 3], r = R·(θ + 3)/6 clamped to [0.04R, R]. The centre
 * is θ = −3, not zero ability. Rings sit at θ = −2 … +2 and are one SD apart (R/6), labelled in SD
 * units and marked "provisional" until M4 linking (A12).
 */

import { scaleLinear } from 'd3-scale'

export const THETA_MIN = -3
export const THETA_MAX = 3
/**
 * Inner clamp of the radius as a fraction of R (§9.1). Not-measured spokes no longer dip to it: the
 * curve breaks there instead (UX review D13 A, a provisional default; `blob.ts`).
 */
export const R_MIN_FRACTION = 0.04
/**
 * The lowest θ drawn at its true radius: below it r = R·(θ + 3)/6 would fall under the inner clamp
 * 0.04R, so every smaller estimate is drawn at the clamp (UX-037: with an off-scale mark).
 */
export const THETA_CLAMP_LOW = THETA_MIN + (THETA_MAX - THETA_MIN) * R_MIN_FRACTION
/** Ring positions in θ (§9.1); θ = 0 is the dashed reference ring. */
export const RING_THETAS = [-2, -1, 0, 1, 2] as const
/** z of a central 90% normal interval, Φ⁻¹(0.95): the muting rule (§9.5, A12) and whiskers. */
export const Z90 = 1.6448536269514722

/** A 2-D point in SVG user units (y grows downward). */
export type Point = readonly [number, number]

/** Distance between adjacent rings: one SD of θ (§9.1). */
export function ringSpacing(R: number): number {
  return R / (THETA_MAX - THETA_MIN)
}

/**
 * The θ → radius map: d3 linear scale over [−3, 3] → [0, R], then clamped to [0.04R, R] (§9.1).
 * Linear, never area-proportional (§9.5 d).
 */
export function radiusScale(R: number): (theta: number) => number {
  if (!(R > 0)) throw new RangeError('R must be positive')
  const s = scaleLinear().domain([THETA_MIN, THETA_MAX]).range([0, R])
  const lo = R_MIN_FRACTION * R
  return (theta: number): number => {
    if (!Number.isFinite(theta)) throw new RangeError(`theta must be finite, got ${theta}`)
    return Math.min(R, Math.max(lo, s(theta)))
  }
}

/**
 * Whether an estimate lies beyond the drawn scale: `low` below {@link THETA_CLAMP_LOW} (drawn at the
 * inner clamp), `high` above +3 SD (drawn at the rim), else
 * `none`. The radius map itself is untouched (linear, §9.1); the chart adds an arrowhead there.
 */
export type OffScale = 'none' | 'low' | 'high'
export function offScaleOf(theta: number): OffScale {
  if (!Number.isFinite(theta)) throw new RangeError(`theta must be finite, got ${theta}`)
  return theta < THETA_CLAMP_LOW ? 'low' : theta > THETA_MAX ? 'high' : 'none'
}

/** Angle of spoke `i` of `k`, in radians clockwise from 12 o'clock (§9.1: φ_k = 2πk/K). */
export function spokeAngle(i: number, k: number): number {
  return (2 * Math.PI * i) / k
}

/** Polar (r, φ) → SVG coordinates, φ clockwise from 12 o'clock (as d3.lineRadial). */
export function polar(r: number, angle: number): Point {
  return [r * Math.sin(angle), -r * Math.cos(angle)]
}

/** The ring label in SD units (A12): "−2 SD", "0 SD", "+1 SD" (typographic minus). */
export function ringLabel(theta: number): string {
  if (theta === 0) return '0 SD'
  return `${theta > 0 ? '+' : '−'}${Math.abs(theta)} SD`
}

/** A signed θ for display with the typographic minus, e.g. "+0.42", "−1.30". */
export function formatTheta(theta: number, digits = 2): string {
  const s = Math.abs(theta).toFixed(digits)
  if (Number(s) === 0) return (0).toFixed(digits)
  return `${theta > 0 ? '+' : '−'}${s}`
}
