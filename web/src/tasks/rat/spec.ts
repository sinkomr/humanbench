/**
 * The render payload of a word-links puzzle and its checks (ROADMAP M6.3; DESIGN §3 row 17, §5.4). The spec is what the
 * server sends (`items.payload` of the bank's `hb.rat` record: `stem` = the three cues joined by " / " (informational),
 * `media` = `{ renderer: 'rat_triad_v1', cues: [three lowercase words] }` (authoritative), `options` = null). The solution
 * and the accepted spellings (the key) are never in it. A person answers with the word they typed, trimmed, at most
 * {@link MAX_ANSWER_CHARS} characters; the server compares it with the key (`answers.ts` is the rule).
 */

import { answerKey } from './answers'

/** The `item_type` of a word-links puzzle (`hb.rat`). */
export const RAT_ITEM_TYPE = 'rat_triad'

/** The `media.renderer` of a word-links puzzle (`hb.rat`). */
export const RAT_RENDERER = 'rat_triad_v1'

/** Longest answer, in characters: the entry's `maxlength` and the most the server accepts. */
export const MAX_ANSWER_CHARS = 40

/** Longest cue, in characters (the bank's cues are common words; this only guards the layout). */
export const MAX_CUE_CHARS = 30

/** What the renderer is given: the three cue words, in display order. */
export interface RatSpec {
  readonly cues: readonly [string, string, string]
}

/** The response: the word the person typed, trimmed. */
export type RatResponse = string

/** The served payload of a puzzle, as `hb.items.rows.PublicPayload` has it. */
export interface RatPayload {
  readonly stem?: string | null
  readonly media: { readonly renderer?: unknown; readonly cues?: unknown } | null
  readonly options?: readonly string[] | null
}

/** A cue is a lowercase word, or a short lowercase phrase of letters, spaces, hyphens and apostrophes. */
const CUE_RE = /^\p{Ll}[\p{Ll}' -]*$/u

/** Why a spec cannot be rendered (empty = fine). */
export function specProblems(spec: { readonly cues?: unknown }): string[] {
  const cues: unknown = spec.cues
  if (!Array.isArray(cues) || cues.length !== 3) return ['a puzzle has exactly three cues']
  const out: string[] = []
  if (cues.some((c) => typeof c !== 'string')) return ['every cue is text']
  const words = cues as string[]
  if (words.some((c) => c !== c.trim() || c.length > MAX_CUE_CHARS || !CUE_RE.test(c))) out.push('every cue is a lowercase word')
  if (new Set(words.map(answerKey)).size !== 3) out.push('the cues are distinct')
  return out
}

/** The spec of a served payload, or null if it is not a word-links puzzle that can be rendered. */
export function specFromPayload(payload: RatPayload): RatSpec | null {
  const media = payload.media
  if (media === null || typeof media !== 'object' || media.renderer !== RAT_RENDERER) return null
  if (payload.options !== undefined && payload.options !== null) return null
  const cues: unknown = media.cues
  if (!Array.isArray(cues) || cues.length !== 3) return null
  const spec = { cues: [cues[0], cues[1], cues[2]] as unknown as RatSpec['cues'] }
  return specProblems(spec).length === 0 ? spec : null
}

/** The response, if it is text with 1 to {@link MAX_ANSWER_CHARS} characters once trimmed. */
export function isRatResponse(value: unknown): value is RatResponse {
  if (typeof value !== 'string') return false
  const n = value.trim().length
  return n >= 1 && n <= MAX_ANSWER_CHARS
}
