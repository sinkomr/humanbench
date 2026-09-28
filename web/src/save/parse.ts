/**
 * Loading a save by *content*, never by file name or MIME type (DESIGN §8: "iOS may rename the
 * file with a `.txt` suffix, so parse by content, not extension. Also allow 'paste code'.").
 *
 * Accepted inputs, sniffed in this order:
 * 1. gzip bytes (magic 1f 8b), e.g. a saved copy code decoded elsewhere;
 * 2. text (UTF-8, or UTF-16 with a BOM): JSON when it starts with `{`;
 * 3. otherwise a copy code: base64 or base64url of gzip (or of plain JSON), with any whitespace,
 *    and possibly surrounded by other pasted text (the code is found by its `H4sI` gzip prefix).
 * The JSON is then migrated to the current major (§8 merge step 5, `migrate.ts`) and validated
 * against schema v1 (`validate.ts`). Nothing here throws on bad input: every failure is a
 * {@link ParseFailure} with a code the UI maps to plain, non-diagnostic copy.
 */

import { base64Decode, gunzip, MAX_JSON_BYTES, type CodecOptions } from './codec'
import { GzipError, isGzip } from './gzip'
import { isUsableCache } from './merge'
import { migrateToCurrent, MIGRATIONS, type Migration } from './migrate'
import type { SaveFileV1 } from './types'
import { validateSave } from './validate'

/** Cap on an uploaded file or pasted text (compressed or not): far above any real save. */
export const MAX_INPUT_BYTES = 8 * 1024 * 1024

export type ParseErrorCode =
  | 'empty'
  | 'too_large'
  | 'not_a_save'
  | 'corrupt_code'
  | 'invalid'
  | 'newer_version'
  | 'unknown_version'
  | 'read_failed'

export interface ParseFailure {
  ok: false
  code: ParseErrorCode
  message: string
  /** Schema errors (JSON-pointer paths) for `invalid`. */
  details?: string[]
}

export interface ParseSuccess {
  ok: true
  save: SaveFileV1
  /** How the input was encoded. */
  format: 'json' | 'gzip' | 'code'
  /** Majors migrated through, e.g. [0] for a v0 file. */
  migrated: number[]
  /** Non-fatal notes, e.g. a posterior cache that cannot be used and will be recomputed. */
  warnings: string[]
}

export type ParseResult = ParseSuccess | ParseFailure

export interface ParseOptions extends CodecOptions {
  /** Migration registry (tests inject a fake one). */
  migrations?: ReadonlyMap<number, Migration>
  /** If given, warn when the posterior cache cannot be used under this parameter version. */
  paramVersion?: string
}

const fail = (code: ParseErrorCode, message: string, details?: string[]): ParseFailure =>
  details === undefined ? { ok: false, code, message } : { ok: false, code, message, details }

/** Validate and migrate an already-parsed JSON document. */
export function loadSaveDocument(doc: unknown, format: ParseSuccess['format'] = 'json', opts: ParseOptions = {}): ParseResult {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return fail('not_a_save', 'The content is JSON but not a HumanBench save.')
  const m = migrateToCurrent(doc, opts.migrations ?? MIGRATIONS)
  if (!m.ok) {
    if (m.code === 'newer_version') return fail('newer_version', 'This save was made by a newer version of HumanBench. Reload the page to update, then try again.')
    if (m.code === 'unknown_version') {
      const looksLikeSave = 'sessions' in doc || 'anon_id' in doc
      return looksLikeSave ? fail('unknown_version', `This save's format version cannot be read (${m.message}).`) : fail('not_a_save', 'The content is JSON but not a HumanBench save.')
    }
    return fail('invalid', `This save could not be upgraded (${m.message}).`)
  }
  const v = validateSave(m.doc)
  if (!v.ok) return fail('invalid', 'This save file is damaged or was edited into an unreadable form.', v.errors)
  const warnings: string[] = []
  const cache = v.save.posterior_cache
  if (cache !== undefined && opts.paramVersion !== undefined && !isUsableCache(cache, opts.paramVersion)) {
    warnings.push('posterior_cache is stale or inconsistent; results are recomputed from the responses')
  }
  return { ok: true, save: v.save, format, migrated: m.applied, warnings }
}

function decodeText(bytes: Uint8Array): string | null {
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2))
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function parseJson(text: string, format: ParseSuccess['format'], opts: ParseOptions): ParseResult {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    return fail('not_a_save', 'The content looks like JSON but is not valid JSON.')
  }
  return loadSaveDocument(doc, format, opts)
}

const CORRUPT_CODE = 'The save code is incomplete or damaged. Copy it again in full.'

/** gzip bytes → JSON → save. */
async function fromGzip(bytes: Uint8Array, format: ParseSuccess['format'], opts: ParseOptions): Promise<ParseResult> {
  let raw: Uint8Array
  try {
    raw = await gunzip(bytes, { ...opts, maxBytes: opts.maxBytes ?? MAX_JSON_BYTES })
  } catch (e) {
    const tooLarge = e instanceof GzipError && /exceeds/.test(e.message)
    return tooLarge ? fail('too_large', 'The save is too large to open.') : fail('corrupt_code', CORRUPT_CODE)
  }
  const text = decodeText(raw)
  if (text === null) return fail('corrupt_code', 'The save code does not contain text.')
  return fromText(text, format, opts, false)
}

/**
 * Copy-code candidates inside other pasted text: the base64/base64url run starting at the gzip
 * prefix `H4sI`. Mail clients wrap long lines, so the run may span line breaks; a following line
 * of ordinary words also looks like base64, so every prefix of whole lines is tried, longest first.
 */
function embeddedCodes(text: string): string[] {
  const m = /H4sI(?:[A-Za-z0-9+/_-]|\r?\n)*={0,2}/.exec(text)
  if (!m) return []
  const lines = m[0].split(/\r?\n/)
  const out: string[] = []
  for (let k = lines.length; k >= 1; k--) out.push(lines.slice(0, k).join(''))
  return out
}

async function fromText(text: string, format: ParseSuccess['format'], opts: ParseOptions, allowCode = true): Promise<ParseResult> {
  const t = text.replace(/^\uFEFF/, '').trim()
  if (t.length === 0) return fail('empty', 'There is nothing to load.')
  if (t.startsWith('{')) return parseJson(t, format, opts)
  if (!allowCode) return fail('not_a_save', 'The content is not a HumanBench save.')
  const candidates = [t.replace(/^["'`]|["'`]$/g, ''), ...embeddedCodes(t)]
  let sawGzip = false
  for (const c of candidates) {
    const bytes = base64Decode(c)
    if (bytes === null || bytes.length === 0) continue
    if (isGzip(bytes)) {
      sawGzip = true
      const r = await fromGzip(bytes, 'code', opts)
      if (r.ok || r.code !== 'corrupt_code') return r
      continue
    }
    const inner = decodeText(bytes)
    if (inner !== null && inner.trim().startsWith('{')) return parseJson(inner.trim(), 'code', opts)
  }
  if (sawGzip || /H4sI/.test(t)) return fail('corrupt_code', CORRUPT_CODE)
  return fail('not_a_save', 'The content is not a HumanBench save or save code.')
}

/** Load a save from raw bytes (a file's content), sniffing gzip, JSON or a copy code. */
export async function parseSaveBytes(bytes: Uint8Array, opts: ParseOptions = {}): Promise<ParseResult> {
  if (bytes.length === 0) return fail('empty', 'The file is empty.')
  if (bytes.length > MAX_INPUT_BYTES) return fail('too_large', 'The file is too large to be a HumanBench save.')
  if (isGzip(bytes)) return fromGzip(bytes, 'gzip', opts)
  const text = decodeText(bytes)
  if (text === null) return fail('not_a_save', 'The file is not text or gzip, so it is not a HumanBench save.')
  return fromText(text, 'json', opts)
}

/** Load a save from pasted or typed text: JSON or a copy code. */
export async function parseSaveText(text: string, opts: ParseOptions = {}): Promise<ParseResult> {
  if (text.length > MAX_INPUT_BYTES) return fail('too_large', 'The pasted text is too large to be a HumanBench save.')
  return fromText(text, 'json', opts)
}

/** Load a save from an uploaded file (`<input type="file">`), whatever its name or type. */
export async function readSaveFile(file: Blob, opts: ParseOptions = {}): Promise<ParseResult> {
  if (file.size > MAX_INPUT_BYTES) return fail('too_large', 'The file is too large to be a HumanBench save.')
  let buf: ArrayBuffer
  try {
    buf = await file.arrayBuffer()
  } catch {
    return fail('read_failed', 'The file could not be read. Try choosing it again.')
  }
  return parseSaveBytes(new Uint8Array(buf), opts)
}

/**
 * Load a save from a paste or drop (`ClipboardEvent.clipboardData`, `DragEvent.dataTransfer`): a
 * file if one is attached, else the plain text.
 */
export async function readSaveFromDataTransfer(dt: Pick<DataTransfer, 'files' | 'getData'> | null, opts: ParseOptions = {}): Promise<ParseResult> {
  if (dt === null) return fail('empty', 'There is nothing to load.')
  const file = dt.files.length > 0 ? dt.files[0] : undefined
  if (file !== undefined) return readSaveFile(file, opts)
  let text = ''
  try {
    text = dt.getData('text/plain') || dt.getData('text')
  } catch {
    return fail('read_failed', 'The pasted content could not be read.')
  }
  return parseSaveText(text, opts)
}
