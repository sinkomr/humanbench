/**
 * What a returning person's earlier sessions say, for where this session's questions are aimed (owner request
 * 2026-10-15, plan item 5; DESIGN §7.4 "Cross-skill aim", §7.8; `engine/xskill.ts`).
 *
 * Each of the save's last {@link EARLIER_SESSIONS_MAX} sessions, re-scored from its raw responses as the results are
 * (`save/rescore.ts` registryObservation: a pretest answer, an id this build cannot regenerate and an answer that
 * scores nothing are left out), and summarised per skill as one Gaussian observation (`xskill.ts` sessionEvidence):
 * what that session's own posterior of the skill says beyond the population prior. The server reads its earlier
 * sessions the same way (`hb.prior_state`, from the summary a finished session keeps). They go to the selector's aim
 * only (`selector.ts` selectionAim `earlier`): this session's posterior, its per-skill stop and every score are made
 * from this session's answers as before, and the results re-score every session from the raw answers (§7.8).
 *
 * Served questions are not here: the device holds no key, and in an online session the server picks every
 * question and reads the person's earlier sessions from its own rows.
 */

import { initialSigma } from '../engine/axes'
import type { Observation } from '../engine/types'
import { sessionEvidence } from '../engine/xskill'
import { registryObservation } from '../save/rescore'
import type { SaveFileV1 } from '../save/types'

/** The most recent sessions read (the aim needs the gist, not the whole history; it bounds the work at the start). */
export const EARLIER_SESSIONS_MAX = 10

/** The evidence of the last {@link EARLIER_SESSIONS_MAX} sessions of `save`, oldest first (module comment). */
export function earlierObservations(save: SaveFileV1 | null): Observation[] {
  if (save === null) return []
  const sigma = initialSigma()
  const out: Observation[] = []
  for (const s of save.sessions.slice(-EARLIER_SESSIONS_MAX)) {
    const obs: Observation[] = []
    for (const t of s.responses) {
      try {
        const r = registryObservation(t)
        if ('observation' in r) obs.push(r.observation)
      } catch {
        // a response this build cannot read says nothing to the aim
      }
    }
    out.push(...sessionEvidence(obs, { sigma }))
  }
  return out
}
