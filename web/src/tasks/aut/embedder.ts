/**
 * The sentence-embedding interface of the Alternative Uses Task ("Unusual uses", experimental;
 * ROADMAP M6.4, DESIGN §5.4) and a deterministic stand-in for tests and demos.
 *
 * This module is the one the rest of the app imports. It must stay free of the model library: no
 * import of `@huggingface/transformers` or `onnxruntime-*`, not even a type import, so that code
 * which only scores or renders never pulls the ~1.3 MB runtime in. The real model lives in
 * `minilm.ts`, which loads the library with a dynamic `import()` only when a person starts the task
 * (`scripts/aut-bundle.test.ts` checks both).
 *
 * Privacy (DESIGN §8): embedding runs on the device. Nothing in this interface sends a text anywhere.
 */

/** Turns texts into unit-length vectors, locally. */
export interface Embedder {
  /** Which model made the vectors (`'mock'` for the stand-in); stored with scores so they stay comparable. */
  readonly modelId: string
  /** The length of every vector. */
  readonly dim: number
  /**
   * One L2-normalised, mean-pooled vector per text, in the order of `texts` (an empty list gives an
   * empty list). Each call returns fresh arrays the caller may keep or change.
   */
  embed(texts: readonly string[]): Promise<Float32Array[]>
}

/** How far a model download has got. */
export interface LoadProgress {
  readonly loadedBytes: number
  /** Null while the total is not known. */
  readonly totalBytes: number | null
  /** The file being fetched, when known (for logs; not for people). */
  readonly file?: string
}

/** The model could not be fetched, started or checked (offline, blocked, unsupported browser). `cause` holds the original error. */
export class EmbedderLoadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'EmbedderLoadError'
  }
}

/**
 * `v` scaled to unit length, as a new Float32Array. Length is accumulated in float64 so a vector
 * of tiny or huge float32 components still has a direction. A vector with none (all zeros, or a
 * NaN or infinite component) comes back as zeros: callers that need a vector check for that.
 */
export function l2Normalise(v: ArrayLike<number>): Float32Array {
  const out = new Float32Array(v.length)
  let max = 0
  for (let i = 0; i < v.length; i++) {
    const a = Math.abs(v[i] as number)
    if (Number.isNaN(a)) return out
    if (a > max) max = a
  }
  if (max === 0 || !Number.isFinite(max)) return out
  let q = 0
  for (let i = 0; i < v.length; i++) {
    const x = (v[i] as number) / max
    q += x * x
  }
  const n = max * Math.sqrt(q)
  for (let i = 0; i < v.length; i++) out[i] = (v[i] as number) / n
  return out
}

export const MOCK_MODEL_ID = 'mock'
const MOCK_DEFAULT_DIM = 64
/** A word counts this much more than one of its character trigrams. */
const WORD_WEIGHT = 1
const TRIGRAM_WEIGHT = 0.4

/** 32-bit FNV-1a of a string's UTF-16 code units: stable across platforms and runs. */
function fnv1a(s: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  // A final avalanche step, so that the low bits (the bucket) depend on every character.
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d) >>> 0
  h ^= h >>> 12
  return h >>> 0
}

/** Adds `weight` for `feature` to its bucket, with a hash-chosen sign so unrelated texts do not share a positive baseline. */
function addFeature(acc: Float64Array, feature: string, weight: number): void {
  const bucket = fnv1a(feature, 0) % acc.length
  const sign = (fnv1a(feature, 1) & 1) === 0 ? 1 : -1
  acc[bucket] = (acc[bucket] as number) + sign * weight
}

/** The vector of a text that has no words (empty, spaces, punctuation): the same unit vector every time. */
function emptyVector(dim: number): Float32Array {
  return new Float32Array(dim).fill(1 / Math.sqrt(dim))
}

function mockVector(text: string, dim: number): Float32Array {
  const acc = new Float64Array(dim)
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  for (const w of words) {
    addFeature(acc, `w:${w}`, WORD_WEIGHT)
    const padded = `^${w}$`
    for (let i = 0; i + 3 <= padded.length; i++) addFeature(acc, `t:${padded.slice(i, i + 3)}`, TRIGRAM_WEIGHT)
  }
  const unit = l2Normalise(acc)
  // All features cancelling out exactly is possible in principle; treat it as "no content".
  return unit.some((x) => x !== 0) ? unit : emptyVector(dim)
}

/**
 * A deterministic embedder with no model and no network (tests, demos, a fallback for a UI under
 * development). Lower-cased word tokens and the character trigrams of each word are hashed into
 * `dim` buckets (default 64) with a hash-chosen sign, then the vector is scaled to unit length. So
 * texts that share words are closer (higher cosine) than unrelated texts, near-spellings of a
 * word share most of their trigrams, and the same text always gives the same vector. A text with
 * no word characters gets one fixed vector (all components equal). It is not a language model: it
 * knows nothing about meaning, so scores computed with it are for testing the plumbing only.
 */
export function createMockEmbedder(opts: { dim?: number } = {}): Embedder {
  const dim = opts.dim ?? MOCK_DEFAULT_DIM
  if (!Number.isInteger(dim) || dim < 1) throw new RangeError(`the mock embedder needs an integer dim of at least 1, got ${String(dim)}`)
  return {
    modelId: MOCK_MODEL_ID,
    dim,
    embed: (texts) => Promise.resolve(texts.map((t) => mockVector(t, dim))),
  }
}
