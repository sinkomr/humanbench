/**
 * Session limits, versions and storage keys of the M1 session flow (ROADMAP M1.15; DESIGN §7.4
 * "Session composition", §10 pacing, §13 consent and integrity; ROADMAP A15).
 */

import { STATIC_BANK_VERSION } from '../save/bank-version'
import type { SaveContext } from '../save/types'

/** Hard stop, in active seconds: the session ends and the person sees their results (§7.4 "hard stop at 57 min"). */
export const HARD_STOP_S = 57 * 60

/**
 * Version of the terms and privacy notice that the consent covers. Bump it when `PRIVACY_SECTIONS`
 * (`copy.ts`) changes in substance: a stored consent for another version is not honoured.
 * 2026-10-05: the notice without placeholders (UX-REVIEW D1); was 'terms-2026-09-draft'. Not bumped on
 * 2026-10-16: the static notice only lost the word "anonymous" (nothing it says is kept or sent changed).
 */
export const TERMS_VERSION = 'terms-2026-10-05'

/**
 * The terms version of the online version (ROADMAP M2.7): its notice says that answers are sent to a
 * server, so a consent given to the static notice does not cover it (and the other way round).
 * 2026-10-05: the notice without placeholders (UX-REVIEW D1); was 'terms-2026-10-draft-server'. No SQL
 * names a terms version (supabase/), so nothing on the server needs the old value.
 * 2026-10-16: the notice checked against the server as built (no "anonymous"; the session times, page
 * checks and scores kept, the Calibration use of the confidence, the survey and reports kept with the
 * session, the archive under each session's code, no automatic 24-month deletion yet, a per-skill summary of the timed tasks that may be sent for
 * selection); was
 * 'terms-2026-10-05-server'. A consent to the earlier notice is not honoured, so the gate asks again.
 */
export const TERMS_VERSION_SERVER = 'terms-2026-10-16-server'

/** localStorage key of the stored consent (written only after the 18+ gate is passed, §13). */
export const CONSENT_KEY = 'hb:consent:v1'

/**
 * The versions a save written by this build is stamped with (§8). `bank_version` names the static
 * M1 pool of procedural generators, and is replaced by the server's bank version in a save that
 * holds a served session (`persist.ts`, `save/bank-version.ts`); `param_version` names the provisional item and block
 * parameters (A10, M1.P), which M4 replaces with calibrated ones.
 */
export const SAVE_CTX: SaveContext = Object.freeze({ bank_version: STATIC_BANK_VERSION, param_version: 'm1-provisional' })

/** Dev flag factor (`?fast=1`): virtual session time runs this many times faster than real time. */
export const FAST_FACTOR = 20

/** Fallback item time cap in seconds when an item declares none (§13: max(180, 2.5 · E[T])). */
export const DEFAULT_ITEM_LIMIT_S = 180

/**
 * Seconds left at which the question's timer changes to its warning and says so once (owner feedback
 * 2026-10-13: no surprise time-outs). For a limit under two minutes it is a quarter of the limit.
 */
export const ITEM_TIME_WARN_S = 30
