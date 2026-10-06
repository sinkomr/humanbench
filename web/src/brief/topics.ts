/**
 * Topics a person can set a depth line for (proposal §3.3 step 2, §5.2, ADR A23).
 *
 * INTERIM (ROADMAP AI.3): the controlled vocabulary `schema/topics-v1.json` and the quant
 * template-to-group map (`web/src/tasks/quant/topics.ts`, A17-synced with the bank) belong to
 * task AI.3. Until that lands this file holds the same vocabulary, so the notes core has a real
 * taxonomy to build against: the six M1 quant groups of §5.2 (ids and labels verbatim), the logic
 * notation topic (NT), the subject lists of DESIGN §3 rows 13-15 as facet-level ids, and the
 * `other/` topics a person can set for themselves. Everything else in `brief/` reads topics only
 * through the functions below, so AI.3 replaces this file's data and nothing else (the invariants
 * in `topics.test.ts` are the contract: ids resolve, labels parse unambiguously, no ability,
 * reading, memory, speed, language-background, school-level or digit wording).
 *
 * Topic ids are `<axis>/<facet>[/<topic>]`; a knowledge topic's facet segment must equal the
 * item's `facet` (prefix-consistent, proposal §5.1). The bank's school-level tag of an item stays
 * internal (A23): no school-level word appears in a label (R-17.3, §4.3).
 */

import type { ContextPreset } from './types'

export const TOPICS_VERSION = 'topics-v1'
/** The quant grouping version (`group_version`, proposal §5.2). */
export const GROUPS_VERSION = 'g1'

export type TopicArea = 'math' | 'logic' | 'science' | 'humanities' | 'arts' | 'other'
/** Which wording family a topic's depth lines use (`DS` vs `DS.k`, proposal §4.2). */
export type TopicDomain = 'method' | 'knowledge' | 'notation'

export interface Topic {
  readonly id: string
  /** Sentence-case label, first word capitalised. Digit-free, no school-level wording. */
  readonly label: string
  readonly area: TopicArea
  readonly domain: TopicDomain
  /** One of the two lowest quant groups: self-set build-up renders as ask-first (the floor rule). */
  readonly floor?: true
}

/** Areas in display order, with their headings. */
export const AREAS: readonly { readonly id: TopicArea; readonly label: string }[] = [
  { id: 'math', label: 'Maths and numbers' },
  { id: 'logic', label: 'Logic' },
  { id: 'science', label: 'Science' },
  { id: 'humanities', label: 'Humanities' },
  { id: 'arts', label: 'Arts and practical life' },
  { id: 'other', label: 'Technical and other' },
]

/** The taxonomy in canonical order: area order, then label order. Rendered topic lists follow it. */
export const TOPICS: readonly Topic[] = [
  { id: 'quant/arith_fractions_percent', label: 'Arithmetic, fractions and percentages', area: 'math', domain: 'method', floor: true },
  { id: 'quant/ratios_rates_averages', label: 'Ratios, rates and averages', area: 'math', domain: 'method', floor: true },
  { id: 'quant/linear', label: 'Linear equations and systems', area: 'math', domain: 'method' },
  { id: 'quant/powers_quadratics', label: 'Powers and quadratics', area: 'math', domain: 'method' },
  { id: 'quant/probability_counting', label: 'Probability and counting', area: 'math', domain: 'method' },
  { id: 'quant/series_number', label: 'Series and number puzzles', area: 'math', domain: 'method' },
  { id: 'lr/notation', label: 'Logic and arguments', area: 'logic', domain: 'notation' },
  { id: 'kst/biology', label: 'Biology', area: 'science', domain: 'knowledge' },
  { id: 'kst/chemistry', label: 'Chemistry', area: 'science', domain: 'knowledge' },
  { id: 'kst/earth_space', label: 'Earth and space', area: 'science', domain: 'knowledge' },
  { id: 'kst/physics', label: 'Physics', area: 'science', domain: 'knowledge' },
  { id: 'khu/civics', label: 'Civics and government', area: 'humanities', domain: 'knowledge' },
  { id: 'khu/geography', label: 'Geography', area: 'humanities', domain: 'knowledge' },
  { id: 'khu/history', label: 'History', area: 'humanities', domain: 'knowledge' },
  { id: 'khu/literature', label: 'Literature', area: 'humanities', domain: 'knowledge' },
  { id: 'khu/philosophy', label: 'Philosophy', area: 'humanities', domain: 'knowledge' },
  { id: 'kap/film', label: 'Film', area: 'arts', domain: 'knowledge' },
  { id: 'kap/home_mechanical', label: 'Home repair and mechanics', area: 'arts', domain: 'knowledge' },
  { id: 'kap/law', label: 'Law basics', area: 'arts', domain: 'knowledge' },
  { id: 'kap/music', label: 'Music', area: 'arts', domain: 'knowledge' },
  { id: 'kap/personal_finance', label: 'Personal finance', area: 'arts', domain: 'knowledge' },
  { id: 'kap/visual_arts', label: 'Visual arts', area: 'arts', domain: 'knowledge' },
  { id: 'other/data_analysis', label: 'Data analysis', area: 'other', domain: 'method' },
  { id: 'other/economics', label: 'Economics', area: 'other', domain: 'knowledge' },
  { id: 'other/engineering', label: 'Engineering', area: 'other', domain: 'method' },
  { id: 'other/machine_learning', label: 'Machine learning', area: 'other', domain: 'method' },
  { id: 'other/programming', label: 'Programming', area: 'other', domain: 'method' },
  { id: 'other/statistics', label: 'Statistics', area: 'other', domain: 'method' },
  { id: 'other/units_rates', label: 'Units and rates', area: 'other', domain: 'method' },
]

const BY_ID: ReadonlyMap<string, Topic> = new Map(TOPICS.map((t) => [t.id, t]))
const INDEX: ReadonlyMap<string, number> = new Map(TOPICS.map((t, i) => [t.id, i]))

/**
 * Retired or split topic ids and the current ids that replace them (proposal §5.2
 * `topics-aliases.json`). Empty until the first split; every stored id must resolve directly or
 * through this map, so overrides and the fit log are never orphaned (AI.7 property test).
 */
export const TOPIC_ALIASES: Readonly<Record<string, readonly string[]>> = {}

export const topicById = (id: string): Topic | undefined => BY_ID.get(id)
export const isTopicId = (id: string): boolean => BY_ID.has(id)
/** Position in the taxonomy (canonical order); -1 when unknown. */
export const topicIndex = (id: string): number => INDEX.get(id) ?? -1

/** Ids sorted into canonical order, duplicates and unknown ids removed. */
export function canonicalTopics(ids: Iterable<string>): string[] {
  return [...new Set(ids)].filter((id) => INDEX.has(id)).sort((a, b) => (INDEX.get(a) ?? 0) - (INDEX.get(b) ?? 0))
}

/** A stored topic id resolved under the current taxonomy: itself, its aliases' successors, or none. */
export function resolveTopicId(id: string, aliases: Readonly<Record<string, readonly string[]>> = TOPIC_ALIASES, seen: ReadonlySet<string> = new Set()): string[] {
  if (BY_ID.has(id)) return [id]
  const next = aliases[id]
  if (next === undefined || seen.has(id)) return []
  const s = new Set(seen).add(id)
  return [...new Set(next.flatMap((n) => resolveTopicId(n, aliases, s)))]
}

/** The label with its first letter lower-cased, as it reads in the middle of a list. */
export const inlineLabel = (label: string): string => label.charAt(0).toLowerCase() + label.slice(1)

/**
 * "A", "A and B", "A, B and C". The first label keeps its capital when `capitalFirst`
 * (`Programming and statistics: ...`), the rest read inline (`... on probability and counting, ...`).
 */
export function joinTopicLabels(ids: readonly string[], capitalFirst: boolean): string {
  const labels = ids.map((id, i) => {
    const t = BY_ID.get(id)
    if (!t) throw new RangeError(`joinTopicLabels: unknown topic ${JSON.stringify(id)}`)
    return i === 0 && capitalFirst ? t.label : inlineLabel(t.label)
  })
  if (labels.length <= 1) return labels.join('')
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

/**
 * Every way `text` reads as a joined label list (`joinTopicLabels`), in canonical order. Labels
 * contain ", " and " and " themselves, so a list is parsed by search over the closed label set;
 * `topics.test.ts` checks that every list of up to three topics has exactly one reading.
 */
export function splitTopicLabels(text: string, capitalFirst: boolean): string[][] {
  const results: string[][] = []
  const labelOf = (t: Topic, first: boolean): string => (first && capitalFirst ? t.label : inlineLabel(t.label))
  const walk = (pos: number, acc: string[], lastIndex: number): void => {
    const first = acc.length === 0
    for (const t of TOPICS) {
      const idx = INDEX.get(t.id) ?? 0
      if (idx <= lastIndex) continue
      const label = labelOf(t, first)
      if (!text.startsWith(label, pos)) continue
      const end = pos + label.length
      const next = [...acc, t.id]
      if (end === text.length) {
        results.push(next)
        continue
      }
      // A separator follows: ", " between labels, " and " only before the last one.
      if (text.startsWith(', ', end)) walk(end + 2, next, idx)
      if (text.startsWith(' and ', end)) walk(end + 5, next, idx)
    }
  }
  walk(0, [], -1)
  // Keep only readings whose separators match the join rule: all ", " except " and " before the last.
  return results.filter((ids) => joinTopicLabels(ids, capitalFirst) === text)
}

/** The unique canonical reading of a joined label list, or null when there is none or it is ambiguous. */
export function parseTopicLabels(text: string, capitalFirst: boolean): string[] | null {
  const all = splitTopicLabels(text, capitalFirst)
  return all.length === 1 ? (all[0] ?? null) : null
}

/** Topic-independent limit: a context lists at most this many topics (T1, proposal §3.3 step 2). */
export const MAX_TOPICS_PER_CONTEXT = 5
/** A person keeps at most this many contexts (proposal §3.3 step 1). */
export const MAX_CONTEXTS = 5

/** Topics to suggest first for a context (proposal §3.1); the full taxonomy stays reachable. */
export const SUGGESTED_TOPICS: Readonly<Record<ContextPreset, readonly string[]>> = {
  coding: ['other/programming', 'other/statistics', 'other/data_analysis', 'other/machine_learning', 'quant/probability_counting', 'lr/notation'],
  learning: ['quant/arith_fractions_percent', 'quant/linear', 'quant/powers_quadratics', 'quant/probability_counting', 'kst/physics', 'kst/chemistry', 'kst/biology'],
  reading: ['khu/history', 'kst/biology', 'kst/physics', 'other/economics', 'khu/philosophy', 'kap/law'],
  numbers: ['quant/arith_fractions_percent', 'quant/ratios_rates_averages', 'quant/probability_counting', 'kap/personal_finance', 'other/statistics', 'other/units_rates'],
  writing: ['khu/literature', 'khu/history'],
  general: ['quant/probability_counting', 'kap/personal_finance', 'other/statistics', 'khu/history', 'kst/biology'],
}
