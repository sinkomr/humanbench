/**
 * gzip (RFC 1952) for the "copy save code" route (DESIGN §8: gzip + base64url, pasteable into
 * Notes), with a dependency-free fallback for browsers without `CompressionStream` /
 * `DecompressionStream` (Safari < 16.4, Firefox < 113):
 * - {@link gzipStored}: a valid gzip member whose DEFLATE blocks are stored (uncompressed), so any
 *   gunzip reads it; larger than compressed output, but always correct. Known limit: on that
 *   path the copy code is ~1.33× the JSON rather than §8's "~40 KB" (a 10-session save of ~80 KB
 *   JSON gives a ~110 KB code vs ~7 KB natively). Accepted for the MVP: only the browsers above
 *   take it, and download / Web Share are unaffected; a fixed-Huffman encoder would fix it.
 * - {@link gunzipSync}: a small DEFLATE decoder (RFC 1951; after Mark Adler's puff.c) that reads
 *   any gzip, compressed or not, with CRC-32 and length checks and an output cap (a code pasted
 *   from elsewhere cannot expand without bound).
 * `codec.ts` prefers the native streams and falls back to these; `gzip.test.ts` checks both
 * against Node's zlib.
 */

export class GzipError extends Error {
  override name = 'GzipError'
}

let CRC_TABLE: Uint32Array | undefined

/** CRC-32 (IEEE 802.3, as gzip uses). */
export function crc32(bytes: Uint8Array): number {
  if (CRC_TABLE === undefined) {
    CRC_TABLE = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c >>> 0
    }
  }
  const table = CRC_TABLE
  let c = 0xffffffff
  for (const b of bytes) c = (table[(c ^ b) & 0xff] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** True iff `bytes` starts with the gzip magic 1f 8b. */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

const STORED_MAX = 0xffff

/** A gzip member holding `data` in stored DEFLATE blocks (no compression; mtime 0, OS unknown). */
export function gzipStored(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const blocks = Math.max(1, Math.ceil(data.length / STORED_MAX))
  const out = new Uint8Array(10 + data.length + 5 * blocks + 8)
  out.set([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff])
  let o = 10
  for (let i = 0; i < blocks; i++) {
    const chunk = data.subarray(i * STORED_MAX, Math.min(data.length, (i + 1) * STORED_MAX))
    const len = chunk.length
    out[o++] = i === blocks - 1 ? 1 : 0
    out[o++] = len & 0xff
    out[o++] = len >>> 8
    out[o++] = ~len & 0xff
    out[o++] = (~len >>> 8) & 0xff
    out.set(chunk, o)
    o += len
  }
  const dv = new DataView(out.buffer)
  dv.setUint32(o, crc32(data), true)
  dv.setUint32(o + 4, data.length >>> 0, true)
  return out
}

// ---- inflate (RFC 1951) -----------------------------------------------------------------------

const MAXBITS = 15
const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

interface Huffman {
  count: Uint16Array
  symbol: Uint16Array
}

/** Canonical Huffman table from code lengths; rejects over-subscribed sets (puff `construct`). */
function huffman(lengths: ArrayLike<number>, n: number): { h: Huffman; left: number } {
  const count = new Uint16Array(MAXBITS + 1)
  for (let s = 0; s < n; s++) {
    const len = lengths[s] as number
    count[len] = (count[len] as number) + 1
  }
  const h: Huffman = { count, symbol: new Uint16Array(n) }
  if (count[0] === n) return { h, left: 0 }
  let left = 1
  for (let len = 1; len <= MAXBITS; len++) {
    left <<= 1
    left -= count[len] as number
    if (left < 0) throw new GzipError('over-subscribed Huffman code')
  }
  const offs = new Uint16Array(MAXBITS + 1)
  for (let len = 1; len < MAXBITS; len++) offs[len + 1] = (offs[len] as number) + (count[len] as number)
  for (let s = 0; s < n; s++) {
    const len = lengths[s] as number
    if (len !== 0) {
      const o = offs[len] as number
      h.symbol[o] = s
      offs[len] = o + 1
    }
  }
  return { h, left }
}

class Inflater {
  private pos: number
  private bitbuf = 0
  private bitcnt = 0
  private out: Uint8Array<ArrayBuffer>
  private outLen = 0

  constructor(
    private readonly src: Uint8Array,
    start: number,
    private readonly maxOut: number,
  ) {
    this.pos = start
    this.out = new Uint8Array(Math.min(maxOut, Math.max(1024, src.length * 4)))
  }

  /** Byte offset just past the DEFLATE stream (after {@link run}). */
  get end(): number {
    return this.pos
  }

  private bits(need: number): number {
    let val = this.bitbuf
    while (this.bitcnt < need) {
      if (this.pos >= this.src.length) throw new GzipError('truncated DEFLATE stream')
      val |= (this.src[this.pos++] as number) << this.bitcnt
      this.bitcnt += 8
    }
    this.bitbuf = val >>> need
    this.bitcnt -= need
    return val & ((1 << need) - 1)
  }

  private put(b: number): void {
    if (this.outLen >= this.out.length) {
      if (this.outLen >= this.maxOut) throw new GzipError(`output exceeds ${this.maxOut} bytes`)
      const next = new Uint8Array(Math.min(this.maxOut, this.out.length * 2))
      next.set(this.out)
      this.out = next
    }
    this.out[this.outLen++] = b
  }

  private decode(h: Huffman): number {
    let code = 0
    let first = 0
    let index = 0
    for (let len = 1; len <= MAXBITS; len++) {
      code |= this.bits(1)
      const count = h.count[len] as number
      if (code - count < first) return h.symbol[index + (code - first)] as number
      index += count
      first += count
      first <<= 1
      code <<= 1
    }
    throw new GzipError('invalid Huffman code')
  }

  private stored(): void {
    this.bitbuf = 0
    this.bitcnt = 0
    if (this.pos + 4 > this.src.length) throw new GzipError('truncated stored block')
    const len = (this.src[this.pos] as number) | ((this.src[this.pos + 1] as number) << 8)
    const nlen = (this.src[this.pos + 2] as number) | ((this.src[this.pos + 3] as number) << 8)
    this.pos += 4
    if (len !== (~nlen & 0xffff)) throw new GzipError('stored block length check failed')
    if (this.pos + len > this.src.length) throw new GzipError('truncated stored block')
    for (let i = 0; i < len; i++) this.put(this.src[this.pos + i] as number)
    this.pos += len
  }

  private codes(lencode: Huffman, distcode: Huffman): void {
    for (;;) {
      let sym = this.decode(lencode)
      if (sym < 256) {
        this.put(sym)
      } else if (sym === 256) {
        return
      } else {
        sym -= 257
        if (sym >= 29) throw new GzipError('invalid length symbol')
        const len = (LBASE[sym] as number) + this.bits(LEXT[sym] as number)
        const dsym = this.decode(distcode)
        if (dsym >= 30) throw new GzipError('invalid distance symbol')
        const dist = (DBASE[dsym] as number) + this.bits(DEXT[dsym] as number)
        if (dist > this.outLen) throw new GzipError('distance too far back')
        for (let i = 0; i < len; i++) this.put(this.out[this.outLen - dist] as number)
      }
    }
  }

  private static fixedTables: { len: Huffman; dist: Huffman } | undefined

  private fixed(): void {
    if (Inflater.fixedTables === undefined) {
      const l = new Uint8Array(288)
      l.fill(8, 0, 144)
      l.fill(9, 144, 256)
      l.fill(7, 256, 280)
      l.fill(8, 280, 288)
      const d = new Uint8Array(30).fill(5)
      Inflater.fixedTables = { len: huffman(l, 288).h, dist: huffman(d, 30).h }
    }
    this.codes(Inflater.fixedTables.len, Inflater.fixedTables.dist)
  }

  private dynamic(): void {
    const nlen = this.bits(5) + 257
    const ndist = this.bits(5) + 1
    const ncode = this.bits(4) + 4
    if (nlen > 286 || ndist > 30) throw new GzipError('bad dynamic block counts')
    const lengths = new Uint8Array(320)
    for (let i = 0; i < ncode; i++) lengths[CL_ORDER[i] as number] = this.bits(3)
    const cl = huffman(lengths, 19)
    if (cl.left !== 0) throw new GzipError('incomplete code-length code')
    lengths.fill(0)
    let index = 0
    while (index < nlen + ndist) {
      let sym = this.decode(cl.h)
      if (sym < 16) {
        lengths[index++] = sym
        continue
      }
      let len = 0
      if (sym === 16) {
        if (index === 0) throw new GzipError('repeat with no first length')
        len = lengths[index - 1] as number
        sym = 3 + this.bits(2)
      } else if (sym === 17) {
        sym = 3 + this.bits(3)
      } else {
        sym = 11 + this.bits(7)
      }
      if (index + sym > nlen + ndist) throw new GzipError('too many code lengths')
      while (sym--) lengths[index++] = len
    }
    if (lengths[256] === 0) throw new GzipError('no end-of-block code')
    const lc = huffman(lengths, nlen)
    // An incomplete code is allowed only for a single length-1 code (RFC 1951 §3.2.7, puff.c).
    const single = (hf: Huffman, n: number): boolean => n === (hf.count[0] as number) + (hf.count[1] as number)
    if (lc.left !== 0 && !single(lc.h, nlen)) throw new GzipError('incomplete literal/length code')
    const dc = huffman(lengths.subarray(nlen), ndist)
    if (dc.left !== 0 && !single(dc.h, ndist)) throw new GzipError('incomplete distance code')
    this.codes(lc.h, dc.h)
  }

  run(): Uint8Array<ArrayBuffer> {
    let last = 0
    do {
      last = this.bits(1)
      const type = this.bits(2)
      if (type === 0) this.stored()
      else if (type === 1) this.fixed()
      else if (type === 2) this.dynamic()
      else throw new GzipError('invalid block type')
    } while (!last)
    return this.out.slice(0, this.outLen)
  }
}

/** Raw DEFLATE decode of `src` from byte `start`; returns the data and the end offset. */
export function inflateRaw(src: Uint8Array, start = 0, maxOut = 64 * 1024 * 1024): { data: Uint8Array<ArrayBuffer>; end: number } {
  const inf = new Inflater(src, start, maxOut)
  const data = inf.run()
  return { data, end: inf.end }
}

/**
 * Decode one gzip member (RFC 1952), checking the header, CRC-32 and length. Throws a
 * {@link GzipError} on malformed input or output over `maxOut` bytes.
 */
export function gunzipSync(src: Uint8Array, maxOut = 64 * 1024 * 1024): Uint8Array<ArrayBuffer> {
  if (src.length < 18 || !isGzip(src)) throw new GzipError('not gzip data')
  if (src[2] !== 8) throw new GzipError('unknown gzip compression method')
  const flg = src[3] as number
  if (flg & 0xe0) throw new GzipError('reserved gzip flags set')
  let p = 10
  const need = (n: number): void => {
    if (p + n > src.length) throw new GzipError('truncated gzip header')
  }
  if (flg & 4) {
    need(2)
    const xlen = (src[p] as number) | ((src[p + 1] as number) << 8)
    p += 2
    need(xlen)
    p += xlen
  }
  for (const bit of [8, 16]) {
    if (flg & bit) {
      while (p < src.length && src[p] !== 0) p++
      need(1)
      p++
    }
  }
  if (flg & 2) {
    need(2)
    p += 2
  }
  const { data, end } = inflateRaw(src, p, maxOut)
  if (end + 8 > src.length) throw new GzipError('truncated gzip trailer')
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength)
  if (dv.getUint32(end, true) !== crc32(data)) throw new GzipError('gzip CRC-32 mismatch')
  if (dv.getUint32(end + 4, true) !== data.length >>> 0) throw new GzipError('gzip length mismatch')
  return data
}
