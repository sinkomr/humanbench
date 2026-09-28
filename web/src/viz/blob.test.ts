import { describe, expect, it } from 'vitest'
import { OVERSHOOT_LIMIT_RINGS } from './curve'
import { buildBlob, DEFAULT_R, sectorPath, type BlobModel } from './blob'
import { R_MIN_FRACTION, radiusScale, spokeAngle } from './geometry'
import { axisEstimates, axisSamples, N_FUZZ, type AxisEstimate } from './profile'
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
          expect(s.lines.at(-1)).toBe('not measured')
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

  it('rings sit at −2 … +2 SD, labelled in SD units, the 0 SD ring the dashed reference (A12)', () => {
    const { model } = modelOf('m1')
    expect(model.rings.map((x) => x.label)).toEqual(['−2 SD', '−1 SD', '0 SD', '+1 SD', '+2 SD'])
    expect(model.rings.map((x) => x.r)).toEqual([30, 60, 90, 120, 150])
    expect(model.rings.filter((x) => x.reference).map((x) => x.theta)).toEqual([0])
    expect(model.ring).toBe(30)
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
