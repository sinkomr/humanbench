/**
 * Synthetic practice puzzles for the dev-only page `#/dev/rat` and its e2e (ROADMAP M6.3; A6; DESIGN §14.6 ex. 16). No
 * finite puzzle is in this repo: the bank keeps every real triad and its key (DESIGN §5.4, CLAUDE.md). The entry is
 * exercised on exactly these three classic public examples, which the bank's generator excludes from the pool, each
 * flagged as practice in the page's text, seeded (A11) and carrying an id that cannot be a bank id (`demo:rat:<seed>`).
 * The accepted words are returned beside the spec, never inside it, so a page shows the renderer the spec only, as the
 * server does; the compounds are for the explanation shown after an answer.
 */

import { createRng, type RngSeed } from '../../engine/prng'
import type { RatSpec } from './spec'

/** What the page says to mark a puzzle as made for the demo. */
export const DEMO_NOTE = 'A practice puzzle for this page.'

/** One practice puzzle: three cues, the word that links them, and the three compounds it makes (one per cue). */
export interface DemoPuzzle {
  readonly cues: readonly [string, string, string]
  readonly word: string
  /** The compound of each cue with the word, in the order of `cues`, as it is written in running text. */
  readonly compounds: readonly [string, string, string]
}

/** The three practice puzzles, in this order. The bank generator excludes them. */
export const DEMO_PUZZLES: readonly DemoPuzzle[] = Object.freeze([
  { cues: ['cottage', 'swiss', 'cake'], word: 'cheese', compounds: ['cottage cheese', 'Swiss cheese', 'cheesecake'] },
  { cues: ['tooth', 'hair', 'paint'], word: 'brush', compounds: ['toothbrush', 'hairbrush', 'paintbrush'] },
  { cues: ['sun', 'moon', 'star'], word: 'light', compounds: ['sunlight', 'moonlight', 'starlight'] },
])

/** A demo puzzle as the page uses it: the spec the renderer gets, and what only the demo page knows. */
export interface DemoRatItem {
  /** `demo:rat:<seed>`: never an A11 bank id. */
  readonly item_id: string
  readonly spec: RatSpec
  /** The words the demo accepts (the key's `accept` list for a real puzzle). */
  readonly accept: readonly string[]
  /** The linking word, as the explanation names it. */
  readonly word: string
  /** The compounds, in the order of `spec.cues`. */
  readonly compounds: readonly [string, string, string]
}

/** The seeded demo puzzle: same seed, same puzzle and same cue order (A11). */
export function demoRatItem(seed: RngSeed): DemoRatItem {
  const rng = createRng(`demo:rat:${String(seed)}`)
  const puzzle = rng.pick(DEMO_PUZZLES)
  const order = rng.shuffle([0, 1, 2])
  const at = <T>(xs: readonly T[], i: number): T => xs[order[i] as number] as T
  return {
    item_id: `demo:rat:${String(seed)}`,
    spec: { cues: [at(puzzle.cues, 0), at(puzzle.cues, 1), at(puzzle.cues, 2)] },
    accept: [puzzle.word],
    word: puzzle.word,
    compounds: [at(puzzle.compounds, 0), at(puzzle.compounds, 1), at(puzzle.compounds, 2)],
  }
}
