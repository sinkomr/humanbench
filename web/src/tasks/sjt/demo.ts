/**
 * Synthetic practice situations for the dev-only page `#/dev/sjt` and its e2e (ROADMAP M6.2; A6). No finite
 * situation is in this repo: the bank keeps every real item and its key (DESIGN §5.3, CLAUDE.md). The entry is exercised
 * on practice situations made up here, each flagged as such in its text, everyday and low-stakes (no health, money
 * hardship, violence or loss), seeded (A11) and carrying an id that cannot be a bank id (`demo:sjt:<seed>`). They are
 * never part of a session's pool and say nothing about any real key.
 *
 * The demo's own ratings (what this page counts as its intended profile, four numbers in [1, 4] in display order) are
 * returned beside the spec, never inside it, so a page shows the renderer the spec only, as the server does.
 */

import { createRng, type RngSeed } from '../../engine/prng'
import { SJT_OPTIONS, type SjtSpec } from './spec'

/** A practice situation: the spec the renderer gets and the ratings only the demo page knows. */
export interface DemoSjtItem {
  /** `demo:sjt:<seed>`: never an A11 bank id. */
  readonly item_id: string
  readonly spec: SjtSpec
  /** The demo's intended rating of each response, in display order: four numbers in [1, 4]. */
  readonly ratings: readonly number[]
  /** One line shown with the feedback. */
  readonly explanation: string
}

interface Template {
  /** The situation, with `{name}` for the person. */
  readonly situation: string
  /** The four responses with the demo's rating of each, in authoring order (the item shuffles them). */
  readonly responses: readonly (readonly [text: string, rating: number])[]
  readonly explanation: string
}

const QUESTION = 'How well would each response work?'

const NAMES = ['Ada', 'Bo', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Ida', 'Jo', 'Kit', 'Lou', 'Max'] as const

const TEMPLATES: readonly Template[] = [
  {
    situation:
      'A practice situation made up for this page: {name} and three friends want to see a film together on Friday. Two friends would like a comedy, one would like a documentary, and the booking page closes in an hour. {name} has the booking page open.',
    responses: [
      ['Suggest a quick vote on the three choices and book the one that wins.', 4],
      ['Book the comedy straight away, since two friends asked for it.', 2.5],
      ['Ask the friends to decide among themselves and say that {name} is happy with anything.', 2],
      ['Book the film {name} prefers without asking anyone.', 1],
    ],
    explanation: 'The demo rates a response higher when it keeps everyone involved and settles the question in time.',
  },
  {
    situation:
      'A practice situation made up for this page: {name} shares a flat. For the second day running there is a pile of dirty dishes in the sink, and {name} has friends coming for dinner tonight.',
    responses: [
      ['Wash enough dishes to cook with, then ask the flatmates to agree a simple washing-up routine.', 4],
      ['Ask the flatmates to clear the sink before tonight and offer to help.', 3],
      ['Cook around the dishes without a word.', 2],
      ['Leave a sharp note on the sink about who has been messy.', 1.5],
    ],
    explanation: 'The demo rates a response higher when it solves tonight\'s problem and also deals with the cause.',
  },
  {
    situation:
      'A practice situation made up for this page: {name} is leading a short planning meeting. A colleague keeps returning to an interesting side topic, and only ten minutes of the meeting remain for the agenda.',
    responses: [
      ['Thank the colleague, note the side topic for another day and go back to the agenda.', 4],
      ['Jump to the last agenda item and say nothing about the side topic.', 2.5],
      ['Let the colleague finish and move the rest of the agenda to next week.', 2],
      ['Tell the colleague that the side topic is a waste of everyone\'s time.', 1],
    ],
    explanation: 'The demo rates a response higher when it respects the colleague and still keeps the meeting on track.',
  },
  {
    situation:
      'A practice situation made up for this page: {name} notices that a message about a surprise party was posted in a group chat, and the guest of honour is a member of that chat.',
    responses: [
      ['Message the organiser privately so they can decide what to do.', 4],
      ['Post a cheerful message about a different event, to change the subject.', 2.5],
      ['Say nothing and hope the guest of honour has not read it.', 2],
      ['Tell the guest of honour in the chat what the message is really about.', 1],
    ],
    explanation: 'The demo rates a response higher when the person who can fix it hears about it first.',
  },
]

/** The seeded practice situation: same seed, same text, same response order, same ratings (A11). */
export function demoSjtItem(seed: RngSeed): DemoSjtItem {
  const rng = createRng(`demo:sjt:${String(seed)}`)
  const tpl = rng.pick(TEMPLATES)
  const name = rng.pick(NAMES)
  const fill = (s: string): string => s.replaceAll('{name}', name)
  const shuffled = rng.shuffle(tpl.responses)
  if (shuffled.length !== SJT_OPTIONS) throw new Error(`a practice situation has ${SJT_OPTIONS} responses`)
  return {
    item_id: `demo:sjt:${String(seed)}`,
    spec: { scenario: fill(tpl.situation), question: QUESTION, responses: shuffled.map(([text]) => fill(text)) },
    ratings: shuffled.map(([, rating]) => rating),
    explanation: fill(tpl.explanation),
  }
}
