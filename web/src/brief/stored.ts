/**
 * The persistable part of the builder and its stored form (AI.7; proposal §5.5; requirements R-17.1,
 * R-17.12): what goes into a save's `brief_prefs` and how it comes back. Pure.
 *
 * - **Out:** `toStored` writes sets of notes as enums, ids, versions, months and integers, never
 *   interests, custom lines or names (they are typed, used and never stored). Empty or default
 *   optional fields are left out, so the stored form is small and matches the proposal's example.
 * - **In:** `fromStored` reads settings that may have been written by an older or a newer build or
 *   edited by hand: every stored topic id resolves through the alias map (a retired id becomes its
 *   successors, so overrides and the fit log are never orphaned), anything unknown is dropped, and
 *   every set goes through `normalizePrefs`, so the generator never sees junk.
 *
 * The stored type is the save module's (`save/types.ts`); only the type is imported here, so the
 * notes generator still reads nothing of results or saves at run time (`scripts/brief-source.test.ts`).
 */

import type { BriefContextRemovedV1, BriefContextV1, BriefFitV1, BriefPrefsV1 } from '../save/types'
import { isFitEntry, type FitEntry } from './fit'
import { normalizePrefs, type ContextPrefs } from './prefs'
import type { CopiedRecord } from './returning'
import { GROUPS_VERSION, TOPICS_VERSION, TOPIC_ALIASES, resolveTopicId } from './topics'
import { MONTH_RE, TOPIC_SETTINGS, type TopicSetting } from './types'

export type StoredPrefs = BriefPrefsV1

/** A set of notes the person removed: its slot and the rev a new set in that slot must beat. */
export interface Tombstone {
  readonly slot: number
  readonly rev: number
}

/** The part of the builder that is kept between visits. */
export interface PersistedState {
  readonly contexts: readonly ContextPrefs[]
  /** What was last copied or downloaded for each set (parallel to `contexts`), or null. */
  readonly copied: readonly (CopiedRecord | null)[]
  readonly tombstones: readonly Tombstone[]
  readonly fitLog: readonly FitEntry[]
}

const MAX_REV = 1_000_000

/** One set of notes in its stored form. */
export function storedContext(c: ContextPrefs, copied: CopiedRecord | null): BriefContextV1 {
  const out: BriefContextV1 = {
    slot: c.slot,
    preset: c.preset,
    destination: c.destination,
    ...(c.form === undefined ? {} : { form: c.form }),
    tier: c.tier,
    mode: c.mode,
    length: c.length,
    topics: { ...c.topics },
    ...(c.topics_off.length === 0 ? {} : { topics_off: [...c.topics_off] }),
    lines_on: [...c.lines_on],
    lines_off: [...c.lines_off],
    ...(Object.keys(c.phrasing).length === 0 ? {} : { phrasing: { ...c.phrasing } }),
    ...(copied === null || copied.lines.length === 0 ? {} : { copied: { templates: copied.templates, month: copied.month, lines: copied.lines.map((l) => ({ id: l.id, v: l.v })) } }),
    rev: Math.min(c.rev, MAX_REV),
  }
  return out
}

/** The settings as they go into a save. `asOf` is the current month (`YYYY-MM`). */
export function toStored(state: PersistedState, asOf: string): StoredPrefs {
  const live = state.contexts.map((c, i) => storedContext(c, state.copied[i] ?? null))
  const liveSlots = new Set(state.contexts.map((c) => c.slot))
  const removed: BriefContextRemovedV1[] = state.tombstones.filter((t) => !liveSlots.has(t.slot)).map((t) => ({ slot: t.slot, rev: Math.min(t.rev, MAX_REV), removed: true }))
  return {
    v: 1,
    topics: TOPICS_VERSION,
    groups: GROUPS_VERSION,
    notes_as_of: asOf,
    contexts: [...live, ...removed].sort((a, b) => a.slot - b.slot),
    fit_log: state.fitLog.map((f): BriefFitV1 => ({ id: f.id, topic: f.topic, verdict: f.verdict, month: f.month })),
  }
}

/** Of several settings that map to one topic, the one that gives the most help (build, then ask first, then skip). */
const HELP_ORDER: readonly TopicSetting[] = ['build', 'ask_first', 'skip']
const mostHelp = (a: TopicSetting, b: TopicSetting): TopicSetting => (HELP_ORDER.indexOf(a) <= HELP_ORDER.indexOf(b) ? a : b)

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A stored `copied` record, or null when it is not a well-formed one. */
function readCopied(x: unknown): CopiedRecord | null {
  if (!isObj(x) || typeof x.templates !== 'string' || typeof x.month !== 'string' || !MONTH_RE.test(x.month) || !Array.isArray(x.lines)) return null
  const lines = x.lines.filter((l): l is { id: string; v: string } => isObj(l) && typeof l.id === 'string' && /^[A-Za-z][A-Za-z0-9.]{0,15}$/u.test(l.id) && typeof l.v === 'string' && /^[0-9]{1,4}$/u.test(l.v))
  return { templates: x.templates, month: x.month, lines: lines.map((l) => ({ id: l.id, v: l.v })) }
}

/** A stored set of notes with its topic ids resolved through the alias map, ready for `normalizePrefs`. */
function resolveContext(c: Record<string, unknown>, aliases: Readonly<Record<string, readonly string[]>>): Record<string, unknown> {
  const topics: Record<string, TopicSetting> = {}
  if (isObj(c.topics)) {
    for (const [id, s] of Object.entries(c.topics)) {
      if (!TOPIC_SETTINGS.includes(s as TopicSetting)) continue
      for (const now of resolveTopicId(id, aliases)) topics[now] = topics[now] === undefined ? (s as TopicSetting) : mostHelp(topics[now] as TopicSetting, s as TopicSetting)
    }
  }
  const off = Array.isArray(c.topics_off) ? c.topics_off.filter((t): t is string => typeof t === 'string').flatMap((t) => resolveTopicId(t, aliases)) : []
  return { ...c, topics, topics_off: off }
}

export interface ReadPrefs extends PersistedState {
  /** The month the settings were last changed (`YYYY-MM`), or null when unreadable. */
  readonly notesAsOf: string | null
}

/**
 * Settings read back from a save (`brief_prefs`), or null when there is nothing usable. Sets are
 * ordered by slot, at most five; removed sets become tombstones; fit notes are kept when
 * well-formed, their topic resolved through `aliases` (a note on a retired topic is copied to each
 * successor, and dropped when there is none).
 */
export function fromStored(stored: unknown, aliases: Readonly<Record<string, readonly string[]>> = TOPIC_ALIASES): ReadPrefs | null {
  if (!isObj(stored) || !Array.isArray(stored.contexts)) return null
  const contexts: ContextPrefs[] = []
  const copied: (CopiedRecord | null)[] = []
  const tombstones: Tombstone[] = []
  const seen = new Set<number>()
  const entries = stored.contexts.filter(isObj).sort((a, b) => Number(a.slot) - Number(b.slot))
  for (const c of entries) {
    const slot = c.slot
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1 || slot > 5 || seen.has(slot)) continue
    seen.add(slot)
    const rev = typeof c.rev === 'number' && Number.isInteger(c.rev) && c.rev >= 0 ? Math.min(c.rev, MAX_REV) : 0
    if (c.removed === true) {
      tombstones.push({ slot, rev })
      continue
    }
    contexts.push(normalizePrefs(resolveContext(c, aliases)))
    copied.push(readCopied(c.copied))
  }
  const fitLog: FitEntry[] = []
  if (Array.isArray(stored.fit_log)) {
    for (const f of stored.fit_log) {
      if (!isFitEntry(f)) continue
      for (const topic of resolveTopicId(f.topic, aliases)) fitLog.push({ id: f.id, topic, verdict: f.verdict, month: f.month })
    }
  }
  const asOf = typeof stored.notes_as_of === 'string' && MONTH_RE.test(stored.notes_as_of) ? stored.notes_as_of : null
  return { contexts, copied, tombstones, fitLog, notesAsOf: asOf }
}

