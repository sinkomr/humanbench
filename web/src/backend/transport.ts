/**
 * The wire (ROADMAP M2.7; DESIGN §11.2, §11.7): supabase-js, loaded on first use, calling the
 * whitelisted RPCs of the project at a configurable URL with the public anon key.
 *
 * - **Lazy.** `@supabase/supabase-js` is a dynamic import behind `__HB_BACKEND__`, so a plain
 *   production build (the static fallback) contains none of it, and a build that names a server
 *   loads it as a chunk of its own, after the person has passed the 18+ gate and only when a call
 *   is made (`scripts/backend-bundle.test.ts`).
 * - **No accounts, no stored session.** The client is made with `persistSession: false`,
 *   `autoRefreshToken: false` and `detectSessionInUrl: false`: HumanBench has no sign-in, the anon
 *   key is the only credential, and nothing is written to `localStorage`, a cookie or IndexedDB by
 *   the transport (R-12.1; the 18+ gate promise of M1.15 holds for it too).
 * - **One shape of failure.** Every failure, from a dropped connection to a PostgREST error, is a
 *   {@link BackendError} (`errors.ts`).
 * - **The AI.26 guard.** {@link guarded} wraps any transport so that no call goes out with a
 *   `brief_prefs` key in its arguments (`upload.ts`), and drops the character U+0000 from every
 *   string and key, which the database would refuse with a 400.
 *
 * The transport knows nothing of HumanBench: `call(fn, args)` posts `args` to `rpc/<fn>`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BackendConfig } from './config'
import { BackendError, backendErrorFrom } from './errors'
import { assertNoBriefPrefs, storable } from './upload'

export interface RpcTransport {
  /** Calls the RPC `fn` with the named arguments and resolves to its JSON result. Rejects with a {@link BackendError}. */
  call(fn: string, args: Readonly<Record<string, unknown>>): Promise<unknown>
}

/** How long a call may take before it counts as a failure (the plan is p95 < 300 ms; the tail is generous for mobile networks). */
export const CALL_TIMEOUT_MS = 20_000

export interface SupabaseDeps {
  /** Loads the supabase-js module (default: the lazy import). */
  readonly load?: () => Promise<typeof import('@supabase/supabase-js')>
  /** The `fetch` the client uses (default: the global one). */
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number
}

/** The lazy import, or a refusal in a build that has no server (the static fallback). */
export function loadSupabaseJs(): Promise<typeof import('@supabase/supabase-js')> {
  return __HB_BACKEND__ ? import('@supabase/supabase-js') : Promise.reject(new BackendError('local', 'backend_not_built', { detail: 'this build has no server' }))
}

/** The transport over supabase-js for the project of `config`. The client is created on the first call. */
export function supabaseTransport(config: BackendConfig, deps: SupabaseDeps = {}): RpcTransport {
  const load = deps.load ?? loadSupabaseJs
  const timeoutMs = deps.timeoutMs ?? CALL_TIMEOUT_MS
  let client: Promise<SupabaseClient> | null = null
  const getClient = (): Promise<SupabaseClient> => {
    client ??= load().then(
      (m) =>
        m.createClient(config.url, config.anonKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          ...(deps.fetch === undefined ? {} : { global: { fetch: deps.fetch } }),
        }),
      (e: unknown) => {
        client = null // a failed load (offline) may be tried again
        throw e instanceof BackendError ? e : new BackendError('network', 'network_error', { cause: e })
      },
    )
    return client
  }
  return {
    async call(fn, args) {
      const c = await getClient()
      // An AbortController and a timer rather than AbortSignal.timeout, which older iOS Safari (before 16.4) lacks.
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), timeoutMs)
      let res
      try {
        res = await c.rpc(fn, args as Record<string, unknown>).abortSignal(ctl.signal)
      } catch (e) {
        throw ctl.signal.aborted ? new BackendError('timeout', 'timeout', { cause: e }) : new BackendError('network', 'network_error', { cause: e })
      } finally {
        clearTimeout(timer)
      }
      // postgrest-js reports an abort or a dropped connection as an error value with no status
      if (res.error !== null) throw ctl.signal.aborted ? new BackendError('timeout', 'timeout') : backendErrorFrom(res.error, typeof res.status === 'number' ? res.status : null)
      return res.data as unknown
    },
  }
}

/**
 * `transport` that refuses any call whose arguments hold a `brief_prefs` key (AI.26), and cleans every string and key
 * it sends of the characters the database refuses with a 400 before any function runs: U+0000 is dropped and a lone
 * surrogate becomes U+FFFD ({@link storable}).
 */
export function guarded(transport: RpcTransport): RpcTransport {
  return {
    call(fn, args) {
      let clean: Readonly<Record<string, unknown>>
      try {
        // the characters first: a key such as "brief_<U+0000>prefs" is the notes key once it is gone
        clean = storable(args)
        assertNoBriefPrefs(clean, fn)
      } catch (e) {
        return Promise.reject(e)
      }
      return transport.call(fn, clean)
    },
  }
}
