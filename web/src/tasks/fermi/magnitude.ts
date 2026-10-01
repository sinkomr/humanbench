/**
 * Reading and showing a typed magnitude (ROADMAP M5.1; DESIGN §3 row 11). A Fermi answer is a number
 * of any size, so the entry takes it the way people write one: `3200000`, `3,200,000`, `3.2e6`,
 * `3.2 × 10^6`, `3.2x10^6`, `3.2*10^6`, `10^6` or with a superscript exponent (`3.2 × 10⁶`). The unit
 * is chosen in its own box, so text after the number (`5 km`, `3 million`) is not read: it is the one
 * slip that would change an answer by orders of magnitude without a visible sign, and the entry says
 * so instead of guessing.
 *
 * Commas are thousands separators only (`31,557,600`): a decimal comma (`2,5`, `0,125`) is refused,
 * because reading it as 25 (or 125) would be wrong by a factor of ten (or a thousand). A first group
 * of thousands never starts with zero, so a comma after a leading `0` is always a decimal comma. A
 * minus sign, zero and anything outside [1e-30, 1e30] are refused (a size or a count is positive).
 * {@link formatMagnitude} writes a number back for the "reads as" preview, in the same two forms.
 */

import { MAGNITUDE_MAX, MAGNITUDE_MIN } from './scoring'

/** Why a text is not a magnitude (copy for each is in `copy.ts`). */
export type MagnitudeProblem = 'empty' | 'negative' | 'zero' | 'unreadable' | 'decimal_comma' | 'has_unit' | 'range'

export type MagnitudeResult = { readonly ok: true; readonly value: number } | { readonly ok: false; readonly problem: MagnitudeProblem }

const SUPERSCRIPT: Readonly<Record<string, string>> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+' }
const SUPERSCRIPT_RE = /10([⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g

const fail = (problem: MagnitudeProblem): MagnitudeResult => ({ ok: false, problem })

/** Space-like characters people group digits with: space, NBSP, narrow NBSP, thin space. */
const GROUP_SPACE = /[    ]/g

/**
 * `31,557,600` / `3 200 000` shaped groups of exactly three digits after the first. The first group
 * starts with 1 to 9: `0,125` is a decimal comma (0.125), never 125, and is refused with the rest.
 */
const GROUPED = /^[1-9]\d{0,2}(?:[,    ]\d{3})+(?:\.\d+)?$/
const PLAIN = /^(?:\d+\.?\d*|\.\d+)$/
const POWER = /^(?:(.*?)\s*(?:[×x*·⋅]|\*\*)\s*)?10\s*\^\s*([+-]?\d{1,4})$/i
const SCI = /^(\d+\.?\d*|\.\d+)[eE]([+-]?\d{1,4})$/

/** Read a magnitude from text, or say why not. */
export function parseMagnitude(text: string): MagnitudeResult {
  if (typeof text !== 'string') return fail('unreadable')
  let s = text.replace(SUPERSCRIPT_RE, (_m, e: string) => `10^${[...e].map((c) => SUPERSCRIPT[c] ?? c).join('')}`)
  s = s.replace(/[−–—]/g, '-').trim()
  if (s === '') return fail('empty')
  if (s.startsWith('-')) return fail('negative')
  if (s.startsWith('+')) s = s.slice(1).trim()

  let mantissaText: string
  let exponent = 0
  const power = POWER.exec(s)
  const sci = power === null ? SCI.exec(s) : null
  if (power !== null) {
    mantissaText = (power[1] ?? '1').trim()
    if (mantissaText === '') mantissaText = '1'
    exponent = Number(power[2])
  } else if (sci !== null) {
    mantissaText = sci[1] as string
    exponent = Number(sci[2])
  } else {
    mantissaText = s
  }

  if (/^[\d.,\s]+[a-z]/i.test(mantissaText)) return fail('has_unit')
  if (mantissaText.includes(',') && !GROUPED.test(mantissaText)) return fail('decimal_comma')
  if (GROUPED.test(mantissaText)) mantissaText = mantissaText.replace(/,/g, '').replace(GROUP_SPACE, '')
  if (!PLAIN.test(mantissaText)) return fail('unreadable')

  const mantissa = Number(mantissaText)
  if (!Number.isFinite(mantissa)) return fail('range')
  if (mantissa === 0) return fail('zero')
  const value = Number(`${mantissaText}e${exponent}`)
  if (!Number.isFinite(value)) return fail('range')
  if (value < MAGNITUDE_MIN || value > MAGNITUDE_MAX) return fail('range')
  return { ok: true, value }
}

const SUPER_DIGIT = '⁰¹²³⁴⁵⁶⁷⁸⁹'

/** `-7` as `⁻⁷`. */
function superscript(n: number): string {
  return [...String(n)].map((c) => (c === '-' ? '⁻' : (SUPER_DIGIT[Number(c)] ?? c))).join('')
}

/**
 * A number written back for the preview: plain with thousands separators from 0.001 up to a million
 * (`31,600`, `0.0025`), else `3.16 × 10⁷`; six significant figures at most, trailing zeros dropped.
 */
export function formatMagnitude(value: number): string {
  if (!(Number.isFinite(value) && value > 0)) return ''
  if (value >= 1e-3 && value < 1e6) {
    const sig = Number(value.toPrecision(6))
    const decimals = sig >= 1 ? Math.max(0, 5 - Math.floor(Math.log10(sig))) : 6 - Math.floor(Math.log10(sig))
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: Math.min(decimals, 12), useGrouping: true }).format(sig)
  }
  const [mantissa, exp] = value.toExponential(5).split('e') as [string, string]
  const m = String(Number(mantissa))
  return `${m} × 10${superscript(Number(exp))}`
}

/** The same number for a screen reader: `3.16 times 10 to the 7`. */
export function spokenMagnitude(value: number): string {
  if (!(Number.isFinite(value) && value > 0)) return ''
  if (value >= 1e-3 && value < 1e6) return formatMagnitude(value)
  const [mantissa, exp] = value.toExponential(5).split('e') as [string, string]
  return `${Number(mantissa)} times 10 to the ${Number(exp)}`
}
