import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { base64Decode, base64urlEncode, encodeSaveCode, gzip } from './codec'
import { gzipStored } from './gzip'
import { jcs } from './jcs'
import { normalizeSave } from './merge'
import { parseSaveBytes, parseSaveText, readSaveFile, readSaveFromDataTransfer, type ParseResult } from './parse'
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
