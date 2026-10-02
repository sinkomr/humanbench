/// <reference lib="dom" />
/**
 * A fake server for the browser tests of the online version (ROADMAP M2.7): the RPCs of the project the
 * app talks to, answered from the test with `page.route`, on the page's own origin (so no CORS). It
 * speaks the contract of supabase/migrations as the front end sees it, including the rules the app
 * must respect and a test must be able to see broken: it refuses a payload that carries `brief_prefs`
 * anywhere (the server's rule, AI.26), refuses an answer to an item it did not serve, hands out the
 * recovery phrase only once, and signs a session with a stand-in MAC that `verify_save` accepts and an
 * edited session no longer matches. The real functions are exercised by `scripts/db/backend.db.test.ts`;
 * this one makes the browser flow testable without a database, in three engines.
 */

import type { Page, Route } from '@playwright/test'

export const PORT = Number(process.env.E2E_PORT ?? 4174)
/** The path under the page's origin that stands for the project URL. */
export const PROJECT_PATH = '/fake-supabase'
export const PROJECT_URL = `http://127.0.0.1:${PORT}${PROJECT_PATH}`
/** The query that points a page of the Playwright build at the fake project (`src/backend/config.ts`). */
export const SERVER_QUERY = `?hb_backend=${encodeURIComponent(PROJECT_URL)}&hb_key=e2e-anon-key`

export const SESSION_ID = 's_E2EFAKESERV0001'
export const TOKEN = 'hbt_E2EFAKETOKEN0123456789'
export const ANON_ID = 'hb_E2eServerIssued1'
export const PHRASE = 'acorn acrobat action advice agate agenda aisle album alder alert almond amber'
/** What this server puts in a session's signature; an edited session is checked against its own copy. */
export const FAKE_MAC = 'ZTJlLWZha2UtbWFj'

export interface Call {
  readonly fn: string
  readonly body: Record<string, unknown>
}

export interface Wire {
  readonly seq: number
  readonly item: { item_id: string; item_type: string; time_limit_s: number; media: Record<string, unknown> }
}

/** A series item the app can draw: the spec as the bank stores it, with the family named in `media.renderer`. */
export function seriesWire(seq: number, terms: number[] = [2, 4, 6, 8, 10]): Wire {
  return { seq, item: { item_id: `i:series:1.0.0:e2e${seq}`, item_type: 'series', time_limit_s: 120, media: { renderer: 'series', input_format: 'integer', terms } } }
}

export interface FakeOptions {
  /** Items to serve, in order; then `done`. */
  readonly items?: readonly Wire[]
  /** Fail these functions with a status (a network failure is `0`) this many times. */
  readonly failures?: Readonly<Record<string, { status: number; times: number; code?: string }>>
  /** A backup already on the server: identifier → phrase. */
  readonly backups?: Readonly<Record<string, string>>
}

export class FakeServer {
  readonly calls: Call[] = []
  readonly served: string[] = []
  readonly answered: string[] = []
  readonly #queue: Wire[]
  readonly #failures = new Map<string, { status: number; times: number; code?: string }>()
  /** identifier → { phrase, save } */
  readonly mirror = new Map<string, { phrase: string; save: Record<string, unknown> | null }>()
  readonly deleted: string[] = []
  #device: unknown = null
  #flags: unknown = {}
  readonly #tuples: unknown[][] = []

  constructor(opts: FakeOptions = {}) {
    this.#queue = [...(opts.items ?? [])]
    for (const [fn, f] of Object.entries(opts.failures ?? {})) this.#failures.set(fn, { ...f })
    for (const [id, phrase] of Object.entries(opts.backups ?? {})) this.mirror.set(id, { phrase, save: null })
  }

  /** Answers the project's RPCs for `page`. */
  async attach(page: Page): Promise<void> {
    await page.route(new RegExp(`${PROJECT_PATH}/rest/v1/rpc/`), (route) => void this.#handle(route))
  }

  of(fn: string): Call[] {
    return this.calls.filter((c) => c.fn === fn)
  }

  /** Every request body, as the JSON text that crossed the wire. */
  allBodies(): string {
    return this.calls.map((c) => JSON.stringify(c.body)).join('\n')
  }

  async #handle(route: Route): Promise<void> {
    const request = route.request()
    const fn = new URL(request.url()).pathname.split('/').pop() ?? ''
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>
    this.calls.push({ fn, body })
    const fail = this.#failures.get(fn)
    if (fail !== undefined && fail.times > 0) {
      fail.times--
      if (fail.status === 0) return route.abort('failed')
      return this.#error(route, fail.status, fail.code ?? 'server_unavailable')
    }
    if (JSON.stringify(body).includes('"brief_prefs"')) return this.#error(route, 400, 'brief_prefs_not_accepted')
    try {
      const out = this.#call(fn, body)
      if (out instanceof Failure) return this.#error(route, out.status, out.code)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) })
    } catch (e) {
      return this.#error(route, 500, String(e))
    }
  }

  #error(route: Route, status: number, code: string): Promise<void> {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ code: `PT${status}`, message: code, details: null, hint: null }) })
  }

  #call(fn: string, a: Record<string, unknown>): unknown {
    switch (fn) {
      case 'start_session':
        this.#device = a.p_device
        return { session_id: SESSION_ID, token: TOKEN, anon_id: ANON_ID, anon_id_adopted: false, bank_version: 'e2e', param_version: 'e2e', limits: { max_items: 200 } }
      case 'next_item': {
        if (a.p_token !== TOKEN) return new Failure(401, 'invalid_session')
        const pending = this.served.find((id) => !this.answered.includes(id))
        if (pending !== undefined) return this.#wire(pending)
        const next = this.#queue.shift()
        if (next === undefined) return { done: true, reason: 'axes_done' }
        this.served.push(next.item.item_id)
        this.#wires.set(next.item.item_id, next)
        return next
      }
      case 'submit': {
        if (a.p_token !== TOKEN) return new Failure(401, 'invalid_session')
        const id = String(a.p_item_id)
        if (!this.served.includes(id)) return new Failure(404, 'item_not_served')
        if (!this.answered.includes(id)) {
          this.answered.push(id)
          const flags = (a.p_client_flags ?? {}) as Record<string, unknown>
          if (flags.skipped !== true && flags.unavailable !== true) this.#tuples.push([id, 0, a.p_response ?? null, null, a.p_rt_ms, a.p_confidence ?? null])
        }
        return { ack: true, seq: this.answered.length }
      }
      case 'finish':
        if (a.p_token !== TOKEN) return new Failure(401, 'invalid_session')
        this.#flags = a.p_flags ?? {}
        return { session: this.#session(), anon_id: ANON_ID, n_responses: this.#tuples.length }
      case 'report_problem':
      case 'submit_survey':
        return a.p_token === TOKEN ? { recorded: true } : new Failure(401, 'invalid_session')
      case 'verify_save': {
        const sessions = ((a.p_save as { sessions?: SessionLike[] }).sessions ?? []).map((s) => ({
          session_id: s.session_id,
          status: s.sig?.mac === FAKE_MAC && s.duration_s !== 1 ? 'verified' : 'unverified',
          reason: s.sig?.mac === FAKE_MAC && s.duration_s !== 1 ? null : 'bad_signature',
        }))
        return { anon_id: String((a.p_save as { anon_id?: string }).anon_id), sessions, n_verified: sessions.filter((s) => s.status === 'verified').length, n_unverified: sessions.filter((s) => s.status !== 'verified').length }
      }
      case 'rescore': {
        const sessions = ((a.p_save as { sessions?: SessionLike[] }).sessions ?? []).map((s) => ({ session_id: s.session_id, known: s.sig?.mac === FAKE_MAC }))
        return {
          retest_version: 'retest_v1',
          param_version: 'e2e',
          sessions: sessions.map((s) => ({ ...s, ordinals: {}, rho: {}, n_scored: 0 })),
          eap: { MAT: { mean: 0.6, sd: 0.4, n: 6 } },
          facets: { MAT: { series: { mean: 0.5, sd: 0.5, n: 5 } } },
          withheld: { eap: {}, facets: {} },
          limits: {},
          skipped: {},
        }
      }
      case 'mirror_put': {
        if (a.p_token !== TOKEN) return new Failure(401, 'invalid_session')
        const save = a.p_save as { anon_id: string }
        if (save.anon_id !== ANON_ID) return new Failure(403, 'anon_id_mismatch')
        const had = this.mirror.get(ANON_ID)
        if (had !== undefined) {
          if (a.p_phrase !== had.phrase) return { stored: false, error: 'wrong_phrase' }
          had.save = save
          return { stored: true, anon_id: ANON_ID, size_bytes: JSON.stringify(save).length }
        }
        this.mirror.set(ANON_ID, { phrase: PHRASE, save })
        return { stored: true, anon_id: ANON_ID, size_bytes: JSON.stringify(save).length, recovery_phrase: PHRASE }
      }
      case 'mirror_get': {
        const m = this.mirror.get(String(a.p_anon_id))
        if (m === undefined || m.phrase !== a.p_phrase || m.save === null) return { found: false }
        return { found: true, save: m.save, updated_utc: '2026-10-04T10:00:00Z' }
      }
      case 'delete_my_data': {
        const id = String(a.p_anon_id)
        const m = this.mirror.get(id)
        const byPhrase = m !== undefined && m.phrase === a.p_phrase
        const bySave = a.p_save !== undefined && ((a.p_save as { sessions?: SessionLike[] }).sessions ?? []).some((s) => s.sig?.mac === FAKE_MAC && s.sig.anon_id === id)
        if (!byPhrase && !bySave) return { deleted: false }
        this.mirror.delete(id)
        this.deleted.push(id)
        return { deleted: true, sessions: 1, mirror: m !== undefined }
      }
      default:
        return new Failure(404, 'unknown_function')
    }
  }

  readonly #wires = new Map<string, Wire>()
  #wire(id: string): Wire {
    return this.#wires.get(id)!
  }

  /** The session as this server would sign it from what it was given. */
  #session(): unknown {
    return {
      session_id: SESSION_ID,
      started_utc: '2026-10-03T17:20:02Z',
      duration_s: 60,
      device: this.#device,
      flags: this.#flags,
      responses: this.#tuples,
      sig: { alg: 'HMAC-SHA256', kid: 'k2026a', mac: FAKE_MAC, anon_id: ANON_ID },
    }
  }
}

interface SessionLike {
  session_id: string
  duration_s?: number
  sig?: { mac: string; anon_id: string }
}

class Failure {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {}
}

/** A save with one session the fake server signed, and the notes settings `prefs` (or none): a person's file from an earlier visit. */
export function signedSave(prefs?: Record<string, unknown>, extra: { duration?: number; mac?: string } = {}): Record<string, unknown> {
  return {
    schema_version: '1.0.0',
    bank_version: 'e2e',
    anon_id: ANON_ID,
    created_utc: '2026-10-03T18:00:00Z',
    sessions: [
      {
        session_id: 's_E2EEARLIER00001',
        started_utc: '2026-10-02T17:20:02Z',
        duration_s: extra.duration ?? 61,
        device: { class: 'desktop', input: 'keyboard', os_family: 'macOS', browser_family: 'Chrome', refresh_hz_est: 60, timer_res_ms: 0.1, viewport: [1280, 800] },
        flags: {},
        responses: [['i:series:1.0.0:e2eold', 0, '12', null, 5000, 60]],
        sig: { alg: 'HMAC-SHA256', kid: 'k2026a', mac: extra.mac ?? FAKE_MAC, anon_id: ANON_ID },
      },
    ],
    seen_items: ['i:series:1.0.0:e2eold'],
    seen_families: [],
    ...(prefs === undefined ? {} : { brief_prefs: prefs }),
  }
}

/** Notes settings of the shape the save schema allows, for a file that holds some. */
export function prefs(month = '2026-10'): Record<string, unknown> {
  return { v: 1, topics: 'topics-v1', groups: 'g1', notes_as_of: month, contexts: [], fit_log: [] }
}
