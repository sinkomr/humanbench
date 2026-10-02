/**
 * Closing a served session (ROADMAP M2.7; DESIGN §8, §11.2; ROADMAP A16): the order of the calls that
 * end it, and what the results screen is given. Kept out of the Svelte flow so it can be tested on its
 * own, with a fake server.
 *
 *   1. every answer the server has not acknowledged is sent (`SessionRun.flushAnswers`);
 *   2. `finish` closes the session and returns it as the server built and signed it;
 *   3. the signed session goes into the save, replacing the run's unsigned copy of it (a merge keeps
 *      the signed copy of a session);
 *   4. `rescore` returns the person's scores for the parts the server scores. Failing here is not an
 *      error of the session: those parts then show as not measured, and the save has everything.
 *
 * The calls are safe to repeat (`finish` returns the same session, an acknowledged answer is not sent
 * again), so a failed close can simply be tried again.
 */

import type { SaveFileV1, SaveSession, SessionFlags } from '../save/types'
import type { BackendApi } from './api'
import type { RescoreReply } from './replies'
import type { ServerSession } from './session'

/** What the results screen needs to know about a served run. */
export interface ServedOutcome {
  /** The server session; its token serves the report, survey and backup that come after the run. */
  readonly server: ServerSession
  /** The scores of the parts the server scores, or null when it was not asked or could not be. */
  readonly estimates: RescoreReply | null
  /** The session was closed on the server and its signed copy is in the save (false: the person went on without the server). */
  readonly closed: boolean
}

export interface ClosableRun {
  flushAnswers(): Promise<void>
  serverFlags(): SessionFlags
}

export interface SaveHolder {
  attachSigned(session: SaveSession): void
  currentSave(): SaveFileV1
}

export async function closeServedRun(run: ClosableRun, server: ServerSession, holder: SaveHolder, api: Pick<BackendApi, 'rescore'>): Promise<ServedOutcome> {
  await run.flushAnswers()
  const fin = await server.finish(run.serverFlags())
  holder.attachSigned(fin.session)
  let estimates: RescoreReply | null = null
  try {
    estimates = await api.rescore(holder.currentSave())
  } catch {
    estimates = null
  }
  return { server, estimates, closed: true }
}

/** The ids of the sessions of `save` that the server scores: the ones it signed, and the run's own (signed or not). */
export function servedSessionIds(save: SaveFileV1, runSessionId?: string): ReadonlySet<string> {
  const ids = new Set<string>(save.sessions.filter((s) => s.sig !== undefined).map((s) => s.session_id))
  if (runSessionId !== undefined) ids.add(runSessionId)
  return ids
}
