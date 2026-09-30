/**
 * The state of the notes builder and the pure steps that change it (proposal §3.3). The page keeps
 * a `BuilderState` in a rune and replaces it with the result of one of these functions, so every
 * rule of the flow (five topics, five sets of notes, the tick semantics, what a preset resets) is
 * testable without a browser.
 *
 * Nothing here is stored. The state lives on the page; `PersistedState` (`stored.ts`) is the part
 * that is kept between visits, and only after the person has said they are 18 or older (AI.7,
 * proposal §3.3 "Age gate and storage"); `Extras` (interests, own lines) never is.
 */

import { PRESET_INFO } from './contexts'
import type { Tick } from './build'
import { newFitEntry, type FitVerdict } from './fit'
import { defaultPrefs, NO_EXTRAS, type ContextPrefs, type Extras } from './prefs'
import type { CopiedRecord } from './returning'
import { MAX_CUSTOM_LINES } from './sanitize'
import type { PersistedState, ReadPrefs, Tombstone } from './stored'
import { destination } from './surfaces'
import { MAX_CONTEXTS, MAX_TOPICS_PER_CONTEXT } from './topics'
import type { ContextPreset, DestinationId, Form, Length, LineId, Mode, Tier, TopicId, TopicSetting } from './types'

export interface BuilderState extends PersistedState {
  /** 1 to 5 sets of notes; each has its own settings (`contexts`, `copied`, `tombstones` and `fitLog` come from `PersistedState`). */
  readonly contexts: readonly ContextPrefs[]
  /** Typed extras per set of notes (parallel to `contexts`); never stored. */
  readonly extras: readonly Extras[]
  /** Whether the person picked the destination themselves (else it follows the preset). */
  readonly destinationChosen: readonly boolean[]
  readonly active: number
  /** T2 (every topic, all sets) needs this explicit acknowledgement of its warning. */
  readonly t2Confirmed: boolean
}

export type WordChoice = 'plain' | 'w1' | 'w2'

export function initialState(preset: ContextPreset = 'general'): BuilderState {
  return { contexts: [defaultPrefs(preset, 1)], copied: [null], tombstones: [], fitLog: [], extras: [NO_EXTRAS], destinationChosen: [false], active: 0, t2Confirmed: false }
}

/** The label of a set of notes, made from its use and destination, never typed (so no free text needs storing). */
export function contextLabel(c: ContextPrefs): string {
  return `${PRESET_INFO[c.preset].label}, ${destination(c.destination)?.label ?? 'no destination'}`
}

/** The part of the builder that is kept between visits. */
export const persistedOf = (s: BuilderState): PersistedState => ({ contexts: s.contexts, copied: s.copied, tombstones: s.tombstones, fitLog: s.fitLog })

export const activePrefs = (s: BuilderState): ContextPrefs => s.contexts[s.active] as ContextPrefs
export const activeExtras = (s: BuilderState): Extras => s.extras[s.active] ?? NO_EXTRAS
export const otherContexts = (s: BuilderState): ContextPrefs[] => s.contexts.filter((_, i) => i !== s.active)

const replaceAt = <T>(xs: readonly T[], i: number, x: T): T[] => xs.map((v, j) => (j === i ? x : v))

/** Apply `fn` to the active settings and bump their revision. */
function editPrefs(s: BuilderState, fn: (p: ContextPrefs) => ContextPrefs): BuilderState {
  const p = activePrefs(s)
  const next = fn(p)
  return { ...s, contexts: replaceAt(s.contexts, s.active, { ...next, rev: p.rev + 1 }) }
}
function editExtras(s: BuilderState, fn: (e: Extras) => Extras): BuilderState {
  return { ...s, extras: replaceAt(s.extras, s.active, fn(activeExtras(s))) }
}

const without = (xs: readonly string[], x: string): string[] => xs.filter((v) => v !== x)
const withItem = (xs: readonly string[], x: string): string[] => (xs.includes(x) ? [...xs] : [...xs, x].sort())

/** A different use: fresh defaults for the preset (its mode, length, style lines), keeping topics and typed extras. */
export function choosePreset(s: BuilderState, preset: ContextPreset): BuilderState {
  const chosen = s.destinationChosen[s.active] === true
  return editPrefs(s, (p) => {
    const d = defaultPrefs(preset, p.slot)
    return { ...d, destination: chosen ? p.destination : d.destination, ...(chosen && p.form !== undefined ? { form: p.form } : {}), tier: p.tier, topics: p.topics, topics_off: p.topics_off, rev: p.rev }
  })
}

/**
 * A new set of notes (up to five), started from the general preset and made the active one. In a
 * slot where a set was removed it starts above the removal's rev, so it replaces the removal.
 */
export function addContext(s: BuilderState): BuilderState {
  if (s.contexts.length >= MAX_CONTEXTS) return s
  const used = new Set(s.contexts.map((c) => c.slot))
  const slot = [1, 2, 3, 4, 5].find((n) => !used.has(n)) ?? s.contexts.length + 1
  const gone = s.tombstones.find((t) => t.slot === slot)
  const fresh = gone === undefined ? defaultPrefs('general', slot) : { ...defaultPrefs('general', slot), rev: gone.rev + 1 }
  return {
    ...s,
    contexts: [...s.contexts, fresh],
    copied: [...s.copied, null],
    tombstones: s.tombstones.filter((t) => t.slot !== slot),
    extras: [...s.extras, NO_EXTRAS],
    destinationChosen: [...s.destinationChosen, false],
    active: s.contexts.length,
  }
}

export function selectContext(s: BuilderState, index: number): BuilderState {
  return index >= 0 && index < s.contexts.length ? { ...s, active: index } : s
}

/** Remove a set of notes. Its slot keeps a tombstone one rev above it, so an older copy of the save does not bring it back. */
export function removeContext(s: BuilderState, index: number): BuilderState {
  if (s.contexts.length <= 1 || index < 0 || index >= s.contexts.length) return s
  const drop = <T>(xs: readonly T[]): T[] => xs.filter((_, i) => i !== index)
  const gone = s.contexts[index] as ContextPrefs
  const tombstone: Tombstone = { slot: gone.slot, rev: gone.rev + 1 }
  return {
    ...s,
    contexts: drop(s.contexts),
    copied: drop(s.copied),
    tombstones: [...s.tombstones.filter((t) => t.slot !== gone.slot), tombstone],
    extras: drop(s.extras),
    destinationChosen: drop(s.destinationChosen),
    active: Math.min(s.active > index ? s.active - 1 : s.active, s.contexts.length - 2),
  }
}

/** Add a topic (as "Not sure") or remove it. At most five topics per set of notes. */
export function toggleTopic(s: BuilderState, id: TopicId): BuilderState {
  return editPrefs(s, (p) => {
    if (p.topics[id] !== undefined) {
      const { [id]: _gone, ...rest } = p.topics
      return { ...p, topics: rest, topics_off: without(p.topics_off, id) }
    }
    if (Object.keys(p.topics).length >= MAX_TOPICS_PER_CONTEXT) return p
    return { ...p, topics: { ...p.topics, [id]: 'ask_first' } }
  })
}

export const setTopic = (s: BuilderState, id: TopicId, setting: TopicSetting): BuilderState =>
  activePrefs(s).topics[id] === undefined ? s : editPrefs(s, (p) => ({ ...p, topics: { ...p.topics, [id]: setting } }))

export const setMode = (s: BuilderState, mode: Mode): BuilderState => editPrefs(s, (p) => ({ ...p, mode }))
export const setLength = (s: BuilderState, length: Length): BuilderState => editPrefs(s, (p) => ({ ...p, length }))
export const setTier = (s: BuilderState, tier: Tier): BuilderState => ({ ...editPrefs(s, (p) => ({ ...p, tier })), t2Confirmed: tier === 'T2' ? s.t2Confirmed : false })
export const confirmT2 = (s: BuilderState, on: boolean): BuilderState => ({ ...s, t2Confirmed: on })

export function setDestination(s: BuilderState, destination: DestinationId): BuilderState {
  const next = editPrefs(s, (p) => {
    const { form: _f, ...rest } = p
    return { ...rest, destination }
  })
  return { ...next, destinationChosen: replaceAt(s.destinationChosen, s.active, true) }
}
export const setForm = (s: BuilderState, form: Form): BuilderState => editPrefs(s, (p) => ({ ...p, form }))

/** Switch a line on or off by its tick key. A default that is switched off is remembered in `lines_off`. */
export function setLine(s: BuilderState, key: string, on: boolean): BuilderState {
  return editPrefs(s, (p) => {
    const isDefault = PRESET_INFO[p.preset].defaults.includes(key)
    if (on) return { ...p, lines_off: without(p.lines_off, key), lines_on: isDefault ? without(p.lines_on, key) : withItem(p.lines_on, key) }
    return { ...p, lines_on: without(p.lines_on, key), lines_off: isDefault ? withItem(p.lines_off, key) : without(p.lines_off, key) }
  })
}

/** What a preview tick box changes: a line, the topics of a line, or a custom line. */
export function applyTick(s: BuilderState, tick: Tick, on: boolean): BuilderState {
  switch (tick.kind) {
    case 'locked':
      return s
    case 'key':
      return setLine(s, tick.key, on)
    case 'topics':
      return editPrefs(s, (p) => ({
        ...p,
        topics_off: on ? p.topics_off.filter((t) => !tick.topics.includes(t)) : [...new Set([...p.topics_off, ...tick.topics])].sort(),
      }))
    case 'custom':
      return editExtras(s, (e) => ({ ...e, custom: e.custom.map((c, i) => (i === tick.index ? { ...c, on } : c)) }))
  }
}

/** The word choice in force: plain words (the default line), general vocabulary is fine, or gloss less common words. */
export function wordChoice(p: ContextPrefs): WordChoice {
  return p.lines_on.includes('W1') && !p.lines_off.includes('W1') ? 'w1' : p.lines_on.includes('W2') && !p.lines_off.includes('W2') ? 'w2' : 'plain'
}
export function setWordChoice(s: BuilderState, choice: WordChoice): BuilderState {
  return editPrefs(s, (p) => ({
    ...p,
    lines_on: [...without(without(p.lines_on, 'W1'), 'W2'), ...(choice === 'w1' ? ['W1'] : choice === 'w2' ? ['W2'] : [])].sort(),
    lines_off: without(without(p.lines_off, 'W1'), 'W2'),
  }))
}

/** Choose the wording of a phrasing family (`U1` to `U1c`). Choosing the context's own wording clears the choice. */
export function setPhrasing(s: BuilderState, base: string, id: LineId): BuilderState {
  return editPrefs(s, (p) => ({ ...p, phrasing: { ...p.phrasing, [base]: id } }))
}

/** Note what was just copied or downloaded for the active set of notes (kept with its settings; no note text). */
export function recordCopied(s: BuilderState, record: CopiedRecord): BuilderState {
  const bumped = editPrefs(s, (p) => p)
  return { ...bumped, copied: replaceAt(s.copied, s.active, record) }
}

/** Add a fit note ("too basic", "about right", "too much") for a topic. `month` is the current `YYYY-MM`; `random` six hex digits. */
export function recordFit(s: BuilderState, topic: TopicId, verdict: FitVerdict, month: string, random: string): BuilderState {
  return { ...s, fitLog: [...s.fitLog, newFitEntry(s.fitLog, topic, verdict, month, random)] }
}

/**
 * The builder as stored settings read back describe it. Typed extras never come back (they are not
 * stored); the ones on the page stay with their set when `extrasFrom` is given (settings loaded from a
 * save while the page is in use). A save with no live set gets one fresh set above any removal.
 */
export function stateFromStored(read: ReadPrefs, extrasFrom?: BuilderState): BuilderState {
  const live = read.contexts.length > 0
  const slotOne = read.tombstones.find((t) => t.slot === 1)
  const contexts = live ? read.contexts : [slotOne === undefined ? defaultPrefs('general', 1) : { ...defaultPrefs('general', 1), rev: slotOne.rev + 1 }]
  const liveSlots = new Set(contexts.map((c) => c.slot))
  const extraFor = (slot: number): Extras => {
    const i = extrasFrom === undefined ? -1 : extrasFrom.contexts.findIndex((c) => c.slot === slot)
    return i < 0 ? NO_EXTRAS : (extrasFrom?.extras[i] ?? NO_EXTRAS)
  }
  const activeSlot = extrasFrom?.contexts[extrasFrom.active]?.slot
  return {
    contexts,
    copied: live ? [...read.copied] : [null],
    tombstones: read.tombstones.filter((t) => !liveSlots.has(t.slot)),
    fitLog: [...read.fitLog],
    extras: contexts.map((c) => extraFor(c.slot)),
    destinationChosen: contexts.map((c) => c.destination !== PRESET_INFO[c.preset].destination),
    active: Math.max(0, contexts.findIndex((c) => c.slot === activeSlot)),
    t2Confirmed: false,
  }
}

export const setInterests = (s: BuilderState, interests: string): BuilderState => editExtras(s, (e) => ({ ...e, interests }))

/** Set the text of custom line `index` (adds it when `index` is the next free one, up to three). */
export function setCustomText(s: BuilderState, index: number, text: string): BuilderState {
  return editExtras(s, (e) => {
    if (index === e.custom.length && index < MAX_CUSTOM_LINES) return { ...e, custom: [...e.custom, { text, on: true }] }
    return { ...e, custom: e.custom.map((c, i) => (i === index ? { ...c, text } : c)) }
  })
}
export const removeCustom = (s: BuilderState, index: number): BuilderState => editExtras(s, (e) => ({ ...e, custom: e.custom.filter((_, i) => i !== index) }))

/** "Remove my notes settings": back to a fresh page. */
export const resetAll = (): BuilderState => initialState()
