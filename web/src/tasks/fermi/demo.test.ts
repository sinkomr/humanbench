/** The synthetic demo Fermi item (ROADMAP M5.1, A6): seeded, exact, and never a bank item. */

import { describe, expect, it } from 'vitest'
import { parseItemId } from '../ids'
import { demoFermiItem } from './demo'
import { formatMagnitude } from './magnitude'
import { parseFermiResponse, parseTrueValue, scoreFermi } from './scoring'
import { specProblems } from './spec'
import { log10Between, unitOf, unitsOf } from './units'

const SEEDS = Array.from({ length: 300 }, (_v, i) => i)

describe('demoFermiItem', () => {
  it('is the same question for the same seed, and varies with it', () => {
    expect(demoFermiItem(7)).toEqual(demoFermiItem(7))
    expect(demoFermiItem('7')).toEqual(demoFermiItem(7))
    expect(new Set(SEEDS.map((s) => demoFermiItem(s).spec.stem)).size).toBeGreaterThan(60)
    expect(new Set(SEEDS.map((s) => demoFermiItem(s).spec.dimension))).toEqual(new Set(['time', 'length', 'mass']))
  })

  it('has a renderable spec, an exact valid truth and a plain explanation', () => {
    for (const seed of SEEDS) {
      const item = demoFermiItem(seed)
      expect(specProblems(item.spec), String(seed)).toEqual([])
      expect(item.truth.true_value_uncertainty_log10).toBe(0)
      expect(parseTrueValue(item.truth.true_value)).toBeGreaterThan(0)
      expect(unitOf(item.truth.unit).dimension).toBe(item.spec.dimension)
      expect(item.explanation).toContain(unitOf(item.truth.unit).label)
    }
  })

  it('is never a bank item: its id is not an A11 id, so it cannot be served or scored as one', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const id = demoFermiItem(seed).item_id
      expect(id).toBe(`demo:fermi:${seed}`)
      expect(parseItemId(id)).toBeNull()
    }
  })

  it('offers the unit the answer is exact in, and never the unit the question counts in', () => {
    for (const seed of SEEDS) {
      const item = demoFermiItem(seed)
      expect(item.spec.units).toContain(item.truth.unit)
      expect(item.spec.units.length).toBeGreaterThanOrEqual(3)
      const asked = unitsOf(item.spec.dimension).filter((u) => item.spec.stem.includes(` ${u.label}?`) || item.spec.stem.includes(` ${u.label} (`))
      for (const u of asked) if (u.symbol !== item.truth.unit) expect(item.spec.units, item.spec.stem).not.toContain(u.symbol)
    }
  })

  it('scores the exact answer, typed in any offered unit, as no error and a hit', () => {
    const truth = (seed: number) => demoFermiItem(seed).truth
    for (const seed of SEEDS) {
      const item = demoFermiItem(seed)
      const t = truth(seed)
      for (const unit of item.spec.units) {
        const v = 10 ** log10Between(parseTrueValue(t.true_value), t.unit, unit)
        const s = scoreFermi(parseFermiResponse({ value: v, unit, low: v * 0.8, high: v * 1.25 }), t)
        expect(s.abs_error_dex, `${seed} ${unit}`).toBeLessThan(1e-9)
        expect(s.hit).toBe(true)
        expect(s.weight).toBe(1)
      }
    }
  })

  it('keeps the truth out of the spec: the answer is in no offered text, in any unit', () => {
    for (const seed of SEEDS) {
      const item = demoFermiItem(seed)
      const text = JSON.stringify(item.spec)
      const v = parseTrueValue(item.truth.true_value)
      for (const u of unitsOf(item.spec.dimension)) {
        const w = 10 ** log10Between(v, item.truth.unit, u.symbol)
        for (const form of [String(w), formatMagnitude(w), w.toLocaleString('en-US')]) {
          if (form.replace(/\D/g, '').length >= 3) expect(text.includes(form), `${seed}: ${form}`).toBe(false)
        }
      }
    }
  })
})
