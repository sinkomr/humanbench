/// <reference types="vite/client" />
/**
 * The real sentence embedder of the Alternative Uses Task (ROADMAP M6.4, DESIGN §5.4): the
 * all-MiniLM-L6-v2 model, 8-bit quantised (about 23 MB), run in the browser with Transformers.js
 * and ONNX Runtime Web. Zero API cost, and embedding never sends a text anywhere (DESIGN §8).
 *
 * **Lazy.** Importing this module costs a few kB. `@huggingface/transformers` (about 1.3 MB of code
 * plus the ONNX wasm) is loaded with a dynamic `import()` the first time {@link loadMiniLmEmbedder}
 * runs, so a session that never reaches the task never downloads any of it. There is no static
 * import of the library anywhere in `src/` (`scripts/aut-bundle.test.ts`). Everything the library
 * returns is used through the small structural types below, so the app's types do not depend on it.
 *
 * **What is downloaded, and from where.**
 * - The model files (`config.json`, `tokenizer.json`, `tokenizer_config.json`,
 *   `onnx/model_quantized.onnx`, about 23.7 MB in all) come from the Hugging Face hub by default.
 *   That is data only: the hub sees a request for public files (and the visitor's IP address and the
 *   page's origin, as any host would), never a response or a score. A deploy that does not want even
 *   that sets `VITE_HB_EMBED_MODEL_BASE` at build time to a folder it hosts itself (see
 *   {@link resolveModelBase}).
 * - The ONNX Runtime wasm (about 14 MB, `ort-wasm-simd-threaded.wasm`) and its small JS loader are
 *   part of this site's own build: Vite emits them as hashed assets and this module points the
 *   runtime at them, instead of the library's default (jsDelivr). Only the plain CPU build is
 *   shipped, because the model runs on the wasm backend (`device: 'wasm'`); the 27 MB WebGPU
 *   ("asyncify") build the library would otherwise pick is neither shipped nor needed.
 * - Both are fetched once: Transformers.js keeps them in the browser's Cache API (`transformers-cache`),
 *   so later visits read them from disk. The progress callback covers the model files only; the wasm
 *   (fetched just before the model starts) is not in the totals, so a bar that reaches 100% may be
 *   followed by a short "preparing" wait the first time.
 * - The wasm runs on one thread: a GitHub Pages site is not cross-origin isolated, and the model
 *   (22 M parameters, responses of a dozen words) does not need more.
 *
 * **Loads are shared.** There is at most one load at a time and at most one embedder per page:
 * callers that ask while a load runs join it (each with its own `onProgress` and `signal`), and
 * once it has succeeded later calls return the same embedder. A load is cancelled (the downloads are
 * aborted) when every caller waiting for it has aborted.
 */

import { isLoopbackHost } from '../../backend/config'
import { EmbedderLoadError, l2Normalise, type Embedder, type LoadProgress } from './embedder'

export const MINILM_MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
const MINILM_DIM = 384
/** Texts per forward pass: bounds memory for long lists while keeping the per-call overhead small. */
const BATCH_SIZE = 16
/** Used once at load, to prove the model runs and has the expected output shape before the caller gets it. */
const WARM_UP_TEXT = 'a use for a brick'

/* ------------------------------------------------------------------ model base */

declare global {
  /** The build-time variable this module reads, declared where Vite's `import.meta.env` is typed (like `BackendEnv` in `backend/config.ts`). */
  interface ImportMetaEnv {
    /**
     * Where a self-hosting deploy keeps the model files: a folder URL (absolute `https://…/models/`, or
     * a path such as `/humanbench/models/` on the same site) under which the repository layout is
     * kept, i.e. `<base>Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx`,
     * `<base>Xenova/all-MiniLM-L6-v2/tokenizer.json`, and so on. Unset or empty: the Hugging Face hub.
     */
    readonly VITE_HB_EMBED_MODEL_BASE?: string | undefined
  }
}

/**
 * The absolute folder URL (with a trailing slash) that `VITE_HB_EMBED_MODEL_BASE` names, or null
 * when it is unset or blank (use the hub). `pageHref` is the page's own URL, which a relative value
 * is resolved against and which tells same-site values from others. A malformed value throws an
 * {@link EmbedderLoadError} rather than quietly falling back to the hub: a deploy that asked for
 * self-hosting must not leak requests to a third party because of a typo.
 */
export function resolveModelBase(raw: string | undefined, pageHref?: string): string | null {
  const s = (raw ?? '').trim()
  if (s === '') return null
  const bad = (why: string): EmbedderLoadError => new EmbedderLoadError(`VITE_HB_EMBED_MODEL_BASE (${s}) ${why}`)
  let u: URL
  try {
    u = new URL(s, pageHref)
  } catch {
    throw bad('is not a URL')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw bad('must be an https URL or a path on this site')
  const sameSite = pageHref !== undefined && u.origin === new URL(pageHref).origin
  if (!sameSite && u.protocol !== 'https:' && !isLoopbackHost(u.hostname)) throw bad('must be https (http is allowed only for this site and localhost)')
  if (u.username !== '' || u.password !== '') throw bad('must not contain credentials')
  if (u.search !== '' || u.hash !== '') throw bad('must not have a query or a fragment')
  return u.pathname.endsWith('/') ? u.href : `${u.origin}${u.pathname}/`
}

/* ------------------------------------------------------- the library, structurally */

/** What this module uses of Transformers.js' tensor result. */
interface FeatureTensor {
  readonly data: ArrayLike<number>
  readonly dims: readonly number[]
}

/** What this module uses of a `feature-extraction` pipeline. */
interface Extractor {
  (texts: string[], options: { pooling: 'mean'; normalize: boolean }): Promise<FeatureTensor>
  dispose?(): Promise<unknown> | unknown
}

interface WasmFlags {
  wasmPaths?: unknown
  numThreads?: number
}

/** What this module uses of the library's global `env`. */
interface TfEnv {
  allowLocalModels: boolean
  allowRemoteModels: boolean
  useBrowserCache: boolean
  remoteHost: string
  remotePathTemplate: string
  fetch: (input: string | URL, init?: RequestInit) => Promise<Response>
  backends: { onnx: { wasm?: WasmFlags } }
}

interface TfPipelineOptions {
  dtype: 'q8'
  device: 'wasm'
  progress_callback: (info: unknown) => void
}

interface TfModule {
  env: TfEnv
  pipeline(task: 'feature-extraction', model: string, options: TfPipelineOptions): Promise<Extractor>
}

/* ---------------------------------------------------------------- small helpers */

function abortError(): DOMException {
  return new DOMException('Loading the text model was cancelled.', 'AbortError')
}

const noop = (): void => undefined

/** `p`, but rejecting with an AbortError as soon as `signal` aborts (the work behind `p` is not stopped by this). */
function rejectOnAbort<T>(p: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return p
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(abortError())
    const onAbort = (): void => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Maps the library's aggregate `progress_total` events to {@link LoadProgress}: bytes never go
 * backwards or past the total, an unknown (zero) total is null, and the file most recently named by
 * any event is attached. Per-file events only update that name, so listeners see one stream.
 */
function progressMapper(emit: (p: LoadProgress) => void): (info: unknown) => void {
  let file: string | undefined
  let loaded = 0
  return (info) => {
    if (typeof info !== 'object' || info === null) return
    const i = info as { status?: unknown; file?: unknown; loaded?: unknown; total?: unknown }
    if (typeof i.file === 'string') file = i.file
    if (i.status !== 'progress_total') return
    if (typeof i.loaded !== 'number' || typeof i.total !== 'number' || !Number.isFinite(i.loaded) || !Number.isFinite(i.total)) return
    const total = i.total > 0 ? i.total : null
    loaded = Math.max(loaded, Math.max(0, i.loaded))
    if (total !== null) loaded = Math.min(loaded, total)
    emit(file === undefined ? { loadedBytes: loaded, totalBytes: total } : { loadedBytes: loaded, totalBytes: total, file })
  }
}

/* ----------------------------------------------------------- the embedder itself */

function wrapExtractor(extractor: Extractor): Embedder {
  return {
    modelId: MINILM_MODEL_ID,
    dim: MINILM_DIM,
    async embed(texts) {
      const out: Float32Array[] = []
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE)
        const t = await extractor([...batch], { pooling: 'mean', normalize: true })
        if (t.dims.length !== 2 || t.dims[0] !== batch.length || t.dims[1] !== MINILM_DIM || t.data.length !== batch.length * MINILM_DIM) {
          throw new Error(`the text model returned an unexpected shape [${t.dims.join(', ')}] for ${batch.length} text(s); expected [${batch.length}, ${MINILM_DIM}]`)
        }
        const flat = t.data instanceof Float32Array ? t.data : Float32Array.from(t.data)
        // l2Normalise copies out of the tensor's buffer, and re-normalises so "unit length" holds whatever the runtime did.
        for (let j = 0; j < batch.length; j++) out.push(l2Normalise(flat.subarray(j * MINILM_DIM, (j + 1) * MINILM_DIM)))
      }
      return out
    },
  }
}

/* ------------------------------------------------------------------- the loading */

/** Points ONNX Runtime at the wasm and loader of this site's own build (once per page; see the header). */
async function configureWasm(env: TfEnv): Promise<void> {
  const wasm = env.backends.onnx.wasm
  if (wasm === undefined) return
  // The library's own default is a jsDelivr URL, set when it was imported; replace it before any session exists.
  const [{ default: mjs }, { default: binary }] = await Promise.all([import('onnxruntime-web/ort-wasm-simd-threaded.mjs?url'), import('onnxruntime-web/ort-wasm-simd-threaded.wasm?url')])
  wasm.wasmPaths = { mjs, wasm: binary }
  wasm.numThreads = 1
}

/** Applies the hosting settings to the library's global `env`. */
function configureEnv(env: TfEnv, base: string | null): void {
  env.allowLocalModels = false
  env.allowRemoteModels = true
  env.useBrowserCache = true
  if (base !== null) {
    env.remoteHost = base
    env.remotePathTemplate = '{model}/'
  }
}

let loadedEmbedder: Embedder | null = null
let current: Load | null = null
/** Settles when the last started load is over; the next one starts after it, so `env.fetch` is never wrapped twice. */
let previousOver: Promise<unknown> = Promise.resolve()
let wasmConfigured = false

async function disposeQuietly(extractor: Extractor | null): Promise<void> {
  try {
    await extractor?.dispose?.()
  } catch {
    // Nothing to do about a failed clean-up; the load's own outcome is what counts.
  }
}

async function runLoad(load: Load): Promise<Embedder> {
  const { signal } = load.controller
  // Read synchronously from the constructor, so this is the previous load, not this one.
  await previousOver
  if (signal.aborted) throw abortError()
  let tf: TfModule
  try {
    tf = (await import('@huggingface/transformers')) as unknown as TfModule
  } catch (e) {
    throw new EmbedderLoadError(`The text model's code could not be loaded: ${messageOf(e)}`, { cause: e })
  }
  if (signal.aborted) throw abortError()
  const { env } = tf
  const originalFetch = env.fetch
  let extractor: Extractor | null = null
  try {
    const base = resolveModelBase(import.meta.env.VITE_HB_EMBED_MODEL_BASE, typeof location === 'undefined' ? undefined : location.href)
    configureEnv(env, base)
    if (!wasmConfigured) {
      await configureWasm(env)
      wasmConfigured = true
    }
    // Every request of the library goes through env.fetch, so this is what makes a cancel stop the downloads.
    env.fetch = (input, init) => originalFetch(input, { ...init, signal })
    extractor = await tf.pipeline('feature-extraction', MINILM_MODEL_ID, { dtype: 'q8', device: 'wasm', progress_callback: progressMapper((p) => load.report(p)) })
    if (signal.aborted) throw abortError()
    const embedder = wrapExtractor(extractor)
    // Prove it runs (the wasm starts here) and has the expected shape, so a broken browser fails now, with a clear error.
    await embedder.embed([WARM_UP_TEXT])
    if (signal.aborted) throw abortError()
    return embedder
  } catch (e) {
    await disposeQuietly(extractor)
    if (signal.aborted) throw abortError()
    if (e instanceof EmbedderLoadError) throw e
    throw new EmbedderLoadError(`The text model could not be loaded: ${messageOf(e)}`, { cause: e })
  } finally {
    env.fetch = originalFetch
  }
}

/** One run of the loading, shared by every caller that asked while it was running. */
class Load {
  readonly controller = new AbortController()
  private readonly listeners = new Set<(p: LoadProgress) => void>()
  private last: LoadProgress | null = null
  /** Callers currently waiting for this load. */
  waiting = 0
  settled = false
  readonly promise: Promise<Embedder>

  constructor() {
    this.promise = runLoad(this).then(
      (embedder) => {
        loadedEmbedder = embedder
        this.finish()
        return embedder
      },
      (e: unknown) => {
        this.finish()
        throw e
      },
    )
    // `previousOver` was read by runLoad above, before this line: the next load waits for this one. The
    // handlers also keep a rejection nobody waits for (a cancelled load) from being reported as unhandled.
    previousOver = this.promise.then(noop, noop)
  }

  private finish(): void {
    this.settled = true
    if (current === this) current = null
  }

  join(onProgress: ((p: LoadProgress) => void) | undefined): void {
    this.waiting++
    if (onProgress === undefined) return
    this.listeners.add(onProgress)
    if (this.last !== null) onProgress(this.last)
  }

  leave(onProgress: ((p: LoadProgress) => void) | undefined): void {
    if (onProgress !== undefined) this.listeners.delete(onProgress)
    this.waiting--
    if (this.waiting === 0 && !this.settled) {
      // Nobody wants it any more: stop the downloads, and let a later call start afresh.
      this.controller.abort()
      if (current === this) current = null
    }
  }

  report(p: LoadProgress): void {
    this.last = p
    for (const l of this.listeners) {
      try {
        l(p)
      } catch {
        // A faulty progress listener must not break the load.
      }
    }
  }
}

/**
 * Loads the MiniLM embedder: fetches the model once (the browser keeps it), starts it on the wasm
 * backend and checks that it works. Resolves with an {@link Embedder} whose `embed` runs on the
 * device. Dim 384, `modelId` {@link MINILM_MODEL_ID}.
 *
 * - `onProgress` gets byte counts of the model files while they download (not called for the wasm;
 *   see the header). A late joiner of a running load first gets the latest count.
 * - `signal` aborts the wait: the promise rejects with a `DOMException` named `AbortError`. The
 *   downloads are aborted when no caller is waiting any more.
 * - Every other failure (offline, blocked host, an unsupported browser, a malformed
 *   `VITE_HB_EMBED_MODEL_BASE`) rejects with an {@link EmbedderLoadError}; `cause` has the original.
 *
 * A failed or cancelled load leaves nothing behind: calling again starts a new one.
 */
export async function loadMiniLmEmbedder(opts: { onProgress?: (p: LoadProgress) => void; signal?: AbortSignal } = {}): Promise<Embedder> {
  const { onProgress, signal } = opts
  if (signal?.aborted) throw abortError()
  if (loadedEmbedder !== null) return loadedEmbedder
  const load = current ?? (current = new Load())
  load.join(onProgress)
  try {
    return await rejectOnAbort(load.promise, signal)
  } finally {
    load.leave(onProgress)
  }
}
