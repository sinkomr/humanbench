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
 * The finite text items of M3 (a stem and option texts, no `media`) need a text renderer that does
 * not exist yet; they are not supported here, and the day it exists, `SUPPORTED_RENDERERS` and the
 * mapping below are the places to extend.
 */

import type { ServedWire } from './replies'

/** The families the server may serve in M2 (the M1 procedural pool) and a client can draw. */
export const SUPPORTED_RENDERERS = ['rotation', 'matrices', 'series', 'quant'] as const
export type SupportedRenderer = (typeof SUPPORTED_RENDERERS)[number]

export function isSupportedRenderer(name: unknown): name is SupportedRenderer {
  return typeof name === 'string' && (SUPPORTED_RENDERERS as readonly string[]).includes(name)
}

export interface ServedItem {
  /** The server's position of this item in the session (1-based). */
  readonly seq: number
  readonly item_id: string
  readonly item_type: string
  /** The renderer to use (`media.renderer`), or '' when the payload names none. */
  readonly family: string
  /** What the renderer takes (`media` without `renderer`); `{}` when unsupported. */
  readonly spec: object
  /** Number of options of a multiple-choice item (the confidence slider's chance floor), absent for typed entry. */
  readonly options_count?: number
  /** The per-item cap in seconds, or null when the server states none (the session's default applies). */
  readonly time_limit_s: number | null
  /** A renderer exists for it. */
  readonly supported: boolean
}

/** The render spec of `media`: everything but the `renderer` name. */
export function specOf(media: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { renderer: _renderer, ...spec } = media
  return spec
}

/** The session's view of an item the server served as number `seq`. */
export function toServedItem(seq: number, wire: ServedWire): ServedItem {
  const renderer = wire.media === null ? undefined : wire.media.renderer
  const supported = wire.media !== null && isSupportedRenderer(renderer)
  const base = {
    seq,
    item_id: wire.itemId,
    item_type: wire.itemType,
    time_limit_s: wire.timeLimitS,
  }
  const optionsCount = wire.options === null ? undefined : wire.options.length
  return supported
    ? { ...base, family: renderer, spec: specOf(wire.media!), ...(optionsCount === undefined ? {} : { options_count: optionsCount }), supported: true }
    : { ...base, family: typeof renderer === 'string' ? renderer : '', spec: {}, ...(optionsCount === undefined ? {} : { options_count: optionsCount }), supported: false }
}
