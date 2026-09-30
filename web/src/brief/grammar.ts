/**
 * The closed grammar `hb-brief/1` (ADR A20; proposal §4.2). Every line of the notes is one of these
 * templates with slots filled from closed lists (topic labels, typed interests) or, for the one
 * custom-line template X1, the person's own checked words. Nothing else can appear in the notes.
 *
 * - A template's `v` is its wording version. Changing the wording bumps it, which resets the line
 *   type's gate status (A22: "the wording is the treatment").
 * - `tier` T0 lines ship before the gate (generic good practice, proposal §7.3); T1 lines are the
 *   person's own choices and carry an "experimental" badge until their smoke gate passes.
 * - `long` / `short`: the wording in the long Markdown form (and the Skill file) and in the short
 *   plain-text form. `short: undefined` means the same wording; `null` means the line is not
 *   written in that form (proposal §3.2: ask-first topics, the direction words and the challenge
 *   line are long-form only; "ask first" reaches the short form through U4).
 * - Slots: `{Topics}` a joined topic list with a capital first letter, `{topics}` the same reading
 *   in the middle of a sentence, `{interests}` typed interests, `{custom}` the custom line.
 * - `research` and `basis` feed the "Why this line?" drawer only. They never enter the notes.
 *
 * Wording is copied from proposal §4.2 ("Example wording") and §4.9 (the worked examples). All
 * strings are ASCII, digit-free and pass the brief lint and the A13 lint; `grammar.test.ts` checks
 * that, that no two templates read the same in one form, and that wording and ids stay unique.
 */

import type { ContextPreset, Form, LineId, Section } from './types'

export type Slot = 'Topics' | 'topics' | 'interests' | 'custom'
/** Where a line prints; the note prints groups in this order (proposal §4.1, examples in §4.9). */
export type PrintGroup = 'always' | 'style' | 'topic' | 'work' | 'extras'
export type Basis = 'fixed' | 'default' | 'self_set'

export interface Template {
  readonly id: LineId
  /** Wording version; bump on any wording change (resets the gate status). */
  readonly v: string
  readonly section: Section
  readonly group: PrintGroup
  /** Position among the lines of the same group (ascending). */
  readonly order: number
  /** Tick key and phrasing-family root: `U1c` ticks as `U1`. */
  readonly base: LineId
  readonly tier: 'T0' | 'T1'
  readonly basis: Basis
  /** Locked lines cannot be switched off (the header, F1-F4, and CC in coding contexts). */
  readonly locked?: true
  /** The header line: written by `headerLines`, not as a bullet; it carries the as-of and revisit months. */
  readonly header?: true
  /**
   * Written in the short form only if it fits: when the short text is over the limit these go first,
   * before the section order applies ("U3: long form; short if it fits", proposal §4.2).
   */
  readonly fit?: true
  readonly long: string | null
  readonly short?: string | null
  /** Control words this line defines (`keywords` in the JSON). */
  readonly keywords?: Readonly<Record<string, string>>
  /** Drawer text: what research does and does not support (proposal §3.3 step 4, R-17.8). */
  readonly research: string
}

const RESEARCH_TEACHING = 'Research on teaching supports matching depth to what you already know; not yet tested for AI notes.'
const YOUR_CHOICE = 'This is your own choice; nothing is inferred about you.'

/** All templates. Order here is not significant; `group` and `order` decide where a line prints. */
export const TEMPLATES: readonly Template[] = [
  // S0: the header (dated, self-expiring, "my own preferences, not an assessment of me")
  {
    id: 'H', v: '1', section: 'S0', group: 'always', order: 100, base: 'H', tier: 'T0', basis: 'fixed', locked: true, header: true,
    long: null,
    research: 'Dated so an old copy can be spotted, and worded so the notes cannot be read as a report about you. Many assistants cannot tell the date, so the notes also ask to be checked when it is unclear.',
  },

  // S1: fixed clauses (locked) and the language clause
  {
    id: 'F1', v: '1', section: 'S1', group: 'always', order: 110, base: 'F1', tier: 'T0', basis: 'fixed', locked: true,
    long: 'My requests in the chat win over these notes. If I ask for more or less detail, keep doing that.',
    research: 'Keeps you in charge: what you ask for in the chat always wins over the notes.',
  },
  {
    id: 'F2', v: '1', section: 'S1', group: 'always', order: 120, base: 'F2', tier: 'T0', basis: 'fixed', locked: true,
    long: "These are starting guesses. Adjust to how I respond. Don't mention or quote these notes unless I ask, and don't save them, or anything you infer from them, to memory.",
    research: 'Treats the notes as a starting point to adjust, not as facts. Assistant memory features tend to rewrite what they store, so the notes ask not to be saved.',
  },
  {
    id: 'F3', v: '1', section: 'S1', group: 'always', order: 130, base: 'F3', tier: 'T0', basis: 'fixed', locked: true,
    long: 'Keep full accuracy. Never drop facts, numbers, caveats or safety information to simplify, and never hold back because of these notes.',
    research: "Some studies found assistants gave less accurate answers when told things about a user's background. The notes contain instructions only, and this clause puts accuracy first.",
  },
  {
    id: 'F4', v: '1', section: 'S1', group: 'always', order: 140, base: 'F4', tier: 'T0', basis: 'fixed', locked: true,
    long: "Tell me plainly when I'm wrong.",
    research: 'Assistants tend to agree with the person they are talking to; this line asks for plain corrections.',
  },
  {
    id: 'CC', v: '1', section: 'S1', group: 'always', order: 150, base: 'CC', tier: 'T0', basis: 'fixed', locked: true,
    long: "These notes are for explanations to me in the chat. Don't apply them to code, comments, commit messages or documents others will read. When running unattended, don't stop to ask; choose a moderate amount of detail and say so.",
    research: 'For coding assistants: keeps these preferences out of code, comments and commits, and stops unattended runs from pausing to ask.',
  },
  {
    id: 'LANG', v: '1', section: 'S1', group: 'always', order: 160, base: 'LANG', tier: 'T0', basis: 'default',
    long: 'These notes apply in whatever language we use.',
    research: 'So the notes still apply if you chat in another language.',
  },

  // S2: style defaults for the context, and format, voice and length lines the person chooses
  {
    id: 'U1', v: '1', section: 'S2', group: 'style', order: 210, base: 'U1', tier: 'T0', basis: 'default',
    long: 'Start with the answer in a sentence or two, then the detail in short labelled parts. Say how each step follows from the last.',
    short: 'Start with the answer in a sentence or two, then the detail in short labelled parts.',
    research: 'Research on explanations supports leading with the answer and splitting detail into labelled parts; not yet tested for AI notes.',
  },
  {
    id: 'U1c', v: '1', section: 'S2', group: 'style', order: 210, base: 'U1', tier: 'T0', basis: 'default',
    long: 'Lead with the answer or the code, then briefly explain anything non-obvious.',
    research: 'Research on explanations supports leading with the answer; not yet tested for AI notes.',
  },
  {
    id: 'LEN.short', v: '1', section: 'S2', group: 'style', order: 220, base: 'LEN', tier: 'T0', basis: 'self_set',
    long: 'Keep answers short and offer more detail at the end.',
    research: YOUR_CHOICE,
  },
  {
    id: 'LEN.detailed', v: '1', section: 'S2', group: 'style', order: 220, base: 'LEN', tier: 'T0', basis: 'self_set',
    long: 'Detailed answers are welcome.',
    research: YOUR_CHOICE,
  },
  {
    id: 'U2', v: '1', section: 'S2', group: 'style', order: 230, base: 'U2', tier: 'T0', basis: 'default',
    long: 'Use plain words. Keep a technical term when it is the right one, and define it briefly the first time.',
    research: 'Plain words are a sensible default for everyone; needless long words can make writing read as less clear. Technical terms stay when they are the right ones.',
  },
  {
    id: 'U2.b', v: '1', section: 'S2', group: 'style', order: 230, base: 'U2', tier: 'T0', basis: 'default',
    long: 'Prefer everyday words. When a technical term is the right one, use it and define it in a few words the first time.',
    research: 'Plain words are a sensible default for everyone; technical terms stay when they are the right ones.',
  },
  {
    id: 'U2.W3', v: '1', section: 'S2', group: 'style', order: 230, base: 'U2', tier: 'T0', basis: 'default',
    long: 'Use plain words and short sentences. Keep a technical term when it is the right one, and define it briefly the first time.',
    research: 'Plain words are a sensible default for everyone. Short sentences are your own choice. Technical terms stay when they are the right ones.',
  },
  {
    id: 'U3', v: '1', section: 'S2', group: 'style', order: 240, base: 'U3', tier: 'T0', basis: 'default', fit: true,
    long: 'Introduce only a few new ideas at a time, and number the steps of long explanations.',
    research: 'Research on memory and on splitting material into parts supports a few new ideas at a time; not yet tested for AI notes.',
  },
  {
    id: 'U4', v: '1', section: 'S2', group: 'style', order: 250, base: 'U4', tier: 'T0', basis: 'default',
    long: "If you're unsure whether I know a prerequisite, ask one quick question instead of guessing.",
    research: 'Research on teaching supports finding out what someone already knows before explaining; not yet tested for AI notes. The line asks only when unsure, and only once.',
  },
  {
    id: 'U5', v: '1', section: 'S2', group: 'style', order: 260, base: 'U5', tier: 'T0', basis: 'default',
    long: 'Give chances and risks as counts (so many out of a hundred) as well as percentages.',
    research: 'People read chances more accurately as counts than as percentages.',
  },
  {
    id: 'U6', v: '1', section: 'S2', group: 'style', order: 270, base: 'U6', tier: 'T0', basis: 'default', fit: true,
    long: 'On answers that matter, say how sure you are and give me one quick way to check.',
    research: 'Research on people using assistants found that they tend to follow answers even where they are wrong; not yet tested for AI notes. The line asks for a way to check.',
  },
  {
    id: 'U6c', v: '1', section: 'S2', group: 'style', order: 270, base: 'U6', tier: 'T0', basis: 'default', fit: true,
    long: 'On answers that matter, say how sure you are and give me one quick way to check, such as a test or a command.',
    research: 'Research on people using assistants found that they tend to follow answers even where they are wrong; not yet tested for AI notes. For code, a test or a command is a quick way to check.',
  },
  {
    id: 'U7', v: '1', section: 'S2', group: 'style', order: 280, base: 'U7', tier: 'T0', basis: 'default',
    long: 'When summarising a document, keep its caveats and numbers, and say what it does not claim.',
    research: 'Summaries can drop caveats; this line asks the assistant to keep them.',
  },
  {
    id: 'U8', v: '1', section: 'S2', group: 'style', order: 290, base: 'U8', tier: 'T0', basis: 'default',
    long: 'When editing my writing, keep my voice and word choices; point out unclear sentences instead of rewriting everything.',
    research: 'Keeps your voice as the writer. HumanBench results add little to writing feedback, so this context uses no results.',
  },
  {
    id: 'FMT1', v: '1', section: 'S2', group: 'style', order: 300, base: 'FMT1', tier: 'T1', basis: 'self_set',
    long: 'Use plain text: no tables, no Markdown symbols and no emoji.',
    research: YOUR_CHOICE,
  },
  {
    id: 'FMT2', v: '1', section: 'S2', group: 'style', order: 310, base: 'FMT2', tier: 'T1', basis: 'self_set',
    long: 'Describe any diagram or chart in words instead of drawing it with characters.',
    research: YOUR_CHOICE,
  },
  {
    id: 'FMT3', v: '1', section: 'S2', group: 'style', order: 320, base: 'FMT3', tier: 'T1', basis: 'self_set',
    long: 'Keep paragraphs short, and put each step on its own line.',
    research: YOUR_CHOICE,
  },
  {
    id: 'VOICE', v: '1', section: 'S2', group: 'style', order: 330, base: 'VOICE', tier: 'T1', basis: 'self_set', fit: true,
    long: "When we talk by voice, use short spoken chunks, check that I'm following, say symbols and numbers in words, and offer a written version of long step-by-step answers.",
    research: YOUR_CHOICE,
  },

  // S6: word and sentence choices (printed with the style lines, dropped after the modes)
  {
    id: 'W1', v: '1', section: 'S6', group: 'style', order: 340, base: 'W1', tier: 'T1', basis: 'self_set',
    long: 'General and academic vocabulary is fine; define only terms specific to a field.',
    research: YOUR_CHOICE,
  },
  {
    id: 'W2', v: '1', section: 'S6', group: 'style', order: 350, base: 'W2', tier: 'T1', basis: 'self_set',
    long: 'Explain less common words in a few words the first time you use them, and keep the full technical depth.',
    research: YOUR_CHOICE,
  },
  {
    id: 'W3', v: '1', section: 'S6', group: 'style', order: 360, base: 'W3', tier: 'T1', basis: 'self_set',
    long: 'Use short sentences, one idea per sentence.',
    research: YOUR_CHOICE,
  },

  // S3: depth by topic. The person sets skip / ask first / build up for each topic they pick.
  {
    id: 'DS', v: '1', section: 'S3', group: 'topic', order: 410, base: 'DS', tier: 'T1', basis: 'self_set',
    long: '{Topics}: skip the basics and go straight to the method. Mention a step only if it is unusual.',
    research: RESEARCH_TEACHING,
  },
  {
    id: 'DS.k', v: '1', section: 'S3', group: 'topic', order: 420, base: 'DS', tier: 'T1', basis: 'self_set',
    long: '{Topics}: skip the basics and go straight to mechanisms, evidence and open questions. Mention background only if it is unusual.',
    research: RESEARCH_TEACHING,
  },
  {
    id: 'DA', v: '1', section: 'S3', group: 'topic', order: 430, base: 'DA', tier: 'T1', basis: 'self_set',
    long: '{Topics}: before a long explanation, ask me one quick question to see where to start, once per conversation.',
    short: null,
    research: RESEARCH_TEACHING,
  },
  {
    id: 'DA.p', v: '1', section: 'S3', group: 'topic', order: 430, base: 'DA', tier: 'T1', basis: 'self_set',
    long: '{Topics}: before a long explanation, ask me one quick question to see where to start, once per conversation, then pitch to my answer.',
    short: null,
    research: RESEARCH_TEACHING,
  },
  {
    id: 'DB', v: '1', section: 'S3', group: 'topic', order: 440, base: 'DB', tier: 'T1', basis: 'self_set',
    long: '{Topics}: start from a small concrete example, then the general rule. Show every step, name each rule you use, and give me a quick way to check the result.',
    research: 'Research on worked examples supports starting from an example and showing every step; not yet tested for AI notes.',
  },
  {
    id: 'DB.k', v: '1', section: 'S3', group: 'topic', order: 450, base: 'DB', tier: 'T1', basis: 'self_set',
    long: '{Topics}: start from a small concrete example, then the general rule. Name each term and rule as you use it, and give me a quick way to check the result or a source.',
    research: 'Research on worked examples supports starting from an example and naming each term; not yet tested for AI notes.',
  },
  {
    id: 'NT.skip', v: '1', section: 'S3', group: 'topic', order: 460, base: 'NT', tier: 'T1', basis: 'self_set',
    long: '{Topics}: symbols and formal terms are fine.',
    research: 'Symbols and formal notation are prior knowledge, so this is the setting you chose for it; not yet tested for AI notes.',
  },
  {
    id: 'NT.build', v: '1', section: 'S3', group: 'topic', order: 470, base: 'NT', tier: 'T1', basis: 'self_set',
    long: '{Topics}: write the logic in words rather than symbols, and label each part as premise, assumption or conclusion.',
    research: 'Symbols and formal notation are prior knowledge, so this is the setting you chose for it; not yet tested for AI notes.',
  },
  {
    id: 'U4.t', v: '1', section: 'S3', group: 'topic', order: 480, base: 'U4', tier: 'T0', basis: 'default',
    long: "Any other topic: if you're unsure whether I know a prerequisite, ask one quick question instead of guessing.",
    short: null,
    research: 'Research on teaching supports finding out what someone already knows before explaining; not yet tested for AI notes. The line asks only when unsure, and only once.',
  },

  // S5: working together with a coding agent (the person's choice)
  {
    id: 'AC1', v: '1', section: 'S5', group: 'work', order: 510, base: 'AC1', tier: 'T1', basis: 'self_set',
    long: 'Before a large change, tell me the plan in a few lines and wait for my go-ahead.',
    research: YOUR_CHOICE,
  },
  {
    id: 'AC2', v: '1', section: 'S5', group: 'work', order: 520, base: 'AC2', tier: 'T1', basis: 'self_set',
    long: 'Explain each change briefly after you make it.',
    research: YOUR_CHOICE,
  },

  // S4: modes and control words
  {
    id: 'K1', v: '1', section: 'S4', group: 'work', order: 610, base: 'K1', tier: 'T0', basis: 'default',
    long: 'If I say "teach me", give a hint first and let me try. If I say "just do it", give the result and one quick check. If I say "challenge me", give me a harder case and ask me to justify my answer.',
    keywords: { 'teach me': 'learn', 'just do it': 'do', 'challenge me': 'challenge' },
    research: 'Research on hints and self-explanation supports trying a problem before seeing the answer; not yet tested for AI notes. You choose per request. Mid-chat requests fade over a long chat, so the notes define the words up front.',
  },
  {
    id: 'K1L', v: '1', section: 'S4', group: 'work', order: 620, base: 'K1L', tier: 'T0', basis: 'default',
    long: "By default, teach: ask what I'd try first, give hints before answers, and end with one short question that checks the idea.",
    short: `By default, teach: ask what I'd try first, give hints before answers, and end with one short question that checks the idea. If I say "just do it", give the result and one quick check.`,
    keywords: { 'just do it': 'do' },
    research: 'Research on hints and self-explanation supports trying a problem before seeing the answer; not yet tested for AI notes.',
  },
  {
    id: 'K1D', v: '1', section: 'S4', group: 'work', order: 630, base: 'K1D', tier: 'T0', basis: 'default',
    long: 'If I say "just do it", give the result and one quick check.',
    short: null,
    keywords: { 'just do it': 'do' },
    research: 'Lets you switch to plain answers whenever you want them.',
  },
  {
    id: 'K1C', v: '1', section: 'S4', group: 'work', order: 640, base: 'K1C', tier: 'T0', basis: 'default',
    long: 'If I say "challenge me" on a topic I know, give me a harder case or an edge case and ask me to justify my answer before you comment. On a topic that is new to me, teach instead.',
    short: null,
    keywords: { 'challenge me': 'challenge' },
    research: 'Harder cases suit people who already have the background, so on new ground the notes fall back to teaching.',
  },
  {
    id: 'K1F', v: '1', section: 'S4', group: 'work', order: 650, base: 'K1F', tier: 'T1', basis: 'self_set',
    long: 'On {topics}, show one worked example, then give me a similar one to finish myself.',
    short: null,
    research: 'Research on worked examples supports moving from a full example to one you finish yourself; not yet tested for AI notes.',
  },
  {
    id: 'K2', v: '1', section: 'S4', group: 'work', order: 660, base: 'K2', tier: 'T1', basis: 'default',
    long: '"Deeper" means assume more and skip routine steps. "More steps" means show every step and add an example.',
    short: null,
    keywords: { deeper: 'up', 'more steps': 'down' },
    research: 'Assistants follow direction words unreliably, so this line stays off until it has been checked.',
  },

  // S7: interests and the person's own line
  {
    id: 'I1', v: '1', section: 'S7', group: 'extras', order: 810, base: 'I1', tier: 'T1', basis: 'self_set',
    long: 'When you need an example, use {interests}.',
    research: 'Research on examples supports drawing them from a learner\'s interests; not yet tested for AI notes. Interests are never saved.',
  },
  {
    id: 'X1', v: '1', section: 'S7', group: 'extras', order: 820, base: 'X1', tier: 'T1', basis: 'self_set',
    long: '{custom}',
    research: 'Your own words, checked for web addresses, numbers and wording about you. Custom lines are never saved.',
  },
]

export const TEMPLATE_BY_ID: ReadonlyMap<LineId, Template> = new Map(TEMPLATES.map((t) => [t.id, t]))

export function template(id: LineId): Template {
  const t = TEMPLATE_BY_ID.get(id)
  if (!t) throw new RangeError(`unknown template ${JSON.stringify(id)}`)
  return t
}

/** Phrasing families: the alternative wordings the person may choose between ("Edit", proposal §3.3 step 4). */
export const PHRASING_FAMILIES: Readonly<Record<string, readonly LineId[]>> = {
  U1: ['U1', 'U1c'],
  U2: ['U2', 'U2.b'],
  U6: ['U6', 'U6c'],
  DA: ['DA', 'DA.p'],
}

/** The family a template belongs to, if it has alternatives. */
export function familyOf(id: LineId): readonly LineId[] | undefined {
  const base = TEMPLATE_BY_ID.get(id)?.base
  return base === undefined ? undefined : PHRASING_FAMILIES[base]
}

/** Slots a template's text uses, in order of appearance. */
export function slotsOf(text: string): Slot[] {
  return [...text.matchAll(/\{(Topics|topics|interests|custom)\}/gu)].map((m) => m[1] as Slot)
}

/** The wording of a template in a form, or `null` when the line is not written in that form. */
export function wording(t: Template, form: Form): string | null {
  if (form === 'short') return t.short === undefined ? t.long : t.short
  return t.long
}

// --- header, headings and the Skill front matter ------------------------------------------------

export const NOTES_TITLE = 'How I like explanations'
export const SKILL_NAME = 'working-with-me'

/** The body of the header line (proposal §4.2 H): dated, self-expiring, with a no-date fallback. */
export function headerBody(asOf: string, revisit: string, capital: boolean): string {
  const body = `my own preferences, not an assessment of me. Written ${asOf}. After ${revisit}, or if you can't tell today's date, check with me before relying on the topic lines.`
  return capital ? body.charAt(0).toUpperCase() + body.slice(1) : body
}

/** The header lines of a form: one line for short, a title and a body for long and Skill. */
export function headerLines(form: Form, asOf: string, revisit: string): string[] {
  if (form === 'short') return [`${NOTES_TITLE}: ${headerBody(asOf, revisit, false)}`]
  return [`# ${NOTES_TITLE}`, headerBody(asOf, revisit, true)]
}

/** Matches a header body; captures as-of and revisit months. */
const HEADER_BODY_RE = /^[Mm]y own preferences, not an assessment of me\. Written (\d{4}-\d{2})\. After (\d{4}-\d{2}), or if you can't tell today's date, check with me before relying on the topic lines\.$/u

export function parseHeaderBody(text: string): { asOf: string; revisit: string; capital: boolean } | null {
  const m = HEADER_BODY_RE.exec(text)
  if (!m) return null
  return { asOf: m[1] as string, revisit: m[2] as string, capital: text.startsWith('M') }
}

/** Section headings of the long form (proposal §4.9). Reading contexts call the style block by its job. */
export const HEADINGS = {
  always: 'Always',
  style: 'Style',
  styleReading: 'Reading and summarising',
  topic: 'By topic',
  work: 'Working together',
  modes: 'Modes',
  extras: 'My additions',
  examples: 'Examples',
} as const

export const KNOWN_HEADINGS: ReadonlySet<string> = new Set(Object.values(HEADINGS))

/** One-sentence Skill descriptions: what makes the assistant load the file (proposal §3.2). */
export const SKILL_DESCRIPTIONS: Readonly<Record<ContextPreset, string>> = {
  coding: 'How I like explanations. Use when explaining a concept, code or an error to me in the chat, or teaching me something.',
  learning: 'How I like explanations. Use when explaining a concept to me or teaching me something.',
  reading: 'How I like explanations. Use when explaining a concept, summarising a document, or teaching me something.',
  numbers: 'How I like explanations. Use when explaining a calculation or some numbers to me, or teaching me something.',
  writing: 'How I like explanations. Use when explaining something to me, editing my writing, or teaching me something.',
  general: 'How I like explanations. Use when explaining a concept to me or teaching me something.',
}

/** The Skill front matter lines for a context. */
export function skillFrontMatter(preset: ContextPreset): string[] {
  return ['---', `name: ${SKILL_NAME}`, `description: ${SKILL_DESCRIPTIONS[preset]}`, '---']
}
