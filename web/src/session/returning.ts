/**
 * What the welcome screen shows a returning visitor (provisional default, UX-REVIEW D22): "See my results" when
 * this browser holds earlier results, and "Notes for your AI" when it keeps notes settings.
 *
 * The privacy line is the gate's: a browser with no adult consent record shows nothing and reads nothing more
 * (the under-18 path never stores a record, so for that person this is one read of one key, as the flow's own
 * check at "Start" already was). Only with a record are the autosaves read, which is what the ready screen
 * does after the gate; nothing is written. A record for older terms counts here ({@link hasAdultRecord}):
 * it proves the 18+ gate was passed in this browser, and the row is a door, not a consent. Going through it
 * with such a record shows the gate again first (`SessionApp.svelte`).
 */

import { buildResults } from '../reveal/results'
import { restoreAutosaves, type StorageLike } from '../save/autosave'
import type { SaveFileV1 } from '../save/types'
import { SAVE_CTX } from './constants'
import { hasAdultRecord } from './gate'
import { baseOf, defaultReadyState } from './ready-state'

export interface Returning {
  /** Earlier results to look at: what the ready screen's "See my results" would show. */
  readonly results: boolean
  /** Notes settings are kept on this device. */
  readonly notes: boolean
}

/** Some set of notes is still there (a removed set only keeps its slot, `BriefContextRemovedV1`). */
function keepsNotes(save: SaveFileV1): boolean {
  return save.brief_prefs?.contexts.some((c) => !('removed' in c)) === true
}

/**
 * Whether the save holds results to look at, exactly as `Ready.svelte` decides it: `buildResults` is null for
 * nothing scorable (every answer on a skipped skill, or none). It scores the whole save, which takes a
 * fraction of a second, so it is asked when "See my results" is pressed, not when the welcome screen is drawn.
 */
export function holdsResults(save: SaveFileV1): boolean {
  try {
    return buildResults(save) !== null
  } catch {
    return false
  }
}

/** Whether some session of the save has an answer in it: the quick look the welcome screen takes (nothing is scored). */
function hasAnswers(save: SaveFileV1): boolean {
  return save.sessions.some((s) => s.responses.length > 0)
}

/**
 * What this browser holds, or null: no adult consent record (nothing else is read), no storage, or nothing to
 * offer. `results` is off with a server (`withResults` false): the results of served sessions are scored
 * there, and the ready screen does not offer them either (R-11.1). It reads the autosaves but scores nothing
 * (the welcome screen is drawn at once): an earlier answer is enough to offer the row, and the flow checks
 * with {@link holdsResults} that there is something to show when the button is pressed.
 */
export function readReturning(storage: StorageLike | null, withResults = true): Returning | null {
  if (storage === null || !hasAdultRecord(storage)) return null
  const restored = restoreAutosaves(SAVE_CTX, storage)
  if (restored.save === null) return null
  // The save the ready screen would start from: autosaves of one identifier are joined, those of several are the person's choice there.
  const base = baseOf(restored, defaultReadyState(restored))
  const results = withResults && base !== null && hasAnswers(base)
  const notes = keepsNotes(restored.save)
  return results || notes ? { results, notes } : null
}
