/**
 * The harness dump behind `npm run dump:briefs` (ROADMAP AI.4; proposal §7.3): a deterministic set
 * of notes, each with the text the assistant would see, its JSON, and the setting each topic line
 * stands for after the floor rule, so the bank's behaviour harness (AI.12a) can score assistants
 * against the same notes people paste. Pure: the CLI in `scripts/dump-briefs.ts` only writes it.
 */

import { PRESET_INFO } from './contexts'
import { buildBrief } from './build'
import { topicTemplate } from './build'
import { DEFAULT_GATES, floorGatePassed, type GateFile } from './gates'
import { PHRASING_FAMILIES } from './grammar'
import { lintNotes } from './lint'
import { PROFILES, harnessGrid, type Profile } from './profiles'
import { briefObject } from './render'
import { PREAMBLE, RESULTS_TALK_ID, RESULTS_TALK_V } from './results-talk'
import { TOPICS_VERSION, topicById } from './topics'
import { GENERATOR, TEMPLATES_VERSION, type Form, type Keywords, type TopicSetting } from './types'

export const DUMP_FORMAT = 'hb-brief-dump/1'

export interface DumpEntry {
  readonly name: string
  readonly context: string
  readonly mode: string
  readonly length: string
  readonly form: Form
  /** For each topic set: what the person chose, and the setting the notes state (the floor rule can change it). */
  readonly topics: Readonly<Record<string, { readonly set: TopicSetting; readonly effective: TopicSetting; readonly written: boolean }>>
  readonly text: string
  readonly chars: number
  readonly line_ids: readonly string[]
  readonly keywords: Keywords
  readonly json: Record<string, unknown>
  /** Always 0; the dump refuses to include notes that fail the lint. */
  readonly lint_violations: number
}

/**
 * The results-talk preamble the reveal and share-card screens offer (AI.6b; gate metric E22): the
 * harness runs its "what does this say about me?" prompts with and without this exact text.
 */
export interface DumpResultsTalk {
  readonly id: typeof RESULTS_TALK_ID
  /** The wording version; the gate status is keyed by it (A22). */
  readonly v: string
  readonly text: string
  readonly chars: number
}

export interface BriefDump {
  readonly format: typeof DUMP_FORMAT
  readonly templates: string
  readonly topics_version: string
  readonly generator: typeof GENERATOR
  readonly as_of: string
  readonly count: number
  readonly briefs: readonly DumpEntry[]
  readonly results_talk: DumpResultsTalk
}

const EFFECTIVE: Readonly<Record<string, TopicSetting>> = { DS: 'skip', 'DS.k': 'skip', 'NT.skip': 'skip', DA: 'ask_first', 'DA.p': 'ask_first', DB: 'build', 'DB.k': 'build', 'NT.build': 'build' }

function entry(p: Profile, gates: GateFile): DumpEntry {
  const r = buildBrief({ prefs: p.prefs, extras: p.extras, form: p.form, asOf: p.asOf, gates })
  const violations = lintNotes(r.text).length
  if (violations > 0) throw new Error(`dump: ${p.name} has ${violations} lint violations`)
  const written = new Set(r.brief.lines.flatMap((l) => (l.id === 'K1F' ? [] : (l.topics ?? []))))
  const floorApplies = !floorGatePassed(gates)
  const ask = PHRASING_FAMILIES.DA?.[0] ?? 'DA'
  const topics: Record<string, { set: TopicSetting; effective: TopicSetting; written: boolean }> = {}
  for (const [id, set] of Object.entries(p.prefs.topics)) {
    const topic = topicById(id)
    if (topic === undefined) continue
    // Logic notation has no ask-first line of its own: the general "ask one quick question" line covers it.
    const t = topicTemplate(topic, set, floorApplies, ask)
    topics[id] = { set, effective: t === null ? 'ask_first' : (EFFECTIVE[t.id] ?? set), written: written.has(id) }
  }
  return {
    name: p.name,
    context: p.prefs.preset,
    mode: p.prefs.mode,
    length: p.prefs.length,
    form: p.form,
    topics,
    text: r.text,
    chars: r.chars,
    line_ids: r.brief.lines.map((l) => l.id),
    keywords: r.brief.keywords,
    json: briefObject(r.brief),
    lint_violations: 0,
  }
}

/** The named profiles first, then the harness grid of every context x setting pattern x mode x length. */
export function buildDump(asOf: string, gates: GateFile = DEFAULT_GATES): BriefDump {
  const profiles: Profile[] = [...PROFILES.map((p) => ({ ...p, asOf })), ...harnessGrid(asOf)]
  const briefs = profiles.map((p) => entry(p, gates))
  const results_talk: DumpResultsTalk = { id: RESULTS_TALK_ID, v: RESULTS_TALK_V, text: PREAMBLE, chars: PREAMBLE.length }
  return { format: DUMP_FORMAT, templates: TEMPLATES_VERSION, topics_version: TOPICS_VERSION, generator: GENERATOR, as_of: asOf, count: briefs.length, briefs, results_talk }
}

/** Stable serialisation: two-space JSON and a final newline. */
export const serializeDump = (d: BriefDump): string => `${JSON.stringify(d, null, 2)}\n`

/** Contexts covered by the dump (for the harness to confirm coverage). */
export const DUMP_CONTEXTS: readonly string[] = Object.keys(PRESET_INFO)
