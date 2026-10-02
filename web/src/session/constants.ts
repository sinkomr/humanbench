/**
 * Session limits, versions and storage keys of the M1 session flow (ROADMAP M1.15; DESIGN §7.4
 * "Session composition", §10 pacing, §13 consent and integrity; ROADMAP A15).
 */

import type { SaveContext } from '../save/types'

/** A break is suggested once the session has run this long, in active seconds (§10: "a break is suggested at 30 min"). */
export const BREAK_AT_S = 30 * 60

/** Hard stop, in active seconds: the session ends and the person sees their results (§7.4 "hard stop at 57 min"). */
export const HARD_STOP_S = 57 * 60

/**
 * Version of the terms and privacy notice that the consent covers. Bump it when `PRIVACY_SECTIONS`
 * (`copy.ts`) changes in substance: a stored consent for another version is not honoured.
 */
export const TERMS_VERSION = 'terms-2026-09-draft'

/**
 * The terms version of the online version (ROADMAP M2.7): its notice says that answers are sent to a
 * server, so a consent given to the static notice does not cover it (and the other way round).
 */
export const TERMS_VERSION_SERVER = 'terms-2026-10-draft-server'

/** localStorage key of the stored consent (written only after the 18+ gate is passed, §13). */
export const CONSENT_KEY = 'hb:consent:v1'

/**
 * The versions a save written by this build is stamped with (§8). `bank_version` names the static
 * M1 pool of procedural generators; `param_version` names the provisional item and block
 * parameters (A10, M1.P), which M4 replaces with calibrated ones.
 */
export const SAVE_CTX: SaveContext = Object.freeze({ bank_version: 'm1-static', param_version: 'm1-provisional' })

/** Dev flag factor (`?fast=1`): virtual session time runs this many times faster than real time. */
export const FAST_FACTOR = 20

/** Fallback item time cap in seconds when an item declares none (§13: max(180, 2.5 · E[T])). */
export const DEFAULT_ITEM_LIMIT_S = 180
