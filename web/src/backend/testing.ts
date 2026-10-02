/**
 * Test-only helpers of the server client (ROADMAP M2.7): a recording transport that answers each
 * RPC with a reply the contract allows. Never imported by the app.
 */

import { createBackendApi } from './api'
import type { Backend } from './backend'
import { BackendError } from './errors'
import { ServerSession } from './session'
import type { RpcTransport } from './transport'

export const TOKEN = 'hbt_ABCDEFGHIJKLMNOPQRSTUV'
export const SESSION_ID = 's_SERVERSESSION01'
export const ANON = 'hb_ServerIssuedId1X'

export const CANNED: Readonly<Record<string, unknown>> = {
  start_session: { session_id: SESSION_ID, token: TOKEN, anon_id: ANON, anon_id_adopted: false, bank_version: 'bank-test', param_version: 'p-test', limits: { max_items: 200 } },
  next_item: { done: true, reason: 'axes_done' },
  submit: { ack: true, seq: 1 },
  finish: {
    session: {
      session_id: SESSION_ID,
      started_utc: '2026-10-03T17:20:02Z',
      duration_s: 61.5,
      device: { class: 'desktop', input: 'mouse', os_family: 'macOS', browser_family: 'Safari', refresh_hz_est: 120, timer_res_ms: 0.1, viewport: [1512, 861] },
      flags: {},
      responses: [['i:series:1.0.0:1', 0, '4', null, 5000, 60]],
      sig: { alg: 'HMAC-SHA256', kid: 'k2026a', mac: 'bWFj', anon_id: ANON },
    },
    anon_id: ANON,
    n_responses: 1,
  },
  report_problem: { recorded: true },
  submit_survey: { recorded: true },
  verify_save: { anon_id: ANON, sessions: [], n_verified: 0, n_unverified: 0 },
  rescore: { retest_version: 'retest_v1', param_version: 'p-test', sessions: [], eap: {}, facets: {}, withheld: { eap: {}, facets: {} }, limits: {}, skipped: {} },
  mirror_put: { stored: true, anon_id: ANON, size_bytes: 10, recovery_phrase: 'acorn acrobat action advice agate agenda aisle album alder alert almond amber' },
  mirror_get: { found: false },
  delete_my_data: { deleted: false },
}

export interface Call {
  readonly fn: string
  /** The arguments as JSON text, which is what goes over the wire. */
  readonly body: string
}

/** A transport that records the calls (as the JSON the wire would carry) and answers from `replies`. */
export class FakeTransport implements RpcTransport {
  readonly calls: Call[] = []
  replies: Record<string, unknown> = { ...CANNED }
  /** Errors to throw for the next calls of a function, in order. */
  failures = new Map<string, BackendError[]>()

  call(fn: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
    this.calls.push({ fn, body: JSON.stringify(args) })
    const f = this.failures.get(fn)?.shift()
    if (f !== undefined) return Promise.reject(f)
    if (!(fn in this.replies)) return Promise.reject(new BackendError('rejected', 'unknown_function', { status: 404 }))
    return Promise.resolve(structuredClone(this.replies[fn]))
  }

  args(fn: string, i = 0): Record<string, unknown> {
    const c = this.calls.filter((x) => x.fn === fn)[i]
    if (c === undefined) throw new Error(`no call ${i} of ${fn}`)
    return JSON.parse(c.body) as Record<string, unknown>
  }
}

/** A {@link FakeTransport} that answers a function from a queue first, then from `replies`. */
export class ScriptedTransport extends FakeTransport {
  readonly queues = new Map<string, unknown[]>()

  override call(fn: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
    const q = this.queues.get(fn)
    if (q !== undefined && q.length > 0) {
      const next = q.shift()
      this.calls.push({ fn, body: JSON.stringify(args) })
      if (next instanceof BackendError) return Promise.reject(next)
      return Promise.resolve(structuredClone(next))
    }
    return super.call(fn, args)
  }

  /** Replies for the next calls of `fn`, in order (an error is thrown instead of returned). */
  script(fn: string, ...replies: unknown[]): void {
    this.queues.set(fn, [...(this.queues.get(fn) ?? []), ...replies])
  }

  callsOf(fn: string): number {
    return this.calls.filter((c) => c.fn === fn).length
  }
}

/** A {@link Backend} over a fake transport, with no waiting between retries. */
export function fakeBackend(transport: RpcTransport): Backend {
  const api = createBackendApi(transport, { sleep: () => Promise.resolve() })
  return { api, host: 'test.example', open: (device, save) => ServerSession.start(api, device, save) }
}
