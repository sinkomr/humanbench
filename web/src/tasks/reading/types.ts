/**
 * Types of the `reading` family (ROADMAP M1.12, A10, A14; DESIGN §3 row 10, §14.6 example 13).
 *
 * The authored passage bank (`passages.json`, {@link PassageBankFile}) holds public-domain
 * Project Gutenberg excerpts with three literal gate questions each. One item instance is one
 * reading block: a passage, its questions with the option order shuffled per seed, and the key.
 */

/** Where an excerpt comes from (A14: Gutenberg header stripped, provenance recorded). */
export interface PassageSource {
  readonly title: string
  readonly author: string
  /** Year the work was first published (must be < 1928, §6.i Gutenberg row). */
  readonly year: number
  /** Decade tag of `year`, e.g. "1860s" (§6.i: "tag the era"). */
  readonly era: string
  /** Chapter, lecture or letter the excerpt is taken from. */
  readonly section: string
  readonly gutenberg_ebook: number
  /** `https://www.gutenberg.org/ebooks/<n>`. */
  readonly url: string
  /** `https://www.gutenberg.org/cache/epub/<n>/pg<n>.txt`, the file the excerpt was cut from. */
  readonly text_url: string
  /** ISO date (YYYY-MM-DD) the plain text was fetched. */
  readonly retrieved: string
  /** sha256 (hex) of the fetched plain-text file's bytes. */
  readonly sha256: string
  /**
   * Code-point offsets [start, end) of the excerpt in the file's body: the text strictly between
   * the "*** START OF" and "*** END OF" marker lines, BOM removed, CRLF normalised to LF.
   */
  readonly offsets: { readonly start: number; readonly end: number }
  /** The first six words of the first paragraph, as stored. */
  readonly first_words: string
  /** The last six words of the last paragraph, as stored. */
  readonly last_words: string
}

/** One authored gate question (bank only; the item's spec carries {@link SpecQuestion}). */
export interface PassageQuestion {
  /** `<passage id>#q<k>`, k = 1, 2, 3. */
  readonly id: string
  readonly stem: string
  /** The four options in authored order. */
  readonly options: readonly string[]
  /** Index of the keyed option in `options` (authored order). */
  readonly key_index: number
  /** A verbatim substring of the passage text that supports the key. */
  readonly evidence_span: string
  /** One line per option (aligned with `options`): why it is the key, or why it is wrong. */
  readonly option_rationales: readonly string[]
}

/** One authored passage record of `passages.json`. */
export interface PassageRecord {
  /** Stable id, e.g. "darwin-beagle-1839"; the family structure (A11: one family per passage). */
  readonly id: string
  readonly source: PassageSource
  /**
   * The excerpt, verbatim up to whitespace: lines inside a paragraph are joined with one space,
   * runs of spaces collapsed; the passage text is the paragraphs joined by a blank line.
   */
  readonly paragraphs: readonly string[]
  /** {@link countPassageWords} of the passage text. */
  readonly word_count: number
  readonly questions: readonly PassageQuestion[]
}

/** The shape of `passages.json`. */
export interface PassageBankFile {
  readonly version: string
  readonly passages: readonly PassageRecord[]
}

/** A question as rendered: no key, no evidence, options in this item's shuffled order. */
export interface SpecQuestion {
  readonly id: string
  readonly stem: string
  readonly options: readonly string[]
}

/** The render payload of a reading block (never contains the key). */
export interface ReadingSpec {
  readonly passage_id: string
  readonly paragraphs: readonly string[]
  readonly word_count: number
  /** Provenance, shown as the attribution after the block. */
  readonly source: PassageSource
  readonly questions: readonly SpecQuestion[]
}

/** The key: per question (spec order) the keyed option's index in the shuffled options, and its evidence span. */
export interface ReadingKey {
  readonly indices: readonly number[]
  readonly evidence: readonly string[]
}

/**
 * A response to a reading block: the reading time (reveal → "Done", §14.6 example 13) and the
 * chosen option index per question in spec order (null = unanswered, scored wrong).
 */
export interface ReadingResponse {
  readonly reading_time_ms: number
  readonly choices: readonly (number | null)[]
}
