/**
 * The render payload of a situational judgment item and the answers a person gives (ROADMAP M6.2; DESIGN §3 row 16,
 * §5.2, §5.3, §14.6 ex. 15). The spec is what the server sends (`items.payload`: the stem, the `media` renderer name with
 * the question, and the four response texts of the bank's `hb.sjt` record). The key, four effectiveness ratings (floats in
 * [1, 4]) from the expert and AI ensemble, blended later with consensus (§5.2), is never in it and never reaches this repo.
 *
 * Two ways to answer, both in display order (A18: the options the person saw, in the order they saw them):
 * - rate mode (the default): one rating from 1 to 4 for each of the four responses, `readonly number[]`;
 * - most/least mode: the position of the response that would work best and the position of the one that would work least
 *   well, `{ most, least }`, two different positions.
 * `scoring.ts` turns either into a closeness to the key.
 */

/** The `item_type` of an SJT item that is rated (`hb.sjt` `ITEM_TYPE`). */
export const SJT_ITEM_TYPE = 'sjt_rating'

/** The `media.renderer` of an SJT item (`hb.sjt` `RENDERER`). */
export const SJT_RENDERER = 'sjt_rating_v1'

/** Responses in every item (DESIGN §5.3: a scenario and four responses). */
export const SJT_OPTIONS = 4

/** Points of the rating scale: 1 (very ineffective) to 4 (very effective). */
export const RATING_LEVELS = 4

/** What the renderer is given: the situation, the question about the responses, and the four responses in display order. */
export interface SjtSpec {
  /** The situation, in the second person. */
  readonly scenario: string
  /** The question the responses answer ("How well would each response work?"). */
  readonly question: string
  /** The four responses, in display order. */
  readonly responses: readonly string[]
}

/** Rate mode: a rating from 1 to 4 for each response, in display order. */
export type SjtRatings = readonly number[]

/** Most/least mode: the display positions (0 to 3) of the response that would work best and of the one that would work least well. */
export interface SjtMostLeast {
  readonly most: number
  readonly least: number
}

/** What a person answers: ratings or a most/least choice (the renderer's `mode` says which). */
export type SjtResponse = SjtRatings | SjtMostLeast

/** How the renderer asks. */
export type SjtMode = 'rate' | 'most_least'

/** The served payload of an SJT item, as `hb.items.rows.PublicPayload` has it. */
export interface SjtPayload {
  readonly stem: string | null
  readonly media: { readonly renderer?: unknown; readonly question?: unknown } | null
  readonly options: readonly string[] | null
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/** Why a spec cannot be rendered (empty = fine). */
export function specProblems(spec: SjtSpec): string[] {
  const out: string[] = []
  if (!isText(spec.scenario)) out.push('a situation has a scenario')
  if (!isText(spec.question)) out.push('a situation has a question')
  if (!Array.isArray(spec.responses) || spec.responses.length !== SJT_OPTIONS) out.push(`a situation has exactly ${SJT_OPTIONS} responses`)
  else {
    if (spec.responses.some((r) => !isText(r))) out.push('every response is a text')
    if (new Set(spec.responses.map((r) => (typeof r === 'string' ? r.trim().toLowerCase() : r))).size !== spec.responses.length) out.push('the responses are distinct')
  }
  return out
}

/** The spec of a served payload, or null if it is not a situation that can be rendered. */
export function specFromPayload(payload: SjtPayload): SjtSpec | null {
  const media = payload.media
  if (media?.renderer !== SJT_RENDERER || !isText(media.question) || payload.stem === null || payload.options === null) return null
  const spec: SjtSpec = { scenario: payload.stem, question: media.question, responses: payload.options }
  return specProblems(spec).length === 0 ? spec : null
}

/** True iff `value` is a rating in the scale: an integer from 1 to {@link RATING_LEVELS}. */
export function isRatingLevel(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= RATING_LEVELS
}

/** True iff `value` is a complete set of ratings: {@link SJT_OPTIONS} integers from 1 to 4. */
export function isSjtRatings(value: unknown, count: number = SJT_OPTIONS): value is SjtRatings {
  return Array.isArray(value) && value.length === count && value.every(isRatingLevel)
}

/** True iff `value` is a most/least choice among `count` responses: two different display positions. */
export function isMostLeast(value: unknown, count: number = SJT_OPTIONS): value is SjtMostLeast {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { most, least } = value as { most?: unknown; least?: unknown }
  const position = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < count
  return position(most) && position(least) && most !== least
}
