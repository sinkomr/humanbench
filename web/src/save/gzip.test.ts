import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { gunzip, gzip } from './codec'
import { crc32, gunzipSync, GzipError, gzipStored, inflateRaw, isGzip } from './gzip'

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

// Node's zlib (level/strategy sweep) is cross-checked in web/scripts/save-gzip-zlib.test.ts;
// here the reference is the platform's CompressionStream / DecompressionStream.
describe('gzip fallback (DESIGN §8 copy code, browsers without CompressionStream)', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(enc('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array(0))).toBe(0)
  })

  it('the platform has native streams here, so the cross-checks below are real', () => {
    expect(typeof CompressionStream).toBe('function')
    expect(typeof DecompressionStream).toBe('function')
  })

  it('stored gzip is read by the native decompressor, and native gzip by the fallback (property)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 3000 }), async (data) => {
        const stored = gzipStored(data)
        expect(isGzip(stored)).toBe(true)
        expect(await gunzip(stored, { native: true })).toEqual(data)
        expect(gunzipSync(stored)).toEqual(data)
        const native = await gzip(data, { native: true })
        expect(gunzipSync(native)).toEqual(data)
      }),
      { numRuns: 150 },
    )
  })

  it('reads natively compressed text with long matches (dynamic Huffman blocks)', async () => {
    const text = enc(JSON.stringify(Array.from({ length: 3000 }, (_, i) => ['i:mat:1.0.0:s' + (i % 97), i % 2, 'C', 1, 1000 + (i % 13), 80])))
    const native = await gzip(text, { native: true })
    expect(native.length).toBeLessThan(text.length / 5)
    expect(gunzipSync(native)).toEqual(text)
  })

  it('splits stored blocks at 65,535 bytes', () => {
    const data = new Uint8Array(200_000).map((_, i) => (i * 7) & 0xff)
    const out = gzipStored(data)
    expect(out.length).toBe(10 + data.length + 5 * 4 + 8)
    expect(gunzipSync(out)).toEqual(data)
    expect(gunzipSync(gzipStored(new Uint8Array(0)))).toEqual(new Uint8Array(0))
  })

  it('skips optional header fields (FEXTRA, FNAME, FCOMMENT, FHCRC)', () => {
    const body = gzipStored(enc('hello')).subarray(10)
    const header = [0x1f, 0x8b, 8, 4 | 8 | 16 | 2, 0, 0, 0, 0, 0, 3]
    const extra = [3, 0, 1, 2, 3]
    const name = [...enc('save.json'), 0]
    const comment = [...enc('hi'), 0]
    const hcrc = [0, 0]
    const all = new Uint8Array([...header, ...extra, ...name, ...comment, ...hcrc, ...body])
    expect(new TextDecoder().decode(gunzipSync(all))).toBe('hello')
  })

  it('decodes a fixed-Huffman block (RFC 1951 §3.2.6)', () => {
    // "a" with fixed codes: BFINAL=1, BTYPE=01, literal 'a' (0x61 → 8-bit code 0x91), end-of-block (7 zero bits).
    // Bits LSB-first: 1, 1 0, then code 10010001 MSB-first, then 0000000.
    const bits = [1, 1, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]
    const bytes = new Uint8Array(Math.ceil(bits.length / 8))
    bits.forEach((b, i) => (bytes[i >> 3] = (bytes[i >> 3] ?? 0) | (b << (i & 7))))
    expect(new TextDecoder().decode(inflateRaw(bytes).data)).toBe('a')
  })

  it('rejects corrupt input with a GzipError and never returns wrong data (property)', async () => {
    const data = enc(JSON.stringify({ sessions: Array.from({ length: 40 }, (_, i) => ({ i, t: 'abc'.repeat(i % 5) })) }))
    const good = await gzip(data, { native: true })
    await fc.assert(
      fc.asyncProperty(fc.nat(good.length - 1), fc.integer({ min: 1, max: 255 }), async (pos, flip) => {
        const bad = good.slice()
        bad[pos] = bad[pos]! ^ flip
        try {
          expect(gunzipSync(bad)).toEqual(data)
        } catch (e) {
          expect(e).toBeInstanceOf(GzipError)
        }
      }),
      { numRuns: 500 },
    )
    for (const n of [0, 5, 17, good.length - 1]) expect(() => gunzipSync(good.subarray(0, n))).toThrow(GzipError)
    expect(() => gunzipSync(enc('{"not":"gzip"}'))).toThrow(GzipError)
  })

  it('caps the output (a pasted code cannot expand without bound)', async () => {
    const zeros = new Uint8Array(1_000_000)
    const native = await gzip(zeros, { native: true })
    expect(native.length).toBeLessThan(5000)
    expect(() => gunzipSync(native, 100_000)).toThrow(/exceeds/)
    await expect(gunzip(native, { native: true, maxBytes: 100_000 })).rejects.toThrow(/exceeds/)
    await expect(gunzip(native, { native: false, maxBytes: 100_000 })).rejects.toThrow(/exceeds/)
    expect((await gunzip(native, { native: false })).length).toBe(1_000_000)
  })

  it('native gunzip errors surface as GzipError', async () => {
    await expect(gunzip(new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3]), { native: true })).rejects.toBeInstanceOf(GzipError)
  })
})
