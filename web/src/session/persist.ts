/**
 * Saving the running session through the save library (ROADMAP M1.15; DESIGN §8 "autosave to
 * localStorage after every item, keyed by session_id"; M1.17). The session flow keeps a
 * {@link SessionRun}; this module turns it into a save file with `saveWithSession` and writes it
 * with the library's coalescing autosaver, flushing when the page is hidden or unloaded.
 *
 * Nothing is created before the person passes the 18+ gate (`gate.ts`): the flow makes the
 * persister after it, so the under-18 path never reaches `localStorage`. When storage is missing or
 * refuses the write, {@link SessionPersister.status} says so, the session goes on, and the
 * finished screen still offers the download.
 */

import { autosaveKey, bindFlushOnHide, createAutosaver, type Autosaver, type AutosaveError, type StorageLike } from '../save/autosave'
import { saveWithSession } from '../save/create'
import { newAnonId } from '../save/ids'
import type { SaveFileV1 } from '../save/types'
import { SAVE_CTX } from './constants'
import type { SessionRun } from './run'

export type AutosaveStatus = 'ok' | 'unavailable' | 'error'

export interface PersisterOptions {
  /** The save the person started from (an upload or restored autosaves), or null. */
  readonly base: SaveFileV1 | null
  readonly storage: StorageLike | null
  /** Wall-clock epoch ms of a write (`created_utc`, metadata only: `save/clock.ts`). */
  readonly wallClockMs: () => number
  /** Coalescing delay of the autosaver (default the library's). */
  readonly delayMs?: number
  readonly setTimer?: (fn: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
  /** Bind flush-on-hide to the page (default true; tests turn it off). */
  readonly bindHide?: boolean
  readonly onStatus?: (status: AutosaveStatus) => void
}

export class SessionPersister {
  readonly anonId: string
  /** The localStorage key of this session's autosave. */
  readonly key: string
  readonly #base: SaveFileV1 | null
  readonly #run: SessionRun
  readonly #wallClockMs: () => number
  readonly #saver: Autosaver
  readonly #unbind: (() => void) | null
  #status: AutosaveStatus = 'ok'
  readonly #onStatus: ((s: AutosaveStatus) => void) | undefined

  constructor(run: SessionRun, opts: PersisterOptions) {
    this.#run = run
    this.#base = opts.base
    this.#wallClockMs = opts.wallClockMs
    this.anonId = opts.base?.anon_id ?? newAnonId()
    this.key = autosaveKey(run.sessionId)
    this.#onStatus = opts.onStatus
    this.#saver = createAutosaver(run.sessionId, {
      storage: opts.storage,
      ...(opts.delayMs === undefined ? {} : { delayMs: opts.delayMs }),
      ...(opts.setTimer === undefined ? {} : { setTimer: opts.setTimer }),
      ...(opts.clearTimer === undefined ? {} : { clearTimer: opts.clearTimer }),
      onError: (e: AutosaveError) => this.#setStatus(e.kind === 'unavailable' ? 'unavailable' : 'error'),
      onSaved: () => this.#setStatus('ok'),
    })
    this.#unbind = opts.bindHide === false ? null : bindFlushOnHide(this.#saver)
  }

  #setStatus(s: AutosaveStatus): void {
    if (s === this.#status) return
    this.#status = s
    this.#onStatus?.(s)
  }

  get status(): AutosaveStatus {
    return this.#status
  }

  /** Base ∪ the running session, as the save file to store or hand to the person. */
  currentSave(): SaveFileV1 {
    return saveWithSession(this.#base, this.#run.sessionState(), { ctx: SAVE_CTX, createdMs: this.#wallClockMs(), anonId: this.anonId })
  }

  /** Something changed: write the save soon (coalesced). */
  schedule(): void {
    this.#saver.schedule(() => this.currentSave())
  }

  /** Write the pending change now. */
  flush(): boolean {
    return this.#saver.flush()
  }

  dispose(): void {
    this.#saver.flush()
    this.#unbind?.()
  }
}
