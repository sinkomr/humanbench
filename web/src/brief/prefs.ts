/**
 * One context's persistable settings (proposal §5.5 `brief_prefs.contexts[]`). Every value is an
 * enum, a topic or line id, a template id, an integer or a `YYYY-MM` month: a property test
 * (`prefs.test.ts`) checks that no free text can be stored (R-17.12). Interests and custom lines
 * are typed, checked and used, but never part of this object; they live in {@link Extras} for the
 * life of the page only.
 *
 * Persistence itself (localStorage `hb.brief.v1` or the save-1.0 `brief_prefs` field, behind the
 * 18+ gate) is ROADMAP AI.7. Until it lands the builder runs without storage (proposal §3.3).
 */

import { PRESET_INFO } from './contexts'
import { PHRASING_FAMILIES, TEMPLATE_BY_ID } from './grammar'
import { isTopicId, topicIndex } from './topics'
import { LENGTHS, MODES, PRESETS, TOPIC_SETTINGS, type ContextPreset, type DestinationId, type Form, type Length, type LineId, type Mode, type Tier, type TopicId, type TopicSetting } from './types'

export interface ContextPrefs {
  /** 1-5. Labels for a set of notes are generated from the preset and destination, never typed. */
  readonly slot: number
  readonly preset: ContextPreset
  readonly destination: DestinationId
  /** The person's choice of short or long notes where the destination allows both. */
  readonly form?: Form
  readonly tier: Tier
  readonly mode: Mode
  readonly length: Length
  readonly topics: Readonly<Record<TopicId, TopicSetting>>
  /** Topics whose line the person ticked off in the preview (their setting is kept). */
  readonly topics_off: readonly TopicId[]
  /** Tick keys switched on beyond the preset's defaults. */
  readonly lines_on: readonly string[]
  /** Tick keys switched off (defaults the person removed). */
  readonly lines_off: readonly string[]
  /** For a phrasing family, the wording the person chose (family root to template id). */
  readonly phrasing: Readonly<Record<string, LineId>>
  /** Bumped on every edit; merging keeps the higher (last writer wins, proposal §5.5). */
  readonly rev: number
}

/** Typed, never-stored extras for the notes: interests and up to three custom lines. */
export interface Extras {
  readonly interests: string
  readonly custom: readonly { readonly text: string; readonly on: boolean }[]
}

export const NO_EXTRAS: Extras = { interests: '', custom: [] }

/** Fresh settings for a preset: its default mode, length and destination, nothing else. */
export function defaultPrefs(preset: ContextPreset, slot = 1): ContextPrefs {
  const p = PRESET_INFO[preset]
  return {
    slot,
    preset,
    destination: p.destination,
    tier: 'T1',
    mode: p.mode,
    length: p.length,
    topics: {},
    topics_off: [],
    lines_on: [],
    lines_off: [],
    phrasing: {},
    rev: 0,
  }
}

/** Tick keys a person can switch (every template's `base` except the locked clauses). */
export const TICK_KEYS: readonly string[] = [
  ...new Set([...TEMPLATE_BY_ID.values()].filter((t) => t.locked !== true && t.id !== 'X1').map((t) => t.base)),
].sort()

const uniqSorted = (xs: readonly string[]): string[] => [...new Set(xs)].sort()

/**
 * Coerces any value into valid settings: unknown enum values fall back to the preset defaults,
 * unknown topics, keys and templates are dropped, lists are de-duplicated and sorted. Used when
 * loading stored settings (AI.7) and by the property tests, so the generator never sees junk.
 */
export function normalizePrefs(x: unknown): ContextPrefs {
  const o = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>
  const preset = PRESETS.includes(o.preset as ContextPreset) ? (o.preset as ContextPreset) : 'general'
  const d = defaultPrefs(preset)
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])
  const topics: Record<string, TopicSetting> = {}
  if (typeof o.topics === 'object' && o.topics !== null && !Array.isArray(o.topics)) {
    for (const id of Object.keys(o.topics).sort((a, b) => topicIndex(a) - topicIndex(b))) {
      const v = (o.topics as Record<string, unknown>)[id]
      if (isTopicId(id) && TOPIC_SETTINGS.includes(v as TopicSetting)) topics[id] = v as TopicSetting
    }
  }
  const phrasing: Record<string, LineId> = {}
  if (typeof o.phrasing === 'object' && o.phrasing !== null && !Array.isArray(o.phrasing)) {
    for (const [base, id] of Object.entries(o.phrasing as Record<string, unknown>)) {
      if (typeof id === 'string' && (PHRASING_FAMILIES[base] ?? []).includes(id)) phrasing[base] = id
    }
  }
  const slot = typeof o.slot === 'number' && Number.isInteger(o.slot) && o.slot >= 1 && o.slot <= 5 ? o.slot : 1
  const rev = typeof o.rev === 'number' && Number.isInteger(o.rev) && o.rev >= 0 && o.rev <= 1_000_000 ? o.rev : 0
  const destination = typeof o.destination === 'string' && /^[a-z][a-z0-9_]{0,40}$/u.test(o.destination) ? o.destination : d.destination
  const form = o.form === 'short' || o.form === 'long' || o.form === 'skill' ? o.form : undefined
  return {
    slot,
    preset,
    destination,
    ...(form === undefined ? {} : { form }),
    tier: o.tier === 'T2' ? 'T2' : 'T1',
    mode: MODES.includes(o.mode as Mode) ? (o.mode as Mode) : d.mode,
    length: LENGTHS.includes(o.length as Length) ? (o.length as Length) : d.length,
    topics,
    topics_off: uniqSorted(list(o.topics_off).filter(isTopicId)),
    lines_on: uniqSorted(list(o.lines_on).filter((k) => TICK_KEYS.includes(k))),
    lines_off: uniqSorted(list(o.lines_off).filter((k) => TICK_KEYS.includes(k))),
    phrasing,
    rev,
  }
}
