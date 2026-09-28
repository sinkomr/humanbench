/**
 * The blob's render model (DESIGN §9; ROADMAP A7, A12, A15, M1.16): every coordinate and SVG path
 * the chart draws, computed without the DOM so it can be tested and benchmarked in Node.
 * `BlobChart.svelte` only maps this model to SVG elements.
 *
 * - Radius linear in θ over [−3, 3] (§9.1, `geometry.ts`); rings at −2 … +2 SD, "provisional"
 *   (A12); the θ = 0 ring dashed.
 * - Crisp posterior curve + the ±1 SD band + 20 seeded posterior draws as fuzz (§9.3), each a
 *   closed curve chosen by the overshoot rule (§9.2, `curve.ts`).
 * - Not-measured spokes (§9.7, A15): a dashed spoke, a grey stub at the centre and a gap marker;
 *   every curve dips to the inner clamp there (never interpolated through).
 * - Measured spokes: a marker at θ and a 90% whisker; muted when the interval overlaps 0 (§9.5).
 * - Tier (c) spokes: the blob's wedge around the spoke gets a hatch (§9.7); glyphs on labels.
 * - One clickable wedge per contiguous group (cluster) for the drill-down (§9.6, A7).
 * Nothing here sums, averages or measures the shape (§9.5 a).
 */

import { chooseCurve, fmt, type CurveKind } from './curve'
import { polar, R_MIN_FRACTION, radiusScale, ringLabel, ringSpacing, RING_THETAS, spokeAngle, type Point } from './geometry'
import { stubLabel, type SpokeEstimate } from './profile'

/** Default outer radius (θ = +3) in SVG user units. */
export const DEFAULT_R = 180
/** Horizontal and vertical room for labels around the circle. */
const MARGIN_X = 128
const MARGIN_Y = 64
/** The grey stub at the centre of a not-measured spoke, as a fraction of R (§9.7). */
const STUB_FRACTION = 0.14

export interface RingView {
  readonly theta: number
  readonly r: number
  readonly label: string
  /** θ = 0: dashed reference ring (§9.1). */
  readonly reference: boolean
  readonly labelAt: Point
}

export interface SpokeView {
  readonly id: string
  readonly name: string
  readonly lines: readonly string[]
  readonly glyph: string
  readonly tier: SpokeEstimate['tier']
  readonly group: string
  readonly measured: boolean
  readonly muted: boolean
  readonly angle: number
  /** Spoke line end (θ = +3). */
  readonly outer: Point
  readonly label: { readonly at: Point; readonly anchor: 'start' | 'middle' | 'end'; readonly dy0: number }
  /** Measured: marker at θ and 90% whisker ends. */
  readonly marker?: Point
  readonly whisker?: readonly [Point, Point]
  /** Not measured: the grey stub from the centre and the gap marker where the curve dips. */
  readonly stub?: Point
  readonly gap?: Point
}

export interface CurveView {
  readonly d: string
  readonly kind: CurveKind
  readonly overshootRings: number
}

export interface WedgeView {
  readonly group: string
  readonly d: string
  readonly spokeIds: readonly string[]
}

export interface BlobModel {
  readonly R: number
  readonly viewBox: string
  readonly ring: number
  readonly rings: readonly RingView[]
  readonly spokes: readonly SpokeView[]
  /** The crisp posterior curve (§9.3). */
  readonly crisp: CurveView
  /** ±1 SD band: outer then inner closed curve, drawn with fill-rule evenodd. */
  readonly band: { readonly d: string; readonly outer: CurveView; readonly inner: CurveView }
  readonly fuzz: readonly CurveView[]
  /** Wedge clip paths for tier (c) measured spokes (§9.7 hatch). */
  readonly hatch: readonly { readonly id: string; readonly d: string }[]
  readonly wedges: readonly WedgeView[]
  /** Where the in-chart ring note (copy.ts RING_NOTE) starts: the bottom-left corner. */
  readonly noteAt: Point
}

export interface BlobOptions {
  readonly R?: number
}

/** A sector from angle a0 to a1 (clockwise), radius r, as SVG path data. */
export function sectorPath(a0: number, a1: number, r: number): string {
  const f = (p: Point): string => `${fmt(p[0])},${fmt(p[1])}`
  const span = a1 - a0
  if (span >= 2 * Math.PI - 1e-9) {
    // A full circle: two half arcs.
    const top = polar(r, 0)
    const bottom = polar(r, Math.PI)
    return `M${f(top)}A${r},${r} 0 1,1 ${f(bottom)}A${r},${r} 0 1,1 ${f(top)}Z`
  }
  return `M0,0L${f(polar(r, a0))}A${r},${r} 0 ${span > Math.PI ? 1 : 0},1 ${f(polar(r, a1))}Z`
}

function curveView(points: readonly Point[], ring: number): CurveView {
  const c = chooseCurve(points, ring)
  return { d: c.d, kind: c.kind, overshootRings: c.overshootRings }
}

function labelFor(angle: number, R: number, nLines: number): SpokeView['label'] {
  const at = polar(R + 12, angle)
  const s = Math.sin(angle)
  const c = Math.cos(angle)
  const anchor = Math.abs(s) < 0.2 ? 'middle' : s > 0 ? 'start' : 'end'
  // Line height 1.15em: centre the block vertically at the side, above at the top, below at the bottom.
  const block = (nLines - 1) * 1.15
  const dy0 = c > 0.5 ? -block : c < -0.5 ? 0.8 : 0.35 - block / 2
  return { at, anchor, dy0 }
}

/**
 * The render model of a blob with the given spokes (in order around the circle) and fuzz draws
 * (`samples[s][i]` = θ of spoke i in draw s; ignored for unmeasured spokes). Needs ≥ 3 spokes.
 */
export function buildBlob(spokes: readonly SpokeEstimate[], samples: readonly (readonly number[])[], opts: BlobOptions = {}): BlobModel {
  const R = opts.R ?? DEFAULT_R
  const k = spokes.length
  if (k < 3) throw new RangeError('a blob needs at least 3 spokes')
  for (const s of samples) if (s.length !== k) throw new RangeError('each fuzz draw needs one θ per spoke')
  const r = radiusScale(R)
  const rMin = R_MIN_FRACTION * R
  const ring = ringSpacing(R)
  const angles = spokes.map((_, i) => spokeAngle(i, k))
  const half = Math.PI / k

  const radiiOf = (thetaOf: (s: SpokeEstimate, i: number) => number): Point[] =>
    spokes.map((s, i) => polar(s.measured ? r(thetaOf(s, i)) : rMin, angles[i]!))

  const crisp = curveView(
    radiiOf((s) => s.theta!),
    ring,
  )
  const outer = curveView(
    radiiOf((s) => s.theta! + s.sd!),
    ring,
  )
  const inner = curveView(
    radiiOf((s) => s.theta! - s.sd!),
    ring,
  )
  const fuzz = samples.map((draw) =>
    curveView(
      radiiOf((_, i) => draw[i]!),
      ring,
    ),
  )

  const views: SpokeView[] = spokes.map((s, i) => {
    const a = angles[i]!
    const lines = s.measured ? [...s.shortLabel] : [...s.shortLabel, stubLabel(s.reason)]
    const base = {
      id: s.id,
      name: s.name,
      lines,
      glyph: s.glyph,
      tier: s.tier,
      group: s.group,
      measured: s.measured,
      muted: s.muted,
      angle: a,
      outer: polar(R, a),
      label: labelFor(a, R, lines.length),
    }
    if (!s.measured) return { ...base, stub: polar(STUB_FRACTION * R, a), gap: polar(rMin, a) }
    return {
      ...base,
      marker: polar(r(s.theta!), a),
      whisker: [polar(r(s.lo90!), a), polar(r(s.hi90!), a)] as const,
    }
  })

  const hatch = spokes.flatMap((s, i) => (s.measured && s.tier === 'c' ? [{ id: s.id, d: sectorPath(angles[i]! - half, angles[i]! + half, R + 4) }] : []))

  // One wedge per contiguous run of a group around the cycle.
  const wedges: WedgeView[] = []
  const startAt = spokes.findIndex((s, i) => s.group !== spokes[(i - 1 + k) % k]!.group)
  if (startAt < 0) {
    wedges.push({ group: spokes[0]!.group, d: sectorPath(0, 2 * Math.PI, R + 4), spokeIds: spokes.map((s) => s.id) })
  } else {
    let i = startAt
    for (let n = 0; n < k; ) {
      const g = spokes[i % k]!.group
      const ids: string[] = []
      const first = i
      while (n < k && spokes[i % k]!.group === g) {
        ids.push(spokes[i % k]!.id)
        i++
        n++
      }
      wedges.push({ group: g, d: sectorPath(spokeAngle(first, k) - half, spokeAngle(i - 1, k) + half, R + 4), spokeIds: ids })
    }
  }

  // Ring labels sit on the bisector between the first two spokes.
  const labelAngle = half
  const rings: RingView[] = RING_THETAS.map((t) => ({
    theta: t,
    r: r(t),
    label: ringLabel(t),
    reference: t === 0,
    labelAt: polar(r(t) + 3, labelAngle),
  }))

  const viewBox = `${-(R + MARGIN_X)} ${-(R + MARGIN_Y)} ${2 * (R + MARGIN_X)} ${2 * (R + MARGIN_Y)}`
  return {
    R,
    viewBox,
    ring,
    rings,
    spokes: views,
    crisp,
    band: { d: `${outer.d}${inner.d}`, outer, inner },
    fuzz,
    hatch,
    wedges,
    noteAt: [-(R + MARGIN_X) + 2, R + MARGIN_Y - 22],
  }
}
