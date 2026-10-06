import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createRng } from '../engine/prng'
import { chooseCurve, CURVE_CHAIN, OVERSHOOT_LIMIT_RINGS, pathData, pathEnd, recordCurve, reversedSegmentsData, type Cubic, type CurveKind, type RecordedPath } from './curve'
import { polar, R_MIN_FRACTION, radiusScale, ringSpacing, spokeAngle, type Point } from './geometry'

const R = 180
const RING = ringSpacing(R)
const r = radiusScale(R)

/** De Casteljau evaluation (independent of curve.ts's Bernstein form). */
function casteljau(c: Cubic, t: number): Point {
  const lerp = (a: Point, b: Point): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  const a = lerp(c.p0, c.p1)
  const b = lerp(c.p1, c.p2)
  const d = lerp(c.p2, c.p3)
  return lerp(lerp(a, b), lerp(b, d))
}

/**
 * Overshoot in rings by brute force: the curve's radius at `n` + 1 samples per segment against
 * the chord band, whose low end is found by sampling the straight chord too.
 */
function denseOvershootRings(path: RecordedPath, n = 512): number {
  let worst = 0
  for (const s of path.segments) {
    const ra = Math.hypot(...s.p0)
    const rb = Math.hypot(...s.p3)
    let chordMin = Math.min(ra, rb)
    for (let i = 0; i <= n; i++) {
      const t = i / n
      chordMin = Math.min(chordMin, Math.hypot(s.p0[0] + (s.p3[0] - s.p0[0]) * t, s.p0[1] + (s.p3[1] - s.p0[1]) * t))
    }
    const hi = Math.max(ra, rb)
    for (let i = 0; i <= n; i++) {
      const rr = Math.hypot(...casteljau(s, i / n))
      worst = Math.max(worst, rr - hi, chordMin - rr)
    }
  }
  return worst / RING
}

/** Spoke points of a profile: θ per spoke, or null for a not-measured dip to the inner clamp. */
function spokePoints(thetas: readonly (number | null)[]): Point[] {
  return thetas.map((t, i) => polar(t === null ? R_MIN_FRACTION * R : r(t), spokeAngle(i, thetas.length)))
}

/** Random profiles like real ones: some spokes not measured, some very jagged, some clamped. */
const profileArb = fc.array(
  fc.oneof(
    { weight: 3, arbitrary: fc.double({ min: -2, max: 2, noNaN: true }) },
    { weight: 2, arbitrary: fc.double({ min: -4, max: 4, noNaN: true }) },
    { weight: 2, arbitrary: fc.constant(null) },
  ),
  { minLength: 3, maxLength: 20 },
)

/**
 * Centripetal Catmull-Rom by the Barry–Goldman pyramid (knots t_{i+1} = t_i + |P_{i+1} − P_i|^α),
 * evaluated at fraction u of the P1 → P2 span: an independent reference for what d3 draws.
 */
function barryGoldman(p0: Point, p1: Point, p2: Point, p3: Point, u: number, alpha = 0.5): Point {
  const t0 = 0
  const t1 = t0 + Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) ** alpha
  const t2 = t1 + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) ** alpha
  const t3 = t2 + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]) ** alpha
  const t = t1 + u * (t2 - t1)
  const mix = (a: Point, b: Point, ta: number, tb: number): Point => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)]
  const a1 = mix(p0, p1, t0, t1)
  const a2 = mix(p1, p2, t1, t2)
  const a3 = mix(p2, p3, t2, t3)
  const b1 = mix(a1, a2, t0, t2)
  const b2 = mix(a2, a3, t1, t3)
  return mix(b1, b2, t1, t2)
}

describe('recorded curves', () => {
  it('d3 draws the centripetal (α = 0.5) closed Catmull-Rom spline (§9.2)', () => {
    fc.assert(
      fc.property(profileArb, (thetas) => {
        const pts = spokePoints(thetas)
        const n = pts.length
        const path = recordCurve(pts, 'catmullRom')
        expect(path.segments).toHaveLength(n)
        path.segments.forEach((s, j) => {
          // Segment j runs from point j+1 to j+2 (d3 starts the closed curve at the second point).
          const [p0, p1, p2, p3] = [j, j + 1, j + 2, j + 3].map((i) => pts[i % n]!) as [Point, Point, Point, Point]
          for (const u of [0.1, 0.35, 0.5, 0.8]) {
            const want = barryGoldman(p0, p1, p2, p3, u)
            const got = casteljau(s, u)
            expect(Math.hypot(got[0] - want[0], got[1] - want[1])).toBeLessThan(1e-8 * R)
          }
        })
      }),
      { numRuns: 150 },
    )
  })

  it('passes through every spoke point, in order, for each curve kind', () => {
    fc.assert(
      fc.property(profileArb, fc.constantFrom<CurveKind>(...CURVE_CHAIN), (thetas, kind) => {
        const pts = spokePoints(thetas)
        const path = recordCurve(pts, kind)
        const ends = path.segments.map((s) => s.p3)
        const n = pts.length
        expect(ends).toHaveLength(n)
        // d3 starts a closed spline at the second point and the closed polygon at the first.
        const off = kind === 'linear' ? 1 : 2
        ends.forEach((e, j) => {
          const want = pts[(j + off) % n]!
          expect(Math.hypot(e[0] - want[0], e[1] - want[1])).toBeLessThan(1e-9)
        })
      }),
      { numRuns: 100 },
    )
  })

  it('serialises to closed SVG path data', () => {
    const d = pathData(recordCurve(spokePoints([0, 1, -1, 2]), 'catmullRom'))
    expect(d).toMatch(/^M-?\d+\.\d{2},-?\d+\.\d{2}(C[-\d., ]+)+Z$/)
    expect(d.match(/C/g)).toHaveLength(4)
    expect(() => recordCurve(spokePoints([0, 1]), 'linear')).toThrow(RangeError)
  })
})

describe('overshoot rule (§9.2: ≤ 0.1 ring, else cardinal(0.6))', () => {
  it('the chosen curve never overshoots by more than 0.1 ring, on many random profiles', () => {
    fc.assert(
      fc.property(profileArb, (thetas) => {
        const pts = spokePoints(thetas)
        const chosen = chooseCurve(pts, RING)
        expect(chosen.overshootRings).toBeLessThanOrEqual(OVERSHOOT_LIMIT_RINGS)
        expect(denseOvershootRings(chosen.path)).toBeLessThanOrEqual(OVERSHOOT_LIMIT_RINGS + 1e-3)
      }),
      { numRuns: 400 },
    )
  })

  it('prefers Catmull-Rom, then cardinal(0.6), then the straight polygon', () => {
    fc.assert(
      fc.property(profileArb, (thetas) => {
        const pts = spokePoints(thetas)
        const chosen = chooseCurve(pts, RING)
        const over = (k: CurveKind): number => denseOvershootRings(recordCurve(pts, k), 256)
        if (chosen.kind !== 'catmullRom') expect(over('catmullRom')).toBeGreaterThan(OVERSHOOT_LIMIT_RINGS - 1e-3)
        if (chosen.kind === 'linear') expect(over('cardinal')).toBeGreaterThan(OVERSHOOT_LIMIT_RINGS - 1e-3)
        if (chosen.kind === 'catmullRom') expect(over('catmullRom')).toBeLessThanOrEqual(OVERSHOOT_LIMIT_RINGS + 1e-3)
      }),
      { numRuns: 300 },
    )
  })

  it('the straight polygon never overshoots (it is its own chord band)', () => {
    fc.assert(
      fc.property(profileArb, (thetas) => {
        expect(denseOvershootRings(recordCurve(spokePoints(thetas), 'linear'))).toBeLessThan(1e-9)
      }),
      { numRuns: 100 },
    )
  })

  it('uses Catmull-Rom for smooth profiles and falls back on jagged ones (not vacuous)', () => {
    expect(chooseCurve(spokePoints(new Array<number>(17).fill(0.5)), RING).kind).toBe('catmullRom')
    const rng = createRng('m1.16-overshoot')
    const counts: Record<CurveKind, number> = { catmullRom: 0, cardinal: 0, linear: 0 }
    for (let n = 0; n < 1500; n++) {
      const thetas = Array.from({ length: 17 }, () => (rng.next() < 0.4 ? null : rng.normal(0, rng.next() < 0.3 ? 2 : 1)))
      counts[chooseCurve(spokePoints(thetas), RING).kind]++
    }
    expect(counts.catmullRom).toBeGreaterThan(1000)
    expect(counts.cardinal).toBeGreaterThan(0)
    expect(counts.linear).toBeGreaterThan(0)
  })

  it('detects an outward bulge between two tall spokes (the case the rule exists for)', () => {
    // A lone deep dip between tall neighbours makes Catmull-Rom swing round the centre.
    const thetas = [3, 3, -3, 3, 3, 3, 3, 3]
    const pts = spokePoints(thetas)
    expect(denseOvershootRings(recordCurve(pts, 'catmullRom'))).toBeGreaterThan(OVERSHOOT_LIMIT_RINGS)
    const chosen = chooseCurve(pts, RING)
    expect(chosen.kind).not.toBe('catmullRom')
    expect(chosen.overshootRings).toBeLessThanOrEqual(OVERSHOOT_LIMIT_RINGS)
  })
})

/** A run of measured spokes: θ per spoke (no gaps inside a run). */
const runArb = fc.array(fc.double({ min: -4, max: 4, noNaN: true }), { minLength: 2, maxLength: 12 })

/** Points of a run of `n` measured spokes out of `k`, starting at spoke `start`. */
function runPoints(thetas: readonly number[], k = 17, start = 3): Point[] {
  return thetas.map((t, j) => polar(r(t), spokeAngle(start + j, k)))
}

describe('open curves: a run of measured spokes between gaps (UX review D13 A)', () => {
  it('passes through every point of the run, in order, from the first to the last, and does not close', () => {
    fc.assert(
      fc.property(runArb, fc.constantFrom<CurveKind>(...CURVE_CHAIN), (thetas, kind) => {
        const pts = runPoints(thetas)
        const path = recordCurve(pts, kind, false)
        expect(path.closed).toBe(false)
        expect(path.start).toEqual(pts[0])
        expect(path.segments).toHaveLength(pts.length - 1)
        path.segments.forEach((sgm, j) => {
          expect(Math.hypot(sgm.p0[0] - pts[j]![0], sgm.p0[1] - pts[j]![1])).toBeLessThan(1e-9)
          expect(Math.hypot(sgm.p3[0] - pts[j + 1]![0], sgm.p3[1] - pts[j + 1]![1])).toBeLessThan(1e-9)
        })
        expect(pathEnd(path)).toEqual(path.segments.at(-1)!.p3)
        const d = pathData(path)
        expect(d).not.toContain('Z')
        expect(d.match(/C/g)).toHaveLength(pts.length - 1)
      }),
      { numRuns: 150 },
    )
  })

  it('is the straight chord for two points, and needs at least two', () => {
    const pts = runPoints([0.5, -1])
    for (const kind of CURVE_CHAIN) expect(denseOvershootRings(recordCurve(pts, kind, false))).toBeLessThan(1e-9)
    expect(() => recordCurve(runPoints([0.5]), 'catmullRom', false)).toThrow(RangeError)
    expect(() => recordCurve(runPoints([0.5, 1]), 'catmullRom')).toThrow(RangeError) // a closed curve still needs three
  })

  it('obeys the overshoot rule like a closed curve: ≤ 0.1 ring, Catmull-Rom first', () => {
    fc.assert(
      fc.property(runArb, (thetas) => {
        const pts = runPoints(thetas)
        const chosen = chooseCurve(pts, RING, OVERSHOOT_LIMIT_RINGS, false)
        expect(chosen.path.closed).toBe(false)
        expect(chosen.overshootRings).toBeLessThanOrEqual(OVERSHOOT_LIMIT_RINGS)
        expect(denseOvershootRings(chosen.path)).toBeLessThanOrEqual(OVERSHOOT_LIMIT_RINGS + 1e-3)
        if (chosen.kind !== 'catmullRom') expect(denseOvershootRings(recordCurve(pts, 'catmullRom', false), 256)).toBeGreaterThan(OVERSHOOT_LIMIT_RINGS - 1e-3)
      }),
      { numRuns: 200 },
    )
    expect(chooseCurve(runPoints([0.5, 0.5, 0.5, 0.5]), RING, OVERSHOOT_LIMIT_RINGS, false).kind).toBe('catmullRom')
  })

  it('traces a path backwards: the reversed segments visit the same points from the end to the start', () => {
    fc.assert(
      fc.property(runArb, (thetas) => {
        const path = recordCurve(runPoints(thetas), 'catmullRom', false)
        const back = reversedSegmentsData(path)
        const ends = [...back.matchAll(/C[-\d.]+,[-\d.]+ [-\d.]+,[-\d.]+ (-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])])
        const want = [...path.segments].reverse().map((sgm) => sgm.p0)
        expect(ends).toHaveLength(want.length)
        ends.forEach((e, j) => expect(Math.hypot(e[0]! - want[j]![0], e[1]! - want[j]![1])).toBeLessThan(0.01))
        // The same control points, swapped: the same curve, drawn the other way.
        const first = path.segments.at(-1)!
        expect(back.startsWith(`C${first.p2[0].toFixed(2)},`) || back.startsWith(`C${first.p2[0].toFixed(2).replace(/^-0\.00$/, '0.00')},`)).toBe(true)
      }),
      { numRuns: 100 },
    )
  })
})
