/**
 * Building a brief from one context's settings (proposal §3-§4). Pure and deterministic: the same
 * settings, extras, form, month and gates always give the same brief. There is no LLM, no clock, no
 * network and, in Part 1, no results input (R-17.1, R-17.4); the only inputs are the person's own
 * settings.
 *
 * Two steps:
 * 1. `compose` lists every line the settings produce, ticked or not, with its tick, status and the
 *    template ids behind it. Merges happen here: topics with the same setting share one line;
 *    "plain words" and "short sentences" share one line; "ask one quick question" moves under the
 *    topic lines when there are any; the floor rule turns a self-set "new to me" on the two lowest
 *    quant groups into ask-first until its gate passes (A22).
 * 2. `buildBrief` writes the ticked lines out and, when the text is over the limit of the form,
 *    drops the lowest-priority ticked lines one at a time (later sections first, proposal §4.1)
 *    until it fits, and reports every dropped line. Nothing is ever cut mid-line or silently.
 */

import { PRESET_INFO } from './contexts'
import { DEFAULT_GATES, floorGatePassed, lineStatus, worstStatus, type GateFile } from './gates'
import { PHRASING_FAMILIES, TEMPLATE_BY_ID, template, wording, type PrintGroup } from './grammar'
import { sanitizeCustomLine, sanitizeInterests } from './sanitize'
import { MAX_TOPICS_PER_CONTEXT, GROUPS_VERSION, TOPICS_VERSION, canonicalTopics, topicById, type Topic } from './topics'
import { renderText } from './render'
import type { ContextPrefs, Extras } from './prefs'
import { NO_EXTRAS } from './prefs'
import {
  FORM_LIMITS,
  GENERATOR,
  REVISIT_MONTHS,
  TEMPLATES_VERSION,
  BRIEF_FORMAT,
  addMonths,
  type Brief,
  type BriefLine,
  type Form,
  type Keywords,
  type LineId,
  type LineStatus,
  type Section,
  type TopicId,
  type TopicSetting,
} from './types'

/** What a tick box in the preview changes. */
export type Tick =
  | { readonly kind: 'key'; readonly key: string }
  | { readonly kind: 'topics'; readonly topics: readonly TopicId[] }
  | { readonly kind: 'custom'; readonly index: number }
  | { readonly kind: 'locked' }

export interface ComposedLine {
  /** Unique within one composition. */
  readonly key: string
  /** The line as written when ticked; `status` is set only for an experimental line. */
  readonly line: BriefLine
  readonly tick: Tick
  readonly on: boolean
  /** Locked lines (the header clauses and CC) cannot be switched off. */
  readonly locked: boolean
  readonly status: LineStatus
  readonly section: Section
  readonly group: PrintGroup
  /** Template ids behind the line: two for a merged line (`U2`, `W3`). */
  readonly sources: readonly LineId[]
  /** Alternative wordings of the same line (a phrasing family), including the current one. */
  readonly phrasings: readonly LineId[]
}

export type NoticeKind = 'floor' | 'cap' | 'words' | 'ask_first_short' | 'interests' | 'custom' | 'tier'

export interface Notice {
  readonly kind: NoticeKind
  readonly message: string
  readonly topics?: readonly TopicId[]
}

export interface BuildInput {
  readonly prefs: ContextPrefs
  readonly extras?: Extras
  /** The form to write; `surfaces.resolveForm` picks it from the destination. */
  readonly form: Form
  /** Month the notes are written, `YYYY-MM`. */
  readonly asOf: string
  readonly gates?: GateFile
  /** The person's other contexts, for the all-topics tier (T2). */
  readonly otherContexts?: readonly ContextPrefs[]
  /** A smaller limit than the form's, for tests of the dropping rule. */
  readonly limit?: number
}

export interface Composition {
  /** Every line the settings produce for this form, in print order, ticked or not. */
  readonly lines: readonly ComposedLine[]
  readonly notices: readonly Notice[]
  /** Line types that exist in the grammar but are blocked by their gate (never rendered). */
  readonly blocked: readonly LineId[]
}

export interface ForcedOff {
  readonly keys: ReadonlySet<string>
  readonly topics: ReadonlySet<TopicId>
  readonly custom: ReadonlySet<number>
}

const NO_FORCED: ForcedOff = { keys: new Set(), topics: new Set(), custom: new Set() }
const GROUP_RANK: Readonly<Record<PrintGroup, number>> = { always: 0, style: 1, topic: 2, work: 3, extras: 4 }

export const NOTICE_TEXT = {
  floor:
    "We're still checking that assistants handle this line respectfully. For now your notes ask the assistant to check with you first. You can write your own line instead.",
  cap: 'A set of notes lists at most five topics. The first five in list order are used.',
  words: 'Your word choice replaces the "plain words" line, and only one word choice is used.',
  askFirstShort: 'In the short notes, one line asks the assistant to check what you already know. Topic-by-topic "ask first" lines are in the long notes.',
  tier: 'This lists every topic you have set in all of your notes, not only the ones for this use.',
} as const

const sourcesStatus = (gates: GateFile, line: BriefLine, sources: readonly LineId[]): LineStatus =>
  line.id === 'X1' ? 'shipped' : worstStatus([lineStatus(gates, line.id), ...sources.map((s) => lineStatus(gates, s))])

/** The line for each topic's setting, with the floor rule applied. */
export function topicTemplate(topic: Topic, setting: TopicSetting, floorApplies: boolean, ask: LineId): { id: LineId; floored: boolean } {
  if (setting === 'ask_first') return { id: ask, floored: false }
  if (topic.domain === 'notation') return { id: setting === 'skip' ? 'NT.skip' : 'NT.build', floored: false }
  if (setting === 'skip') return { id: topic.domain === 'knowledge' ? 'DS.k' : 'DS', floored: false }
  if (topic.floor === true && floorApplies) return { id: ask, floored: true }
  return { id: topic.domain === 'knowledge' ? 'DB.k' : 'DB', floored: false }
}

/** Everything the settings produce, before the length limit is applied. */
export function compose(input: BuildInput, forced: ForcedOff = NO_FORCED): Composition {
  const { prefs, form } = input
  const extras = input.extras ?? NO_EXTRAS
  const gates = input.gates ?? DEFAULT_GATES
  const preset = PRESET_INFO[prefs.preset]
  const notices: Notice[] = []
  const blocked = new Set<LineId>()
  const out: ComposedLine[] = []
  const note = (n: Notice): void => {
    if (!notices.some((m) => m.kind === n.kind && m.message === n.message)) notices.push(n)
  }

  const offByPerson = (k: string): boolean => prefs.lines_off.includes(k)
  const offAny = (k: string): boolean => offByPerson(k) || forced.keys.has(k)
  const isOn = (k: string): boolean => !offAny(k) && (prefs.lines_on.includes(k) || preset.defaults.includes(k))
  /** A default the person removed still shows in the list, unticked, so they can bring it back. */
  const shown = (k: string): boolean => isOn(k) || (preset.defaults.includes(k) && offByPerson(k))
  const pick = (base: string): LineId => {
    const fam = PHRASING_FAMILIES[base]
    if (fam === undefined) return base
    const chosen = prefs.phrasing[base]
    if (chosen !== undefined && fam.includes(chosen)) return chosen
    const v = preset.variants[base]
    return v !== undefined && fam.includes(v) ? v : base
  }

  const add = (line: BriefLine, tick: Tick, on: boolean, sources: readonly LineId[] = [line.id], key = line.id): void => {
    const t = TEMPLATE_BY_ID.get(line.id)
    if (t === undefined) return
    if (t.header !== true && wording(t, form) === null) return // not written in this form
    const status = sourcesStatus(gates, line, sources)
    if (status === 'blocked') {
      blocked.add(line.id)
      return
    }
    const fam = PHRASING_FAMILIES[t.base]
    out.push({
      key,
      line: status === 'experimental' ? { ...line, status: 'experimental' } : line,
      tick,
      on,
      locked: t.locked === true,
      status,
      section: t.section,
      group: t.group,
      sources,
      phrasings: fam !== undefined && fam.includes(line.id) ? fam : [line.id],
    })
  }
  const addLocked = (id: LineId): void => add({ id }, { kind: 'locked' }, true)

  // S0/S1: the header and the fixed clauses are always in, first and locked (R-17.6); CC only in coding contexts.
  for (const id of ['H', 'F1', 'F2', 'F3', 'F4']) addLocked(id)
  if (preset.coding) addLocked('CC')
  if (shown('LANG')) add({ id: 'LANG' }, { kind: 'key', key: 'LANG' }, isOn('LANG'))

  // S2 and S6: style defaults, the length toggle, format and voice, word and sentence choices.
  if (shown('U1')) add({ id: pick('U1') }, { kind: 'key', key: 'U1' }, isOn('U1'))
  if (prefs.length !== 'standard') add({ id: prefs.length === 'short' ? 'LEN.short' : 'LEN.detailed' }, { kind: 'key', key: 'LEN' }, !offAny('LEN'))

  const w1 = isOn('W1')
  const w2 = isOn('W2') && !w1
  const w3 = isOn('W3')
  if (w1 && isOn('W2')) note({ kind: 'words', message: NOTICE_TEXT.words })
  const words = w1 || w2
  if (words && shown('U2')) note({ kind: 'words', message: NOTICE_TEXT.words })
  const u2Id = pick('U2')
  const u2Shown = !words && shown('U2')
  const mergeW3 = u2Shown && isOn('U2') && u2Id === 'U2' && w3
  if (u2Shown) {
    if (mergeW3) add({ id: 'U2.W3' }, { kind: 'key', key: 'U2' }, true, ['U2', 'W3'], 'U2')
    else add({ id: u2Id }, { kind: 'key', key: 'U2' }, isOn('U2'))
  }
  if (w3 && !mergeW3) add({ id: 'W3' }, { kind: 'key', key: 'W3' }, true)
  if (shown('U3')) add({ id: 'U3' }, { kind: 'key', key: 'U3' }, isOn('U3'))
  // U4 is placed after the topic lines are known (below).
  if (shown('U5')) add({ id: 'U5' }, { kind: 'key', key: 'U5' }, isOn('U5'))
  if (shown('U6')) add({ id: pick('U6') }, { kind: 'key', key: 'U6' }, isOn('U6'))
  if (shown('U7')) add({ id: 'U7' }, { kind: 'key', key: 'U7' }, isOn('U7'))
  if (shown('U8')) add({ id: 'U8' }, { kind: 'key', key: 'U8' }, isOn('U8'))
  for (const id of ['FMT1', 'FMT2', 'FMT3', 'VOICE']) if (shown(id)) add({ id }, { kind: 'key', key: id }, isOn(id))
  if (w1) add({ id: 'W1' }, { kind: 'key', key: 'W1' }, true)
  if (w2) add({ id: 'W2' }, { kind: 'key', key: 'W2' }, true)

  // S3: depth by topic (the person's own settings; no results in Part 1).
  const floorApplies = !floorGatePassed(gates)
  const ask = pick('DA')
  let chosen: [TopicId, TopicSetting][]
  if (prefs.tier === 'T2') {
    const all = new Map<TopicId, TopicSetting>()
    for (const c of [...(input.otherContexts ?? []), prefs]) for (const [id, s] of Object.entries(c.topics)) all.set(id, s)
    chosen = canonicalTopics(all.keys()).map((id) => [id, all.get(id) as TopicSetting])
    note({ kind: 'tier', message: NOTICE_TEXT.tier })
  } else {
    const all = canonicalTopics(Object.keys(prefs.topics))
    if (all.length > MAX_TOPICS_PER_CONTEXT) note({ kind: 'cap', message: NOTICE_TEXT.cap })
    chosen = all.slice(0, MAX_TOPICS_PER_CONTEXT).map((id) => [id, prefs.topics[id] as TopicSetting])
  }
  const groups = new Map<LineId, { on: TopicId[]; off: TopicId[] }>()
  const floored: TopicId[] = []
  for (const [id, setting] of chosen) {
    const topic = topicById(id)
    if (topic === undefined) continue
    const t = topicTemplate(topic, setting, floorApplies, ask)
    if (t.floored) floored.push(id)
    const g = groups.get(t.id) ?? { on: [], off: [] }
    const isOff = prefs.topics_off.includes(id) || forced.topics.has(id)
    ;(isOff ? g.off : g.on).push(id)
    groups.set(t.id, g)
  }
  if (floored.length > 0) note({ kind: 'floor', message: NOTICE_TEXT.floor, topics: floored })
  const topicIds = [...groups.keys()].sort((a, b) => (TEMPLATE_BY_ID.get(a)?.order ?? 0) - (TEMPLATE_BY_ID.get(b)?.order ?? 0))
  let topicLineOn = false
  for (const id of topicIds) {
    const g = groups.get(id) as { on: TopicId[]; off: TopicId[] }
    const written = wording(template(id), form) !== null
    if (g.on.length > 0) {
      add({ id, topics: g.on }, { kind: 'topics', topics: g.on }, true, [id], `${id}:on`)
      if (written) topicLineOn = true
    }
    if (g.off.length > 0) add({ id, topics: g.off }, { kind: 'topics', topics: g.off }, false, [id], `${id}:off`)
  }
  if (form === 'short' && [...groups.entries()].some(([id, g]) => g.on.length > 0 && wording(template(id), 'short') === null)) {
    note({ kind: 'ask_first_short', message: NOTICE_TEXT.askFirstShort })
  }

  // S2/S3: the "ask one quick question" line sits under the topic lines when there are any.
  if (shown('U4')) add({ id: form !== 'short' && topicLineOn ? 'U4.t' : 'U4' }, { kind: 'key', key: 'U4' }, isOn('U4'), ['U4'], 'U4')

  // S5 (coding contexts only) and S4: working together and the control words.
  if (preset.coding) for (const id of ['AC1', 'AC2']) if (isOn(id)) add({ id }, { kind: 'key', key: id }, true)
  if (prefs.mode === 'do') {
    if (shown('K1')) add({ id: 'K1' }, { kind: 'key', key: 'K1' }, isOn('K1'))
  } else {
    for (const id of ['K1L', 'K1D', 'K1C']) if (shown(id)) add({ id }, { kind: 'key', key: id }, isOn(id))
    const builds = canonicalTopics([...(groups.get('DB')?.on ?? []), ...(groups.get('DB.k')?.on ?? [])])
    if (builds.length > 0 && shown('K1F')) add({ id: 'K1F', topics: builds }, { kind: 'key', key: 'K1F' }, isOn('K1F'))
  }
  if (shown('K2')) add({ id: 'K2' }, { kind: 'key', key: 'K2' }, isOn('K2'))

  // S7: interests and custom lines (typed, checked, never stored).
  const interests = sanitizeInterests(extras.interests)
  for (const p of interests.problems) note({ kind: 'interests', message: p })
  if (interests.items.length > 0) add({ id: 'I1', interests: interests.items }, { kind: 'key', key: 'I1' }, !offAny('I1'))
  extras.custom.forEach((c, i) => {
    const s = sanitizeCustomLine(c.text)
    for (const p of s.problems) note({ kind: 'custom', message: p })
    if (s.text !== null) add({ id: 'X1', text: s.text, custom: true }, { kind: 'custom', index: i }, c.on && !forced.custom.has(i), ['X1'], `X1:${i}`)
  })

  const rank = (c: ComposedLine): number => GROUP_RANK[c.group] * 10_000 + (TEMPLATE_BY_ID.get(c.line.id)?.order ?? 0) + (c.tick.kind === 'custom' ? c.tick.index / 100 : 0)
  out.sort((a, b) => rank(a) - rank(b))
  return { lines: out, notices, blocked: [...blocked].sort() }
}

/** A brief made of the ticked lines of a composition. */
export function assemble(comp: Composition, input: BuildInput): Brief {
  const lines = comp.lines.filter((l) => l.on).map((l) => l.line)
  const keywords: Record<string, string> = {}
  for (const l of lines) for (const [k, v] of Object.entries(TEMPLATE_BY_ID.get(l.id)?.keywords ?? {})) keywords[k] = v
  return {
    format: BRIEF_FORMAT,
    templates: TEMPLATES_VERSION,
    topics: TOPICS_VERSION,
    groups: GROUPS_VERSION,
    as_of: input.asOf,
    revisit: addMonths(input.asOf, REVISIT_MONTHS),
    context: input.prefs.preset,
    form: input.form,
    tier: input.prefs.tier,
    mode_default: input.prefs.mode,
    length: input.prefs.length,
    lines,
    keywords: keywords as Keywords,
    generator: GENERATOR,
  }
}

export interface BuildResult {
  readonly brief: Brief
  readonly text: string
  readonly chars: number
  readonly limit: number
  /** True unless even the locked lines exceed the limit (cannot happen with the shipped grammar). */
  readonly fits: boolean
  /** The first composition: every line, ticked or not, before any line was dropped for length. */
  readonly lines: readonly ComposedLine[]
  /** Ticked lines left out because the text is over the limit, lowest priority first. Never silent. */
  readonly dropped: readonly ComposedLine[]
  readonly notices: readonly Notice[]
  readonly blocked: readonly LineId[]
}

function droppedKeyFor(c: ComposedLine): ForcedOff {
  const keys = new Set<string>()
  const topics = new Set<TopicId>()
  const custom = new Set<number>()
  if (c.tick.kind === 'key') keys.add(c.tick.key)
  else if (c.tick.kind === 'topics') for (const t of c.tick.topics) topics.add(t)
  else if (c.tick.kind === 'custom') custom.add(c.tick.index)
  return { keys, topics, custom }
}

/** Higher drops first: `fit` lines in the short form, then later sections before earlier ones (proposal §4.1). */
const dropRank = (c: ComposedLine, form: Form): number => {
  const t = TEMPLATE_BY_ID.get(c.line.id)
  const s = Number((t?.section ?? 'S0').slice(1))
  const fit = form === 'short' && t?.fit === true ? 1_000_000 : 0
  return fit + s * 10_000 + (t?.order ?? 0) + (c.tick.kind === 'custom' ? c.tick.index / 100 : 0)
}

/** Build a brief and write it; drop, and report, the lowest-priority lines that do not fit. */
export function buildBrief(input: BuildInput): BuildResult {
  const limit = input.limit ?? FORM_LIMITS[input.form]
  const first = compose(input)
  const keys = new Set<string>()
  const topics = new Set<TopicId>()
  const custom = new Set<number>()
  const dropped: ComposedLine[] = []
  let comp = first
  for (;;) {
    const brief = assemble(comp, input)
    const text = renderText(brief)
    if (text.length <= limit) {
      return { brief, text, chars: text.length, limit, fits: true, lines: first.lines, dropped, notices: first.notices, blocked: first.blocked }
    }
    const victim = comp.lines
      .filter((l) => l.on && !l.locked)
      .sort((a, b) => dropRank(b, input.form) - dropRank(a, input.form))[0]
    if (victim === undefined) {
      return { brief, text, chars: text.length, limit, fits: false, lines: first.lines, dropped, notices: first.notices, blocked: first.blocked }
    }
    dropped.push(victim)
    const f = droppedKeyFor(victim)
    f.keys.forEach((k) => keys.add(k))
    f.topics.forEach((t) => topics.add(t))
    f.custom.forEach((i) => custom.add(i))
    comp = compose(input, { keys, topics, custom })
  }
}
