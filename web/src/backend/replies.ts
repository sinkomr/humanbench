/**
 * The server's replies, checked (ROADMAP M2.7; DESIGN §11.2; supabase/migrations 20261001000600 to
 * 20261003000100). What comes back over the network is data, never trusted for its shape: every
 * reply is read here into a plain TypeScript value, and anything that does not fit the contract is a
 * `reply` {@link BackendError}, so a screen never meets `undefined` where the contract promises a
 * string. Nothing here reads a key, a parameter or a verdict, because the server never sends one
 * (R-11.1: `submit` acknowledges, `finish` carries `correct: null`).
 */

import { isAxisCode, type AxisCode } from '../engine/axes'
import type { SaveFileV1, SaveSession } from '../save/types'
import { assertValidSave, assertValidSession } from '../save/validate'
import { BackendError } from './errors'

// ------------------------------------------------------------------------------ helpers

type Obj = Readonly<Record<string, unknown>>

function bad(path: string, why: string): never {
  throw new BackendError('reply', 'bad_reply', { detail: `${path}: ${why}` })
}

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

function obj(v: unknown, path: string): Obj {
  if (!isObj(v)) bad(path, 'expected an object')
  return v
}
function str(v: unknown, path: string, max = 4096): string {
  if (typeof v !== 'string' || v.length > max) bad(path, 'expected a string')
  return v
}
function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) bad(path, 'expected a number')
  return v
}
function int(v: unknown, path: string): number {
  const n = num(v, path)
  if (!Number.isInteger(n)) bad(path, 'expected an integer')
  return n
}
function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') bad(path, 'expected true or false')
  return v
}
const nullable = <T>(v: unknown, f: (x: unknown) => T): T | null => (v === null || v === undefined ? null : f(v))

// ------------------------------------------------------------------------- start_session

export interface StartedSession {
  readonly sessionId: string
  /** Opaque, shown once: keep it in memory only. */
  readonly token: string
  readonly anonId: string
  /** The server continued the anon_id of the save sent with the call (it proved it). */
  readonly anonIdAdopted: boolean
  readonly bankVersion: string | null
  readonly paramVersion: string | null
  readonly maxItems: number
}

export function parseStarted(raw: unknown): StartedSession {
  const o = obj(raw, 'start_session')
  const limits = obj(o.limits, 'start_session.limits')
  return {
    sessionId: str(o.session_id, 'start_session.session_id', 64),
    token: str(o.token, 'start_session.token', 256),
    anonId: str(o.anon_id, 'start_session.anon_id', 64),
    anonIdAdopted: bool(o.anon_id_adopted, 'start_session.anon_id_adopted'),
    bankVersion: nullable(o.bank_version, (x) => str(x, 'start_session.bank_version', 64)),
    paramVersion: nullable(o.param_version, (x) => str(x, 'start_session.param_version', 64)),
    maxItems: int(limits.max_items, 'start_session.limits.max_items'),
  }
}

// ------------------------------------------------------------------------------ next_item

/** An item as the server hands it over (`hb.item_view`): ids, type, time limit and the render payload. */
export interface ServedWire {
  readonly itemId: string
  readonly itemType: string
  readonly timeLimitS: number | null
  readonly stem: string | null
  readonly media: Obj | null
  readonly options: readonly string[] | null
}

export type DoneReason = 'item_limit' | 'axes_done' | 'no_items'
export const DONE_REASONS: readonly DoneReason[] = ['item_limit', 'axes_done', 'no_items']

export type NextReply = { readonly kind: 'item'; readonly seq: number; readonly item: ServedWire } | { readonly kind: 'done'; readonly reason: DoneReason }

export function parseNext(raw: unknown, path = 'next_item'): NextReply {
  const o = obj(raw, path)
  if (o.done === true) {
    const reason = str(o.reason, `${path}.reason`, 32)
    if (!(DONE_REASONS as readonly string[]).includes(reason)) bad(`${path}.reason`, `unknown reason ${JSON.stringify(reason)}`)
    return { kind: 'done', reason: reason as DoneReason }
  }
  const it = obj(o.item, `${path}.item`)
  const options = it.options
  if (options !== undefined && options !== null && (!Array.isArray(options) || options.length > 64 || options.some((x) => typeof x !== 'string' || x.length > 2000))) {
    bad(`${path}.item.options`, 'expected a list of strings')
  }
  const media = it.media
  if (media !== undefined && media !== null && !isObj(media)) bad(`${path}.item.media`, 'expected an object')
  const limit = it.time_limit_s
  return {
    kind: 'item',
    seq: int(o.seq, `${path}.seq`),
    item: {
      itemId: str(it.item_id, `${path}.item.item_id`, 256),
      itemType: str(it.item_type, `${path}.item.item_type`, 64),
      timeLimitS: limit === null || limit === undefined ? null : int(limit, `${path}.item.time_limit_s`),
      stem: it.stem === undefined || it.stem === null ? null : str(it.stem, `${path}.item.stem`, 20000),
      media: media === undefined ? null : (media as Obj | null),
      options: options === undefined || options === null ? null : (options as string[]),
    },
  }
}

// -------------------------------------------------------------------------------- submit

export interface SubmitReply {
  readonly seq: number
  /** Present when the call asked for the next item in the same round trip. */
  readonly next: NextReply | null
}

export function parseSubmit(raw: unknown): SubmitReply {
  const o = obj(raw, 'submit')
  if (o.ack !== true) bad('submit.ack', 'expected true')
  return { seq: int(o.seq, 'submit.seq'), next: o.next === undefined || o.next === null ? null : parseNext(o.next, 'submit.next') }
}

// -------------------------------------------------------------------------------- finish

export interface FinishReply {
  /** The session as the server signed it (`sig` is absent while the Vault holds no key). */
  readonly session: SaveSession
  readonly anonId: string
  readonly nResponses: number
}

export function parseFinish(raw: unknown): FinishReply {
  const o = obj(raw, 'finish')
  let session: SaveSession
  try {
    session = assertValidSession(o.session, 'finish.session')
  } catch (e) {
    return bad('finish.session', e instanceof Error ? e.message : 'not a session')
  }
  return { session, anonId: str(o.anon_id, 'finish.anon_id', 64), nResponses: int(o.n_responses, 'finish.n_responses') }
}

// -------------------------------------------------------------------------- verify_save

export type VerifyReason = 'unsigned' | 'bad_signature' | 'unknown_key' | 'malformed'
const VERIFY_REASONS: readonly string[] = ['unsigned', 'bad_signature', 'unknown_key', 'malformed']

export interface SessionVerdict {
  readonly sessionId: string | null
  readonly status: 'verified' | 'unverified'
  readonly reason: VerifyReason | null
}
export interface VerifyReply {
  readonly anonId: string
  readonly sessions: readonly SessionVerdict[]
  readonly nVerified: number
  readonly nUnverified: number
}

export function parseVerify(raw: unknown): VerifyReply {
  const o = obj(raw, 'verify_save')
  const rows = o.sessions
  if (!Array.isArray(rows) || rows.length > 1000) bad('verify_save.sessions', 'expected a list')
  const sessions = rows.map((r, i): SessionVerdict => {
    const e = obj(r, `verify_save.sessions[${i}]`)
    const status = str(e.status, `verify_save.sessions[${i}].status`, 16)
    if (status !== 'verified' && status !== 'unverified') bad(`verify_save.sessions[${i}].status`, 'unknown status')
    const reason = nullable(e.reason, (x) => str(x, `verify_save.sessions[${i}].reason`, 32))
    if (reason !== null && !VERIFY_REASONS.includes(reason)) bad(`verify_save.sessions[${i}].reason`, 'unknown reason')
    return { sessionId: nullable(e.session_id, (x) => str(x, `verify_save.sessions[${i}].session_id`, 64)), status, reason: reason as VerifyReason | null }
  })
  return { anonId: str(o.anon_id, 'verify_save.anon_id', 64), sessions, nVerified: int(o.n_verified, 'verify_save.n_verified'), nUnverified: int(o.n_unverified, 'verify_save.n_unverified') }
}

// ----------------------------------------------------------------------------- rescore

/** An own-axis posterior, rounded by the server (R-11.1): mean to 0.1, sd up to 0.05, n answers. */
export interface ServerEstimate {
  readonly mean: number
  readonly sd: number
  readonly n: number
}

export interface RescoreReply {
  readonly paramVersion: string | null
  /** Per axis, only those the server publishes (an axis needs enough answers in one session). */
  readonly eap: Readonly<Partial<Record<AxisCode, ServerEstimate>>>
  /** Per axis, per facet. */
  readonly facets: Readonly<Partial<Record<AxisCode, Readonly<Record<string, ServerEstimate>>>>>
  /** The sessions asked about: whether the server holds and verified each. */
  readonly sessions: readonly { readonly sessionId: string; readonly known: boolean }[]
}

function estimate(v: unknown, path: string): ServerEstimate {
  const o = obj(v, path)
  const sd = num(o.sd, `${path}.sd`)
  if (sd < 0) bad(`${path}.sd`, 'negative')
  return { mean: num(o.mean, `${path}.mean`), sd, n: int(o.n, `${path}.n`) }
}

export function parseRescore(raw: unknown): RescoreReply {
  const o = obj(raw, 'rescore')
  const eap: Partial<Record<AxisCode, ServerEstimate>> = {}
  for (const [k, v] of Object.entries(obj(o.eap ?? {}, 'rescore.eap'))) {
    if (!isAxisCode(k)) bad(`rescore.eap.${k}`, 'unknown axis')
    eap[k] = estimate(v, `rescore.eap.${k}`)
  }
  const facets: Partial<Record<AxisCode, Record<string, ServerEstimate>>> = {}
  for (const [k, v] of Object.entries(obj(o.facets ?? {}, 'rescore.facets'))) {
    if (!isAxisCode(k)) bad(`rescore.facets.${k}`, 'unknown axis')
    const byFacet: Record<string, ServerEstimate> = {}
    for (const [f, e] of Object.entries(obj(v, `rescore.facets.${k}`))) byFacet[f] = estimate(e, `rescore.facets.${k}.${f}`)
    facets[k] = byFacet
  }
  const rows = o.sessions
  if (!Array.isArray(rows) || rows.length > 1000) bad('rescore.sessions', 'expected a list')
  const sessions = rows.map((r, i) => {
    const e = obj(r, `rescore.sessions[${i}]`)
    return { sessionId: str(e.session_id, `rescore.sessions[${i}].session_id`, 64), known: bool(e.known, `rescore.sessions[${i}].known`) }
  })
  return { paramVersion: nullable(o.param_version, (x) => str(x, 'rescore.param_version', 64)), eap, facets, sessions }
}

// ------------------------------------------------------------------------------- mirror

export type MirrorPutReply =
  | { readonly stored: true; readonly anonId: string; readonly sizeBytes: number; readonly recoveryPhrase: string | null }
  | { readonly stored: false; readonly error: 'wrong_phrase' }

export function parseMirrorPut(raw: unknown): MirrorPutReply {
  const o = obj(raw, 'mirror_put')
  if (o.stored === false) {
    if (o.error !== 'wrong_phrase') bad('mirror_put.error', 'unknown error')
    return { stored: false, error: 'wrong_phrase' }
  }
  if (o.stored !== true) bad('mirror_put.stored', 'expected true or false')
  return {
    stored: true,
    anonId: str(o.anon_id, 'mirror_put.anon_id', 64),
    sizeBytes: int(o.size_bytes, 'mirror_put.size_bytes'),
    recoveryPhrase: nullable(o.recovery_phrase, (x) => str(x, 'mirror_put.recovery_phrase', 400)),
  }
}

export type MirrorGetReply = { readonly found: true; readonly save: SaveFileV1; readonly updatedUtc: string } | { readonly found: false }

export function parseMirrorGet(raw: unknown): MirrorGetReply {
  const o = obj(raw, 'mirror_get')
  if (o.found === false) return { found: false }
  if (o.found !== true) bad('mirror_get.found', 'expected true or false')
  let save: SaveFileV1
  try {
    save = assertValidSave(o.save)
  } catch (e) {
    return bad('mirror_get.save', e instanceof Error ? e.message : 'not a save')
  }
  return { found: true, save, updatedUtc: str(o.updated_utc, 'mirror_get.updated_utc', 40) }
}

export type DeleteReply = { readonly deleted: true; readonly sessions: number; readonly mirror: boolean } | { readonly deleted: false }

export function parseDelete(raw: unknown): DeleteReply {
  const o = obj(raw, 'delete_my_data')
  if (o.deleted === false) return { deleted: false }
  if (o.deleted !== true) bad('delete_my_data.deleted', 'expected true or false')
  return { deleted: true, sessions: int(o.sessions, 'delete_my_data.sessions'), mirror: bool(o.mirror, 'delete_my_data.mirror') }
}

// ------------------------------------------------------------------- report / survey

export function parseRecorded(raw: unknown, fn: string): boolean {
  return bool(obj(raw, fn).recorded, `${fn}.recorded`)
}
