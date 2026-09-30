/**
 * What each line tells the assistant, in plain words (proposal §3.2: the checker shows "in plain
 * words what they tell the AI"). One entry per template, keyed by template id. A `{topics}` slot
 * takes the line's topic list ("programming and statistics"), `{interests}` its interests and
 * `{text}` a custom line's own words.
 *
 * These are descriptions for the person reading the checker, not notes: they may use digits-free
 * ordinary words only, name no level or ability, and never say or imply that the notes help (A22,
 * `BENEFIT_RE` in the copy tests). `meaning.test.ts` checks that every template has one.
 */

import { joinTopicLabels } from './topics'
import { joinInterests } from './interests'
import type { BriefLine, LineId } from './types'

const MEANING: Readonly<Record<LineId, string>> = {
  H: 'The notes are dated, say they are your own preferences and not a report about you, and ask the assistant to check with you when they are old or the date is unclear.',
  F1: 'What you ask for in the chat wins over the notes.',
  F2: 'The notes are starting guesses. The assistant should adjust to how you respond, not mention the notes unless you ask, and not save them to memory.',
  F3: 'Answers stay fully accurate: nothing is dropped to simplify, and nothing is held back because of the notes.',
  F4: 'The assistant should tell you plainly when you are wrong.',
  CC: 'For a coding assistant: the notes apply to explanations in the chat, not to code, comments, commit messages or documents others will read, and an unattended run should not stop to ask.',
  LANG: 'The notes apply in whatever language you chat in.',
  U1: 'Start with the answer in a sentence or two, then give the detail in short labelled parts.',
  U1c: 'Lead with the answer or the code, then briefly explain anything that is not obvious.',
  'LEN.short': 'Keep answers short and offer more detail at the end.',
  'LEN.detailed': 'Detailed answers are welcome.',
  U2: 'Use plain words; keep a technical term when it is the right one and define it briefly the first time.',
  'U2.b': 'Prefer everyday words; when a technical term is the right one, use it and define it in a few words the first time.',
  'U2.W3': 'Use plain words and short sentences; keep a technical term when it is the right one and define it briefly the first time.',
  U3: 'Introduce only a few new ideas at a time, and number the steps of long explanations.',
  U4: 'When the assistant is unsure whether you know a prerequisite, it asks one quick question instead of guessing.',
  U5: 'Give chances and risks as counts as well as percentages.',
  U6: 'On answers that matter, say how sure the assistant is and give one quick way to check.',
  U6c: 'On answers that matter, say how sure the assistant is and give one quick way to check, such as a test or a command.',
  U7: 'When summarising a document, keep its caveats and numbers and say what it does not claim.',
  U8: 'When editing your writing, keep your voice and word choices, and point out unclear sentences instead of rewriting everything.',
  FMT1: 'Use plain text: no tables, no Markdown symbols and no emoji.',
  FMT2: 'Describe diagrams and charts in words instead of drawing them with characters.',
  FMT3: 'Keep paragraphs short and put each step on its own line.',
  VOICE: 'In a voice chat: short spoken chunks, check that you are following, say symbols and numbers in words, and offer a written version of long step-by-step answers.',
  W1: 'General and academic vocabulary is fine; define only terms specific to a field.',
  W2: 'Explain less common words in a few words the first time, and keep the full technical depth.',
  W3: 'Use short sentences, one idea per sentence.',
  DS: 'On {topics}: skip the basics and go straight to the method, mentioning a step only if it is unusual.',
  'DS.k': 'On {topics}: skip the basics and go straight to mechanisms, evidence and open questions.',
  DA: 'On {topics}: before a long explanation, ask you one quick question to see where to start, once per conversation.',
  'DA.p': 'On {topics}: ask you one quick question to see where to start, once per conversation, then pitch the explanation to your answer.',
  DB: 'On {topics}: start from a small concrete example, then the general rule, showing every step and giving a quick way to check.',
  'DB.k': 'On {topics}: start from a small concrete example, then the general rule, naming each term and rule and giving a quick way to check.',
  'NT.skip': 'On {topics}: symbols and formal terms are fine.',
  'NT.build': 'On {topics}: write the logic in words rather than symbols, and label premises, assumptions and conclusions.',
  'U4.t': 'On any other topic, when unsure whether you know a prerequisite, ask one quick question instead of guessing.',
  AC1: 'Before a large change, tell you the plan in a few lines and wait for your go-ahead.',
  AC2: 'Explain each change briefly after making it.',
  K1: 'Defines three words you can say in a chat: "teach me" (hint first, you try), "just do it" (result plus one quick check) and "challenge me" (a harder case, and you justify your answer).',
  K1L: 'By default, teach: ask what you would try first, give hints before answers, and end with one short question. "Just do it" switches to plain answers.',
  K1D: '"Just do it" gives the result and one quick check.',
  K1C: '"Challenge me" on a topic you know gives a harder case or an edge case and asks you to justify before commenting; on a new topic it teaches instead.',
  K1F: 'On {topics}: show one worked example, then give you a similar one to finish yourself.',
  K2: 'Defines "deeper" (assume more, skip routine steps) and "more steps" (show every step and add an example).',
  I1: 'When the assistant needs an example, it draws on {interests}.',
  X1: 'A line in someone\'s own words, not one of the builder\'s: "{text}"',
}

/** Template ids that have a description (all of them; `meaning.test.ts`). */
export const MEANING_IDS: readonly LineId[] = Object.keys(MEANING)

/** The plain-words description of a line, or null for an id this build does not know. */
export function meaningOf(line: BriefLine): string | null {
  const m = MEANING[line.id]
  if (m === undefined) return null
  return m
    .replace('{topics}', () => joinTopicLabels(line.topics ?? [], false))
    .replace('{interests}', () => joinInterests(line.interests ?? []))
    .replace('{text}', () => line.text ?? '')
}

/** The description with its slots in general words ("the topics you choose"), for lists of line types. */
export function genericMeaning(id: LineId): string | null {
  const m = MEANING[id]
  if (m === undefined) return null
  return m.replace('{topics}', 'the topics you choose').replace('{interests}', 'your interests').replace('{text}', 'your own words')
}
