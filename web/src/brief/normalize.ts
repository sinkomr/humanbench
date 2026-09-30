/**
 * ASCII normaliser for text that ends up in the notes (R-17.3: ASCII only; proposal §6 row 14:
 * "ASCII normalisation; zero-width and bidi characters stripped"). It turns typographic
 * punctuation into plain ASCII, drops accents, and removes invisible and control characters.
 * Anything still outside ASCII afterwards (another script, a homoglyph) is left in place on
 * purpose: `lint.ts` flags it, and the caller refuses the text instead of guessing.
 *
 * Code points are written as numbers, not as escapes or literals, so this file stays plain ASCII
 * and no editor or tool can turn an escape into an invisible character.
 */

const cp = (n: number): string => String.fromCodePoint(n)
const cls = (ranges: readonly (readonly [number, number])[]): RegExp =>
  new RegExp(`[${ranges.map(([a, b]) => (a === b ? cp(a) : `${cp(a)}-${cp(b)}`)).join('')}]`, 'gu')

/** Zero-width, bidi-control, soft-hyphen, filler and byte-order characters that hide text from a reader. */
const INVISIBLE = cls([
  [0xad, 0xad], [0x34f, 0x34f], [0x61c, 0x61c], [0x115f, 0x1160], [0x17b4, 0x17b5], [0x180b, 0x180e], [0x200b, 0x200f],
  [0x202a, 0x202e], [0x2060, 0x206f], [0x3164, 0x3164], [0xfe00, 0xfe0f], [0xfeff, 0xfeff], [0xffa0, 0xffa0], [0xfff9, 0xfffb],
])
/** C0 and C1 control characters except newline (10) and tab (9), which are handled separately. */
const CONTROL = cls([[0, 8], [11, 12], [14, 31], [0x7f, 0x9f]])
const COMBINING = /\p{M}/gu
/** Line separators other than "\n": CR LF, CR, NEL, line and paragraph separators. */
const LINE_BREAKS = new RegExp(`\r\n?|[${cp(0x85)}${cp(0x2028)}${cp(0x2029)}]`, 'gu')

const PUNCTUATION = new Map<string, string>()
for (const [code, ascii] of [
  [0x2018, "'"], [0x2019, "'"], [0x201a, "'"], [0x201b, "'"], [0x2032, "'"], [0x2bc, "'"],
  [0x201c, '"'], [0x201d, '"'], [0x201e, '"'], [0x201f, '"'], [0x2033, '"'],
  [0x2010, '-'], [0x2011, '-'], [0x2012, '-'], [0x2013, '-'], [0x2014, '-'], [0x2015, '-'], [0x2212, '-'],
  [0xa0, ' '], [0x2002, ' '], [0x2003, ' '], [0x2009, ' '], [0x202f, ' '], [0x3000, ' '],
] as const) PUNCTUATION.set(cp(code), ascii)
const PUNCTUATION_RE = new RegExp(`[${[...PUNCTUATION.keys()].join('')}]`, 'gu')

/**
 * Plain-ASCII form of `input`: NFKC, accents stripped, typographic quotes/dashes/spaces mapped,
 * invisible and control characters removed, line breaks unified to a newline, tabs to spaces.
 * Idempotent.
 */
export function normalizeAscii(input: string): string {
  let s = input.normalize('NFKC')
  s = s.normalize('NFD').replace(COMBINING, '').normalize('NFC')
  s = s.replace(LINE_BREAKS, '\n').replace(/\t/gu, ' ')
  s = s.replace(INVISIBLE, '').replace(CONTROL, '')
  s = s.replace(PUNCTUATION_RE, (c) => PUNCTUATION.get(c) ?? c)
  return s
}

/** Whether `s` is printable ASCII plus newlines only. */
export function isPlainAscii(s: string): boolean {
  return /^[\x20-\x7E\n]*$/u.test(s)
}

/** Whitespace collapsed to single spaces and trimmed (typed single-line fields). */
export function collapseSpace(s: string): string {
  return s.replace(/\s+/gu, ' ').trim()
}
