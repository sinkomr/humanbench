/**
 * Sittings of a save (UX-064, UX-REVIEW D6 provisional default B; DESIGN §7.8): a session plus the
 * continuation sessions that follow it (`CONTINUATION_FLAG`, set on a new session that picks up an
 * interrupted one) are one sitting. The retest model numbers tests by sitting (`engine/retest.ts`
 * `sessionSittings`); the counts the person reads ("Your new session will be added to n earlier
 * sessions", "This profile combines k sessions") count sittings the same way, so an interrupted session
 * and its continuation read as one session.
 *
 * Light on purpose: the order and the sittings come from the retest engine, nothing else is imported.
 */

import { orderSessions, sessionSittings } from '../engine/retest'
import { CONTINUATION_FLAG, type SaveSession } from './types'

/** What a session needs here: its id, start time and flags. */
export type SittingSession = Pick<SaveSession, 'session_id' | 'started_utc' | 'flags'>

/** Whether `session` is flagged as continuing the session before it (only the value true counts). */
export function isContinuation(session: Pick<SaveSession, 'flags'>): boolean {
  return session.flags[CONTINUATION_FLAG] === true
}

/**
 * The 0-based sitting of each session, by session id: sessions in time order (`orderSessions`: start time,
 * then id), a continuation in the sitting of the session before it. A continuation flag on the first session
 * is ignored. Throws a RangeError on duplicate ids (a merged save has none).
 */
export function sittingIndex(sessions: readonly SittingSession[]): Map<string, number> {
  const ordered = orderSessions(sessions.map((s) => ({ session_id: s.session_id, started_utc: s.started_utc, continuation: isContinuation(s) })))
  const sit = sessionSittings(ordered)
  return new Map(ordered.map((s, i) => [s.session_id, sit[i]!]))
}

/**
 * How many sittings `sessions` make; with `counted`, only the sittings that hold at least one session it
 * accepts (for example a session with answers). The sittings are worked out over all of `sessions`, so a
 * continuation still joins the session it continues when that one is not counted.
 */
export function sittingCount(sessions: readonly SittingSession[], counted?: (s: SittingSession) => boolean): number {
  if (sessions.length === 0) return 0
  const index = sittingIndex(sessions)
  const seen = new Set<number>()
  for (const s of sessions) if (counted === undefined || counted(s)) seen.add(index.get(s.session_id)!)
  return seen.size
}
