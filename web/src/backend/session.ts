/**
 * One server session (ROADMAP M2.7; DESIGN §11.2): the token the server issued at `start_session`,
 * kept in memory only, and the calls that need it. The session flow (`session/run.ts`) sees only
 * {@link CatSource}: ask for the next item of the part that is running, hand over an answer, finish.
 * The screens that come after the run (report a problem, the survey, the server backup) use the
 * other methods. The token never leaves this object: it is not in `localStorage`, a URL, a log or a
 * save file, and a page reload loses it, which ends the server session (the answers it holds stay
 * on the server as an unfinished, never-calibrated session).
 *
 * What the server does for the person, and what it does not (R-11.1, DESIGN §10):
 * - it picks every counted item of the CAT parts (the three unidimensional parts of M1: Matrix &
 *   Series, Spatial, Quantitative) and scores the answer where the key is, so the page never learns
 *   whether an answer was right;
 * - it does not take the timed tasks (reaction time, memory, coding, reading), which stay on the
 *   device as they were in the static version and are saved as a session of their own, without a
 *   signature (A16: only a session the server built from its own rows is signed).
 *
 * What it does not hide (ROADMAP A24-sec, owner decision 2026-10-02): the next item the server picks follows
 * from whether the last answer was right (the adaptive step of §7.4), so a deliberate script over many sessions
 * could read a key from the items it is served; and `rescore` can be differenced by a caller who already knows
 * four answers on an axis. Both are accepted, documented risks of a low-stakes self-knowledge test, and nothing
 * here tries to hide or randomise them (supabase/README.md, "Accepted inference risks").
 */

import type { AxisCode } from '../engine/axes'
import type { JsonValue } from '../engine/types'
import type { DeviceInfo, SaveFileV1, SessionFlags } from '../save/types'
import type { BackendApi, ProblemReport, Survey } from './api'
import { toServedItem, type ServedItem } from './items'
import type { DoneReason, FinishReply, MirrorPutReply, StartedSession } from './replies'
import { withAnonId } from './upload'

export type CatNext = { readonly kind: 'item'; readonly item: ServedItem } | { readonly kind: 'done'; readonly reason: DoneReason }

/** How a pending item that will not be answered is let go: it could not be drawn, or its part was skipped. */
export type Release = 'unavailable' | 'skipped'

export interface CatAnswer {
  readonly item: ServedItem
  /** The answer as the renderer gave it; null for an item that ran out of time or is being released. */
  readonly response: JsonValue | null
  readonly rtMs: number
  readonly confidence: number | null
  /** `paste` and `visibility_hidden` for this answer (§13). */
  readonly flags: Readonly<Record<string, number | boolean | null>>
  /** Set when the item is let go rather than answered: the server needs it closed to serve another one. */
  readonly release?: Release | undefined
}

/** What a session run needs from the server (the seam `SessionRun` is tested against). */
export interface CatSource {
  /** The server's id of this session (`s_...`): the id its signed session will carry. */
  readonly sessionId: string
  /** The next counted item for the part with these axes, or why there is none. */
  next(axes: readonly AxisCode[]): Promise<CatNext>
  /** Hands an answer over. Resolves when the server has it (a repeat is harmless). */
  answer(a: CatAnswer): Promise<void>
}

export class ServerSession implements CatSource {
  readonly sessionId: string
  readonly anonId: string
  /** The server continued the anon_id of the save sent at the start. */
  readonly anonIdAdopted: boolean
  readonly bankVersion: string | null
  readonly paramVersion: string | null
  readonly #api: BackendApi
  readonly #token: string
  #finished: FinishReply | null = null

  constructor(api: BackendApi, started: StartedSession) {
    this.#api = api
    this.#token = started.token
    this.sessionId = started.sessionId
    this.anonId = started.anonId
    this.anonIdAdopted = started.anonIdAdopted
    this.bankVersion = started.bankVersion
    this.paramVersion = started.paramVersion
  }

  /** Opens a session for `device`; `save` lets the server continue its anon_id when the save proves it (what it leaves out is what the server itself served to that id, not what the save lists). */
  static async start(api: BackendApi, device: DeviceInfo, save?: SaveFileV1 | null): Promise<ServerSession> {
    return new ServerSession(api, await api.startSession(device, save))
  }

  async next(axes: readonly AxisCode[]): Promise<CatNext> {
    const r = await this.#api.nextItem(this.#token, axes)
    return r.kind === 'done' ? r : { kind: 'item', item: toServedItem(r.seq, r.item) }
  }

  async answer(a: CatAnswer): Promise<void> {
    const flags: Record<string, number | boolean | null> = { ...a.flags }
    if (a.release !== undefined) flags[a.release] = true
    await this.#api.submit(this.#token, { itemId: a.item.item_id, response: a.response, rtMs: a.rtMs, confidence: a.confidence, clientFlags: flags, next: false })
  }

  /** Closes the session and returns it as the server built and signed it. Repeating it returns the same session. */
  async finish(flags: SessionFlags): Promise<FinishReply> {
    this.#finished ??= await this.#api.finish(this.#token, flags)
    return this.#finished
  }

  get finished(): FinishReply | null {
    return this.#finished
  }

  reportProblem(report: ProblemReport): Promise<void> {
    return this.#api.reportProblem(this.#token, report)
  }

  submitSurvey(survey: Survey): Promise<boolean> {
    return this.#api.submitSurvey(this.#token, survey)
  }

  /**
   * Stores `save` as this person's server backup. The first backup returns the recovery phrase (once);
   * a later one must present it. The file is stored under this session's anon_id, with the notes
   * settings left out (`BackendApi.mirrorPut`).
   */
  mirrorPut(save: SaveFileV1, phrase?: string): Promise<MirrorPutReply> {
    return this.#api.mirrorPut(this.#token, withAnonId(save, this.anonId), phrase)
  }
}
