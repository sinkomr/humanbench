/**
 * What the builder page needs from a place that keeps the person's settings (AI.7). The page never
 * touches storage itself: `main.ts` hands it a {@link NotesStore} made by `brief-store/persist.ts`
 * (over the save module's autosave), and tests hand it a fake. Types only.
 */

import type { StoredPrefs } from './stored'

export type StoreStatus = 'ok' | 'unavailable' | 'error'

export type ImportOutcome =
  | { readonly ok: true; readonly prefs: StoredPrefs; /** The save held nothing the page did not have already (apart from edit counts). */ readonly unchanged?: true }
  | { readonly ok: false; readonly message: string; /** The save was fine but holds no notes settings. */ readonly none?: true }

export interface NotesStore {
  /** Whether this browser lets the page keep anything at all. */
  readonly available: boolean
  /** Schedule writing these settings. Called only after the person confirmed they are 18 or older. */
  write(prefs: StoredPrefs): void
  /** Write anything scheduled now (the page is hiding). */
  flush(): void
  status(): StoreStatus
  /** Be told when a write succeeds or fails (they happen a moment after `write`). Returns the way to stop. */
  onStatus(listener: (status: StoreStatus) => void): () => void
  /** Put the settings in a save file (with whatever else this device holds) and download it; returns the file name. */
  download(prefs: StoredPrefs | null): string
  /**
   * Read a save the person chose (a file) or pasted (a code or the file's text), and restore its notes settings
   * over `current`: a loaded set replaces the page's set in the same slot (a restore, not a rev race; `restoreBriefPrefs`).
   */
  importSave(input: Blob | string, current: StoredPrefs | null): Promise<ImportOutcome>
  /**
   * Delete the notes settings from this device: the settings save, and the settings inside other saves kept here.
   * Returns whether the device still holds a save (with test answers) afterwards, so the page can offer a fresh
   * download of it (proposal §3.3 "Removing").
   */
  remove(): boolean
}
