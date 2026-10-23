/**
 * An item the server serves, as the session shows it (ROADMAP M2.7; DESIGN §11.2, §12; ROADMAP A1,
 * A11). The server's `item_view` hands over what a client may see of an item and nothing else:
 * its id, type, time limit and the render payload `{stem, media, options}`. No key, no tolerance, no
 * parameters, no status (R-11.1), and not even its axis or family.
 *
 * For the procedural families of M1 the bank stores the generator's `spec` as `media` with the
 * family name added as `media.renderer` (`hb.items.from_twin`: "media is the instance spec plus
 * renderer, which picks the client renderer"), the stem as `stem` when the spec has one, and the
 * options as the labels A, B, ... So the renderer to use is named in the payload, and the spec
 * the renderer takes is the rest of `media`. {@link toServedItem} makes that mapping and nothing
 * else: it never invents a key, and an item it cannot show (an unknown renderer, a payload without
 * `media`) is {@link ServedItem.supported} = false, so the session offers the skip of §13 instead
 * of a blank screen.
 *
 * The text multiple-choice items of the authored banks (M3.11 phase 1: Logical Reasoning, Vocabulary,
 * the three knowledge skills) arrive as a stem and option texts with no `media` and so no renderer
 * name. A payload of exactly that shape (`render/text/spec.ts` `textMcSpec`) is shown by the text
 * renderer, under the client-side name `text_mc`; its spec is the text itself, kept as data.
 *
 * A passage question of the reading bank (M3.11 phase 2) names the renderer `passage_v1` and carries
 * its passage in `media`. A payload of exactly that shape (`render/text/passage.ts` `passageSpec`) is
 * shown under the client-side name `text_passage`: the question by the text renderer, the passage
 * beside it by the session's screen, where it stays across the questions the server serves together
 * ({@link ServedItem.set}).
 *
 * The remaining families (owner, 2026-10-13) are drawn by their own renderers, under the bank's renderer name
 * ({@link SERVED_RENDERERS}): a Fermi estimate (`fermi_v1`: a best guess and an 80% range, with a unit), a
 * word-links puzzle (`rat_triad_v1`: one typed word), an emotion vignette (`emotion_vignette_v1`: one of five
 * feelings) and a situational judgment (`sjt_rating_v1`: four ratings). A logic game's question (`logic_game_v1`)
 * is drawn like a passage question, its setup in the passage's place (`render/text/passage.ts` `logicGameSpec`).
 * Each payload is checked by its family's own `specFromPayload`; one that does not fit is unsupported, so the
 * session offers the skip of §13 instead of half a question.
 */

import { LOGIC_GAME_MEDIA_RENDERER, PASSAGE_MEDIA_RENDERER, TEXT_PASSAGE_RENDERER, logicGameSpec, passageSpec } from '../render/text/passage'
import { TEXT_MC_RENDERER, textMcSpec } from '../render/text/spec'
import type { ServedWire, SetPlace } from './replies'

/**
 * The `media.renderer` names of the remaining families (`tasks/<family>/spec.ts`, written out here: the task modules
 * travel with their renderers, outside the entry chunk, `session/served-renderers.ts`).
 */
export const FERMI_RENDERER = 'fermi_v1'
export const RAT_RENDERER = 'rat_triad_v1'
export const EMOTION_RENDERER = 'emotion_vignette_v1'
export const SJT_RENDERER = 'sjt_rating_v1'
/** The longest typed word-links answer (`tasks/rat/spec.ts` MAX_ANSWER_CHARS). */
const RAT_MAX_CHARS = 40
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/** A typed magnitude of a Fermi answer lies in [1e-30, 1e30], and its 80% range spans at most 8 dex (`tasks/fermi/scoring.ts`). */
const FERMI_MIN = 1e-30
const FERMI_MAX = 1e30
const FERMI_MAX_DEX = 8
const FERMI_MEDIA_FIELDS: readonly string[] = ['renderer', 'dimension', 'units', 'interval_pct']

/**
 * The shape of a served Fermi payload (`tasks/fermi/spec.ts` `specFromPayload` checks it fully). The units table and
 * the number reader stay out of the entry chunk with the renderer (`session/served-renderers.ts`), which checks the
 * spec against the table when it arrives and lets the session offer the skip if it does not fit.
 */
function fermiShape(wire: ServedWire): { readonly stem: string; readonly dimension: string; readonly units: readonly string[]; readonly interval_pct: 80 } | null {
  const media = wire.media
  if (media === null || media.renderer !== FERMI_RENDERER || wire.options !== null) return null
  if (Object.keys(media).some((k) => !FERMI_MEDIA_FIELDS.includes(k))) return null
  const units = media.units
  if (typeof wire.stem !== 'string' || wire.stem.trim() === '' || typeof media.dimension !== 'string' || media.dimension === '' || media.interval_pct !== 80) return null
  if (!Array.isArray(units) || units.length === 0 || !units.every((u) => typeof u === 'string' && u !== '') || new Set(units).size !== units.length) return null
  return { stem: wire.stem, dimension: media.dimension, units: [...(units as string[])], interval_pct: 80 }
}

const isFermiMagnitude = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= FERMI_MIN && v <= FERMI_MAX

/**
 * The shapes of the other three payloads (each family's `specFromPayload` checks it fully when its renderer arrives):
 * a triad's three cues and no options; a vignette's situation and five feelings; a judgment's situation, question and
 * four responses.
 */
function ratShape(wire: ServedWire): { readonly cues: readonly string[] } | null {
  const cues = wire.media?.cues
  if (wire.options !== null || !Array.isArray(cues) || cues.length !== 3 || !cues.every(isText)) return null
  if (Object.keys(wire.media!).some((k) => k !== 'renderer' && k !== 'cues')) return null
  return { cues: [...(cues as string[])] }
}
function emotionShape(wire: ServedWire): { readonly stem: string; readonly options: readonly string[] } | null {
  if (!isText(wire.stem) || wire.options === null || wire.options.length !== 5 || !wire.options.every(isText)) return null
  return { stem: wire.stem, options: [...wire.options] }
}
function sjtShape(wire: ServedWire): { readonly scenario: string; readonly question: string; readonly responses: readonly string[] } | null {
  const question = wire.media?.question
  if (!isText(wire.stem) || !isText(question) || wire.options === null || wire.options.length !== 4 || !wire.options.every(isText)) return null
  return { scenario: wire.stem, question, responses: [...wire.options] }
}

/** The renderers of the remaining families, by the bank's renderer name (`ServedItem.family`). */
export const SERVED_RENDERERS = [FERMI_RENDERER, RAT_RENDERER, EMOTION_RENDERER, SJT_RENDERER] as const
export type ServedRenderer = (typeof SERVED_RENDERERS)[number]

/**
 * The families whose answers are not rated for confidence: DESIGN §3 row 12 asks for a confidence rating on every
 * tier-a answer and an 80% range on Fermi items. A Fermi estimate states its own range, a situational judgment has
 * no right answer to be sure of, and an emotion vignette is tier c; the word links and the logic games (tier a) are
 * rated like every other question.
 */
export const UNRATED_FAMILIES: readonly string[] = Object.freeze([FERMI_RENDERER, SJT_RENDERER, EMOTION_RENDERER])

/** Whether the confidence slider follows an answer to `item`. */
export function asksConfidence(item: Pick<ServedItem, 'family'>): boolean {
  return !UNRATED_FAMILIES.includes(item.family)
}

/** The families the server may serve in M2 (the M1 procedural pool) and a client can draw. */
export const SUPPORTED_RENDERERS = ['rotation', 'matrices', 'series', 'quant', 'cubenet', 'figure2d', 'folding', 'qdata', 'syllogism'] as const
export type SupportedRenderer = (typeof SUPPORTED_RENDERERS)[number]

export function isSupportedRenderer(name: unknown): name is SupportedRenderer {
  return typeof name === 'string' && (SUPPORTED_RENDERERS as readonly string[]).includes(name)
}

export interface ServedItem {
  /** The server's position of this item in the session (1-based). */
  readonly seq: number
  readonly item_id: string
  readonly item_type: string
  /** The renderer to use: `media.renderer`, `text_mc` for text multiple choice, or '' when the payload fits none. */
  readonly family: string
  /** What the renderer takes (`media` without `renderer`; the text of a text item); `{}` when unsupported. */
  readonly spec: object
  /** Number of options of a multiple-choice item (the confidence scale's chance floor), absent for typed entry. */
  readonly options_count?: number
  /** The per-item cap in seconds, or null when the server states none (the session's default applies). */
  readonly time_limit_s: number | null
  /** A renderer exists for it. */
  readonly supported: boolean
  /** Where the question stands in the set the server serves it in (a passage's questions); absent for any other item. */
  readonly set?: SetPlace
}

/** The render spec of `media`: everything but the `renderer` name. */
export function specOf(media: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { renderer: _renderer, ...spec } = media
  return spec
}

/** The session's view of an item the server served as number `seq`. */
export function toServedItem(seq: number, wire: ServedWire, set: SetPlace | null = null): ServedItem {
  const renderer = wire.media === null ? undefined : wire.media.renderer
  const supported = wire.media !== null && isSupportedRenderer(renderer)
  const base = {
    seq,
    item_id: wire.itemId,
    item_type: wire.itemType,
    time_limit_s: wire.timeLimitS,
    ...(set === null ? {} : { set }),
  }
  const optionsCount = wire.options === null ? undefined : wire.options.length
  const count = optionsCount === undefined ? {} : { options_count: optionsCount }
  if (supported) return { ...base, family: renderer, spec: specOf(wire.media!), ...count, supported: true }
  // No renderer named: text multiple choice if the payload is exactly that (M3.11 phase 1), else nothing this build draws.
  const text = renderer === undefined ? textMcSpec(wire) : null
  if (text !== null) return { ...base, family: TEXT_MC_RENDERER, spec: text, options_count: text.options.length, supported: true }
  // A passage question (M3.11 phase 2), or a logic game's question with its setup in the passage's place.
  const passage = renderer === PASSAGE_MEDIA_RENDERER ? passageSpec(wire) : renderer === LOGIC_GAME_MEDIA_RENDERER ? logicGameSpec(wire) : null
  if (passage !== null) return { ...base, family: TEXT_PASSAGE_RENDERER, spec: passage, options_count: passage.options.length, supported: true }
  // The remaining families: each by its own renderer, when its payload fits.
  const family = servedSpec(renderer, wire)
  if (family !== null) return { ...base, family: renderer as ServedRenderer, spec: family.spec, ...(family.options === undefined ? {} : { options_count: family.options }), supported: true }
  return { ...base, family: typeof renderer === 'string' ? renderer : '', spec: {}, ...count, supported: false }
}

function servedSpec(renderer: unknown, wire: ServedWire): { readonly spec: object; readonly options?: number } | null {
  switch (renderer) {
    case FERMI_RENDERER: {
      const spec = fermiShape(wire)
      return spec === null ? null : { spec }
    }
    case RAT_RENDERER: {
      const spec = ratShape(wire)
      return spec === null ? null : { spec }
    }
    case EMOTION_RENDERER: {
      const spec = emotionShape(wire)
      return spec === null ? null : { spec, options: spec.options.length }
    }
    case SJT_RENDERER: {
      const spec = sjtShape(wire)
      return spec === null ? null : { spec, options: spec.responses.length }
    }
    default:
      return null
  }
}

/**
 * Whether `response` is an answer the renderer of a served item could have given (the server checks it again, with
 * the key: `hb.response_fits`): an option position for a multiple-choice item; for a Fermi estimate
 * `{value, unit, low, high}` with magnitudes in range, a unit the entry offers, low ≤ value ≤ high and at most 8 dex across; for
 * a situational judgment one whole rating 1 to 4 per response; for a word-links puzzle 1 to 40 characters of text;
 * text for a typed answer. Anything else is not sent.
 */
export function servedResponseFits(item: ServedItem, response: unknown): boolean {
  switch (item.family) {
    case FERMI_RENDERER: {
      if (typeof response !== 'object' || response === null || Array.isArray(response)) return false
      const r = response as Record<string, unknown>
      if (Object.keys(r).sort().join(',') !== 'high,low,unit,value') return false
      if (!isFermiMagnitude(r.value) || !isFermiMagnitude(r.low) || !isFermiMagnitude(r.high) || typeof r.unit !== 'string') return false
      // a unit the entry offers (all of the item's dimension; the server checks the dimension again)
      if (!((item.spec as { units?: readonly string[] }).units ?? []).includes(r.unit)) return false
      return r.low <= r.value && r.value <= r.high && Math.log10(r.high) - Math.log10(r.low) <= FERMI_MAX_DEX
    }
    case SJT_RENDERER:
      return Array.isArray(response) && response.length === item.options_count && response.every((r) => typeof r === 'number' && Number.isInteger(r) && r >= 1 && r <= 4)
    case RAT_RENDERER:
      return typeof response === 'string' && response.trim().length >= 1 && response.trim().length <= RAT_MAX_CHARS
  }
  if (item.options_count !== undefined) return typeof response === 'number' && Number.isInteger(response) && response >= 0 && response < item.options_count
  return typeof response === 'string' && response.length <= 256
}
