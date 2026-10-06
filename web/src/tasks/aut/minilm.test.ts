/**
 * `minilm.ts` against a stand-in for `@huggingface/transformers` (a `vi.mock`): no test here downloads
 * a model, starts ONNX Runtime or reaches the network. What the real library does with these calls
 * (model files, the wasm, quantised inference) is covered by `scripts/aut-bundle.test.ts` (what the
 * build ships, and where) and by the manual run recorded in the work package's report.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { LoadProgress } from './embedder'

interface FakeTensor {
  data: Float32Array
  dims: number[]
}

/** A mock whose parameter types each test sets for itself (a `Mock<(a: string) => …>` is not assignable to `Mock<(...args: unknown[]) => …>`). */
type LooseMock = Mock<(...args: any[]) => unknown>

const h = vi.hoisted(() => {
  const state = {
    /** How many times the mocked module's factory ran: once per real import of the library. */
    factoryCalls: 0,
    /** Makes the import of the library itself fail. */
    importError: null as Error | null,
    pipeline: undefined as unknown as LooseMock,
    originalFetch: undefined as unknown as LooseMock,
    /** One object for the whole file (the library's `env` is a singleton too); `beforeEach` puts its fields back. */
    env: {} as Record<string, unknown> & { backends: { onnx: { wasm: Record<string, unknown> } } },
  }
  return state
})

/** The stand-in module; registered afresh by `freshModule`, so its factory runs once per import of the "library". */
function libraryFactory(): Record<string, unknown> {
  h.factoryCalls++
  if (h.importError !== null) throw h.importError
  return { pipeline: (...args: unknown[]) => h.pipeline(...args), env: h.env }
}
vi.mock('onnxruntime-web/ort-wasm-simd-threaded.mjs?url', () => ({ default: '/assets/ort-wasm-simd-threaded-abc123.mjs' }))
vi.mock('onnxruntime-web/ort-wasm-simd-threaded.wasm?url', () => ({ default: '/assets/ort-wasm-simd-threaded-def456.wasm' }))

const DIM = 384

/**
 * A fake `feature-extraction` pipeline: row r of a call gets value (seed + r + 1) in its first component
 * and 0.5 in the others, i.e. deliberately NOT unit length, so the tests see the module normalise it.
 */
function makeExtractor(seed = 0) {
  const calls: { texts: string[]; options: unknown }[] = []
  const fn = Object.assign(
    vi.fn(async (texts: string[], options: unknown): Promise<FakeTensor> => {
      calls.push({ texts: [...texts], options })
      const data = new Float32Array(texts.length * DIM).fill(0.5)
      for (let r = 0; r < texts.length; r++) data[r * DIM] = seed + r + 1
      return { data, dims: [texts.length, DIM] }
    }),
    { dispose: vi.fn(async () => undefined), calls },
  )
  return fn
}

/** A `fetch` that, like the real one, rejects with an AbortError when its signal aborts. */
function abortableFetch() {
  return vi.fn(
    (_input: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        const s = init?.signal
        if (s?.aborted) return reject(new DOMException('aborted', 'AbortError'))
        s?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      }),
  )
}

type Minilm = typeof import('./minilm') & { EmbedderLoadError: typeof import('./embedder').EmbedderLoadError }
/**
 * The module under test with its state (the loaded embedder, the load in flight) reset, and the
 * `EmbedderLoadError` class of that same module graph (a class from the graph the test file itself
 * imported would not be `instanceof`-equal).
 */
async function freshModule(): Promise<Minilm> {
  vi.resetModules()
  vi.doMock('@huggingface/transformers', libraryFactory)
  const [minilm, embedder] = await Promise.all([import('./minilm'), import('./embedder')])
  return Object.assign({}, minilm, { EmbedderLoadError: embedder.EmbedderLoadError })
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

const norm = (v: Float32Array): number => Math.sqrt(v.reduce((s, x) => s + x * x, 0))

beforeEach(() => {
  h.factoryCalls = 0
  h.importError = null
  h.originalFetch = vi.fn(async () => new Response('ok'))
  for (const k of Object.keys(h.env)) delete h.env[k]
  Object.assign(h.env, {
    allowLocalModels: true,
    allowRemoteModels: false,
    useBrowserCache: false,
    remoteHost: 'https://huggingface.co/',
    remotePathTemplate: '{model}/resolve/{revision}/',
    fetch: h.originalFetch,
    backends: { onnx: { wasm: { wasmPaths: { mjs: 'https://cdn.jsdelivr.net/default.mjs', wasm: 'https://cdn.jsdelivr.net/default.wasm' } } } },
  })
  h.pipeline = vi.fn(async () => makeExtractor())
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('laziness', () => {
  it('importing minilm.ts (or embedder.ts) does not import the library; only loadMiniLmEmbedder does', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const m = await freshModule()
    await import('./embedder')
    expect(m.MINILM_MODEL_ID).toBe('Xenova/all-MiniLM-L6-v2')
    expect(typeof m.loadMiniLmEmbedder).toBe('function')
    expect(h.factoryCalls).toBe(0)
    expect(h.pipeline).not.toHaveBeenCalled()
    await m.loadMiniLmEmbedder()
    expect(h.factoryCalls).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a call that is already aborted does not import the library either', async () => {
    const m = await freshModule()
    const c = new AbortController()
    c.abort()
    await expect(m.loadMiniLmEmbedder({ signal: c.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(h.factoryCalls).toBe(0)
  })
})

describe('what it asks the library for', () => {
  it('builds a feature-extraction pipeline for Xenova/all-MiniLM-L6-v2 with the 8-bit weights on the wasm backend', async () => {
    const m = await freshModule()
    await m.loadMiniLmEmbedder()
    expect(h.pipeline).toHaveBeenCalledTimes(1)
    const [task, model, options] = h.pipeline.mock.calls[0] as [string, string, Record<string, unknown>]
    expect(task).toBe('feature-extraction')
    expect(model).toBe('Xenova/all-MiniLM-L6-v2')
    expect(model).toBe(m.MINILM_MODEL_ID)
    expect(options).toMatchObject({ dtype: 'q8', device: 'wasm' })
    expect(typeof options.progress_callback).toBe('function')
  })

  it('embeds with mean pooling and normalize true, and hands back dim 384, modelId and unit vectors', async () => {
    const extractor = makeExtractor()
    h.pipeline = vi.fn(async () => extractor)
    const m = await freshModule()
    const e = await m.loadMiniLmEmbedder()
    expect(e.modelId).toBe('Xenova/all-MiniLM-L6-v2')
    expect(e.dim).toBe(384)
    extractor.calls.length = 0 // the load's own check
    const out = await e.embed(['brick', 'a doorstop'])
    expect(extractor.calls).toEqual([{ texts: ['brick', 'a doorstop'], options: { pooling: 'mean', normalize: true } }])
    expect(out).toHaveLength(2)
    for (const v of out) {
      expect(v).toBeInstanceOf(Float32Array)
      expect(v).toHaveLength(384)
      expect(norm(v)).toBeCloseTo(1, 5)
    }
    // in order: row 0 is the first text (value 1 in component 0), row 1 the second (value 2)
    expect((out[0] as Float32Array)[0]).toBeLessThan((out[1] as Float32Array)[0] as number)
  })

  it('runs the model once at load, so a broken runtime fails there', async () => {
    const extractor = makeExtractor()
    h.pipeline = vi.fn(async () => extractor)
    const m = await freshModule()
    await m.loadMiniLmEmbedder()
    expect(extractor.calls).toHaveLength(1)
    expect(extractor.calls[0]?.options).toEqual({ pooling: 'mean', normalize: true })
  })

  it('gives each text its own row and splits long lists into batches of 16, keeping the order', async () => {
    const extractor = makeExtractor()
    h.pipeline = vi.fn(async () => extractor)
    const m = await freshModule()
    const e = await m.loadMiniLmEmbedder()
    extractor.calls.length = 0
    const texts = Array.from({ length: 40 }, (_, i) => `text ${i}`)
    const out = await e.embed(texts)
    expect(extractor.calls.map((c) => c.texts.length)).toEqual([16, 16, 8])
    expect(extractor.calls.flatMap((c) => c.texts)).toEqual(texts)
    expect(out).toHaveLength(40)
    // component 0 of row r in a batch is r + 1 before normalising, so within a batch it grows with the row
    for (const start of [0, 16, 32]) {
      const n = Math.min(16, 40 - start)
      for (let r = 1; r < n; r++) expect((out[start + r] as Float32Array)[0]).toBeGreaterThan((out[start + r - 1] as Float32Array)[0] as number)
    }
    expect(await e.embed([])).toEqual([])
    expect(extractor.calls).toHaveLength(3)
  })

  it('returns arrays the caller owns: not views of the library tensor', async () => {
    const buffer = new Float32Array(DIM).fill(0.5)
    buffer[0] = 3
    const extractor = vi.fn(async () => ({ data: buffer, dims: [1, DIM] }))
    h.pipeline = vi.fn(async () => extractor)
    const m = await freshModule()
    const e = await m.loadMiniLmEmbedder()
    const [v] = await e.embed(['x'])
    expect((v as Float32Array).buffer).not.toBe(buffer.buffer)
    ;(v as Float32Array).fill(0)
    expect(buffer[0]).toBe(3)
  })

  it('rejects an embed whose result has the wrong shape', async () => {
    let bad = false
    const extractor = vi.fn(async (texts: string[]) => (bad ? { data: new Float32Array(texts.length * 128), dims: [texts.length, 128] } : { data: new Float32Array(texts.length * DIM).fill(1), dims: [texts.length, DIM] }))
    h.pipeline = vi.fn(async () => extractor)
    const m = await freshModule()
    const e = await m.loadMiniLmEmbedder()
    bad = true
    await expect(e.embed(['x'])).rejects.toThrow(/unexpected shape \[1, 128\]/)
  })

  it('sets the hosting options on the library: remote files only, browser cache on, our own wasm and loader on one thread', async () => {
    const m = await freshModule()
    await m.loadMiniLmEmbedder()
    expect(h.env).toMatchObject({ allowLocalModels: false, allowRemoteModels: true, useBrowserCache: true, remoteHost: 'https://huggingface.co/', remotePathTemplate: '{model}/resolve/{revision}/' })
    expect(h.env.backends.onnx.wasm).toEqual({
      wasmPaths: { mjs: '/assets/ort-wasm-simd-threaded-abc123.mjs', wasm: '/assets/ort-wasm-simd-threaded-def456.wasm' },
      numThreads: 1,
    })
    // and the library's CDN default is gone
    expect(JSON.stringify(h.env.backends.onnx.wasm)).not.toContain('jsdelivr')
  })

  it('works when the library offers no wasm settings (nothing to configure)', async () => {
    h.env.backends.onnx = {} as { wasm: Record<string, unknown> }
    const m = await freshModule()
    await expect(m.loadMiniLmEmbedder()).resolves.toMatchObject({ dim: 384 })
  })

  it('configures the wasm once per page, across loads that fail and loads that succeed', async () => {
    let calls = 0
    h.pipeline = vi.fn(async () => {
      if (++calls === 1) throw new Error('offline')
      return makeExtractor()
    })
    const m = await freshModule()
    await expect(m.loadMiniLmEmbedder()).rejects.toBeInstanceOf(m.EmbedderLoadError)
    const first = h.env.backends.onnx.wasm.wasmPaths
    // something the library does after a first start: it swaps the loader for a blob URL
    ;(first as { mjs: string }).mjs = 'blob:preloaded'
    await m.loadMiniLmEmbedder()
    expect(h.env.backends.onnx.wasm.wasmPaths).toBe(first)
    expect((h.env.backends.onnx.wasm.wasmPaths as { mjs: string }).mjs).toBe('blob:preloaded')
  })
})

describe('self-hosting the model (VITE_HB_EMBED_MODEL_BASE)', () => {
  it('leaves the hub in place when unset or blank', async () => {
    for (const value of [undefined, '', '   ']) {
      vi.unstubAllEnvs()
      if (value !== undefined) vi.stubEnv('VITE_HB_EMBED_MODEL_BASE', value)
      const m = await freshModule()
      await m.loadMiniLmEmbedder()
      expect(h.env.remoteHost, String(value)).toBe('https://huggingface.co/')
      expect(h.env.remotePathTemplate).toBe('{model}/resolve/{revision}/')
    }
  })

  it('serves the repository layout from the folder it names', async () => {
    vi.stubEnv('VITE_HB_EMBED_MODEL_BASE', 'https://models.example.org/hb')
    const m = await freshModule()
    await m.loadMiniLmEmbedder()
    expect(h.env.remoteHost).toBe('https://models.example.org/hb/')
    expect(h.env.remotePathTemplate).toBe('{model}/')
    // how the library joins them (utils/hub.js: pathJoin(remoteHost, template with {model}, filename))
    const url = `${(h.env.remoteHost as string).replace(/\/$/, '')}/${(h.env.remotePathTemplate as string).replaceAll('{model}', m.MINILM_MODEL_ID)}onnx/model_quantized.onnx`
    expect(url).toBe('https://models.example.org/hb/Xenova/all-MiniLM-L6-v2/onnx/model_quantized.onnx')
  })

  it('fails loudly, without a request, when the value is malformed', async () => {
    vi.stubEnv('VITE_HB_EMBED_MODEL_BASE', 'ftp://models.example.org/')
    const m = await freshModule()
    const err = await m.loadMiniLmEmbedder().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(m.EmbedderLoadError)
    expect((err as Error).message).toContain('VITE_HB_EMBED_MODEL_BASE')
    expect(h.pipeline).not.toHaveBeenCalled()
    expect(h.env.remoteHost).toBe('https://huggingface.co/')
  })
})

describe('resolveModelBase', () => {
  const PAGE = 'https://owner.github.io/humanbench/#/dev/aut'

  it('is null for unset or blank values', async () => {
    const m = await freshModule()
    const { resolveModelBase } = m
    for (const v of [undefined, '', '  ', '\n']) expect(resolveModelBase(v, PAGE), JSON.stringify(v)).toBeNull()
  })

  it('returns an absolute folder URL with a trailing slash', async () => {
    const m = await freshModule()
    const { resolveModelBase } = m
    expect(resolveModelBase('https://models.example.org', PAGE)).toBe('https://models.example.org/')
    expect(resolveModelBase('https://models.example.org/', PAGE)).toBe('https://models.example.org/')
    expect(resolveModelBase('https://models.example.org/a/b', PAGE)).toBe('https://models.example.org/a/b/')
    expect(resolveModelBase('  https://models.example.org/a/b/  ', PAGE)).toBe('https://models.example.org/a/b/')
    expect(resolveModelBase('https://models.example.org/a/b', undefined)).toBe('https://models.example.org/a/b/')
  })

  it('resolves paths on this site against the page', async () => {
    const m = await freshModule()
    const { resolveModelBase } = m
    expect(resolveModelBase('/humanbench/models/', PAGE)).toBe('https://owner.github.io/humanbench/models/')
    expect(resolveModelBase('/models', PAGE)).toBe('https://owner.github.io/models/')
    expect(resolveModelBase('models/', PAGE)).toBe('https://owner.github.io/humanbench/models/')
    expect(resolveModelBase('/models', 'http://192.168.1.20:5173/')).toBe('http://192.168.1.20:5173/models/')
  })

  it('allows http only for this site and for localhost', async () => {
    const m = await freshModule()
    const { resolveModelBase } = m
    expect(resolveModelBase('http://localhost:8080/m', PAGE)).toBe('http://localhost:8080/m/')
    expect(resolveModelBase('http://127.0.0.1:8080/m/', undefined)).toBe('http://127.0.0.1:8080/m/')
    expect(() => resolveModelBase('http://models.example.org/m', PAGE)).toThrow(/https/)
    expect(() => resolveModelBase('http://192.168.1.20/m', PAGE)).toThrow(/https/)
    expect(resolveModelBase('http://models.example.org/m', 'http://models.example.org/app')).toBe('http://models.example.org/m/')
  })

  it('refuses what is not a plain folder URL', async () => {
    const m = await freshModule()
    const { resolveModelBase } = m
    for (const bad of ['ftp://x.org/m', 'javascript:alert(1)', 'data:text/plain,hi', 'file:///models/', 'https://user:pw@models.example.org/', 'https://models.example.org/?a=1', 'https://models.example.org/#frag', 'https://']) {
      expect(() => resolveModelBase(bad, PAGE), bad).toThrow(m.EmbedderLoadError)
    }
    expect(() => resolveModelBase('models/', undefined)).toThrow(/not a URL/)
  })
})

describe('progress', () => {
  /** A pipeline that reports `events` through the callback it was given, then finishes. */
  function reporting(events: unknown[]): void {
    h.pipeline = vi.fn(async (_task: string, _model: string, options: { progress_callback: (i: unknown) => void }) => {
      for (const e of events) options.progress_callback(e)
      return makeExtractor()
    })
  }

  it('maps the aggregate events to loaded and total bytes, with the file being fetched', async () => {
    reporting([
      { status: 'initiate', name: 'm', file: 'onnx/model_quantized.onnx' },
      { status: 'download', name: 'm', file: 'onnx/model_quantized.onnx' },
      { status: 'progress', name: 'm', file: 'onnx/model_quantized.onnx', progress: 10, loaded: 2_000_000, total: 23_000_000 },
      { status: 'progress_total', name: 'm', progress: 8, loaded: 2_100_000, total: 24_000_000, files: {} },
      { status: 'progress', name: 'm', file: 'tokenizer.json', progress: 100, loaded: 700_000, total: 700_000 },
      { status: 'progress_total', name: 'm', progress: 12, loaded: 2_800_000, total: 24_000_000, files: {} },
      { status: 'done', name: 'm', file: 'tokenizer.json' },
      { status: 'ready', task: 'feature-extraction', model: 'm' },
    ])
    const seen: LoadProgress[] = []
    const m = await freshModule()
    await m.loadMiniLmEmbedder({ onProgress: (p) => seen.push(p) })
    expect(seen).toEqual([
      { loadedBytes: 2_100_000, totalBytes: 24_000_000, file: 'onnx/model_quantized.onnx' },
      { loadedBytes: 2_800_000, totalBytes: 24_000_000, file: 'tokenizer.json' },
    ])
  })

  it('omits the file before any event has named one, reports an unknown total as null, and never goes backwards or past the total', async () => {
    reporting([
      { status: 'progress_total', loaded: 500, total: 0 },
      { status: 'progress_total', loaded: 400, total: 0 },
      { status: 'progress_total', loaded: 800, total: 1000 },
      { status: 'progress_total', loaded: 700, total: 1000 },
      { status: 'progress_total', loaded: 1200, total: 1000 },
      { status: 'progress_total', loaded: -5, total: 1000 },
    ])
    const seen: LoadProgress[] = []
    const m = await freshModule()
    await m.loadMiniLmEmbedder({ onProgress: (p) => seen.push(p) })
    expect(seen).toEqual([
      { loadedBytes: 500, totalBytes: null },
      { loadedBytes: 500, totalBytes: null },
      { loadedBytes: 800, totalBytes: 1000 },
      { loadedBytes: 800, totalBytes: 1000 },
      { loadedBytes: 1000, totalBytes: 1000 },
      { loadedBytes: 1000, totalBytes: 1000 },
    ])
    expect(Object.keys(seen[0] as object)).toEqual(['loadedBytes', 'totalBytes'])
  })

  it('ignores events it does not understand', async () => {
    reporting([null, undefined, 'x', 3, {}, { status: 'progress_total' }, { status: 'progress_total', loaded: 'a', total: 5 }, { status: 'progress_total', loaded: Number.NaN, total: 5 }, { status: 'progress_total', loaded: 1, total: Number.POSITIVE_INFINITY }])
    const seen: LoadProgress[] = []
    const m = await freshModule()
    await expect(m.loadMiniLmEmbedder({ onProgress: (p) => seen.push(p) })).resolves.toBeDefined()
    expect(seen).toEqual([])
  })

  it('is optional, and a throwing listener does not break the load', async () => {
    reporting([{ status: 'progress_total', loaded: 1, total: 2 }])
    const m = await freshModule()
    await expect(m.loadMiniLmEmbedder()).resolves.toBeDefined()
    const m2 = await freshModule()
    const calls = vi.fn(() => {
      throw new Error('listener bug')
    })
    await expect(m2.loadMiniLmEmbedder({ onProgress: calls })).resolves.toBeDefined()
    expect(calls).toHaveBeenCalledTimes(1)
  })
})

describe('abort', () => {
  /** A pipeline that downloads through env.fetch and so ends when that fetch is aborted. */
  function downloading(): { signals: AbortSignal[]; started: Promise<void> } {
    const signals: AbortSignal[] = []
    let markStarted = (): void => undefined
    const started = new Promise<void>((r) => (markStarted = r))
    h.originalFetch = abortableFetch()
    h.env.fetch = h.originalFetch
    h.pipeline = vi.fn(async () => {
      const fetchLike = h.env.fetch as (u: string, init?: { signal?: AbortSignal }) => Promise<Response>
      const p = fetchLike('https://huggingface.co/x/y')
      const init = (h.originalFetch.mock.calls.at(-1) as [unknown, { signal?: AbortSignal }] | undefined)?.[1]
      if (init?.signal !== undefined) signals.push(init.signal)
      markStarted()
      await p
      return makeExtractor()
    })
    return { signals, started }
  }

  it('rejects with an AbortError when the signal aborts, and stops the download', async () => {
    const { signals, started } = downloading()
    const m = await freshModule()
    const c = new AbortController()
    const result = m.loadMiniLmEmbedder({ signal: c.signal })
    const outcome = result.then(
      () => 'resolved',
      (e: unknown) => e,
    )
    await started
    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(false)
    c.abort()
    const err = await outcome
    expect(err).toBeInstanceOf(DOMException)
    expect((err as DOMException).name).toBe('AbortError')
    expect(err).not.toBeInstanceOf(m.EmbedderLoadError)
    await flush()
    expect(signals[0]?.aborted).toBe(true)
  })

  it('puts env.fetch back after a cancelled load, and a later call starts a fresh load that can succeed', async () => {
    const { started } = downloading()
    const m = await freshModule()
    const c = new AbortController()
    const first = m.loadMiniLmEmbedder({ signal: c.signal }).catch((e: unknown) => e)
    await started
    c.abort()
    await first
    await flush()
    expect(h.env.fetch).toBe(h.originalFetch)
    h.pipeline = vi.fn(async () => makeExtractor())
    await expect(m.loadMiniLmEmbedder()).resolves.toMatchObject({ dim: 384 })
    expect(h.env.fetch).toBe(h.originalFetch)
  })

  it('an abort after the embedder is ready changes nothing, but an already aborted signal still rejects', async () => {
    const m = await freshModule()
    const c = new AbortController()
    const e = await m.loadMiniLmEmbedder({ signal: c.signal })
    c.abort()
    await expect(e.embed(['x'])).resolves.toHaveLength(1)
    await expect(m.loadMiniLmEmbedder({ signal: c.signal })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(m.loadMiniLmEmbedder()).resolves.toBe(e)
  })

  it('when the load ends just after an abort, releases the extractor it built and rejects with an AbortError', async () => {
    const extractor = makeExtractor()
    let release = (): void => undefined
    h.pipeline = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve(extractor)
        }),
    )
    const m = await freshModule()
    const c = new AbortController()
    const outcome = m.loadMiniLmEmbedder({ signal: c.signal }).catch((e: unknown) => e)
    await vi.waitFor(() => expect(h.pipeline).toHaveBeenCalled())
    c.abort()
    expect(await outcome).toMatchObject({ name: 'AbortError' })
    release() // the library finishes anyway, after nobody is waiting
    await vi.waitFor(() => expect(extractor.dispose).toHaveBeenCalledTimes(1))
    expect(extractor.calls).toHaveLength(0) // and the model was never run
  })

  it('keeps the load going while any caller still waits: one aborting does not cancel it for the other', async () => {
    const { signals, started } = downloading()
    const m = await freshModule()
    const a = new AbortController()
    const resultA = m.loadMiniLmEmbedder({ signal: a.signal }).catch((e: unknown) => e)
    const resultB = m.loadMiniLmEmbedder()
    await started
    expect(h.pipeline).toHaveBeenCalledTimes(1)
    a.abort()
    expect(await resultA).toMatchObject({ name: 'AbortError' })
    await flush()
    expect(signals[0]?.aborted).toBe(false)
    // the second caller is still waiting for a download that is still running
    const state = await Promise.race([resultB.then(() => 'done'), flush().then(() => 'waiting')])
    expect(state).toBe('waiting')
  })

  it('cancels the download once every caller has aborted', async () => {
    const { signals, started } = downloading()
    const m = await freshModule()
    const a = new AbortController()
    const b = new AbortController()
    const ra = m.loadMiniLmEmbedder({ signal: a.signal }).catch((e: unknown) => e)
    const rb = m.loadMiniLmEmbedder({ signal: b.signal }).catch((e: unknown) => e)
    await started
    a.abort()
    await flush()
    expect(signals[0]?.aborted).toBe(false)
    b.abort()
    expect(await ra).toMatchObject({ name: 'AbortError' })
    expect(await rb).toMatchObject({ name: 'AbortError' })
    await flush()
    expect(signals[0]?.aborted).toBe(true)
  })

  it('a new call right after everyone aborted waits for the cancelled load to end, then loads again', async () => {
    const { started } = downloading()
    const m = await freshModule()
    const a = new AbortController()
    const ra = m.loadMiniLmEmbedder({ signal: a.signal }).catch((e: unknown) => e)
    await started
    a.abort()
    await ra
    h.pipeline = vi.fn(async () => makeExtractor())
    const e = await m.loadMiniLmEmbedder()
    expect(e.dim).toBe(384)
    expect(h.pipeline).toHaveBeenCalledTimes(1)
    expect(h.env.fetch).toBe(h.originalFetch)
  })

  it('routes the library requests through a fetch that carries the load signal, and only during the load', async () => {
    let seen: { input: unknown; init: { signal?: AbortSignal; headers?: unknown } | undefined } | undefined
    h.originalFetch = vi.fn(async (input: unknown, init?: { signal?: AbortSignal; headers?: unknown }) => {
      seen = { input, init }
      return new Response('ok')
    })
    h.env.fetch = h.originalFetch
    h.pipeline = vi.fn(async () => {
      await (h.env.fetch as (u: string, i?: unknown) => Promise<Response>)('https://huggingface.co/m/config.json', { headers: { a: 'b' } })
      return makeExtractor()
    })
    const m = await freshModule()
    await m.loadMiniLmEmbedder()
    expect(seen?.input).toBe('https://huggingface.co/m/config.json')
    expect(seen?.init?.headers).toEqual({ a: 'b' })
    expect(seen?.init?.signal).toBeInstanceOf(AbortSignal)
    expect(h.env.fetch).toBe(h.originalFetch)
  })
})

describe('errors', () => {
  it('wraps a failure of the pipeline in an EmbedderLoadError that keeps the cause and the reason', async () => {
    const cause = new TypeError('Failed to fetch')
    h.pipeline = vi.fn(async () => {
      throw cause
    })
    const m = await freshModule()
    const err = await m.loadMiniLmEmbedder().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(m.EmbedderLoadError)
    expect((err as Error).cause).toBe(cause)
    expect((err as Error).message).toContain('Failed to fetch')
  })

  it('wraps a thrown non-Error too', async () => {
    h.pipeline = vi.fn(async () => {
      throw 'plain string'
    })
    const m = await freshModule()
    const err = await m.loadMiniLmEmbedder().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(m.EmbedderLoadError)
    expect((err as Error).message).toContain('plain string')
  })

  it('wraps a failure to import the library itself', async () => {
    h.importError = new Error('Failed to fetch dynamically imported module')
    const m = await freshModule()
    const err = await m.loadMiniLmEmbedder().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(m.EmbedderLoadError)
    expect((err as Error).message).toContain('code could not be loaded')
    expect((err as Error).cause).toBeDefined()
    expect(h.pipeline).not.toHaveBeenCalled()
  })

  it('wraps a model that loads but does not run, or has the wrong shape, and releases it', async () => {
    const broken = Object.assign(
      vi.fn(async () => {
        throw new Error('RuntimeError: unreachable')
      }),
      { dispose: vi.fn(async () => undefined) },
    )
    h.pipeline = vi.fn(async () => broken)
    const m = await freshModule()
    const err = await m.loadMiniLmEmbedder().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(m.EmbedderLoadError)
    expect((err as Error).message).toContain('unreachable')
    expect(broken.dispose).toHaveBeenCalledTimes(1)

    const wrongShape = Object.assign(
      vi.fn(async () => ({ data: new Float32Array(768), dims: [1, 768] })),
      { dispose: vi.fn(async () => undefined) },
    )
    h.pipeline = vi.fn(async () => wrongShape)
    const err2 = await m.loadMiniLmEmbedder().catch((e: unknown) => e)
    expect(err2).toBeInstanceOf(m.EmbedderLoadError)
    expect((err2 as Error).message).toMatch(/unexpected shape \[1, 768\]/)
    expect(wrongShape.dispose).toHaveBeenCalledTimes(1)
  })

  it('survives an extractor whose dispose throws', async () => {
    const extractor = Object.assign(
      vi.fn(async () => {
        throw new Error('no good')
      }),
      {
        dispose: vi.fn(() => {
          throw new Error('dispose failed')
        }),
      },
    )
    h.pipeline = vi.fn(async () => extractor)
    const m = await freshModule()
    const err = await m.loadMiniLmEmbedder().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(m.EmbedderLoadError)
    expect((err as Error).message).toContain('no good')
  })

  it('leaves nothing behind: env.fetch is restored, and a retry loads again and can succeed', async () => {
    let n = 0
    h.pipeline = vi.fn(async () => {
      if (++n === 1) throw new Error('offline')
      return makeExtractor()
    })
    const m = await freshModule()
    await expect(m.loadMiniLmEmbedder()).rejects.toBeInstanceOf(m.EmbedderLoadError)
    expect(h.env.fetch).toBe(h.originalFetch)
    const e = await m.loadMiniLmEmbedder()
    expect(e.dim).toBe(384)
    expect(h.pipeline).toHaveBeenCalledTimes(2)
  })

  it('every caller waiting on a failing load gets the same error', async () => {
    h.pipeline = vi.fn(async () => {
      throw new Error('blocked')
    })
    const m = await freshModule()
    const [a, b] = await Promise.all([m.loadMiniLmEmbedder().catch((e: unknown) => e), m.loadMiniLmEmbedder().catch((e: unknown) => e)])
    expect(a).toBeInstanceOf(m.EmbedderLoadError)
    expect(b).toBe(a)
    expect(h.pipeline).toHaveBeenCalledTimes(1)
  })
})

describe('sharing', () => {
  it('callers that ask during a load join it: one pipeline, one embedder', async () => {
    let release = (): void => undefined
    h.pipeline = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve(makeExtractor())
        }),
    )
    const m = await freshModule()
    const first = m.loadMiniLmEmbedder()
    const second = m.loadMiniLmEmbedder()
    await vi.waitFor(() => expect(h.pipeline).toHaveBeenCalled())
    release()
    const [a, b] = await Promise.all([first, second])
    expect(a).toBe(b)
    expect(h.pipeline).toHaveBeenCalledTimes(1)
  })

  it('later calls return the embedder that is already loaded', async () => {
    const m = await freshModule()
    const a = await m.loadMiniLmEmbedder()
    const b = await m.loadMiniLmEmbedder({ onProgress: () => undefined })
    expect(b).toBe(a)
    expect(h.pipeline).toHaveBeenCalledTimes(1)
  })

  it('each caller has its own progress listener, and a late joiner first gets the latest count', async () => {
    let report: (i: unknown) => void = () => undefined
    let release = (): void => undefined
    h.pipeline = vi.fn(
      (_task: string, _model: string, options: { progress_callback: (i: unknown) => void }) =>
        new Promise((resolve) => {
          report = options.progress_callback
          release = () => resolve(makeExtractor())
        }),
    )
    const m = await freshModule()
    const early: LoadProgress[] = []
    const late: LoadProgress[] = []
    const first = m.loadMiniLmEmbedder({ onProgress: (p) => early.push(p) })
    await vi.waitFor(() => expect(h.pipeline).toHaveBeenCalled())
    report({ status: 'progress_total', loaded: 10, total: 100, file: 'a' })
    const second = m.loadMiniLmEmbedder({ onProgress: (p) => late.push(p) })
    expect(late).toEqual([{ loadedBytes: 10, totalBytes: 100, file: 'a' }])
    report({ status: 'progress_total', loaded: 60, total: 100 })
    release()
    await Promise.all([first, second])
    expect(early.map((p) => p.loadedBytes)).toEqual([10, 60])
    expect(late.map((p) => p.loadedBytes)).toEqual([10, 60])
    // listeners are dropped when the load is over
    report({ status: 'progress_total', loaded: 100, total: 100 })
    expect(early).toHaveLength(2)
    expect(late).toHaveLength(2)
  })

  it('never calls the network itself: all requests go through the library', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network is off'))
    const m = await freshModule()
    const e = await m.loadMiniLmEmbedder()
    await e.embed(['a', 'b'])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
