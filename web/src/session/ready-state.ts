/**
 * What the ready screen lets the person choose about earlier saves (ROADMAP M1.15, M1.17 UI
 * wiring, R-8.1), kept by the flow rather than by the screen, so going to practice and back does
 * not lose a save file the person loaded.
 */

import type { RestoreResult } from '../save/autosave'
import { raiseBriefPrefs, replacedBriefSets } from '../save/brief-prefs'
import { jcs } from '../save/jcs'
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

/**
 * The loaded file with its notes settings made the ones that count on this device (ROADMAP owner decisions
 * 2026-10-01, AI.7): the file's sets replace the device's sets in the same slot, the same restore as the notes
 * builder's "Load my settings from a save" (`restoreBriefPrefs`), and not a race of edit counts, which are
 * not comparable between devices. The file's sets get a rev one above the device's for their slot, so the
 * join that makes the base (`mergeAll`) keeps them, and so does every join of the device's saves after this
 * session, whether or not the new session is added to the earlier saves found here (the notes settings on
 * the device are the same either way). The device's other sets and its fit notes still join in. A file with
 * no notes settings, or a device with none, is left as it is, and so is a file whose sets need no raising
 * (its file-level `sig`, if any, still matches it).
 */
function withFileSettingsWinning(loaded: SaveFileV1, device: SaveFileV1 | null | undefined): SaveFileV1 {
  const mine = device?.brief_prefs
  if (mine === undefined || loaded.brief_prefs === undefined) return loaded
  const raised = raiseBriefPrefs(mine, loaded.brief_prefs)
  // Nothing to raise: the file is used as it is, with a file-level `sig` it may carry (it still matches).
  if (jcs(raised) === jcs(loaded.brief_prefs)) return loaded
  // Changed settings are no longer the body a file-level `sig` was made over (the merge would drop it anyway).
  const { sig: _sig, ...rest } = loaded
  return { ...rest, brief_prefs: raised }
}

/**
 * Whether loading `loaded` puts the file's notes settings in place of different ones on this device: some set
 * of the device's is replaced by another set (or a removal) in the file. The ready screen says so when it is
 * true, in a short notice. False when the device has no notes settings, the file has none, or they agree.
 */
export function replacesDeviceSettings(restored: RestoreResult | null, loaded: SaveFileV1): boolean {
  const mine = restored?.save?.brief_prefs
  return mine !== undefined && loaded.brief_prefs !== undefined && replacedBriefSets(mine, loaded.brief_prefs) > 0
}

/**
 * The save the session starts from: the chosen autosaves and the loaded file merged (R-8.1), or null. The
 * file's notes settings win over the device's, set by set ({@link withFileSettingsWinning}); everything else
 * is a plain merge.
 */
export function baseOf(restored: RestoreResult | null, state: ReadyState): SaveFileV1 | null {
  const parts: SaveFileV1[] = []
  if (state.includeFound && restored?.save != null) parts.push(restored.save)
  if (state.loaded !== null) parts.push(withFileSettingsWinning(state.loaded, restored?.save))
  return parts.length === 0 ? null : mergeAll(parts, SAVE_CTX)
}
