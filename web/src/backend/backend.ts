/**
 * The server the running app talks to, if there is one (ROADMAP M2.7): the typed API over the
 * supabase-js transport of a configured project, and the opening of a session. The session flow
 * gets a {@link Backend} or null from its environment (`session/env.ts`); null is the static
 * fallback, the default build, which never imports any of this beyond the types.
 */

import type { AxisCode } from '../engine/axes'
import type { DeviceInfo, SaveFileV1 } from '../save/types'
import { createBackendApi, type ApiOptions, type BackendApi } from './api'
import { browserBackend, type BackendConfig, type BackendSelection } from './config'
import { ServerSession } from './session'
import { supabaseTransport, type RpcTransport } from './transport'

export interface Backend {
  readonly api: BackendApi
  /** The project's host name, for the one place the app says where the data goes (the privacy page). */
  readonly host: string
  /**
   * The skills the server has live questions for (`public.live_axes`; ROADMAP M3.11), asked once per page and kept:
   * a session plans its served parts (`engine/plan-table.ts` TEXT_PARTS) from it, and the welcome screen words the
   * session's length from it. Null when the server could not say (a failed call, which the next call tries again):
   * the session is then the six parts of M1 and the welcome screen says no length. No build variable names them
   * (owner, 2026-10-13: edits go live on push, no switches of their own).
   */
  liveAxes(): Promise<readonly AxisCode[] | null>
  /**
   * Opens a session for a person who passed the gate. `save` (the one the session starts from, if any)
   * lets the server continue its anon_id and leave out the items it already holds (R-8.1, §7.7).
   */
  open(device: DeviceInfo, save: SaveFileV1 | null): Promise<ServerSession>
}

export interface BackendDeps {
  /** Replaces the supabase-js transport (tests). */
  readonly transport?: RpcTransport
  readonly api?: ApiOptions
}

/** {@link Backend.liveAxes} over `api`: one call while it succeeds, a new one after a failure. */
export function liveAxesOnce(api: Pick<BackendApi, 'liveAxes'>): () => Promise<readonly AxisCode[] | null> {
  let kept: Promise<readonly AxisCode[]> | null = null
  return async () => {
    kept ??= api.liveAxes()
    try {
      return await kept
    } catch {
      kept = null
      return null
    }
  }
}

export function createBackend(config: BackendConfig, deps: BackendDeps = {}): Backend {
  const api = createBackendApi(deps.transport ?? supabaseTransport(config), deps.api)
  return {
    api,
    host: new URL(config.url).host,
    liveAxes: liveAxesOnce(api),
    open: (device, save) => ServerSession.start(api, device, save),
  }
}

/** The backend of a selection: null for the static fallback. */
export function backendOf(selection: BackendSelection, deps: BackendDeps = {}): Backend | null {
  return selection.kind === 'server' ? createBackend(selection.config, deps) : null
}

/** The backend of the running page (the build's variables and, in dev and tests, `?hb_backend=`). */
export function pageBackend(): Backend | null {
  // The constant is false in a plain production build: everything below is then dead code, and the
  // static fallback ships none of the client (`scripts/backend-bundle.test.ts`).
  if (!__HB_BACKEND__) return null
  return backendOf(browserBackend())
}
