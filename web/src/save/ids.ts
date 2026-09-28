/**
 * Save-file identifiers (DESIGN §8 privacy):
 * - `anon_id = "hb_" + base62(96 random bits)`, 17 characters, zero-padded. Files from the §8
 *   example era carry 16, so the schema accepts 16–17.
 * - `session_id = "s_" + ULID`: 10 Crockford base-32 characters of wall-clock ms (so ids sort by
 *   start time, like the §8 example's `s_01J9ZK3Q`) + 16 of 80 random bits.
 *
 * Randomness comes from `crypto.getRandomValues` (not the seeded engine stream: these ids must be
 * unpredictable, and nothing regenerates them). Tests inject `randomBytes`.
 */

export type RandomBytes = (n: number) => Uint8Array

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const CROCKFORD32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Characters of base62(2^96 − 1). */
export const ANON_ID_CHARS = 17

/** Cryptographic random bytes (Web Crypto; also a global in Node ≥ 19). */
export const cryptoRandomBytes: RandomBytes = (n) => {
  const out = new Uint8Array(n)
  globalThis.crypto.getRandomValues(out)
  return out
}

function takeBytes(randomBytes: RandomBytes, n: number): Uint8Array {
  const b = randomBytes(n)
  if (!(b instanceof Uint8Array) || b.length !== n) throw new TypeError(`randomBytes(${n}) must return ${n} bytes`)
  return b
}

/** `hb_` + 96 random bits in base62, 17 characters (§8). */
export function newAnonId(randomBytes: RandomBytes = cryptoRandomBytes): string {
  let x = 0n
  for (const byte of takeBytes(randomBytes, 12)) x = (x << 8n) | BigInt(byte)
  let s = ''
  for (let i = 0; i < ANON_ID_CHARS; i++) {
    s = BASE62.charAt(Number(x % 62n)) + s
    x /= 62n
  }
  return `hb_${s}`
}

/** `s_` + a 26-character ULID for a session starting at wall-clock `epochMs`. */
export function newSessionId(epochMs: number, randomBytes: RandomBytes = cryptoRandomBytes): string {
  if (!Number.isInteger(epochMs) || epochMs < 0 || epochMs >= 2 ** 48) throw new RangeError(`epochMs must be an integer in [0, 2^48), got ${epochMs}`)
  let t = ''
  let ms = epochMs
  for (let i = 0; i < 10; i++) {
    t = CROCKFORD32.charAt(ms % 32) + t
    ms = Math.floor(ms / 32)
  }
  let x = 0n
  for (const byte of takeBytes(randomBytes, 10)) x = (x << 8n) | BigInt(byte)
  let r = ''
  for (let i = 0; i < 16; i++) {
    r = CROCKFORD32.charAt(Number(x & 31n)) + r
    x >>= 5n
  }
  return `s_${t}${r}`
}
