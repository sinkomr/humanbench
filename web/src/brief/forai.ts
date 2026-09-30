/**
 * `for-ai.md`: human documentation of the three explanation settings and the mode-by-setting table
 * (proposal §3.2, §4.6, §4.7). It is offered as a download and shown on the page, and it is never
 * linked from the notes: a link would turn the notes into a remote-controlled instruction channel
 * (proposal §6 row 15). The settings are internal; the notes themselves never name them.
 */

import { CLAIM } from './copy'

export interface ExplanationSetting {
  readonly name: string
  readonly startsWhen: string
  readonly steps: string
  readonly terms: string
  readonly example: string
  readonly prerequisites: string
  readonly checks: string
}

/** The three settings, each defined by what an output visibly does (proposal §4.6). */
export const EXPLANATION_SETTINGS: readonly ExplanationSetting[] = [
  {
    name: 'Build up',
    startsWhen: 'A build-up topic',
    steps: 'Every step, each rule named',
    terms: 'Each specialist term on first use; symbols introduced with words',
    example: 'Concrete example, then the general rule',
    prerequisites: 'Recap the one it needs',
    checks: 'A quick way to check the result',
  },
  {
    name: 'Meet me first',
    startsWhen: 'An ask-first topic, or no line',
    steps: 'Depends on the answer to one quick question',
    terms: 'Specialist terms on first use',
    example: 'Answer first; an example if the answer suggests it',
    prerequisites: 'Asks once per conversation',
    checks: 'Offers to expand',
  },
  {
    name: 'Skip the basics',
    startsWhen: 'A skip topic',
    steps: 'Non-routine steps only, and says so',
    terms: 'Field-specific terms defined; standard notation',
    example: 'Method first, then subtle cases and pitfalls',
    prerequisites: 'Assumed',
    checks: 'Only on answers that matter',
  },
]

/** Mode by setting (proposal §4.7): the rows are settings, the columns the three modes. */
export const MODE_TABLE: readonly { readonly setting: string; readonly do: string; readonly learn: string; readonly challenge: string }[] = [
  {
    setting: 'Skip the basics',
    do: 'Answer at method level; skip routine steps and say so; point out subtle cases and pitfalls',
    learn: 'Ask me to try first; hint only if I am stuck; ask why a key step works',
    challenge: 'A harder variant or edge case; ask me to justify before commenting; critique my reasoning plainly',
  },
  {
    setting: 'Meet me first',
    do: 'One short question or a one-line recap, then pitch to my answer',
    learn: 'Ask what I would try first; pitch from my attempt',
    challenge: 'One probe first; if solid, as skip; otherwise as teach me',
  },
  {
    setting: 'Build up',
    do: 'Intuition, then define each term, then one worked example, then the rule, then the answer, plus a way to check',
    learn: 'Worked example, then a faded one for me to finish; hints before answers; one or two recall questions at the end',
    challenge: 'Falls back to teach me: difficulty helps only with enough background',
  },
]

const row = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`

/** The Markdown text of `for-ai.md`. Deterministic; no URLs, no numbers about the person. */
export function forAiMarkdown(): string {
  const settings = [
    row(['Setting', 'Starts here when', 'Steps shown', 'Terms and symbols', 'Example and order', 'Prerequisites', 'Checks and questions']),
    row(['---', '---', '---', '---', '---', '---', '---']),
    ...EXPLANATION_SETTINGS.map((s) => row([s.name, s.startsWhen, s.steps, s.terms, s.example, s.prerequisites, s.checks])),
  ]
  const modes = [
    row(['Setting', 'Just do it', 'Teach me', 'Challenge me']),
    row(['---', '---', '---', '---']),
    ...MODE_TABLE.map((m) => row([m.setting, m.do, m.learn, m.challenge])),
  ]
  return [
    '# For AI: how these notes work',
    '',
    'This page is documentation for people. It is not part of the notes, and the notes never link to it.',
    '',
    `${CLAIM}`,
    '',
    '## What the notes are',
    '',
    'A short set of instructions that a person writes for their own AI assistant: how to word explanations, how deep to go on each topic they pick, and when to check. Every line comes from a fixed list of sentences. The notes never describe the person and never contain a number, level, score or label.',
    '',
    '## The three explanation settings',
    '',
    'The notes never name these settings. They are the observable behaviours behind the topic lines, so an output can be checked against them: how many steps are shown, whether terms are defined, where the example sits, whether the prerequisite is explained or asked about, and whether a check or question is offered.',
    '',
    ...settings,
    '',
    '## Modes and settings',
    '',
    'The default mode is the person\'s preference (just do it, or teach me). "Challenge me" is used only when the person says it. A request made in the chat always wins over the notes.',
    '',
    ...modes,
    '',
    '## Control words',
    '',
    '- teach me: give a hint first and let the person try',
    '- just do it: give the result and one quick check',
    '- challenge me: give a harder case or an edge case and ask the person to justify the answer',
    '',
    '## What is fixed in every set of notes',
    '',
    '- A dated header that says the notes are the person\'s own preferences, not an assessment, and asks to be checked after a date or when the date is unclear.',
    '- Requests in the chat win over the notes.',
    '- The notes are starting guesses: adjust to how the person responds, do not quote them, and do not save them or anything inferred from them to memory.',
    '- Keep full accuracy: never drop facts, numbers, caveats or safety information to simplify.',
    '- Tell the person plainly when they are wrong.',
    '',
    '## How they are made',
    '',
    'On the person\'s own device, by a fixed rule table. There is no AI writing the notes, no server, and nothing is saved. Text notes use plain letters and punctuation only, with digits only in the dates of the header.',
    '',
  ].join('\n')
}
