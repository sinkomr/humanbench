/**
 * Types of the "Notes for your AI" core (`web/src/brief/`; Phase AI, proposal v2 §3-§5, ADR A20,
 * requirements R-17.1-R-17.14). The notes are built on the device by a deterministic rule table
 * from the person's own settings; there is no LLM, no network and no results input in Part 1.
 *
 * Vocabulary (proposal §3.4, §4.1):
 * - a **template** is one line of the closed grammar `hb-brief/1` (`grammar.ts`);
 * - a **line** is a template instance in a brief (`BriefLine`): its id plus slot values;
 * - a **brief** is the resolved document (`Brief`): the lines that were rendered, in order;
 * - a **form** is how a brief is written out: short text, long Markdown, or an Agent Skill file.
 */

/** The grammar (and JSON) format this module writes. Older/newer `hb-brief/N` parse via `parse.ts`. */
export const BRIEF_FORMAT = 'hb-brief/1'
export type BriefFormat = typeof BRIEF_FORMAT

/** Template-set release stamp (`templates` in the JSON; the gates file names the same stamp). */
export const TEMPLATES_VERSION = '2026.09'

/** Generator identity written into the JSON (`generator`). No zone rule runs in Part 1 (A21 is Part 2). */
export const GENERATOR = { version: 'brief-0.1.0', zone_rule: 'z1', param_version: 'p0-spec' } as const

/** short: plain ASCII text, at most 1,500 characters; long: Markdown (`#` headings, `-` lists); skill: SKILL.md. */
export type Form = 'short' | 'long' | 'skill'

/** Character limits per form (proposal §3.2). The Skill limit applies to the whole file. */
export const FORM_LIMITS: Readonly<Record<Form, number>> = { short: 1500, long: 5000, skill: 5000 }

/** Sections of the notes, in their fixed order and priority (proposal §4.1): later sections drop first. */
export const SECTIONS = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'] as const
export type Section = (typeof SECTIONS)[number]

/** Where the notes are for (proposal §3.1). */
export const PRESETS = ['coding', 'learning', 'reading', 'numbers', 'writing', 'general'] as const
export type ContextPreset = (typeof PRESETS)[number]

/** A per-topic setting the person chooses: skip the basics, ask first, build up (proposal §4.6). */
export const TOPIC_SETTINGS = ['skip', 'ask_first', 'build'] as const
export type TopicSetting = (typeof TOPIC_SETTINGS)[number]

/** The default mode is a preference; "challenge me" is keyword-only (proposal §4.7). */
export const MODES = ['do', 'learn'] as const
export type Mode = (typeof MODES)[number]

/** Answer length is the person's toggle, never inferred (LEN); "standard" adds no line. */
export const LENGTHS = ['short', 'standard', 'detailed'] as const
export type Length = (typeof LENGTHS)[number]

/** T0 is always in; T1 is the picked topics of one context (the default); T2 is every topic set. */
export type Tier = 'T1' | 'T2'

/** Gate status of a line type (A22): shipped, experimental (badge), or blocked (never rendered). */
export type LineStatus = 'shipped' | 'experimental' | 'blocked'

/** A template id, e.g. `F1`, `U1c`, `LEN.short`, `DS.k`. */
export type LineId = string
/** A topic id from the taxonomy, e.g. `quant/probability_counting`. */
export type TopicId = string
/** A destination id from `surfaces.json`, e.g. `claude_code_skill`. */
export type DestinationId = string

/**
 * One line of a brief. Only `id` is always present. `topics` fills a topic slot (in taxonomy
 * order), `interests` fills I1, `text` is a custom line (X1, `custom: true`). `status` is written
 * only for an experimental line (the JSON of proposal §4.9 has no `status` on shipped lines).
 */
export interface BriefLine {
  readonly id: LineId
  readonly topics?: readonly TopicId[]
  readonly interests?: readonly string[]
  readonly text?: string
  readonly custom?: true
  readonly status?: 'experimental'
}

/** The control words the notes define (proposal §3.5), mirrored in the JSON. */
export type Keywords = Readonly<Record<string, string>>

/** The resolved document. The JSON export is this object (`render.ts`, `schema/brief-v1.json`). */
export interface Brief {
  readonly format: BriefFormat
  readonly templates: string
  readonly topics: string
  readonly groups: string
  readonly as_of: string
  readonly revisit: string
  readonly context: ContextPreset
  readonly form: Form
  readonly tier: Tier
  readonly mode_default: Mode
  readonly length: Length
  readonly lines: readonly BriefLine[]
  readonly keywords: Keywords
  readonly generator: { readonly version: string; readonly zone_rule: string; readonly param_version: string }
}

/** `YYYY-MM`. The only digits a note may contain (R-17.3). */
export const MONTH_RE = /^(?:19|20|21)\d\d-(?:0[1-9]|1[0-2])$/

/** The month `n` months after `month` (`YYYY-MM`). */
export function addMonths(month: string, n: number): string {
  if (!MONTH_RE.test(month)) throw new RangeError(`addMonths: not a YYYY-MM month: ${JSON.stringify(month)}`)
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7)) - 1 + n
  const year = y + Math.floor(m / 12)
  const mon = ((m % 12) + 12) % 12
  return `${String(year).padStart(4, '0')}-${String(mon + 1).padStart(2, '0')}`
}

/** How many months after `as_of` the notes ask to be checked (proposal §4.2 H: "Written 2026-11 ... After 2027-05"). */
export const REVISIT_MONTHS = 6
