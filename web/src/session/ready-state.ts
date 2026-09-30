/**
 * What the ready screen lets the person choose about earlier saves (ROADMAP M1.15, M1.17 UI
 * wiring, R-8.1), kept by the flow rather than by the screen, so going to practice and back does
 * not lose a save file the person loaded.
 */

import type { RestoreResult } from '../save/autosave'
import { mergeAll } from '../save/merge'
import type { SaveFileV1 } from '../save/types'
import { SAVE_CTX } from './constants'

export interface ReadyState {
  /** Add the new session to the autosaves found on this device. */
  readonly includeFound: boolean
  /** A save file or code the person loaded. */
  readonly loaded: SaveFileV1 | null
}

/**
 * The starting choice: autosaves are included when they all belong to one identifier, and not when
 * they come from several (two people on one device, or a fresh start after an old file; the person
 * decides, `RestoreResult.anonIds`).
 */
export function defaultReadyState(restored: RestoreResult | null): ReadyState {
  return { includeFound: restored?.save != null && restored.anonIds.length <= 1, loaded: null }
}

/** The save the session starts from: the chosen autosaves and the loaded file merged (R-8.1), or null. */
export function baseOf(restored: RestoreResult | null, state: ReadyState): SaveFileV1 | null {
  const parts: SaveFileV1[] = []
  if (state.includeFound && restored?.save != null) parts.push(restored.save)
  if (state.loaded !== null) parts.push(state.loaded)
  return parts.length === 0 ? null : mergeAll(parts, SAVE_CTX)
}
