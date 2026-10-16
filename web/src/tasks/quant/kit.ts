/**
 * The quant template kit (M1.8, ROADMAP A1): the types of a template variant, its `given` fields
 * and the shared rendering and drawing helpers, used by the strata 1–4 table (`templates.ts`) and
 * the hard strata 5–6 tables (`hard*.ts`, M3.12). Moved here from `templates.ts` unchanged in
 * behaviour, so that the hard tables can import it without an import cycle.
 */

import type { JsonValue, Rng } from '../../engine'
import type { EntryFormat } from '../family'
import type { Stratum } from '../ids'
import { Fraction, bigGcd, frac } from './fraction'

/** The quant entry formats: the shared {@link EntryFormat} vocabulary without letters. */
export type InputFormat = Exclude<EntryFormat, 'letter'>

/** The `given` object of an item's spec: the quantities its stem shows. */
export type Given = { readonly [k: string]: JsonValue }

/** A `given` field's allowed values (checked by the verifiers before any rule). */
export type FieldSpec =
  | { readonly kind: 'int'; readonly lo: number; readonly hi: number; readonly nonzero?: true }
  | { readonly kind: 'enum'; readonly values: readonly (string | number | boolean)[] }
  | { readonly kind: 'ints'; readonly minLen: number; readonly maxLen: number; readonly lo: number; readonly hi: number }

export interface VariantDef {
  readonly template: string
  readonly variant: string
  readonly stratum: Stratum
  readonly format: InputFormat
  /** [SPEC v0] per-variant offset added to the stratum anchor of the b prior (see `prior.ts`). */
  readonly offset: number
  /** Every field of `given`, with its allowed values; `given` has exactly these fields. */
  readonly fields: Readonly<Record<string, FieldSpec>>
  /** Draw a valid `given` from `rng` only. */
  draw(rng: Rng): Given
  /** The stem shown to the person. */
  render(g: Given): string
  /** The generator's route to the answer (the verifier recomputes it by another route). */
  compute(g: Given): Fraction
}

export const TOL_EXACT = Object.freeze({ abs: 0 })
/** Half a hundredth: the key has ≤ 2 decimal places, so this accepts the entries that round to it. */
export const TOL_DECIMAL = Object.freeze({ abs: 0.005 })

/**
 * Input hints shown under the entry box, by format, in the words of every entry box ("whole
 * number", as series says; UX-079). Display copy only: the stem, given, key, params and every other
 * field of an item stay the same for each seed, so a wording change here keeps the generator
 * version, and saved `i:quant:<version>:<seed>` ids still regenerate and re-score (`resolveItem`
 * needs the exact version; §7.8). The bank twin `hb.gen.quant.spec.HINTS` has the same strings
 * (its verifier checks them on the TS dump).
 */
export const HINTS: Readonly<Record<InputFormat, string>> = Object.freeze({
  integer: 'Enter a whole number, such as 42 or -7.',
  decimal: 'Enter a number; decimals are fine, such as 12.5.',
  fraction: 'Enter a fraction such as 3/8, or a whole number.',
})

export const THINGS = Object.freeze(['jacket', 'lamp', 'backpack', 'board game', 'toaster', 'desk chair', 'kettle', 'tent'])
export const NAMES = Object.freeze(['Maya', 'Sam', 'Priya', 'Leo', 'Ana', 'Kenji', 'Zoe', 'Omar'])
export const COLOURS = Object.freeze(['red', 'blue', 'green', 'yellow', 'white', 'black'])
export const NUMBER_WORDS: Readonly<Record<number, string>> = { 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven' }

// --- field access (the verifier has checked the shape before any of these run) ----------------

export const num = (g: Given, k: string): number => {
  const v = g[k]
  if (typeof v !== 'number') throw new TypeError(`given.${k} is not a number`)
  return v
}
export const str = (g: Given, k: string): string => {
  const v = g[k]
  if (typeof v !== 'string') throw new TypeError(`given.${k} is not a string`)
  return v
}
export const bool = (g: Given, k: string): boolean => {
  const v = g[k]
  if (typeof v !== 'boolean') throw new TypeError(`given.${k} is not a boolean`)
  return v
}
export const nums = (g: Given, k: string): number[] => {
  const v = g[k]
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'number')) throw new TypeError(`given.${k} is not a number list`)
  return v as number[]
}

// --- rendering ---------------------------------------------------------------------------------

/** An integer with "−" (U+2212) for negatives. */
export const signed = (x: number): string => (x < 0 ? `−${-x}` : `${x}`)
/** A series term: negatives in parentheses, "(−6)". */
export const paren = (x: number): string => (x < 0 ? `(${signed(x)})` : `${x}`)
/** A rational: "p/q" or "p", "−" for negatives. */
export const ratText = (f: Fraction): string => (f.sign() < 0 ? `−${f.neg().toString()}` : f.toString())
/** A rational series term: negatives in parentheses. */
export const ratTerm = (f: Fraction): string => (f.sign() < 0 ? `(${ratText(f)})` : ratText(f))

/**
 * A linear combination Σ cᵢ·symᵢ (sym "" for the constant): zero terms are skipped; the first
 * term carries "−" directly ("−3x"), later ones " + " / " − "; a unit coefficient is dropped
 * before a symbol ("x", "− y"); all-zero renders "0".
 */
export function lin(terms: readonly (readonly [number, string])[]): string {
  let out = ''
  for (const [c, sym] of terms) {
    if (c === 0) continue
    const mag = Math.abs(c) === 1 && sym !== '' ? sym : `${Math.abs(c)}${sym}`
    out += out === '' ? (c < 0 ? `−${mag}` : mag) : c < 0 ? ` − ${mag}` : ` + ${mag}`
  }
  return out === '' ? '0' : out
}

/** "a, b, c and d". */
export function listText(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] as string}`
}

export const numberWord = (k: number): string => {
  const w = NUMBER_WORDS[k]
  if (w === undefined) throw new RangeError(`no number word for ${k}`)
  return w
}
export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
export const hours = (t: number): string => (t === 1 ? '1 hour' : `${t} hours`)

// --- drawing helpers ---------------------------------------------------------------------------

/** Draw until `ok` (rejection sampling); throws if a template's constraints are unsatisfiable. */
export function until<T>(draw: () => T, ok: (v: T) => boolean, what: string): T {
  for (let i = 0; i < 10_000; i++) {
    const v = draw()
    if (ok(v)) return v
  }
  throw new Error(`quant: could not draw ${what}`)
}
export const nonzero = (rng: Rng, lo: number, hi: number): number => until(() => rng.int(lo, hi), (v) => v !== 0, 'a non-zero integer')
export const gcd = (a: number, b: number): number => Number(bigGcd(BigInt(a), BigInt(b)))
/** A proper fraction a/b in lowest terms with b in [bLo, bHi]. */
export const properFraction = (rng: Rng, bLo: number, bHi: number): [number, number] => {
  const b = rng.int(bLo, bHi)
  const a = until(() => rng.int(1, b - 1), (x) => gcd(x, b) === 1, 'a reduced numerator')
  return [a, b]
}
/** Integer power as a Fraction. */
export const ipow = (b: number, e: number): Fraction => frac(BigInt(b) ** BigInt(e))

export const int = (lo: number, hi: number, nz = false): FieldSpec => (nz ? { kind: 'int', lo, hi, nonzero: true } : { kind: 'int', lo, hi })
export const oneOf = (...values: (string | number | boolean)[]): FieldSpec => ({ kind: 'enum', values })

// --- the templates -----------------------------------------------------------------------------

export const V = (d: VariantDef): VariantDef => Object.freeze(d)
