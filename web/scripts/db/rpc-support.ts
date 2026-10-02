/**
 * Helpers for the RPC tests of M2.1-M2.4 (ROADMAP M2.1): a valid device object, request contexts
 * with a client address (what the rate limits key on), and a scripted session.
 */

import { createHmac } from 'node:crypto'
import { sessionMacInput } from '../../src/save/mac-input'
import type { SaveSession } from '../../src/save/types'
import { ANON, type RequestContext, type TestDb } from './harness'
import type { FixtureItem } from './bank-fixture'

/** A device object that satisfies schema/save-v1.json. */
export const DEVICE = {
  class: 'desktop',
  input: 'mouse',
  os_family: 'macOS',
  browser_family: 'Safari',
  refresh_hz_est: 120,
  timer_res_ms: 0.1,
  viewport: [1512, 861],
} as const

/** An anon request from this client address (the header PostgREST gets from the gateway). */
export const from = (ip: string): RequestContext => ({ ...ANON, headers: { 'x-forwarded-for': ip } })

/** The anon_id format of the save: hb_ + 16 base62 characters. */
export const ANON_ID_RE = /^hb_[0-9A-Za-z]{16,17}$/
export const SESSION_ID_RE = /^s_[0-9A-Za-z]{8,32}$/
export const TOKEN_RE = /^hbt_[A-Za-z0-9_-]{22}$/

export interface Started {
  session_id: string
  token: string
  anon_id: string
  /** True when the save sent with start_session proved its anon_id and the session continues it. */
  anon_id_adopted: boolean
  bank_version: string | null
  param_version: string | null
  limits: { max_items: number }
}

export interface Served {
  seq: number
  item: { item_id: string; item_type: string; time_limit_s: number | null; stem?: string; media?: unknown; options?: string[] }
}
export type Next = Served | { done: true; reason: string }

export const isServed = (n: Next): n is Served => 'item' in n

/**
 * The picker of M2.1 for tests that are about something else than selection: no exposure cap, no per-axis stop,
 * no coverage floor, no pretest slots (M2.2 settings; selection.db.test.ts tests them at their defaults). The
 * tests that play dozens of sessions out of a bank of a few hundred items would otherwise run out of items, or
 * stop an axis early, for reasons that are not what they check.
 */
export async function relaxSelection(db: TestDb): Promise<void> {
  const values: [string, number][] = [['selection.exposure_cap', 1000], ['selection.stop_sd', 0], ['selection.coverage_floor', 0], ['selection.pretest_share', 0]]
  for (const [key, value] of values) await db.owner.query(`update public.app_config set value = $2::jsonb where key = $1`, [key, JSON.stringify(value)])
}

export function startSession(db: TestDb, ip = '203.0.113.1', save?: unknown): Promise<Started> {
  return db.rpc<Started>(from(ip), 'start_session', save === undefined ? { p_device: DEVICE } : { p_device: DEVICE, p_save: save })
}

/** A minimal valid save for an anon_id (schema/save-v1.json, no sessions). */
export function emptySave(anonId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: '1.0.0',
    bank_version: 'test',
    anon_id: anonId,
    created_utc: '2026-10-01T12:00:00Z',
    sessions: [],
    seen_items: [],
    seen_families: [],
    ...extra,
  }
}

/** A save-v1 session object as the API hands it over (`finish`), plus whatever a test adds to it. */
export type SessionObject = Record<string, any>

/**
 * The session as `finish` hands it over, from the database's rows as they are now, with the sig of the
 * current key (M2.3). For tests that move a session in time or build a save from sessions they did not
 * finish in the same breath. `sudo`: the hb schema is not the API's.
 */
export async function signedSession(db: TestDb, sessionId: string): Promise<SessionObject> {
  const { rows } = await db.sudo.query<{ s: SessionObject }>(`select hb.session_signed($1) as s`, [sessionId])
  return rows[0]!.s
}

/** The text of a Vault secret, for a test that checks the server's MAC with an independent HMAC. */
export async function signingKey(db: TestDb, kid = 'k2026a'): Promise<string> {
  const { rows } = await db.sudo.query<{ k: string }>(`select decrypted_secret as k from vault.decrypted_secrets where name = $1`, [`save_hmac.${kid}`])
  if (rows[0] === undefined) throw new Error(`no signing key ${kid} in the Vault`)
  return rows[0].k
}

/**
 * The MAC of a session as ROADMAP A16 and supabase/README.md define it, computed here with Node's HMAC and the
 * app's statement of its input (`src/save/mac-input.ts`, RFC 8785), independently of the database: base64url, no
 * padding, over the canonical JSON of {anon_id, kind, session} where `session` has no sig.
 */
export function referenceMac(key: string, anonId: string, session: SessionObject): string {
  return createHmac('sha256', Buffer.from(key, 'utf8')).update(sessionMacInput(session as SaveSession, anonId), 'utf8').digest('base64url')
}

/** Pushes `elapsedS` seconds back into every exposure of a session, as if the person had been slow. */
export async function ageExposures(db: TestDb, sessionId: string, elapsedS: number): Promise<void> {
  await db.owner.query(`update public.exposure_log set served_at = served_at - make_interval(secs => $2) where session_id = $1`, [sessionId, elapsedS])
}

/**
 * Plays one session through the RPCs: serves items, answers each (right with probability `pCorrect`,
 * decided by `decide`), and returns what happened. Time is not faked: the server's too-fast check is
 * satisfied by aging the exposures before every answer.
 */
export async function playSession(
  db: TestDb,
  started: Started,
  bank: ReadonlyMap<string, FixtureItem>,
  options: {
    readonly ip: string
    readonly n: number
    readonly decide: (item: FixtureItem, seq: number) => boolean
    /** Sends this instead of the key-derived option (any JSON, also one outside the answer space); `decide` still says whether it was meant to be right. */
    readonly respond?: (item: FixtureItem, seq: number, right: boolean) => unknown
    readonly clientFlags?: (seq: number) => Record<string, unknown> | undefined
    /**
     * Restricts selection to these axes, as the client does with the current segment (M2.2 `p_axes`); a function
     * says it per item (index = how many have been answered so far), undefined = any axis.
     */
    readonly axes?: readonly string[] | ((index: number) => readonly string[] | undefined)
  },
): Promise<{ answered: { seq: number; itemId: string; right: boolean }[] }> {
  const ctx = from(options.ip)
  const answered: { seq: number; itemId: string; right: boolean }[] = []
  const axesFor = (index: number): { p_axes?: string[] } => {
    const a = typeof options.axes === 'function' ? options.axes(index) : options.axes
    return a === undefined ? {} : { p_axes: [...a] }
  }
  let next = await db.rpc<Next>(ctx, 'next_item', { p_token: started.token, ...axesFor(0) })
  for (let i = 0; i < options.n && isServed(next); i++) {
    const it = bank.get(next.item.item_id)
    if (it === undefined) throw new Error(`served an item the fixture does not know: ${next.item.item_id}`)
    const right = options.decide(it, next.seq)
    const response = options.respond !== undefined ? options.respond(it, next.seq, right) : right ? (it.key.index as number) : ((it.key.index as number) + 1) % it.nOptions
    await ageExposures(db, started.session_id, 20)
    const flags = options.clientFlags?.(next.seq)
    const out = await db.rpc<{ ack: boolean; seq: number; next?: Next }>(ctx, 'submit', {
      p_token: started.token,
      p_item_id: next.item.item_id,
      p_response: response,
      p_rt_ms: 5000,
      ...(flags === undefined ? {} : { p_client_flags: flags }),
      ...axesFor(i + 1),
    })
    answered.push({ seq: next.seq, itemId: next.item.item_id, right })
    next = out.next ?? { done: true, reason: 'no_next' }
  }
  return { answered }
}
