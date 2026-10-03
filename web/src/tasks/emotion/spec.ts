/**
 * The render payload of an emotion vignette and its checks (ROADMAP M6.1; DESIGN §3 row 16, §5.1, R-5.6.2).
 * The spec is what the server sends (`items.payload`: the stem, the `media` renderer name and the five
 * options of the bank's `hb.emo.record`); the appraisal profile, the cues, the rule-engine emotion and the
 * key are never in it. A person answers with the display position of the option they chose (the same
 * response as every multiple-choice item, `mcResponseIndex`).
 */

/** The `media.renderer` of an emotion vignette (`hb.emo.record.RENDERER`). */
export const EMOTION_RENDERER = 'emotion_vignette_v1'

/** The `item_type` of an emotion vignette (`hb.emo.record.ITEM_TYPE`). */
export const EMOTION_ITEM_TYPE = 'emotion_vignette_mc'

/** Options in every vignette (`hb.emo.appraisal.N_OPTIONS`; five makes the model 2PL, A9). */
export const EMOTION_OPTIONS = 5

/** What the renderer is given: the scenario with its closing question, and the options in display order. */
export interface EmotionSpec {
  readonly stem: string
  readonly options: readonly string[]
}

/** The response: the display position of the chosen option, 0 … 4. */
export type EmotionResponse = number

/** The served payload of a vignette, as `hb.items.rows.PublicPayload` has it. */
export interface EmotionPayload {
  readonly stem: string | null
  readonly media: { readonly renderer?: unknown } | null
  readonly options: readonly string[] | null
}

/** Why a spec cannot be rendered (empty = fine). */
export function specProblems(spec: EmotionSpec): string[] {
  const out: string[] = []
  if (typeof spec.stem !== 'string' || spec.stem.trim() === '') out.push('a vignette has a stem')
  if (!Array.isArray(spec.options) || spec.options.length !== EMOTION_OPTIONS) out.push(`a vignette has exactly ${EMOTION_OPTIONS} options`)
  else {
    if (spec.options.some((o) => typeof o !== 'string' || o.trim() === '')) out.push('every option is a word')
    if (new Set(spec.options.map((o) => o.trim().toLowerCase())).size !== spec.options.length) out.push('the options are distinct')
  }
  return out
}

/** The spec of a served payload, or null if it is not a vignette that can be rendered. */
export function specFromPayload(payload: EmotionPayload): EmotionSpec | null {
  if (payload.media?.renderer !== EMOTION_RENDERER || payload.stem === null || payload.options === null) return null
  const spec: EmotionSpec = { stem: payload.stem, options: payload.options }
  return specProblems(spec).length === 0 ? spec : null
}

/** The closing question of a vignette: "How is Maya most likely to feel?" */
const QUESTION_RE = /\s*(How (?:is|does) [A-Z][A-Za-z' -]* most likely (?:to feel|feel)\?)\s*$/

/**
 * The stem as the screen shows it: the scenario, and the question that labels the options. A stem
 * without the closing question is all scenario, and the options get the generic label.
 */
export function splitStem(stem: string): { readonly scenario: string; readonly question: string | null } {
  const m = QUESTION_RE.exec(stem)
  if (!m) return { scenario: stem.trim(), question: null }
  return { scenario: stem.slice(0, m.index).trim(), question: m[1] as string }
}

/** The response, if it is a position among `count` options. */
export function isEmotionResponse(value: unknown, count: number = EMOTION_OPTIONS): value is EmotionResponse {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < count
}
