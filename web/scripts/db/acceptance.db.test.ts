/**
 * M2.4 (ROADMAP M2.4; DESIGN §14.3 "M2 Backend" acceptance (1), (2), (4), and §11.2; R-11.1, R-12.1; ROADMAP A16, AI.26):
 * the acceptance tests of the backend, run on the local Postgres (A6). One block per line of the task:
 *
 *   (1) anon cannot `select` any table (and cannot write one either);
 *   (2) anon can EXECUTE only the whitelisted RPCs;
 *   (3) no response payload contains `key`: a fuzz over 1,000 items;
 *   (4) a tampered save is "unverified";
 *   (5) the rate limits: 5 sessions a day per hashed IP + salt, 200 items a session, an average of at least 2 s an item;
 *   (6) AI.26: a fuzz of 1,000 random saves finds no `brief_prefs` key in any RPC body or mirror blob, and the RPCs reject
 *       a crafted payload that holds it.
 *
 * (3) of the DESIGN (p95 RPC latency under 300 ms) is a measurement on the live project and belongs to M2.6.
 * The finer points of each are in the files of M2.1-M2.3 (schema, session, signing, mirror-delete, rescore); this file is
 * the one that says "the backend meets its acceptance", and it does so at the scale the roadmap names.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRng, type Rng } from '../../src/engine/prng'
import { fixtureBank, loadFixtureBank, type FixtureItem } from './bank-fixture'
import { ANON, AUTHENTICATED, SERVICE_ROLE, type RequestContext, type TestDb } from './harness'
import { ageExposures, emptySave, from, isServed, playSession, relaxSelection, signedSession, startSession, DEVICE, type Next, type SessionObject, type Started } from './rpc-support'
import { exposedSurface, names } from './surface'
import { PERMISSION_DENIED, openTestDb, pgCode, rejectedWith } from './vitest'

let ipCounter = 0
/** A client address nobody has used yet in this file (the rate limits are per address). */
const freshIp = (): string => {
  const n = ++ipCounter
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`
}
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T

/** Every object key anywhere inside a JSON value. */
function keysIn(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) for (const x of v) keysIn(x, out)
  else if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.push(k)
      keysIn(x, out)
    }
  }
  return out
}

/** Wider, for the replies of the RPCs: no property of them is named for a key, an answer or a verdict either (counts such as n_scored are fine). */
const KEYISH = /(key|answer|correct|solution|rationale|toler|option_weights|verdict)/i

// ================================================================================ (1) tables

describe('(1) anon cannot select any table', () => {
  let db: TestDb
  const WRITES = ['insert into {t} default values', 'update {t} set {c} = {c}', 'delete from {t}', 'truncate {t}']

  beforeAll(async () => {
    db = await openTestDb()
    await relaxSelection(db)
    const items = fixtureBank({ perAxis: 8, seed: 'tables' })
    await loadFixtureBank(db, items)
    // every table holds a row, so that "no rows came back" means something
    const ip = freshIp()
    const s = await startSession(db, ip)
    const bank = new Map(items.map((i) => [i.itemId, i]))
    await playSession(db, s, bank, { ip, n: 6, decide: () => true })
    await db.rpc(from(ip), 'finish', { p_token: s.token })
    const served = (await db.owner.query<{ item_id: string }>(`select item_id from public.exposure_log where session_id = $1 limit 1`, [s.session_id])).rows[0]!.item_id
    await db.rpc(from(ip), 'report_problem', { p_token: s.token, p_kind: 'typo', p_item_id: served, p_detail: 'a typo' })
    await db.rpc(from(ip), 'submit_survey', { p_token: s.token, p_age_band: '25-34', p_english_first: true })
    await db.rpc(from(ip), 'mirror_put', { p_token: s.token, p_save: emptySave(s.anon_id) })
    await db.owner.query(`insert into public.calibration_runs (param_version) values ('p-test')`)
  })
  afterAll(async () => {
    await db.close()
  })

  /** Every relation outside the system schemas: the tables of the app, the Vault's, and anything else a migration or the platform adds. */
  async function relations(): Promise<{ schema: string; name: string; kind: string }[]> {
    const { rows } = await db.sudo.query<{ schema: string; name: string; kind: string }>(
      `select n.nspname as schema, c.relname as name, c.relkind::text as kind
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%'
        order by 1, 2`,
    )
    return rows
  }
  const qualified = (r: { schema: string; name: string }): string => `"${r.schema}"."${r.name}"`

  it('holds a row in every table of the app, so the tests below could see one', async () => {
    const tables = (await relations()).filter((r) => r.schema === 'public')
    expect(tables.length).toBe(16)
    for (const t of tables) {
      const { rows } = await db.owner.query<{ n: number }>(`select count(*)::int as n from ${qualified(t)}`)
      expect(rows[0]!.n, t.name).toBeGreaterThan(0)
    }
  })

  it('refuses a select on every table, view and materialised view of every schema, to anon and to authenticated: permission denied', async () => {
    const all = await relations()
    expect(all.filter((r) => r.schema === 'public').length).toBe(16)
    expect(all.map((r) => r.schema).filter((s) => s !== 'public')).toContain('vault')
    for (const r of all) {
      for (const [role, ctx] of [['anon', ANON], ['authenticated', AUTHENTICATED]] as const) {
        expect(await rejectedWith(db.query(ctx, `select * from ${qualified(r)} limit 1`)), `${role} ${r.schema}.${r.name}`).toBe(PERMISSION_DENIED)
      }
    }
  })

  it('refuses insert, update, delete and truncate on every table of the app too', async () => {
    const tables = (await relations()).filter((r) => r.schema === 'public')
    for (const t of tables) {
      const first = (await db.sudo.query<{ c: string }>(`select column_name as c from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position limit 1`, [t.name])).rows[0]!.c
      for (const ctx of [ANON, AUTHENTICATED]) {
        for (const w of WRITES) expect(await rejectedWith(db.query(ctx, w.replaceAll('{t}', qualified(t)).replaceAll('{c}', first))), `${ctx.role}: ${w} ${t.name}`).toBe(PERMISSION_DENIED)
      }
    }
  })

  it('holds no privilege on any table, view, sequence or column for anon or authenticated, in any schema the API could reach', async () => {
    const schemas = (await relations()).map((r) => r.schema).filter((s, i, a) => a.indexOf(s) === i)
    for (const role of ['anon', 'authenticated'] as const) {
      const surface = await exposedSurface(db, role, [...schemas, 'extensions', 'auth'])
      expect(names(surface.tables), role).toEqual([])
      expect(names(surface.sequences), role).toEqual([])
    }
    // nor a column grant: the check above counts a grant on a single column as a privilege on the table
    const { rows } = await db.sudo.query<{ n: number }>(`select count(*)::int as n from information_schema.column_privileges where grantee in ('anon', 'authenticated', 'PUBLIC') and table_schema = 'public'`)
    expect(rows[0]!.n).toBe(0)
  })

  it('has row level security on every table, and no policy for anon, authenticated or PUBLIC', async () => {
    const off = await db.sudo.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`)
    expect(off.rows).toEqual([])
    const pol = await db.sudo.query<{ tablename: string; roles: string[] }>(`select tablename, roles::text[] as roles from pg_policies where schemaname = 'public'`)
    expect(pol.rows.length).toBeGreaterThan(5)
    for (const p of pol.rows) expect(p.roles, p.tablename).toEqual(['hb_definer'])
  })

  it('would still show anon no row if a grant slipped through, since there is no policy for it (the second wall)', async () => {
    const tables = (await relations()).filter((r) => r.schema === 'public')
    const c = await db.owner.connect()
    try {
      await c.query('begin')
      for (const t of tables) await c.query(`grant select on ${qualified(t)} to anon, authenticated`)
      for (const role of ['anon', 'authenticated']) {
        await c.query(`set local role ${role}`)
        for (const t of tables) {
          const { rows } = await c.query<{ n: number }>(`select count(*)::int as n from ${qualified(t)}`)
          expect(rows[0]!.n, `${role} ${t.name}`).toBe(0)
        }
        await c.query('reset role')
      }
    } finally {
      await c.query('rollback').catch(() => undefined)
      c.release()
    }
  })
})

// ================================================================================ (2) functions

/** The RPCs of the API (ROADMAP M2.1, M2.3), with their argument lists as the catalog prints them. */
const RPCS: readonly string[] = [
  'public.delete_my_data(p_anon_id text, p_phrase text, p_save jsonb)',
  'public.finish(p_token text, p_flags jsonb)',
  'public.mirror_get(p_anon_id text, p_phrase text)',
  'public.mirror_put(p_token text, p_save jsonb, p_phrase text)',
  'public.next_item(p_token text, p_axes text[])',
  'public.report_problem(p_token text, p_kind text, p_item_id text, p_detail text)',
  'public.rescore(p_save jsonb)',
  'public.start_session(p_device jsonb, p_save jsonb)',
  'public.submit(p_token text, p_item_id text, p_response jsonb, p_rt_ms integer, p_confidence integer, p_client_flags jsonb, p_next boolean, p_axes text[])',
  'public.submit_survey(p_token text, p_age_band text, p_english_first boolean)',
  'public.verify_save(p_save jsonb)',
]

describe('(2) anon can EXECUTE only the whitelisted RPCs', () => {
  let db: TestDb
  beforeAll(async () => {
    db = await openTestDb()
  })
  afterAll(async () => {
    await db.close()
  })

  const withArgs = (f: { schema: string; name: string; args: string }): string => `${f.schema}.${f.name}(${f.args})`

  it('executes exactly the eleven RPCs of the API in public: the same for anon and authenticated, none for service_role', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      const surface = await exposedSurface(db, role)
      expect(surface.functions.map(withArgs), role).toEqual([...RPCS].sort())
      expect(surface.functions.every((f) => f.securityDefiner), `${role}: all SECURITY DEFINER`).toBe(true)
    }
    expect((await exposedSurface(db, 'service_role')).functions.map(withArgs)).toEqual([])
  })

  it('has no overloaded RPC (PostgREST would serve each signature under one name) and no extension member in public', async () => {
    const { rows } = await db.sudo.query<{ name: string; n: number }>(`select p.proname as name, count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' group by 1 having count(*) > 1`)
    expect(rows).toEqual([])
    const ext = await db.sudo.query(`select p.proname from pg_proc p join pg_depend d on d.objid = p.oid and d.deptype = 'e' join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`)
    expect(ext.rows).toEqual([])
  })

  it('lets PUBLIC execute nothing in public or hb: a function nobody listed is not callable by default', async () => {
    const { rows } = await db.sudo.query<{ f: string }>(
      `select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'hb') and coalesce(exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'), true) order by 1`,
    )
    expect(rows).toEqual([])
  })

  it('leaves every helper out of reach: no API role has USAGE on hb or vault, and none can execute a function in them', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const schema of ['hb', 'vault']) expect((await db.sudo.query(`select has_schema_privilege($1, $2, 'USAGE') as u`, [role, schema])).rows[0]!.u, `${role} ${schema}`).toBe(false)
      const { rows } = await db.sudo.query<{ f: string }>(
        `select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('hb', 'vault') and has_function_privilege($1, p.oid, 'EXECUTE') and has_schema_privilege($1, n.oid, 'USAGE')`,
        [role],
      )
      expect(rows, role).toEqual([])
    }
    // and a call by name is refused, the ones that read the key included
    for (const ctx of [ANON, AUTHENTICATED, SERVICE_ROLE] as RequestContext[]) {
      for (const call of [`select hb.mac_sign('k2026a', 'x')`, `select hb.session_signed('s_x')`, `select hb.cfg('rate.sessions_per_day')`, `select vault.create_secret('x')`]) {
        expect(await rejectedWith(db.query(ctx, call)), `${ctx.role}: ${call}`).toBe(PERMISSION_DENIED)
      }
    }
  })

  it('makes every RPC SECURITY DEFINER, owned by the restricted role, with an empty search_path, so it runs with the table rights written for it and no others', async () => {
    const { rows } = await db.sudo.query<{ f: string; definer: boolean; owner: string; config: string[] | null }>(
      `select n.nspname || '.' || p.proname as f, p.prosecdef as definer, r.rolname as owner, p.proconfig as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles r on r.oid = p.proowner where n.nspname = 'public' order by 1`,
    )
    expect(rows.length).toBe(RPCS.length)
    for (const r of rows) expect(r, r.f).toMatchObject({ definer: true, owner: 'hb_definer', config: ['search_path=""'] })
    const role = await db.sudo.query(`select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin from pg_roles where rolname = 'hb_definer'`)
    expect(role.rows).toEqual([{ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolcanlogin: false }])
  })

  it('can be called by anon, every one of them (a granted function that errors for every caller would pass the checks above)', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    // the ones that need nothing but a token or a save
    await db.rpc(from(ip), 'verify_save', { p_save: emptySave(s.anon_id) })
    await db.rpc(from(ip), 'rescore', { p_save: emptySave(s.anon_id) })
    await db.rpc(from(ip), 'mirror_get', { p_anon_id: s.anon_id, p_phrase: 'a b c' })
    await db.rpc(from(ip), 'delete_my_data', { p_anon_id: s.anon_id, p_phrase: 'a b c' })
    await db.rpc(from(ip), 'report_problem', { p_token: s.token, p_kind: 'notes_requested' })
    await db.rpc(from(ip), 'submit_survey', { p_token: s.token, p_age_band: '18-24' })
    await db.rpc(from(ip), 'finish', { p_token: s.token })
    await db.rpc(from(ip), 'mirror_put', { p_token: s.token, p_save: emptySave(s.anon_id) })
    // next_item and submit need an item; with an empty bank they answer "done" and "not served", both from the function
    expect(await db.rpc(from(freshIp()), 'next_item', { p_token: (await startSession(db, freshIp())).token })).toMatchObject({ done: true })
    const t = await startSession(db, freshIp())
    await expect(db.rpc(from(freshIp()), 'submit', { p_token: t.token, p_item_id: 'i:tst:g1:00001', p_response: 0, p_rt_ms: 1000 })).rejects.toMatchObject({ code: 'PT404' })
  })
})

// ================================================================================ (3) no key

describe('(3) no response payload contains `key`: a fuzz over 1,000 items', () => {
  let db: TestDb
  const bank = new Map<string, FixtureItem>()
  const CANARY = 'CANARY'
  const NEUTRAL = ['w', 'h', 'rows', 'cols', 'shape', 'fill', 'cell', 'label', 'tilt', 'layer', 'grid', 'sides', 'tone', 'size', 'text', 'frame', 'seq']
  const WORDS = ['key', 'answer', 'correct', 'solution', 'which', 'figure', 'completes', 'pattern', 'rationale', 'tolerance', 'choose', 'the', 'best', 'option', 'weights', 'number', 'next', 'in', 'series']

  /** A random JSON value with neutral property names (the forbidden words appear only as text), up to `depth` deep. */
  function randomJson(rng: Rng, depth: number): unknown {
    const r = rng.int(0, depth <= 0 ? 3 : 6)
    if (r === 0) return rng.int(-9, 99)
    if (r === 1) return rng.next() < 0.5
    if (r === 2) return null
    if (r === 3) return Array.from({ length: rng.int(1, 4) }, () => rng.pick(WORDS)).join(' ')
    if (r === 4 || r === 5) return Array.from({ length: rng.int(0, 4) }, () => randomJson(rng, depth - 1))
    return Object.fromEntries(Array.from({ length: rng.int(0, 4) }, () => [rng.pick(NEUTRAL), randomJson(rng, depth - 1)]))
  }

  beforeAll(async () => {
    db = await openTestDb()
    await relaxSelection(db)
    const items = fixtureBank({ perAxis: 200, seed: 'accept-key' })
    expect(items.length).toBe(1000)
    for (const it of items) bank.set(it.itemId, it)
    await loadFixtureBank(db, items)
    // a random render payload for each item, and a canary in every column of the key table that is not the answer position itself
    const rng = createRng('payloads')
    const rows = items.map((it, i) => ({
      item_id: it.itemId,
      payload: {
        stem: Array.from({ length: rng.int(3, 12) }, () => rng.pick(WORDS)).join(' '),
        media: { renderer: 'test', facet: it.facet, extra: randomJson(rng, 3) },
        options: ['A', 'B', 'C', 'D', 'E'].slice(0, it.nOptions),
      },
      key: { ...it.key, canary: `${CANARY}-key-${i}` },
      tolerance: { abs: 0.01, canary: `${CANARY}-tol-${i}` },
      option_weights: null,
      rationale: { why: `${CANARY}-why-${i}`, steps: [`${CANARY}-step-${i}`] },
    }))
    for (let i = 0; i < rows.length; i += 250) {
      const chunk = JSON.stringify(rows.slice(i, i + 250))
      await db.owner.query(`update public.items i set payload = t.payload from jsonb_to_recordset($1::jsonb) as t (item_id text, payload jsonb) where i.item_id = t.item_id`, [chunk])
      await db.owner.query(
        `update public.item_keys k set key = t.key, tolerance = t.tolerance, rationale = t.rationale
           from jsonb_to_recordset($1::jsonb) as t (item_id text, key jsonb, tolerance jsonb, rationale jsonb) where k.item_id = t.item_id`,
        [chunk],
      )
    }
  })
  afterAll(async () => {
    await db.close()
  })

  /** The checks every reply must pass. */
  function expectClean(reply: unknown, what: string): void {
    const text = JSON.stringify(reply)
    expect(text, `${what}: a canary`).not.toContain(CANARY)
    expect(keysIn(reply).filter((k) => KEYISH.test(k)), `${what}: a property named for a key, an answer or a score`).toEqual([])
  }

  it('shows 1,000 items to a client with their stem, media and options and nothing else: no property of any of them is named for a key', async () => {
    const { rows } = await db.sudo.query<{ v: { seq: number; item: Record<string, unknown> } }>(`select hb.item_view(item_id, 1) as v from public.items order by item_id`)
    expect(rows.length).toBe(1000)
    const allowed = new Set(['item_id', 'item_type', 'time_limit_s', 'stem', 'media', 'options'])
    let withExtra = 0
    for (const { v } of rows) {
      expectClean(v, String(v.item.item_id))
      expect(Object.keys(v).sort()).toEqual(['item', 'seq'])
      expect(Object.keys(v.item).filter((k) => !allowed.has(k))).toEqual([])
      if (JSON.stringify(v.item.media).includes('"extra":{')) withExtra++
    }
    expect(withExtra, 'the fuzz put nested objects into the media').toBeGreaterThan(50)
    // the view is built from a whitelist of the payload's three members; the functions that read the payload for anything else
    // (the time an item takes, the number of options) return numbers
    const { rows: src } = await db.sudo.query<{ prosrc: string }>(`select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'hb' and p.proname = 'item_view'`)
    expect(src[0]!.prosrc).toContain(`e.key in ('stem', 'media', 'options')`)
  })

  it('serves a whole bank of them through the API, answered right, wrong and with rubbish, and nothing in any reply is a key, a verdict or a canary', async () => {
    const rng = createRng('accept-flow')
    const RUBBISH: unknown[] = [null, 'x', { a: 1 }, [1, 2], -1, 99999, true, 'A', '', 1.5]
    const replies: unknown[] = []
    let served = 0
    const sessions: { s: Started; ip: string }[] = []
    for (let k = 0; k < 4; k++) {
      const ip = freshIp()
      const s = await startSession(db, ip)
      sessions.push({ s, ip })
      replies.push(s)
      let next = await db.rpc<Next>(from(ip), 'next_item', { p_token: s.token })
      replies.push(next)
      for (let i = 0; i < 100 && isServed(next); i++) {
        served++
        const it = bank.get(next.item.item_id)!
        const how = rng.int(0, 2)
        const response = how === 0 ? (it.key.index as number) : how === 1 ? ((it.key.index as number) + 1) % it.nOptions : rng.pick(RUBBISH)
        await ageExposures(db, s.session_id, 20)
        const out = await db.rpc<{ ack: boolean; seq: number; next?: Next }>(from(ip), 'submit', { p_token: s.token, p_item_id: next.item.item_id, p_response: response, p_rt_ms: 4000 })
        replies.push(out)
        next = out.next ?? { done: true, reason: 'no_next' }
      }
      const fin = await db.rpc<{ session: SessionObject; anon_id: string }>(from(ip), 'finish', { p_token: s.token })
      replies.push(fin)
      const save = emptySave(fin.anon_id, { sessions: [fin.session] })
      replies.push(await db.rpc(from(freshIp()), 'rescore', { p_save: save }))
      replies.push(await db.rpc(from(freshIp()), 'verify_save', { p_save: save }))
      replies.push(await db.rpc(from(ip), 'mirror_put', { p_token: s.token, p_save: save }))
    }
    expect(served).toBe(400)
    for (const [i, r] of replies.entries()) expectClean(r, `reply ${i}`)
    // the answer positions of 400 served items do not show up as a verdict anywhere: the finished sessions hold the answers given, and `correct` is null
    for (const r of replies) {
      const text = JSON.stringify(r)
      if (text.includes('"responses"')) for (const t of (r as { session: { responses: unknown[][] } }).session.responses) expect(t[3]).toBeNull()
    }
    // a reply that names a key is not what these replies would look like: the same walk finds the key in the table
    expect(keysIn((await db.owner.query(`select to_jsonb(k) as k from public.item_keys k limit 1`)).rows[0]).some((k) => KEYISH.test(k))).toBe(true)
  })

  it('has a payload column that cannot hold a key field at any depth, for any spelling: 1,000 random payloads, half of them with one planted', async () => {
    const rng = createRng('payload-fuzz')
    const family = (await db.owner.query<{ family_id: string }>(`select family_id from public.item_families limit 1`)).rows[0]!.family_id
    const FORBIDDEN = ['key', 'keys', 'ans', 'answer', 'answers', 'correct', 'solution', 'solutions', 'tolerance', 'option_weights', 'rationale']
    const spell = (w: string): string => (rng.next() < 0.5 ? w : w.split('').map((c) => (rng.next() < 0.5 ? c.toUpperCase() : c)).join(''))
    /** Puts `name` as a property of a random object inside `value`, or wraps `value` if it holds none. */
    function plant(value: Record<string, any>, name: string): void {
      const objects: Record<string, any>[] = []
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) v.forEach(walk)
        else if (v !== null && typeof v === 'object') {
          objects.push(v as Record<string, any>)
          Object.values(v).forEach(walk)
        }
      }
      walk(value)
      rng.pick(objects)[name] = rng.int(0, 3)
    }
    let planted = 0
    let accepted = 0
    for (let i = 0; i < 1000; i++) {
      const payload: Record<string, any> = { stem: Array.from({ length: 5 }, () => rng.pick(WORDS)).join(' '), media: { renderer: 'test', extra: randomJson(rng, 4) }, options: ['A', 'B'] }
      const plantIt = i % 2 === 0
      if (plantIt) {
        plant(payload.media as Record<string, any>, spell(rng.pick(FORBIDDEN)))
        planted++
      }
      const insert = db.owner.query(
        `insert into public.items (item_id, family_id, item_type, payload, status, verification, provenance) values ($1, $2, 'mc', $3::jsonb, 'draft', '{}', '{}')`,
        [`i:tst:fz${i % 7}:${String(i).padStart(5, '0')}`, family, JSON.stringify(payload)],
      )
      if (plantIt) expect(pgCode(await insert.catch((e: unknown) => e)), JSON.stringify(payload)).toBe('23514')
      else {
        await insert
        accepted++
      }
    }
    expect([planted, accepted]).toEqual([500, 500])
  })
})

// ================================================================================ (4) tampering

describe('(4) a tampered save is unverified', () => {
  let db: TestDb
  const bank = new Map<string, FixtureItem>()
  beforeAll(async () => {
    db = await openTestDb()
    await relaxSelection(db)
    const items = fixtureBank({ perAxis: 12, seed: 'accept-tamper' })
    for (const it of items) bank.set(it.itemId, it)
    await loadFixtureBank(db, items)
  })
  afterAll(async () => {
    await db.close()
  })

  interface Verdict {
    sessions: { status: string; reason: string | null }[]
  }
  const verdict = (save: unknown): Promise<Verdict> => db.rpc<Verdict>(from(freshIp()), 'verify_save', { p_save: save })

  it('marks a hand-edited save "unverified" and the file the server issued "verified"; the edit is any change to the session, wherever it falls', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    await playSession(db, s, bank, { ip, n: 10, decide: (_it, seq) => seq % 3 !== 0 })
    const fin = await db.rpc<{ session: SessionObject; anon_id: string }>(from(ip), 'finish', { p_token: s.token })
    const save = emptySave(fin.anon_id, { sessions: [fin.session] })
    expect((await verdict(save)).sessions).toEqual([{ session_id: fin.session.session_id, status: 'verified', reason: null }])

    const edits: [string, (s: SessionObject) => void][] = [
      ['an answer', (x) => (x.responses[2][2] = 3 - x.responses[2][2])],
      ['a response time', (x) => (x.responses[4][4] += 1)],
      ['an item id', (x) => (x.responses[1][0] = x.responses[3][0])],
      ['a dropped response', (x) => x.responses.splice(5, 1)],
      ['the order of the responses', (x) => x.responses.reverse()],
      ['the duration', (x) => (x.duration_s += 1)],
      ['the start time', (x) => (x.started_utc = '2026-01-01T00:00:00Z')],
      ['the device', (x) => (x.device.class = 'phone')],
      ['a flag', (x) => (x.flags.paste_events = 5)],
      ['a flag added', (x) => (x.flags.extra = 1)],
      ['the session id', (x) => (x.session_id = 's_someoneelse0001')],
      ['the signature', (x) => (x.sig.mac = x.sig.mac.replace(/^./, (c: string) => (c === 'a' ? 'b' : 'a')))],
      ['the anon_id the signature names', (x) => (x.sig.anon_id = 'hb_AAAAAAAAAAAAAAAA')],
      ['the key id', (x) => (x.sig.kid = 'k1999z')],
    ]
    const edited = edits.map(([, edit]) => {
      const x = clone(fin.session)
      edit(x)
      return x
    })
    const got = await verdict(emptySave(fin.anon_id, { sessions: edited }))
    expect(got.sessions.map((x) => x.status)).toEqual(edits.map(() => 'unverified'))
    expect(got.sessions.map((x) => x.reason)).toEqual(edits.map(([what]) => (what === 'the key id' ? 'unknown_key' : 'bad_signature')))

    // the file around the session is not covered: an edit there is not an edit of the session
    expect((await verdict({ ...save, seen_items: ['i:tst:g1:00001'], created_utc: '2030-01-01T00:00:00Z' })).sessions[0]!.status).toBe('verified')
  })

  it('counts nothing of a tampered save: no score, no deletion, no continued anon_id', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    await playSession(db, s, bank, { ip, n: 12, decide: () => true })
    const fin = await db.rpc<{ session: SessionObject; anon_id: string }>(from(ip), 'finish', { p_token: s.token })
    const tampered = emptySave(fin.anon_id, { sessions: [{ ...clone(fin.session), duration_s: 1 }] })
    const r = await db.rpc<{ eap: object; skipped: Record<string, number> }>(from(freshIp()), 'rescore', { p_save: tampered })
    expect(r.eap).toEqual({})
    expect(r.skipped.unknown_sessions).toBe(1)
    expect(await db.rpc(from(freshIp()), 'delete_my_data', { p_anon_id: fin.anon_id, p_save: tampered })).toEqual({ deleted: false })
    expect((await startSession(db, freshIp(), tampered)).anon_id_adopted).toBe(false)
    const proper = emptySave(fin.anon_id, { sessions: [await signedSession(db, s.session_id)] })
    expect((await startSession(db, freshIp(), proper)).anon_id_adopted).toBe(true)
  })

  it('treats a file from the offline MVP (no signatures at all) as unverified, for display only', async () => {
    const offline = emptySave('hb_7Q3m9Kx2Vw5rT8pL', {
      sessions: [{ session_id: 's_offline00000001', started_utc: '2026-09-01T10:00:00Z', duration_s: 600, device: DEVICE, flags: {}, responses: [['i:tst:g1:00001', 0, 1, 1, 4000, null]] }],
    })
    const got = await verdict(offline)
    expect(got.sessions).toEqual([{ session_id: 's_offline00000001', status: 'unverified', reason: 'unsigned' }])
  })
})

// ================================================================================ (5) rate limits

describe('(5) rate limits', () => {
  let db: TestDb
  const bank = new Map<string, FixtureItem>()
  beforeAll(async () => {
    db = await openTestDb()
    await relaxSelection(db)
    const items = fixtureBank({ perAxis: 50, seed: 'accept-rate' })
    for (const it of items) bank.set(it.itemId, it)
    await loadFixtureBank(db, items)
  })
  afterAll(async () => {
    await db.close()
  })

  const rpc = <T = unknown>(ip: string, fn: string, args: Record<string, unknown> = {}): Promise<T> => db.rpc<T>(from(ip), fn, args)

  it('allows 5 sessions a day per client address and answers the 6th with 429, while another address is not affected', async () => {
    const ip = freshIp()
    for (let i = 0; i < 5; i++) await startSession(db, ip)
    const err = await startSession(db, ip).catch((e: unknown) => e)
    expect(pgCode(err)).toBe('PT429')
    expect((err as Error).message).toBe('rate_limited')
    await expect(startSession(db, freshIp())).resolves.toBeDefined()
  })

  it('counts by a hash of the address and the day\'s salt: no address is stored anywhere, the hash changes with the day, and the counts are purged after 48 hours', async () => {
    const ip = '203.0.113.201'
    await startSession(db, ip)
    const text = (await db.sudo.query<{ t: string }>(
      `select string_agg(x.j, ' ') as t from (
         select to_jsonb(r)::text as j from public.rate_limits r union all select to_jsonb(r)::text from public.rate_salts r
         union all select to_jsonb(r)::text from public.sessions r union all select to_jsonb(r)::text from public.mirror r
         union all select to_jsonb(r)::text from public.flags r union all select to_jsonb(r)::text from public.survey r) x`,
    )).rows[0]!.t
    expect(text).not.toContain(ip)
    expect(text).not.toContain('203.0.113')
    const day1 = (await db.owner.query<{ key_hash: string }>(`select key_hash from public.rate_limits where kind = 'start_session'`)).rows.map((r) => r.key_hash)
    expect(day1.every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true)
    // the next day the same address is a different hash, with a count of its own: it is not 6 against yesterday's 5
    await db.owner.query(`update public.rate_limits set day = day - 1`)
    await db.owner.query(`update public.rate_salts set day = day - 1`)
    await startSession(db, ip)
    const day2 = (await db.owner.query<{ key_hash: string; day: string; n: number }>(`select key_hash, day::text, n from public.rate_limits where kind = 'start_session' and day = (now() at time zone 'utc')::date`)).rows
    expect(day2.length).toBe(1)
    expect(day2[0]!.n).toBe(1)
    expect(day1).not.toContain(day2[0]!.key_hash)
    // after 48 hours both the counts and the salts are gone, so yesterday's hash cannot be recomputed
    await db.owner.query(`update public.rate_limits set day = day - 3`)
    await db.owner.query(`update public.rate_salts set day = day - 3`)
    await startSession(db, freshIp())
    expect((await db.owner.query(`select count(*)::int as n from public.rate_limits where day < (now() at time zone 'utc')::date - 1`)).rows[0].n).toBe(0)
    expect((await db.owner.query(`select count(*)::int as n from public.rate_salts where day < (now() at time zone 'utc')::date - 1`)).rows[0].n).toBe(0)
  })

  it('ends a session at 200 items: the 201st is not served, and cannot be answered', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    expect(s.limits.max_items).toBe(200)
    const { answered } = await playSession(db, s, bank, { ip, n: 200, decide: () => true })
    expect(answered.length).toBe(200)
    expect(await rpc(ip, 'next_item', { p_token: s.token })).toEqual({ done: true, reason: 'item_limit' })
    const err = await rpc(ip, 'submit', { p_token: s.token, p_item_id: [...bank.keys()].find((id) => !answered.some((a) => a.itemId === id))!, p_response: 0, p_rt_ms: 3000 }).catch((e: unknown) => e)
    expect(pgCode(err)).toBe('PT404')
    expect((await db.owner.query<{ n: number }>(`select n_served::int as n from public.sessions where session_id = $1`, [s.session_id])).rows[0]!.n).toBe(200)
  }, 180_000)

  it('blocks a session that averages under 2 s an item, by the server\'s clock and after 10 answers, and not a slower one', async () => {
    const ip = freshIp()
    const s = await startSession(db, ip)
    let next = await rpc<Next>(ip, 'next_item', { p_token: s.token })
    let answered = 0
    let blocked: unknown
    for (let i = 0; i < 14 && isServed(next); i++) {
      try {
        // the client says a minute; the server's clock says milliseconds
        const out = await rpc<{ next: Next }>(ip, 'submit', { p_token: s.token, p_item_id: next.item.item_id, p_response: 0, p_rt_ms: 60_000 })
        answered++
        next = out.next
      } catch (e) {
        blocked = e
        break
      }
    }
    expect(pgCode(blocked)).toBe('PT429')
    expect((blocked as Error).message).toBe('too_fast')
    expect(answered).toBe(9)
    // a person at 3 s an item (the exposures are aged by 3 s before each answer) is never stopped, 30 items in a row
    const ip2 = freshIp()
    const s2 = await startSession(db, ip2)
    let n2 = await rpc<Next>(ip2, 'next_item', { p_token: s2.token })
    let answered2 = 0
    for (let i = 0; i < 30 && isServed(n2); i++) {
      await ageExposures(db, s2.session_id, 3)
      const out = await rpc<{ next: Next }>(ip2, 'submit', { p_token: s2.token, p_item_id: n2.item.item_id, p_response: 0, p_rt_ms: 3000 })
      answered2++
      n2 = out.next
    }
    expect(answered2).toBe(30)
  })
})

// ================================================================================ (6) brief_prefs

describe('(6) the notes settings never reach the server (AI.26)', () => {
  let db: TestDb
  beforeAll(async () => {
    db = await openTestDb()
    await relaxSelection(db)
    await loadFixtureBank(db, fixtureBank({ perAxis: 6, seed: 'accept-prefs' }))
  })
  afterAll(async () => {
    await db.close()
  })

  const NAMES = ['brief_prefs', 'Brief_Prefs', 'BRIEF_PREFS', 'bRiEf_PrEfS']
  const VOCAB = ['alpha', 'beta', 'gamma', 'rows', 'seen', 'note', 'prefs', 'brief', 'zones', 'level', 'fit_log', 'topic', 'mu', 'x', 'y']
  const TEXT = ['', 'a', 'brief', 'prefs', 'brief prefs', 'brief-prefs', 'Notes for your AI', 'ö€😀', '\n', '"', '\\']

  function randomJson(rng: Rng, depth: number): unknown {
    const r = rng.int(0, depth <= 0 ? 4 : 7)
    if (r === 0) return rng.int(-1000, 1000)
    if (r === 1) return Math.round(rng.next() * 1e6) / 1e3
    if (r === 2) return rng.next() < 0.5
    if (r === 3) return null
    if (r === 4) return rng.pick(TEXT)
    if (r === 5 || r === 6) return Array.from({ length: rng.int(0, 4) }, () => randomJson(rng, depth - 1))
    return Object.fromEntries(Array.from({ length: rng.int(0, 4) }, () => [rng.pick(VOCAB), randomJson(rng, depth - 1)]))
  }

  /** A random save for an anon_id: sessions of the right shape with random answers and extras, seen lists, a posterior cache, random extra fields. */
  function randomSave(rng: Rng, anonId: string, serial: number): Record<string, unknown> {
    const sessions = Array.from({ length: rng.int(0, 3) }, (_, i) => {
      const sess: Record<string, unknown> = {
        session_id: `s_fz${String(serial).padStart(5, '0')}${i}x`,
        started_utc: '2026-09-01T10:00:00Z',
        duration_s: rng.int(1, 4000),
        device: clone(DEVICE),
        flags: rng.next() < 0.5 ? {} : { visibility_hidden_s: rng.int(0, 9) },
        responses: Array.from({ length: rng.int(0, 5) }, () => [`i:tst:g1:${String(rng.int(1, 30)).padStart(5, '0')}`, 0, randomJson(rng, 2), null, rng.int(200, 9000), null]),
      }
      if (rng.next() < 0.3) sess.sig = { alg: 'HMAC-SHA256', kid: 'k2026a', mac: 'A'.repeat(43), anon_id: anonId }
      if (rng.next() < 0.3) sess.extra = randomJson(rng, 3)
      return sess
    })
    return emptySave(anonId, {
      sessions,
      seen_items: Array.from({ length: rng.int(0, 5) }, () => `i:tst:g1:${String(rng.int(1, 30)).padStart(5, '0')}`),
      seen_families: [],
      posterior_cache: rng.next() < 0.5 ? { param_version: 'p0', axes: ['MAT'], mean: [rng.next()], cov_lower: [1] } : undefined,
      extra: randomJson(rng, 4),
    })
  }

  /** Puts `name` as a property of a random object of the save: its top level, a session, a device, a response element, a nested extra. */
  function plant(rng: Rng, save: Record<string, any>, name: string): void {
    const objects: Record<string, any>[] = []
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v !== null && typeof v === 'object') {
        objects.push(v as Record<string, any>)
        Object.values(v).forEach(walk)
      }
    }
    walk(save)
    rng.pick(objects)[name] = { notes_as_of: '2026-10', fit_log: [] }
  }

  it('finds no `brief_prefs` key in any reply or any stored row after 1,000 random saves, half of them carrying the key, through every RPC that takes a save', async () => {
    const rng = createRng('prefs-fuzz')
    const replies: unknown[] = []
    let rejected = 0
    let accepted = 0
    const CALLS = ['verify_save', 'rescore', 'delete_my_data', 'mirror_put', 'start_session'] as const

    async function one(serial: number): Promise<void> {
      const ipA = freshIp()
      const s = await startSession(db, ipA)
      const base = randomSave(rng, s.anon_id, serial)
      const planted = serial % 2 === 0
      const save = planted ? clone(base) : base
      if (planted) plant(rng, save, rng.pick(NAMES))
      for (const fn of CALLS) {
        const ip = freshIp()
        const args: Record<string, unknown> =
          fn === 'verify_save' || fn === 'rescore' ? { p_save: save }
          : fn === 'delete_my_data' ? { p_anon_id: s.anon_id, p_save: save }
          : fn === 'mirror_put' ? { p_token: s.token, p_save: save }
          : { p_device: DEVICE, p_save: save }
        const outcome = await db.rpc(from(ip), fn, args).then(
          (r) => ({ ok: true as const, r }),
          (e: unknown) => ({ ok: false as const, e }),
        )
        if (planted) {
          expect(outcome.ok, `${fn} took a save with the key: ${JSON.stringify(save).slice(0, 300)}`).toBe(false)
          if (!outcome.ok) {
            expect(pgCode(outcome.e), fn).toBe('PT400')
            expect((outcome.e as Error).message, fn).toBe('brief_prefs_not_accepted')
          }
          rejected++
        } else {
          if (!outcome.ok) throw new Error(`${fn} refused a clean save: ${(outcome.e as Error).message}: ${JSON.stringify(save).slice(0, 300)}`)
          replies.push(outcome.r)
          accepted++
        }
      }
    }
    // eight at a time, as a busy site would send them
    const total = 1000
    for (let from0 = 0; from0 < total; from0 += 8) await Promise.all(Array.from({ length: Math.min(8, total - from0) }, (_, k) => one(from0 + k)))
    expect(rejected).toBe(500 * CALLS.length)
    expect(accepted).toBe(500 * CALLS.length)

    // no reply holds the key...
    for (const r of replies) expect(keysIn(r).filter((k) => /^brief_prefs$/i.test(k))).toEqual([])
    // ...and no row anywhere does: the mirror's blobs included
    const tables = (await db.sudo.query<{ relname: string }>(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`)).rows
    for (const t of tables) {
      // as a key at any depth, and as text anywhere (the random strings never hold the word, so a hit is the key)
      const { rows } = await db.sudo.query<{ keyed: number; texted: number }>(
        `select count(*) filter (where hb.json_has_key(to_jsonb(x), '^brief_prefs$'))::int as keyed, count(*) filter (where strpos(lower(to_jsonb(x)::text), 'brief_prefs') > 0)::int as texted from public.${t.relname} x`,
      )
      expect(rows[0], t.relname).toEqual({ keyed: 0, texted: 0 })
    }
    const mirror = await db.sudo.query<{ n: number }>(`select count(*)::int as n from public.mirror`)
    expect(mirror.rows[0]!.n, 'every clean save was mirrored, and no other').toBe(500)
  }, 600_000)

  it('rejects a crafted payload with the key in any form JSON allows: escaped, nested deep, inside an array, in a session, a device, a flag, a response', async () => {
    const s = await startSession(db, freshIp())
    const deep = (n: number, leaf: unknown): unknown => (n === 0 ? leaf : [{ x: deep(n - 1, leaf) }])
    const crafted: [string, unknown][] = [
      ['at the top', { ...emptySave(s.anon_id), brief_prefs: {} }],
      ['written with a unicode escape', JSON.parse(`{"schema_version":"1.0.0","anon_id":"${s.anon_id}","sessions":[],"\\u0062rief_prefs":{}}`)],
      ['written in capitals', { ...emptySave(s.anon_id), BRIEF_PREFS: 1 }],
      ['null-valued', { ...emptySave(s.anon_id), brief_prefs: null }],
      ['nested 20 levels deep', emptySave(s.anon_id, { extra: deep(20, { brief_prefs: 1 }) })],
      ['inside an array of arrays', emptySave(s.anon_id, { extra: [[[{ brief_prefs: [] }]]] })],
      ['in a session', emptySave(s.anon_id, { sessions: [{ session_id: 's_abcdefgh', brief_prefs: {} }] })],
      ['in a session device', emptySave(s.anon_id, { sessions: [{ session_id: 's_abcdefgh', device: { ...DEVICE, brief_prefs: 1 } }] })],
      ['in a response element', emptySave(s.anon_id, { sessions: [{ session_id: 's_abcdefgh', responses: [['i:tst:g1:00001', 0, { brief_prefs: 1 }, null, 1, null]] }] })],
      ['in the seen lists\' container', emptySave(s.anon_id, { seen_items: [], posterior_cache: { brief_prefs: 1 } })],
    ]
    for (const [what, payload] of crafted) {
      for (const fn of ['verify_save', 'rescore'] as const) {
        const e = await db.rpc(from(freshIp()), fn, { p_save: payload }).catch((x: unknown) => x)
        expect([pgCode(e), (e as Error).message], `${fn} ${what}`).toEqual(['PT400', 'brief_prefs_not_accepted'])
      }
      const d = await db.rpc(from(freshIp()), 'delete_my_data', { p_anon_id: s.anon_id, p_save: payload }).catch((x: unknown) => x)
      expect([pgCode(d), (d as Error).message], `delete_my_data ${what}`).toEqual(['PT400', 'brief_prefs_not_accepted'])
      const m = await db.rpc(from(freshIp()), 'mirror_put', { p_token: s.token, p_save: payload }).catch((x: unknown) => x)
      expect([pgCode(m), (m as Error).message], `mirror_put ${what}`).toEqual(['PT400', 'brief_prefs_not_accepted'])
      const st = await db.rpc(from(freshIp()), 'start_session', { p_device: DEVICE, p_save: payload }).catch((x: unknown) => x)
      expect([pgCode(st), (st as Error).message], `start_session ${what}`).toEqual(['PT400', 'brief_prefs_not_accepted'])
    }
    // the other bodies: a device, an answer, a flag report
    const dev = await db.rpc(from(freshIp()), 'start_session', { p_device: { ...DEVICE, brief_prefs: 1 } }).catch((x: unknown) => x)
    expect([pgCode(dev), (dev as Error).message]).toEqual(['PT400', 'brief_prefs_not_accepted'])
    const sub = await db.rpc(from(freshIp()), 'submit', { p_token: s.token, p_item_id: 'i:tst:g1:00001', p_response: { brief_prefs: 1 }, p_rt_ms: 1000 }).catch((x: unknown) => x)
    expect([pgCode(sub), (sub as Error).message]).toEqual(['PT400', 'brief_prefs_not_accepted'])
    const fin = await db.rpc(from(freshIp()), 'finish', { p_token: s.token, p_flags: { brief_prefs: 1 } }).catch((x: unknown) => x)
    expect([pgCode(fin), (fin as Error).message]).toEqual(['PT400', 'brief_prefs_not_accepted'])
    // none of it left a row behind
    expect((await db.sudo.query<{ n: number }>(`select count(*)::int as n from public.mirror where strpos(lower(blob::text), 'brief_prefs') > 0 or hb.json_has_key(blob, '^brief_prefs$')`)).rows[0]!.n).toBe(0)
  })
})
