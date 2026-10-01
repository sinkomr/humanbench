/**
 * The Supabase shim and the engine under it (ROADMAP M2.0, A6): roles, extensions, the `auth`
 * helpers, the Vault shim, and the default grants that make a forgetful migration leak. Needs the
 * `db` vitest project: `npm run test:db`.
 */

import { createHmac, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import { CLUSTER_DIR_PREFIX, PG_MAJOR } from './engine'
import { ANON, AUTHENTICATED, SERVICE_ROLE, type TestDb } from './harness'
import { exposedSurface, names } from './surface'
import { PERMISSION_DENIED, UNDEFINED_FUNCTION, openTestDb, rejectedWith } from './vitest'

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
    for (const role of ['postgres', 'supabase_admin']) {
      expect(await rejectedWith(db.request(AUTHENTICATED, (c) => c.query(`set local role ${role}`))), role).toBe(PERMISSION_DENIED)
    }
  })

  it('does not let an API role create objects in `public`, or read the Vault schema', async () => {
    expect(await rejectedWith(db.query(ANON, `create table public.planted (id int)`))).toBe(PERMISSION_DENIED)
    expect(await rejectedWith(db.query(AUTHENTICATED, `create function public.planted() returns int language sql as 'select 1'`))).toBe(PERMISSION_DENIED)
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
    expect(surface.tables[0]?.privileges).toEqual(['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'])
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
