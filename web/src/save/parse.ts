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
 * {@link ParseFailure} with a code (stable, for code and tests) and a `message` the UI shows as it is:
 * plain words that name the likely cause and the next step, with none of the format's own terms
 * (JSON, gzip, schema versions); the technical reason, where there is one, is in `details`.
 * The wording follows where the input came from ({@link ParseSource}): a chosen file is "this file", pasted text is
 * "this text" or "this pasted save" and points at the file and the code as the next step. The default is the file's.
 */

import { base64Decode, gunzip, MAX_JSON_BYTES, type CodecOptions } from './codec'
import { GzipError, isGzip } from './gzip'
import { isUsableCache } from './merge'
import { isNewerVersion, migrateToCurrent, MIGRATIONS, type Migration } from './migrate'
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
  /** Plain words for the person: what is wrong and what to do next. Shown as it is. */
  message: string
  /** For developers, not shown: schema errors (JSON-pointer paths) for `invalid`, and for a newer-minor `newer_version`; the upgrade step that failed. */
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

/** Where the input came from, which decides what the messages point at: a file that was chosen, or text that was pasted or typed. */
export type ParseSource = 'file' | 'paste'

// What the person is told (UX-012b). Every message says what is wrong and what to do; the ones for a file or a text that
// is not a save keep the words "not a HumanBench save".
const FILE_HINT = 'its name ends in .hbsave.json; on an iPhone it may end in .txt'
const NOT_A_SAVE: Readonly<Record<ParseSource, string>> = {
  file: `This file is not a HumanBench save. Choose the file you downloaded at the end of a session (${FILE_HINT}), or paste a save code.`,
  paste: 'This text is not a HumanBench save or save code. Choose your downloaded save file, or paste the save code you copied.',
}
const CUT_OFF: Readonly<Record<ParseSource, string>> = {
  file: 'This save file looks cut off or damaged, so it cannot be read. Download it again from your results, or paste a save code instead.',
  paste: 'This pasted save looks cut off or damaged, so it cannot be read. Copy it again in full, or choose your downloaded save file.',
}
const DAMAGED: Readonly<Record<ParseSource, string>> = {
  file: 'This save file is damaged or was edited into an unreadable form. Download it again from your results, or paste a save code instead.',
  paste: 'This pasted save is damaged or was edited into an unreadable form. Copy it again from your results, or choose your downloaded save file.',
}
const CANNOT_OPEN: Readonly<Record<ParseSource, string>> = {
  file: 'This save cannot be opened by this version of HumanBench. Reload the page and try again; if it still fails, the file may be damaged.',
  paste: 'This save cannot be opened by this version of HumanBench. Reload the page and try again; if it still fails, the pasted text may be damaged.',
}
const EMPTY_FILE = 'That file is empty. Choose your save file again, or paste a save code.'
const EMPTY_TEXT = 'There is nothing to load. Choose your save file, or paste a save code.'
const FILE_TOO_LARGE = 'That file is too large to be a HumanBench save (a save is well under a megabyte). Choose the file whose name ends in .hbsave.json.'
const TEXT_TOO_LARGE = 'That text is too large to be a HumanBench save (a save is well under a megabyte). Choose your save file, or paste the save code you copied.'
const SAVE_TOO_LARGE = 'This save is too large to open (a save is well under a megabyte). Choose the file whose name ends in .hbsave.json.'
const NEWER_VERSION = 'This save was made by a newer version of HumanBench. Reload the page to update, then try again.'
const FILE_UNREADABLE = 'The file could not be read. Try choosing it again.'
const PASTE_UNREADABLE = 'The pasted content could not be read. Try pasting it again, or choose your save file.'

const fail = (code: ParseErrorCode, message: string, details?: string[]): ParseFailure =>
  details === undefined ? { ok: false, code, message } : { ok: false, code, message, details }

/**
 * Validate and migrate an already-parsed JSON document. `source` is where it came from; it only decides the wording of a
 * failure, and the default is a file's, which is what every caller that holds a document read from storage wants.
 */
export function loadSaveDocument(doc: unknown, format: ParseSuccess['format'] = 'json', opts: ParseOptions = {}, source: ParseSource = 'file'): ParseResult {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return fail('not_a_save', NOT_A_SAVE[source])
  const m = migrateToCurrent(doc, opts.migrations ?? MIGRATIONS)
  if (!m.ok) {
    if (m.code === 'newer_version') return fail('newer_version', NEWER_VERSION)
    if (m.code === 'unknown_version') {
      const looksLikeSave = 'sessions' in doc || 'anon_id' in doc
      return looksLikeSave ? fail('unknown_version', CANNOT_OPEN[source], [m.message]) : fail('not_a_save', NOT_A_SAVE[source])
    }
    return fail('invalid', CANNOT_OPEN[source], [m.message])
  }
  const v = validateSave(m.doc)
  if (!v.ok) {
    // A newer minor of this major may add fields or values (additive, `migrate.ts`): ask for a
    // reload rather than calling the file damaged, and never strip what this build does not know.
    if (isNewerVersion(m.doc)) return fail('newer_version', NEWER_VERSION, v.errors)
    return fail('invalid', DAMAGED[source], v.errors)
  }
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

function parseJson(text: string, format: ParseSuccess['format'], opts: ParseOptions, source: ParseSource): ParseResult {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    return fail('not_a_save', CUT_OFF[source])
  }
  return loadSaveDocument(doc, format, opts, source)
}

const CORRUPT_CODE = 'The save code is incomplete or damaged. Copy it again in full.'

/** gzip bytes → JSON → save. */
async function fromGzip(bytes: Uint8Array, format: ParseSuccess['format'], opts: ParseOptions, source: ParseSource): Promise<ParseResult> {
  let raw: Uint8Array
  try {
    raw = await gunzip(bytes, { ...opts, maxBytes: opts.maxBytes ?? MAX_JSON_BYTES })
  } catch (e) {
    const tooLarge = e instanceof GzipError && /exceeds/.test(e.message)
    return tooLarge ? fail('too_large', SAVE_TOO_LARGE) : fail('corrupt_code', CORRUPT_CODE)
  }
  const text = decodeText(raw)
  if (text === null) return fail('corrupt_code', CORRUPT_CODE)
  return fromText(text, format, opts, source, false)
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

/** `source`: where the text came from, which decides what the "not a save" and "cut off" messages point at (a file is chosen, a code is pasted). */
async function fromText(text: string, format: ParseSuccess['format'], opts: ParseOptions, source: ParseSource, allowCode = true): Promise<ParseResult> {
  const t = text.replace(/^\uFEFF/, '').trim()
  if (t.length === 0) return fail('empty', EMPTY_TEXT)
  if (t.startsWith('{')) return parseJson(t, format, opts, source)
  // Unpacked gzip that is not a save: a pasted code says so about the text, a chosen file about the file.
  if (!allowCode) return fail('not_a_save', NOT_A_SAVE[source])
  const candidates = [t.replace(/^["'`]|["'`]$/g, ''), ...embeddedCodes(t)]
  let sawGzip = false
  for (const c of candidates) {
    const bytes = base64Decode(c)
    if (bytes === null || bytes.length === 0) continue
    if (isGzip(bytes)) {
      sawGzip = true
      const r = await fromGzip(bytes, 'code', opts, source)
      if (r.ok || r.code !== 'corrupt_code') return r
      continue
    }
    const inner = decodeText(bytes)
    if (inner !== null && inner.trim().startsWith('{')) return parseJson(inner.trim(), 'code', opts, source)
  }
  if (sawGzip || /H4sI/.test(t)) return fail('corrupt_code', CORRUPT_CODE)
  return fail('not_a_save', NOT_A_SAVE[source])
}

/** Load a save from raw bytes (a file's content), sniffing gzip, JSON or a copy code. */
export async function parseSaveBytes(bytes: Uint8Array, opts: ParseOptions = {}): Promise<ParseResult> {
  if (bytes.length === 0) return fail('empty', EMPTY_FILE)
  if (bytes.length > MAX_INPUT_BYTES) return fail('too_large', FILE_TOO_LARGE)
  if (isGzip(bytes)) return fromGzip(bytes, 'gzip', opts, 'file')
  const text = decodeText(bytes)
  if (text === null) return fail('not_a_save', NOT_A_SAVE.file)
  return fromText(text, 'json', opts, 'file')
}

/** Load a save from pasted or typed text: JSON or a copy code. */
export async function parseSaveText(text: string, opts: ParseOptions = {}): Promise<ParseResult> {
  if (text.length > MAX_INPUT_BYTES) return fail('too_large', TEXT_TOO_LARGE)
  return fromText(text, 'json', opts, 'paste')
}

/** Load a save from an uploaded file (`<input type="file">`), whatever its name or type. */
export async function readSaveFile(file: Blob, opts: ParseOptions = {}): Promise<ParseResult> {
  if (file.size > MAX_INPUT_BYTES) return fail('too_large', FILE_TOO_LARGE)
  let buf: ArrayBuffer
  try {
    buf = await file.arrayBuffer()
  } catch {
    return fail('read_failed', FILE_UNREADABLE)
  }
  return parseSaveBytes(new Uint8Array(buf), opts)
}

/**
 * Load a save from a paste or drop (`ClipboardEvent.clipboardData`, `DragEvent.dataTransfer`): a
 * file if one is attached, else the plain text.
 */
export async function readSaveFromDataTransfer(dt: Pick<DataTransfer, 'files' | 'getData'> | null, opts: ParseOptions = {}): Promise<ParseResult> {
  if (dt === null) return fail('empty', EMPTY_TEXT)
  const file = dt.files.length > 0 ? dt.files[0] : undefined
  if (file !== undefined) return readSaveFile(file, opts)
  let text = ''
  try {
    text = dt.getData('text/plain') || dt.getData('text')
  } catch {
    return fail('read_failed', PASTE_UNREADABLE)
  }
  return parseSaveText(text, opts)
}
