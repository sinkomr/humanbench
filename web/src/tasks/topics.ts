/**
 * Topic taxonomy (ROADMAP A23, AI.3; Phase AI proposal §5.1–§5.2; DESIGN R-17.3, R-17.4).
 *
 * `topics-v1.json` is a controlled vocabulary of content labels. The bank repo owns it
 * (`schema/topics-v1.json`) and this repo keeps a byte-identical copy next to this file (ROADMAP
 * A17: `npm run sync:topics`, checked by `scripts/sync-topics.test.ts`). `topics-aliases.json` is
 * the retirement history: every ID any release has contained, and where each retired or split ID
 * went. `topics-released-v1.json` is the frozen ledger of the IDs that shipped (test-only here;
 * not imported by the app).
 *
 * IDs are lowercase `a-z` words joined by `_` and `/`, with no digits:
 * - `quant/<group>`: the six M1 quant groups (`kind: group`), over the template facets
 *   (`quant/topics.ts`, `group_version` `g1`);
 * - `<axis>/<facet>`: a subject of a finite axis, the `facet` of its items (`kind: facet`);
 * - `<axis>/<facet>/<topic>`: the item `topic` tag (`kind: topic`); the middle segment must equal
 *   the item's `facet` ({@link topicPrefixProblem}, the check the item schema uses in AI.2/G1).
 *   Axes: KST, KHU, KAP, LR, LG, FER ({@link TOPIC_AXES});
 * - `other/<topic>`: a subject HumanBench does not measure, which a person can still set for
 *   themselves (`kind: other`).
 *
 * Labels are content words only: ASCII letters, spaces and commas, no digits, no school-level
 * word, and nothing that names a general ability, reading, memory, speed or a language
 * background (R-17.3). The file carries its own `denied_words` lists so both repos test the same
 * words. Versioning: `topics_version` and `group_version` go into the JSON export and
 * `brief_prefs`; adding a topic is additive; retiring, renaming or splitting one keeps its ID in
 * `released` and maps it in `aliases` to its successors, so a stored override or fit-log entry
 * never dangles ({@link resolveTopic}, {@link aliasesProblems}). `released` cannot vouch for itself,
 * so `topics-released-v1.json` is a frozen ledger of the IDs that shipped: `released` must keep
 * every one and each must still resolve to a live topic ({@link releasedLedgerProblems}). A release
 * that adds IDs appends them to the ledger; nothing is ever removed from it. The bank's
 * `hb.topics` is the twin of this module.
 *
 * Measured subjects have one ID. `other/` holds only subjects HumanBench does not measure, so a
 * subject with a measured facet or group (personal finance is `kap/personal_finance`, not an
 * `other/` twin) is set through that ID; a second ID for it would make a person's overrides and
 * the fit log ambiguous. Every live ID (group, facet, topic or `other/`) is a valid key for a
 * person's own topic setting; which of them the settings UI offers is AI.5's choice.
 *
 * Not re-exported from the `tasks` barrel: the notes code imports it explicitly.
 */

import type { AxisCode } from '../engine'
import { QUANT_GROUPS, QUANT_GROUP_VERSION, type QuantGroup } from './quant/topics'
import rawAliases from './topics-aliases.json'
import rawTaxonomy from './topics-v1.json'

export const TOPICS_VERSION = 'topics-v1'
export const GROUP_VERSION = QUANT_GROUP_VERSION

export type TopicKind = 'group' | 'facet' | 'topic' | 'other'
export const TOPIC_KINDS: readonly TopicKind[] = Object.freeze(['group', 'facet', 'topic', 'other'] as const)

/** The axes whose items carry a `topic` tag (proposal §5.1). QR has groups, not tags. */
export const TOPIC_AXES = Object.freeze(['KST', 'KHU', 'KAP', 'LR', 'LG', 'FER'] as const)
export type TopicAxis = (typeof TOPIC_AXES)[number]

const AXIS_OF_PREFIX: Readonly<Record<string, string>> = Object.freeze({
  kst: 'KST',
  khu: 'KHU',
  kap: 'KAP',
  lr: 'LR',
  lg: 'LG',
  fer: 'FER',
  quant: 'QR',
})

const SEGMENT = '[a-z]+(?:_[a-z]+)*'
const PREFIXES = TOPIC_AXES.map((a) => a.toLowerCase()).join('|')
export const ID_PATTERNS: Readonly<Record<TopicKind, RegExp>> = Object.freeze({
  group: new RegExp(`^quant/${SEGMENT}$`),
  facet: new RegExp(`^(?:${PREFIXES})/${SEGMENT}$`),
  topic: new RegExp(`^(?:${PREFIXES})/${SEGMENT}/${SEGMENT}$`),
  other: new RegExp(`^other/${SEGMENT}$`),
})
/**
 * A label: capitalised ASCII words, spaces and commas only, so no digit, hyphen, colon, `#` or
 * URL can reach a notes line (R-17.3).
 */
export const LABEL_RE = /^[A-Z][A-Za-z]*(?:,? [A-Za-z]+)*$/
export const LABEL_MAX = 60

/**
 * The word lists `denied_words` must carry (R-17.3): no topic may name a general ability,
 * reading, memory, speed or a language background, and no label may use a school-level or level word.
 */
export const DENIED_CATEGORIES = Object.freeze(['general_ability', 'reading', 'memory', 'speed', 'language_background', 'school_level'] as const)

const NODE_KEYS: Readonly<Record<TopicKind, readonly string[]>> = {
  group: ['axis', 'id', 'kind', 'label', 'templates'],
  facet: ['axis', 'id', 'kind', 'label'],
  topic: ['axis', 'facet', 'id', 'kind', 'label'],
  other: ['id', 'kind', 'label'],
}
const ROOT_KEYS = ['about', 'denied_words', 'group_version', 'nodes', 'topics_version']
const ALIAS_KEYS = ['about', 'aliases', 'released', 'topics_version']
const LEDGER_KEYS = ['about', 'ids', 'topics_version']
const LEDGER_FILE = 'topics-released-v1.json'

type Json = unknown
const isRecord = (v: Json): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStringList = (v: Json): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
const sameKeys = (o: Record<string, Json>, keys: readonly string[]): boolean => {
  const have = Object.keys(o).sort()
  return have.length === keys.length && have.every((k, i) => k === keys[i])
}

/** Whether `value` has the shape of a topic ID of any kind (not whether it is live). */
export function anyTopicId(value: unknown): value is string {
  return typeof value === 'string' && TOPIC_KINDS.some((k) => ID_PATTERNS[k].test(value))
}

// --- the deny-list -------------------------------------------------------------------------------

const tokensOf = (text: string): string[] => text.toLowerCase().match(/[a-z]+/g) ?? []

/**
 * Every `[category, entry]` of `denied` that occurs in `text` as a whole word, or as a whole-word
 * phrase for a multi-word entry ("high school"). An ID's `/` and `_` separate words too.
 */
export function deniedWordHits(text: string, denied: Readonly<Record<string, readonly string[]>>): [string, string][] {
  const toks = tokensOf(text)
  const hits: [string, string][] = []
  for (const [category, entries] of Object.entries(denied)) {
    for (const entry of entries) {
      const words = tokensOf(entry)
      const n = words.length
      if (n === 0) continue
      for (let i = 0; i + n <= toks.length; i++) {
        if (words.every((w, j) => toks[i + j] === w)) {
          hits.push([category, entry])
          break
        }
      }
    }
  }
  return hits
}

// --- validation ----------------------------------------------------------------------------------

function deniedProblems(denied: Json): string[] {
  if (!isRecord(denied)) return ['denied_words must be an object of word lists']
  const out: string[] = []
  if (!sameKeys(denied, [...DENIED_CATEGORIES].sort())) out.push(`denied_words must have exactly the lists ${DENIED_CATEGORIES.join(', ')}`)
  for (const [category, words] of Object.entries(denied)) {
    if (!isStringList(words) || words.length === 0) {
      out.push(`denied_words.${category} must be a non-empty list of strings`)
      continue
    }
    for (const w of words) if (!/^[a-z]+(?: [a-z]+)*$/.test(w)) out.push(`denied_words.${category}: '${w}' must be lowercase letters and spaces`)
    if (new Set(words).size !== words.length) out.push(`denied_words.${category} lists a word twice`)
  }
  return out
}

/**
 * Everything wrong with a parsed `topics-v1.json` (empty when valid); never throws. Structure and
 * versions; ID grammar per kind and uniqueness; every topic under an existing facet with a
 * matching `facet` field and axis; unique, digit-free labels with no denied word and no
 * school-level word (R-17.3); and the `kind: group` nodes equal to the quant groups `groups`
 * (`quant/topics.ts`).
 */
export function taxonomyProblems(raw: Json, groups: readonly QuantGroup[] = QUANT_GROUPS): string[] {
  if (!isRecord(raw)) return ['the taxonomy must be a JSON object']
  const problems: string[] = []
  if (!sameKeys(raw, ROOT_KEYS)) problems.push(`top-level keys must be exactly ${ROOT_KEYS.join(', ')}`)
  if (raw.topics_version !== TOPICS_VERSION) problems.push(`topics_version must be '${TOPICS_VERSION}'`)
  if (raw.group_version !== GROUP_VERSION) problems.push(`group_version must be '${GROUP_VERSION}'`)
  problems.push(...deniedProblems(raw.denied_words))
  // fromEntries, not `denied[k] = v`: a list named `__proto__` must stay an own key
  const denied: Record<string, string[]> = isRecord(raw.denied_words)
    ? Object.fromEntries(Object.entries(raw.denied_words).filter((e): e is [string, string[]] => isStringList(e[1])))
    : {}
  const nodes = raw.nodes
  if (!Array.isArray(nodes) || nodes.length === 0) return [...problems, 'nodes must be a non-empty list']

  const seen = new Map<string, Record<string, Json>>()
  const labels = new Map<string, string>()
  nodes.forEach((node: Json, i) => {
    if (!isRecord(node)) {
      problems.push(`nodes[${i}] must be an object`)
      return
    }
    const kind = node.kind
    const id = node.id
    if (typeof kind !== 'string' || !(TOPIC_KINDS as readonly string[]).includes(kind) || typeof id !== 'string') {
      problems.push(`nodes[${i}]: kind must be one of ${TOPIC_KINDS.join(', ')} and id a string`)
      return
    }
    const k = kind as TopicKind
    if (!sameKeys(node, NODE_KEYS[k])) {
      problems.push(`${id}: a ${k} has exactly the keys ${NODE_KEYS[k].join(', ')}`)
      return
    }
    if (!ID_PATTERNS[k].test(id)) problems.push(`${id}: not a valid ${k} ID (lowercase words joined by _ and /)`)
    if (seen.has(id)) problems.push(`${id}: listed twice`)
    seen.set(id, node)
    const prefix = id.split('/')[0] as string
    const wantAxis = Object.hasOwn(AXIS_OF_PREFIX, prefix) ? AXIS_OF_PREFIX[prefix] : undefined // not `constructor` etc.
    if (k !== 'other' && node.axis !== wantAxis) problems.push(`${id}: axis must be ${wantAxis} for the ${prefix}/ prefix`)
    const label = node.label
    if (typeof label !== 'string' || !LABEL_RE.test(label) || label.length > LABEL_MAX) {
      problems.push(
        `${id}: label ${JSON.stringify(label)} must be capitalised ASCII words, spaces and commas only (no digit, hyphen or punctuation), at most ${LABEL_MAX} characters`,
      )
      return
    }
    const prior = labels.get(label.toLowerCase())
    if (prior !== undefined) problems.push(`${id}: label '${label}' is also the label of ${prior}`)
    labels.set(label.toLowerCase(), id)
    for (const [text, what] of [[label, 'label'], [id, 'ID']] as const) {
      for (const [category, entry] of deniedWordHits(text, denied)) problems.push(`${id}: ${what} uses the denied ${category} word '${entry}'`)
    }
  })

  const all = [...seen.entries()]
  for (const [id, node] of all) {
    if (node.kind !== 'topic') continue
    const parts = id.split('/')
    if (parts.length !== 3) continue // already reported as a malformed ID
    const facetId = parts.slice(0, 2).join('/')
    if (seen.get(facetId)?.kind !== 'facet') problems.push(`${id}: its facet ${facetId} is not a facet in the taxonomy`)
    if (node.facet !== parts[1]) problems.push(`${id}: facet must be '${parts[1]}' (prefix consistency)`)
  }
  for (const axis of TOPIC_AXES) {
    const facets = all.filter(([, n]) => n.kind === 'facet' && n.axis === axis)
    if (facets.length === 0) problems.push(`axis ${axis} has no facet`)
    for (const [fid] of facets) {
      if (!all.some(([id, n]) => n.kind === 'topic' && id.startsWith(`${fid}/`))) problems.push(`${fid}: a facet needs at least one topic`)
    }
  }
  if (!all.some(([, n]) => n.kind === 'other')) problems.push('the taxonomy needs other/ topics a person can set themselves')
  problems.push(...groupProblems(all.filter(([, n]) => n.kind === 'group').map(([, n]) => n), groups))
  return problems
}

function groupProblems(nodes: readonly Record<string, Json>[], groups: readonly QuantGroup[]): string[] {
  const problems: string[] = []
  const haveIds = nodes.map((n) => n.id)
  const wantIds = groups.map((g) => g.id)
  if (haveIds.join() !== wantIds.join()) {
    problems.push(`the group nodes are [${haveIds.join(', ')}], not the quant groups [${wantIds.join(', ')}]`)
  } else {
    nodes.forEach((n, i) => {
      const g = groups[i] as QuantGroup
      if (n.label !== g.label || !isStringList(n.templates) || n.templates.join() !== g.templates.join()) {
        problems.push(`${g.id}: label or templates differ from the quant group constant`)
      }
    })
  }
  const flat = groups.flatMap((g) => g.templates)
  if (new Set(flat).size !== flat.length) problems.push('a template belongs to two quant groups')
  return problems
}

/**
 * Everything wrong with a parsed `topics-aliases.json` against the live IDs; never throws.
 * `released` is sorted, unique, well-formed and covers every live ID (so adding a topic means
 * appending it, and a topic can never vanish without a trace); every released ID that is no
 * longer live has an alias; a live ID is never an alias key; successors are live or aliased and
 * never loop; and every released ID resolves to at least one live ID.
 */
export function aliasesProblems(raw: Json, live: ReadonlySet<string> | readonly string[]): string[] {
  if (!isRecord(raw)) return ['the alias file must be a JSON object']
  const problems: string[] = []
  if (!sameKeys(raw, ALIAS_KEYS)) problems.push(`top-level keys must be exactly ${ALIAS_KEYS.join(', ')}`)
  if (raw.topics_version !== TOPICS_VERSION) problems.push(`topics_version must be '${TOPICS_VERSION}'`)
  const released = raw.released
  const aliases = raw.aliases
  if (!isStringList(released) || released.length === 0) return [...problems, 'released must be a non-empty list of IDs']
  if (!isRecord(aliases)) return [...problems, 'aliases must be an object of ID → successor IDs']
  const liveSet = new Set(live)
  const releasedSet = new Set(released)
  if (released.join() !== [...releasedSet].sort().join()) problems.push('released must be sorted and free of duplicates')
  for (const x of released) if (!anyTopicId(x)) problems.push(`released: '${x}' is not a valid topic ID`)
  for (const x of [...liveSet].sort()) if (!releasedSet.has(x)) problems.push(`${x} is live but missing from released: append it (released is append-only)`)
  // a Map and Object.hasOwn throughout: a successor named `constructor`, `toString` or `__proto__` is just an unknown ID
  const valid = new Map<string, string[]>()
  for (const [key, successors] of Object.entries(aliases)) {
    if (!releasedSet.has(key)) problems.push(`alias ${key}: not in released`)
    if (liveSet.has(key)) problems.push(`alias ${key}: is a live ID; remove it from the aliases`)
    if (!isStringList(successors) || successors.length === 0) {
      problems.push(`alias ${key}: needs a non-empty list of successor IDs`)
      continue
    }
    valid.set(key, successors)
    if (new Set(successors).size !== successors.length || successors.includes(key)) problems.push(`alias ${key}: successors must be distinct and not the ID itself`)
    for (const s of successors) if (!liveSet.has(s) && !Object.hasOwn(aliases, s)) problems.push(`alias ${key}: successor ${s} is neither live nor an alias`)
  }
  for (const key of [...releasedSet].filter((x) => !liveSet.has(x)).sort()) {
    if (!valid.has(key)) problems.push(`${key} was released and is no longer live but has no alias`)
  }
  for (const start of valid.keys()) {
    const seen = new Set<string>()
    const stack = [...(valid.get(start) as string[])]
    for (let x = stack.pop(); x !== undefined; x = stack.pop()) {
      if (x === start) {
        problems.push(`alias ${start}: the successors loop back to it`)
        break
      }
      if (!seen.has(x)) {
        seen.add(x)
        stack.push(...(valid.get(x) ?? []))
      }
    }
  }
  const validRecord = Object.fromEntries(valid)
  for (const x of released) if (resolveTopic(x, liveSet, validRecord).length === 0) problems.push(`${x} does not resolve to any live topic`)
  return problems
}

/**
 * Everything wrong with the frozen ledger `topics-released-v1.json`, or with the alias file's
 * `released` list against it; never throws. The ledger is sorted, unique and well-formed; every ID
 * in it is still in `released` (a released ID is never removed, so dropping one from the taxonomy
 * and from `released` together is caught: {@link aliasesProblems} alone cannot see it); and every
 * one still resolves to at least one live topic, directly or through the alias map, so a stored
 * override or fit-log entry is never orphaned.
 */
export function releasedLedgerProblems(rawLedger: Json, rawAliases: Json, live: ReadonlySet<string> | readonly string[]): string[] {
  if (!isRecord(rawLedger)) return ['the ledger must be a JSON object']
  const problems: string[] = []
  if (!sameKeys(rawLedger, LEDGER_KEYS)) problems.push(`top-level keys must be exactly ${LEDGER_KEYS.join(', ')}`)
  if (rawLedger.topics_version !== TOPICS_VERSION) problems.push(`topics_version must be '${TOPICS_VERSION}'`)
  const ids = rawLedger.ids
  if (!isStringList(ids) || ids.length === 0) return [...problems, 'ids must be a non-empty list of IDs']
  if (ids.join() !== [...new Set(ids)].sort().join()) problems.push('ids must be sorted and free of duplicates')
  for (const x of ids) if (!anyTopicId(x)) problems.push(`ledger: '${x}' is not a valid topic ID`)
  const released = new Set(isRecord(rawAliases) && isStringList(rawAliases.released) ? rawAliases.released : [])
  const aliasMap = isRecord(rawAliases) && isRecord(rawAliases.aliases) ? rawAliases.aliases : {}
  const aliases: Record<string, string[]> = Object.fromEntries(Object.entries(aliasMap).filter((e): e is [string, string[]] => isStringList(e[1])))
  const liveSet = new Set(live)
  const shipped = `shipped in ${TOPICS_VERSION} (${LEDGER_FILE})`
  const unique = [...new Set(ids)].sort()
  for (const x of unique.filter((y) => !released.has(y))) {
    problems.push(`${x} ${shipped} but is missing from released: a released ID is never removed; if it was retired, keep it in released and map it in aliases`)
  }
  for (const x of unique) {
    if (resolveTopic(x, liveSet, aliases).length === 0) problems.push(`${x} ${shipped} but no longer resolves to a live topic: map it in aliases to its successors`)
  }
  return problems
}

// --- resolution ----------------------------------------------------------------------------------

/**
 * The live IDs a stored `id` stands for: itself when it is live, else the live successors reached
 * through `aliases` (a split ID has several), sorted; `[]` for an ID that was never released, or
 * whose chain dead-ends ({@link aliasesProblems} rejects both for a released ID). A cycle terminates.
 */
export function resolveTopic(id: string, live: ReadonlySet<string>, aliases: Readonly<Record<string, readonly string[]>>): string[] {
  const out = new Set<string>()
  const seen = new Set<string>()
  const stack = [id]
  for (let x = stack.pop(); x !== undefined; x = stack.pop()) {
    if (live.has(x)) out.add(x)
    else if (!seen.has(x)) {
      seen.add(x)
      stack.push(...(Object.hasOwn(aliases, x) ? (aliases[x] as readonly string[]) : []))
    }
  }
  return [...out].sort()
}

// --- the committed taxonomy ----------------------------------------------------------------------

export interface TopicNode {
  readonly id: string
  readonly kind: TopicKind
  readonly label: string
  /** The axis (`QR` for a quant group); null for `other/` topics. */
  readonly axis: AxisCode | null
  /** A topic's facet (the middle segment of its ID); null for every other kind. */
  readonly facet: string | null
  /** A topic's facet ID, `<axis>/<facet>`; null for every other kind. */
  readonly parent: string | null
  /** A group's template facets; empty for every other kind. */
  readonly templates: readonly string[]
}

interface RawNode {
  id: string
  kind: TopicKind
  label: string
  axis?: AxisCode
  facet?: string
  templates?: string[]
}
interface RawTaxonomy {
  denied_words: Record<string, string[]>
  nodes: RawNode[]
}
const RAW = rawTaxonomy as unknown as RawTaxonomy
const RAW_ALIASES = rawAliases as unknown as { released: string[]; aliases: Record<string, string[]> }

/** Every entry of `topics-v1.json`, in file order (quant groups, then the finite axes, then `other/`). */
export const TOPIC_NODES: readonly TopicNode[] = Object.freeze(
  RAW.nodes.map((n) =>
    Object.freeze({
      id: n.id,
      kind: n.kind,
      label: n.label,
      axis: n.axis ?? null,
      facet: n.facet ?? null,
      parent: n.kind === 'topic' ? n.id.slice(0, n.id.lastIndexOf('/')) : null,
      templates: Object.freeze([...(n.templates ?? [])]),
    }),
  ),
)
const BY_ID: ReadonlyMap<string, TopicNode> = new Map(TOPIC_NODES.map((n) => [n.id, n]))

/** The live topic IDs. */
export const TOPIC_IDS: ReadonlySet<string> = new Set(BY_ID.keys())
/** The word lists of `topics-v1.json` (`denied_words`). */
export const DENIED_WORDS: Readonly<Record<string, readonly string[]>> = Object.freeze(RAW.denied_words)
/** Every ID any released taxonomy has contained (`topics-aliases.json`). */
export const RELEASED_IDS: readonly string[] = Object.freeze([...RAW_ALIASES.released])
/** Retired or split ID → successors (`topics-aliases.json`). */
export const TOPIC_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({ ...RAW_ALIASES.aliases })

export const topicNode = (id: string): TopicNode | undefined => BY_ID.get(id)
export const isTopicId = (value: unknown): value is string => typeof value === 'string' && BY_ID.has(value)
export const topicLabel = (id: string): string | undefined => BY_ID.get(id)?.label
export const nodesOfKind = (kind: TopicKind): readonly TopicNode[] => TOPIC_NODES.filter((n) => n.kind === kind)
/** The `kind: topic` children of a facet ID. */
export const topicsOfFacet = (facetId: string): readonly TopicNode[] => TOPIC_NODES.filter((n) => n.parent === facetId)
export const facetsOf = (axis: AxisCode): readonly TopicNode[] => TOPIC_NODES.filter((n) => n.kind === 'facet' && n.axis === axis)

/** {@link resolveTopic} against the committed taxonomy and alias file: a stored ID → live IDs. */
export const resolveTopicId = (id: string): string[] => resolveTopic(id, TOPIC_IDS, TOPIC_ALIASES)

/**
 * Why an item tagged `topic` on `axis` with `facet` is inconsistent, or null. The topic must be a
 * live `kind: topic` ID, and its `<axis>/<facet>/` prefix must equal the item's axis and `facet`
 * (proposal §5.1; G1 in AI.2). A retired ID is not accepted here: resolve it and retag first.
 */
export function topicPrefixProblem(topic: string, axis: string, facet: string): string | null {
  if (!(TOPIC_AXES as readonly string[]).includes(axis)) return `axis ${axis} carries no topic tag (only ${TOPIC_AXES.join(', ')})`
  const node = BY_ID.get(topic)
  if (node === undefined) return `unknown topic '${topic}' (a retired ID resolves through the alias map)`
  if (node.kind !== 'topic') return `'${topic}' is a ${node.kind}, not a topic under a facet`
  if (!topic.startsWith(`${axis.toLowerCase()}/${facet}/`)) return `topic '${topic}' is not under ${axis.toLowerCase()}/${facet}/ (axis ${axis}, facet '${facet}')`
  return null
}
