/**
 * The loader of the session runtime chunk (`runtime.ts`; UX-100): the same retries, fresh-URL imports and offline rule
 * as the results chunk's (`results-loader.ts`, whose module comment explains them).
 */

import { createChunkLoader, type ChunkLoader, type ChunkLoaderOptions } from './results-loader'

/** The session runtime module (type only: nothing here imports it statically). */
export type SessionRuntime = typeof import('./runtime')
export type RuntimeLoader = ChunkLoader<SessionRuntime>

/** The file name of the runtime chunk in a build (`runtime-<hash>.js`; scripts/results-split.test.ts keeps the two in step). */
export const RUNTIME_CHUNK_FILE = /\/runtime-[\w-]+\.js$/

// ---------------------------------------------------------------------------- copy

/** Heading of the screen that waits for the session code (rarely seen: it is fetched on the welcome screen). */
export const RUNTIME_PENDING_HEADING = 'Getting ready'
/** Status line while the session code is on its way. */
export const RUNTIME_PREPARING = 'Getting your session ready…'
/** The session code did not arrive after the retries. */
export const RUNTIME_FAILED = 'The session could not be loaded. Check the connection and try again.'
export const RUNTIME_RETRY = 'Try again'

/** A loader of the runtime module (see {@link ChunkLoader}). */
export function createRuntimeLoader(opts: ChunkLoaderOptions<SessionRuntime> = {}): RuntimeLoader {
  return createChunkLoader(RUNTIME_CHUNK_FILE, () => import('./runtime'), opts)
}

/** The page's loader: one per page, so the welcome screen's prefetch and Start share the fetch. */
export const runtimeLoader: RuntimeLoader = createRuntimeLoader()

/**
 * Run `task` once the browser is idle (or after `fallbackMs` where there is no `requestIdleCallback`, e.g. WebKit);
 * returns a cancel function. The welcome screen prefetches the runtime this way, so it never competes with first paint.
 */
export function whenIdle(task: () => void, fallbackMs = 1200): () => void {
  const w = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void }
  if (typeof w.requestIdleCallback === 'function' && typeof w.cancelIdleCallback === 'function') {
    const h = w.requestIdleCallback(task, { timeout: 3000 })
    return () => w.cancelIdleCallback!(h)
  }
  const t = setTimeout(task, fallbackMs)
  return () => clearTimeout(t)
}
