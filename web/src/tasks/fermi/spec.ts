/**
 * The render payload of a Fermi item and the entry's check (ROADMAP M5.1; DESIGN §4.2 "Fermi truth
 * values", §12). The spec is what the server sends (`items.payload`: the stem and the `media` of the
 * bank's `FermiMedia`); the truth is never in it. {@link checkEntry} turns what a person typed into the
 * {@link FermiResponse} that `scoring.ts` scores, or says what to fix, in the neutral wording of
 * `copy.ts`.
 */

import { ENTRY_NOTES, MAGNITUDE_NOTES } from './copy'
import { parseMagnitude } from './magnitude'
import { MAX_INTERVAL_DEX, parseFermiResponse, type FermiResponse } from './scoring'
import { isUnit, unitOf, unitsOf } from './units'

/** The media renderer name of a Fermi item (`hb.fermi.truth.RENDERER`). */
export const FERMI_RENDERER = 'fermi_v1'

/** What the renderer is given: the question and the entry's shape. */
export interface FermiSpec {
  readonly stem: string
  /** One of the unit dimensions (`units.ts`). */
  readonly dimension: string
  /** The unit symbols the picker offers, in order; all of `dimension`. */
  readonly units: readonly string[]
  /** The interval's coverage, always 80. */
  readonly interval_pct: 80
}

/** Why a spec cannot be rendered (empty = fine). */
export function specProblems(spec: FermiSpec): string[] {
  const out: string[] = []
  if (typeof spec.stem !== 'string' || spec.stem.trim() === '') out.push('a Fermi item has a stem')
  if (spec.interval_pct !== 80) out.push('interval_pct is 80')
  let known: readonly string[] = []
  try {
    known = unitsOf(spec.dimension).map((u) => u.symbol)
  } catch {
    out.push(`unknown dimension ${JSON.stringify(spec.dimension)}`)
  }
  if (!Array.isArray(spec.units) || spec.units.length === 0) out.push('at least one unit is offered')
  else {
    if (new Set(spec.units).size !== spec.units.length) out.push('the offered units are distinct')
    for (const s of spec.units) if (known.length > 0 && !known.includes(s)) out.push(`unit ${JSON.stringify(s)} is not a ${spec.dimension} unit`)
  }
  return out
}

/** What a person typed: the three numbers as text and the chosen unit symbol ('' for none yet). */
export interface EntryFields {
  readonly value: string
  readonly low: string
  readonly high: string
  readonly unit: string
}

export type EntryField = 'value' | 'low' | 'high' | 'unit' | 'range'

export type EntryCheck =
  | { readonly ok: true; readonly response: FermiResponse }
  | { readonly ok: false; readonly errors: Readonly<Partial<Record<EntryField, string>>> }

/**
 * The response the typed fields make, or a note per field (and `range` for the three together). A
 * response it accepts is one `parseFermiResponse` accepts.
 */
export function checkEntry(spec: FermiSpec, fields: EntryFields): EntryCheck {
  const errors: Partial<Record<EntryField, string>> = {}
  const numbers: Partial<Record<'value' | 'low' | 'high', number>> = {}
  for (const name of ['value', 'low', 'high'] as const) {
    const r = parseMagnitude(fields[name])
    if (r.ok) numbers[name] = r.value
    else errors[name] = MAGNITUDE_NOTES[r.problem]
  }
  if (!(isUnit(fields.unit) && spec.units.includes(fields.unit))) errors.unit = ENTRY_NOTES.unit
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  const { value, low, high } = numbers as { value: number; low: number; high: number }
  if (!(low <= value && value <= high)) return { ok: false, errors: { range: ENTRY_NOTES.order } }
  if (Math.log10(high) - Math.log10(low) > MAX_INTERVAL_DEX) return { ok: false, errors: { range: ENTRY_NOTES.tooWide } }
  unitOf(fields.unit)
  return { ok: true, response: parseFermiResponse({ value, unit: fields.unit, low, high }) }
}
