/**
 * Numeric entry for the quant family (M1.8, DESIGN §3 row 6, §4.2): parsing what a person types
 * and comparing it with the exact key under the item's stored tolerance.
 *
 * Accepted entries (after trimming spaces, tabs, line breaks and no-break spaces; "−" U+2212 counts
 * as "-"; an optional "$" after the sign and an optional trailing "%" are ignored; at most
 * {@link MAX_ENTRY_LENGTH} characters; digits are ASCII, and only spaces or tabs may separate the
 * parts of a fraction):
 * - an integer or decimal: `42`, `-7`, `+3`, `12.5`, `.5`, `3.`;
 * - an integer with thousands commas: `1,533` or `12,345.5` (other commas are rejected, so the
 *   decimal comma `0,5` is not read as 5);
 * - a fraction `a/b` with b > 0 (`-3/8`, `6/4`), or a mixed number `2 1/3` (the sign applies to
 *   the whole number).
 * Anything else parses to null and scores 0. Values are exact rationals, so `0.75`, `3/4` and
 * `6/8` are the same entry. The bank's `hb.gen.quant` implements the same grammar.
 */

import { Fraction } from './fraction'

/** Longest entry parsed (longer ones are rejected, so a pasted essay cannot build a huge BigInt). */
export const MAX_ENTRY_LENGTH = 32

/**
 * Per-item tolerance (§4.2): an absolute or a relative bound. The v0 templates use `{ abs: 0 }` for
 * integer and fraction answers and `{ abs: 0.005 }` for their exact two-place decimals (see
 * `templates.ts`); `{ rel: 0.005 }` is for answers that need rounding.
 */
export type Tolerance = { readonly abs: number } | { readonly rel: number }

const DEC_RE = /^(\d+(?:\.\d*)?|\.\d+)$/
const THOUSANDS_RE = /^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/
const FRAC_RE = /^(\d+)[ \t]*\/[ \t]*(\d+)$/
const MIXED_RE = /^(\d+)[ \t]+(\d+)[ \t]*\/[ \t]*(\d+)$/
const TRIM_RE = /^[ \t\n\r\f\v\u00a0]+|[ \t\n\r\f\v\u00a0]+$/g
const trim = (s: string): string => s.replace(TRIM_RE, '')

/** An unsigned decimal literal ("12.50", ".5", "3.") as an exact fraction. */
function decimal(s: string): Fraction {
  const [int = '', fracPart = ''] = s.split('.')
  const digits = `${int}${fracPart}`.replace(/^0+(?=\d)/, '') || '0'
  return Fraction.of(BigInt(digits), 10n ** BigInt(fracPart.length))
}

/** Parse a typed numeric entry to an exact fraction, or null if it is not a number (see module doc). */
export function parseEntry(raw: unknown): Fraction | null {
  if (typeof raw !== 'string') return null
  let s = trim(raw).replace(/\u2212/g, '-')
  if (s.length === 0 || s.length > MAX_ENTRY_LENGTH) return null
  let sign = 1n
  if (s.startsWith('-') || s.startsWith('+')) {
    if (s.startsWith('-')) sign = -1n
    s = s.slice(1)
  }
  if (s.startsWith('$')) s = s.slice(1)
  if (s.endsWith('%')) s = s.slice(0, -1)
  s = trim(s)
  let v: Fraction | null = null
  if (DEC_RE.test(s)) v = decimal(s)
  else if (THOUSANDS_RE.test(s)) v = decimal(s.replace(/,/g, ''))
  else {
    const f = FRAC_RE.exec(s)
    const m = MIXED_RE.exec(s)
    if (f) {
      const d = BigInt(f[2] as string)
      if (d !== 0n) v = Fraction.of(BigInt(f[1] as string), d)
    } else if (m) {
      const d = BigInt(m[3] as string)
      if (d !== 0n) v = Fraction.of(BigInt(m[1] as string)).add(Fraction.of(BigInt(m[2] as string), d))
    }
  }
  return v === null ? null : sign < 0n ? v.neg() : v
}

/** A tolerance bound (a finite JSON number ≥ 0) as the exact rational of its decimal text. */
export function boundOf(x: number): Fraction {
  if (!(typeof x === 'number' && Number.isFinite(x) && x >= 0)) throw new RangeError(`tolerance must be a finite number ≥ 0, got ${x}`)
  const s = String(x)
  if (/e/i.test(s)) throw new RangeError(`tolerance ${s} must be written without an exponent`)
  return decimal(s)
}

/**
 * True iff `entry` is within `tol` of `target`: |entry − target| ≤ abs, or ≤ rel·|target|,
 * compared exactly.
 */
export function withinTolerance(entry: Fraction, target: Fraction, tol: Tolerance): boolean {
  const diff = entry.sub(target).abs()
  if ('abs' in tol) return diff.cmp(boundOf(tol.abs)) <= 0
  return diff.cmp(boundOf(tol.rel).mul(target.abs())) <= 0
}
