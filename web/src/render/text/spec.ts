/**
 * A served text multiple-choice question, as its renderer takes it (ROADMAP M3.11 phase 1; DESIGN §3
 * rows 2, 5, 13 to 15, §11.2, R-11.1): a stem, an optional text to read first, and two to six options.
 * This is the shape of the authored banks' `mc_text` items (Logical Reasoning, Vocabulary, the three
 * knowledge skills): the server's `item_view` hands over `{stem, options}` and no `media`.
 *
 * Everything here is **text the server sent, treated as data**: it is checked for shape, kept as
 * strings, and the renderer writes it into text nodes. Nothing is ever parsed as HTML or Markdown.
 * The spec holds no key, no verdict and no parameter, because the payload has none (R-11.1); the
 * answer a renderer gives is the option's position, which the server scores.
 *
 * What is accepted ({@link textMcSpec}), and nothing else:
 * - `stem`: a string with something in it;
 * - `options`: {@link TEXT_MC_MIN_OPTIONS} to {@link TEXT_MC_MAX_OPTIONS} strings, each with something in it;
 * - `media`: absent, empty, or `{ stimulus }` alone, where `stimulus` is a string or a list of
 *   paragraphs (a text to read before the question). A payload that names a `renderer` is another
 *   kind of item (a passage, a logic game, a triad: ROADMAP M3.11, later phases), and one with any
 *   other `media` field has something this renderer cannot show; both are not text multiple choice,
 *   so the session offers the skip instead of showing half a question.
 */

/** The client-side name of the renderer (`ServedItem.family`); not a family of the task registry. */
export const TEXT_MC_RENDERER = 'text_mc'

export const TEXT_MC_MIN_OPTIONS = 2
export const TEXT_MC_MAX_OPTIONS = 6

export interface TextMcSpec {
  /** The whole stem as sent. */
  readonly stem: string
  /** Paragraphs to read before the question; empty when there are none. */
  readonly stimulus: readonly string[]
  /** The options in display order (the order sent: the response is the position). */
  readonly options: readonly string[]
}

/** The display position of the chosen option, 0-based: what the server's `index` key is compared with. */
export type TextMcResponse = number

const hasText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/** Paragraphs of a text: split at blank lines, trimmed, empty ones dropped. A single line break stays inside its paragraph. */
export function paragraphs(text: string): string[] {
  return text
    .replace(/\r\n?/gu, '\n')
    .split(/\n[ \t]*\n/u)
    .map((p) => p.trim())
    .filter((p) => p !== '')
}

function stimulusOf(raw: unknown): string[] | null {
  if (typeof raw === 'string') return paragraphs(raw)
  if (Array.isArray(raw) && raw.every((p) => typeof p === 'string')) return (raw as string[]).flatMap(paragraphs)
  return null
}

/** The spec of a payload that is text multiple choice (module comment), or null for anything else. */
export function textMcSpec(payload: { readonly stem: string | null; readonly media: Readonly<Record<string, unknown>> | null; readonly options: readonly string[] | null }): TextMcSpec | null {
  const { stem, media, options } = payload
  if (!hasText(stem) || options === null) return null
  if (options.length < TEXT_MC_MIN_OPTIONS || options.length > TEXT_MC_MAX_OPTIONS || !options.every(hasText)) return null
  let stimulus: string[] = []
  if (media !== null) {
    const keys = Object.keys(media)
    if (keys.some((k) => k !== 'stimulus')) return null
    if (keys.length === 1) {
      const s = stimulusOf(media.stimulus)
      if (s === null || s.length === 0) return null
      stimulus = s
    }
  }
  return { stem, stimulus, options: [...options] }
}

/**
 * The stem as the screen shows it: its last paragraph is the question that labels the options, the
 * paragraphs before it (an argument, a short text) are read first, after the stimulus if there is one.
 */
export function splitTextStem(stem: string): { readonly lead: readonly string[]; readonly question: string } {
  const parts = paragraphs(stem)
  const question = parts.pop() ?? stem.trim()
  return { lead: parts, question }
}

/** The response, if it is a position among `count` options. */
export function isTextMcResponse(value: unknown, count: number): value is TextMcResponse {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < count
}
