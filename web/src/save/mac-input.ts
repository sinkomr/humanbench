/**
 * The bytes the server computes a session's MAC over (ROADMAP A16, M2.3; supabase/README.md, "M2.3: signed saves").
 *
 * The app never signs or verifies: the key is the server's and only the server can say whether a session is as it
 * issued it (`verify_save`). This module exists to state the contract once, in code, for the tests on both sides:
 * the database's `hb.jcs` / `hb.session_mac` are held to it byte for byte (`scripts/db/signing.db.test.ts`), and the
 * save module's own tests use it to show what a merge, a preference edit or a strip does and does not touch.
 *
 *   mac = base64url-no-padding( HMAC-SHA256( utf8(key of sig.kid), utf8( sessionMacInput(session, sig.anon_id) ) ) )
 *
 * The input is the RFC 8785 canonical JSON of `{anon_id, kind, session}`, where `session` is the session without its
 * `sig`. Nothing of the file around the session is in it, so editing `brief_prefs`, merging, or changing the seen lists
 * never changes it (AI.26); the key order and the spelling of numbers in the file do not either.
 */

import { jcs } from './jcs'
import type { SaveSession } from './types'

/** Domain separator of the session MAC; a different kind of signed thing would use another. */
export const SESSION_MAC_KIND = 'hb.session.v1'

/** The canonical text the server MACs for `session`, issued to `anonId` (the `sig.anon_id`, not necessarily the file's). */
export function sessionMacInput(session: SaveSession, anonId: string): string {
  const { sig: _sig, ...body } = session
  return jcs({ anon_id: anonId, kind: SESSION_MAC_KIND, session: body })
}
