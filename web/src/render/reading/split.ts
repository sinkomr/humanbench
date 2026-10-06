/**
 * Display paragraphs of a reading passage (web/UX-REVIEW.md D11, option A, a provisional default;
 * ROADMAP A14; DESIGN §3 row 10, §4.2). One authored paragraph of a 19th-century excerpt can run to
 * 363 words, about 1,280 px of text on a phone. The renderer therefore breaks a long paragraph into
 * shorter ones when it draws it. This is display only:
 *
 * - the authored data (`passages.json`, its copy in the bank, `passages.render.json`, the word
 *   count, the recorded solves and the A14 parity checks) is not touched, and `spec.paragraphs` is
 *   still the authored list;
 * - the words and their order are unchanged (the pieces of one paragraph, joined by single spaces,
 *   are that paragraph), so the passage's word count and the reading speed statistic (words per
 *   minute, §14.6 ex. 13) stay what they were;
 * - the reading time is not touched either: it runs from the frame that draws the passage to Done.
 *
 * THE RULE. Words are counted by the WORD RULE of `tasks/reading/text.ts`. A paragraph of at most
 * {@link SPLIT_ABOVE_WORDS} words is drawn as it is. A longer one is cut only at the end of a
 * sentence, never inside one, into pieces of about {@link TARGET_WORDS} words: of all the ways to
 * choose the cuts, the one with the smallest total of (words - 120)^2 over its pieces, where a
 * piece over {@link LONGEST_WORDS} or under {@link SHORTEST_WORDS} words is charged a very large
 * amount per word beyond the limit. So a cut set that keeps every piece between 40 and 150 words wins
 * whenever one exists. When none exists (one sentence of 160 words, or a 170-word paragraph whose
 * sentences run 140 and 30) the one that breaks the limits least wins, and a sentence is never broken
 * to meet a limit. A paragraph with no sentence end inside it is not cut at all. The choice depends on
 * the text alone.
 *
 * SENTENCE ENDS. A token (the text between single spaces) ends a sentence when it ends in ".", "!"
 * or "?" (closing quotes or brackets may follow), the next token starts, after any opening quotes
 * or brackets, with a capital letter, and the token is not one of
 * - a title or other abbreviation of {@link ABBREVIATIONS} ("Mrs.", "St.", "Lieut.", "vs.");
 * - an initial: one capital letter and a period, except "I" ("Mrs. C. was busy", "J. Smith"; "so
 *   did I. The next day" is still an end);
 * - letters joined by periods ("U.S.", "a.m.", "i.e."), which are left uncut whatever follows.
 * A semicolon, a colon, a dash or a comma never ends one: the long semicolon-led sentences of the
 * excerpts stay in one piece. The cost of an uncertain case is a longer piece, never a cut inside a
 * sentence, because every doubtful token counts as "not an end".
 */

import { countPassageWords } from '../../tasks/reading/text'

/** A paragraph of at most this many words is drawn whole. */
export const SPLIT_ABOVE_WORDS = 150
/** The size the cuts aim for. */
export const TARGET_WORDS = 120
/** A piece is meant to have at least this many words (unless the paragraph is shorter). */
export const SHORTEST_WORDS = 40
/** A piece is meant to have at most this many words (unless one sentence is longer). */
export const LONGEST_WORDS = 150

/** Cost per word beyond a limit of {@link SHORTEST_WORDS} or {@link LONGEST_WORDS}: dwarfs any (w - 120)^2. */
const LIMIT_PENALTY = 1_000_000

/**
 * Abbreviations that end in a period without ending a sentence, as written in the passages: the
 * capitalised forms (so that "no." and "co." in the middle of lower-case prose stay what they are)
 * and the few that are lower case by custom.
 */
export const ABBREVIATIONS: ReadonlySet<string> = new Set([
  'Mr', 'Mrs', 'Ms', 'Messrs', 'Mme', 'Mlle', 'Dr', 'St', 'Ste', 'Mt', 'Mts', 'Ft',
  'Gen', 'Col', 'Capt', 'Lieut', 'Lt', 'Sgt', 'Maj', 'Adm', 'Gov', 'Sen', 'Rep', 'Hon', 'Rev', 'Prof', 'Pres',
  'Sr', 'Jr', 'Esq', 'Bros', 'Co', 'Corp', 'Inc', 'Ltd',
  'No', 'Nos', 'Vol', 'Vols', 'Ch', 'Chap', 'Fig', 'Figs', 'Pp', 'Sec',
  'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec',
  'vs', 'viz', 'cf', 'ca', 'pp', 'esq', 'fig', 'figs', 'vol', 'vols', 'chap',
])

const OPENERS_RE = /^[‘“"'(]+/
const CLOSERS_RE = /['")’”]+$/
/** A token that ends in sentence punctuation (closing quotes or brackets may follow it). */
const ENDS_IN_STOP_RE = /[.!?]['")’”]*$/

/** The token without opening quotes or brackets in front and closing ones behind. */
function core(token: string): string {
  return token.replace(OPENERS_RE, '').replace(CLOSERS_RE, '')
}

/** True if `token` is a stop that does not end a sentence: an abbreviation, an initial or dotted letters. */
function isAbbreviation(token: string): boolean {
  const c = core(token)
  if (!c.endsWith('.') || c.endsWith('..')) return false
  const word = c.slice(0, -1)
  return ABBREVIATIONS.has(word) || /^[A-HJ-Z]$/.test(word) || /^(?:[A-Za-z]\.)+[A-Za-z]$/.test(word)
}

/** True if `token` (followed by `next`) is the last token of a sentence. */
function endsSentence(token: string, next: string): boolean {
  if (!ENDS_IN_STOP_RE.test(token) || isAbbreviation(token)) return false
  return /^[A-Z]/.test(next.replace(OPENERS_RE, ''))
}

/** Cost of one piece of `words` words (see the module comment). */
function pieceCost(words: number): number {
  const d = words - TARGET_WORDS
  return d * d + LIMIT_PENALTY * (Math.max(0, words - LONGEST_WORDS) + Math.max(0, SHORTEST_WORDS - words))
}

/**
 * The display paragraphs of one authored paragraph: `[text]` when it has at most
 * {@link SPLIT_ABOVE_WORDS} words or no place to cut, else its sentences regrouped into pieces of
 * about {@link TARGET_WORDS} words. `pieces.join(' ') === text` always; the pieces are cut at single
 * spaces between tokens, so they carry no leading or trailing space of their own when `text` has none.
 */
export function splitParagraph(text: string): string[] {
  const tokens = text.split(' ')
  const words = tokens.map((t) => countPassageWords(t))
  const total = words.reduce((a, b) => a + b, 0)
  if (total <= SPLIT_ABOVE_WORDS) return [text]

  // Sentences as runs of tokens: sentence k is tokens [starts[k], starts[k + 1]).
  const starts = [0]
  for (let i = 0; i + 1 < tokens.length; i++) if (endsSentence(tokens[i] as string, tokens[i + 1] as string)) starts.push(i + 1)
  const m = starts.length
  if (m < 2) return [text]
  starts.push(tokens.length)

  // Words before each sentence start, so a run of sentences costs a subtraction.
  const before = [0]
  for (const t of words) before.push((before[before.length - 1] as number) + t)
  const wordsOf = (from: number, to: number): number => (before[starts[to] as number] as number) - (before[starts[from] as number] as number)

  // best[j]: the least cost of cutting the first j sentences into pieces; cut[j]: where the last piece starts.
  const best: number[] = [0]
  const cut: number[] = [0]
  for (let j = 1; j <= m; j++) {
    let bestCost = Infinity
    let bestFrom = 0
    for (let i = 0; i < j; i++) {
      const cost = (best[i] as number) + pieceCost(wordsOf(i, j))
      if (cost < bestCost) {
        bestCost = cost
        bestFrom = i
      }
    }
    best[j] = bestCost
    cut[j] = bestFrom
  }

  const bounds: number[] = []
  for (let j = m; j > 0; j = cut[j] as number) bounds.unshift(j)
  const pieces: string[] = []
  let from = 0
  for (const to of bounds) {
    pieces.push(tokens.slice(starts[from], starts[to]).join(' '))
    from = to
  }
  return pieces
}

/** The display paragraphs of a passage: every authored paragraph through {@link splitParagraph}, in order. */
export function splitParagraphs(paragraphs: readonly string[]): string[] {
  return paragraphs.flatMap((p) => splitParagraph(p))
}
