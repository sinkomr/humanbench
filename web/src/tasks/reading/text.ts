/**
 * Text rules of the `reading` family (ROADMAP M1.12, A14). The bank's Python twin
 * (`hb.gen.reading`) documents the same rules in the same words and re-implements them; a TS
 * dump cross-check and the shared `passages.json` keep the two in agreement.
 *
 * WORD RULE (wpm = words / minutes, §14.6 example 13). The passage text is its paragraphs
 * joined by "\n\n". Split it at every run of separators, where a separator is a space, a
 * newline, an en dash (U+2013), an em dash (U+2014) or a run of two or more hyphen-minus
 * characters ("--", the Gutenberg em dash). A word is a resulting piece that contains at least
 * one ASCII letter or digit. So "well-known" is one word, "Yorkshire--a" is two, "(which" is
 * one and a lone "--" is none.
 *
 * SENTENCE RULE (a v0 prior feature only): a sentence end is a run of ".", "!" or "?" that is
 * followed, after any closing quotes or brackets (' " ) ’ ”), by a space, a newline or the end
 * of the text. Abbreviations ("Mrs.", "St.") count as ends: the count is crude by design.
 *
 * LETTER RULE: letters are ASCII A–Z and a–z.
 *
 * CHARSET: paragraphs, stems and options use only ASCII letters and digits, the space, and
 * . , ; : ! ? ' " ( ) - plus ‘ ’ “ ” – — (no tabs, newlines or markup such as [ ] _ * #).
 */

/** Separators of the word rule: space, newline, en/em dash, or a run of ≥ 2 hyphens. */
export const WORD_SPLIT_RE = /(?:[ \n]|--+|[–—])+/

/** A piece counts as a word iff it contains an ASCII letter or digit. */
export const WORD_CHAR_RE = /[A-Za-z0-9]/

/** Sentence ends of the sentence rule (global: use with `match`). */
export const SENTENCE_END_RE = /[.!?]+(?=['")’”]*(?:[ \n]|$))/g

/** Characters allowed in paragraphs, stems and options (see CHARSET above). */
export const ALLOWED_TEXT_RE = /^[A-Za-z0-9 .,;:!?'"()\-‘’“”–—]*$/

/**
 * Traces of the Project Gutenberg header, footer or licence, credits, transcriber notes and web
 * links; none may occur in a passage (A14). Case-insensitive. Deliberately conservative: an
 * excerpt that legitimately says "licence" is rejected too (pick another excerpt).
 */
export const BOILERPLATE_RE =
  /gutenberg|\be-?books?\b|\be-?texts?\b|licen[cs]e|trademark|copyright|(?:^|\n)produced by|transcriber|proofread|https?:|www\.|\*\*\*/i

/** The passage text: paragraphs joined by a blank line. */
export function passageText(paragraphs: readonly string[]): string {
  return paragraphs.join('\n\n')
}

/** Word count under the WORD RULE (see the module comment). */
export function countPassageWords(text: string): number {
  let n = 0
  for (const piece of text.split(WORD_SPLIT_RE)) if (WORD_CHAR_RE.test(piece)) n++
  return n
}

/** Sentence count under the SENTENCE RULE (at least 1 for a non-empty text). */
export function countSentences(text: string): number {
  const n = text.match(SENTENCE_END_RE)?.length ?? 0
  return Math.max(1, n)
}

/** ASCII letters in the text (LETTER RULE). */
export function countLetters(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) n++
  }
  return n
}

/** True if `s` is non-empty, uses only the allowed characters and has no leading, trailing or double spaces. */
export function isCleanLine(s: string): boolean {
  return s.length > 0 && ALLOWED_TEXT_RE.test(s) && s === s.trim() && !s.includes('  ')
}

/** Canonical form for comparing options: lowercased, runs of spaces collapsed, trimmed. */
export function optionForm(s: string): string {
  return s.toLowerCase().replace(/ +/g, ' ').trim()
}
