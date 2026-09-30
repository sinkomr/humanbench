/**
 * The notes settings inside a save file (`brief_prefs`; Phase AI, ROADMAP AI.7; proposal §5.5;
 * requirements R-17.1, R-17.12): the patterns the shape validator and the JSON Schema share, and
 * the merge that lets two devices' saves of one person join without losing either one's edits.
 *
 * This module knows nothing of the notes grammar or the topic list (the save module stays light and
 * the M2 server can reuse the schema): it only checks and joins shapes. Whether a topic id or a line
 * key is one this build knows is decided when the settings are loaded (`brief/stored.ts`), where
 * unknown ids are dropped and retired ids are resolved through the alias map.
 *
 * **Merge** (`mergeBriefPrefs`) is a join, so merging any saves in any order and grouping gives one
 * result (idempotent, commutative, associative; property-tested):
 * - a set of notes is kept per slot: the copy with the higher `rev` wins, and equal revs fall back
 *   to the canonical JSON, a total order that never depends on argument order. So no day-level
 *   timestamp is stored (proposal §5.5). A removed set is a copy with `removed: true` and a higher
 *   rev, so removing a set survives a merge with an older save;
 * - fit notes join as a union of distinct notes (identical bodies collapse; a shared id with a
 *   different body is kept, not overwritten), then keep the newest {@link FIT_KEEP_PER_TOPIC} per
 *   topic under the order (month, id, canonical JSON). Keeping the newest k of each topic is a join
 *   too (a note is only ever dropped for k newer notes of its own topic), and the fit rule looks at
 *   four (`brief/fit.ts`), so nothing it needs is lost;
 * - `notes_as_of` is the later month; `topics` and `groups` are the later vocabulary versions;
 *   `last_zones` come from the copy with the later `notes_as_of` (proposal §5.5). The winner is the
 *   copy with the greatest (`notes_as_of`, canonical `last_zones`), whether or not it has zones: a
 *   copy without zones and a later month means the zones were cleared. Choosing by the same key that
 *   the merged month is the maximum of keeps the join associative.
 */

import { jcs } from './jcs'
import type { BriefContextRemovedV1, BriefContextV1, BriefFitV1, BriefPrefsV1, BriefTopicSetting } from './types'

/** Patterns shared with `schema/save-v1.json` (`brief_*` definitions). */
export const BRIEF_MONTH_RE = /^(?:19|20|21)[0-9]{2}-(?:0[1-9]|1[0-2])$/u
export const BRIEF_TOPIC_ID_RE = /^[a-z]+\/[a-z0-9_]+(?:\/[a-z0-9_]+)?$/u
export const BRIEF_TEMPLATE_ID_RE = /^[A-Za-z][A-Za-z0-9.]{0,15}$/u
export const BRIEF_LINE_KEY_RE = /^[A-Za-z][A-Za-z0-9]{0,15}$/u
export const BRIEF_TOPICS_VERSION_RE = /^topics-v([0-9]{1,4})$/u
export const BRIEF_GROUPS_VERSION_RE = /^g([0-9]{1,4})$/u
export const BRIEF_TEMPLATES_STAMP_RE = /^[0-9]{4}\.[0-9]{2}$/u
export const BRIEF_WORDING_V_RE = /^[0-9]{1,4}$/u
export const BRIEF_FIT_ID_RE = /^[0-9a-f]{8}$/u

/**
 * The closed sets of `schema/save-v1.json`; `brief/types.ts` and `brief/surfaces.json` hold the same lists
 * (tests keep them equal). Adding a value is an additive change of the schema (a minor version), like a
 * new destination in `surfaces.json`.
 */
export const BRIEF_DESTINATIONS = [
  'chatgpt_instructions',
  'chatgpt_project',
  'claude_preferences',
  'claude_project',
  'gemini_instructions',
  'gemini_gem',
  'microsoft_copilot',
  'claude_code_skill',
  'claude_code_rules',
  'codex_agents',
  'gemini_cli',
  'cursor',
  'github_copilot',
  'own_app',
  'just_me',
] as const
export const BRIEF_PRESETS = ['coding', 'learning', 'reading', 'numbers', 'writing', 'general'] as const
export const BRIEF_MODES = ['do', 'learn'] as const
export const BRIEF_LENGTHS = ['short', 'standard', 'detailed'] as const
export const BRIEF_TIERS = ['T1', 'T2'] as const
export const BRIEF_FORMS = ['short', 'long', 'skill'] as const
export const BRIEF_SETTINGS = ['skip', 'ask_first', 'build'] as const
export const BRIEF_VERDICTS = ['too_basic', 'about_right', 'too_much'] as const

export const BRIEF_MAX_SLOTS = 5
export const BRIEF_MAX_REV = 1_000_000
export const BRIEF_MAX_TOPICS = 40
export const BRIEF_MAX_LINES = 60
export const BRIEF_MAX_PHRASING = 8
export const BRIEF_MAX_FIT = 2000
export const BRIEF_MAX_ZONES = 200

/** Fit notes kept per topic by a merge. The fit rule uses the newest four (`brief/fit.ts`). */
export const FIT_KEEP_PER_TOPIC = 12

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const sortedUnique = (xs: readonly string[]): string[] => [...new Set(xs)].sort(cmp)
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export const isRemovedContext = (c: BriefContextV1 | BriefContextRemovedV1): c is BriefContextRemovedV1 => (c as BriefContextRemovedV1).removed === true

/** The numeric part of a `topics-vN` or `gN` version (0 when it has none). */
const versionNumber = (v: string): number => Number(/([0-9]+)$/u.exec(v)?.[1] ?? 0)
const laterVersion = (a: string, b: string): string => {
  const d = versionNumber(a) - versionNumber(b)
  return d !== 0 ? (d > 0 ? a : b) : a > b ? a : b
}

/** A set of notes with its lists sorted and de-duplicated, so equal settings have equal canonical JSON. */
function canonContext(c: BriefContextV1 | BriefContextRemovedV1): BriefContextV1 | BriefContextRemovedV1 {
  if (isRemovedContext(c)) return clone(c)
  const out = clone(c)
  out.lines_on = sortedUnique(out.lines_on)
  out.lines_off = sortedUnique(out.lines_off)
  if (out.topics_off !== undefined) out.topics_off = sortedUnique(out.topics_off)
  if (out.copied !== undefined) {
    const seen = new Set<string>()
    out.copied.lines = out.copied.lines
      .filter((l) => (seen.has(`${l.id}\u0000${l.v}`) ? false : (seen.add(`${l.id}\u0000${l.v}`), true)))
      .sort((a, b) => cmp(a.id, b.id) || cmp(a.v, b.v))
  }
  return out
}

/** Total order on fit notes: month, then id (which counts up within a month), then the whole note. */
function compareFit(a: BriefFitV1, b: BriefFitV1, ja: string, jb: string): number {
  return cmp(a.month, b.month) || cmp(a.id, b.id) || cmp(ja, jb)
}

function mergeFit(lists: readonly (readonly BriefFitV1[])[]): BriefFitV1[] {
  const byBody = new Map<string, BriefFitV1>()
  for (const l of lists) for (const f of l) byBody.set(jcs(f), f)
  const byTopic = new Map<string, { f: BriefFitV1; j: string }[]>()
  for (const [j, f] of byBody) {
    const g = byTopic.get(f.topic) ?? []
    g.push({ f, j })
    byTopic.set(f.topic, g)
  }
  const kept: { f: BriefFitV1; j: string }[] = []
  for (const g of byTopic.values()) kept.push(...g.sort((a, b) => compareFit(a.f, b.f, a.j, b.j)).slice(-FIT_KEEP_PER_TOPIC))
  return kept.sort((a, b) => compareFit(a.f, b.f, a.j, b.j)).map((x) => clone(x.f))
}

/**
 * Join of the notes settings of several saves (see the module comment); `undefined` when none of
 * them has any. With one argument it is that settings' normal form.
 */
export function mergeBriefPrefs(list: readonly (BriefPrefsV1 | undefined)[]): BriefPrefsV1 | undefined {
  const all = list.filter((p): p is BriefPrefsV1 => p !== undefined)
  if (all.length === 0) return undefined
  const bySlot = new Map<number, { c: BriefContextV1 | BriefContextRemovedV1; j: string }>()
  for (const p of all) {
    for (const raw of p.contexts) {
      const c = canonContext(raw)
      const j = jcs(c)
      const prev = bySlot.get(c.slot)
      if (prev === undefined || c.rev > prev.c.rev || (c.rev === prev.c.rev && j > prev.j)) bySlot.set(c.slot, { c, j })
    }
  }
  // last_zones: from the copy with the greatest (notes_as_of, canonical zones); no zones sorts lowest.
  let zones: { month: string; j: string; z: Record<string, BriefTopicSetting> | undefined } | undefined
  for (const p of all) {
    const cand = { month: p.notes_as_of, j: p.last_zones === undefined ? '' : jcs(p.last_zones), z: p.last_zones }
    if (zones === undefined || cand.month > zones.month || (cand.month === zones.month && cand.j > zones.j)) zones = cand
  }
  const out: BriefPrefsV1 = {
    v: 1,
    topics: all.map((p) => p.topics).reduce(laterVersion),
    groups: all.map((p) => p.groups).reduce(laterVersion),
    notes_as_of: all.reduce((m, p) => (p.notes_as_of > m ? p.notes_as_of : m), all[0]!.notes_as_of),
    contexts: [...bySlot.values()].sort((a, b) => a.c.slot - b.c.slot).map((x) => x.c),
    fit_log: mergeFit(all.map((p) => p.fit_log)),
  }
  if (zones?.z !== undefined) out.last_zones = clone(zones.z)
  return out
}

/** The settings with every `rev` set to 0, to compare what they say and not how often they were edited. */
function withoutRevs(p: BriefPrefsV1): BriefPrefsV1 {
  const out = clone(p)
  out.contexts = out.contexts.map((c) => ({ ...c, rev: 0 }))
  return out
}

/**
 * **Load my settings from a save** is a restore, not a merge (AI.7 review; proposal §3.3): the person
 * chose that save on purpose, so its sets replace the page's sets in the same slot, whatever the
 * revs say. Revs count edits per device, so a save from another device or an older visit can carry a
 * lower rev than a page that has had a few clicks since, and a plain join would quietly keep the
 * page's sets. Each loaded set therefore gets a rev one above the page's rev for its slot (a removed
 * set too), which makes it win the join; sets of other slots and the fit notes join as usual.
 *
 * `changed` is false when the join says nothing new (the settings are the page's already, apart from
 * their revs); `prefs` is then the page's own settings unchanged, so the page can say so.
 */
export function restoreBriefPrefs(current: BriefPrefsV1 | undefined, loaded: BriefPrefsV1): { prefs: BriefPrefsV1; changed: boolean } {
  const mine = mergeBriefPrefs([current])
  const pageRev = new Map<number, number>()
  for (const c of mine?.contexts ?? []) pageRev.set(c.slot, c.rev)
  // Normal form first: one set per slot (the higher rev among the loaded ones), so raising them keeps that choice.
  const one = mergeBriefPrefs([loaded]) as BriefPrefsV1
  const raised: BriefPrefsV1 = {
    ...one,
    contexts: one.contexts.map((c) => {
      const page = pageRev.get(c.slot)
      return page === undefined ? c : { ...c, rev: Math.min(Math.max(page, c.rev) + 1, BRIEF_MAX_REV) }
    }),
  }
  const merged = mergeBriefPrefs([current, raised]) as BriefPrefsV1
  if (mine !== undefined && jcs(withoutRevs(merged)) === jcs(withoutRevs(mine))) return { prefs: mine, changed: false }
  return { prefs: merged, changed: true }
}

/** Whether `save` already holds all of `other`'s notes settings (used to prune redundant autosaves). */
export function briefPrefsCovered(mine: BriefPrefsV1 | undefined, other: BriefPrefsV1 | undefined): boolean {
  if (other === undefined) return true
  const merged = mergeBriefPrefs([mine, other])
  const alone = mergeBriefPrefs([mine])
  return alone !== undefined && jcs(merged as BriefPrefsV1) === jcs(alone)
}

/** A copy of a save without its notes settings (the "Remove my notes settings" step; the M2 upload strip is AI.26). */
export function withoutBriefPrefs<T extends { brief_prefs?: BriefPrefsV1 }>(save: T): Omit<T, 'brief_prefs'> {
  const { brief_prefs: _dropped, ...rest } = save
  return rest
}
