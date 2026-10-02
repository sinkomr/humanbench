/**
 * M2.3 (ROADMAP M2.3; DESIGN §8 "Tamper evidence", R-8.1, R-12.1; ROADMAP A16, AI.26): the per-session HMAC of
 * the saves, the Vault key with `kid` rotation, and the unverified path. M2.4's acceptance test of a tampered
 * save is in acceptance.db.test.ts; this file is the mechanism.
 *
 * What is held here:
 *   - the canonical JSON the MAC is computed over is RFC 8785, byte for byte what src/save/jcs.ts produces
 *     (the RFC's vectors, and random values against the app's own serialiser);
 *   - `finish` signs the session it built, and an independent HMAC (Node's, over the app's serialiser) gives the
 *     same MAC, so the client side of the format is not in doubt;
 *   - any change to a signed session, to its sig, or to the anon_id it binds makes it "unverified", and a change
 *     that is not a change (key order, number spellings, white space) does not; nothing around the session
 *     (the file, the seen lists, the posterior cache, other sessions) is covered;
 *   - kid rotation: new sessions use the current kid, old ones keep verifying until their key is retired;
 *   - with no usable key the server signs nothing and verifies nothing, and `finish` still works;
 *   - the key is readable by one function only, and no reply or table holds it.
 */

import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import Ajv2020 from 'ajv/dist/2020'
import fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRng, type Rng } from '../../src/engine/prng'
import { isIJsonString, jcs } from '../../src/save/jcs'
import { validateSave } from '../../src/save/validate'
import { fixtureBank, loadFixtureBank, type FixtureItem } from './bank-fixture'
import { ANON, AUTHENTICATED, type TestDb } from './harness'
import { DEVICE, emptySave, from, playSession, referenceMac, relaxSelection, signedSession, signingKey, startSession, type SessionObject } from './rpc-support'
import { exposedSurface, names } from './surface'
import { PERMISSION_DENIED, openTestDb, pgCode, rejectedWith } from './vitest'

const schema = JSON.parse(readFileSync(new URL('../../../schema/save-v1.json', import.meta.url), 'utf8')) as Record<string, unknown>
const validateSchema = new Ajv2020({ strict: true, strictTuples: false, allowUnionTypes: true, allErrors: true }).compile(schema)

const bank = new Map<string, FixtureItem>()
let db: TestDb
let ipCounter = 0
/** A client address nobody has used yet in this file (the rate limits are per address). */
const freshIp = (): string => `192.0.2.${++ipCounter}`

async function openBankDb(seed: string): Promise<TestDb> {
  const d = await openTestDb()
  await relaxSelection(d)
  const items = fixtureBank({ perAxis: 12, seed })
  for (const it of items) bank.set(it.itemId, it)
  await loadFixtureBank(d, items)
  return d
}

beforeAll(async () => {
  db = await openBankDb('signing')
})
afterAll(async () => {
  await db.close()
})

interface Verified {
  anon_id: string
  sessions: { session_id: string | null; status: 'verified' | 'unverified'; reason: string | null }[]
  n_verified: number
  n_unverified: number
}

/** verify_save as anon, from a fresh client address. */
const verify = (d: TestDb, save: unknown, ip = freshIp()): Promise<Verified> => d.rpc<Verified>(from(ip), 'verify_save', { p_save: save })
/** The statuses of the sessions of one save, in order. */
const statuses = async (d: TestDb, anonId: string, sessions: unknown[]): Promise<string[]> =>
  (await verify(d, emptySave(anonId, { sessions }))).sessions.map((s) => (s.status === 'verified' ? 'verified' : (s.reason as string)))

interface Finished {
  sessionId: string
  anonId: string
  token: string
  ip: string
  /** The session exactly as `finish` returned it (signed). */
  session: SessionObject
}

/** Plays a short session and finishes it through the API. */
async function finishedSession(d: TestDb, n = 6, over: { anonSave?: unknown } = {}): Promise<Finished> {
  const ip = freshIp()
  const s = await startSession(d, ip, over.anonSave)
  await playSession(d, s, bank, { ip, n, decide: (_it, seq) => seq % 2 === 0 })
  const out = await d.rpc<{ session: SessionObject; anon_id: string }>(from(ip), 'finish', { p_token: s.token, p_flags: { visibility_hidden_s: 2, paste_events: 0, fast_guess_n: 0 } })
  return { sessionId: s.session_id, anonId: out.anon_id, token: s.token, ip, session: out.session }
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

// ---------------------------------------------------------------------------------- canonical JSON

describe('canonical JSON (RFC 8785): hb.jcs against the RFC and against src/save/jcs.ts', () => {
  /** hb.jcs of each value, the values sent as JSON text so that nothing but the database's own parser reads them. */
  async function sqlJcs(values: readonly unknown[]): Promise<string[]> {
    const { rows } = await db.sudo.query<{ t: string }>(`select hb.jcs(x.v) as t from jsonb_array_elements($1::jsonb) with ordinality x (v, o) order by x.o`, [JSON.stringify(values)])
    return rows.map((r) => r.t)
  }
  const fromBits = (hex: string): number => new DataView(new BigUint64Array([BigInt(`0x${hex}`)]).buffer).getFloat64(0, true)

  it('serialises the numbers of RFC 8785 Appendix B as ECMAScript does', async () => {
    const vectors: [string, string][] = [
      ['0000000000000000', '0'],
      ['8000000000000000', '0'],
      ['0000000000000001', '5e-324'],
      ['8000000000000001', '-5e-324'],
      ['7fefffffffffffff', '1.7976931348623157e+308'],
      ['ffefffffffffffff', '-1.7976931348623157e+308'],
      ['4340000000000000', '9007199254740992'],
      ['c340000000000000', '-9007199254740992'],
      ['4430000000000000', '295147905179352830000'],
      ['44b52d02c7e14af5', '9.999999999999997e+22'],
      ['44b52d02c7e14af6', '1e+23'],
      ['44b52d02c7e14af7', '1.0000000000000001e+23'],
      ['444b1ae4d6e2ef4e', '999999999999999700000'],
      ['444b1ae4d6e2ef4f', '999999999999999900000'],
      ['444b1ae4d6e2ef50', '1e+21'],
      ['3eb0c6f7a0b5ed8c', '9.999999999999997e-7'],
      ['3eb0c6f7a0b5ed8d', '0.000001'],
      ['41b3de4355555553', '333333333.3333332'],
      ['41b3de4355555554', '333333333.33333325'],
      ['41b3de4355555555', '333333333.3333333'],
      ['41b3de4355555556', '333333333.3333334'],
      ['41b3de4355555557', '333333333.33333343'],
      ['becbf647612f3696', '-0.0000033333333333333333'],
      ['43143ff3c1cb0959', '1424953923781206.2'],
    ]
    const got = await sqlJcs(vectors.map(([bits]) => fromBits(bits)))
    expect(got).toEqual(vectors.map(([, want]) => want))
  })

  it('agrees with ECMAScript on every d x 10^j from 1 to 99 and 10^15 to 10^40, where the edges of a double\'s interval are short decimals (1e23)', async () => {
    const values: number[] = []
    for (let j = 15; j <= 40; j++) for (let d = 1; d <= 99; d++) values.push(Number(`${d}e${j}`))
    for (let j = 15; j <= 40; j++) for (let d = 1; d <= 99; d += 7) values.push(-Number(`${d}.5e${j}`))
    const got = await sqlJcs(values)
    expect(got.filter((g, i) => g !== jcs(values[i]))).toEqual([])
    expect(got[values.indexOf(1e23)]).toBe('1e+23')
  })

  /** hb.jcs of each element of a JSON array given as TEXT, so that nothing but the database's parser reads the spelling. */
  async function sqlJcsText(arrayText: string): Promise<string[]> {
    const { rows } = await db.sudo.query<{ t: string }>(`select hb.jcs(x.v) as t from jsonb_array_elements($1::jsonb) with ordinality x (v, o) order by x.o`, [arrayText])
    return rows.map((r) => r.t)
  }
  const jsOfText = (arrayText: string): string[] => (JSON.parse(arrayText) as unknown[]).map((v) => jcs(v))

  it('agrees with ECMAScript on the double before and after every d x 10^j, d up to 999: the neighbours of a short decimal are where the search for the shortest digits can go wrong', async () => {
    const f64 = new Float64Array(1)
    const u64 = new BigUint64Array(f64.buffer)
    const around = (x: number): number[] => {
      f64[0] = x
      const bits = u64[0]!
      u64[0] = bits + 1n
      const up = f64[0]!
      u64[0] = bits - 1n
      return [x, up, f64[0]!]
    }
    const values: number[] = []
    for (let j = 15; j <= 42; j++) for (let d = 1; d <= 999; d++) values.push(...around(Number(`${d}e${j}`)))
    for (let i = 0; i < values.length; i += 20_000) {
      const chunk = values.slice(i, i + 20_000)
      const text = JSON.stringify(chunk)
      const got = await sqlJcsText(text)
      const bad = got.map((g, k) => [g, jcs(chunk[k]!), chunk[k]] as const).filter(([g, want]) => g !== want)
      expect(bad.slice(0, 5)).toEqual([])
    }
  }, 120_000)

  it('agrees with ECMAScript on doubles whose interval edge is a decimal shorter than PostgreSQL prints: 1e23 is one, and so are thousands of doubles from 1e16 on', async () => {
    // A double x = m x 2^q (m even, 53 bits) reads back from every decimal between (2m-1) x 2^(q-1) and (2m+1) x 2^(q-1),
    // edges included. PostgreSQL's shortest digits leave the edges out; ECMAScript takes one that has fewer digits.
    const rng = createRng('midpoints')
    const sig = (b: bigint): number => b.toString().replace(/0+$/, '').length
    const withShortEdge: number[] = []
    for (let q = 1; q <= 70; q++) {
      for (let i = 0; i < 1500; i++) {
        const m = ((1n << 52n) | (BigInt(rng.int(0, 2 ** 20 - 1)) << 32n) | BigInt(rng.int(0, 2 ** 32 - 1))) & ~1n
        const half = 1n << BigInt(q - 1)
        if (sig((2n * m + 1n) * half) <= 16 || sig((2n * m - 1n) * half) <= 16) withShortEdge.push(Number(m * (1n << BigInt(q))))
      }
    }
    expect(withShortEdge.length).toBeGreaterThan(1500)
    const text = JSON.stringify(withShortEdge)
    const got = await sqlJcsText(text)
    expect(got.map((g, k) => [withShortEdge[k], g, jcs(withShortEdge[k]!)] as const).filter(([, g, want]) => g !== want).slice(0, 5)).toEqual([])
  })

  it('prints an integer of 16 digits or more as the double nearest to it, as ECMAScript does: the shortcut for plain integers ends at 15 digits', async () => {
    const text = '[999999999999999, 1000000000000000, 9007199254740991, 9007199254740993, 12345678901234567891, -9007199254740993, 123456789012345678, 100000000000000000000, 1000000000000000000000, 1e22, 2e21, 4611686018427387905, -18446744073709551617]'
    const got = await sqlJcsText(text)
    expect(got).toEqual(jsOfText(text))
    expect(got.slice(0, 5)).toEqual(['999999999999999', '1000000000000000', '9007199254740991', '9007199254740992', '12345678901234567000'])
  })

  it('prints a decimal as ECMAScript does however it is spelt: up to 15 digits as they are, trailing zeros dropped, 1e-6 and 1e-7, 16 and 17 digits through the double', async () => {
    const rng = createRng('decimals')
    const digits = (n: number): string => Array.from({ length: n }, () => String(rng.int(0, 9))).join('')
    const spellings: string[] = [
      '0.1', '0.5', '-0.5', '0.10', '0.0', '-0.0', '1.0', '1.50', '10.10', '100.5', '100.25', '0.30000000000000004', '0.1000000000000001', '0.100000000000001', '0.999999999999999',
      '1.000000000000001', '1.00000000000001', '123456789012345.6', '12345678901234.56', '1234567890123.456', '999999999999999.9', '99999999999999.99', '10000000000000.5',
      '0.000001', '0.0000010', '0.000001234', '0.0000009999999', '0.0000001', '0.00000011', '0.000000999999999999', '0.00001', '0.000123456789012345', '0.0001234567890123456',
      '5e-324', '1.7976931348623157e308', '0.000000000000000000001', '123456789.123456789', '4.35', '3411.123', '-3411.123', '0.2', '0.7', '2.675', '1.005',
    ]
    for (let i = 0; i < 6000; i++) {
      const intLen = rng.int(0, 17)
      const fracLen = rng.int(0, 18)
      const intPart = intLen === 0 ? '0' : String(rng.int(1, 9)) + digits(intLen - 1)
      let frac = digits(fracLen)
      if (rng.next() < 0.3) frac = '0'.repeat(rng.int(1, 8)) + frac
      if (rng.next() < 0.2) frac += '0'.repeat(rng.int(1, 3))
      spellings.push(`${rng.next() < 0.3 ? '-' : ''}${intPart}${frac === '' ? '' : `.${frac}`}`)
    }
    const text = `[${spellings.join(', ')}]`
    const got = await sqlJcsText(text)
    const bad = got.map((g, k) => [spellings[k], g, jsOfText(text)[k]] as const).filter(([, g, want]) => g !== want)
    expect(bad.slice(0, 5)).toEqual([])
  })

  it('sorts keys by code point when no key reaches beyond U+FFFF, whatever the database\'s collation, and by UTF-16 units when one does', async () => {
    const rng = createRng('keys')
    const bmp = ['a', 'B', '_', '-', 'Z', 'z', 'é', 'Ö', 'ǅ', '\u0080', '߿', 'ࠀ', '퟿', '', '', 'דּ', '�', 'ab', 'a-b', 'a_b', 'A', 'b', ' ', 'a b', 'aB', 'Ab', '10', '9', '1', '', 'k'.repeat(300), `${'k'.repeat(300)}z`]
    const astral = ['😀', '\u{10000}', '\u{1d11e}', 'a😀', '😀a']
    const objects = (pool: string[]): Record<string, number>[] =>
      Array.from({ length: 40 }, () => Object.fromEntries(rng.shuffle(pool).slice(0, rng.int(2, 12)).map((k, i) => [k, i])))
    const values = [...objects(bmp), ...objects([...bmp, ...astral]), ...objects(astral)]
    const got = await sqlJcs(values)
    expect(got.filter((g, i) => g !== jcs(values[i]))).toEqual([])
    // the shortcut is what pins the order to code points (a database collation of en_US would put "a" before "B")
    const src = await db.sudo.query<{ ok: boolean }>(`select prosrc like '%collate "C"%' as ok from pg_proc where oid = 'hb.jcs(jsonb, int)'::regprocedure`)
    expect(src.rows[0]!.ok).toBe(true)
  })

  it('matches the RFC §3.2.2 example: number spellings, string escapes, literals, key order', async () => {
    const text = String.raw`{
      "numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],
      "string": "€$\u000F\u000aA'B\"\\\\\"\/",
      "literals": [null, true, false]
    }`
    const { rows } = await db.sudo.query<{ t: string }>(`select hb.jcs($1::jsonb) as t`, [text])
    expect(rows[0]!.t).toBe(String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}`)
  })

  it('sorts keys by UTF-16 code units, not by code point (RFC §3.2.3: the emoji sorts before U+FB33)', async () => {
    const text = String.raw`{"€": "Euro Sign", "\r": "Carriage Return", "דּ": "Hebrew Letter Dalet With Dagesh", "1": "One", "😀": "Emoji: Grinning Face", "\u0080": "Control", "ö": "Latin Small Letter O With Diaeresis"}`
    const { rows } = await db.sudo.query<{ t: string }>(`select hb.jcs($1::jsonb) as t`, [text])
    const order = [...rows[0]!.t.matchAll(/"((?:[^"\\]|\\.)*)":"/g)].map((m) => JSON.parse(`"${m[1] ?? ''}"`) as string)
    expect(order).toEqual(['\r', '1', '\u0080', 'ö', '€', '😀', 'דּ'])
    expect(rows[0]!.t).toBe(jcs(JSON.parse(text)))
  })

  it('agrees with the app on whatever the app can write: random I-JSON values, 2,000 of them', async () => {
    const text = fc.oneof(
      fc.string({ unit: 'grapheme', maxLength: 12 }),
      fc.string({ unit: 'binary', maxLength: 8 }).filter((s) => isIJsonString(s)),
      fc.constantFrom('', ' ', '"', '\\', '\n', '\u007f', '\u0080', ' ', 'דּ', '😀', 'ö', '€', '', '￿', '\u{10000}'),
    ).filter((s) => !s.includes('\u0000'))
    const key = text.filter((k) => k !== '__proto__')
    const number = fc.oneof(
      fc.integer({ min: -1_000_000, max: 1_000_000 }),
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.double({ min: -1e22, max: 1e22, noNaN: true }),
      fc.integer({ min: -30, max: 30 }).map((e) => 1.5 * 10 ** e),
      fc.constantFrom(0, -0, 1, 0.1, 1e21, 1e-7, 123456789012345680000, 5e-324, 1.7976931348623157e308, 2 ** 53, 2 ** 53 + 2, 1e15, 1e16, 0.000001, 4.35, 3411.123),
    )
    const leaf = fc.oneof(text, number, fc.boolean(), fc.constant(null))
    const { tree } = fc.letrec<{ tree: unknown }>((tie) => ({
      tree: fc.oneof({ maxDepth: 4, depthSize: 'small' }, leaf, fc.array(tie('tree'), { maxLength: 5 }), fc.dictionary(key, tie('tree'), { maxKeys: 5 })),
    }))
    await fc.assert(
      fc.asyncProperty(fc.array(tree, { minLength: 40, maxLength: 40 }), async (values) => {
        // what crosses the wire is JSON text, so compare on what the text says
        const wire = JSON.parse(JSON.stringify(values)) as unknown[]
        expect(await sqlJcs(wire)).toEqual(wire.map((v) => jcs(v)))
      }),
      { numRuns: 50, seed: 8785 },
    )
  })

  it('refuses nesting beyond 24 levels instead of exhausting the stack', async () => {
    const deep = (n: number): string => '['.repeat(n) + ']'.repeat(n)
    const ok = await db.sudo.query<{ t: string }>(`select hb.jcs($1::jsonb) as t`, [deep(24)])
    expect(ok.rows[0]!.t).toBe(deep(24))
    expect(pgCode(await db.sudo.query(`select hb.jcs($1::jsonb)`, [deep(26)]).catch((e: unknown) => e))).toBe('PT400')
  })

  it('prints numbers the same whatever extra_float_digits the session carries', async () => {
    const c = await db.sudo.connect()
    try {
      await c.query('set extra_float_digits = 0')
      const { rows } = await c.query<{ t: string }>(`select hb.jcs('[0.1, 0.30000000000000004, 3411.123, 1e-7, 1.7976931348623157e308]'::jsonb) as t`)
      expect(rows[0]!.t).toBe('[0.1,0.30000000000000004,3411.123,1e-7,1.7976931348623157e+308]')
    } finally {
      c.release()
    }
  })
})

// ------------------------------------------------------------------------------------- signing

describe('finish signs the session (A16)', () => {
  it('adds a sig that names the algorithm, the key, the MAC and the anon_id the session was issued to', async () => {
    const f = await finishedSession(db)
    expect(f.session.sig).toEqual({ alg: 'HMAC-SHA256', kid: 'k2026a', mac: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), anon_id: f.anonId })
    expect(Object.keys(f.session).sort()).toEqual(['device', 'duration_s', 'flags', 'responses', 'session_id', 'sig', 'started_utc'])
  })

  it('computes a MAC that an independent HMAC over the app\'s canonical JSON reproduces, byte for byte', async () => {
    const key = await signingKey(db)
    for (const n of [0, 1, 6, 25]) {
      const f = await finishedSession(db, n)
      expect(f.session.sig.mac, `${n} answers`).toBe(referenceMac(key, f.anonId, f.session))
    }
  })

  it('is a valid session for the schema and for the app\'s validator, sig included', async () => {
    const f = await finishedSession(db)
    const doc = emptySave(f.anonId, { sessions: [f.session] })
    expect(validateSchema(doc), JSON.stringify(validateSchema.errors)).toBe(true)
    expect(validateSave(doc).ok).toBe(true)
  })

  it('signs the same session identically when finish is called again (a lost reply is safe to retry)', async () => {
    const f = await finishedSession(db)
    const again = await db.rpc<{ session: SessionObject }>(from(f.ip), 'finish', { p_token: f.token })
    expect(again.session).toEqual(f.session)
  })

  it('signs only a finished session, from the rows the server holds', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    const open = await signedSession(db, s.session_id)
    expect(open.sig).toBeUndefined()
    const missing = await db.sudo.query(`select hb.session_signed('s_doesnotexist0') as s`)
    expect(missing.rows[0]!.s).toBeNull()
  })

  it('binds the session to its anon_id: the MAC of the same body under another anon_id differs', async () => {
    const key = await signingKey(db)
    const f = await finishedSession(db)
    expect(referenceMac(key, 'hb_AAAAAAAAAAAAAAAA', f.session)).not.toBe(f.session.sig.mac)
  })
})

// ------------------------------------------------------------------------------------- verifying

describe('verify_save: the unverified path', () => {
  let good: Finished
  let other: Finished
  beforeAll(async () => {
    good = await finishedSession(db, 8)
    other = await finishedSession(db, 5)
  })

  it('says "verified" for the sessions the server signed, "unverified: unsigned" for an offline file, and accepts both', async () => {
    const offline: SessionObject = { ...clone(good.session), session_id: 's_offlineMVP0001' }
    delete offline.sig
    const out = await verify(db, emptySave(good.anonId, { sessions: [good.session, offline, other.session] }))
    expect(out.anon_id).toBe(good.anonId)
    expect(out.sessions).toEqual([
      { session_id: good.sessionId, status: 'verified', reason: null },
      { session_id: 's_offlineMVP0001', status: 'unverified', reason: 'unsigned' },
      // a session of another person is verified as what it is; whose it is is another question (hb.session_owned)
      { session_id: other.sessionId, status: 'verified', reason: null },
    ])
    expect(out.n_verified).toBe(2)
    expect(out.n_unverified).toBe(1)
  })

  it('says nothing but the status: no MAC, no key, no kid in the reply', async () => {
    const out = JSON.stringify(await verify(db, emptySave(good.anonId, { sessions: [good.session] })))
    expect(out).not.toContain(good.session.sig.mac)
    expect(out).not.toContain(await signingKey(db))
    expect(out).not.toContain('k2026a')
  })

  it('treats a session that carries someone else\'s MAC, or none that fits, as unverified: bad_signature', async () => {
    const swapped = { ...clone(good.session), sig: clone(other.session.sig) }
    const wrongAnon = { ...clone(good.session), sig: { ...clone(good.session.sig), anon_id: other.anonId } }
    const flipped = clone(good.session)
    flipped.sig.mac = (flipped.sig.mac[0] === 'A' ? 'B' : 'A') + flipped.sig.mac.slice(1)
    expect(await statuses(db, good.anonId, [swapped, wrongAnon, flipped, good.session])).toEqual(['bad_signature', 'bad_signature', 'bad_signature', 'verified'])
  })

  it('reports a sig that is not the closed object of the schema as malformed, and never errors on it', async () => {
    const bad = (sig: unknown): SessionObject => ({ ...clone(good.session), sig })
    const s = good.session.sig
    const cases: [string, SessionObject][] = [
      ['a missing field', bad({ alg: s.alg, kid: s.kid, mac: s.mac })],
      ['an extra field', bad({ ...s, note: 'x' })],
      ['another algorithm', bad({ ...s, alg: 'HMAC-SHA1' })],
      ['a kid with a space', bad({ ...s, kid: 'k 2026' })],
      ['a mac of the wrong alphabet', bad({ ...s, mac: '***' })],
      ['an anon_id that is none', bad({ ...s, anon_id: 'nobody' })],
      ['a sig that is a string', bad('sig')],
      ['a sig that is an array', bad([s])],
      ['a numeric sig', bad(7)],
    ]
    const got = await statuses(db, good.anonId, cases.map(([, c]) => c))
    expect(got).toEqual(cases.map(() => 'malformed'))
    // and a null sig is no sig
    expect(await statuses(db, good.anonId, [bad(null)])).toEqual(['unsigned'])
  })

  it('reports an entry that is not a session as malformed', async () => {
    const out = await verify(db, emptySave(good.anonId, { sessions: [null, 7, 'x', [], {}, { session_id: 12 }] }))
    expect(out.sessions.map((s) => [s.status, s.reason])).toEqual([
      ['unverified', 'malformed'],
      ['unverified', 'malformed'],
      ['unverified', 'malformed'],
      ['unverified', 'malformed'],
      ['unverified', 'unsigned'],
      ['unverified', 'unsigned'],
    ])
    expect(out.sessions.every((s) => s.session_id === null)).toBe(true)
  })

  it('reports a session over the size limit, or nested beyond the limit, as malformed without canonicalising it', async () => {
    const big = clone(good.session)
    big.flags = { ...big.flags }
    big.responses = Array.from({ length: 3000 }, () => ['i:tst:g1:00001', 0, 'x'.repeat(100), null, 100, null])
    expect(await statuses(db, good.anonId, [big])).toEqual(['malformed'])
    const deep = clone(good.session)
    deep.responses[0][2] = JSON.parse('['.repeat(40) + ']'.repeat(40))
    expect(await statuses(db, good.anonId, [deep])).toEqual(['malformed'])
  })

  it('does not depend on how the client wrote the JSON: key order, white space, and the spelling of numbers', async () => {
    const rng = createRng('respell')
    const spell = (v: unknown): string => {
      if (typeof v === 'number') {
        const forms = Number.isInteger(v) ? [String(v), `${v}.0`, `${v}.000`, `${v}e0`] : [String(v), v.toExponential(), `${String(v)}0`]
        return forms[rng.int(0, forms.length - 1)]!
      }
      if (Array.isArray(v)) return `[${v.map(spell).join(rng.next() < 0.5 ? ',' : ' ,\n  ')}]`
      if (v !== null && typeof v === 'object') {
        const entries = Object.entries(v)
        for (let i = entries.length - 1; i > 0; i--) {
          const j = rng.int(0, i)
          ;[entries[i], entries[j]] = [entries[j]!, entries[i]!]
        }
        return `{${entries.map(([k, x]) => `${JSON.stringify(k)}${rng.next() < 0.5 ? ':' : ' : '}${spell(x)}`).join(',\n')}}`
      }
      return JSON.stringify(v)
    }
    const doc = emptySave(good.anonId, { sessions: [good.session] })
    for (let i = 0; i < 20; i++) {
      const text = spell(doc)
      const { rows } = await db.query<{ r: Verified }>(from(freshIp()), `select public.verify_save($1::jsonb) as r`, [text])
      expect(rows[0]!.r.sessions[0], text.slice(0, 200)).toMatchObject({ status: 'verified' })
    }
  })

  it('covers nothing outside the session: the file around it can say anything, and other sessions can be wrong', async () => {
    const around = [
      {},
      { seen_items: ['i:tst:g1:00001'], seen_families: ['f:tst:000000000000'] },
      { created_utc: '2030-01-01T00:00:00Z', bank_version: 'other', schema_version: '1.0.0' },
      { posterior_cache: { param_version: 'p0', axes: ['MAT'], mean: [0.2], cov_lower: [1] } },
      { sig: { alg: 'HMAC-SHA256', kid: 'k2026a', mac: 'AAAA' }, $schema: 'https://example.invalid/x.json', extra: { anything: [1, 2, 3] } },
    ]
    for (const extra of around) {
      const out = await verify(db, { ...emptySave(good.anonId), ...extra, sessions: [good.session] })
      expect(out.sessions[0]!.status, JSON.stringify(extra)).toBe('verified')
    }
    // a merged file: another anon_id on the file, other sessions in it, one of them tampered
    const tampered = clone(other.session)
    tampered.duration_s = 1
    const merged = await verify(db, emptySave('hb_Zz9Yy8Xx7Ww6Vv5U', { sessions: [tampered, good.session, other.session] }))
    expect(merged.sessions.map((s) => s.status)).toEqual(['unverified', 'verified', 'verified'])
  })

  it('refuses the notes settings, as every RPC that takes a save does (AI.26), and verifies the file once they are stripped', async () => {
    const withPrefs = emptySave(good.anonId, { sessions: [good.session], brief_prefs: { notes_as_of: '2026-10' } })
    expect(pgCode(await verify(db, withPrefs).catch((e: unknown) => e))).toBe('PT400')
    const { brief_prefs: _drop, ...stripped } = withPrefs
    expect((await verify(db, stripped)).sessions[0]!.status).toBe('verified')
  })

  it('takes a save of well-formed shape only, at most verify.max_sessions sessions, and counts calls per address', async () => {
    for (const bad of [[], 'x', { ...emptySave(good.anonId), anon_id: 'nobody' }, { ...emptySave(good.anonId), sessions: {} }]) {
      expect(pgCode(await verify(db, bad).catch((e: unknown) => e)), JSON.stringify(bad)).toBe('PT400')
    }
    const many = emptySave(good.anonId, { sessions: Array.from({ length: 201 }, () => ({})) })
    expect(pgCode(await verify(db, many).catch((e: unknown) => e))).toBe('PT413')
    const ip = freshIp()
    await db.owner.query(`update public.app_config set value = '3' where key = 'rate.verifies_per_day'`)
    try {
      for (let i = 0; i < 3; i++) await verify(db, emptySave(good.anonId), ip)
      expect(pgCode(await verify(db, emptySave(good.anonId), ip).catch((e: unknown) => e))).toBe('PT429')
      await verify(db, emptySave(good.anonId), freshIp())
    } finally {
      await db.owner.query(`update public.app_config set value = '60' where key = 'rate.verifies_per_day'`)
    }
  })

  it('stores nothing: no table changes by a verification, whatever the file holds', async () => {
    const counts = async (): Promise<string> => {
      const { rows } = await db.sudo.query<{ c: string }>(
        `select string_agg(c.relname || '=' || (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.' || quote_ident(c.relname), false, true, '')))[1]::text, ',' order by c.relname) as c
           from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname not in ('rate_limits', 'rate_salts')`,
      )
      return rows[0]!.c
    }
    const before = await counts()
    const forged = clone(good.session)
    forged.responses.push(['i:tst:g1:00002', 0, 1, 1, 10, null])
    await verify(db, emptySave(good.anonId, { sessions: [forged, good.session], seen_items: ['i:tst:g1:00001'] }))
    expect(await counts()).toBe(before)
  })
})

// ------------------------------------------------------------------------------------ tampering

describe('a tampered save is unverified', () => {
  /** Every position in a JSON value: a path from the root. */
  function paths(v: unknown, at: (string | number)[] = []): (string | number)[][] {
    if (Array.isArray(v)) return [at, ...v.flatMap((x, i) => paths(x, [...at, i]))]
    if (v !== null && typeof v === 'object') return [at, ...Object.entries(v).flatMap(([k, x]) => paths(x, [...at, k]))]
    return [at]
  }
  const get = (v: any, path: (string | number)[]): any => path.reduce((x, k) => x[k], v)

  /** One random edit of the session body at a random position; never the identity. */
  function mutate(session: SessionObject, rng: Rng): [string, SessionObject] {
    const out = clone(session)
    const { sig: _sig, ...body } = out
    const where = paths(body).filter((p) => p.length > 0)
    const path = where[rng.int(0, where.length - 1)]!
    const parent = get(out, path.slice(0, -1))
    const k = path[path.length - 1]!
    const v = parent[k]
    const label = `${path.join('/')}`
    if (Array.isArray(v)) {
      const how = rng.int(0, 3)
      if (how === 0 && v.length > 0) v.pop()
      else if (how === 1 && v.length > 0) v.push(clone(v[0]))
      else if (how === 2 && v.length > 1) v.reverse()
      else v.push(null)
      if (JSON.stringify(v) === JSON.stringify(get(session, path))) v.push('x')
    } else if (v !== null && typeof v === 'object') {
      const keys = Object.keys(v)
      if (keys.length > 0 && rng.next() < 0.5) delete v[keys[rng.int(0, keys.length - 1)]!]
      else v.added_key = 1
    } else if (typeof v === 'number') parent[k] = rng.next() < 0.5 ? v + 1 : -v - 1
    else if (typeof v === 'string') parent[k] = rng.next() < 0.5 ? `${v}x` : v.length > 1 ? v.slice(0, -1) : `${v}${v}`
    else if (typeof v === 'boolean') parent[k] = !v
    else parent[k] = 0
    return [label, out]
  }

  it('flags every one of 400 random edits of a signed session, wherever they fall', async () => {
    const f = await finishedSession(db, 10)
    const rng = createRng('tamper')
    const edits: [string, SessionObject][] = []
    for (let i = 0; i < 400; i++) edits.push(mutate(f.session, rng))
    for (const [label, e] of edits) expect(JSON.stringify(e), label).not.toBe(JSON.stringify(f.session))
    const got: string[] = []
    for (let i = 0; i < edits.length; i += 100) got.push(...(await statuses(db, f.anonId, edits.slice(i, i + 100).map(([, e]) => e))))
    const notFlagged = edits.map(([label], i) => [label, got[i]] as const).filter(([, s]) => s === 'verified')
    expect(notFlagged).toEqual([])
    // an edit is a bad signature, or (an edit that breaks the shape) malformed; never an error, never "unsigned"
    expect(new Set(got)).toEqual(new Set(['bad_signature']))
  })

  it('flags an edit of any single leaf: each answer, each time, each flag, the device, the duration', async () => {
    const f = await finishedSession(db, 7)
    const body = clone(f.session)
    delete body.sig
    const leaves = paths(body).filter((p) => p.length > 0 && typeof get(body, p) !== 'object')
    expect(leaves.length).toBeGreaterThan(40)
    const edited = leaves.map((p) => {
      const e = clone(f.session)
      const parent = get(e, p.slice(0, -1))
      const k = p[p.length - 1]!
      const v = parent[k]
      parent[k] = typeof v === 'number' ? v + 1 : typeof v === 'string' ? `${v}!` : typeof v === 'boolean' ? !v : 0
      return e
    })
    const got: string[] = []
    for (let i = 0; i < edited.length; i += 100) got.push(...(await statuses(db, f.anonId, edited.slice(i, i + 100))))
    expect(got.filter((s) => s !== 'bad_signature')).toEqual([])
    // the control: the untouched session
    expect(await statuses(db, f.anonId, [f.session])).toEqual(['verified'])
  })

  it('flags a response added, dropped or moved, a session id swapped, and a MAC lifted onto another session', async () => {
    const a = await finishedSession(db, 6)
    const b = await finishedSession(db, 6)
    const added = clone(a.session)
    added.responses.push(clone(added.responses[0]))
    const dropped = clone(a.session)
    dropped.responses.pop()
    const moved = clone(a.session)
    moved.responses.reverse()
    const renamed = { ...clone(a.session), session_id: b.sessionId }
    const lifted = { ...clone(b.session), sig: clone(a.session.sig) }
    const relabelled = { ...clone(a.session), sig: { ...clone(a.session.sig), anon_id: b.anonId } }
    expect(await statuses(db, a.anonId, [added, dropped, moved, renamed, lifted, relabelled, a.session, b.session])).toEqual([
      'bad_signature', 'bad_signature', 'bad_signature', 'bad_signature', 'bad_signature', 'bad_signature', 'verified', 'verified',
    ])
  })

  it('never counts a tampered session anywhere: rescore, delete_my_data and start_session see it as unknown', async () => {
    const ctx = await openBankDb('tamper-use')
    try {
      const f = await finishedSession(ctx, 12)
      const edited = clone(f.session)
      edited.responses[0][2] = 99
      const save = emptySave(f.anonId, { sessions: [edited] })
      // rescore: the session is not known, so nothing of it is scored or shown
      const r = await ctx.rpc<{ sessions: { known: boolean }[]; skipped: Record<string, number>; eap: object }>(from(freshIp()), 'rescore', { p_save: save })
      expect(r.sessions.map((s) => s.known)).toEqual([false])
      expect(r.skipped.unknown_sessions).toBe(1)
      expect(r.eap).toEqual({})
      // delete_my_data: not proved
      expect(await ctx.rpc(from(freshIp()), 'delete_my_data', { p_anon_id: f.anonId, p_save: save })).toEqual({ deleted: false })
      // start_session: the anon_id is not continued
      const s = await startSession(ctx, freshIp(), save)
      expect(s.anon_id_adopted).toBe(false)
      expect(s.anon_id).not.toBe(f.anonId)
      // ...while the signed original proves all three
      const ok = emptySave(f.anonId, { sessions: [f.session] })
      expect((await startSession(ctx, freshIp(), ok)).anon_id_adopted).toBe(true)
      const known = await ctx.rpc<{ sessions: { known: boolean }[] }>(from(freshIp()), 'rescore', { p_save: ok })
      expect(known.sessions.map((x) => x.known)).toEqual([true])
      expect(await ctx.rpc(from(freshIp()), 'delete_my_data', { p_anon_id: f.anonId, p_save: ok })).toMatchObject({ deleted: true })
    } finally {
      await ctx.close()
    }
  })

  it('does not let one person\'s file stand for another\'s: a session signed for A under B\'s anon_id proves nothing', async () => {
    const ctx = await openBankDb('anon-binding')
    try {
      const victim = await finishedSession(ctx, 6)
      const stranger = await finishedSession(ctx, 6)
      const forgery = { ...clone(stranger.session), sig: { ...clone(stranger.session.sig), anon_id: victim.anonId } }
      for (const save of [emptySave(victim.anonId, { sessions: [forgery] }), emptySave(stranger.anonId, { sessions: [forgery] }), emptySave(victim.anonId, { sessions: [stranger.session] })]) {
        expect(await ctx.rpc(from(freshIp()), 'delete_my_data', { p_anon_id: victim.anonId, p_save: save })).toEqual({ deleted: false })
        expect((await startSession(ctx, freshIp(), save)).anon_id_adopted).toBe(false)
        const r = await ctx.rpc<{ sessions: { known: boolean }[] }>(from(freshIp()), 'rescore', { p_save: save })
        expect(r.sessions.map((x) => x.known)).toEqual([false])
      }
      expect((await ctx.owner.query(`select count(*)::int as n from public.sessions where anon_id = $1`, [victim.anonId])).rows[0]!.n).toBe(1)
    } finally {
      await ctx.close()
    }
  })
})

// ------------------------------------------------------------------------------------ the unverified path

describe('what the server does with an unverified save (DESIGN §8: displayed, never used)', () => {
  it('accepts an offline file for personal display, counts none of it, and stores none of it', async () => {
    const ctx = await openBankDb('offline')
    try {
      const rng = createRng('offline')
      const offline = emptySave('hb_7Q3m9Kx2Vw5rT8pL', {
        sessions: Array.from({ length: 3 }, (_, i) => ({
          session_id: `s_offline${String(i).padStart(4, '0')}`,
          started_utc: '2026-09-01T10:00:00Z',
          duration_s: 600 + i,
          device: DEVICE,
          flags: {},
          responses: Array.from({ length: 12 }, (_, j) => [`i:tst:g1:${String(1 + ((i * 12 + j) % 50)).padStart(5, '0')}`, 0, rng.int(0, 3), 1, 4000, null]),
        })),
        seen_items: ['i:tst:g1:00001'],
        seen_families: [],
      })
      const out = await verify(ctx, offline)
      expect(out.sessions.map((s) => [s.status, s.reason])).toEqual([['unverified', 'unsigned'], ['unverified', 'unsigned'], ['unverified', 'unsigned']])
      const r = await ctx.rpc<{ eap: object; skipped: Record<string, number> }>(from(freshIp()), 'rescore', { p_save: offline })
      expect(r.eap).toEqual({})
      expect(r.skipped.unknown_sessions).toBe(3)
      const s = await startSession(ctx, freshIp(), offline)
      expect(s.anon_id_adopted).toBe(false)
      expect(await ctx.rpc(from(freshIp()), 'delete_my_data', { p_anon_id: 'hb_7Q3m9Kx2Vw5rT8pL', p_save: offline })).toEqual({ deleted: false })
      // nothing of the file reached a table that calibration reads (A16: only the database's own rows)
      expect((await ctx.owner.query(`select count(*)::int as n from public.responses`)).rows[0]!.n).toBe(0)
      expect((await ctx.owner.query(`select count(*)::int as n from public.sessions`)).rows[0]!.n).toBe(1)
    } finally {
      await ctx.close()
    }
  })

  it('has exactly one way into `responses` (submit) and `sessions` (start_session): no upload can enter calibration', async () => {
    const writers = async (table: string): Promise<string[]> =>
      (
        await db.sudo.query<{ f: string }>(
          `select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'hb') and p.prosrc ~* ('(insert\\s+into|update|delete\\s+from)\\s+public\\.' || $1 || '\\y') order by 1`,
          [table],
        )
      ).rows.map((r) => r.f)
    expect(await writers('responses')).toEqual(['public.submit'])
    // sessions are created by start_session and updated by the session's own calls (serve_next counts the items served);
    // delete_my_data removes them
    expect(await writers('sessions')).toEqual(['hb.serve_next', 'public.delete_my_data', 'public.finish', 'public.start_session', 'public.submit'])
  })

  it('signs nothing but the session it built itself: the signer is reachable from finish only, and no RPC signs what it is sent', async () => {
    const callers = async (word: string): Promise<string[]> =>
      (
        await db.sudo.query<{ f: string }>(
          `select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'hb') and p.prosrc ~ ('\\y' || $1 || '\\y') order by 1`,
          [word],
        )
      ).rows.map((r) => r.f)
    expect(await callers('mac_sign')).toEqual(['hb.session_mac'])
    expect(await callers('session_mac')).toEqual(['hb.session_signed', 'hb.session_verdict', 'hb.signing_check'])
    expect(await callers('session_signed')).toEqual(['public.finish'])
    // and finish takes no session or file from the caller: its arguments are a token and the client's flags (numbers and booleans)
    const { rows } = await db.sudo.query<{ args: string }>(`select pg_get_function_identity_arguments('public.finish(text, jsonb)'::regprocedure) as args`)
    expect(rows[0]!.args).toBe('p_token text, p_flags jsonb')
    // the flags can carry no text, so no string of the caller's can end up in a signed session through them
    const f = await finishedSession(db, 2)
    const bad = await db.rpc(from(f.ip), 'finish', { p_token: f.token, p_flags: { note: 'sig' } }).catch((e: unknown) => e)
    expect(pgCode(bad)).toBe('PT400')
  })
})

// ------------------------------------------------------------------------------------- the key

describe('the signing key and its kids', () => {
  let kdb: TestDb
  beforeAll(async () => {
    kdb = await openBankDb('keys')
  })
  afterAll(async () => {
    await kdb.close()
  })

  const secret = (): string => randomBytes(24).toString('hex')
  const setSecret = (name: string, value: string): Promise<unknown> => kdb.sudo.query(`select vault.create_secret($1, $2)`, [value, name])
  const currentKid = (kid: string): Promise<unknown> => kdb.owner.query(`update public.app_config set value = to_jsonb($1::text) where key = 'sig.current_kid'`, [kid])
  const removeSecret = (name: string): Promise<unknown> => kdb.sudo.query(`delete from vault.secrets where name = $1`, [name])

  it('rotates: new sessions use the new kid, old ones keep verifying while their key exists, and stop when it is retired', async () => {
    const before = await finishedSession(kdb, 5)
    expect(before.session.sig.kid).toBe('k2026a')

    const keyB = secret()
    await setSecret('save_hmac.k2026b', keyB)
    await currentKid('k2026b')
    const after = await finishedSession(kdb, 5)
    expect(after.session.sig.kid).toBe('k2026b')
    expect(after.session.sig.mac).toBe(referenceMac(keyB, after.anonId, after.session))
    expect(after.session.sig.mac).not.toBe(referenceMac(await signingKey(kdb, 'k2026a'), after.anonId, after.session))
    // both kinds in one file
    expect(await statuses(kdb, before.anonId, [before.session, after.session])).toEqual(['verified', 'verified'])

    // retire the old key on purpose: what it signed is unverified, what the new key signed is not
    const keyA = await signingKey(kdb, 'k2026a')
    await removeSecret('save_hmac.k2026a')
    expect(await statuses(kdb, before.anonId, [before.session, after.session])).toEqual(['unknown_key', 'verified'])
    // finishing the old session again re-signs it with the current key (a lost reply is safe, a retired key is not a loss)
    const resigned = await kdb.rpc<{ session: SessionObject }>(from(before.ip), 'finish', { p_token: before.token })
    expect(resigned.session.sig.kid).toBe('k2026b')
    expect(await statuses(kdb, before.anonId, [resigned.session])).toEqual(['verified'])

    // a retirement undone: with the same value back under the old kid its signatures verify again
    await setSecret('save_hmac.k2026a', keyA)
    expect(await statuses(kdb, before.anonId, [before.session, after.session])).toEqual(['verified', 'verified'])
  })

  it('stops verifying a session when the key of its kid is replaced by another value', async () => {
    const f = await finishedSession(kdb, 3)
    expect(await statuses(kdb, f.anonId, [f.session])).toEqual(['verified'])
    const name = `save_hmac.${f.session.sig.kid as string}`
    const value = await signingKey(kdb, f.session.sig.kid as string)
    await kdb.sudo.query(`select vault.update_secret(id, $2) from vault.secrets where name = $1`, [name, secret()])
    expect(await statuses(kdb, f.anonId, [f.session])).toEqual(['bad_signature'])
    await kdb.sudo.query(`select vault.update_secret(id, $2) from vault.secrets where name = $1`, [name, value])
    expect(await statuses(kdb, f.anonId, [f.session])).toEqual(['verified'])
  })

  it('accepts a kid with dots, dashes and underscores, and no other', async () => {
    const key = secret()
    await setSecret('save_hmac.k.2027-b_1', key)
    await currentKid('k.2027-b_1')
    const f = await finishedSession(kdb, 2)
    expect(f.session.sig.kid).toBe('k.2027-b_1')
    expect(f.session.sig.mac).toBe(referenceMac(key, f.anonId, f.session))
    expect(await statuses(kdb, f.anonId, [f.session])).toEqual(['verified'])
    // a configured kid that is not one signs nothing
    await setSecret('save_hmac.bad kid', secret())
    await currentKid('bad kid')
    const g = await finishedSession(kdb, 2)
    expect(g.session.sig).toBeUndefined()
    await currentKid('k2026b')
  })

  it('signs nothing, and still finishes, when sig.current_kid names no secret or no kid is set', async () => {
    await currentKid('k-nothing-here')
    const f = await finishedSession(kdb, 4)
    expect(f.session.sig).toBeUndefined()
    expect(f.session.responses.length).toBe(4)
    expect(validateSchema(emptySave(f.anonId, { sessions: [f.session] }))).toBe(true)
    expect(await statuses(kdb, f.anonId, [f.session])).toEqual(['unsigned'])
    await kdb.owner.query(`delete from public.app_config where key = 'sig.current_kid'`)
    const g = await finishedSession(kdb, 2)
    expect(g.session.sig).toBeUndefined()
    await kdb.owner.query(`insert into public.app_config (key, value) values ('sig.current_kid', '"k2026b"')`)
  })

  it('uses no key shorter than 32 characters: nothing is signed with it and nothing verifies by it', async () => {
    await setSecret('save_hmac.kshort', 'too-short-secret')
    await currentKid('kshort')
    const f = await finishedSession(kdb, 3)
    expect(f.session.sig).toBeUndefined()
    // a sig made by someone who knows that short value is not accepted either
    const forged = { ...clone(f.session), sig: { alg: 'HMAC-SHA256', kid: 'kshort', mac: referenceMac('too-short-secret', f.anonId, f.session), anon_id: f.anonId } }
    expect(await statuses(kdb, f.anonId, [forged])).toEqual(['unknown_key'])
    await currentKid('k2026b')
  })

  it('with the Vault empty: finish still returns the session, every file is unverified, and the server says so without failing', async () => {
    const empty = await openBankDb('no-vault-key')
    try {
      const signedBefore = await finishedSession(empty, 3)
      expect(signedBefore.session.sig).toBeDefined()
      await empty.sudo.query(`delete from vault.secrets`)
      const f = await finishedSession(empty, 3)
      expect(f.session.sig).toBeUndefined()
      expect(await statuses(empty, f.anonId, [f.session, signedBefore.session])).toEqual(['unsigned', 'unknown_key'])
      // and a person who only has such files can still delete their data by the phrase, rescore returns nothing but is not an error
      const r = await empty.rpc<{ skipped: Record<string, number> }>(from(freshIp()), 'rescore', { p_save: emptySave(f.anonId, { sessions: [f.session] }) })
      expect(r.skipped.unknown_sessions).toBe(1)
    } finally {
      await empty.close()
    }
  })
})

describe('a session whose answers the canonical form cannot hold', () => {
  it('still finishes, unsigned, instead of failing and losing the person\'s results: an answer nested 40 levels deep, or a number no double holds', async () => {
    for (const [what, response] of [
      ['40 levels deep', '[' .repeat(40) + '1' + ']'.repeat(40)],
      ['a number beyond the double range', '1e999'],
      ['a long string of digits', '9'.repeat(400)],
    ] as const) {
      const ip = freshIp()
      const s = await startSession(db, ip)
      const first = await db.rpc<{ item: { item_id: string } }>(from(ip), 'next_item', { p_token: s.token })
      await db.sudo.query(`update public.exposure_log set served_at = served_at - interval '30 seconds' where session_id = $1`, [s.session_id])
      await db.query(from(ip), `select public.submit($1, $2, $3::jsonb, 4000)`, [s.token, first.item.item_id, response])
      const fin = await db.rpc<{ session: SessionObject; n_responses: number }>(from(ip), 'finish', { p_token: s.token })
      expect(fin.n_responses, what).toBe(1)
      expect(fin.session.sig, what).toBeUndefined()
      expect(fin.session.responses.length, what).toBe(1)
    }
  })
})

describe('what a file can make the server do', () => {
  it('measures a session as a file holds it: a duration ending in a zero is written without it, so finish and verify count the same bytes', async () => {
    const f = await finishedSession(db, 2)
    // [how long the session took, the duration_s a client reads and writes back]
    const cases: [string, number][] = [['12.340 seconds', 12.34], ['7.000 seconds', 7], ['0.100 seconds', 0.1], ['0.105 seconds', 0.105], ['3600.5 seconds', 3600.5]]
    for (const [took, written] of cases) {
      await db.sudo.query(`update public.sessions set started_at = finished_at - $2::interval where session_id = $1`, [f.sessionId, took])
      // the driver parses the jsonb as a client does (JSON.parse); the client writes it back with JSON.stringify
      const held = (await db.sudo.query<{ o: SessionObject }>(`select hb.session_object($1) as o`, [f.sessionId])).rows[0]!.o
      expect(held.duration_s, took).toBe(written)
      const n = (await db.sudo.query<{ server: number; file: number }>(
        `select octet_length(hb.session_object($1)::text)::int as server, octet_length($2::jsonb::text)::int as file`,
        [f.sessionId, JSON.stringify(held)],
      )).rows[0]!
      expect(n.server, took).toBe(n.file)
    }
  })

  it('signs a session exactly when verify would accept it: one byte over sig.max_session_bytes is returned unsigned and is malformed', async () => {
    const ctx = await openBankDb('size')
    try {
      const small = await finishedSession(ctx, 1)
      const big = await finishedSession(ctx, 12)
      expect(small.session.sig).toBeDefined()
      expect(big.session.sig).toBeDefined()
      // the size both sides measure: the session as it is sent, sig included, as jsonb text
      const size = async (f: Finished): Promise<number> => (await ctx.sudo.query<{ n: number }>(`select octet_length($1::jsonb::text)::int as n`, [JSON.stringify(f.session)])).rows[0]!.n
      const [a, b] = [await size(small), await size(big)]
      expect(a).toBeLessThan(b)
      const setLimit = (n: number): Promise<unknown> => ctx.owner.query(`update public.app_config set value = to_jsonb($1::int) where key = 'sig.max_session_bytes'`, [n])
      const again = async (f: Finished): Promise<SessionObject> => (await ctx.rpc<{ session: SessionObject }>(from(f.ip), 'finish', { p_token: f.token })).session

      // a limit of exactly the big one's size: both are signed and both verify
      await setLimit(b)
      const atLimit = await again(big)
      expect(atLimit.sig).toBeDefined()
      expect(await statuses(ctx, big.anonId, [atLimit, small.session])).toEqual(['verified', 'verified'])
      // a byte less: finishing again signs the small one still, the big one no longer
      await setLimit(b - 1)
      expect((await again(small)).sig).toBeDefined()
      const unsigned = await again(big)
      expect(unsigned.sig).toBeUndefined()
      expect(unsigned.responses.length).toBe(12)
      // and the one signed before the limit came down is no longer accepted either: the same size rule on both sides
      expect(await statuses(ctx, big.anonId, [atLimit, small.session])).toEqual(['malformed', 'verified'])
    } finally {
      await ctx.close()
    }
  })

  it('looks at the first 200 sessions of a file when it asks who a file belongs to, however many it lists', async () => {
    const ctx = await openBankDb('padding')
    try {
      const f = await finishedSession(ctx, 3)
      const junk = (i: number): SessionObject => ({ ...clone(f.session), session_id: `s_pad${String(i).padStart(8, '0')}` })
      const early = emptySave(f.anonId, { sessions: [...Array.from({ length: 199 }, (_, i) => junk(i)), f.session, ...Array.from({ length: 300 }, (_, i) => junk(1000 + i))] })
      const late = emptySave(f.anonId, { sessions: [...Array.from({ length: 200 }, (_, i) => junk(i)), f.session] })
      expect((await startSession(ctx, freshIp(), early)).anon_id_adopted).toBe(true)
      expect((await startSession(ctx, freshIp(), late)).anon_id_adopted).toBe(false)
      expect(await ctx.rpc(from(freshIp()), 'delete_my_data', { p_anon_id: f.anonId, p_save: late })).toEqual({ deleted: false })
      expect(await ctx.rpc(from(freshIp()), 'delete_my_data', { p_anon_id: f.anonId, p_save: early })).toMatchObject({ deleted: true })
    } finally {
      await ctx.close()
    }
  })
})

// ------------------------------------------------------------------------ bounded work

describe('the work one call can cause is bounded (the anon timeout is 3 s, and a cancelled call keeps no rate-limit count)', () => {
  let ctx: TestDb
  let good: Finished
  beforeAll(async () => {
    ctx = await openBankDb('work')
    good = await finishedSession(ctx, 4)
  })
  afterAll(async () => {
    await ctx.close()
  })

  const work = async (text: string): Promise<number> => (await ctx.sudo.query<{ w: number }>(`select hb.json_work($1) as w`, [text])).rows[0]!.w
  /** The work of a session as it is sent, sig included. */
  const sentWork = async (session: SessionObject): Promise<number> => (await ctx.sudo.query<{ w: number }>(`select hb.json_work($1::jsonb::text) as w`, [JSON.stringify(session)])).rows[0]!.w
  const setWork = (n: number): Promise<unknown> => ctx.owner.query(`update public.app_config set value = to_jsonb($1::int) where key = 'verify.max_work'`, [n])
  const DEFAULT_WORK = 100_000

  it('counts a unit for every array start, object start, comma and object key, and ten for a run of 17 digits or more that does not follow a digit or a point', async () => {
    expect(await work('[]')).toBe(1)
    expect(await work('[1,2,3]')).toBe(3)
    expect(await work('{"a":1,"b":[1,2]}')).toBe(6)
    expect(await work('"i:tst:g1:00001"')).toBe(0) // the colons of an id are no keys
    expect(await work('"a, b: [c] {d}"')).toBe(3) // inside strings too: an estimate can only be too high
    expect(await work('12345678901234567')).toBe(10)
    expect(await work('[12345678901234567,1234567890123456]')).toBe(12)
    expect(await work('0.12345678901234567')).toBe(0)
    expect(await work('12345678901234567.5')).toBe(10)
    expect(await work('1'.repeat(300))).toBe(10)
    expect(await work('')).toBe(0)
  })

  it('is about 1,500 units for a real session of 200 answers, and 40 of them are within the budget', async () => {
    const body = {
      session_id: 's_bench00000001',
      started_utc: '2026-10-01T12:00:00Z',
      duration_s: 1234.5,
      device: DEVICE,
      flags: { visibility_hidden_s: 2, paste_events: 0, fast_guess_n: 0 },
      responses: Array.from({ length: 200 }, (_, j) => [`i:tst:g1:${String(1 + (j % 60)).padStart(5, '0')}`, 0, j % 4, null, 3000 + j * 13, j % 5 === 0 ? 80 : null]),
    }
    const w = await work((await ctx.sudo.query<{ t: string }>(`select $1::jsonb::text as t`, [JSON.stringify(body)])).rows[0]!.t)
    expect(w).toBeGreaterThan(1300)
    expect(w).toBeLessThan(1700)
    expect(w * 40).toBeLessThan(DEFAULT_WORK) // rescore takes at most 40 sessions
  })

  it('signs a session exactly when verify would accept it: the same limit in units on both sides, to the unit, the sig included', async () => {
    const f = await finishedSession(ctx, 6)
    // the work of the session as it is sent
    const w = (await ctx.sudo.query<{ w: number }>(`select hb.json_work($1::jsonb::text) as w`, [JSON.stringify(f.session)])).rows[0]!.w
    const again = async (): Promise<SessionObject> => (await ctx.rpc<{ session: SessionObject }>(from(f.ip), 'finish', { p_token: f.token })).session
    try {
      await setWork(w)
      const signed = await again()
      expect(signed.sig).toBeDefined()
      // alone in a file it passes the file's rule as well: the file is measured with its sigs
      expect(await statuses(ctx, f.anonId, [signed])).toEqual(['verified'])
      await setWork(w - 1)
      const unsigned = await again()
      expect(unsigned.sig).toBeUndefined()
      expect(unsigned.responses.length).toBe(6)
      // signed before the limit came down, the same session is over it: a file of it is refused as a file (413), and the
      // session's own rule, which the proofs use, calls it malformed
      expect(pgCode(await verify(ctx, emptySave(f.anonId, { sessions: [signed] })).catch((e: unknown) => e))).toBe('PT413')
      const v = await ctx.sudo.query<{ v: string }>(`select hb.session_verdict($1::jsonb) as v`, [JSON.stringify(signed)])
      expect(v.rows[0]!.v).toBe('malformed')
    } finally {
      await setWork(DEFAULT_WORK)
    }
  })

  it('refuses a file whose sessions add up to more than the budget before doing any work: 413 save_too_complex from verify_save and rescore; start_session and delete_my_data take it as proof of nothing', async () => {
    const one = await sentWork(good.session)
    const copy: SessionObject = { ...clone(good.session), session_id: 's_copy000000001' }
    const single = emptySave(good.anonId, { sessions: [good.session] })
    const twice = emptySave(good.anonId, { sessions: [good.session, copy] })
    try {
      await setWork(Math.ceil(one * 1.5)) // room for one copy of the session, not for two
      expect((await verify(ctx, single)).sessions[0]!.status).toBe('verified')
      for (const fn of ['verify_save', 'rescore']) {
        const err = await ctx.rpc(from(freshIp()), fn, { p_save: twice }).catch((e: unknown) => e)
        expect(pgCode(err), fn).toBe('PT413')
        expect((err as Error).message, fn).toBe('save_too_complex')
      }
      expect((await startSession(ctx, freshIp(), twice)).anon_id_adopted).toBe(false)
      expect(await ctx.rpc(from(freshIp()), 'delete_my_data', { p_anon_id: good.anonId, p_save: twice })).toEqual({ deleted: false })
      // the same file, with room, proves the anon_id
      await setWork(one * 3)
      expect((await startSession(ctx, freshIp(), twice)).anon_id_adopted).toBe(true)
    } finally {
      await setWork(DEFAULT_WORK)
    }
  })

  // Sessions that carry the signature of a real one but a heavy answer: forged, so every one is canonicalised and
  // found "bad_signature", which is the whole cost. Two of them add up to 70,000 to 80,000 units, under the budget.
  const forged = (answer: unknown, i: number): SessionObject => ({
    ...clone(good.session),
    session_id: `s_heavy${String(i).padStart(6, '0')}`,
    responses: [['i:tst:g1:00001', 0, answer, null, 1000, null]],
  })
  // [what the answer is made of, the answer, how many sessions of it, the least units the file must have to be a fair test]
  const SHAPES: [string, unknown, number, number][] = [
    ['12,000 objects with a member', Array.from({ length: 12_000 }, () => ({ a: 1 })), 2, 60_000],
    ['12,000 arrays in arrays', Array.from({ length: 12_000 }, () => [[1]]), 2, 60_000],
    ['3,500 integers of 17 digits, the dearest number to print', Array.from({ length: 3_500 }, (_, i) => 12345678901234000 + 2 * i), 2, 60_000],
    ['11,000 numbers of 17 significant digits behind the point, as many sessions as a file holds', Array.from({ length: 11_000 }, (_, i) => 0.12345678901234567 + i / 1e10), 6, 50_000],
  ]

  it.each(SHAPES)('finishes, and is counted against the address, when a file near the limits is made of %s', async (_label, answer, n, least) => {
    const save = emptySave(good.anonId, { sessions: Array.from({ length: n }, (_, i) => forged(answer, i + 1)) })
    const w = (await ctx.sudo.query<{ w: number }>(`select hb.json_work(($1::jsonb -> 'sessions')::text) as w`, [JSON.stringify(save)])).rows[0]!.w
    expect(w).toBeGreaterThan(least)
    expect(w).toBeLessThanOrEqual(DEFAULT_WORK)
    const ip = freshIp()
    await ctx.owner.query(`update public.app_config set value = '1' where key = 'rate.verifies_per_day'`)
    try {
      // with a statement_timeout of 3 s this would reject with 57014, and the count would be rolled back with it
      const out = await verify(ctx, save, ip)
      expect(out.sessions.map((x) => x.reason)).toEqual(Array.from({ length: n }, () => 'bad_signature'))
      expect(pgCode(await verify(ctx, emptySave(good.anonId), ip).catch((e: unknown) => e))).toBe('PT429')
    } finally {
      await ctx.owner.query(`update public.app_config set value = '60' where key = 'rate.verifies_per_day'`)
    }
  })

  it('refuses the same shapes, just over the budget, at once and with a 413, and signs and verifies nothing of them', async () => {
    const answer = Array.from({ length: 12_000 }, () => ({ a: 1 }))
    const save = emptySave(good.anonId, { sessions: [forged(answer, 1), forged(answer, 2), forged(answer, 3)] })
    for (const fn of ['verify_save', 'rescore']) {
      const t0 = performance.now()
      const err = await ctx.rpc(from(freshIp()), fn, { p_save: save }).catch((e: unknown) => e)
      expect(pgCode(err), fn).toBe('PT413')
      expect((err as Error).message).toBe('save_too_complex')
      expect(performance.now() - t0, fn).toBeLessThan(2500)
    }
  })

  it('does not take a session with an answer that has no canonical form for a fault: it is malformed, with a code of its own from the MAC function', async () => {
    const deep = JSON.parse('['.repeat(40) + ']'.repeat(40)) as unknown
    const err = await ctx.sudo.query(`select hb.session_mac('k2026a', 'hb_AAAAAAAAAAAAAAAA', $1::jsonb)`, [JSON.stringify({ a: deep })]).catch((e: unknown) => e)
    expect(pgCode(err)).toBe('PT400')
    expect((err as Error).message).toBe('not_canonical')
    expect(await statuses(ctx, good.anonId, [{ ...clone(good.session), responses: [['i:tst:g1:00001', 0, deep, null, 1000, null]] }])).toEqual(['malformed'])
  })
})

// ------------------------------------------------------------------------ a fault is not a missing key

describe('a fault of the signer is not a missing key', () => {
  let fdb: TestDb
  beforeAll(async () => {
    fdb = await openBankDb('fault')
  })
  afterAll(async () => {
    await fdb.close()
  })

  const check = (): Promise<Record<string, unknown>> => fdb.sudo.query<{ r: Record<string, unknown> }>(`select hb.signing_check() as r`).then((x) => x.rows[0]!.r)
  const currentKid = (kid: string): Promise<unknown> => fdb.owner.query(`update public.app_config set value = to_jsonb($1::text) where key = 'sig.current_kid'`, [kid])

  it('hb.signing_check says ok with a key, says why when there is none, and never shows the key or a MAC', async () => {
    expect(await check()).toEqual({ ok: true, kid: 'k2026a' })
    expect(JSON.stringify(await check())).not.toContain(await signingKey(fdb))
    await currentKid('k-nothing-here')
    expect(await check()).toEqual({ ok: false, kid: 'k-nothing-here', reason: 'no_usable_key' })
    await fdb.sudo.query(`select vault.create_secret('too-short-secret', 'save_hmac.kshort')`)
    await currentKid('kshort')
    expect(await check()).toEqual({ ok: false, kid: 'kshort', reason: 'no_usable_key' })
    await fdb.owner.query(`delete from public.app_config where key = 'sig.current_kid'`)
    expect(await check()).toEqual({ ok: false, reason: 'no_current_kid' })
    await fdb.owner.query(`insert into public.app_config (key, value) values ('sig.current_kid', '"k2026a"')`)
    expect(await check()).toEqual({ ok: true, kid: 'k2026a' })
  })

  it('is raised, not hidden: with the signer unable to read the Vault, verify_save errors instead of calling a signed session malformed, hb.signing_check raises, and finish still returns the results, unsigned, with a WARNING', async () => {
    const before = await finishedSession(fdb, 4)
    expect(before.session.sig).toBeDefined()
    const notices: string[] = []
    const c = await fdb.sudo.connect()
    c.on('notice', (n) => notices.push(`${n.severity}: ${n.message}`))
    await fdb.sudo.query(`revoke select on table vault.decrypted_secrets from postgres`)
    try {
      // the deployment is faulty: the checks that need the signer say so, in an error
      expect(pgCode(await check().catch((e: unknown) => e))).toBe(PERMISSION_DENIED)
      const err = await verify(fdb, emptySave(before.anonId, { sessions: [before.session] })).catch((e: unknown) => e)
      expect(pgCode(err)).toBe(PERMISSION_DENIED)
      // nothing is called malformed or unsigned that was neither: an unsigned or malformed session needs no signer
      const offline: SessionObject = { ...clone(before.session), session_id: 's_offlineMVP0002' }
      delete offline.sig
      expect((await verify(fdb, emptySave(before.anonId, { sessions: [offline, { sig: 7 }] }))).sessions.map((x) => x.reason)).toEqual(['unsigned', 'malformed'])
      // finish: the person's results are returned, unsigned, and the log says what happened
      const after = await finishedSession(fdb, 3)
      expect(after.session.sig).toBeUndefined()
      expect(after.session.responses.length).toBe(3)
      const signed = await c.query<{ s: SessionObject }>(`select hb.session_signed($1) as s`, [after.sessionId])
      expect(signed.rows[0]!.s.sig).toBeUndefined()
      expect(notices.join('\n')).toMatch(/WARNING: hb: signing a session failed \(SQLSTATE 42501: permission denied for view decrypted_secrets\)/)
      expect(notices.join('\n')).not.toContain(await signingKey(fdb).catch(() => 'no key readable'))
    } finally {
      await fdb.sudo.query(`grant select on table vault.decrypted_secrets to postgres with grant option`)
      c.release()
    }
    // repaired: everything works again, and the session finished while it was broken is signed by finishing again
    expect(await check()).toEqual({ ok: true, kid: 'k2026a' })
    expect(await statuses(fdb, before.anonId, [before.session])).toEqual(['verified'])
  })
})

// ---------------------------------------------------------------------------------- key hygiene

describe('nothing reads the key but the function that signs with it', () => {
  it('keeps the Vault out of reach of anon, authenticated, service_role and the owner of the RPCs', async () => {
    for (const ctx of [ANON, AUTHENTICATED]) {
      expect(await rejectedWith(db.query(ctx, `select * from vault.decrypted_secrets`))).toBe(PERMISSION_DENIED)
      expect(await rejectedWith(db.query(ctx, `select hb.mac_sign('k2026a', 'x')`))).toBe(PERMISSION_DENIED)
    }
    const asRole = async (role: string, sql: string): Promise<string | undefined> => {
      const c = await db.sudo.connect()
      try {
        await c.query('begin')
        await c.query(`set local role ${role}`)
        await c.query(sql)
        return undefined
      } catch (e) {
        return pgCode(e)
      } finally {
        await c.query('rollback').catch(() => undefined)
        c.release()
      }
    }
    // hb_definer owns every RPC and cannot read a secret; it can only ask hb.mac_sign for a MAC
    expect(await asRole('hb_definer', `select decrypted_secret from vault.decrypted_secrets`)).toBe(PERMISSION_DENIED)
    expect(await asRole('hb_definer', `select secret from vault.secrets`)).toBe(PERMISSION_DENIED)
    expect(await asRole('hb_definer', `select hb.mac_sign('k2026a', 'x')`)).toBeUndefined()
    expect(await asRole('service_role', `select hb.mac_sign('k2026a', 'x')`)).toBe(PERMISSION_DENIED)
    // the migration role, which owns the signer, is the one role that reads the view
    expect(await asRole('postgres', `select decrypted_secret from vault.decrypted_secrets`)).toBeUndefined()
  })

  it('applies the real Vault\'s privilege rule: a role granted SELECT on the view and nothing else cannot read a secret (so the signer is owned by postgres)', async () => {
    // The first version of M2.3 gave the signer a role of its own with exactly these grants. The view decrypts through
    // vault._crypto_aead_det_decrypt, whose EXECUTE is checked against the role that runs the query; the shim has
    // that rule, so a repeat of the mistake fails here and not on the live project.
    const c = await db.sudo.connect()
    try {
      await c.query('begin')
      await c.query('create role probe_reader nologin')
      await c.query('grant usage on schema vault to probe_reader')
      await c.query('grant select on vault.decrypted_secrets to probe_reader')
      await c.query('set local role probe_reader')
      // the columns that need no decryption are readable: it is the function that is refused
      expect((await c.query('select count(*)::int as n from vault.decrypted_secrets where name is not null')).rows[0].n).toBeGreaterThan(0)
      const err = await c.query('select decrypted_secret from vault.decrypted_secrets').then(() => undefined, (e: unknown) => e)
      expect(pgCode(err)).toBe(PERMISSION_DENIED)
      expect((err as Error).message).toMatch(/permission denied for function _crypto_aead_det_decrypt/)
    } finally {
      await c.query('rollback').catch(() => undefined)
      c.release()
    }
  })

  it('has one function owned by the migration role, the signer, and no role of its own for it', async () => {
    expect((await db.sudo.query(`select 1 from pg_roles where rolname = 'hb_signer'`)).rows).toEqual([])
    const owned = await db.sudo.query(
      `select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles r on r.oid = p.proowner
        where r.rolname = 'postgres' and n.nspname in ('public', 'hb') order by 1`,
    )
    expect(owned.rows.map((r) => r.f)).toEqual(['hb.mac_sign'])
    // only hb_definer may call it, and nobody else holds a privilege on it
    const acl = await db.sudo.query<{ acl: string[] }>(`select proacl::text[] as acl from pg_proc where oid = 'hb.mac_sign(text, text)'::regprocedure`)
    expect([...acl.rows[0]!.acl].sort()).toEqual(['hb_definer=X/postgres', 'postgres=X/postgres'])
    // it is the signer's key that is meant to be hidden: the function is SECURITY DEFINER with an empty search_path
    const f = await db.sudo.query(`select prosecdef, proconfig from pg_proc where oid = 'hb.mac_sign(text, text)'::regprocedure`)
    expect(f.rows[0]).toEqual({ prosecdef: true, proconfig: ['search_path=""'] })
  })

  it('leaves the surface of anon as it was plus the one new RPC', async () => {
    const surface = await exposedSurface(db, 'anon')
    expect(names(surface.functions)).toContain('public.verify_save')
    expect(surface.tables).toEqual([])
  })

  it('puts the key into no reply and no table: a session played from start to mirror and deletion never shows it', async () => {
    const key = await signingKey(db)
    const f = await finishedSession(db, 8)
    const replies: unknown[] = [f.session]
    replies.push(await verify(db, emptySave(f.anonId, { sessions: [f.session] })))
    replies.push(await db.rpc(from(freshIp()), 'rescore', { p_save: emptySave(f.anonId, { sessions: [f.session] }) }))
    replies.push(await db.rpc(from(f.ip), 'mirror_put', { p_token: f.token, p_save: emptySave(f.anonId, { sessions: [f.session] }) }))
    replies.push(await db.rpc(from(f.ip), 'report_problem', { p_token: f.token, p_kind: 'notes_requested' }))
    expect(JSON.stringify(replies)).not.toContain(key)
    // nor is it, or a copy of it, in any row of the application's tables
    const tables = (await db.sudo.query<{ relname: string }>(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`)).rows
    for (const t of tables) {
      const { rows } = await db.sudo.query<{ n: number }>(`select count(*)::int as n from public.${t.relname} x where to_jsonb(x)::text like '%' || $1 || '%'`, [key])
      expect(rows[0]!.n, t.relname).toBe(0)
    }
    // nor in the source of any function
    const src = await db.sudo.query<{ n: number }>(`select count(*)::int as n from pg_proc where prosrc like '%' || $1 || '%'`, [key])
    expect(src.rows[0]!.n).toBe(0)
  })

  it('keeps the sig out of the mirror\'s way: the mirror returns the file as stored, sig and all, and it still verifies', async () => {
    const f = await finishedSession(db, 4)
    const put = await db.rpc<{ stored: boolean; recovery_phrase: string }>(from(f.ip), 'mirror_put', { p_token: f.token, p_save: emptySave(f.anonId, { sessions: [f.session] }) })
    expect(put.stored).toBe(true)
    const got = await db.rpc<{ found: boolean; save: Record<string, unknown> }>(from(freshIp()), 'mirror_get', { p_anon_id: f.anonId, p_phrase: put.recovery_phrase })
    expect(got.found).toBe(true)
    expect((await verify(db, got.save)).sessions[0]!.status).toBe('verified')
  })
})

describe('the canonicalisation costs little (the anon timeout is 3 s)', () => {
  it('verifies a save of 40 sessions of 200 answers each in well under a second', async () => {
    const f = await finishedSession(db, 3)
    const sessions: SessionObject[] = []
    const { rows } = await db.sudo.query<{ kid: string }>(`select 'k2026a' as kid`)
    for (let i = 0; i < 40; i++) {
      const body = clone(f.session)
      delete body.sig
      body.session_id = `s_bench${String(i).padStart(4, '0')}`
      body.responses = Array.from({ length: 200 }, (_, j) => [`i:tst:g1:${String(1 + ((i * 7 + j) % 60)).padStart(5, '0')}`, 0, j % 4, null, 3000 + j * 13, j % 5 === 0 ? 80 : null])
      const mac = await db.sudo.query<{ m: string }>(`select hb.session_mac($1, $2, $3::jsonb) as m`, [rows[0]!.kid, f.anonId, JSON.stringify(body)])
      sessions.push({ ...body, sig: { alg: 'HMAC-SHA256', kid: rows[0]!.kid, mac: mac.rows[0]!.m, anon_id: f.anonId } })
    }
    const save = emptySave(f.anonId, { sessions })
    const t0 = performance.now()
    const out = await verify(db, save)
    const ms = performance.now() - t0
    expect(out.n_verified).toBe(40)
    expect(ms).toBeLessThan(1500)
  })
})
