/**
 * The render payload of an unusual-uses prompt and its response (ROADMAP M6.4; DESIGN §3 row 17, §5.4, §8). The spec is
 * what the server would send (`media` = `{ renderer: 'aut_v1', object, seconds? }`, `options` = null): the object and the
 * length of the round. There is no key: scoring is by distance in an embedding space (`scoring.ts`), not by a stored
 * answer. A person answers with the ideas they added, cleaned (`cleanResponse`) and free of personal information
 * (`personalInfo`: DESIGN §8, the save file holds no free text but these answers), and the time the round took.
 */

import { cleanResponse, MAX_RESPONSE_CHARS, personalInfo } from './text'

/** The `item_type` of an unusual-uses prompt. */
export const AUT_ITEM_TYPE = 'aut_prompt'

/** The `media.renderer` of an unusual-uses prompt. */
export const AUT_RENDERER = 'aut_v1'

/** The length of a round when the spec says nothing (DESIGN §5.4: 2 objects x 90 s). */
export const AUT_DEFAULT_SECONDS = 90

/** Shortest and longest round a spec may ask for, in seconds (a development override may go down to the shortest). */
export const AUT_MIN_SECONDS = 5
export const AUT_MAX_SECONDS = 600

/** Longest object, in characters (the objects are everyday nouns; this only guards the layout). */
export const AUT_MAX_OBJECT_CHARS = 40

/** The most ideas a round keeps (a person types a handful in 90 s; the cap only bounds the list and the scoring work). */
export const AUT_MAX_IDEAS = 50

/** What the renderer is given: the object and the length of the round. */
export interface AutSpec {
  readonly object: string
  /** Length of the round in seconds; {@link AUT_DEFAULT_SECONDS} (90) when a payload gives none. */
  readonly seconds: number
}

/** The response: the ideas in the order they were added, and how long the round lasted from its onset (never more than its length). */
export interface AutResponse {
  /** Cleaned (`cleanResponse`), non-empty, free of personal information; at most {@link AUT_MAX_IDEAS}. */
  readonly responses: string[]
  /** Milliseconds from the onset frame to the end of the round (`performance.now()` timeline), at most the round's length. */
  readonly elapsedMs: number
}

/** The served payload of a prompt, as `hb.items.rows.PublicPayload` has it. */
export interface AutPayload {
  readonly stem?: string | null
  readonly media: { readonly renderer?: unknown; readonly object?: unknown; readonly seconds?: unknown } | null
  readonly options?: readonly string[] | null
}

/** A spec for `object`, with the default length unless one is given. */
export function autSpec(object: string, seconds: number = AUT_DEFAULT_SECONDS): AutSpec {
  return { object, seconds }
}

/** Why a spec cannot be rendered (empty = fine). */
export function specProblems(spec: { readonly object?: unknown; readonly seconds?: unknown }): string[] {
  const out: string[] = []
  const object: unknown = spec.object
  if (typeof object !== 'string' || object.trim() === '' || object !== object.trim() || object.length > AUT_MAX_OBJECT_CHARS) {
    out.push(`the object is a short text (1 to ${AUT_MAX_OBJECT_CHARS} characters, no spaces at either end)`)
  } else if (cleanResponse(object) !== object) {
    out.push('the object has no line breaks, control characters or repeated spaces')
  }
  const seconds: unknown = spec.seconds
  if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < AUT_MIN_SECONDS || seconds > AUT_MAX_SECONDS) {
    out.push(`the round lasts a whole number of seconds from ${AUT_MIN_SECONDS} to ${AUT_MAX_SECONDS}`)
  }
  return out
}

/** The spec of a served payload, or null if it is not an unusual-uses prompt that can be rendered. */
export function specFromPayload(payload: AutPayload): AutSpec | null {
  const media = payload.media
  if (media === null || typeof media !== 'object' || media.renderer !== AUT_RENDERER) return null
  if (payload.options !== undefined && payload.options !== null) return null
  const seconds: unknown = media.seconds === undefined ? AUT_DEFAULT_SECONDS : media.seconds
  const spec = { object: media.object, seconds }
  return specProblems(spec).length === 0 ? (spec as AutSpec) : null
}

/** The round length the renderer uses: the spec's, or the default when it is not a usable number. */
export function secondsOf(spec: { readonly seconds?: unknown }): number {
  const s: unknown = spec.seconds
  return typeof s === 'number' && Number.isFinite(s) && s >= 1 ? s : AUT_DEFAULT_SECONDS
}

/**
 * True iff `value` is a response the renderer sends: a list of at most {@link AUT_MAX_IDEAS} ideas, each already cleaned,
 * non-empty, within {@link MAX_RESPONSE_CHARS} and without personal information, and a finite, non-negative duration.
 */
export function isAutResponse(value: unknown): value is AutResponse {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { responses?: unknown; elapsedMs?: unknown }
  if (!Array.isArray(v.responses) || v.responses.length > AUT_MAX_IDEAS) return false
  for (const r of v.responses as unknown[]) {
    if (typeof r !== 'string' || r === '' || cleanResponse(r) !== r || personalInfo(r).length > 0) return false
  }
  return typeof v.elapsedMs === 'number' && Number.isFinite(v.elapsedMs) && v.elapsedMs >= 0
}
