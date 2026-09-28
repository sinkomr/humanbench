/**
 * Save file v1 types (DESIGN §8, R-8.x; JSON Schema `schema/save-v1.json` at the repo root).
 *
 * The wire format is snake_case JSON shared with the bank and the M2 server. The TS validator
 * (`validate.ts`) mirrors the schema exactly; `schema.test.ts` checks the two agree.
 *
 * Signatures (§8, ROADMAP A16): the static MVP writes no `sig` anywhere, so every file it makes is
 * *unverified*: accepted for personal display, never used for calibration. Only the server holds
 * the HMAC key, so the client never claims a file is verified. A16 moves the MAC to each session
 * (`SaveSession.sig`, M2.3; it names the anon_id it binds, so it survives a merge); the file-level
 * `sig` of the §8 example stays valid in the schema and is kept through a merge only while the
 * file body is unchanged (`merge.ts`).
 *
 * Versions: minor and patch bumps are additive within a major. A file from a newer minor that
 * this build cannot validate is reported as `newer_version` (reload to update), never stripped of
 * the fields it does not know (`parse.ts`).
 */

import type { ResponseTuple } from '../engine/types'

export type { ResponseTuple } from '../engine/types'

/** Current format version (semver). Major 1 = `schema/save-v1.json`. */
export const SCHEMA_VERSION = '1.0.0'

/** The major version this build reads and writes; older majors are migrated (§8 step 5). */
export const SCHEMA_MAJOR = 1

/** The `$schema` URL of v1 files and the schema's `$id` (§8 example). */
export const SCHEMA_URL = 'https://sinkomr.github.io/humanbench/schema/save-v1.json'

/** Coarse device class (§8 privacy: no precise user agent). */
export type DeviceClass = 'desktop' | 'tablet' | 'phone' | 'other'

/** Response input used for the session (§13: RT modes are stored and normed separately). */
export type InputMode = 'mouse' | 'touch' | 'keyboard' | 'pen' | 'other'

export const DEVICE_CLASSES: readonly DeviceClass[] = Object.freeze(['desktop', 'tablet', 'phone', 'other'])
export const INPUT_MODES: readonly InputMode[] = Object.freeze(['mouse', 'touch', 'keyboard', 'pen', 'other'])

export interface DeviceInfo {
  class: DeviceClass
  input: InputMode
  /** e.g. "macOS", "iOS", "Windows" (a family, never a version string). */
  os_family: string
  /** e.g. "Safari", "Chrome", "Firefox". */
  browser_family: string
  refresh_hz_est: number | null
  timer_res_ms: number | null
  /** CSS px [width, height]. */
  viewport: [number, number]
}

/**
 * Integrity flag counters (§13), e.g. `visibility_hidden_s`, `paste_events`, `fast_guess_n`.
 * Keys are snake_case; M1.19 adds more.
 */
export type SessionFlags = { [flag: string]: number | boolean | null }

/** Server HMAC over the whole file body (the §8 example's file-level `sig`, superseded by A16). */
export interface SaveSig {
  alg: 'HMAC-SHA256'
  kid: string
  mac: string
}

/**
 * A16 per-session MAC (M2.3): an HMAC over the session (without `sig`) together with the anon_id
 * it was issued to. That anon_id is stored in the sig because a merge (R-8.1) may give the file a
 * different `anon_id` (`merge.ts` keeps the smaller one), and the MAC must still verify after it.
 */
export interface SessionSig extends SaveSig {
  anon_id: string
}

export interface SaveSession {
  session_id: string
  /** UTC to the second, `YYYY-MM-DDTHH:MM:SSZ`. */
  started_utc: string
  duration_s: number
  device: DeviceInfo
  flags: SessionFlags
  responses: ResponseTuple[]
  /** A16 per-session MAC (M2.3). Never written by the static MVP. */
  sig?: SessionSig
}

/** Cached posterior (§8). A cache only (§7.8): re-scoring from `responses` is authoritative. */
export interface PosteriorCache {
  param_version: string
  axes: string[]
  mean: number[]
  /** Row-major lower triangle of the K × K covariance, K(K+1)/2 numbers. */
  cov_lower: number[]
}

export interface SaveFileV1 {
  $schema?: string
  schema_version: string
  bank_version: string
  anon_id: string
  created_utc: string
  sessions: SaveSession[]
  seen_items: string[]
  seen_families: string[]
  posterior_cache?: PosteriorCache
  /** §8 file-level MAC, superseded by A16. Never written by the client. */
  sig?: SaveSig
}

/**
 * What the running app is on when it writes or merges a save (§8 merge steps 3–4): the item bank
 * version stamped on output and the parameter version a cached posterior must match.
 */
export interface SaveContext {
  bank_version: string
  param_version: string
}
