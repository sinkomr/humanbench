import { describe, expect, it, vi } from 'vitest'
import { BackendError } from './errors'
import { guarded, supabaseTransport, type RpcTransport } from './transport'

const CONFIG = { url: 'https://abcdefgh.supabase.co', anonKey: 'sb_publishable_test-key' } as const

interface Seen {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

/** A fetch that records the request and answers like PostgREST. */
function fakeFetch(answer: (seen: Seen) => Response | Promise<Response>): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = []
  const f = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((v, k) => (headers[k.toLowerCase()] = v))
    const text = typeof init?.body === 'string' ? init.body : undefined
    const s: Seen = { url: String(input instanceof Request ? input.url : input), method: init?.method ?? 'GET', headers, body: text === undefined ? undefined : JSON.parse(text) }
    seen.push(s)
    return answer(s)
  }) as typeof fetch
  return { fetch: f, seen }
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('the supabase-js transport (M2.7)', () => {
  it('posts the named arguments to rest/v1/rpc/<fn> with the anon key, and returns the JSON', async () => {
    const { fetch, seen } = fakeFetch(() => json(200, { done: true, reason: 'axes_done' }))
    const t = supabaseTransport(CONFIG, { fetch })
    await expect(t.call('next_item', { p_token: 'hbt_x', p_axes: ['MAT'] })).resolves.toEqual({ done: true, reason: 'axes_done' })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.url).toBe('https://abcdefgh.supabase.co/rest/v1/rpc/next_item')
    expect(seen[0]!.method).toBe('POST')
    expect(seen[0]!.body).toEqual({ p_token: 'hbt_x', p_axes: ['MAT'] })
    expect(seen[0]!.headers.apikey).toBe(CONFIG.anonKey)
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${CONFIG.anonKey}`)
    expect(seen[0]!.headers['content-type']).toContain('application/json')
  })

  it('sends the token in the body, never in the URL', async () => {
    const { fetch, seen } = fakeFetch(() => json(200, { recorded: true }))
    await supabaseTransport(CONFIG, { fetch }).call('submit_survey', { p_token: 'hbt_secret', p_english_first: true })
    expect(seen[0]!.url).not.toContain('hbt_secret')
    expect(JSON.stringify(seen[0]!.headers)).not.toContain('hbt_secret')
  })

  it('maps the PT status codes of the RPCs to errors with the server code', async () => {
    const cases: [number, string, string, string][] = [
      [400, 'PT400', 'invalid_device', 'rejected'],
      [401, 'PT401', 'invalid_session', 'auth'],
      [404, 'PT404', 'item_not_served', 'rejected'],
      [409, 'PT409', 'session_finished', 'conflict'],
      [413, 'PT413', 'save_too_large', 'rejected'],
      [429, 'PT429', 'too_fast', 'limited'],
      [503, '503', 'Service Unavailable', 'server'],
    ]
    for (const [status, code, message, kind] of cases) {
      const { fetch } = fakeFetch(() => json(status, { code, message, details: 'some detail', hint: null }))
      const err = await supabaseTransport(CONFIG, { fetch }).call('submit', {}).catch((e: unknown) => e)
      expect(err, String(status)).toBeInstanceOf(BackendError)
      expect(err).toMatchObject({ kind, status })
      if (/^[a-z_]+$/u.test(message)) expect(err).toMatchObject({ code: message, detail: 'some detail' })
    }
  })

  it('treats a dropped connection as a network error, and a slow server as a timeout', async () => {
    const down = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    await expect(supabaseTransport(CONFIG, { fetch: down.fetch }).call('next_item', {})).rejects.toMatchObject({ kind: 'network', retryable: true })
    // a request that never answers is ended by the AbortSignal after the time given
    const hang = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise((_ok, no) => init?.signal?.addEventListener('abort', () => no(init.signal!.reason)))) as typeof fetch
    const err = await supabaseTransport(CONFIG, { fetch: hang, timeoutMs: 30 }).call('next_item', {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BackendError)
    expect(err).toMatchObject({ kind: 'timeout', retryable: true })
  })

  it('does not need AbortSignal.timeout (older iOS Safari lacks it)', async () => {
    const original = AbortSignal.timeout
    // @ts-expect-error simulating a browser without the static method
    delete AbortSignal.timeout
    try {
      const { fetch } = fakeFetch(() => json(200, { recorded: true }))
      await expect(supabaseTransport(CONFIG, { fetch }).call('submit_survey', {})).resolves.toEqual({ recorded: true })
    } finally {
      AbortSignal.timeout = original
    }
  })

  it('is lazy: nothing is loaded until the first call, and a failed load is tried again', async () => {
    const real = await import('@supabase/supabase-js')
    const { fetch } = fakeFetch(() => json(200, { recorded: true }))
    let loads = 0
    const load = vi.fn(async () => {
      loads++
      if (loads === 1) throw new TypeError('Failed to fetch dynamically imported module')
      return real
    })
    const t = supabaseTransport(CONFIG, { load, fetch })
    expect(load).not.toHaveBeenCalled()
    await expect(t.call('report_problem', {})).rejects.toMatchObject({ kind: 'network' })
    await expect(t.call('report_problem', {})).resolves.toEqual({ recorded: true })
    await expect(t.call('report_problem', {})).resolves.toEqual({ recorded: true })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('makes the client with no stored session, no refresh and no session in the URL', async () => {
    const real = await import('@supabase/supabase-js')
    let options: Parameters<typeof real.createClient>[2]
    const load = async (): Promise<typeof real> => ({
      ...real,
      createClient: ((url: string, key: string, opts: typeof options) => {
        options = opts
        return real.createClient(url, key, opts)
      }) as typeof real.createClient,
    })
    const { fetch } = fakeFetch(() => json(200, { recorded: true }))
    await supabaseTransport(CONFIG, { load, fetch }).call('submit_survey', {})
    // supabase-js writes nothing until someone signs in, so what is checked here is what it was told to do
    expect(options?.auth).toEqual({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false })
  })

  it('stores nothing in the browser: no session, no storage', async () => {
    const calls: string[] = []
    const store: Storage = {
      get length() {
        return 0
      },
      clear: () => calls.push('clear'),
      getItem: (k: string) => (calls.push(`get:${k}`), null),
      key: () => null,
      removeItem: (k: string) => void calls.push(`remove:${k}`),
      setItem: (k: string) => void calls.push(`set:${k}`),
    }
    vi.stubGlobal('localStorage', store)
    vi.stubGlobal('sessionStorage', store)
    try {
      const { fetch } = fakeFetch(() => json(200, { recorded: true }))
      await supabaseTransport(CONFIG, { fetch }).call('submit_survey', { p_token: 't' })
      await new Promise((r) => setTimeout(r, 20)) // let the client's background start-up run
      expect(calls.filter((c) => c.startsWith('set:'))).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('guarded', () => {
  it('passes a clean call through and refuses one with brief_prefs before the transport sees it', async () => {
    const seen: string[] = []
    const inner: RpcTransport = { call: (fn) => (seen.push(fn), Promise.resolve('ok')) }
    const t = guarded(inner)
    await expect(t.call('a', { x: 1 })).resolves.toBe('ok')
    await expect(t.call('b', { p: { deep: [{ brief_prefs: 1 }] } })).rejects.toMatchObject({ kind: 'local' })
    expect(seen).toEqual(['a'])
  })

  it('drops the character U+0000, which the database refuses, from the strings and keys of every call', async () => {
    const sent: unknown[] = []
    const inner: RpcTransport = { call: (_fn, args) => (sent.push(args), Promise.resolve('ok')) }
    const t = guarded(inner)
    await t.call('submit', { p_token: 't', p_response: 'a\u0000b', p_item_id: 'i:x' })
    await t.call('report_problem', { p_detail: 'one\u0000two' })
    await t.call('mirror_put', { p_save: { sessions: [{ responses: [['i:aut', 0, ['x\u0000', { 'k\u0000': 1 }]]] }] } })
    expect(sent).toEqual([
      { p_token: 't', p_response: 'ab', p_item_id: 'i:x' },
      { p_detail: 'onetwo' },
      { p_save: { sessions: [{ responses: [['i:aut', 0, ['x', { k: 1 }]]] }] } },
    ])
    // a call with none is passed on as the same object
    const args = { p_token: 't', p_response: 3 }
    await t.call('submit', args)
    expect(sent.at(-1)).toBe(args)
  })

  it('reads a notes key spelled with the character as the notes key, and refuses it', async () => {
    const inner: RpcTransport = { call: () => Promise.resolve('ok') }
    await expect(guarded(inner).call('mirror_put', { p_save: { ['brief_\u0000prefs']: 1 } })).rejects.toMatchObject({ kind: 'local', code: 'brief_prefs_in_payload' })
  })

  it('refuses, instead of throwing, a payload too deep to clean', async () => {
    let deep: unknown = { s: 'x\u0000' }
    for (let i = 0; i < 400; i++) deep = { next: deep }
    const inner: RpcTransport = { call: () => Promise.resolve('ok') }
    await expect(guarded(inner).call('mirror_put', { p_save: deep })).rejects.toMatchObject({ kind: 'local', code: 'payload_too_deep' })
  })
})
