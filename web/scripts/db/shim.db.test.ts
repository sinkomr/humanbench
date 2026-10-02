/**
 * The Supabase shim and the engine under it (ROADMAP M2.0, A6): roles, extensions, the `auth`
 * helpers, the Vault shim, and the default grants that make a forgetful migration leak. Needs the
 * `db` vitest project: `npm run test:db`.
 */

import { execFileSync } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, inject } from 'vitest'
import { CLUSTER_DIR_PREFIX, PG_MAJOR, prepareBinaries } from './engine'
import { ANON, AUTHENTICATED, SERVICE_ROLE, type TestDb } from './harness'
import { semaphoreSetsOfInode } from './ipc'
import { quoteIdent } from './sql'
import { exposedSurface, names } from './surface'
import { PERMISSION_DENIED, QUERY_CANCELED, UNDEFINED_FUNCTION, openTestDb, rejectedWith } from './vitest'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const rand = (): string => randomBytes(4).toString('hex')

describe('the engine', () => {
  let db: TestDb
  beforeAll(async () => {
    db = await openTestDb()
  })
  afterAll(async () => {
    await db.close()
  })

  it(`is PostgreSQL ${PG_MAJOR}, Supabase's default major`, async () => {
    const { rows } = await db.owner.query<{ v: number }>(`select current_setting('server_version_num')::int as v`)
    expect(Math.floor((rows[0]?.v ?? 0) / 10_000)).toBe(PG_MAJOR)
  })

  it('listens on loopback TCP only, with no Unix socket, in a temp directory', async () => {
    const info = inject('hbCluster')
    expect(info.host).toBe('127.0.0.1')
    expect(info.dir.startsWith(tmpdir())).toBe(true)
    expect(info.dir).toContain(CLUSTER_DIR_PREFIX)
    const { rows } = await db.sudo.query<{ s: string; v: string }>(
      `select name as s, setting as v from pg_settings where name in ('listen_addresses', 'unix_socket_directories') order by 1`,
    )
    expect(rows).toEqual([
      { s: 'listen_addresses', v: '127.0.0.1' },
      { s: 'unix_socket_directories', v: '' },
    ])
  })

  it('is tuned for throw-away data and is deterministic (UTC, C collation, UTF8)', async () => {
    const { rows } = await db.sudo.query<Record<string, string>>(
      `select current_setting('fsync') as fsync, current_setting('TimeZone') as tz,
              (select datcollate from pg_database where datname = current_database()) as collate,
              (select pg_encoding_to_char(encoding) from pg_database where datname = current_database()) as enc`,
    )
    expect(rows[0]).toEqual({ fsync: 'off', tz: 'UTC', collate: 'C', enc: 'UTF8' })
  })

  it('keeps its shared memory off the host: an anonymous mmap, and dynamic segments as files in the data directory', async () => {
    const { rows } = await db.sudo.query<{ name: string; setting: string }>(
      `select name, setting from pg_settings where name in ('shared_memory_type', 'dynamic_shared_memory_type') order by 1`,
    )
    expect(rows).toEqual([
      { name: 'dynamic_shared_memory_type', setting: 'mmap' },
      { name: 'shared_memory_type', setting: 'mmap' },
    ])
  })

  it.skipIf(platform() !== 'darwin')('on macOS runs the shimmed postgres, which holds no System V segment or semaphore set of the host (M2.0)', () => {
    expect(prepareBinaries().shm).toBe('shim')
    const pid = Number.parseInt(readFileSync(join(inject('hbCluster').dir, 'data', 'postmaster.pid'), 'utf8').split('\n')[0] ?? '', 10)
    expect(pid).toBeGreaterThan(1)
    expect(execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })).toContain('/bin/postgres.real ')
    // Segments of other programs may exist; none may have been created or last used by this postmaster.
    const lines = execFileSync('ipcs', ['-m', '-a'], { encoding: 'utf8' }).split('\n')
    const header = (lines.find((l) => /^T\s+ID\s/.test(l)) ?? '').trim().split(/\s+/)
    const [cpid, lpid] = [header.indexOf('CPID'), header.indexOf('LPID')]
    expect(cpid).toBeGreaterThan(0)
    expect(lpid).toBeGreaterThan(0)
    for (const row of lines.filter((l) => /^m\s/.test(l)).map((l) => l.trim().split(/\s+/))) {
      expect(row[cpid]).not.toBe(String(pid))
      expect(row[lpid]).not.toBe(String(pid))
    }
    // Nor a semaphore set: a postmaster's keys count up from the inode of its data directory
    // (sysv_sema.c). The macOS kernel never frees the sets of a killed postmaster, so none may exist.
    const inode = statSync(join(inject('hbCluster').dir, 'data')).ino
    expect(semaphoreSetsOfInode(inode)).toEqual([])
  })

  it('rejects a login with the wrong password (scram, a random password per run)', async () => {
    const { host, port } = inject('hbCluster')
    const client = new pg.Client({ host, port, user: 'postgres', password: 'not-the-password', database: db.name })
    client.on('error', () => undefined)
    await expect(client.connect()).rejects.toMatchObject({ code: '28P01' })
    await client.end().catch(() => undefined)
  })
})

describe('roles', () => {
  let db: TestDb
  beforeAll(async () => {
    db = await openTestDb()
  })
  afterAll(async () => {
    await db.close()
  })

  it('has the Supabase roles with the attributes PostgREST relies on', async () => {
    const { rows } = await db.sudo.query<Record<string, unknown>>(
      `select rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolbypassrls
         from pg_roles where rolname in ('anon', 'authenticated', 'service_role', 'authenticator', 'postgres', 'supabase_admin')
        order by rolname`,
    )
    const by = Object.fromEntries(rows.map((r) => [r.rolname as string, r]))
    expect(by.anon).toMatchObject({ rolsuper: false, rolinherit: false, rolcanlogin: false, rolbypassrls: false })
    expect(by.authenticated).toMatchObject({ rolsuper: false, rolinherit: false, rolcanlogin: false, rolbypassrls: false })
    expect(by.service_role).toMatchObject({ rolsuper: false, rolinherit: false, rolcanlogin: false, rolbypassrls: true })
    expect(by.authenticator).toMatchObject({ rolsuper: false, rolinherit: false, rolcanlogin: true, rolbypassrls: false })
    expect(by.postgres).toMatchObject({ rolsuper: false, rolcreaterole: true, rolcreatedb: true, rolcanlogin: true, rolbypassrls: true })
    expect(by.supabase_admin).toMatchObject({ rolsuper: true })
  })

  it('lets authenticator become each API role, and nothing else', async () => {
    const { rows } = await db.sudo.query<{ member: string; role: string }>(
      `select m.rolname as member, r.rolname as role
         from pg_auth_members am join pg_roles r on r.oid = am.roleid join pg_roles m on m.oid = am.member
        where m.rolname = 'authenticator' order by 2`,
    )
    expect(rows.map((r) => r.role)).toEqual(['anon', 'authenticated', 'service_role'])
  })

  it('makes `postgres` (the migration role) a non-superuser: what needs superuser fails as on Supabase', async () => {
    expect(await rejectedWith(db.owner.query(`create extension file_fdw`))).toBe(PERMISSION_DENIED)
    expect(await rejectedWith(db.owner.query(`copy (select 1) to program 'true'`))).toBe(PERMISSION_DENIED)
    expect(await rejectedWith(db.owner.query(`alter system set work_mem = '8MB'`))).toBe(PERMISSION_DENIED)
  })

  it('keeps PostgREST\'s login role from becoming the migration role or the superuser', async () => {
    for (const ctx of [ANON, AUTHENTICATED, SERVICE_ROLE]) {
      for (const role of ['postgres', 'supabase_admin']) {
        expect(await rejectedWith(db.request(ctx, (c) => c.query(`set local role ${role}`))), `${ctx.role} -> ${role}`).toBe(PERMISSION_DENIED)
      }
    }
  })

  it('lets SECURITY INVOKER code move to another API role with SET ROLE, but not SECURITY DEFINER code', async () => {
    // SET ROLE is checked against the session user, `authenticator`, which is a member of all three
    // API roles. So a function that runs SQL built from its arguments is NOT confined to the role
    // of the request: as anon it can become service_role (BYPASSRLS). SECURITY DEFINER code is not
    // allowed to SET ROLE at all. M2.1 must not build SQL from RPC arguments.
    const body = `begin set local role service_role; return current_user::text; end`
    await db.owner.query(`create function public.t_become_invoker() returns text language plpgsql set search_path = '' as $$ ${body} $$`)
    await db.owner.query(`create function public.t_become_definer() returns text language plpgsql security definer set search_path = '' as $$ ${body} $$`)
    // (granted by name: the M2.1 migrations take PUBLIC's EXECUTE away from new functions, so a test no longer relies on it)
    await db.owner.query(`grant execute on function public.t_become_invoker(), public.t_become_definer() to anon, authenticated`)
    for (const ctx of [ANON, AUTHENTICATED]) {
      expect(await db.rpc(ctx, 't_become_invoker'), `${ctx.role} invoker`).toBe('service_role')
      expect(await rejectedWith(db.rpc(ctx, 't_become_definer')), `${ctx.role} definer`).toBe(PERMISSION_DENIED)
    }
    const direct = await db.request(ANON, (c) => c.query<{ u: string }>(`set local role service_role`).then(() => c.query<{ u: string }>(`select current_user as u`)))
    expect(direct.rows).toEqual([{ u: 'service_role' }])
  })

  it('lets `postgres` create schemas and trusted extensions in a test database, as in the template its migrations ran in', async () => {
    // CREATE DATABASE ... TEMPLATE does not copy the database's privileges; the harness repeats the grant.
    expect((await db.owner.query<{ ok: boolean }>(`select has_database_privilege('postgres', current_database(), 'CREATE') as ok`)).rows[0]?.ok).toBe(true)
    await db.owner.query(`create schema t_scratch`)
    await db.owner.query(`create extension pg_trgm with schema extensions`)
    const { rows } = await db.owner.query<{ n: string }>(`select e.extnamespace::regnamespace::text as n from pg_extension e where e.extname = 'pg_trgm'`)
    expect(rows).toEqual([{ n: 'extensions' }])
  })

  it('does not let an API role create objects in `public`', async () => {
    expect(await rejectedWith(db.query(ANON, `create table public.planted (id int)`))).toBe(PERMISSION_DENIED)
    expect(await rejectedWith(db.query(AUTHENTICATED, `create function public.planted() returns int language sql as 'select 1'`))).toBe(PERMISSION_DENIED)
  })
})

describe('role settings', () => {
  let db: TestDb
  beforeAll(async () => {
    db = await openTestDb()
  })
  afterAll(async () => {
    await db.close()
  })

  const timeouts = async (): Promise<Record<string, string>> => {
    const { rows } = await db.sudo.query<{ role: string; setting: string }>(
      `select r.rolname as role, split_part(s, '=', 2) as setting
         from pg_db_role_setting d join pg_roles r on r.oid = d.setrole cross join lateral unnest(d.setconfig) s
        where d.setdatabase = 0 and s like 'statement\_timeout=%'`,
    )
    return Object.fromEntries(rows.map((r) => [r.role, r.setting]))
  }

  it('lets the migration role change the API roles\' timeouts, which Supabase documents as the way to raise them', async () => {
    expect(await timeouts()).toMatchObject({ anon: '3s', authenticated: '8s', authenticator: '8s' })
    // ALTER ROLE ... SET is cluster-wide and transactional: roll it back so no other test file sees it.
    const client = await db.owner.connect()
    try {
      await client.query('begin')
      for (const [role, value] of [['anon', '5s'], ['authenticated', '15s'], ['service_role', '30s'], ['authenticator', '20s']]) {
        await client.query(`alter role ${role} set statement_timeout = '${value}'`)
      }
      const inside = await client.query<{ role: string; setting: string }>(
        `select r.rolname as role, split_part(s, '=', 2) as setting
           from pg_db_role_setting d join pg_roles r on r.oid = d.setrole cross join lateral unnest(d.setconfig) s
          where d.setdatabase = 0 and s like 'statement\_timeout=%' order by 1`,
      )
      expect(Object.fromEntries(inside.rows.map((r) => [r.role, r.setting]))).toEqual({ anon: '5s', authenticated: '15s', authenticator: '20s', service_role: '30s' })
    } finally {
      await client.query('rollback').catch(() => undefined)
      client.release()
    }
    expect(await timeouts()).toMatchObject({ anon: '3s', authenticated: '8s', authenticator: '8s' })
  })

  it('applies a changed timeout to the next request of that role (the lever for a slow RPC, M2.2)', async () => {
    // `IN DATABASE` keeps the change to this test database: it is dropped with it.
    const alter = (value: string): Promise<unknown> => db.owner.query(`alter role anon in database ${quoteIdent(db.name)} set statement_timeout = '${value}'`)
    const sleep = (): Promise<unknown> => db.query(ANON, `select pg_sleep(0.6)`)
    await sleep() // the shim's 3 s allows it
    await alter('300ms')
    expect(await rejectedWith(sleep())).toBe(QUERY_CANCELED)
    await alter('5s')
    await sleep()
  })
})

describe('extensions and auth helpers', () => {
  let db: TestDb
  beforeAll(async () => {
    db = await openTestDb()
  })
  afterAll(async () => {
    await db.close()
  })

  it('has pgcrypto in the `extensions` schema, and its HMAC-SHA256 agrees with Node', async () => {
    const ext = await db.owner.query<{ nspname: string }>(
      `select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pgcrypto'`,
    )
    expect(ext.rows).toEqual([{ nspname: 'extensions' }])
    const key = 'fake-hmac-key-for-tests'
    const msg = '{"b":2,"a":1}'
    const { rows } = await db.owner.query<{ mac: string }>(`select encode(extensions.hmac($1::text, $2::text, 'sha256'), 'hex') as mac`, [msg, key])
    expect(rows[0]?.mac).toBe(createHmac('sha256', key).update(msg).digest('hex'))
    const bytes = await db.owner.query<{ n: number }>(`select length(extensions.gen_random_bytes(16)) as n`)
    expect(bytes.rows[0]?.n).toBe(16)
  })

  it('lets every API role call pgcrypto unqualified: `extensions` is on their search_path and they may use it', async () => {
    for (const ctx of [ANON, AUTHENTICATED, SERVICE_ROLE]) {
      const { rows } = await db.query(ctx, `select length(gen_random_bytes(4)) as n`)
      expect(rows, ctx.role).toEqual([{ n: 4 }])
    }
  })

  it('fails a function that calls pgcrypto unqualified under search_path = \'\' (it would on Supabase)', async () => {
    const code = await rejectedWith(
      db.owner.query(
        `create function public.bad_hmac() returns text language sql security definer set search_path = ''
         as $$ select encode(hmac('a', 'k', 'sha256'), 'hex') $$`,
      ),
    )
    expect(code).toBe(UNDEFINED_FUNCTION)
  })

  it('has auth.jwt(), uid(), role() and email() read the request claims', async () => {
    const anon = await db.query(ANON, `select auth.role() as role, auth.uid() as uid, auth.jwt() as jwt`)
    expect(anon.rows[0]).toEqual({ role: 'anon', uid: null, jwt: { role: 'anon' } })

    const sub = '5f0e8a2c-1111-4222-8333-444455556666'
    const user = await db.query(
      { role: 'authenticated', claims: { sub, email: 'someone@example.invalid' } },
      `select auth.role() as role, auth.uid() as uid, auth.email() as email`,
    )
    expect(user.rows[0]).toEqual({ role: 'authenticated', uid: sub, email: 'someone@example.invalid' })

    const service = await db.query(SERVICE_ROLE, `select auth.role() as role`)
    expect(service.rows[0]).toEqual({ role: 'service_role' })
  })

  it('has no request claims outside a request', async () => {
    const { rows } = await db.owner.query(`select auth.role() as role, auth.uid() as uid, auth.jwt() as jwt`)
    expect(rows[0]).toEqual({ role: null, uid: null, jwt: null })
  })
})

describe('Vault shim', () => {
  let db: TestDb
  const secretName = `hb_test_key_${rand()}`
  const secret = `fake-signing-key-${rand()}`
  const definer = `hb_t_definer_${rand()}`

  beforeAll(async () => {
    db = await openTestDb()
  })
  afterAll(async () => {
    await db.close()
    // Roles are cluster-wide: drop this file's so a later file in the run never sees it.
    const { host, port, password } = inject('hbCluster')
    const c = new pg.Client({ host, port, user: 'supabase_admin', password, database: 'postgres' })
    c.on('error', () => undefined)
    await c.connect()
    try {
      await c.query(`drop role if exists ${definer}`)
    } finally {
      await c.end()
    }
  })

  it('stores a secret encrypted and reads it back through decrypted_secrets, for postgres only', async () => {
    const created = await db.owner.query<{ id: string }>(`select vault.create_secret($1, $2, 'fake') as id`, [secret, secretName])
    expect(created.rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/)
    const read = await db.owner.query<{ secret: string; decrypted_secret: string; description: string }>(
      `select secret, decrypted_secret, description from vault.decrypted_secrets where name = $1`,
      [secretName],
    )
    expect(read.rows[0]?.decrypted_secret).toBe(secret)
    expect(read.rows[0]?.secret).not.toContain(secret)
    expect(read.rows[0]?.description).toBe('fake')

    // Rotation: update_secret replaces the value in place.
    await db.owner.query(`select vault.update_secret($1::uuid, 'fake-rotated-key')`, [created.rows[0]?.id])
    const rotated = await db.owner.query<{ decrypted_secret: string }>(`select decrypted_secret from vault.decrypted_secrets where name = $1`, [secretName])
    expect(rotated.rows[0]?.decrypted_secret).toBe('fake-rotated-key')
    await db.owner.query(`select vault.update_secret($1::uuid, $2)`, [created.rows[0]?.id, secret])
  })

  it('keeps the Vault out of reach of anon, authenticated and service_role', async () => {
    for (const ctx of [ANON, AUTHENTICATED, SERVICE_ROLE]) {
      expect(await rejectedWith(db.query(ctx, `select * from vault.decrypted_secrets`)), `${ctx.role} view`).toBe(PERMISSION_DENIED)
      expect(await rejectedWith(db.query(ctx, `select * from vault.secrets`)), `${ctx.role} table`).toBe(PERMISSION_DENIED)
      expect(await rejectedWith(db.query(ctx, `select vault.create_secret('fake')`)), `${ctx.role} create_secret`).toBe(PERMISSION_DENIED)
    }
  })

  it('supports the M2.3 pattern: a SECURITY DEFINER function owned by a restricted role signs with the Vault key', async () => {
    const fn = `public.t_sign_${rand()}`
    const sign = (): Promise<pg.QueryResult<{ mac: string }>> => db.query<{ mac: string }>(ANON, `select ${fn}('{"a":1}') as mac`)

    await db.owner.query(`create role ${definer} nologin`)
    // PostgreSQL 16+: creating a role gives the creator ADMIN OPTION but no membership, so the
    // migration role must grant itself the role before it can hand it a function.
    await db.owner.query(`grant ${definer} to postgres`)
    await db.owner.query(
      `create function ${fn}(msg text) returns text language sql security definer set search_path = ''
       as $$ select encode(extensions.hmac(msg, (select decrypted_secret from vault.decrypted_secrets where name = '${secretName}'), 'sha256'), 'hex') $$`,
    )
    // ALTER ... OWNER also needs CREATE on the schema for the new owner (not implied either).
    await db.owner.query(`grant create on schema public to ${definer}`)
    await db.owner.query(`alter function ${fn}(text) owner to ${definer}`)
    await db.owner.query(`revoke create on schema public from ${definer}`)
    await db.owner.query(`revoke execute on function ${fn}(text) from public, anon, authenticated`)
    await db.owner.query(`grant execute on function ${fn}(text) to anon`)

    // Each grant the owner needs is a separate one; none is implied.
    expect(await rejectedWith(sign())).toBe(PERMISSION_DENIED)
    await db.owner.query(`grant usage on schema extensions to ${definer}`)
    expect(await rejectedWith(sign())).toBe(PERMISSION_DENIED)
    await db.owner.query(`grant usage on schema vault to ${definer}`)
    expect(await rejectedWith(sign())).toBe(PERMISSION_DENIED)
    await db.owner.query(`grant select on vault.decrypted_secrets to ${definer}`)

    const { rows } = await sign()
    expect(rows[0]?.mac).toBe(createHmac('sha256', secret).update('{"a":1}').digest('hex'))
    // ...while anon still cannot read the key itself.
    expect(await rejectedWith(db.query(ANON, `select * from vault.decrypted_secrets`))).toBe(PERMISSION_DENIED)
  })
})

describe('default grants: a migration that forgets to lock down leaks, as on Supabase', () => {
  let leaky: TestDb
  let locked: TestDb
  beforeAll(async () => {
    ;[leaky, locked] = await Promise.all([openTestDb({ migrationsDir: `${FIXTURES}migrations-leaky` }), openTestDb({ migrationsDir: `${FIXTURES}migrations-locked` })])
  })
  afterAll(async () => {
    await Promise.all([leaky.close(), locked.close()])
  })

  it('lets anon read and write a table the migration did not revoke', async () => {
    const read = await leaky.query(ANON, `select note from public.leaky`)
    expect(read.rows).toEqual([{ note: 'fake row, visible to anon' }])
    await leaky.query(ANON, `insert into public.leaky values (2, 'planted by anon')`)
    const surface = await exposedSurface(leaky, 'anon')
    expect(names(surface.tables)).toEqual(['public.leaky'])
    expect(surface.tables[0]?.privileges).toEqual(['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger', 'maintain'])
    expect(surface.tables[0]?.rowSecurity).toBe(false)
  })

  it('lets anon call a function nobody revoked EXECUTE on (PUBLIC, plus the default grants)', async () => {
    const { rows } = await leaky.query(ANON, `select public.leaky_count() as n`)
    expect(rows[0]).toEqual({ n: expect.any(Number) })
    expect(names((await exposedSurface(leaky, 'anon')).functions)).toEqual(['public.leaky_count'])
  })

  it('shows RLS doing its job once enabled: no policy means no rows, not an error', async () => {
    await leaky.owner.query(`alter table public.leaky enable row level security`)
    const { rows } = await leaky.query(ANON, `select * from public.leaky`)
    expect(rows).toEqual([])
    // service_role and postgres bypass RLS.
    expect((await leaky.query(SERVICE_ROLE, `select * from public.leaky`)).rows.length).toBeGreaterThan(0)
    expect((await leaky.owner.query(`select * from public.leaky`)).rows.length).toBeGreaterThan(0)
  })

  it('denies a table the migration locked down (revoke) with permission denied', async () => {
    expect(await rejectedWith(locked.query(ANON, `select * from public.locked`))).toBe(PERMISSION_DENIED)
    expect(await rejectedWith(locked.query(AUTHENTICATED, `select * from public.locked`))).toBe(PERMISSION_DENIED)
    expect(await rejectedWith(locked.query(ANON, `insert into public.locked values (3, 'x')`))).toBe(PERMISSION_DENIED)
    expect((await exposedSurface(locked, 'anon')).tables).toEqual([])
    expect((await exposedSurface(locked, 'authenticated')).tables).toEqual([])
  })

  it('serves the locked table only through the whitelisted SECURITY DEFINER function', async () => {
    const { rows } = await locked.query(ANON, `select public.locked_count() as n`)
    expect(rows[0]).toEqual({ n: 2 })
    expect(await rejectedWith(locked.query(AUTHENTICATED, `select public.locked_count()`))).toBe(PERMISSION_DENIED)
    // service_role keeps its default grants (and bypasses RLS): the secret key stays server-side (R-11.1).
    expect(names((await exposedSurface(locked, 'service_role')).tables)).toEqual(['public.audit', 'public.locked'])
  })
})

describe('exposedSurface: what an API role can reach, read from the catalog', () => {
  let db: TestDb
  beforeEach(async () => {
    // The shim alone: supabase/migrations is no longer empty (M2.1), and these tests are about the shim.
    db = await openTestDb({ migrationsDir: `${FIXTURES}migrations-empty` })
  })
  afterEach(async () => {
    await db.close()
  })

  const tablesOf = async (role: 'anon' | 'authenticated' | 'service_role') => (await exposedSurface(db, role)).tables

  it('is empty in a database with no migrations: the shim itself exposes nothing in `public`', async () => {
    for (const role of ['anon', 'authenticated', 'service_role'] as const) {
      expect(await exposedSurface(db, role), role).toEqual({ tables: [], sequences: [], functions: [] })
    }
  })

  it('sees a privilege held on one column only', async () => {
    await db.owner.query(`create table public.t_cols (a int, b int)`)
    await db.owner.query(`revoke all on public.t_cols from anon`)
    expect(await tablesOf('anon')).toEqual([])
    await db.owner.query(`grant select (a), insert (b), update (b), references (a) on public.t_cols to anon`)
    expect((await tablesOf('anon')).map((t) => [t.name, t.privileges])).toEqual([['t_cols', ['select', 'insert', 'update', 'references']]])
    expect((await db.query(ANON, `select a from public.t_cols`)).rows).toEqual([])
    expect(await rejectedWith(db.query(ANON, `select b from public.t_cols`))).toBe(PERMISSION_DENIED)
  })

  it('sees MAINTAIN, which `grant all` includes since PostgreSQL 17 and which works on a table the role cannot read', async () => {
    await db.owner.query(`create table public.t_maint (id int)`)
    await db.owner.query(`revoke select, insert, update, delete, truncate, references, trigger on public.t_maint from anon`)
    expect(await rejectedWith(db.query(ANON, `select * from public.t_maint`))).toBe(PERMISSION_DENIED)
    await db.query(ANON, `analyze public.t_maint`)
    await db.query(ANON, `lock table public.t_maint in access exclusive mode`)
    expect((await tablesOf('anon')).map((t) => [t.name, t.privileges])).toEqual([['t_maint', ['maintain']]])
    await db.owner.query(`revoke maintain on public.t_maint from anon`)
    expect(await tablesOf('anon')).toEqual([])
    // (ANALYZE would only warn and skip the table; LOCK TABLE fails.)
    expect(await rejectedWith(db.query(ANON, `lock table public.t_maint in access exclusive mode`))).toBe(PERMISSION_DENIED)
  })

  it('lists the sequences the default grants hand out, down to the single privilege', async () => {
    await db.owner.query(`create sequence public.t_seq`)
    const seqs = async () => (await exposedSurface(db, 'anon')).sequences
    expect(await seqs()).toEqual([{ schema: 'public', name: 't_seq', privileges: ['usage', 'select', 'update'] }])
    expect((await db.query(ANON, `select nextval('public.t_seq')::int as n`)).rows).toEqual([{ n: 1 }])
    await db.owner.query(`revoke all on sequence public.t_seq from anon`)
    await db.owner.query(`grant usage on sequence public.t_seq to anon`)
    expect(await seqs()).toEqual([{ schema: 'public', name: 't_seq', privileges: ['usage'] }])
    await db.owner.query(`revoke all on sequence public.t_seq from anon`)
    expect(await seqs()).toEqual([])
    expect(await rejectedWith(db.query(ANON, `select nextval('public.t_seq')`))).toBe(PERMISSION_DENIED)
  })

  it('leaves a function callable by anon after `revoke execute ... from public` alone: the default grant to anon is separate', async () => {
    await db.owner.query(`create function public.t_half() returns int language sql as 'select 1'`)
    await db.owner.query(`revoke execute on function public.t_half() from public`)
    expect(await db.rpc(ANON, 't_half')).toBe(1)
    expect(names((await exposedSurface(db, 'anon')).functions)).toEqual(['public.t_half'])
    await db.owner.query(`revoke execute on function public.t_half() from anon, authenticated`)
    expect(await rejectedWith(db.rpc(ANON, 't_half'))).toBe(PERMISSION_DENIED)
    expect((await exposedSurface(db, 'anon')).functions).toEqual([])
    expect(names((await exposedSurface(db, 'service_role')).functions)).toEqual(['public.t_half'])
  })

  it('grants what the superuser creates in `public` to the API roles too (the second default-privileges block)', async () => {
    await db.sudo.query(`
      create table public.t_su (id int);
      create sequence public.t_su_seq;
      create function public.t_su_fn() returns int language sql as 'select 1';
      revoke execute on function public.t_su_fn() from public;`)
    const s = await exposedSurface(db, 'authenticated')
    expect(names(s.tables)).toEqual(['public.t_su'])
    expect(names(s.sequences)).toEqual(['public.t_su_seq'])
    expect(names(s.functions)).toEqual(['public.t_su_fn'])
  })

  it('lists extension members only for the schemas asked for: pgcrypto sits in `extensions`, which PostgREST does not serve', async () => {
    expect((await exposedSurface(db, 'anon')).functions).toEqual([])
    const asked = names((await exposedSurface(db, 'anon', ['extensions'])).functions)
    expect(asked).toEqual(expect.arrayContaining(['extensions.hmac', 'extensions.digest', 'extensions.gen_random_bytes']))
  })
})

describe('exposedSurface: an extension installed into `public`', () => {
  let db: TestDb
  beforeAll(async () => {
    db = await openTestDb({ migrationsDir: `${FIXTURES}migrations-extension-public` })
  })
  afterAll(async () => {
    await db.close()
  })

  it('puts a plain `create extension` into `public`, since `public` precedes `extensions` on postgres\'s search_path', async () => {
    const { rows } = await db.owner.query<{ n: string }>(`select e.extnamespace::regnamespace::text as n from pg_extension e where e.extname = 'pg_trgm'`)
    expect(rows).toEqual([{ n: 'public' }])
  })

  it('lists its functions, which anon can EXECUTE and PostgREST would serve as RPCs', async () => {
    const anon = names((await exposedSurface(db, 'anon')).functions)
    expect(anon).toEqual(expect.arrayContaining(['public.similarity', 'public.show_trgm', 'public.set_limit', 'public.show_limit']))
    // set_limit changes a session-level setting: a caller-reachable side effect, not just a pure function.
    expect(await db.rpc(ANON, 'show_limit')).toEqual(expect.any(Number))
    expect(names((await exposedSurface(db, 'authenticated')).functions)).toEqual(anon)
  })
})
