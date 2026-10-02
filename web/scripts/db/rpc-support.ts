/**
 * Helpers for the RPC tests of M2.1-M2.4 (ROADMAP M2.1): a valid device object, request contexts
 * with a client address (what the rate limits key on), and a scripted session.
 */

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
  },
): Promise<{ answered: { seq: number; itemId: string; right: boolean }[] }> {
  const ctx = from(options.ip)
  const answered: { seq: number; itemId: string; right: boolean }[] = []
  let next = await db.rpc<Next>(ctx, 'next_item', { p_token: started.token })
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
    })
    answered.push({ seq: next.seq, itemId: next.item.item_id, right })
    next = out.next ?? { done: true, reason: 'no_next' }
  }
  return { answered }
}
