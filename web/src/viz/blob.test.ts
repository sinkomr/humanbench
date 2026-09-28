import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { AXIS_INDEX } from '../engine/axes'
import { OVERSHOOT_LIMIT_RINGS } from './curve'
import {
  buildBlob,
  DEFAULT_LAYOUT,
  DEFAULT_R,
  estimateTextWidth,
  fitLayout,
  LABEL_FONT,
  MAX_LABEL_FONT,
  MIN_TEXT_PX,
  NOTE_WRAP_CHARS,
  renderedSizes,
  sectorPath,
  spokeLines,
  WRAP_CHARS,
  wrapLine,
  type BlobModel,
  type Box,
  type TextMeasure,
} from './blob'
import { clusterFacets, unmeasuredReasons } from './facets'
import { R_MIN_FRACTION, radiusScale, spokeAngle } from './geometry'
import { axisEstimates, axisSamples, DEFAULT_FUZZ_SEED, N_FUZZ, posteriorSamples, type AxisEstimate, type SpokeEstimate } from './profile'
import { syntheticProfile, SYNTHETIC_PROFILES } from './synthetic'

function modelOf(id: string): { est: AxisEstimate[]; model: BlobModel } {
  const p = syntheticProfile(id)!
  const est = axisEstimates(p.input)
  return { est, model: buildBlob(est, axisSamples(p.input, est)) }
}

/** The on-curve points of path data (the endpoint of each C segment). */
function curveEnds(d: string): [number, number][] {
  return [...d.matchAll(/C[-\d.]+,[-\d.]+ [-\d.]+,[-\d.]+ (-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])])
}

const R = DEFAULT_R
const r = radiusScale(R)

/** Radius of a closed curve at each spoke (from its on-curve points), by spoke index. */
function radiiAtSpokes(d: string, k: number): Map<number, number> {
  const out = new Map<number, number>()
  for (const [x, y] of curveEnds(d)) {
    const ang = (Math.atan2(x, -y) + 2 * Math.PI) % (2 * Math.PI)
    out.set(Math.round((ang / (2 * Math.PI)) * k) % k, Math.hypot(x, y))
  }
  return out
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
  it('draws all 17 spokes; unmeasured ones as dashed stubs with a gap marker, never interpolated (§9.7, A15)', () => {
    for (const p of SYNTHETIC_PROFILES) {
      const { est, model } = modelOf(p.id)
      expect(model.spokes).toHaveLength(17)
      model.spokes.forEach((s, i) => {
        expect(s.angle).toBeCloseTo(spokeAngle(i, 17), 12)
        if (est[i]!.measured) {
          expect(s.marker && s.whisker).toBeTruthy()
          expect(s.stub).toBeUndefined()
        } else {
          expect(s.marker).toBeUndefined()
          expect(s.stub && s.gap).toBeTruthy()
          expect(Math.hypot(...s.gap!)).toBeCloseTo(R_MIN_FRACTION * R, 9)
          expect(s.lines.at(-1)).toEqual({ text: 'not measured', note: true, glyph: false })
        }
      })
    }
  })

  it('every curve dips to the inner clamp at an unmeasured spoke and passes through r(θ) at a measured one', () => {
    const { est, model } = modelOf('m1')
    const ends = curveEnds(model.crisp.d)
    expect(ends).toHaveLength(17)
    for (const [x, y] of ends) {
      const rad = Math.hypot(x, y)
      const ang = (Math.atan2(x, -y) + 2 * Math.PI) % (2 * Math.PI)
      const i = Math.round((ang / (2 * Math.PI)) * 17) % 17
      const e = est[i]!
      expect(rad).toBeCloseTo(e.measured ? r(e.theta!) : R_MIN_FRACTION * R, 1)
    }
    for (const c of [model.crisp, model.band.outer, model.band.inner, ...model.fuzz]) {
      for (const [x, y] of curveEnds(c.d)) {
        const ang = (Math.atan2(x, -y) + 2 * Math.PI) % (2 * Math.PI)
        const i = Math.round((ang / (2 * Math.PI)) * 17) % 17
        if (!est[i]!.measured) expect(Math.hypot(x, y)).toBeCloseTo(R_MIN_FRACTION * R, 1)
      }
    }
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
      const { model } = modelOf(p.id)
      expect(model.fuzz).toHaveLength(N_FUZZ)
      for (const c of [model.crisp, model.band.outer, model.band.inner, ...model.fuzz]) {
        expect(c.overshootRings).toBeLessThanOrEqual(OVERSHOOT_LIMIT_RINGS)
        expect(c.d).toMatch(/^M.*Z$/)
      }
      expect(model.band.d).toBe(model.band.outer.d + model.band.inner.d)
      expect(new Set(model.fuzz.map((c) => c.d)).size).toBe(N_FUZZ)
    }
  })

  it('draws each fuzz curve through the posterior draw of its own axis at every measured spoke (§9.3)', () => {
    for (const id of ['full', 'm1']) {
      const p = syntheticProfile(id)!
      const { est, model } = modelOf(id)
      // The joint draws in canonical axis order; spoke i must show the column of its axis.
      const draws = posteriorSamples(p.input.score.theta, p.input.score.cov, N_FUZZ, DEFAULT_FUZZ_SEED)
      model.fuzz.forEach((c, s) => {
        const radii = radiiAtSpokes(c.d, 17)
        est.forEach((e, i) => {
          const want = e.measured ? r(draws[s]![AXIS_INDEX[e.code]]!) : R_MIN_FRACTION * R
          expect(radii.get(i), `${id} draw ${s} spoke ${e.code}`).toBeCloseTo(want, 1)
        })
      })
    }
  })

  it('bounds the ±1 SD band by r(θ + SD) outside and r(θ − SD) inside (§9.3)', () => {
    for (const p of SYNTHETIC_PROFILES) {
      const { est, model } = modelOf(p.id)
      const outer = radiiAtSpokes(model.band.outer.d, 17)
      const inner = radiiAtSpokes(model.band.inner.d, 17)
      est.forEach((e, i) => {
        expect(outer.get(i), `${p.id} ${e.code} outer`).toBeCloseTo(e.measured ? r(e.theta! + e.sd!) : R_MIN_FRACTION * R, 1)
        expect(inner.get(i), `${p.id} ${e.code} inner`).toBeCloseTo(e.measured ? r(e.theta! - e.sd!) : R_MIN_FRACTION * R, 1)
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
    const big = buildBlob(modelOf('m1').est, [], { layout: { fontSize: 36, compact: true } })
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
    expect(() => buildBlob(axisEstimates(syntheticProfile('m1')!.input).slice(0, 2), [])).toThrow(RangeError)
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
        const model = buildBlob(spokes, [], { layout: { fontSize, compact } })
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
      // The chart's width on 360 and 390 px phones (1 rem page margins), and at 320 px (≥ 10 px).
      for (const [width, minPx, minCircle] of [
        [288, 10, 1 / 4],
        [328, MIN_TEXT_PX, 1 / 3],
        [358, MIN_TEXT_PX, 1 / 3],
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
    const a = buildBlob(est, [], { layout: { fontSize: 20, compact: false } })
    expect(a.text.label).toBe(20)
    expect(a.text.small).toBeLessThan(20)
    expect(a.text.halo).toBeGreaterThan(0)
    expect(() => buildBlob(est, [], { layout: { fontSize: 0, compact: false } })).toThrow(RangeError)
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
    expect(spokeLines(ps, true)).toEqual([{ text: 'Speed', note: false, glyph: true }])
    // Every axis has a one-line compact label.
    for (const e of est) expect(spokeLines({ ...e, measured: true }, true).length, e.code).toBe(1)
    // Facet notes: "insufficient data" wraps in compact labels.
    const p = syntheticProfile('m1')!
    const qr = clusterFacets(p.input.score, p.facetObservations, 'Quantitative', { catalog: p.catalog, unmeasured: unmeasuredReasons(est) })
    const ratio = qr.find((f) => f.facet === 'ratio')!
    expect(spokeLines(ratio, true).filter((l) => l.note).map((l) => l.text)).toEqual(['insufficient', 'data'])
    expect(spokeLines(ratio, false).filter((l) => l.note).map((l) => l.text)).toEqual(['insufficient data'])
  })
})
