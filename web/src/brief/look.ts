/**
 * "What to look for" (proposal §3.7): one observable behaviour per line type, shown before copying
 * so the person can see whether their assistant is following the notes. Only entries for lines the
 * notes contain are shown, plus the fallback for when none of them appears.
 */

import { COPY } from './copy'
import type { LineId } from './types'

interface Entry {
  readonly ids: readonly LineId[]
  readonly text: string
}

const ENTRIES: readonly Entry[] = [
  { ids: ['DS', 'DS.k', 'NT.skip'], text: 'On skip-the-basics topics it goes straight to the method and says when it skipped routine steps.' },
  { ids: ['DA', 'DA.p', 'U4', 'U4.t'], text: 'On ask-first topics it asks you one quick question, once per conversation, then pitches to your answer.' },
  { ids: ['DB', 'DB.k', 'NT.build'], text: 'On build-up topics it starts from a small example, shows every step and gives a way to check.' },
  { ids: ['U6', 'U6c'], text: 'On answers that matter it says how sure it is and how to check.' },
  { ids: ['VOICE'], text: 'By voice, it speaks in short chunks, says symbols in words, and offers a written version of long steps.' },
  { ids: ['CC'], text: "In coding agents, it doesn't put these preferences into code, comments or commit messages." },
]

/** The behaviours to look for, given the ids of the lines in the notes. */
export function whatToLookFor(ids: readonly LineId[]): string[] {
  const have = new Set(ids)
  return ENTRIES.filter((e) => e.ids.some((i) => have.has(i))).map((e) => e.text)
}

export const NOTHING_APPEARS = COPY.troubleshooting
