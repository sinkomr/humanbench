/**
 * Strings that belong to the notes and the results-talk helper and must never appear on a share
 * card or in its renderer's output (proposal §8 AI.6b: "the share-card renderer never contains
 * notes strings"; M1.18's test uses this list). The card is for showing a shape; the notes are for
 * an assistant.
 *
 * TEST SUPPORT: import this from tests and e2e specs only. It is not part of `reveal.ts`, so the
 * strings are not shipped in the main app (`scripts/bundle.test.ts` checks that the reveal bundle
 * has none of the notes grammar).
 */

import { RESULTS_TALK, REVEAL_CARD } from './results-talk'

export const NOTES_LEAK_MARKERS: readonly string[] = [
  'Notes for your AI',
  'How I like explanations',
  'not an assessment of me',
  REVEAL_CARD.heading,
  RESULTS_TALK.heading,
  RESULTS_TALK.neverPaste,
  'rough, uncertain self-reflection results',
]
