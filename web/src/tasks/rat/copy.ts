/**
 * Copy of the word-links entry (ROADMAP M6.3; DESIGN §5.4, §10, R-5.6.x). Plain, neutral wording: a note is about the
 * entry only, never about right or wrong (§10: no correctness feedback while the item counts). The A13 language lint
 * scans this file.
 */

import { MAX_ANSWER_CHARS } from './spec'

/** The name of the entry on screen (`facetLabel('remote_associates')`, `viz/facets.ts`). */
export const RAT_NAME = 'Word links'

/** Labels, instructions and notes of the entry. */
export const ENTRY_COPY = Object.freeze({
  name: RAT_NAME,
  instructions: 'Find one word that goes with each of the three words to make a common word or phrase, before or after it.',
  cuesLabel: 'The three words',
  inputLabel: 'Linking word',
  submit: 'Confirm',
  recorded: 'Answer recorded.',
  emptyNote: 'Type a word first, then confirm.',
  longNote: `Use at most ${MAX_ANSWER_CHARS} characters.`,
})
