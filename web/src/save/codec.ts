/**
 * Byte codecs for the save file (DESIGN §8 "Download and upload compatibility"):
 * - the "copy save code": base64url(gzip(UTF-8(RFC 8785 JSON))), no padding, pasteable into Notes;
 * - gzip via the native `CompressionStream` / `DecompressionStream` where available, else the
 *   small fallback in `gzip.ts` (stored-block gzip out, full inflate in);
 * - base64 / base64url in either direction (standard alphabet, padding and whitespace accepted on
 *   input, since codes get re-wrapped by mail and note apps).
 */

import { GzipError, gunzipSync, gzipStored } from './gzip'
import { jcs } from './jcs'
import type { SaveFileV1 } from './types'

/** Cap on decompressed bytes: far above any real save (§8: ~150 KB after 10 sessions). */
export const MAX_JSON_BYTES = 32 * 1024 * 1024

export interface CodecOptions {
  /** Use the native streams when present (default true); false forces the fallback (tests). */
  native?: boolean
  /** Output cap for decompression (default {@link MAX_JSON_BYTES}). */
  maxBytes?: number
}

const hasNativeCompress = (): boolean => typeof globalThis.CompressionStream === 'function'
const hasNativeDecompress = (): boolean => typeof globalThis.DecompressionStream === 'function'

async function readAll(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new GzipError(`output exceeds ${maxBytes} bytes`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const out = new Uint8Array(total)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

function streamOf(bytes: Uint8Array): ReadableStream<BufferSource> {
  return new ReadableStream<BufferSource>({
    start(controller) {
      // A copy: the streams take ArrayBuffer-backed views (not SharedArrayBuffer).
      controller.enqueue(new Uint8Array(bytes))
      controller.close()
    },
  })
}

/** gzip `bytes` (native stream, else stored-block gzip). */
export async function gzip(bytes: Uint8Array, opts: CodecOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
  if ((opts.native ?? true) && hasNativeCompress()) {
    return readAll(streamOf(bytes).pipeThrough(new CompressionStream('gzip')), Number.MAX_SAFE_INTEGER)
  }
  return gzipStored(bytes)
}

/** gunzip `bytes` (native stream, else the fallback inflater); throws a GzipError when malformed. */
export async function gunzip(bytes: Uint8Array, opts: CodecOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
  const max = opts.maxBytes ?? MAX_JSON_BYTES
  if ((opts.native ?? true) && hasNativeDecompress()) {
    try {
      return await readAll(streamOf(bytes).pipeThrough(new DecompressionStream('gzip')), max)
    } catch (e) {
      if (e instanceof GzipError) throw e
      throw new GzipError(`gzip data is corrupt: ${String(e)}`)
    }
  }
  return gunzipSync(bytes, max)
}

/** base64url without padding (RFC 4648 §5). */
export function base64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Decode base64 or base64url (padding optional, whitespace ignored); null if `text` is not
 * base64 in either alphabet.
 */
export function base64Decode(text: string): Uint8Array<ArrayBuffer> | null {
  const s = text.replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(s)) return null
  const body = s.replace(/=+$/, '')
  if (body.length % 4 === 1) return null
  const std = body.replace(/-/g, '+').replace(/_/g, '/')
  let bin: string
  try {
    bin = atob(std + '='.repeat((4 - (std.length % 4)) % 4))
  } catch {
    return null
  }
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** The "copy save code" of `save`: base64url(gzip(UTF-8(jcs(save)))) (§8). */
export async function encodeSaveCode(save: SaveFileV1, opts: CodecOptions = {}): Promise<string> {
  return base64urlEncode(await gzip(new TextEncoder().encode(jcs(save)), opts))
}
