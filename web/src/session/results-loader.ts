/**
 * The results code out of the entry chunk (UX-100; DESIGN §10 reveal flow, §8 save). The end of a session
 * (`Finished.svelte`: the reveal, the profile drawings with D3, the share card, the worked examples) is the
 * heaviest part of the app and the welcome screen needs none of it, so it is its own chunk, fetched while the
 * person is on the ready screen (or at the latest when a run or a practice round starts), and normally in
 * memory long before the results are due.
 *
 * Results must never be lost to a chunk that does not load (a phone that went offline mid-session, a deploy
 * that replaced the hashed file). The run is in the autosave already; this loader retries with backoff, and
 * the flow (`SessionApp.svelte`) shows "Try again" and "Download my save file" (save code that is in the
 * entry chunk) when it still fails, with the leave-guard on until the save is downloaded.
 *
 * Two browser habits make a plain retry of `import()` useless, and the loader works around both:
 * - A failed module fetch stays failed in the module map: importing the same URL again fails at once without
 *   touching the network (Chromium always; WebKit after a failed `<link rel="modulepreload">`, which Vite's
 *   preload helper adds for the chunk). A retry therefore imports the chunk's URL with a fresh query
 *   (`?retry=n`), a new module-map entry. The URL comes from Chromium's error message, or from the failed
 *   modulepreload link of the chunk (`RESULTS_CHUNK_FILE`; WebKit's error names no URL). Without either (a
 *   WebKit without modulepreload) the same import is retried, which WebKit then fetches again.
 * - Vite's preload helper adds the chunk's stylesheet once per page: a stylesheet that failed is never asked
 *   for again, and the results would come up unstyled. Failed stylesheets are watched and added afresh
 *   before each retry.
 * - A failed fetch of a chunk the results chunk imports (one it shares with the notes page) stays failed in
 *   both engines, and no fresh URL reaches it. So no attempt is made while the browser knows it is offline
 *   (`navigator.onLine`): the module map is not spoiled, and the attempt after the connection is back works.
 *   A dependency that fails while the browser thinks it is online is the one case only a reload mends; the
 *   fallback's download keeps the results then.
 *
 * The user-facing words of the waiting and failure states are here, not in `copy.ts` (A13: plain and
 * non-diagnostic).
 */

/** The results module (type only: nothing here imports it statically). */
export type ResultsModule = typeof import('./Finished.svelte')
/** The results component. */
export type ResultsComponent = ResultsModule['default']

// ---------------------------------------------------------------------------- copy

/** Heading of the screen that waits for the results code or offers the fallback (rarely seen). */
export const RESULTS_PENDING_HEADING = 'Your results'
/** Status line while the results code is still on its way. */
export const RESULTS_PREPARING = 'Preparing your results…'
/** The results code did not arrive after the retries. */
export const RESULTS_FAILED =
  'Your results could not be loaded. Your answers are not lost: check the connection and try again, or download your save file to keep them.'
export const RESULTS_RETRY = 'Try again'
export const RESULTS_DOWNLOAD = 'Download my save file'
/** After the fallback's download: where the file went and what it is for. */
export const resultsDownloaded = (name: string): string => `Downloaded ${name}. Load it on the ready screen later to see your results.`

// ---------------------------------------------------------------------------- loader

/** Waits between attempts: four attempts over about five seconds, then the fallback. */
export const RETRY_DELAYS_MS: readonly number[] = [500, 1500, 3500]

export interface ResultsLoader {
  /** The module once it has loaded, else null: a screen that has it renders it at once, with no waiting state. */
  current(): ResultsModule | null
  /**
   * Load the module. Memoised: while an attempt is under way, and after success, every call gets the same
   * promise. An attempt retries after each delay of {@link RETRY_DELAYS_MS}; when the last retry fails the
   * promise rejects and the memo is cleared, so the next call (the "Try again" button, or the next phase that
   * prefetches) starts afresh.
   */
  load(): Promise<ResultsModule>
}

export interface ResultsLoaderOptions {
  /** The import of the results chunk (through Vite's preload helper in a build). */
  readonly importer?: () => Promise<ResultsModule>
  /** An import by URL, for the cache-busting retry in Chromium (default: a native dynamic import). */
  readonly importUrl?: (url: string) => Promise<ResultsModule>
  readonly delays?: readonly number[]
  readonly sleep?: (ms: number) => Promise<void>
  /** Called before each retry; default: add again the stylesheets that failed to load. */
  readonly beforeRetry?: () => Promise<void>
  /** Where the page is, to keep the retry import same-origin (default `location.href`). */
  readonly baseUrl?: () => string
  /** Whether the browser thinks it is online (default `navigator.onLine`); no attempt is made while it is not. */
  readonly online?: () => boolean
  /** The URL of the results chunk if its modulepreload failed, else null (default: from the watched links). */
  readonly failedChunk?: () => string | null
}

/**
 * The file name of the results chunk in a build: Rolldown names a dynamic chunk after its module
 * (`Finished-<hash>.js`; scripts/results-split.test.ts keeps the two in step).
 */
export const RESULTS_CHUNK_FILE = /\/Finished-[\w-]+\.js$/

/** The error of an attempt that was not made because the browser is offline. */
export class OfflineError extends Error {
  constructor() {
    super('offline: the results code was not requested')
    this.name = 'OfflineError'
  }
}

const browserOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false

/**
 * The URL of the module a failed dynamic import names (Chromium, Firefox), without its query; null when the
 * error names none (WebKit) or names another origin or something that is not a script.
 */
export function failedModuleUrl(error: unknown, base: string): string | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const m = /(https?:\/\/[^\s'"?#]+\.js)/.exec(message)
  if (m === null) return null
  try {
    const url = new URL(m[1] as string)
    return url.origin === new URL(base).origin ? url.href : null
  } catch {
    return null
  }
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Stylesheets whose load failed, collected from the page's `error` events (they do not bubble: capture: `watchLinks`). */
const failedSheets = new Set<HTMLLinkElement>()
/** URLs of modulepreload links whose fetch failed. */
const failedPreloads = new Set<string>()
let watching = false

/** The URL (without its query) of the results chunk's modulepreload link if it failed, else null. */
export function failedChunkPreload(): string | null {
  for (const href of failedPreloads) {
    const url = href.split(/[?#]/)[0] as string
    if (RESULTS_CHUNK_FILE.test(url)) return url
  }
  return null
}

function watchLinks(): void {
  if (watching || typeof document === 'undefined') return
  watching = true
  document.addEventListener(
    'error',
    (event) => {
      const t = event.target
      if (!(t instanceof HTMLLinkElement)) return
      if (t.rel === 'stylesheet') failedSheets.add(t)
      else if (t.rel === 'modulepreload') failedPreloads.add(t.href)
    },
    true,
  )
}

/** Add every stylesheet that failed again (a fresh element), and wait for it; rejects if one fails again. */
export async function restyleFailed(): Promise<void> {
  const links = [...failedSheets].filter((l) => l.isConnected)
  failedSheets.clear()
  await Promise.all(
    links.map(
      (old) =>
        new Promise<void>((resolve, reject) => {
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          if (old.crossOrigin !== null) link.crossOrigin = old.crossOrigin
          link.href = old.href
          link.addEventListener('load', () => {
            old.remove()
            resolve()
          })
          link.addEventListener('error', () => {
            failedSheets.delete(link)
            failedSheets.add(old)
            link.remove()
            reject(new Error(`stylesheet ${old.href} failed to load`))
          })
          old.after(link)
        }),
    ),
  )
}

/** A loader of the results module (see {@link ResultsLoader}). */
export function createResultsLoader(opts: ResultsLoaderOptions = {}): ResultsLoader {
  const importer = opts.importer ?? (() => import('./Finished.svelte'))
  const importUrl = opts.importUrl ?? ((url: string) => import(/* @vite-ignore */ url) as Promise<ResultsModule>)
  const delays = opts.delays ?? RETRY_DELAYS_MS
  const sleep = opts.sleep ?? realSleep
  const beforeRetry = opts.beforeRetry ?? restyleFailed
  const baseUrl = opts.baseUrl ?? (() => (typeof location === 'undefined' ? 'http://localhost/' : location.href))
  const online = opts.online ?? browserOnline
  const failedChunk = opts.failedChunk ?? failedChunkPreload
  if (opts.beforeRetry === undefined || opts.failedChunk === undefined) watchLinks()

  let module: ResultsModule | null = null
  let pending: Promise<ResultsModule> | null = null
  /** The chunk's URL once an error has named it, and how many retries went to it (each a fresh URL). */
  let chunkUrl: string | null = null
  let bust = 0
  let attempts = 0

  const once = async (): Promise<ResultsModule> => {
    if (!online()) throw new OfflineError()
    const first = attempts++ === 0
    if (!first) {
      await beforeRetry()
      chunkUrl ??= failedChunk()
    }
    try {
      return chunkUrl === null ? await importer() : await importUrl(`${chunkUrl}?retry=${++bust}`)
    } catch (error) {
      // Only the results chunk is ever imported under a fresh URL: a name that is not its file is not used.
      const named = failedModuleUrl(error, baseUrl())
      if (named !== null && RESULTS_CHUNK_FILE.test(named)) chunkUrl = named
      throw error
    }
  }

  const attempt = async (): Promise<ResultsModule> => {
    for (let i = 0; ; i++) {
      try {
        return await once()
      } catch (error) {
        const wait = delays[i]
        if (wait === undefined) throw error
        await sleep(wait)
      }
    }
  }

  return {
    current: () => module,
    load(): Promise<ResultsModule> {
      if (module !== null) return Promise.resolve(module)
      pending ??= attempt().then(
        (m) => {
          module = m
          return m
        },
        (error: unknown) => {
          pending = null
          throw error
        },
      )
      return pending
    },
  }
}

/** The page's loader: one per page, so every screen that needs the results shares the fetch. */
export const resultsLoader: ResultsLoader = createResultsLoader()
