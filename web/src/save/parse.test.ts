import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { base64Decode, base64urlEncode, encodeSaveCode, gzip } from './codec'
import { gzipStored } from './gzip'
import { jcs } from './jcs'
import { normalizeSave } from './merge'
import { MAX_INPUT_BYTES, loadSaveDocument, parseSaveBytes, parseSaveText, readSaveFile, readSaveFromDataTransfer, type ParseErrorCode, type ParseFailure, type ParseResult } from './parse'
import { arbSave, TEST_CTX } from './testing'
import { SCHEMA_URL, SCHEMA_VERSION, type SaveFileV1, type SaveSession } from './types'

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

function realisticSave(sessions = 1, perSession = 150): SaveFileV1 {
  const ss: SaveSession[] = Array.from({ length: sessions }, (_, k) => ({
    session_id: `s_01J9ZK3Q${'ABCDEFGHJK'[k] ?? 'Z'}`,
    started_utc: `2026-10-${String(3 + k).padStart(2, '0')}T17:20:02Z`,
    duration_s: 3411,
    device: { class: 'desktop', input: 'mouse', os_family: 'macOS', browser_family: 'Safari', refresh_hz_est: 120, timer_res_ms: 0.1, viewport: [1512, 861] },
    flags: { visibility_hidden_s: 14, paste_events: 0, fast_guess_n: 1 },
    responses: [
      ['i:rt:simple', 0, 'trials', null, 18211, null, Array.from({ length: 70 }, (_, i) => 220 + ((i * 37 + k) % 90))],
      ...Array.from({ length: perSession }, (_, i) => [`i:rotation:1.0.0:k${k}-${i}`, 0, 'ABCD'[i % 4] as string, (i * 7) % 3 === 0 ? 0 : 1, 5000 + ((i * 7919) % 40000), 50 + (i % 51)] as SaveSession['responses'][number]),
    ],
  }))
  return normalizeSave(
    {
      schema_version: SCHEMA_VERSION,
      bank_version: TEST_CTX.bank_version,
      anon_id: 'hb_7Q3m9Kx2Vw5rT8pL',
      created_utc: '2026-10-03T18:22:11Z',
      sessions: ss,
      seen_items: ss.flatMap((s) => s.responses.map((r) => r[0])).filter((id) => id.startsWith('i:rotation')),
      seen_families: ['f:rotation:0123456789ab'],
    },
    TEST_CTX,
  )
}

function expectSave(r: ParseResult, want: SaveFileV1, format?: string): void {
  if (!r.ok) throw new Error(`${r.code}: ${r.message} ${r.details?.join('; ') ?? ''}`)
  expect(jcs(r.save)).toBe(jcs(want))
  if (format !== undefined) expect(r.format).toBe(format)
}

function expectCode(r: ParseResult, code: string): void {
  expect(r.ok ? 'ok' : r.code).toBe(code)
  if (!r.ok) expect(r.message.length).toBeGreaterThan(10)
}

describe('base64 / base64url', () => {
  it('matches the RFC 4648 §10 vectors, with and without padding, in both alphabets', () => {
    const vectors: [string, string][] = [
      ['', ''],
      ['f', 'Zg'],
      ['fo', 'Zm8'],
      ['foo', 'Zm9v'],
      ['foob', 'Zm9vYg'],
      ['fooba', 'Zm9vYmE'],
      ['foobar', 'Zm9vYmFy'],
    ]
    for (const [plain, code] of vectors) {
      expect(base64urlEncode(enc(plain))).toBe(code)
      expect(base64Decode(code)).toEqual(enc(plain))
      expect(base64Decode(code + '='.repeat((4 - (code.length % 4)) % 4))).toEqual(enc(plain))
    }
    expect(base64urlEncode(new Uint8Array([0xfb, 0xff, 0xbf]))).toBe('-_-_')
    expect(base64Decode('+/+/')).toEqual(new Uint8Array([0xfb, 0xff, 0xbf]))
    expect(base64Decode(' Zm9v\nYmFy \r\n')).toEqual(enc('foobar'))
  })

  it('rejects non-base64', () => {
    for (const bad of ['Z', 'Zm9vY', 'Zm9v!', 'Zm=9v', 'a===', '{"a":1}', 'Zm9v Y*']) expect(base64Decode(bad)).toBeNull()
  })

  it('round-trips any bytes (property)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 70_000 }), (b) => {
        const code = base64urlEncode(b)
        expect(code).toMatch(/^[A-Za-z0-9_-]*$/)
        expect(base64Decode(code)).toEqual(b)
      }),
      { numRuns: 200 },
    )
  })
})

describe('copy save code (DESIGN §8: gzip + base64url)', () => {
  it('round-trips through the native and the fallback gzip, in every combination (property)', async () => {
    await fc.assert(
      fc.asyncProperty(arbSave(), fc.boolean(), fc.boolean(), async (s, nativeOut, nativeIn) => {
        const code = await encodeSaveCode(s, { native: nativeOut })
        expect(code).toMatch(/^H4sI[A-Za-z0-9_-]+$/)
        expectSave(await parseSaveText(code, { native: nativeIn }), s, 'code')
      }),
      { numRuns: 150 },
    )
  })

  it('a one-session save gives a code well under the §8 "~40 KB"', async () => {
    const s = realisticSave(1)
    const code = await encodeSaveCode(s)
    expect(jcs(s).length).toBeGreaterThan(9_000)
    expect(code.length).toBeLessThan(15_000)
    const ten = await encodeSaveCode(realisticSave(10))
    expect(ten.length).toBeLessThan(60_000)
    expectSave(await parseSaveText(ten), realisticSave(10))
  })
})

describe('upload by content (DESIGN §8: "parse by content, not extension")', () => {
  const save = realisticSave(1, 20)

  it('reads raw JSON bytes, compact or pretty, with or without a UTF-8 BOM', async () => {
    expectSave(await parseSaveBytes(enc(jcs(save))), save, 'json')
    expectSave(await parseSaveBytes(enc(JSON.stringify(save, null, 2))), save, 'json')
    expectSave(await parseSaveBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...enc(jcs(save))])), save, 'json')
    expectSave(await parseSaveBytes(enc(`\n\n  ${jcs(save)}\n`)), save, 'json')
  })

  it('reads UTF-16 text with a BOM (a file re-saved by a Windows editor)', async () => {
    const text = jcs(save)
    const le = new Uint8Array(2 + text.length * 2)
    le.set([0xff, 0xfe])
    const be = new Uint8Array(2 + text.length * 2)
    be.set([0xfe, 0xff])
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      le[2 + 2 * i] = c & 0xff
      le[3 + 2 * i] = c >> 8
      be[2 + 2 * i] = c >> 8
      be[3 + 2 * i] = c & 0xff
    }
    expectSave(await parseSaveBytes(le), save)
    expectSave(await parseSaveBytes(be), save)
  })

  it('reads gzip bytes (native or stored) and a file holding a copy code', async () => {
    expectSave(await parseSaveBytes(await gzip(enc(jcs(save)))), save, 'gzip')
    expectSave(await parseSaveBytes(gzipStored(enc(jcs(save)))), save, 'gzip')
    expectSave(await parseSaveBytes(enc(await encodeSaveCode(save))), save, 'code')
  })

  it('a .txt rename (iOS) or any other name and MIME type still parses', async () => {
    const text = jcs(save)
    const code = await encodeSaveCode(save)
    const files = [
      new File([text], 'humanbench-7Q3m9K-2026-10-03.hbsave.json', { type: 'application/json' }),
      new File([text], 'humanbench-7Q3m9K-2026-10-03.hbsave.json.txt', { type: 'text/plain' }),
      new File([text], 'humanbench-7Q3m9K-2026-10-03.hbsave', { type: '' }),
      new File([text], 'download', { type: 'application/octet-stream' }),
      new File([code], 'save code.txt', { type: 'text/plain' }),
      new File([await gzip(enc(text))], 'save.json.gz', { type: 'application/gzip' }),
    ]
    for (const f of files) expectSave(await readSaveFile(f), save)
  })

  it('reads a pasted copy code with line breaks, spaces, quotes or standard base64', async () => {
    const code = await encodeSaveCode(save)
    const wrapped = code.replace(/(.{60})/g, '$1\n')
    const std = code.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (code.length % 4)) % 4)
    for (const text of [code, `  ${code}\n`, wrapped, `"${code}"`, std, code.replace(/(.{7})/g, '$1 ')]) {
      expectSave(await parseSaveText(text), save, 'code')
    }
  })

  it('finds a code inside other pasted text (e.g. a note with a heading)', async () => {
    const code = await encodeSaveCode(save)
    expectSave(await parseSaveText(`HumanBench save code:\n${code}\n\nkept 3 Oct`), save, 'code')
    expectSave(await parseSaveText(`HumanBench save code:\n${code.replace(/(.{76})/g, '$1\r\n')}`), save, 'code')
  })

  it('reads base64 of plain JSON too', async () => {
    expectSave(await parseSaveText(base64urlEncode(enc(jcs(save)))), save, 'code')
  })

  it('pastes and drops via DataTransfer: a file wins, else the text', async () => {
    const code = await encodeSaveCode(save)
    const dt = (files: File[], text: string) => ({ files: files as unknown as FileList, getData: (t: string) => (t === 'text/plain' ? text : '') })
    expectSave(await readSaveFromDataTransfer(dt([], code)), save)
    expectSave(await readSaveFromDataTransfer(dt([new File([jcs(save)], 'x.txt')], 'ignored')), save)
    expectCode(await readSaveFromDataTransfer(null), 'empty')
    expectCode(await readSaveFromDataTransfer({ files: [] as unknown as FileList, getData: () => { throw new Error('denied') } }), 'read_failed')
  })

  it('refuses everything else with a specific code and never throws', async () => {
    expectCode(await parseSaveBytes(new Uint8Array(0)), 'empty')
    expectCode(await parseSaveText('   \n'), 'empty')
    expectCode(await parseSaveText('hello there'), 'not_a_save')
    expectCode(await parseSaveText('[1, 2, 3]'), 'not_a_save')
    expectCode(await parseSaveText('{"a": 1}'), 'not_a_save')
    expectCode(await parseSaveText('{"sessions": ['), 'not_a_save')
    expectCode(await parseSaveBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])), 'not_a_save')
    const code = await encodeSaveCode(save)
    expectCode(await parseSaveText(code.slice(0, code.length - 20)), 'corrupt_code')
    expectCode(await parseSaveText(code.slice(0, 30)), 'corrupt_code')
    expectCode(await parseSaveText(JSON.stringify({ ...save, schema_version: '2.0.0' })), 'newer_version')
    expectCode(await parseSaveText(JSON.stringify({ ...save, schema_version: 'one' })), 'unknown_version')
    const bad = await parseSaveText(JSON.stringify({ ...save, anon_id: 'someone@example.org' }))
    expectCode(bad, 'invalid')
    expect(bad.ok ? [] : bad.details).toEqual(['/anon_id: must match ^hb_[0-9A-Za-z]{16,17}$'])
    expectCode(await parseSaveBytes(new Uint8Array(9 * 1024 * 1024)), 'too_large')
    expectCode(await parseSaveText('x'.repeat(9 * 1024 * 1024)), 'too_large')
  })

  it('reads a newer minor of v1 that it can validate, and reports one using fields it does not know as newer_version, not damaged', async () => {
    const newer = { ...save, schema_version: '1.1.0' }
    expectSave(await parseSaveText(JSON.stringify(newer)), newer)
    const extraTop = await parseSaveText(JSON.stringify({ ...newer, retest_model: { rho: 0.3 } }))
    expectCode(extraTop, 'newer_version')
    expect(extraTop.ok ? [] : extraTop.details).toEqual(['/: unexpected "retest_model"'])
    const s0 = save.sessions[0] as SaveSession
    expectCode(await parseSaveText(JSON.stringify({ ...newer, sessions: [{ ...s0, locale: 'en' }] })), 'newer_version')
    const widened = { ...save, schema_version: '1.0.1', sessions: [{ ...s0, device: { ...s0.device, class: 'watch' } }] }
    expectCode(await parseSaveText(JSON.stringify(widened)), 'newer_version')
    // The same additions under this build's own version are damage, not a newer format.
    expectCode(await parseSaveText(JSON.stringify({ ...save, retest_model: { rho: 0.3 } })), 'invalid')
    expectCode(await parseSaveText(JSON.stringify({ ...widened, schema_version: SCHEMA_VERSION })), 'invalid')
  })

  it('refuses a gzip bomb before expanding it fully', async () => {
    const bomb = await gzip(new Uint8Array(40 * 1024 * 1024).fill(0x20))
    expect(bomb.length).toBeLessThan(100_000)
    expectCode(await parseSaveBytes(bomb), 'too_large')
    expectCode(await parseSaveBytes(bomb, { native: false }), 'too_large')
  })

  it('warns (without failing) when the posterior cache cannot be used under the current parameters', async () => {
    const withCache = { ...save, posterior_cache: { param_version: 'p-old', axes: ['MAT'], mean: [0], cov_lower: [1] } }
    const r = await parseSaveText(JSON.stringify(withCache), { paramVersion: TEST_CTX.param_version })
    expect(r.ok && r.warnings.length).toBe(1)
    const fresh = { ...save, posterior_cache: { param_version: TEST_CTX.param_version, axes: ['MAT'], mean: [0], cov_lower: [1] } }
    const r2 = await parseSaveText(JSON.stringify(fresh), { paramVersion: TEST_CTX.param_version })
    expect(r2.ok && r2.warnings.length).toBe(0)
  })

  it('every encoding of any save loads to the same save (property)', async () => {
    await fc.assert(
      fc.asyncProperty(arbSave(), fc.nat(), async (s, cut) => {
        const code = await encodeSaveCode(s)
        const spaced = code.slice(0, cut % (code.length + 1)) + '\n  ' + code.slice(cut % (code.length + 1))
        const inputs: ParseResult[] = [
          await parseSaveText(jcs(s)),
          await parseSaveText(JSON.stringify(s, null, '\t')),
          await parseSaveBytes(await gzip(enc(jcs(s)))),
          await parseSaveText(code),
          await parseSaveText(spaced),
          await readSaveFile(new File([jcs(s)], 'renamed.txt', { type: 'text/plain' })),
        ]
        for (const r of inputs) expectSave(r, s)
      }),
      { numRuns: 100 },
    )
  })

  it('the example $schema URL is carried through a round trip', async () => {
    const r = await parseSaveText(jcs(save))
    expect(r.ok && r.save.$schema).toBe(SCHEMA_URL)
  })
})

describe('the messages say what is wrong and what to do (UX-012b)', () => {
  const save = realisticSave(1, 20)
  /** The words of the format, which a person who chose a file has no use for (".hbsave.json" is the file's name, not a mention of the format). */
  const FORMAT_TERMS = /gzip|JSON|schema_version|schema major|major \d|migrat|base64/
  /** A way forward: choose a file, paste a code, copy it again, download it again, reload. */
  const NEXT_STEP = /\b(choose|paste|copy it again|download it again|reload|try choosing|try pasting)\b/i

  interface Failure {
    readonly label: string
    readonly result: ParseFailure
    readonly code: ParseErrorCode
  }

  /** Every kind of failure the loader reports, by the code it is expected to report (several inputs for the codes that have several causes). */
  async function build(): Promise<Failure[]> {
    const code = await encodeSaveCode(save)
    const throwing = new Map([[0, { from: 0, to: 1, migrate: (): Record<string, unknown> => { throw new Error('boom') } }]])
    const bomb = await gzip(new Uint8Array(40 * 1024 * 1024).fill(0x20))
    const cases: [string, ParseErrorCode, Promise<ParseResult>][] = [
      ['empty file', 'empty', parseSaveBytes(new Uint8Array(0))],
      ['blank text', 'empty', parseSaveText('   \n')],
      ['no paste data', 'empty', readSaveFromDataTransfer(null)],
      ['random text in a file', 'not_a_save', parseSaveBytes(enc('this is not a save'))],
      ['random text pasted', 'not_a_save', parseSaveText('hello there')],
      ['a JSON list', 'not_a_save', parseSaveText('[1, 2, 3]')],
      ['JSON that is not a save', 'not_a_save', parseSaveText('{"a": 1}')],
      ['a cut-off file', 'not_a_save', parseSaveBytes(enc(jcs(save).slice(0, 200)))],
      ['a cut-off paste', 'not_a_save', parseSaveText('{"sessions": [')],
      ['image bytes', 'not_a_save', parseSaveBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))],
      ['gzip of text that is not a save', 'not_a_save', gzip(enc('plain words, no braces')).then((g) => parseSaveBytes(g))],
      ['a pasted code of text that is not a save', 'not_a_save', gzip(enc('plain words, no braces')).then((g) => parseSaveText(base64urlEncode(g)))],
      ['a cut-off code', 'corrupt_code', parseSaveText(code.slice(0, code.length - 20))],
      ['a code that stops at once', 'corrupt_code', parseSaveText(code.slice(0, 30))],
      ['gzip that does not unpack', 'corrupt_code', parseSaveBytes(new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3, 1, 2, 3, 4, 5]))],
      ['a gzip bomb', 'too_large', parseSaveBytes(bomb)],
      ['a huge file', 'too_large', parseSaveBytes(new Uint8Array(MAX_INPUT_BYTES + 1))],
      ['a huge blob', 'too_large', readSaveFile(new Blob([new Uint8Array(MAX_INPUT_BYTES + 1)]))],
      ['huge pasted text', 'too_large', parseSaveText('x'.repeat(MAX_INPUT_BYTES + 1))],
      ['a save from a newer version', 'newer_version', parseSaveText(JSON.stringify({ ...save, schema_version: '2.0.0' }))],
      ['a newer minor with fields this build lacks', 'newer_version', parseSaveText(JSON.stringify({ ...save, schema_version: '1.1.0', retest_model: { rho: 0.3 } }))],
      ['a version nobody can read', 'unknown_version', parseSaveText(JSON.stringify({ ...save, schema_version: 'one' }))],
      ['a save that fails the schema', 'invalid', parseSaveText(JSON.stringify({ ...save, anon_id: 'someone@example.org' }))],
      ['an upgrade that throws', 'invalid', Promise.resolve(loadSaveDocument({ schema_version: '0.1.0', sessions: [] }, 'json', { migrations: throwing }))],
      ['a file the browser could not read', 'read_failed', readSaveFile({ size: 10, arrayBuffer: () => Promise.reject(new Error('gone')) } as unknown as Blob)],
      ['a paste that could not be read', 'read_failed', readSaveFromDataTransfer({ files: [] as unknown as FileList, getData: () => { throw new Error('denied') } })],
    ]
    const out: Failure[] = []
    for (const [label, expected, p] of cases) {
      const result = await p
      expect(result.ok, label).toBe(false)
      if (!result.ok) out.push({ label, result, code: expected })
    }
    return out
  }
  let cached: Promise<Failure[]> | undefined
  const failures = (): Promise<Failure[]> => (cached ??= build())

  it('keeps every code, and every message is plain words with a next step and none of the format\'s own terms', async () => {
    const all = await failures()
    expect(new Set(all.map((f) => f.code))).toEqual(new Set<ParseErrorCode>(['empty', 'not_a_save', 'corrupt_code', 'too_large', 'newer_version', 'unknown_version', 'invalid', 'read_failed']))
    for (const { label, result, code } of all) {
      expect(result.code, label).toBe(code)
      expect(result.message, label).not.toMatch(FORMAT_TERMS)
      expect(result.message, label).toMatch(NEXT_STEP)
      expect(result.message.length, label).toBeGreaterThan(40)
    }
  }, 120_000)

  it('a file or text that is not a save says "not a HumanBench save" and where a save comes from', async () => {
    const notSaves = (await failures()).filter((x) => x.code === 'not_a_save' && !/cut-off/.test(x.label))
    expect(notSaves).toHaveLength(7)
    for (const f of notSaves) {
      expect(f.result.message, f.label).toContain('not a HumanBench save')
      expect(f.result.message, f.label).toMatch(/downloaded|save code/)
    }
  }, 120_000)

  it('names the likely cause: cut off, empty, too large, a newer version, a code copied in part', async () => {
    const byLabel = new Map((await failures()).map((f) => [f.label, f.result.message]))
    expect(byLabel.get('a cut-off file')).toMatch(/cut off or damaged/)
    expect(byLabel.get('a cut-off paste')).toMatch(/cut off or damaged/)
    expect(byLabel.get('empty file')).toMatch(/empty/)
    expect(byLabel.get('a huge file')).toMatch(/too large/)
    expect(byLabel.get('a save from a newer version')).toMatch(/newer version/)
    expect(byLabel.get('a cut-off code')).toMatch(/incomplete or damaged/)
    expect(byLabel.get('a file the browser could not read')).toMatch(/could not be read/)
    // A file is chosen and a code is pasted: each message points at its own.
    expect(byLabel.get('random text in a file')).toMatch(/^This file is not a HumanBench save/)
    expect(byLabel.get('random text pasted')).toMatch(/^This text is not a HumanBench save or save code/)
    expect(byLabel.get('gzip of text that is not a save')).toMatch(/^This file is not a HumanBench save/)
    expect(byLabel.get('a pasted code of text that is not a save')).toMatch(/^This text is not a HumanBench save or save code/)
  }, 120_000)

  describe('the wording follows where the input came from (a chosen file, or text pasted into the box)', () => {
    const FILE_NOT_A_SAVE = /^This file is not a HumanBench save\. Choose the file you downloaded/
    const TEXT_NOT_A_SAVE = /^This text is not a HumanBench save or save code\. Choose your downloaded save file, or paste the save code you copied\.$/
    const FILE_WORDS = /\bThis (save )?file\b|\bthe file\b/
    const PASTE_WORDS = /\bThis text\b|\bThis pasted\b|\bpasted text\b/
    const cutOffText = '{"sessions": ['

    it('raw JSON that is not a save: "this text" when pasted, "this file" when chosen', async () => {
      for (const raw of ['{"a": 1}', '{}', '{"title": "my notes", "items": [1, 2]}']) {
        const pasted = await parseSaveText(raw)
        expect(pasted, raw).toMatchObject({ ok: false, code: 'not_a_save' })
        if (!pasted.ok) expect(pasted.message, raw).toMatch(TEXT_NOT_A_SAVE)
        const chosen = await parseSaveBytes(enc(raw))
        expect(chosen, raw).toMatchObject({ ok: false, code: 'not_a_save' })
        if (!chosen.ok) expect(chosen.message, raw).toMatch(FILE_NOT_A_SAVE)
      }
    })

    it('raw JSON that is cut off: "this pasted save" when pasted, "this save file" when chosen, both still code not_a_save and still say cut off or damaged', async () => {
      const pasted = await parseSaveText(cutOffText)
      expect(pasted).toMatchObject({ ok: false, code: 'not_a_save' })
      if (!pasted.ok) {
        expect(pasted.message).toMatch(/^This pasted save looks cut off or damaged/)
        expect(pasted.message).toMatch(/\b(copy it again|choose)\b/i)
        expect(pasted.message).not.toMatch(FILE_WORDS)
      }
      const chosen = await parseSaveBytes(enc(cutOffText))
      expect(chosen).toMatchObject({ ok: false, code: 'not_a_save' })
      if (!chosen.ok) expect(chosen.message).toMatch(/^This save file looks cut off or damaged/)
    })

    it('a code or gzip that unpacks to something that is not a save follows the source too', async () => {
      const g = await gzip(enc('{"a": 1}'))
      const plain = base64urlEncode(enc('{"a": 1}'))
      const code = base64urlEncode(g)
      for (const [label, pasted, chosen] of [
        ['base64 of plain JSON', await parseSaveText(plain), await parseSaveBytes(enc(plain))],
        ['a gzip code', await parseSaveText(code), await parseSaveBytes(enc(code))],
      ] as const) {
        expect(pasted, label).toMatchObject({ ok: false, code: 'not_a_save' })
        expect(chosen, label).toMatchObject({ ok: false, code: 'not_a_save' })
        if (!pasted.ok) expect(pasted.message, label).toMatch(TEXT_NOT_A_SAVE)
        if (!chosen.ok) expect(chosen.message, label).toMatch(FILE_NOT_A_SAVE)
      }
      const bytes = await parseSaveBytes(g)
      expect(bytes).toMatchObject({ ok: false, code: 'not_a_save' })
      if (!bytes.ok) expect(bytes.message).toMatch(FILE_NOT_A_SAVE)
    })

    it('a pasted save that fails the checks or cannot be opened follows the source, with the same codes and a way forward', async () => {
      const damaged = JSON.stringify({ ...save, anon_id: 'someone@example.org' })
      const unknown = JSON.stringify({ ...save, schema_version: 'one' })
      const [pd, fd, pu, fu] = await Promise.all([parseSaveText(damaged), parseSaveBytes(enc(damaged)), parseSaveText(unknown), parseSaveBytes(enc(unknown))])
      for (const [r, code, want] of [
        [pd, 'invalid', /^This pasted save is damaged/],
        [fd, 'invalid', /^This save file is damaged/],
        [pu, 'unknown_version', /pasted text may be damaged/],
        [fu, 'unknown_version', /the file may be damaged/],
      ] as const) {
        expect(r).toMatchObject({ ok: false, code })
        if (!r.ok) {
          expect(r.message).toMatch(want)
          expect(r.message).not.toMatch(FORMAT_TERMS)
          expect(r.message).toMatch(NEXT_STEP)
        }
      }
    })

    it('loadSaveDocument words a failure for a file unless told the document was pasted', () => {
      for (const doc of [{ a: 1 }, [1], null, 'text']) {
        const byDefault = loadSaveDocument(doc)
        expect(byDefault).toMatchObject({ ok: false, code: 'not_a_save' })
        if (!byDefault.ok) expect(byDefault.message).toMatch(FILE_NOT_A_SAVE)
        const pasted = loadSaveDocument(doc, 'json', {}, 'paste')
        expect(pasted).toMatchObject({ ok: false, code: 'not_a_save' })
        if (!pasted.ok) expect(pasted.message).toMatch(TEXT_NOT_A_SAVE)
      }
    })

    it('a paste or drop through DataTransfer: text is worded as a paste, an attached file as a file', async () => {
      const text = await readSaveFromDataTransfer({ files: [] as unknown as FileList, getData: (t: string) => (t === 'text/plain' ? '{"a": 1}' : '') })
      expect(text.ok ? '' : text.message).toMatch(TEXT_NOT_A_SAVE)
      const file = await readSaveFromDataTransfer({ files: [new Blob(['{"a": 1}'])] as unknown as FileList, getData: () => '' })
      expect(file.ok ? '' : file.message).toMatch(FILE_NOT_A_SAVE)
    })

    it('whatever is pasted never points at "this file", and whatever is chosen never at pasted text (property)', async () => {
      const input = fc.oneof(
        fc.string(),
        fc.string().map((x) => `{${x}`),
        fc.json(),
        fc.constantFrom('{"a": 1}', '{"sessions": [', '[]', 'hello there', 'H4sI', 'H4sIAAAA'),
      )
      await fc.assert(
        fc.asyncProperty(input, async (text) => {
          const pasted = await parseSaveText(text)
          if (!pasted.ok) expect(pasted.message).not.toMatch(FILE_WORDS)
          const chosen = await parseSaveBytes(enc(text))
          if (!chosen.ok) expect(chosen.message).not.toMatch(PASTE_WORDS)
        }),
        { numRuns: 200 },
      )
    })
  })

  it('keeps the developer\'s reason out of the message and in details', async () => {
    const all = new Map((await failures()).map((f) => [f.label, f.result]))
    expect(all.get('a version nobody can read')!.details).toEqual(['no readable schema_version'])
    expect(all.get('an upgrade that throws')!.details?.[0]).toMatch(/threw/)
    expect(all.get('a save that fails the schema')!.details).toEqual(['/anon_id: must match ^hb_[0-9A-Za-z]{16,17}$'])
    for (const f of all.values()) for (const d of f.details ?? []) expect(f.message).not.toContain(d)
  }, 120_000)

  it('no input at all gets a message with a term of the format in it, or without a next step (property)', async () => {
    const input = fc.oneof(
      fc.string().map((text) => ({ text })),
      fc.string().map((x) => ({ text: `{${x}` })),
      fc.json().map((text) => ({ text })),
      fc.uint8Array({ maxLength: 64 }).map((bytes) => ({ bytes })),
    )
    await fc.assert(
      fc.asyncProperty(input, async (i) => {
        const r = 'text' in i ? await parseSaveText(i.text) : await parseSaveBytes(i.bytes)
        if (!r.ok) {
          expect(r.message).not.toMatch(FORMAT_TERMS)
          expect(r.message).toMatch(NEXT_STEP)
        }
      }),
      { numRuns: 150 },
    )
  })
})
