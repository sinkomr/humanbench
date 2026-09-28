/**
 * RFC 8785 JSON Canonicalization Scheme (JCS), the byte form the server MACs (DESIGN §8, A16).
 *
 * `canonicalJson` in `tasks/ids.ts` already is JCS on I-JSON input: keys sorted by UTF-16 code
 * units (`Array.prototype.sort`'s default order), no whitespace, and ECMAScript number and string
 * serialisation (`JSON.stringify`, which RFC 8785 §3.2.2 adopts, -0 → 0). What it lacks is the
 * I-JSON input check (RFC 8785 §3.1, RFC 7493 §2.1): a string or key holding an unpaired UTF-16
 * surrogate must be rejected, whereas `JSON.stringify` escapes it as `\udXXX`. {@link jcs} adds
 * that check and delegates, so `family_id` hashing (A11) and save canonicalisation stay one
 * implementation. `jcs.test.ts` pins the RFC's vectors and compares against an independent
 * reference serialiser.
 *
 * Limits beyond the RFC (both from `canonicalJson`): nesting deeper than 64 and non-plain objects
 * throw a TypeError.
 */

import { canonicalJson } from '../tasks/ids'

/** Matches an unpaired UTF-16 surrogate (the `u` flag makes paired ones one code point). */
const LONE_SURROGATE_RE = /[\uD800-\uDFFF]/u

/** True iff `s` is an I-JSON string: no unpaired surrogate code unit (RFC 7493 §2.1). */
export function isIJsonString(s: string): boolean {
  return !LONE_SURROGATE_RE.test(s)
}

function assertIJson(v: unknown, depth: number): void {
  if (depth > 64) throw new TypeError('jcs: nesting deeper than 64')
  if (typeof v === 'string') {
    if (!isIJsonString(v)) throw new TypeError('jcs: string with an unpaired surrogate is not I-JSON')
    return
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) if (i in v) assertIJson(v[i], depth + 1)
    return
  }
  if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (!isIJsonString(k)) throw new TypeError('jcs: key with an unpaired surrogate is not I-JSON')
      assertIJson(x, depth + 1)
    }
  }
}

/**
 * RFC 8785 canonical JSON of `v`. Throws a TypeError on anything that is not I-JSON (non-finite
 * numbers, undefined, functions, class instances, sparse arrays, cycles, unpaired surrogates).
 */
export function jcs(v: unknown): string {
  assertIJson(v, 0)
  return canonicalJson(v)
}

/** UTF-8 bytes of {@link jcs}, the exact input of the server MAC (§8). */
export function jcsBytes(v: unknown): Uint8Array {
  return new TextEncoder().encode(jcs(v))
}
