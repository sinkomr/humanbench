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
import { mergeAll } from '../save/merge'
import type { SaveFileV1, SaveSession } from '../save/types'
import { SAVE_CTX } from './constants'
import type { SessionRun } from './run'

export type AutosaveStatus = 'ok' | 'unavailable' | 'error'

export interface PersisterOptions {
  /** The save the person started from (an upload or restored autosaves), or null. */
  readonly base: SaveFileV1 | null
  readonly storage: StorageLike | null
  /**
   * The anon_id of the save when a server session is running (M2.7): the id the server issued, or
   * continued from the base. When the server did not continue the base's id (it proves nothing the
   * server issued, so it never adopts it: `start_session`), the base is re-keyed to this one, so the
   * file's id is the id its signed session is bound to (`sig.anon_id`; `rescore`, the backup and the
   * deletion all take only the sessions bound to the file's own id). Default: the base's id, or a fresh one.
   */
  readonly anonId?: string
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
  /** Families shown outside the session (the reveal's worked examples): left out of later sessions (§7.7). */
  #extraSeenFamilies: string[] = []
  /** The served part of the session as the server signed it (M2.7), once `finish` has returned it. */
  #signed: SaveSession | null = null
  readonly #onStatus: ((s: AutosaveStatus) => void) | undefined

  constructor(run: SessionRun, opts: PersisterOptions) {
    this.#run = run
    this.anonId = opts.anonId ?? opts.base?.anon_id ?? newAnonId()
    // Re-keyed, not merged: a merge keeps the smaller of two ids (merge.ts), which is not the server's.
    this.#base = opts.base !== null && opts.base.anon_id !== this.anonId ? { ...opts.base, anon_id: this.anonId } : opts.base
    this.#wallClockMs = opts.wallClockMs
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

  /**
   * Base ∪ the running session, as the save file to store or hand to the person. With a server
   * (M2.7) the running session is two: the timed tasks, which stay on the device, and the served part
   * under the server's own session id, unsigned until `finish` returns the signed one, which then
   * replaces it (a merge keeps the signed copy of a session, R-8.1, A16).
   */
  currentSave(): SaveFileV1 {
    const blocks = this.#run.sessionState()
    const cat = this.#run.catSessionState()
    const meta = { ctx: SAVE_CTX, createdMs: this.#wallClockMs(), anonId: this.anonId }
    // The worked examples' families ride with the first session written.
    const extra = this.#extraSeenFamilies
    const withExtra = <T extends { seenFamilies: readonly string[] }>(st: T): T => (extra.length === 0 ? st : { ...st, seenFamilies: [...st.seenFamilies, ...extra] })
    // A run with a server has no session of the device's own while no timed task was answered.
    const states = cat === null || blocks.responses.length > 0 ? [blocks] : []
    if (cat !== null) states.push(cat)
    let save: SaveFileV1 | null = this.#base
    states.forEach((st, i) => {
      save = saveWithSession(save, i === 0 ? withExtra(st) : st, meta)
    })
    let out = save as SaveFileV1
    if (this.#signed !== null) out = mergeAll([out, { ...out, sessions: [this.#signed], seen_items: [], seen_families: [] }], SAVE_CTX)
    return out
  }

  /** The server finished the served part: its signed session goes into every save from now on. */
  attachSigned(session: SaveSession): void {
    this.#signed = session
    this.schedule()
  }

  /**
   * Record families the person was shown outside the session, e.g. the reveal's worked examples
   * (DESIGN §10, §7.7): the save lists them in `seen_families`, so a later session leaves them out:
   * the device's own selector reads the list, and so does the server's `start_session`, which keeps
   * the procedural families of a save away from a served session (the worked examples are all
   * procedural; a finite-bank family in a save is ignored by the server, whose own rows say what it
   * served, supabase/README.md). Written to the autosave at once, so nothing stays pending on the
   * results screen; the download always includes them.
   */
  addSeenFamilies(ids: readonly string[]): void {
    const fresh = ids.filter((id) => !this.#extraSeenFamilies.includes(id))
    if (fresh.length === 0) return
    this.#extraSeenFamilies = [...this.#extraSeenFamilies, ...fresh]
    this.schedule()
    this.flush()
  }

  /**
   * Something changed: write the save soon (coalesced). A session with no answer yet has nothing
   * worth keeping and writes nothing: a start that was abandoned at the first screen leaves no
   * session behind, so it is neither restored nor counted as an earlier session later (M1.15
   * review). The download on the results screen is not affected (`currentSave`).
   */
  schedule(): void {
    if (this.#run.sessionState().responses.length === 0 && this.#run.catSessionState() === null) return
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
