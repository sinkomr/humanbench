/**
 * Closed blob curves and the overshoot rule (DESIGN §9.2; ROADMAP M1.16).
 *
 * §9.2: a closed Catmull-Rom spline (`d3.curveCatmullRomClosed.alpha(0.5)`) through the spoke
 * points; it must not overshoot by more than 0.1 of a ring between spokes, else fall back to
 * `curveCardinalClosed.tension(0.6)`. If the cardinal curve overshoots too, the last resort is
 * the straight polygon (`curveLinearClosed`), which never overshoots by this measure, so no blob
 * curve ever breaks the rule.
 *
 * Overshoot is measured on exactly what d3 draws: the curve is generated into a recording context
 * ({@link recordCurve}), and every cubic segment between two consecutive spoke points A → B is
 * sampled. Its radial overshoot is how far the curve's distance from the centre leaves the band
 * the straight chord A–B spans, [min(|A|, |B|, dist(centre, chord)), max(|A|, |B|)]: a bulge past
 * the larger endpoint suggests ability between spokes that no spoke measured, and a dip below the
 * chord suggests a gap that is not there. Measured in rings (1 ring = 1 SD = R/6).
 */

import { curveCardinalClosed, curveCatmullRomClosed, curveLinearClosed, line, type CurveFactory } from 'd3-shape'
import type { Point } from './geometry'

/** §9.2: the most a curve may leave a segment's radial band, in rings. */
export const OVERSHOOT_LIMIT_RINGS = 0.1
/** §9.2: centripetal Catmull-Rom. */
export const CATMULL_ROM_ALPHA = 0.5
/** §9.2: the fallback cardinal tension. */
export const CARDINAL_TENSION = 0.6
/** Samples per segment when measuring overshoot (plus a local refinement of the worst one). */
export const OVERSHOOT_SAMPLES = 64

export type CurveKind = 'catmullRom' | 'cardinal' | 'linear'

/** The fallback chain of §9.2, in order. */
export const CURVE_CHAIN: readonly CurveKind[] = ['catmullRom', 'cardinal', 'linear']

const FACTORIES: Readonly<Record<CurveKind, CurveFactory>> = {
  catmullRom: curveCatmullRomClosed.alpha(CATMULL_ROM_ALPHA),
  cardinal: curveCardinalClosed.tension(CARDINAL_TENSION),
  linear: curveLinearClosed,
}

/** The d3 curve factory of a kind. */
export function curveFactory(kind: CurveKind): CurveFactory {
  return FACTORIES[kind]
}

/** One cubic Bézier segment (a straight segment is stored with its control points at thirds). */
export interface Cubic {
  readonly p0: Point
  readonly p1: Point
  readonly p2: Point
  readonly p3: Point
}

/** A closed path as d3 drew it: the start point and its cubic segments in drawing order. */
export interface RecordedPath {
  readonly start: Point
  readonly segments: readonly Cubic[]
}

function lineCubic(a: Point, b: Point): Cubic {
  return {
    p0: a,
    p1: [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3],
    p2: [a[0] + (2 * (b[0] - a[0])) / 3, a[1] + (2 * (b[1] - a[1])) / 3],
    p3: b,
  }
}

/** A minimal CanvasPath recorder for d3-shape's `line().context()`. */
class Recorder {
  start: Point | null = null
  cur: Point | null = null
  readonly segments: Cubic[] = []

  moveTo(x: number, y: number): void {
    if (this.start !== null) throw new Error('blob curves are a single closed subpath')
    this.start = [x, y]
    this.cur = [x, y]
  }

  lineTo(x: number, y: number): void {
    const a = this.need()
    this.segments.push(lineCubic(a, [x, y]))
    this.cur = [x, y]
  }

  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    const a = this.need()
    this.segments.push({ p0: a, p1: [x1, y1], p2: [x2, y2], p3: [x, y] })
    this.cur = [x, y]
  }

  closePath(): void {
    const a = this.need()
    const s = this.start!
    if (a[0] !== s[0] || a[1] !== s[1]) this.segments.push(lineCubic(a, s))
    this.cur = s
  }

  private need(): Point {
    if (this.cur === null) throw new Error('path command before moveTo')
    return this.cur
  }
}

/** Generate the closed curve of `kind` through `points` (in order) and record what d3 draws. */
export function recordCurve(points: readonly Point[], kind: CurveKind): RecordedPath {
  if (points.length < 3) throw new RangeError('a closed blob curve needs at least 3 points')
  const rec = new Recorder()
  line<Point>()
    .x((p) => p[0])
    .y((p) => p[1])
    .curve(FACTORIES[kind])
    .context(rec as unknown as CanvasRenderingContext2D)(points as Point[])
  if (rec.start === null) throw new Error('d3 drew nothing')
  return { start: rec.start, segments: rec.segments }
}

/** Point of a cubic at parameter t ∈ [0, 1]. */
export function cubicAt(c: Cubic, t: number): Point {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const d = 3 * u * t * t
  const e = t * t * t
  return [a * c.p0[0] + b * c.p1[0] + d * c.p2[0] + e * c.p3[0], a * c.p0[1] + b * c.p1[1] + d * c.p2[1] + e * c.p3[1]]
}

/** Distance from the origin to the segment a–b. */
export function originToSegment(a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(a[0] * dx + a[1] * dy) / len2))
  return Math.hypot(a[0] + t * dx, a[1] + t * dy)
}

/** The radial band [lo, hi] of the straight chord between a segment's endpoints (module comment). */
export function chordBand(a: Point, b: Point): readonly [number, number] {
  const ra = Math.hypot(a[0], a[1])
  const rb = Math.hypot(b[0], b[1])
  return [Math.min(ra, rb, originToSegment(a, b)), Math.max(ra, rb)]
}

function excess(c: Cubic, t: number, lo: number, hi: number): number {
  const [x, y] = cubicAt(c, t)
  const r = Math.hypot(x, y)
  return Math.max(r - hi, lo - r, 0)
}

/**
 * Radial overshoot of one segment, in the units of the points: the largest excess of |curve(t)|
 * over its chord band, from `samples` + 1 evenly spaced t plus a golden-section refinement
 * around the worst sample.
 */
export function segmentOvershoot(c: Cubic, samples = OVERSHOOT_SAMPLES): number {
  const [lo, hi] = chordBand(c.p0, c.p3)
  let best = 0
  let bestT = 0
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const e = excess(c, t, lo, hi)
    if (e > best) {
      best = e
      bestT = t
    }
  }
  if (best === 0) return 0
  // Refine the maximum on [t − h, t + h] (the excess is smooth there); keep the best seen.
  let a = Math.max(0, bestT - 1 / samples)
  let b = Math.min(1, bestT + 1 / samples)
  const g = (Math.sqrt(5) - 1) / 2
  for (let i = 0; i < 40; i++) {
    const m1 = b - g * (b - a)
    const m2 = a + g * (b - a)
    const e1 = excess(c, m1, lo, hi)
    const e2 = excess(c, m2, lo, hi)
    best = Math.max(best, e1, e2)
    if (e1 < e2) a = m1
    else b = m2
  }
  return best
}

/** The largest segment overshoot of a recorded path, in the units of the points. */
export function pathOvershoot(path: RecordedPath, samples = OVERSHOOT_SAMPLES): number {
  let worst = 0
  for (const s of path.segments) worst = Math.max(worst, segmentOvershoot(s, samples))
  return worst
}

/** A coordinate for SVG path data: fixed digits, never "-0.00". */
export function fmt(v: number, digits = 2): string {
  const s = v.toFixed(digits)
  return s === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : s
}

/** SVG path data of a recorded path (absolute M/C commands, closed with Z). */
export function pathData(path: RecordedPath, digits = 2): string {
  const f = (p: Point): string => `${fmt(p[0], digits)},${fmt(p[1], digits)}`
  let d = `M${f(path.start)}`
  for (const s of path.segments) d += `C${f(s.p1)} ${f(s.p2)} ${f(s.p3)}`
  return `${d}Z`
}

export interface ChosenCurve {
  readonly kind: CurveKind
  /** Overshoot of the chosen curve, in rings. */
  readonly overshootRings: number
  readonly path: RecordedPath
  readonly d: string
}

/**
 * The §9.2 choice for one closed curve: Catmull-Rom (α = 0.5) if its overshoot is ≤ 0.1 ring,
 * else cardinal (tension 0.6) if that passes, else the straight polygon (always passes).
 */
export function chooseCurve(points: readonly Point[], ring: number, limitRings = OVERSHOOT_LIMIT_RINGS): ChosenCurve {
  if (!(ring > 0)) throw new RangeError('ring spacing must be positive')
  for (const kind of CURVE_CHAIN) {
    const path = recordCurve(points, kind)
    const overshootRings = pathOvershoot(path) / ring
    if (overshootRings <= limitRings || kind === 'linear') return { kind, overshootRings, path, d: pathData(path) }
  }
  throw new Error('unreachable')
}
