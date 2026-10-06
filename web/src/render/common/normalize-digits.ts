/**
 * What the typed-entry box does to a typed answer before the family's parser reads it (ROADMAP
 * M1.13, A18; UX-024). The bank's parsers read ASCII digits only; people type the digits of their
 * own keyboard (full-width forms from an East Asian input method, Arabic-Indic, Extended
 * Arabic-Indic, Devanagari) and group long numbers with spaces. The box rewrites those to the ASCII
 * the parser already accepts, so the parser, the keys and the save format see nothing new. It never
 * changes what an entry means: a text that is not a number in some digit script stays unreadable.
 */

import type { EntryFormat } from '../../tasks/family'

/** The zero of each supported non-ASCII digit script; its ten digits follow in code-point order. */
const DIGIT_SCRIPT_ZEROS = [0x0660, 0x06f0, 0x0966] as const

const SCRIPT_DIGIT = /[٠-٩۰-۹०-९]/g

/** Every digit of the supported scripts, and the full-width and compatibility forms (NFKC), as ASCII; other text unchanged. */
export function normalizeDigits(text: string): string {
  return text.normalize('NFKC').replace(SCRIPT_DIGIT, (ch) => {
    const code = ch.codePointAt(0) as number
    const zero = DIGIT_SCRIPT_ZEROS.find((z) => code >= z && code <= z + 9) as number
    return String(code - zero)
  })
}

/**
 * Digits as ASCII and, when what is typed is only a sign, digits and a point, no white space at all
 * (spaces, no-break spaces U+00A0 and U+202F, tabs): `1 000` is `1000`. Anything else keeps its
 * spacing, so `2 1/3` stays the mixed number it is and is never read as `21/3`.
 */
export function normalizeNumber(text: string): string {
  const digits = normalizeDigits(text)
  const compact = digits.replace(/\s+/gu, '')
  return /^[+\-\u2212]?\d*\.?\d*$/u.test(compact) ? compact : digits
}

/**
 * The text the parser and the response get for what was typed in a box of `format`: integers and
 * decimals lose the inner spaces of a plain number too, fractions keep theirs (`2 1/3` is a mixed
 * number), letters are left alone.
 */
export function normalizeEntry(text: string, format: EntryFormat): string {
  switch (format) {
    case 'integer':
    case 'decimal':
      return normalizeNumber(text)
    case 'fraction':
      return normalizeDigits(text)
    case 'letter':
      return text
  }
}

/** True iff `locale` (default: the browser's language) writes decimals with a comma, so its number pad has no point. */
export function usesDecimalComma(locale?: string): boolean {
  try {
    const lang = locale ?? (typeof navigator === 'undefined' ? undefined : navigator.language)
    return new Intl.NumberFormat(lang).formatToParts(1.1).find((p) => p.type === 'decimal')?.value === ','
  } catch {
    return false
  }
}
