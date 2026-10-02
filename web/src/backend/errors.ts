/**
 * What can go wrong between the app and the server (ROADMAP M2.7), in terms the screens act on.
 * The server's own errors are PostgREST errors with an HTTP status taken from the `PT<status>`
 * SQLSTATE the RPCs raise (`hb.fail`: the status in the code, a short `message` such as
 * `item_not_served`, optional `details` text); this module turns them, and the failures of the
 * network, into one {@link BackendError} so that no screen has to read a transport's error shape.
 */

export type BackendErrorKind =
  /** No answer: offline, DNS, a refused connection, CORS. */
  | 'network'
  /** No answer in time. */
  | 'timeout'
  /** The server refused the request as malformed or not allowed (400, 403, 404, 413). Do not repeat it. */
  | 'rejected'
  /** The session token is unknown or expired (401). The session is lost. */
  | 'auth'
  /** The session is already finished (409), or the thing already exists. */
  | 'conflict'
  /** A rate limit or the too-fast rule (429). */
  | 'limited'
  /** The server failed (5xx). */
  | 'server'
  /** The server answered, but not with what the contract says. */
  | 'reply'
  /** The app refused to send: a payload that would have carried the notes settings (AI.26). */
  | 'local'

export class BackendError extends Error {
  readonly kind: BackendErrorKind
  /** HTTP status, or null when there was no response. */
  readonly status: number | null
  /** The server's short code (`message` of the PostgREST error, e.g. `too_fast`), or a local one. */
  readonly code: string
  readonly detail: string | null

  constructor(kind: BackendErrorKind, code: string, options: { readonly status?: number | null; readonly detail?: string | null; readonly cause?: unknown } = {}) {
    super(`${code}${options.detail ? `: ${options.detail}` : ''}`, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'BackendError'
    this.kind = kind
    this.status = options.status ?? null
    this.code = code
    this.detail = options.detail ?? null
  }

  /** Worth repeating the same call: the network or the server failed, not the request. */
  get retryable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || (this.kind === 'server' && (this.status === 500 || this.status === 502 || this.status === 503 || this.status === 504))
  }
}

export const isBackendError = (e: unknown): e is BackendError => e instanceof BackendError

/** The kind an HTTP status means. */
export function kindOfStatus(status: number): BackendErrorKind {
  if (status === 401) return 'auth'
  if (status === 409) return 'conflict'
  if (status === 429) return 'limited'
  if (status >= 500) return 'server'
  return 'rejected'
}

/** The shape of a PostgREST error body as supabase-js hands it over (`error`). */
export interface PostgrestLikeError {
  readonly message?: unknown
  readonly details?: unknown
  readonly hint?: unknown
  readonly code?: unknown
}

/**
 * The {@link BackendError} for a failed RPC. `status` is the HTTP status when there was a response
 * (0 or null when there was none). A short snake_case `message` is the server's own code; anything
 * else (a fetch failure's "TypeError: Failed to fetch", a gateway's HTML) is not shown to a person,
 * and the code becomes the generic one for its kind.
 */
export function backendErrorFrom(error: PostgrestLikeError, status: number | null): BackendError {
  const message = typeof error.message === 'string' ? error.message : ''
  const detail = typeof error.details === 'string' && error.details !== '' ? error.details : null
  const serverCode = /^[a-z][a-z0-9_]{1,63}$/u.test(message) ? message : null
  if (status === null || status === 0) {
    const aborted = /abort|timeout/iu.test(message)
    return new BackendError(aborted ? 'timeout' : 'network', aborted ? 'timeout' : 'network_error', { status: null })
  }
  const kind = kindOfStatus(status)
  return new BackendError(kind, serverCode ?? (kind === 'server' ? 'server_error' : 'request_failed'), { status, detail })
}

/**
 * Why a served part of a session is waiting (ROADMAP M2.7), in the terms the screen acts on:
 * `offline` the network or the server did not answer (try again), `pace` the server asked for more
 * time per question (`too_fast`, DESIGN §11.2; try again after a moment), `busy` a rate limit
 * (try again later), `ended` the server session is gone or cannot take the call (expired, closed,
 * refused): the part cannot go on and the person can finish with what there is.
 */
export type LoadProblem = 'offline' | 'pace' | 'busy' | 'ended'

export function problemOf(e: unknown): LoadProblem {
  if (!(e instanceof BackendError)) return 'offline'
  switch (e.kind) {
    case 'network':
    case 'timeout':
    case 'server':
      return 'offline'
    case 'limited':
      return e.code === 'too_fast' ? 'pace' : 'busy'
    default:
      return 'ended'
  }
}
