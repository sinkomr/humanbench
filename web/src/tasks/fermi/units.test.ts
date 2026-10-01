/**
 * The Fermi unit registry (ROADMAP M5.1): the TS table is exactly the bank's (`golden/fermi_scoring_v1.json`,
 * A17), conversions are done in log space, and unknown units or cross-dimension conversions are refused.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import golden from '../../engine/__fixtures__/fermi_scoring_v1.json'
import { DIMENSIONS, UNITS, UNITS_VERSION, UnitError, isUnit, log10Between, unitOf, unitsOf } from './units'

describe('the registry matches the bank', () => {
  it('lists the same units, in the same order, with the same factors and labels', () => {
    expect(UNITS_VERSION).toBe(golden.units_version)
    expect(UNITS.map((u) => ({ ...u }))).toEqual(golden.units)
  })

  it('has unique symbols and one unit of factor 1 per dimension', () => {
    expect(new Set(UNITS.map((u) => u.symbol)).size).toBe(UNITS.length)
    for (const d of DIMENSIONS) {
      expect(unitsOf(d).filter((u) => u.factor === 1)).toHaveLength(1)
      expect(unitsOf(d).length).toBeGreaterThanOrEqual(3)
    }
    expect(DIMENSIONS).toEqual(expect.arrayContaining(['time', 'length', 'mass', 'area', 'volume', 'speed', 'count', 'usd']))
  })

  it('is frozen', () => {
    expect(Object.isFrozen(UNITS)).toBe(true)
    expect(Object.isFrozen(UNITS[0])).toBe(true)
  })
})

describe('conversions', () => {
  it.each([
    [1, 'min', 's', 60],
    [1, 'year', 'day', 365.25],
    [1, 'km', 'm', 1000],
    [1, 'mi', 'km', 1.609344],
    [1, 'km/h', 'm/s', 5 / 18],
    [100, 'mph', 'm/s', 44.704],
    [7, 'billion', 'million', 7000],
    [5, 'pct', 'frac', 0.05],
  ])('%d %s is %d... %s', (value, from, to, expected) => {
    expect(10 ** log10Between(value, from, to)).toBeCloseTo(expected, 9)
  })

  it('matches every converted pair of the golden file', () => {
    for (const row of golden.convert) expect(log10Between(row.value, row.from, row.to)).toBeCloseTo(row.log10, 12)
  })

  it('refuses unknown units, other dimensions and bad values', () => {
    expect(() => unitOf('furlong')).toThrow(UnitError)
    expect(() => unitOf(5 as unknown as string)).toThrow(UnitError)
    expect(() => unitsOf('temperature')).toThrow(UnitError)
    expect(() => log10Between(1, 's', 'm')).toThrow(/cannot convert/)
    for (const bad of [0, -1, Infinity, NaN, '3' as unknown as number]) expect(() => log10Between(bad, 's', 'min')).toThrow(RangeError)
    expect(isUnit('km')).toBe(true)
    expect(isUnit('furlong')).toBe(false)
    expect(isUnit(3)).toBe(false)
  })

  it('round-trips and composes (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...DIMENSIONS), fc.double({ min: -20, max: 20, noNaN: true }), fc.nat(), fc.nat(), fc.nat(), (dim, logV, i, j, k) => {
        const syms = unitsOf(dim).map((u) => u.symbol)
        const a = syms[i % syms.length] as string
        const b = syms[j % syms.length] as string
        const c = syms[k % syms.length] as string
        const v = 10 ** logV
        const ab = log10Between(v, a, b)
        expect(log10Between(10 ** ab, b, a)).toBeCloseTo(logV, 8)
        expect(log10Between(10 ** ab, b, c)).toBeCloseTo(log10Between(v, a, c), 8)
      }),
    )
  })
})
