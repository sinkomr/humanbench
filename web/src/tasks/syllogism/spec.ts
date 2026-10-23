/**
 * The render payload of the syllogism family (formal deduction, axis LR; DESIGN §3 row 2, §4.2): the wire types of
 * `spec` and `key`, shared by the generator, the verifier, the renderer and the bank twin (`hb.gen.syllogism`), and
 * {@link specProblems}, the renderer's "can I draw this?" check. Light on purpose (no logic), so the lazy renderer
 * chunk can import it.
 *
 * A spec is `{ intro?, premises, question, options }`: the line "The words are made up." (categorical and chain
 * items only), the statements in display order, the question line, and the five options in display order. Never the
 * key.
 */

export interface SyllogismSpec {
  /** "The words are made up." on items over made-up category words; omitted on the everyday conditional items. */
  readonly intro?: string
  /** The statements, in display order (2–5). */
  readonly premises: readonly string[]
  readonly question: string
  /** Five options in display order. */
  readonly options: readonly string[]
}

/** The key: the position of the right option in `spec.options`. */
export interface SyllogismKey {
  readonly index: number
}

/** The chosen option's display position. */
export type SyllogismResponse = number

export const SYLLOGISM_OPTIONS = 5
export const MIN_PREMISES = 2
export const MAX_PREMISES = 5
/** The longest sentence the renderer expects (every generated one is far shorter). */
export const MAX_TEXT = 200

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_TEXT
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Every way `spec` is not drawable by the syllogism renderer (empty = drawable): the lazy loader's `fits` check.
 * Shape only: whether the logic is right is the verifier's job.
 */
export function specProblems(spec: unknown): string[] {
  if (!isObj(spec)) return ['a spec is an object']
  const out: string[] = []
  const allowed = new Set(['intro', 'premises', 'question', 'options'])
  for (const k of Object.keys(spec)) if (!allowed.has(k)) out.push(`unknown spec field ${k}`)
  if ('intro' in spec && !isText(spec.intro)) out.push('intro, when present, is a short text')
  const p = spec.premises
  if (!Array.isArray(p) || p.length < MIN_PREMISES || p.length > MAX_PREMISES || !p.every(isText)) {
    out.push(`premises are ${MIN_PREMISES}–${MAX_PREMISES} short texts`)
  }
  if (!isText(spec.question)) out.push('a spec has a question')
  const o = spec.options
  if (!Array.isArray(o) || o.length !== SYLLOGISM_OPTIONS || !o.every(isText)) out.push(`options are ${SYLLOGISM_OPTIONS} short texts`)
  return out
}
