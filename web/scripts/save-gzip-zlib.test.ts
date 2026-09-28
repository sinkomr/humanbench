/**
 * Cross-check of the save file's gzip fallback (`src/save/gzip.ts`, DESIGN §8 copy code) against
 * Node's zlib across compression levels and strategies, so stored, fixed-Huffman and
 * dynamic-Huffman blocks, RLE and Huffman-only streams are all decoded. Lives in scripts/ because
 * it needs Node's zlib (the app tsconfig has no Node types).
 */

import { constants, gunzipSync as zlibGunzip, gzipSync as zlibGzip } from 'node:zlib'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { gunzipSync, gzipStored } from '../src/save/gzip'

const STRATEGIES = [constants.Z_DEFAULT_STRATEGY, constants.Z_FILTERED, constants.Z_HUFFMAN_ONLY, constants.Z_RLE, constants.Z_FIXED]

/** Mostly-text bytes with repeats, so matches and long distances occur. */
const arbData = fc.oneof(
  fc.uint8Array({ maxLength: 4000 }),
  fc.array(fc.constantFrom('{"session_id":"s_01J9ZK3Q"', ',[0,1,"C",1,41250,80]', 'i:mat:f0182:v3', '\n', ' ', 'éü😀'), { maxLength: 400 }).map((a) => new TextEncoder().encode(a.join(''))),
)

describe('save gzip fallback vs Node zlib', () => {
  it('decodes zlib output at every level and strategy (property)', () => {
    fc.assert(
      fc.property(arbData, fc.integer({ min: 0, max: 9 }), fc.constantFrom(...STRATEGIES), fc.integer({ min: 9, max: 15 }), (data, level, strategy, windowBits) => {
        const gz = new Uint8Array(zlibGzip(data, { level, strategy, windowBits }))
        expect(gunzipSync(gz)).toEqual(data)
      }),
      { numRuns: 600 },
    )
  })

  it('zlib reads the stored-block gzip the fallback writes (property)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 3000 }), (data) => {
        expect(new Uint8Array(zlibGunzip(gzipStored(data)))).toEqual(data)
      }),
      { numRuns: 200 },
    )
    // Several 65,535-byte stored blocks.
    const big = new Uint8Array(200_003).map((_, i) => (i * 31 + (i >> 9)) & 0xff)
    expect(new Uint8Array(zlibGunzip(gzipStored(big)))).toEqual(big)
  })

  it('handles a large realistic save (≈ 10 sessions) compressed at level 9', () => {
    const rows = Array.from({ length: 1500 }, (_, i) => `["i:rotation:1.0.0:seed-${i}",0,"B",${i % 2},${1000 + ((i * 37) % 9000)},${50 + (i % 51)}]`)
    const data = new TextEncoder().encode(`{"responses":[${rows.join(',')}]}`)
    const gz = new Uint8Array(zlibGzip(data, { level: 9 }))
    expect(gunzipSync(gz)).toEqual(data)
  })
})
