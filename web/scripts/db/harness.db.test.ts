/**
 * The harness itself (ROADMAP M2.0): request() and rpc() behave like PostgREST (one transaction,
 * SET LOCAL ROLE, request.* settings, role settings, SQLSTATE errors), test databases are
 * isolated clones of a template that is built once, and a migration that fails is reported by file
 * and line. Needs the `db` vitest project: `npm run test:db`.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import { ANON, AUTHENTICATED, FAKE_USER_ID, SERVICE_ROLE, createTestDb, ensureTemplate, templateNameOf, type TestDb } from './harness'
import { exposedSurface, names } from './surface'
import { PERMISSION_DENIED, QUERY_CANCELED, UNDEFINED_TABLE, openTestDb, rejectedWith } from './vitest'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))

describe('request()', () => {
  let db: TestDb
  beforeAll(async () => {
    db = await openTestDb({ migrationsDir: `${FIXTURES}migrations-locked` })
  })
  afterAll(async () => {
    await db.close()
  })

  it('runs as authenticator and switches to the API role, with PostgREST\'s request settings', async () => {
    const who = await db.rpc<Record<string, unknown>>(
      { role: 'anon', headers: { 'x-forwarded-for': '203.0.113.7' }, method: 'POST', path: '/rpc/whoami' },
      'whoami',
    )
    expect(who).toMatchObject({
      current_user: 'anon',
      session_user: 'authenticator',
      auth_role: 'anon',
      auth_uid: null,
      claims: { role: 'anon' },
      headers: { 'x-forwarded-for': '203.0.113.7' },
      method: 'POST',
    })
  })

  it('gives authenticated a user id and lets a test set any claims', async () => {
    const user = await db.rpc<Record<string, unknown>>(AUTHENTICATED, 'whoami')
    expect(user).toMatchObject({ current_user: 'authenticated', auth_uid: FAKE_USER_ID, claims: { role: 'authenticated', sub: FAKE_USER_ID } })
    const custom = await db.rpc<Record<string, unknown>>({ role: 'authenticated', claims: { sub: '5f0e8a2c-1111-4222-8333-444455556666', aal: 'aal1' } }, 'whoami')
    expect(custom).toMatchObject({ auth_uid: '5f0e8a2c-1111-4222-8333-444455556666', claims: { aal: 'aal1' } })
    const service = await db.rpc<Record<string, unknown>>(SERVICE_ROLE, 'whoami')
    expect(service).toMatchObject({ current_user: 'service_role', auth_role: 'service_role' })
  })

  it('applies the role settings (statement_timeout, search_path) like PostgREST does per request', async () => {
    const anon = await db.rpc<{ statement_timeout: string; search_path: string }>(ANON, 'whoami')
    const authenticated = await db.rpc<{ statement_timeout: string }>(AUTHENTICATED, 'whoami')
    expect(anon.statement_timeout).toBe('3s')
    expect(authenticated.statement_timeout).toBe('8s')
    expect(anon.search_path).toBe('"$user", public, extensions')
  })

  it('cancels a request that outlasts the role\'s statement_timeout (a 6 s RPC as anon stops at 3 s)', async () => {
    const started = performance.now()
    expect(await rejectedWith(db.rpc(ANON, 'sleepy'))).toBe(QUERY_CANCELED)
    const seconds = (performance.now() - started) / 1000
    expect(seconds).toBeGreaterThan(2.5)
    expect(seconds).toBeLessThan(5.5)
  })

  it('is one transaction: an error rolls everything back, a success commits', async () => {
    expect(await rejectedWith(db.rpc(ANON, 'write_then_fail'))).toBe('P0001')
    expect((await db.owner.query(`select count(*)::int as n from public.audit`)).rows[0]).toEqual({ n: 0 })
    await db.rpc(ANON, 'write_ok')
    expect((await db.owner.query(`select count(*)::int as n from public.audit`)).rows[0]).toEqual({ n: 1 })
    // `rollback: true` discards even a successful request (for probing without leaving data).
    await db.request(ANON, (c) => c.query(`select public.write_ok()`), { rollback: true })
    expect((await db.owner.query(`select count(*)::int as n from public.audit`)).rows[0]).toEqual({ n: 1 })
  })

  it('leaves no role or setting behind on a pooled connection', async () => {
    await db.request(ANON, (c) => c.query(`select 1`))
    // 12 requests through a pool of 8: every connection has been reused.
    const seen = await Promise.all(
      Array.from({ length: 12 }, () => db.request(SERVICE_ROLE, async (c) => (await c.query(`select current_user, current_setting('request.headers', true) as h`)).rows[0])),
    )
    for (const row of seen) expect(row).toEqual({ current_user: 'service_role', h: '{}' })
    const plain = await db.owner.query(`select current_setting('request.jwt.claims', true) as c`)
    expect(plain.rows[0]).toEqual({ c: null })
  })

  it('refuses a role that is not an API role', async () => {
    await expect(db.request({ role: 'postgres' as never }, async () => 1)).rejects.toThrow(/not an API role/)
  })
})

describe('rpc()', () => {
  let db: TestDb
  beforeAll(async () => {
    db = await openTestDb({ migrationsDir: `${FIXTURES}migrations-locked` })
  })
  afterAll(async () => {
    await db.close()
  })

  it('returns a scalar for a scalar function and uses SQL defaults for arguments left out', async () => {
    expect(await db.rpc(ANON, 'locked_count')).toBe(2)
    expect(await db.rpc(ANON, 'echo_args', { p_text: 'hi' })).toEqual({ text: 'hi', list: ['default'], doc: {} })
  })

  it('converts a JSON body to the parameter types, like PostgREST: text[], jsonb', async () => {
    const out = await db.rpc(ANON, 'echo_args', { p_text: 'hi', p_list: ['a', 'b,c', 'd"e'], p_doc: { n: [1, 2, { deep: true }], s: null } })
    expect(out).toEqual({ text: 'hi', list: ['a', 'b,c', 'd"e'], doc: { n: [1, 2, { deep: true }], s: null } })
  })

  it('returns an array of row objects for a table function, and null for void', async () => {
    expect(await db.rpc(ANON, 'squares', { n: 3 })).toEqual([
      { i: 1, sq: 1 },
      { i: 2, sq: 4 },
      { i: 3, sq: 9 },
    ])
    expect(await db.rpc(ANON, 'squares', { n: 0 })).toEqual([])
    expect(await db.rpc(ANON, 'do_nothing')).toBeNull()
  })

  it('rejects with the SQLSTATE when the role has no EXECUTE', async () => {
    expect(await rejectedWith(db.rpc(ANON, 'members_only'))).toBe(PERMISSION_DENIED)
    expect(await db.rpc(AUTHENTICATED, 'members_only')).toBe('members')
    expect(await rejectedWith(db.rpc(AUTHENTICATED, 'locked_count'))).toBe(PERMISSION_DENIED)
  })

  it('names the problem for a function or parameter that does not exist', async () => {
    await expect(db.rpc(ANON, 'no_such_function')).rejects.toThrow(/public\.no_such_function does not exist/)
    await expect(db.rpc(ANON, 'echo_args', { p_nope: 1 })).rejects.toThrow(/no parameter "p_nope" \(it has: p_text, p_list, p_doc\)/)
  })
})

describe('exposedSurface()', () => {
  let db: TestDb
  beforeAll(async () => {
    db = await openTestDb({ migrationsDir: `${FIXTURES}migrations-locked` })
  })
  afterAll(async () => {
    await db.close()
  })

  it('lists exactly the functions each API role may execute', async () => {
    const anon = names((await exposedSurface(db, 'anon')).functions)
    expect(anon).toContain('public.locked_count')
    expect(anon).not.toContain('public.members_only')
    const authenticated = names((await exposedSurface(db, 'authenticated')).functions)
    expect(authenticated).toContain('public.members_only')
    expect(authenticated).not.toContain('public.locked_count')
  })

  it('reports each function\'s SECURITY DEFINER flag and its argument list', async () => {
    const fns = (await exposedSurface(db, 'anon')).functions
    expect(fns.find((f) => f.name === 'locked_count')).toMatchObject({ schema: 'public', args: '', securityDefiner: true })
    expect(fns.find((f) => f.name === 'echo_args')).toMatchObject({ securityDefiner: false, args: 'p_text text, p_list text[], p_doc jsonb' })
  })

  it('looks at other schemas on request, and sees none of the Vault for an API role', async () => {
    const vault = await exposedSurface(db, 'anon', ['vault'])
    expect(vault).toEqual({ tables: [], sequences: [], functions: [] })
    const postgresOnly = await exposedSurface(db, 'service_role', ['vault'])
    expect(postgresOnly.tables).toEqual([])
  })
})

describe('test databases', () => {
  const cluster = (): ReturnType<typeof inject<'hbCluster'>> => inject('hbCluster')

  it('are isolated clones: a change in one is invisible in another, and close() drops the database', async () => {
    const a = await openTestDb({ migrationsDir: `${FIXTURES}migrations-locked` })
    const b = await openTestDb({ migrationsDir: `${FIXTURES}migrations-locked` })
    try {
      await a.owner.query(`create table public.only_in_a (id int)`)
      expect(await rejectedWith(b.owner.query(`select * from public.only_in_a`))).toBe(UNDEFINED_TABLE)
      expect((await a.sudo.query(`select 1 from pg_database where datname = $1`, [a.name])).rowCount).toBe(1)
    } finally {
      await a.close()
      await b.close()
    }
    const c = await openTestDb({ migrationsDir: `${FIXTURES}migrations-locked` })
    try {
      expect((await c.sudo.query(`select 1 from pg_database where datname in ($1, $2)`, [a.name, b.name])).rowCount).toBe(0)
      // The template was not changed by what a test did in its clone.
      expect(await rejectedWith(c.owner.query(`select * from public.only_in_a`))).toBe(UNDEFINED_TABLE)
    } finally {
      await c.close()
    }
  })

  it('build the template once per set of shim + migration files: same files, same template; any change, a new one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hb-migrations-'))
    try {
      writeFileSync(join(dir, '20260930000001_one.sql'), `create table public.one (id int);\n`)
      const first = await ensureTemplate(cluster(), { migrationsDir: dir })
      expect(first).toMatch(/^hb_t_[0-9a-f]{12}$/)
      expect(await ensureTemplate(cluster(), { migrationsDir: dir })).toBe(first)
      const locked = await ensureTemplate(cluster(), { migrationsDir: `${FIXTURES}migrations-locked` })
      expect(locked).not.toBe(first)
      // Editing a migration builds a new template, so a stale one is never reused.
      writeFileSync(join(dir, '20260930000001_one.sql'), `create table public.one (id int, extra text);\n`)
      const edited = await ensureTemplate(cluster(), { migrationsDir: dir })
      expect(edited).not.toBe(first)
      const db = await createTestDb(cluster(), { migrationsDir: dir })
      try {
        const cols = await db.owner.query(`select column_name from information_schema.columns where table_name = 'one' order by 1`)
        expect(cols.rows).toEqual([{ column_name: 'extra' }, { column_name: 'id' }])
      } finally {
        await db.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('can be opened by many test files at once, even while the template is still being built', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hb-migrations-'))
    try {
      writeFileSync(join(dir, '20260930000001_race.sql'), `create table public.raced (id int);\ninsert into public.raced values (1);\n`)
      const dbs = await Promise.all(Array.from({ length: 5 }, () => createTestDb(cluster(), { migrationsDir: dir })))
      try {
        for (const d of dbs) expect((await d.owner.query(`select count(*)::int as n from public.raced`)).rows[0]).toEqual({ n: 1 })
        expect(new Set(dbs.map((d) => d.name)).size).toBe(5)
      } finally {
        await Promise.all(dbs.map((d) => d.close()))
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('name the migration file and line when one fails, and leave no half-built template to be reused', async () => {
    const dir = `${FIXTURES}migrations-broken`
    const probe = await openTestDb()
    try {
      const run = (): Promise<TestDb> => openTestDb({ migrationsDir: dir })
      await expect(run()).rejects.toThrow(/migration 20260930000002_syntax_error\.sql \(line 4\) failed: syntax error at or near "tabel"/)
      // The same error again (not a leftover template from the first attempt).
      await expect(run()).rejects.toThrow(/20260930000002_syntax_error\.sql \(line 4\)/)
      const left = await probe.sudo.query(`select 1 from pg_database where datname = $1`, [templateNameOf(dir)])
      expect(left.rowCount).toBe(0)
    } finally {
      await probe.close()
    }
  })

  it('refuse a migration whose GRANT or REVOKE did nothing (Postgres only warns; the object would stay exposed)', async () => {
    await expect(openTestDb({ migrationsDir: `${FIXTURES}migrations-noop-grant` })).rejects.toThrow(
      /migration 20260930000001_noop_grant\.sql failed: Postgres did not apply a privilege change \(no privileges were granted for "auth"\)/,
    )
  })

  it('refuse a migrations directory with a file that is not a migration', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hb-migrations-'))
    try {
      writeFileSync(join(dir, 'notes.md'), '# not a migration\n')
      await expect(openTestDb({ migrationsDir: dir })).rejects.toThrow(/notes\.md: not a migration file name/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
