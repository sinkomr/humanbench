/**
 * Where each session of a save stands with the server (ROADMAP M2.7; DESIGN §8 "Tamper evidence and
 * the trust tradeoff"; ROADMAP A16): verified (the server issued it and it is unchanged), unverified
 * (unsigned: made on the device, or the offline version; changed; signed with a key the server no
 * longer has; unreadable), or not checked (the server could not be asked). Only the server can say
 * (the key is its own), so the client never claims a session is verified on its own: it asks
 * (`verify_save`, or the session list `rescore` returns) and reports what the server said. A session
 * without a signature needs no question, since the answer is always "unsigned".
 */

import type { SaveFileV1 } from '../save/types'
import type { RescoreReply, VerifyReason, VerifyReply } from './replies'

export type Standing = 'verified' | 'unverified' | 'unchecked'

export interface SessionStanding {
  readonly sessionId: string
  /** `YYYY-MM-DD` of the session's start, to tell sessions apart on screen. */
  readonly date: string
  readonly standing: Standing
  readonly reason: VerifyReason | null
}

function rows(save: SaveFileV1, say: (id: string) => { standing: Standing; reason: VerifyReason | null } | undefined): SessionStanding[] {
  return save.sessions.map((s) => {
    const base = { sessionId: s.session_id, date: s.started_utc.slice(0, 10) }
    if (s.sig === undefined) return { ...base, standing: 'unverified', reason: 'unsigned' }
    return { ...base, ...(say(s.session_id) ?? { standing: 'unchecked' as const, reason: null }) }
  })
}

/** From the answer of `verify_save` (null when the server could not be asked). */
export function standingFromVerify(save: SaveFileV1, reply: VerifyReply | null): SessionStanding[] {
  const byId = new Map<string, { standing: Standing; reason: VerifyReason | null }>()
  for (const r of reply?.sessions ?? []) if (r.sessionId !== null) byId.set(r.sessionId, { standing: r.status, reason: r.reason })
  return rows(save, (id) => byId.get(id))
}

/**
 * From the session list of `rescore`: a session it holds and has verified is `known`. One it does not
 * know may be unchanged but held by no server (another deployment, or deleted), or changed; the reply
 * does not say which, so it is reported as unverified without a reason ("bad_signature" covers both:
 * "changed, or saved under another identifier").
 */
export function standingFromRescore(save: SaveFileV1, reply: RescoreReply | null): SessionStanding[] {
  const byId = new Map<string, boolean>()
  for (const r of reply?.sessions ?? []) byId.set(r.sessionId, r.known)
  return rows(save, (id) => {
    const known = byId.get(id)
    return known === undefined ? undefined : known ? { standing: 'verified', reason: null } : { standing: 'unverified', reason: 'bad_signature' }
  })
}

export function countStanding(list: readonly SessionStanding[]): { verified: number; unverified: number; unchecked: number } {
  const c = { verified: 0, unverified: 0, unchecked: 0 }
  for (const s of list) c[s.standing]++
  return c
}
