import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { OVERSHOOT_LIMIT_RINGS } from './curve'
import {
  ARROW_LENGTH,
  buildBlob,
  DEFAULT_LAYOUT,
  DEFAULT_R,
  defaultLayout,
  estimateTextWidth,
  fitLayout,
  fitLayoutDetailed,
  textScale,
  FUZZ_MAX_OPACITY,
  FUZZ_Z,
  fuzzOpacity,
  GAP_MARK_ARM,
  gapMarkPath,
  LABEL_FONT,
  MAX_LABEL_FONT,
  MIN_TEXT_PX,
  N_FUZZ,
  NOTE_WRAP_CHARS,
  renderedSizes,
  sectorPath,
  spokeLines,
  STUB_LIST_MIN,
  stubList,
  WRAP_CHARS,
  wrapLine,
  type BlobModel,
  type Box,
  type TextMeasure,
} from './blob'
import { clusterFacets, unmeasuredReasons } from './facets'
import { offScaleOf, R_MIN_FRACTION, radiusScale, spokeAngle, THETA_CLAMP_LOW, Z90 } from './geometry'
import { axisEstimates, COMPACT_LABELS, measuredFields, type AxisEstimate, type SpokeEstimate } from './profile'
import { syntheticProfile, SYNTHETIC_PROFILES } from './synthetic'

function modelOf(id: string): { est: AxisEstimate[]; model: BlobModel } {
  const p = syntheticProfile(id)!
  const est = axisEstimates(p.input)
  return { est, model: buildBlob(est) }
}

/** The subpaths of path data, each with its on-curve points (its M point, each L point, each C end) and whether it is closed. */
function subpaths(d: string): { points: [number, number][]; closed: boolean }[] {
  return d
    .split('M')
    .filter((x) => x !== '')
    .map((sub) => {
      const points = [...`M${sub}`.matchAll(/([MLC])([^MLCZ]*)/g)].map((m) => {
        const pairs = m[2]!.trim().split(' ')
        const [x, y] = pairs.at(-1)!.split(',').map(Number) as [number, number]
        return [x, y] as [number, number]
      })
      return { points, closed: sub.endsWith('Z') }
    })
}

const R = DEFAULT_R
const r = radiusScale(R)

/** The spoke index nearest to a point's direction, of k spokes. */
function spokeOf([x, y]: readonly [number, number], k: number): number {
  const ang = (Math.atan2(x, -y) + 2 * Math.PI) % (2 * Math.PI)
  return Math.round((ang / (2 * Math.PI)) * k) % k
}

/** Radius of a curve at each spoke it passes (from its on-curve points, M points included), by spoke index. */
function radiiAtSpokes(d: string, k: number): Map<number, number> {
  const out = new Map<number, number>()
  for (const sub of subpaths(d)) for (const p of sub.points) out.set(spokeOf(p, k), Math.hypot(...p))
  return out
}

/** The runs of measured spokes around the cycle (first index, length), or null when every spoke is measured. */
function measuredRuns(measured: readonly boolean[]): { start: number; len: number }[] | null {
  const k = measured.length
  if (measured.every(Boolean)) return null
  const runs: { start: number; len: number }[] = []
  const first = measured.findIndex((m, i) => m && !measured[(i - 1 + k) % k])
  if (first < 0) return runs
  for (let n = 0, i = first; n < k; ) {
    if (!measured[i % k]) {
      i++
      n++
      continue
    }
    const start = i % k
    let len = 0
    while (n < k && measured[i % k]) (i++, n++, len++)
    runs.push({ start, len })
  }
  return runs
}

/** Spokes that lie on a drawn curve: every measured spoke with a measured neighbour (all of them without gaps). */
function onCurve(measured: readonly boolean[]): Set<number> {
  const k = measured.length
  const runs = measuredRuns(measured)
  if (runs === null) return new Set(measured.map((_, i) => i))
  return new Set(runs.filter((x) => x.len >= 2).flatMap((x) => Array.from({ length: x.len }, (_, j) => (x.start + j) % k)))
}

/** Is the direction of `angle` inside the sector path from `sectorPath` (its two arc ends)? */
function inSector(d: string, angle: number): boolean {
  if (/A.*A/.test(d)) return true // a full circle
  const m = /^M0,0L(-?[\d.]+),(-?[\d.]+)A[^ ]+ 0 [01],1 (-?[\d.]+),(-?[\d.]+)Z$/.exec(d)!
  const a = (x: number, y: number): number => (Math.atan2(x, -y) + 2 * Math.PI) % (2 * Math.PI)
  const a0 = a(Number(m[1]), Number(m[2]))
  const span = (a(Number(m[3]), Number(m[4])) - a0 + 2 * Math.PI) % (2 * Math.PI)
  return (angle - a0 + 2 * Math.PI) % (2 * Math.PI) < span
}

/** Box containment; the tolerance covers the viewBox's 2-decimal rounding. */
function within(inner: Box, outer: Box, tol = 0.011): boolean {
  return inner.x0 >= outer.x0 - tol && inner.x1 <= outer.x1 + tol && inner.y0 >= outer.y0 - tol && inner.y1 <= outer.y1 + tol
}

function viewBoxOf(model: BlobModel): Box {
  const [x, y, w, h] = model.viewBox.split(' ').map(Number) as [number, number, number, number]
  return { x0: x, y0: y, x1: x + w, y1: y + h }
}

describe('blob render model (§9)', () => {
  it('draws all 17 spokes; unmeasured ones as dashed stubs with a gap marker on the 0 SD ring, never interpolated (§9.7, A15, D13 A)', () => {
    for (const p of SYNTHETIC_PROFILES) {
      const { est, model } = modelOf(p.id)
      expect(model.spokes).toHaveLength(17)
      model.spokes.forEach((s, i) => {
        expect(s.angle).toBeCloseTo(spokeAngle(i, 17), 12)
        if (est[i]!.measured) {
          expect(s.marker && s.whisker).toBeTruthy()
          expect(s.stub).toBeUndefined()
          expect(s.gap).toBeUndefined()
          expect(s.gapMark).toBeUndefined()
        } else {
          expect(s.marker).toBeUndefined()
          expect(s.whisker).toBeUndefined()
          expect(s.stub && s.gap && s.gapMark).toBeTruthy()
          // D13 A: on the 0 SD ring (R/2), on its own spoke; not at the centre, where −3 SD is drawn.
          expect(Math.hypot(...s.gap!)).toBeCloseTo(r(0), 9)
          expect(Math.hypot(...s.gap!)).toBeCloseTo(R / 2, 9)
          expect(spokeOf(s.gap!, 17)).toBe(i)
          expect(s.lines.at(-1)).toEqual({ text: 'not measured', note: true, glyph: false })
        }
      })
    }
  })

  it('draws the gap marker as an × of two strokes crossing on the 0 SD ring, its arms at 45° to the spoke (D13 A)', () => {
    const { model } = modelOf('m1')
    for (const s of model.spokes.filter((x) => !x.measured)) {
      expect(s.gapMark).toBe(gapMarkPath(s.gap!, s.angle))
      const pts = [...s.gapMark!.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const)
      expect(s.gapMark).toMatch(/^M[^ML]+L[^ML]+M[^ML]+L[^ML]+$/)
      expect(pts).toHaveLength(4)
      const radial: readonly [number, number] = [Math.sin(s.angle), -Math.cos(s.angle)]
      for (const [a, b] of [
        [pts[0]!, pts[1]!],
        [pts[2]!, pts[3]!],
      ] as const) {
        // Each stroke is centred on the gap marker, 2·GAP_MARK_ARM long, at 45° to the spoke.
        expect((a[0] + b[0]) / 2).toBeCloseTo(s.gap![0], 1)
        expect((a[1] + b[1]) / 2).toBeCloseTo(s.gap![1], 1)
        const len = Math.hypot(b[0] - a[0], b[1] - a[1])
        expect(len).toBeCloseTo(2 * GAP_MARK_ARM, 1)
        const cos = Math.abs(((b[0] - a[0]) * radial[0] + (b[1] - a[1]) * radial[1]) / len)
        expect(cos).toBeCloseTo(Math.SQRT1_2, 2)
      }
    }
  })

  it('breaks every curve at an unmeasured spoke (a gap) and passes through r(θ) at the measured ones (D13 A)', () => {
    for (const p of SYNTHETIC_PROFILES) {
      const { est, model } = modelOf(p.id)
      const measured = est.map((e) => e.measured)
      const runs = measuredRuns(measured)
      const drawn = onCurve(measured)
      for (const c of [model.crisp, model.band.outer, model.band.inner, ...model.fuzz]) {
        const subs = subpaths(c.d)
        if (runs === null) {
          // Every spoke measured: one closed curve, as before.
          expect(subs, p.id).toHaveLength(1)
          expect(subs[0]!.closed).toBe(true)
        } else {
          // One open curve per run of two or more measured spokes; none through a not-measured spoke.
          expect(subs, p.id).toHaveLength(runs.filter((x) => x.len >= 2).length)
          for (const sub of subs) expect(sub.closed, p.id).toBe(false)
        }
        for (const sub of subs) for (const pt of sub.points) expect(measured[spokeOf(pt, 17)], `${p.id}: a point on an unmeasured spoke`).toBe(true)
        // Each spoke on a curve appears once per curve (none twice, none missing).
        const seen = subs.flatMap((sub) => (sub.closed ? sub.points.slice(1) : sub.points)).map((pt) => spokeOf(pt, 17))
        expect([...seen].sort((a, b) => a - b), p.id).toEqual([...drawn].sort((a, b) => a - b))
      }
      const crisp = radiiAtSpokes(model.crisp.d, 17)
      est.forEach((e, i) => {
        if (drawn.has(i)) expect(crisp.get(i), `${p.id} ${e.code}`).toBeCloseTo(r(e.theta!), 1)
        else expect(crisp.has(i), `${p.id} ${e.code}`).toBe(false)
      })
    }
    // The static first session has gaps and two-spoke runs; a lone measured spoke has no curve at all.
    const m1 = modelOf('m1')
    expect(measuredRuns(m1.est.map((e) => e.measured))!.map((x) => x.len).sort()).toEqual([2, 2, 3])
    const sparse = modelOf('sparse')
    const lone = measuredRuns(sparse.est.map((e) => e.measured))!.filter((x) => x.len === 1)
    expect(lone.length).toBeGreaterThan(0)
    for (const x of lone) {
      const s = sparse.model.spokes[x.start]!
      expect(s.marker && s.whisker, `${s.id} keeps its marker and 90% whisker`).toBeTruthy()
      expect(radiiAtSpokes(sparse.model.crisp.d, 17).has(x.start)).toBe(false)
    }
  })

  it('has no gap at a measured spoke: with every spoke measured every curve is closed and the band is two closed curves', () => {
    const { model } = modelOf('full')
    for (const c of [model.crisp, model.band.outer, model.band.inner, ...model.fuzz]) expect(c.d).toMatch(/^M[^M]*Z$/)
    expect(model.band.d).toBe(model.band.outer.d + model.band.inner.d)
    expect(model.hatchFill).toBe(model.crisp.d)
    for (const s of model.spokes) expect(s.gap).toBeUndefined()
  })

  it('fills the band and each fuzz band run by run, each a closed region between its two edges (D13 A)', () => {
    for (const id of ['m1', 'skipped', 'sparse', 'offscale']) {
      const { est, model } = modelOf(id)
      const runs = measuredRuns(est.map((e) => e.measured))!.filter((x) => x.len >= 2)
      for (const band of [model.band.d, ...model.fuzz.map((c) => c.band)]) {
        const subs = subpaths(band)
        expect(subs, id).toHaveLength(runs.length)
        for (const sub of subs) expect(sub.closed, id).toBe(true)
        // Each region goes out along one edge and back along the other: every spoke of its run twice.
        subs.forEach((sub) => {
          const ids = sub.points.map((pt) => spokeOf(pt, 17))
          expect(ids).toEqual([...ids.slice(0, ids.length / 2), ...ids.slice(0, ids.length / 2).reverse()])
        })
      }
      // The ±1 SD band's two edges are r(θ ± SD) at every spoke of a run.
      const band = subpaths(model.band.d)
      band.forEach((sub, j) => {
        const n = sub.points.length / 2
        for (let q = 0; q < n; q++) {
          const i = spokeOf(sub.points[q]!, 17)
          const e = est[i]!
          expect(Math.hypot(...sub.points[q]!), `${id} ${e.code} outer`).toBeCloseTo(r(e.theta! + e.sd!), 1)
          expect(Math.hypot(...sub.points[2 * n - 1 - q]!), `${id} ${e.code} inner`).toBeCloseTo(r(e.theta! - e.sd!), 1)
        }
        expect(n).toBe(runs[j]!.len)
      })
    }
  })

  it('property: with any mix of measured spokes, gaps fall exactly at the unmeasured ones, markers and whiskers exactly at the measured ones', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ measured: fc.boolean(), theta: fc.double({ min: -2.5, max: 2.5, noNaN: true }) }), { minLength: 3, maxLength: 17 }), (raw) => {
        const spokes: SpokeEstimate[] = raw.map((x, i) => ({
          id: `s${i}`,
          name: `Skill ${i}`,
          shortLabel: [`S${i}`],
          group: 'g',
          tier: 'a',
          glyph: '',
          ...(x.measured ? measuredFields(x.theta, 0.4) : { measured: false, reason: 'no_data' as const, muted: false }),
        }))
        const k = spokes.length
        const model = buildBlob(spokes)
        const measured = spokes.map((s) => s.measured)
        const drawn = onCurve(measured)
        for (const c of [model.crisp, model.band.outer, model.band.inner, ...model.fuzz]) {
          const at = new Set(subpaths(c.d).flatMap((sub) => sub.points.map((pt) => spokeOf(pt, k))))
          expect([...at].sort((a, b) => a - b)).toEqual([...drawn].sort((a, b) => a - b))
          expect(c.overshootRings).toBeLessThanOrEqual(OVERSHOOT_LIMIT_RINGS)
        }
        model.spokes.forEach((s, i) => {
          expect(Boolean(s.marker && s.whisker)).toBe(measured[i])
          expect(Boolean(s.stub && s.gap && s.gapMark)).toBe(!measured[i])
          if (!measured[i]) expect(Math.hypot(...s.gap!)).toBeCloseTo(R / 2, 6)
        })
      }),
      { numRuns: 120 },
    )
  })

  it('hatches a lone or run-end tier (c) spoke from the centre (D13 A)', () => {
    const tierC = (i: number, theta: number): SpokeEstimate => ({ ...spokeAt(i, theta), tier: 'c', glyph: '◇' })
    const stub = (i: number): SpokeEstimate => ({ id: `s${i}`, name: `Skill ${i}`, shortLabel: [`Skill ${i}`], group: 'g', tier: 'a', glyph: '', measured: false, reason: 'no_data', muted: false })
    const lone = buildBlob([tierC(0, 0.5), stub(1), spokeAt(2, 0.2), spokeAt(3, -0.1), stub(4)])
    expect(lone.hatch.map((h) => h.id)).toEqual(['s0'])
    // A lone spoke: a narrow sector up to its marker; a run: its curve closed through the centre.
    const parts = lone.hatchFill.split('M').filter(Boolean)
    expect(parts).toHaveLength(2)
    for (const part of parts) expect(part).toMatch(/^0,0L.*Z$/)
    expect(lone.hatchFill).toContain(sectorPath(-Math.PI / 5 / 2, Math.PI / 5 / 2, r(0.5)))
  })

  it('puts markers at r(θ) and whiskers over the 90% interval, radius linear in θ', () => {
    const { est, model } = modelOf('full')
    model.spokes.forEach((s, i) => {
      const e = est[i]!
      expect(Math.hypot(...s.marker!)).toBeCloseTo(r(e.theta!), 9)
      expect(Math.hypot(...s.whisker![0])).toBeCloseTo(r(e.lo90!), 9)
      expect(Math.hypot(...s.whisker![1])).toBeCloseTo(r(e.hi90!), 9)
      expect(s.muted).toBe(e.muted)
    })
  })

  it('has a crisp curve, a ±1 SD band and 20 fuzz curves, none overshooting by > 0.1 ring (§9.2, §9.3)', () => {
    for (const p of SYNTHETIC_PROFILES) {
      const { est, model } = modelOf(p.id)
      expect(model.fuzz).toHaveLength(N_FUZZ)
      const closed = est.every((e) => e.measured)
      for (const c of [model.crisp, model.band.outer, model.band.inner, ...model.fuzz]) {
        expect(c.overshootRings).toBeLessThanOrEqual(OVERSHOOT_LIMIT_RINGS)
        // Closed with every spoke measured; open runs with gaps (D13 A).
        expect(c.d).toMatch(closed ? /^M.*Z$/ : /^M[^Z]*$/)
      }
      if (closed) expect(model.band.d).toBe(model.band.outer.d + model.band.inner.d)
      expect(new Set(model.fuzz.map((c) => c.d)).size).toBe(N_FUZZ)
    }
  })

  it('spreads the 20 fuzz z values evenly over ±1.645, symmetric, inside out, with no z = 0 (§9.3)', () => {
    expect(FUZZ_Z).toHaveLength(N_FUZZ)
    expect(FUZZ_Z[0]).toBeCloseTo(-Z90, 12)
    expect(FUZZ_Z.at(-1)).toBeCloseTo(Z90, 12)
    FUZZ_Z.forEach((z, j) => {
      expect(z).toBeCloseTo(-FUZZ_Z[N_FUZZ - 1 - j]!, 12)
      expect(z).not.toBe(0)
      if (j > 0) expect(z).toBeGreaterThan(FUZZ_Z[j - 1]!)
    })
    const steps = FUZZ_Z.slice(1).map((z, j) => z - FUZZ_Z[j]!)
    // Equal steps, except across the crisp curve (z = 0), which is two half steps.
    steps.forEach((d, j) => expect(d, `step ${j}`).toBeCloseTo(j === N_FUZZ / 2 - 1 ? (2 * Z90) / N_FUZZ * 2 : (2 * Z90) / N_FUZZ, 12))
  })

  it('fills each fuzz band with opacity ∝ the normal density φ(z), darkest next to the mean (§9.3)', () => {
    const { model } = modelOf('full')
    model.fuzz.forEach((c, j) => {
      expect(c.z).toBe(FUZZ_Z[j])
      expect(c.opacity).toBeCloseTo(FUZZ_MAX_OPACITY * Math.exp(-(c.z * c.z) / 2), 12)
    })
    // ∝ φ: the ratio of any two opacities is the ratio of the densities.
    fc.assert(
      fc.property(fc.double({ min: -3, max: 3, noNaN: true }), fc.double({ min: -3, max: 3, noNaN: true }), (a, b) => {
        expect(fuzzOpacity(a) / fuzzOpacity(b)).toBeCloseTo(Math.exp((b * b - a * a) / 2), 9)
      }),
    )
    const byAbs = [...model.fuzz].sort((a, b) => Math.abs(a.z) - Math.abs(b.z))
    for (let j = 2; j < byAbs.length; j++) expect(byAbs[j]!.opacity).toBeLessThanOrEqual(byAbs[j - 1]!.opacity)
    expect(Math.max(...model.fuzz.map((c) => c.opacity))).toBeLessThanOrEqual(FUZZ_MAX_OPACITY)
  })

  it('draws fuzz curve j at r(θ + z_j·SD) at every measured spoke on a curve and nowhere else (§9.3, D13 A)', () => {
    for (const p of SYNTHETIC_PROFILES) {
      const { est, model } = modelOf(p.id)
      const drawn = onCurve(est.map((e) => e.measured))
      model.fuzz.forEach((c) => {
        const radii = radiiAtSpokes(c.d, 17)
        est.forEach((e, i) => {
          if (drawn.has(i)) expect(radii.get(i), `${p.id} z ${c.z.toFixed(3)} spoke ${e.code}`).toBeCloseTo(r(e.theta! + c.z * e.sd!), 1)
          else expect(radii.has(i), `${p.id} z ${c.z.toFixed(3)} spoke ${e.code}`).toBe(false)
        })
      })
    }
  })

  it('makes each fuzz band the curve plus its neighbour toward the mean (the crisp curve for the innermost pair)', () => {
    const { model } = modelOf('full')
    const mid = N_FUZZ / 2
    model.fuzz.forEach((c, j) => {
      const inward = j === mid - 1 || j === mid ? model.crisp : model.fuzz[c.z < 0 ? j + 1 : j - 1]!
      expect(c.band, `z ${c.z}`).toBe(c.d + inward.d)
    })
  })

  it('nests the fuzz curves: at every spoke the radius never decreases with z (property)', () => {
    const spoke = fc.record({ theta: fc.double({ min: -3.5, max: 3.5, noNaN: true }), sd: fc.double({ min: 0.05, max: 1.5, noNaN: true }), measured: fc.boolean() })
    fc.assert(
      fc.property(fc.array(spoke, { minLength: 3, maxLength: 17 }), (raw) => {
        const spokes: SpokeEstimate[] = raw.map((x, i) => ({
          id: `s${i}`,
          name: `Skill ${i}`,
          shortLabel: [`S${i}`],
          group: 'g',
          tier: 'a',
          glyph: '',
          ...(x.measured ? measuredFields(x.theta, x.sd) : { measured: false, reason: 'no_data' as const, muted: false }),
        }))
        const model = buildBlob(spokes)
        const radii = model.fuzz.map((c) => radiiAtSpokes(c.d, spokes.length))
        const crisp = radiiAtSpokes(model.crisp.d, spokes.length)
        spokes.forEach((_, i) => {
          if (!crisp.has(i)) return // a gap (D13 A): no curve at this spoke
          const seq = [...radii.slice(0, N_FUZZ / 2).map((m) => m.get(i)!), crisp.get(i)!, ...radii.slice(N_FUZZ / 2).map((m) => m.get(i)!)]
          for (let j = 1; j < seq.length; j++) expect(seq[j]!).toBeGreaterThanOrEqual(seq[j - 1]! - 0.011)
        })
      }),
      { numRuns: 60 },
    )
  })

  it('bounds the ±1 SD band by r(θ + SD) outside and r(θ − SD) inside, with no band at a gap (§9.3, D13 A)', () => {
    for (const p of SYNTHETIC_PROFILES) {
      const { est, model } = modelOf(p.id)
      const drawn = onCurve(est.map((e) => e.measured))
      const outer = radiiAtSpokes(model.band.outer.d, 17)
      const inner = radiiAtSpokes(model.band.inner.d, 17)
      est.forEach((e, i) => {
        if (!drawn.has(i)) {
          expect(outer.has(i) || inner.has(i), `${p.id} ${e.code}`).toBe(false)
          return
        }
        expect(outer.get(i), `${p.id} ${e.code} outer`).toBeCloseTo(r(e.theta! + e.sd!), 1)
        expect(inner.get(i), `${p.id} ${e.code} inner`).toBeCloseTo(r(e.theta! - e.sd!), 1)
      })
    }
  })

  it('splits the crisp curve into runs, muted exactly around muted spokes (§9.5)', () => {
    for (const p of SYNTHETIC_PROFILES) {
      const { est, model } = modelOf(p.id)
      expect(model.muteRuns.flatMap((run) => run.spokeIds).sort()).toEqual(est.map((e) => e.id).sort())
      for (const run of model.muteRuns) for (const id of run.spokeIds) expect(est.find((e) => e.id === id)!.muted).toBe(run.muted)
      // Every spoke direction lies in exactly one run's sector, the one of its own state.
      est.forEach((e, i) => {
        const hits = model.muteRuns.filter((run) => inSector(run.d, spokeAngle(i, 17)))
        expect(hits, `${p.id} ${e.code}`).toHaveLength(1)
        expect(hits[0]!.muted).toBe(e.muted)
      })
      // Runs alternate around the cycle (maximal runs).
      if (model.muteRuns.length > 1) model.muteRuns.forEach((run, j) => expect(run.muted).not.toBe(model.muteRuns[(j + 1) % model.muteRuns.length]!.muted))
    }
    expect(modelOf('full').model.muteRuns.some((run) => run.muted)).toBe(true)
  })

  it('rings sit at −2 … +2 SD, labelled in SD units, the 0 SD ring the dashed reference (A12)', () => {
    const { model } = modelOf('m1')
    expect(model.rings.map((x) => x.label)).toEqual(['−2 SD', '−1 SD', '0 SD', '+1 SD', '+2 SD'])
    expect(model.rings.map((x) => x.r)).toEqual([30, 60, 90, 120, 150])
    expect(model.rings.filter((x) => x.reference).map((x) => x.theta)).toEqual([0])
    expect(model.ring).toBe(30)
    expect(model.rings.every((x) => x.showLabel)).toBe(true)
    // Text too large for one ring spacing (narrow screens): only −2, 0 and +2 SD are labelled.
    const big = buildBlob(modelOf('m1').est, { layout: { fontSize: 36, compact: true } })
    expect(big.rings.filter((x) => x.showLabel).map((x) => x.label)).toEqual(['−2 SD', '0 SD', '+2 SD'])
  })

  it('hatches only measured tier (c) spokes, and glyphs follow the tier (§9.7)', () => {
    expect(modelOf('m1').model.hatch).toEqual([]) // EMO and CRE are not measured in M1
    const { model } = modelOf('full')
    expect(model.hatch.map((h) => h.id).sort()).toEqual(['CRE', 'EMO'])
    for (const s of model.spokes) expect(s.glyph).toBe({ a: '', b: '○', c: '◇' }[s.tier])
  })

  it('has one drill-down wedge per cluster, covering the circle in spoke order (§9.6, A7)', () => {
    const { est, model } = modelOf('m1')
    expect(model.wedges.map((w) => w.group).sort()).toEqual([...new Set(est.map((e) => e.cluster))].sort())
    expect(model.wedges).toHaveLength(8)
    expect(model.wedges.flatMap((w) => w.spokeIds).sort()).toEqual(est.map((e) => e.code).sort())
    for (const w of model.wedges) expect(w.d).toMatch(/^M0,0L.*Z$/)
  })

  it('carries nothing that sums or sizes the shape (§9.5 a)', () => {
    const { model } = modelOf('full')
    const keys = new Set<string>()
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (keys.add(k), walk(x))
    }
    walk(model)
    for (const k of keys) expect(k).not.toMatch(/area|total|sum|overall|average|mean|composite|score/i)
  })

  it('draws sector paths, including a full circle', () => {
    expect(sectorPath(0, Math.PI / 2, 10)).toBe('M0,0L0.00,-10.00A10,10 0 0,1 10.00,0.00Z')
    expect(sectorPath(0, 2 * Math.PI, 10)).toMatch(/A10,10 0 1,1 .*A10,10 0 1,1 .*Z$/)
    expect(() => buildBlob(axisEstimates(syntheticProfile('m1')!.input).slice(0, 2))).toThrow(RangeError)
  })
})

/** Short labels of random spokes: 1–3 words of 1–14 letters per line, 1–2 lines. */
const labelArb = fc.array(fc.array(fc.stringMatching(/^[A-Za-z&()]{1,14}$/), { minLength: 1, maxLength: 3 }).map((w) => w.join(' ')), { minLength: 1, maxLength: 2 })

function spokesArb(): fc.Arbitrary<SpokeEstimate[]> {
  return fc.array(
    fc.record({ label: labelArb, measured: fc.boolean(), theta: fc.double({ min: -3.5, max: 3.5, noNaN: true }), glyph: fc.constantFrom('', '○', '◇') }),
    { minLength: 3, maxLength: 24 },
  ).map((rows) =>
    rows.map((x, i): SpokeEstimate => ({
      id: `s${i}`,
      name: x.label.join(' '),
      shortLabel: x.label,
      group: `g${i % 3}`,
      tier: x.glyph === '◇' ? 'c' : x.glyph === '○' ? 'b' : 'a',
      glyph: x.glyph,
      ...(x.measured
        ? { measured: true, theta: x.theta, sd: 0.4, lo90: x.theta - 0.66, hi90: x.theta + 0.66, relation: 'overlaps' as const, muted: true }
        : { measured: false, reason: 'no_data' as const, muted: false }),
    })),
  )
}

describe('text layout (§13 legibility; M1.16 review)', () => {
  it('keeps every label and the ring note inside the viewBox, at any layout', () => {
    fc.assert(
      fc.property(spokesArb(), fc.double({ min: LABEL_FONT, max: MAX_LABEL_FONT, noNaN: true }), fc.boolean(), (spokes, fontSize, compact) => {
        const model = buildBlob(spokes, { layout: { fontSize, compact } })
        const vb = viewBoxOf(model)
        for (const b of [...model.labelBoxes, model.noteBox]) expect(within(b, vb)).toBe(true)
        // The circle (and the wedges, R + 4) too, centred horizontally.
        expect(within({ x0: -R - 4, x1: R + 4, y0: -R - 4, y1: R + 4 }, vb)).toBe(true)
        expect(Math.abs(vb.x0 + vb.x1)).toBeLessThanOrEqual(0.011)
      }),
      { numRuns: 150 },
    )
  })

  it('fits text to ≥ MIN_TEXT_PX without overlapping labels where it can, else the largest clear text', () => {
    const measures: TextMeasure[] = [estimateTextWidth, (t, size) => t.length * 0.5 * size]
    fc.assert(
      fc.property(spokesArb(), fc.integer({ min: 240, max: 1200 }), fc.constantFrom(...measures), (spokes, width, measure) => {
        const layout = fitLayout(spokes, width, { measure })
        const got = renderedSizes(spokes, width, layout, { measure })
        expect(layout.fontSize).toBeGreaterThanOrEqual(LABEL_FONT)
        expect(layout.fontSize).toBeLessThanOrEqual(MAX_LABEL_FONT)
        // Labels never overlap, unless they already do at the smallest size.
        if (layout.fontSize > LABEL_FONT) expect(got.collides).toBe(false)
        // The default wherever it already fits.
        const d = renderedSizes(spokes, width, DEFAULT_LAYOUT, { measure })
        if (d.smallPx >= MIN_TEXT_PX && !d.collides) expect(layout).toEqual(DEFAULT_LAYOUT)
        // Short of MIN_TEXT_PX only if no mode reaches it clear of overlaps at any size.
        if (got.smallPx < MIN_TEXT_PX - 1e-6) {
          for (const compact of [false, true]) {
            for (let f = LABEL_FONT; f <= MAX_LABEL_FONT; f += 2.5) {
              const r = renderedSizes(spokes, width, { fontSize: f, compact }, { measure })
              expect(r.smallPx >= MIN_TEXT_PX + 0.3 && !r.collides, `${compact} ${f}`).toBe(false)
            }
          }
        }
      }),
      { numRuns: 40 },
    )
  })

  it('gives the 17-spoke blob ≥ 11 px text, no overlaps and a usable circle on a 360–390 px phone', () => {
    for (const p of SYNTHETIC_PROFILES) {
      const { est } = modelOf(p.id)
      // With many skills not measured their labels give way to a list (D13 B): ≥ 11 px even at 320 px,
      // and the rings span ≥ 55% of the chart (VIS2-23). With every skill measured: ≥ 10 px at 320 px
      // (the compact labels are cuts of the table names, UX-042, a little longer than the old ones; D14).
      const bare = est.filter((e) => !e.measured).length >= STUB_LIST_MIN
      for (const [width, minPx, minCircle] of [
        [288, bare ? MIN_TEXT_PX : 10, bare ? 0.55 : 1 / 4],
        [328, MIN_TEXT_PX, bare ? 0.55 : 1 / 3],
        [358, MIN_TEXT_PX, bare ? 0.55 : 1 / 3],
      ] as const) {
        const layout = fitLayout(est, width)
        const { smallPx, rPx, collides } = renderedSizes(est, width, layout)
        expect(smallPx, `${p.id} ${width}`).toBeGreaterThanOrEqual(minPx - 1e-6)
        expect(collides, `${p.id} ${width}`).toBe(false)
        expect(2 * rPx, `${p.id} ${width}`).toBeGreaterThan(width * minCircle)
      }
    }
    const { est } = modelOf('m1')
    // At full width (40rem) the default text is already ≥ 11 px.
    expect(fitLayout(est, 640)).toEqual(DEFAULT_LAYOUT)
    // Unknown width (jsdom, before layout): the default.
    expect(fitLayout(est, 0)).toEqual(DEFAULT_LAYOUT)
    expect(fitLayout(est, Number.NaN)).toEqual(DEFAULT_LAYOUT)
  })

  it('scales the text sizes with the layout and exposes them to the chart', () => {
    const { est } = modelOf('m1')
    const a = buildBlob(est, { layout: { fontSize: 20, compact: false } })
    expect(a.text.label).toBe(20)
    expect(a.text.small).toBeLessThan(20)
    expect(a.text.halo).toBeGreaterThan(0)
    expect(() => buildBlob(est, { layout: { fontSize: 0, compact: false } })).toThrow(RangeError)
  })

  it('has one-line compact labels, wraps facet labels at spaces, keeps "not measured" whole, and places the glyph', () => {
    expect(wrapLine('Processing & Reading Speed')).toEqual(['Processing', '& Reading', 'Speed'])
    expect(wrapLine('Arts & Practical Knowledge')).toEqual(['Arts &', 'Practical', 'Knowledge'])
    expect(wrapLine('Comprehension')).toEqual(['Comprehension'])
    fc.assert(
      fc.property(fc.array(fc.stringMatching(/^[a-z]{1,15}$/), { minLength: 1, maxLength: 6 }), (words) => {
        const lines = wrapLine(words.join(' '))
        expect(lines.join(' ')).toBe(words.join(' '))
        for (const l of lines) if (l.includes(' ')) expect(l.length).toBeLessThanOrEqual(WRAP_CHARS)
      }),
    )
    const { est } = modelOf('m1')
    for (const e of est) {
      for (const compact of [false, true]) {
        const lines = spokeLines(e, compact)
        expect(lines.filter((l) => l.glyph)).toHaveLength(e.glyph ? 1 : 0)
        if (!e.measured) expect(lines.filter((l) => l.note).map((l) => l.text).join(' ')).toBe('not measured')
      }
    }
    expect('not measured'.length).toBeLessThanOrEqual(NOTE_WRAP_CHARS)
    const ps = est.find((e) => e.code === 'PS')!
    expect(spokeLines(ps, false)).toEqual([
      { text: 'Processing &', note: false, glyph: true },
      { text: 'Reading Speed', note: false, glyph: false },
    ])
    expect(spokeLines(ps, true)).toEqual([{ text: 'Processing', note: false, glyph: true }])
    // Every axis has a one-line compact label.
    for (const e of est) expect(spokeLines({ ...e, measured: true }, true).length, e.code).toBe(1)
    // Facet notes: "insufficient data" wraps in compact labels.
    const p = syntheticProfile('m1')!
    const qr = clusterFacets(p.input.score, p.facetObservations, 'Quantitative', { catalog: p.catalog, unmeasured: unmeasuredReasons(est) })
    const ratio = qr.find((f) => f.facet === 'quant/ratios_rates_averages')!
    expect(spokeLines(ratio, true).filter((l) => l.note).map((l) => l.text)).toEqual(['insufficient', 'data'])
    expect(spokeLines(ratio, false).filter((l) => l.note).map((l) => l.text)).toEqual(['insufficient data'])
  })
})

// ------------------------------------------------------- D13 B: narrow screens, many stubs

describe('on a narrow screen many not-measured spokes give their labels to a list (D13 B)', () => {
  const unmeasuredOf = (est: readonly SpokeEstimate[]): SpokeEstimate[] => est.filter((e) => !e.measured)

  it('drops the labels of the not-measured spokes and lists them, so the measured ones and the circle get the room', () => {
    // Narrower glyphs (as WebKit measures them) may let full labels fit: the list still replaces the stub labels.
    const narrowGlyphs: TextMeasure = (t, size) => t.length * 0.5 * size
    for (const measure of [estimateTextWidth, narrowGlyphs]) {
      const est = modelOf('m1').est
      expect(fitLayout(est, 358, { measure }).stubLabels).toBe('none')
      expect(fitLayout(est, 640, { measure }).stubLabels).toBeUndefined()
    }
    for (const id of ['m1', 'skipped', 'sparse', 'offscale']) {
      const { est } = modelOf(id)
      expect(unmeasuredOf(est).length, id).toBeGreaterThanOrEqual(STUB_LIST_MIN)
      for (const width of [288, 328, 358]) {
        const fit = fitLayoutDetailed(est, width)
        expect(fit.layout.stubLabels, `${id} ${width}`).toBe('none')
        expect(fit.legible, `${id} ${width}`).toBe(true)
        const got = renderedSizes(est, width, fit.layout)
        expect(got.smallPx, `${id} ${width}`).toBeGreaterThanOrEqual(MIN_TEXT_PX - 1e-6)
        expect(got.collides).toBe(false)
        expect((2 * got.rPx) / width, `${id} ${width}: rings across the chart`).toBeGreaterThanOrEqual(0.55)
        // Larger than with every spoke labelled at the same text size.
        const labelled = renderedSizes(est, width, { fontSize: fit.layout.fontSize, compact: fit.layout.compact })
        expect(got.rPx, `${id} ${width}`).toBeGreaterThan(labelled.rPx)
        const model = buildBlob(est, { layout: fit.layout })
        model.spokes.forEach((s, i) => expect(s.lines.length > 0, `${id} ${s.id}`).toBe(est[i]!.measured))
        expect(model.stubList).toEqual([{ lead: 'Not measured', names: unmeasuredOf(est).map((e) => e.name) }])
        // Every label still inside the viewBox; the circle too, though no longer centred.
        const vb = viewBoxOf(model)
        for (const b of [...model.labelBoxes, model.noteBox]) expect(within(b, vb)).toBe(true)
        expect(within({ x0: -R - 4, x1: R + 4, y0: -R - 4, y1: R + 4 }, vb)).toBe(true)
      }
    }
  })

  it('keeps every label at full width, with every spoke measured, and with fewer than five not measured', () => {
    for (const p of SYNTHETIC_PROFILES) {
      const { est, model } = modelOf(p.id)
      expect(fitLayout(est, 640).stubLabels, `${p.id} 640`).toBeUndefined()
      expect(model.stubList).toEqual([])
      expect(model.spokes.every((s) => s.lines.length > 0)).toBe(true)
    }
    const full = modelOf('full').est
    for (const width of [288, 328, 358]) expect(fitLayout(full, width).stubLabels, `full ${width}`).toBeUndefined()
    // Four not measured: under the threshold, so each keeps its label and its note.
    const four = full.map((e, i) => (i % 4 === 1 && i < 16 ? { ...e, measured: false, reason: 'no_data' as const, muted: false, theta: undefined, sd: undefined, lo90: undefined, hi90: undefined, relation: undefined, offScale: undefined } : e))
    expect(four.filter((e) => !e.measured)).toHaveLength(4)
    for (const width of [288, 358]) {
      const layout = fitLayout(four, width)
      expect(layout.stubLabels).toBeUndefined()
      expect(buildBlob(four, { layout }).stubList).toEqual([])
    }
  })

  it('a bare spoke has no label lines; a measured one keeps its own; the list groups by what the note would say', () => {
    const { est } = modelOf('m1')
    for (const e of est) {
      if (e.measured) expect(spokeLines(e, true, 'none')).toEqual(spokeLines(e, true))
      else expect(spokeLines(e, true, 'none')).toEqual([])
    }
    const facet = (i: number, reason: 'insufficient_data' | 'skipped'): SpokeEstimate => ({ id: `f${i}`, name: `Facet ${i}`, shortLabel: [`Facet ${i}`], group: 'g', tier: 'a', glyph: '', measured: false, reason, muted: false })
    const spokes = [spokeAt(0, 0.2), facet(1, 'insufficient_data'), facet(2, 'skipped'), facet(3, 'insufficient_data'), spokeAt(4, -0.3)]
    expect(stubList(spokes, { fontSize: 20, compact: true, stubLabels: 'none' })).toEqual([
      { lead: 'Insufficient data', names: ['Facet 1', 'Facet 3'] },
      { lead: 'Not measured', names: ['Facet 2'] },
    ])
    expect(stubList(spokes, { fontSize: 20, compact: true })).toEqual([])
  })

  it('property: with bare stubs every label box stays inside the viewBox and the circle with it', () => {
    fc.assert(
      fc.property(spokesArb(), fc.double({ min: LABEL_FONT, max: MAX_LABEL_FONT, noNaN: true }), (spokes, fontSize) => {
        const model = buildBlob(spokes, { layout: { fontSize, compact: true, stubLabels: 'none' } })
        const vb = viewBoxOf(model)
        for (const b of [...model.labelBoxes, model.noteBox]) expect(within(b, vb)).toBe(true)
        expect(within({ x0: -R - 4, x1: R + 4, y0: -R - 4, y1: R + 4 }, vb)).toBe(true)
        model.spokes.forEach((s, i) => expect(s.lines.length === 0).toBe(!spokes[i]!.measured))
      }),
      { numRuns: 100 },
    )
  })
})

// ----------------------------------------------------------------------------- UX-037: off scale

/** A measured spoke at θ ± sd, as `measuredFields` makes it. */
const spokeAt = (i: number, theta: number, sd = 0.4): SpokeEstimate => ({
  id: `s${i}`,
  name: `Skill ${i}`,
  shortLabel: [`Skill ${i}`],
  group: 'g',
  tier: 'a',
  glyph: '',
  ...measuredFields(theta, sd),
})

/** The first point of an arrowhead path ("M x,y L ..."), which is its tip. */
function arrowTip(d: string): [number, number] {
  const m = /^M(-?[\d.]+),(-?[\d.]+)L/.exec(d)!
  return [Number(m[1]), Number(m[2])]
}

describe('estimates beyond the scale get an arrowhead, never the stub (UX-037, §9.1, §9.7)', () => {
  it('names the end: below the inner clamp is low, above +3 SD is high, else none; the clamp is where the radius stops being linear', () => {
    expect(THETA_CLAMP_LOW).toBeCloseTo(-2.76, 12)
    expect(offScaleOf(-3)).toBe('low')
    expect(offScaleOf(THETA_CLAMP_LOW - 1e-6)).toBe('low')
    expect(offScaleOf(THETA_CLAMP_LOW)).toBe('none')
    expect(offScaleOf(3)).toBe('none')
    expect(offScaleOf(3.01)).toBe('high')
    expect(() => offScaleOf(Number.NaN)).toThrow(RangeError)
  })

  it('property: θ below the clamp is "low" with the marker and the arrow tip on the inner clamp; θ above +3 is "high" on the rim; in between the marker is at R(θ + 3)/6', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -6, max: 6, noNaN: true }), { minLength: 3, maxLength: 17 }), (thetas) => {
        const spokes = thetas.map((t, i) => spokeAt(i, t))
        const model = buildBlob(spokes)
        model.spokes.forEach((s, i) => {
          const theta = thetas[i]!
          expect(s.stub, 'a measured spoke is never drawn as a stub').toBeUndefined()
          expect(s.gap).toBeUndefined()
          if (theta < THETA_CLAMP_LOW) {
            expect(s.offScale).toBe('low')
            expect(Math.hypot(...s.marker!)).toBeCloseTo(R_MIN_FRACTION * R, 6)
            expect(Math.hypot(...arrowTip(s.arrow!))).toBeCloseTo(R_MIN_FRACTION * R, 1)
          } else if (theta > 3) {
            expect(s.offScale).toBe('high')
            expect(Math.hypot(...s.marker!)).toBeCloseTo(R, 6)
            expect(Math.hypot(...arrowTip(s.arrow!))).toBeCloseTo(R, 1)
          } else {
            expect(s.offScale).toBeUndefined()
            expect(s.arrow).toBeUndefined()
            // Radius stays linear in θ (§9.1): the arrow is an extra mark, never a change of the scale.
            expect(Math.abs(Math.hypot(...s.marker!) - (R * (theta + 3)) / 6)).toBeLessThan(0.15)
          }
        })
      }),
      { numRuns: 120 },
    )
  })

  it('points off the scale along its spoke: towards the centre when low, outward when high, ARROW_LENGTH long', () => {
    const model = buildBlob([spokeAt(0, -5), spokeAt(1, 4.5), spokeAt(2, 0.2), spokeAt(3, -4)])
    const [low, high] = [model.spokes[0]!, model.spokes[1]!]
    const lowTip = Math.hypot(...arrowTip(low.arrow!))
    const lowBase = [...low.arrow!.matchAll(/L(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Math.hypot(Number(m[1]), Number(m[2])))
    for (const b of lowBase) expect(b).toBeGreaterThan(lowTip) // the body is further out than the tip: it points inward
    const highTip = Math.hypot(...arrowTip(high.arrow!))
    const highBase = [...high.arrow!.matchAll(/L(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Math.hypot(Number(m[1]), Number(m[2])))
    for (const b of highBase) expect(b).toBeLessThan(highTip) // pointing outward
    expect(highTip - Math.min(...highBase)).toBeLessThanOrEqual(ARROW_LENGTH + 6)
  })

  it('keeps whatever part of the whisker lies inside the scale, and the stub for a spoke that is not measured', () => {
    // θ = −3.1 ± 0.5: the 90% range reaches up to −2.28, inside the scale.
    const model = buildBlob([spokeAt(0, -3.1, 0.5), spokeAt(1, 0.2), spokeAt(2, 0.4)])
    const w = model.spokes[0]!.whisker!
    expect(Math.hypot(...w[0])).toBeCloseTo(R_MIN_FRACTION * R, 6)
    expect(Math.hypot(...w[1])).toBeGreaterThan(R_MIN_FRACTION * R + 2)
    const stub = buildBlob([spokeAt(0, -5), { ...spokeAt(1, 0), measured: false, reason: 'no_data' as const, muted: false, theta: undefined, sd: undefined, lo90: undefined, hi90: undefined, relation: undefined, offScale: undefined }, spokeAt(2, 0.4)])
    expect(stub.spokes[1]!.stub).toBeDefined()
    expect(stub.spokes[1]!.arrow).toBeUndefined()
    expect(stub.spokes[0]!.stub).toBeUndefined()
  })

  it('says "off scale" under the label, as a stub says "not measured", and not for in-range spokes', () => {
    const model = buildBlob([spokeAt(0, -4), spokeAt(1, 0.1), spokeAt(2, 3.5)])
    expect(model.spokes[0]!.lines.at(-1)).toEqual({ text: 'off scale', note: true, glyph: false })
    expect(model.spokes[1]!.lines.every((l) => !l.note)).toBe(true)
    expect(model.spokes[2]!.lines.at(-1)).toMatchObject({ text: 'off scale', note: true })
    // A frame's own mark can be overridden with the final one (the reveal's build-up).
    expect(buildBlob([{ ...spokeAt(0, -4), offScale: 'none' }, spokeAt(1, 0.1), spokeAt(2, 0.3)]).spokes[0]!.arrow).toBeUndefined()
  })

  it('measuredFields records where the estimate lies against the scale', () => {
    expect(measuredFields(-3.4, 0.3).offScale).toBe('low')
    expect(measuredFields(0, 0.3).offScale).toBe('none')
    expect(measuredFields(3.2, 0.3).offScale).toBe('high')
  })
})

// ------------------------------------------------------------------------ UX-042: label names

/** Do two label boxes come closer than `gap` vertically while overlapping sideways? Boxes as {@link Box}. */
function boxesTouch(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
}

describe('the narrow-screen labels match the table names (UX-042)', () => {
  const names: Record<string, string> = Object.fromEntries(axisEstimates(syntheticProfile('m1')!.input).map((e) => [e.code, e.name]))
  /** Abbreviations that are a documented cut of a longer word of the table name ("comp." of Comprehension). */
  const ABBREVIATIONS: Record<string, string> = { 'comp.': 'comprehension', 'mem.': 'memory' }

  it('every compact label is made of words of its table name, in order, or a documented abbreviation of one', () => {
    for (const [code, label] of Object.entries(COMPACT_LABELS)) {
      const nameWords = names[code]!.toLowerCase().replace(/[^a-z& ]/g, ' ').split(/\s+/).filter(Boolean)
      const first = label.toLowerCase().split(/\s+/)[0]!
      const expanded = ABBREVIATIONS[first] ?? first
      expect(nameWords.some((w) => w === expanded || w.startsWith(expanded.replace(/\.$/, ''))), `${code}: "${label}" of "${names[code]}"`).toBe(true)
    }
  })

  it('no two compact labels start with the same word or read as one with a cluster name', () => {
    const labels = Object.values(COMPACT_LABELS)
    const heads = labels.map((l) => l.toLowerCase().split(/\s+/)[0]!)
    expect(new Set(heads).size).toBe(heads.length)
    // A label never repeats one of the eight cluster names that sit beside it ("Estimation", "Speed").
    for (const cluster of ['Reasoning', 'Verbal', 'Knowledge', 'Spatial/Memory', 'Social-Creative', 'Speed', 'Estimation', 'Quantitative']) {
      if (cluster === 'Quantitative' || cluster === 'Spatial/Memory') continue // those two are also skill names on purpose
      expect(labels, cluster).not.toContain(cluster)
    }
    expect(COMPACT_LABELS.FER).not.toBe('Estimation')
    expect(COMPACT_LABELS.PS).not.toBe('Speed')
  })

  it('property: at 288 and 358 px, with any mix of measured and not-measured skills, no two label boxes (notes included) touch', () => {
    const full = axisEstimates(syntheticProfile('full')!.input)
    const stub = (e: AxisEstimate): AxisEstimate => ({ ...e, measured: false, reason: 'no_data', muted: false, theta: undefined, sd: undefined, lo90: undefined, hi90: undefined, relation: undefined, offScale: undefined })
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 17, maxLength: 17 }), fc.constantFrom(288, 358), (mask, width) => {
        const est = full.map((e, i) => (mask[i] ? e : stub(e)))
        const layout = fitLayout(est, width)
        const got = renderedSizes(est, width, layout)
        expect(got.collides, `${width}px ${mask.map(Number).join('')}`).toBe(false)
        // The same through the model's own boxes: a label's whole box, note line included, with a clear gap to the next.
        const model = buildBlob(est, { layout })
        for (let i = 0; i < model.labelBoxes.length; i++) {
          for (let j = i + 1; j < model.labelBoxes.length; j++) {
            const a = model.labelBoxes[i]!
            const b = model.labelBoxes[j]!
            // The model's boxes include the halo, so a gap of 0 here is a gap of the halo between the glyphs.
            expect(boxesTouch({ ...a, x0: a.x0 + model.text.halo, x1: a.x1 - model.text.halo, y0: a.y0 + model.text.halo, y1: a.y1 - model.text.halo }, { ...b, x0: b.x0 + model.text.halo, x1: b.x1 - model.text.halo, y0: b.y0 + model.text.halo, y1: b.y1 - model.text.halo }), `${est[i]!.code} / ${est[j]!.code}`).toBe(false)
          }
        }
      }),
      { numRuns: 40 },
    )
  })
})

// ------------------------------------------------------------------------ UX-044: text size

describe('chart text follows the page text size (UX-044)', () => {
  const { est } = modelOf('m1')

  it('textScale is 1 at the default and below, the ratio above, capped at 4', () => {
    expect([textScale(undefined), textScale(16), textScale(12), textScale(Number.NaN)]).toEqual([1, 1, 1, 1])
    expect(textScale(32)).toBe(2)
    expect(textScale(100)).toBe(4)
    expect(defaultLayout(1)).toBe(DEFAULT_LAYOUT)
    expect(defaultLayout(2).fontSize).toBe(2 * LABEL_FONT)
  })

  it('at 200% text the labels render at least twice as large as at 100%, or the fit reports that it cannot', () => {
    for (const width of [358, 640, 900, 1200]) {
      const base = fitLayoutDetailed(est, width, { rootPx: 16 })
      const big = fitLayoutDetailed(est, width, { rootPx: 32 })
      expect(base.legible).toBe(true)
      // Rendered label size: the label font in user units × the screen scale of that layout.
      const labelPx = (fit: typeof base, rootPx: number): number => (renderedSizes(est, width, fit.layout, { rootPx }).smallPx / 0.88)
      if (big.legible) expect(labelPx(big, 32), `${width}px`).toBeGreaterThanOrEqual(2 * MIN_TEXT_PX / 0.88 - 1e-6)
      else expect(big.smallPx, `${width}px`).toBeLessThan(2 * MIN_TEXT_PX)
      if (width >= 900) expect(big.legible, `${width}px has room for large text`).toBe(true)
      expect(big.smallPx).toBeGreaterThanOrEqual(base.smallPx - 1e-6)
    }
    // A phone cannot hold 17 labels at 200%: it says so (and the page points to the bar view).
    expect(fitLayoutDetailed(est, 358, { rootPx: 32 }).legible).toBe(false)
  })

  it('does not change anything at the default size or when the width is unknown', () => {
    expect(fitLayoutDetailed(est, 640).layout).toEqual(DEFAULT_LAYOUT)
    expect(fitLayoutDetailed(est, 640, { rootPx: 16 })).toEqual(fitLayoutDetailed(est, 640))
    expect(fitLayout(est, 0, { rootPx: 32 })).toEqual(defaultLayout(2))
    expect(fitLayoutDetailed(est, 0, { rootPx: 32 }).legible).toBe(true)
  })

  it('property: a larger root size never gives smaller chart text', () => {
    fc.assert(
      fc.property(fc.integer({ min: 288, max: 1200 }), fc.constantFrom(16, 20, 24, 32), (width, rootPx) => {
        const a = fitLayoutDetailed(est, width, { rootPx: 16 })
        const b = fitLayoutDetailed(est, width, { rootPx })
        // A little slack: the best-effort fit walks font sizes in steps.
        expect(b.smallPx).toBeGreaterThanOrEqual(a.smallPx - 0.05)
      }),
      { numRuns: 40 },
    )
  })
})

// ---------------------------------------------------------------- card options of the model

describe('model options for the card (UX-038)', () => {
  const { est } = modelOf('m1')
  const shown = est.filter((e) => e.measured)

  it('can leave the in-chart ring note out (the card sets it in its own text), and then the viewBox does not hold it', () => {
    const withNote = buildBlob(shown)
    const without = buildBlob(shown, { note: false })
    expect(withNote.showNote).toBe(true)
    expect(without.showNote).toBe(false)
    const h = (m: BlobModel): number => Number(m.viewBox.split(' ')[3])
    expect(h(without)).toBeLessThan(h(withNote))
    expect(within(without.noteBox, viewBoxOf(without))).toBe(true)
  })

  it('can label only −2, 0 and +2 SD whatever the size', () => {
    expect(buildBlob(shown).rings.filter((x) => x.showLabel)).toHaveLength(5)
    expect(buildBlob(shown, { ringStep: 2 }).rings.filter((x) => x.showLabel).map((x) => x.label)).toEqual(['−2 SD', '0 SD', '+2 SD'])
  })
})
