/** The Fermi render spec and the entry's check (ROADMAP M5.1). */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ENTRY_NOTES, MAGNITUDE_NOTES } from './copy'
import { parseFermiResponse } from './scoring'
import { checkEntry, specProblems, type EntryFields, type FermiSpec } from './spec'

const SPEC: FermiSpec = { stem: 'About how many seconds are there in 3 weeks?', dimension: 'time', units: ['s', 'min', 'h', 'day'], interval_pct: 80 }
const fields = (over: Partial<EntryFields> = {}): EntryFields => ({ value: '1.8e6', low: '1e6', high: '3e6', unit: 's', ...over })

describe('specProblems', () => {
  it('accepts a good spec', () => {
    expect(specProblems(SPEC)).toEqual([])
    expect(specProblems({ ...SPEC, units: ['count'], dimension: 'count' })).toEqual([])
  })

  it.each([
    ['an empty stem', { ...SPEC, stem: ' ' }, /stem/],
    ['another coverage', { ...SPEC, interval_pct: 90 as unknown as 80 }, /interval_pct/],
    ['an unknown dimension', { ...SPEC, dimension: 'weight' }, /unknown dimension/],
    ['no units', { ...SPEC, units: [] }, /at least one unit/],
    ['repeated units', { ...SPEC, units: ['s', 's'] }, /distinct/],
    ['a unit of another dimension', { ...SPEC, units: ['s', 'm'] }, /not a time unit/],
  ])('refuses %s', (_name, spec, message) => {
    expect(specProblems(spec).join('; ')).toMatch(message)
  })
})

describe('checkEntry', () => {
  it('turns typed fields into the response', () => {
    const r = checkEntry(SPEC, fields())
    expect(r).toEqual({ ok: true, response: { value: 1.8e6, unit: 's', low: 1e6, high: 3e6 } })
  })

  it('reads the unit as chosen (the same number in minutes is another answer)', () => {
    const r = checkEntry(SPEC, fields({ unit: 'min' }))
    expect(r.ok && r.response.unit).toBe('min')
  })

  it('accepts a point range and the guess at either end', () => {
    expect(checkEntry(SPEC, fields({ value: '5', low: '5', high: '5' })).ok).toBe(true)
    expect(checkEntry(SPEC, fields({ value: '1e6', low: '1e6', high: '3e6' })).ok).toBe(true)
    expect(checkEntry(SPEC, fields({ value: '3e6' })).ok).toBe(true)
  })

  it('says what to fix in each field, in neutral words', () => {
    const r = checkEntry(SPEC, { value: '', low: '-1', high: '5 km', unit: '' })
    expect(r).toEqual({
      ok: false,
      errors: { value: MAGNITUDE_NOTES.empty, low: MAGNITUDE_NOTES.negative, high: MAGNITUDE_NOTES.has_unit, unit: ENTRY_NOTES.unit },
    })
  })

  it('refuses a unit that is not on offer, even a real one', () => {
    for (const unit of ['', 'm', 'week', 'furlong']) expect(checkEntry(SPEC, fields({ unit })).ok).toBe(false)
  })

  it('wants low ≤ guess ≤ high', () => {
    for (const bad of [{ low: '2e6' }, { high: '1e6' }, { low: '4e6', high: '5e6' }]) {
      expect(checkEntry(SPEC, fields(bad))).toEqual({ ok: false, errors: { range: ENTRY_NOTES.order } })
    }
  })

  it('refuses a range wider than the limit', () => {
    expect(checkEntry(SPEC, fields({ value: '1', low: '1e-5', high: '1e5' }))).toEqual({ ok: false, errors: { range: ENTRY_NOTES.tooWide } })
  })

  it('only ever returns a response parseFermiResponse accepts (property over typed text)', () => {
    const num = fc.oneof(fc.double({ min: 1e-6, max: 1e9, noNaN: true }).map(String), fc.constantFrom('', '0', '-3', '2,5', '3 km', 'abc', '1e40', '3.2 × 10^6'))
    fc.assert(
      fc.property(num, num, num, fc.constantFrom('', 's', 'min', 'h', 'day', 'm'), (value, low, high, unit) => {
        const r = checkEntry(SPEC, { value, low, high, unit })
        if (r.ok) expect(parseFermiResponse({ ...r.response })).toEqual(r.response)
        else expect(Object.values(r.errors).every((m) => typeof m === 'string' && m.length > 0)).toBe(true)
      }),
      { numRuns: 400 },
    )
  })
})
