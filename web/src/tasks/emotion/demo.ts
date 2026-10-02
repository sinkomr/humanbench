/**
 * A synthetic demo vignette for the dev-only page `#/dev/emotion` and its e2e (ROADMAP M6.1; A6).
 * No finite vignette is in this repo: the bank keeps every real item, its appraisal profile and its
 * key (DESIGN §5.1, CLAUDE.md). The entry is exercised on practice situations made up here, each
 * flagged as such in its text, seeded (A11) and carrying an id that cannot be a bank id
 * (`demo:emotion:<seed>`); they are never part of a session's pool and say nothing about the rule table.
 * The intended answer is returned beside the spec, never inside it, so a page shows the renderer the
 * spec only, as the server does.
 */

import { createRng, type RngSeed } from '../../engine/prng'
import { EMOTION_OPTIONS, type EmotionSpec } from './spec'

/** A demo vignette: the spec the renderer gets and the answer only the demo page knows. */
export interface DemoEmotionItem {
  /** `demo:emotion:<seed>`: never an A11 bank id. */
  readonly item_id: string
  readonly spec: EmotionSpec
  /** The display position the demo counts as its intended answer. */
  readonly answer_index: number
  /** One line shown after the answer. */
  readonly explanation: string
}

interface Template {
  /** The situation, with `{name}` for the person. */
  readonly situation: string
  /** The intended feeling and four others, none of them in the situation's words. */
  readonly answer: string
  readonly others: readonly [string, string, string, string]
  readonly explanation: string
}

const NAMES = ['Ada', 'Bo', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Ida', 'Jo', 'Kit', 'Lou', 'Max'] as const

const TEMPLATES: readonly Template[] = [
  {
    situation:
      'A practice situation made up for this page: {name} has been waiting by the window for a small parcel. The courier knocks, and inside the box is exactly the paper kite {name} ordered, with a spare string.',
    answer: 'Joy',
    others: ['Anger', 'Fear', 'Sadness', 'Guilt'],
    explanation: 'The parcel is what {name} wanted and it has arrived.',
  },
  {
    situation:
      'A practice situation made up for this page: {name} lent a friend a board game. The friend returns it with half the pieces missing and says it was not worth tidying up.',
    answer: 'Anger',
    others: ['Joy', 'Pride', 'Hope', 'Relief'],
    explanation: 'Something {name} lent was spoiled by another person who does not care.',
  },
  {
    situation:
      'A practice situation made up for this page: {name} hears a thump on the roof in the middle of the night, and cannot tell whether it is a branch or something else. The house is quiet again, and the torch has no batteries.',
    answer: 'Fear',
    others: ['Pride', 'Gratitude', 'Regret', 'Joy'],
    explanation: 'Something might be wrong, and {name} cannot check.',
  },
  {
    situation:
      'A practice situation made up for this page: {name} spent a week folding one hundred paper cranes. The last one is placed on the string, and the string hangs from the ceiling in a shimmering line. Each fold was {name}\'s own work.',
    answer: 'Pride',
    others: ['Fear', 'Sadness', 'Anger', 'Relief'],
    explanation: 'A goal {name} worked for was reached by {name}\'s own effort.',
  },
]

/** The seeded demo item: same seed, same practice situation, same option order (A11). */
export function demoEmotionItem(seed: RngSeed): DemoEmotionItem {
  const rng = createRng(`demo:emotion:${String(seed)}`)
  const tpl = rng.pick(TEMPLATES)
  const name = rng.pick(NAMES)
  const options = rng.shuffle([tpl.answer, ...tpl.others])
  if (options.length !== EMOTION_OPTIONS) throw new Error('a demo vignette has five options')
  const fill = (s: string): string => s.replaceAll('{name}', name)
  return {
    item_id: `demo:emotion:${String(seed)}`,
    spec: { stem: `${fill(tpl.situation)} How is ${name} most likely to feel?`, options },
    answer_index: options.indexOf(tpl.answer),
    explanation: fill(tpl.explanation),
  }
}
