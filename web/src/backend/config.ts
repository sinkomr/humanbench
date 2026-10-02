/**
 * Which server the app talks to, if any (ROADMAP M2.7; DESIGN §11.2, §11.7; ROADMAP A6).
 *
 * The default build has no server: with `VITE_HB_SUPABASE_URL` unset the app is the static MVP of
 * M1, exactly as before, and a test run of the whole e2e suite against it must pass unchanged
 * (the static fallback). A deploy that has a Supabase project (M2.6, the user's) sets
 *
 *     VITE_HB_SUPABASE_URL=https://<project>.supabase.co
 *     VITE_HB_SUPABASE_ANON_KEY=<the project's anon / publishable key>
 *
 * at build time. The anon key is public by design: RLS denies every table to it and the only
 * thing it can do is call the whitelisted RPCs (DESIGN §11.2, R-12.1). Nothing else is ever
 * configured here, and the service-role key must never be given to the front end (CLAUDE.md).
 *
 * The page cannot be pointed at another server by its link in a production build (that would let a
 * crafted link send a person's answers to a stranger). In dev, in tests and in the Playwright
 * build (`__HB_DEV_ROUTES__`), `?hb_backend=<url>&hb_key=<key>` selects a server for that page
 * load (the e2e suite uses it with a fake one), and `?hb_backend=off` forces the static fallback.
 *
 * A half-set or malformed pair does not break the app: it falls back to static and reports the
 * problem (the console, in dev), because a person who opens a mistaken deploy still gets a working
 * test that keeps everything on their device, which is what the static copy says.
 */

export interface BackendConfig {
  /** The project URL without a trailing slash (`https://<project>.supabase.co`). */
  readonly url: string
  /** The anon / publishable key. Public. */
  readonly anonKey: string
}

export type BackendSelection =
  | { readonly kind: 'static'; readonly problem?: string }
  | { readonly kind: 'server'; readonly config: BackendConfig; readonly origin: 'build' | 'override' }

/** The build-time variables this module reads (`import.meta.env`). */
export interface BackendEnv {
  readonly VITE_HB_SUPABASE_URL?: string | undefined
  readonly VITE_HB_SUPABASE_ANON_KEY?: string | undefined
}

export interface SelectOptions {
  /** True where `?hb_backend=` is honoured: dev and test builds only (`__HB_DEV_ROUTES__`). */
  readonly override: boolean
  /** True where the server client is part of the build (`__HB_BACKEND__`); false forces static. */
  readonly compiledIn: boolean
}

const MAX_URL_LENGTH = 200
const MAX_KEY_LENGTH = 4096
/** JWTs (base64url and dots) and `sb_publishable_…` keys: nothing that could break out of a header. */
const KEY_RE = /^[A-Za-z0-9._-]+$/u

/** Hosts for which plain `http:` is allowed: a server on the same machine (local development and tests). */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '[::1]'
}

/** Why `url` is not an acceptable server URL, or null when it is. */
export function urlProblem(url: string): string | null {
  if (url.length === 0 || url.length > MAX_URL_LENGTH) return 'the server URL is empty or too long'
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return 'the server URL is not a URL'
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLoopbackHost(u.hostname))) return 'the server URL must be https (http is allowed only for localhost)'
  if (u.username !== '' || u.password !== '') return 'the server URL must not contain credentials'
  if (u.search !== '' || u.hash !== '') return 'the server URL must not have a query or a fragment'
  return null
}

/** Why `key` is not an acceptable anon key, or null when it is. */
export function keyProblem(key: string): string | null {
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) return 'the anon key is empty or too long'
  if (!KEY_RE.test(key)) return 'the anon key has characters a key never has'
  return null
}

/** The URL without a trailing slash, for appending `/rest/v1/...`. */
export function normaliseUrl(url: string): string {
  return url.replace(/\/+$/u, '')
}

function pair(url: string | undefined, key: string | undefined): BackendConfig | { readonly problem: string } | null {
  const u = (url ?? '').trim()
  const k = (key ?? '').trim()
  if (u === '' && k === '') return null
  if (u === '' || k === '') return { problem: 'both the server URL and the anon key must be set' }
  const problem = urlProblem(u) ?? keyProblem(k)
  return problem !== null ? { problem } : { url: normaliseUrl(u), anonKey: k }
}

/**
 * The app's backend for this page load. `search` is `location.search`. Never throws: any problem
 * with the configuration is a static selection that carries the reason.
 */
export function selectBackend(env: BackendEnv, search: string, opts: SelectOptions): BackendSelection {
  if (!opts.compiledIn) return { kind: 'static' }
  if (opts.override) {
    const params = new URLSearchParams(search)
    const asked = params.get('hb_backend')
    if (asked === 'off') return { kind: 'static' }
    if (asked !== null) {
      const o = pair(asked, params.get('hb_key') ?? undefined)
      if (o === null) return { kind: 'static' }
      return 'problem' in o ? { kind: 'static', problem: o.problem } : { kind: 'server', config: o, origin: 'override' }
    }
  }
  const b = pair(env.VITE_HB_SUPABASE_URL, env.VITE_HB_SUPABASE_ANON_KEY)
  if (b === null) return { kind: 'static' }
  return 'problem' in b ? { kind: 'static', problem: b.problem } : { kind: 'server', config: b, origin: 'build' }
}

/** The selection of the running page: the build's variables, the dev override and the compile-time flags. */
export function browserBackend(search: string = typeof location === 'undefined' ? '' : location.search): BackendSelection {
  // `import.meta.env` is Vite's; read through a cast so the scripts' type check (which has no Vite types) can import this module too.
  const env = (import.meta as ImportMeta & { readonly env?: BackendEnv }).env ?? {}
  const sel = selectBackend(env, search, { override: __HB_DEV_ROUTES__, compiledIn: __HB_BACKEND__ })
  if (sel.kind === 'static' && sel.problem !== undefined && typeof console !== 'undefined') console.warn(`HumanBench: running without a server: ${sel.problem}.`)
  return sel
}
