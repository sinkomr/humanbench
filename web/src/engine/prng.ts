/**
 * Deterministic seeded PRNG for procedural item generation and selection (ROADMAP A1, §7.4).
 *
 * Algorithm (both by bryc, public domain, https://github.com/bryc/code/blob/master/jshash/PRNGs.md):
 * - the seed string is hashed with cyrb128 (over UTF-16 code units, `charCodeAt`) into four
 *   32-bit words;
 * - those words seed sfc32 (Chris Doty-Humphrey's Small Fast Chaotic generator, 128-bit state);
 * - the first {@link WARMUP_ROUNDS} outputs are discarded.
 *
 * Seeds are strings or safe integers. A §12 item record stores `source.seed` as a JSON number,
 * so an integer seed is canonicalised to its decimal string (`918273` and `"918273"` give the same
 * stream; this matches Python's `str(int)`). Any other value throws a TypeError rather than
 * silently hashing to the empty-string stream.
 *
 * Every draw is a pure function of the seed and the exact sequence of prior calls on the stream
 * (not just their number: `normal()` consumes two raw outputs and caches one deviate, and `int()`
 * rejection-samples), so a seed recorded in an item's `source.seed` reproduces the item exactly
 * when the generator replays the same calls. Not cryptographic.
 */

/** sfc32 outputs discarded after seeding, so that similar seeds diverge immediately. */
export const WARMUP_ROUNDS = 12

const TWO_POW_32 = 4294967296

/** A PRNG seed: any string, or a safe integer (canonicalised to its decimal string). */
export type RngSeed = string | number

/**
 * Canonical seed string: strings pass through, safe integers become `String(n)`. Throws a
 * TypeError for anything else (non-integers, NaN, unsafe integers, objects, undefined, ...).
 */
export function seedString(seed: unknown): string {
  if (typeof seed === 'string') return seed
  if (typeof seed === 'number' && Number.isSafeInteger(seed)) return String(seed)
  throw new TypeError(`PRNG seed must be a string or a safe integer, got ${showValue(seed)}`)
}

function showValue(v: unknown): string {
  return typeof v === 'number' ? String(v) : typeof v === 'string' ? JSON.stringify(v) : typeof v
}

/** cyrb128: a fast 128-bit non-cryptographic string hash; returns four uint32 words. */
export function cyrb128(str: string): [number, number, number, number] {
  if (typeof str !== 'string') throw new TypeError(`cyrb128 needs a string, got ${showValue(str)}`)
  let h1 = 1779033703
  let h2 = 3144134277
  let h3 = 1013904242
  let h4 = 2773480762
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4
  h2 ^= h1
  h3 ^= h1
  h4 ^= h1
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0]
}

/** sfc32 generator over four 32-bit state words; each call returns the next uint32. */
export function sfc32(a: number, b: number, c: number, d: number): () => number {
  a |= 0
  b |= 0
  c |= 0
  d |= 0
  return () => {
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return t >>> 0
  }
}

/** A seeded random stream. All methods advance the stream except {@link Rng.fork}. */
export interface Rng {
  /** The canonical seed string this stream was created from (see {@link seedString}). */
  readonly seed: string
  /** Next raw 32-bit unsigned integer in [0, 2^32). */
  uint32(): number
  /** Next float in [0, 1), with 32 bits of resolution. */
  next(): number
  /** Uniform integer in [lo, hi], both inclusive; unbiased (rejection sampling). */
  int(lo: number, hiInclusive: number): number
  /** Uniformly chosen element; throws on an empty array. */
  pick<T>(arr: readonly T[]): T
  /** A uniformly shuffled copy (Fisher–Yates); the input is not modified. */
  shuffle<T>(arr: readonly T[]): T[]
  /** Normal deviate (Box–Muller; the second deviate of each pair is cached). */
  normal(mean?: number, sd?: number): number
  /**
   * An independent child stream derived from this stream's seed and `label` only. It does not
   * advance or depend on the parent's position, so the same label always yields the same child.
   * Throws a TypeError unless `label` is a string.
   */
  fork(label: string): Rng
}

/**
 * Seed string of the child stream `fork(label)`. JSON encoding makes the (seed, label) pair
 * unambiguous, so e.g. ("a/b", "c") and ("a", "b/c") cannot collide.
 */
export function forkSeed(seed: string, label: string): string {
  return JSON.stringify([seed, label])
}

/**
 * Create a deterministic random stream from a seed string or safe integer. Throws a TypeError
 * for any other seed value (see {@link seedString}).
 */
export function createRng(rawSeed: RngSeed): Rng {
  const seed = seedString(rawSeed)
  const [s0, s1, s2, s3] = cyrb128(seed)
  const raw = sfc32(s0, s1, s2, s3)
  for (let i = 0; i < WARMUP_ROUNDS; i++) raw()

  let spare: number | null = null

  const next = (): number => raw() / TWO_POW_32

  const int = (lo: number, hiInclusive: number): number => {
    if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hiInclusive)) {
      throw new RangeError(`int(): bounds must be safe integers, got ${lo}, ${hiInclusive}`)
    }
    if (hiInclusive < lo) throw new RangeError(`int(): empty range [${lo}, ${hiInclusive}]`)
    const range = hiInclusive - lo + 1
    if (range > TWO_POW_32) throw new RangeError(`int(): range ${range} exceeds 2^32`)
    // Accept only draws below the largest multiple of `range`, so every residue is equally likely.
    const limit = TWO_POW_32 - (TWO_POW_32 % range)
    let u = raw()
    while (u >= limit) u = raw()
    return lo + (u % range)
  }

  const pick = <T>(arr: readonly T[]): T => {
    if (arr.length === 0) throw new RangeError('pick(): empty array')
    return arr[int(0, arr.length - 1)] as T
  }

  const shuffle = <T>(arr: readonly T[]): T[] => {
    const out = arr.slice()
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i)
      const tmp = out[i] as T
      out[i] = out[j] as T
      out[j] = tmp
    }
    return out
  }

  const normal = (mean = 0, sd = 1): number => {
    if (spare !== null) {
      const z = spare
      spare = null
      return mean + sd * z
    }
    // u1 ∈ (0, 1] so log(u1) is finite; u2 ∈ [0, 1).
    const u1 = 1 - next()
    const u2 = next()
    const r = Math.sqrt(-2 * Math.log(u1))
    const phi = 2 * Math.PI * u2
    spare = r * Math.sin(phi)
    return mean + sd * r * Math.cos(phi)
  }

  return {
    seed,
    uint32: raw,
    next,
    int,
    pick,
    shuffle,
    normal,
    fork: (label: string) => {
      if (typeof label !== 'string') throw new TypeError(`fork() label must be a string, got ${showValue(label)}`)
      return createRng(forkSeed(seed, label))
    },
  }
}
