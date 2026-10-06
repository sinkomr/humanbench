/**
 * Numeric entry for the quant family (M1.8, DESIGN §3 row 6, §4.2): parsing what a person types
 * and comparing it with the exact key under the item's stored tolerance.
 *
 * Accepted entries (after trimming spaces, tabs, line breaks and no-break spaces; "−" U+2212 counts
 * as "-"; an optional "$" after the sign and an optional trailing "%" are ignored; at most
 * {@link MAX_ENTRY_LENGTH} characters; digits are ASCII, and only spaces or tabs may separate the
 * parts of a fraction):
 * - an integer or decimal: `42`, `-7`, `+3`, `12.5`, `.5`, `3.`;
 * - a decimal comma: digits, one comma, then one or two digits: `3,5` is 3.5, `0,25` is 0.25,
 *   `-1,5` is -1.5 (UX-079);
 * - an integer part with thousands commas: `1,533` or `12,345.5`, kept for saved answers (below);
 * - a fraction `a/b` with b > 0 (`-3/8`, `6/4`), or a mixed number `2 1/3` (the sign applies to
 *   the whole number).
 * Anything else parses to null and scores 0. Values are exact rationals, so `0.75`, `3/4` and
 * `6/8` are the same entry. The bank's `hb.gen.quant.entry` implements the same grammar; both
 * repos check theirs against the shared vectors of `entry-vectors.ts` (in the bank:
 * `golden/ts_dumps/quant_entry.json`).
 *
 * Two readers of one grammar:
 * - {@link parseEntry} scores. It reads every form above, the thousands form included, because
 *   results are always re-scored from the raw responses (§7.8) and the entry box used to take
 *   `1,500` as 1500: a saved `1,500` keeps scoring as 1500. The decimal comma is new, and the
 *   box refused every such entry before, so no saved answer changes its value.
 * - {@link checkNewEntry} is the entry box's check of a new entry: there the thousands form is
 *   refused (`'thousands'`, with a note to write 1500 and 1.5), because a decimal-comma typist who
 *   writes `1,500` may mean 1.5.
 */

import type { Tolerance } from '../family'
import { Fraction } from './fraction'

/** Longest entry parsed (longer ones are rejected, so a pasted essay cannot build a huge BigInt). */
export const MAX_ENTRY_LENGTH = 32

/**
 * Per-item tolerance (§4.2), the shared {@link Tolerance} of the contract's `NumericKey`
 * (`family.ts`): an absolute or a relative bound. The v0 templates use `{ abs: 0 }` for integer
 * and fraction answers and `{ abs: 0.005 }` for their exact two-place decimals (see
 * `templates.ts`); `{ rel: 0.005 }` is for answers that need rounding.
 */
export type { Tolerance }

const DEC_RE = /^(\d+(?:\.\d*)?|\.\d+)$/
const DECIMAL_COMMA_RE = /^(\d+),(\d{1,2})$/
const THOUSANDS_RE = /^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/
const FRAC_RE = /^(\d+)[ \t]*\/[ \t]*(\d+)$/
const MIXED_RE = /^(\d+)[ \t]+(\d+)[ \t]*\/[ \t]*(\d+)$/
const TRIM_RE = /^[ \t\n\r\f\v ]+|[ \t\n\r\f\v ]+$/g
const trim = (s: string): string => s.replace(TRIM_RE, '')

/** An unsigned decimal literal ("12.50", ".5", "3.") as an exact fraction. */
function decimal(s: string): Fraction {
  const [int = '', fracPart = ''] = s.split('.')
  const digits = `${int}${fracPart}`.replace(/^0+(?=\d)/, '') || '0'
  return Fraction.of(BigInt(digits), 10n ** BigInt(fracPart.length))
}

/** The unsigned number of an entry (sign, "$" and "%" taken off) and its sign; null for a non-string, an empty or an overlong entry. */
function numberPart(raw: unknown): { readonly negative: boolean; readonly body: string } | null {
  if (typeof raw !== 'string') return null
  let s = trim(raw).replace(/−/g, '-')
  if (s.length === 0 || s.length > MAX_ENTRY_LENGTH) return null
  const negative = s.startsWith('-')
  if (negative || s.startsWith('+')) s = s.slice(1)
  if (s.startsWith('$')) s = s.slice(1)
  if (s.endsWith('%')) s = s.slice(0, -1)
  return { negative, body: trim(s) }
}

/** Parse a typed numeric entry to an exact fraction, or null if it is not a number (see module doc). The scoring parser. */
export function parseEntry(raw: unknown): Fraction | null {
  const part = numberPart(raw)
  if (part === null) return null
  const s = part.body
  let v: Fraction | null = null
  const comma = DECIMAL_COMMA_RE.exec(s)
  if (DEC_RE.test(s)) v = decimal(s)
  else if (comma) v = decimal(`${comma[1] as string}.${comma[2] as string}`)
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
  return v === null ? null : part.negative ? v.neg() : v
}

/**
 * True iff the entry is a number written with thousands commas (`1,500`, `12,345.5`, `-$1,500`,
 * `1,500%`): {@link parseEntry} reads it (saved answers), the entry box refuses it.
 */
export function isThousandsEntry(raw: unknown): boolean {
  const part = numberPart(raw)
  return part !== null && THOUSANDS_RE.test(part.body)
}

/**
 * The entry box's verdict on a new entry ({@link checkNewEntry}): `'ok'` (parseEntry reads it),
 * `'thousands'` (a number with thousands commas: parseEntry reads it, the box refuses it with its
 * own note) or `'unreadable'` (parseEntry returns null).
 */
export type NewEntryCheck = 'ok' | 'thousands' | 'unreadable'

/** The entry box's check of a new entry (module doc). The item's format (whole numbers only) is the renderer's check on top. */
export function checkNewEntry(raw: unknown): NewEntryCheck {
  if (isThousandsEntry(raw)) return 'thousands'
  return parseEntry(raw) === null ? 'unreadable' : 'ok'
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
