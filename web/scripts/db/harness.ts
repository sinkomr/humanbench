/**
 * The local database test harness (ROADMAP M2.0): builds a Supabase-shaped database on the
 * throw-away cluster of engine.ts and hands tests one fresh database each.
 *
 *   cluster (engine.ts)            one per run (vitest globalSetup, or `npm run db:up`)
 *     role shim                    supabase/local/cluster/*.sql, run once as supabase_admin
 *     template database hb_t_<h>   database shim (supabase/local/database/*.sql, as supabase_admin)
 *                                  + supabase/migrations/*.sql (as `postgres`, like the CLI)
 *       test database hb_test_…    CREATE DATABASE … TEMPLATE: ~100 ms, one per test file
 *
 * Tests talk to a database the way the app does: `request()` and `rpc()` run in one transaction as
 * the `authenticator` login role, switch to anon / authenticated / service_role with SET LOCAL
 * ROLE, and set the `request.*` settings, exactly what PostgREST does per request. `sudo` and
 * `owner` are for arranging data and inspecting; they bypass what the tests are about.
 */

import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { SUPERUSER, connectionUrl, type ClusterInfo } from './engine'
import {
  MIGRATIONS_DIR,
  SHIM_CLUSTER_DIR,
  SHIM_DATABASE_DIR,
  quoteIdent,
  readMigrations,
  readShimFiles,
  rpcCallSql,
  templateDigest,
  type RpcParam,
  type SqlFile,
} from './sql'

/** The roles PostgREST can switch a request to (what the public anon key and user JWTs map to). */
export type ApiRole = 'anon' | 'authenticated' | 'service_role'
/** The roles a connection can log in as. */
export type LoginRole = typeof SUPERUSER | 'postgres' | 'authenticator'

const API_ROLES: readonly ApiRole[] = ['anon', 'authenticated', 'service_role']

/** One API request: who it runs as and what PostgREST would put in the `request.*` settings. */
export interface RequestContext {
  readonly role: ApiRole
  /** The JWT claims. `role` defaults to `role`; `authenticated` gets a fixed fake `sub`. */
  readonly claims?: Readonly<Record<string, unknown>>
  /** Request headers, lower-case names (`x-forwarded-for` is what the rate limit reads, DESIGN §11.2). */
  readonly headers?: Readonly<Record<string, string>>
  readonly method?: string
  readonly path?: string
}

export const ANON: RequestContext = { role: 'anon' }
export const AUTHENTICATED: RequestContext = { role: 'authenticated' }
export const SERVICE_ROLE: RequestContext = { role: 'service_role' }

/** A fake user id for `authenticated` requests (nothing in HumanBench has accounts). */
export const FAKE_USER_ID = '00000000-0000-4000-8000-000000000001'

// Advisory locks that serialize template builds and clones across the test files of one run.
const LOCK_BUILD = 7_420_001
const LOCK_CLONE = 7_420_002

export function pgConfig(info: ClusterInfo, user: string, database: string): pg.ClientConfig {
  return { host: info.host, port: info.port, user, password: info.password, database, application_name: 'hb-harness' }
}

async function withClient<T>(info: ClusterInfo, user: string, database: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(pgConfig(info, user, database))
  client.on('error', () => undefined)
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end().catch(() => undefined)
  }
}

/** SQLSTATE 01006 `privilege_not_revoked` and 01007 `privilege_not_granted`: GRANT/REVOKE only warn. */
const NO_PRIVILEGE_CHANGE = new Set(['01006', '01007'])

/**
 * Runs one SQL file; a failure names the file and, if Postgres gave a position, the line.
 *
 * With `strictPrivileges`, a GRANT or REVOKE that Postgres reports as not applied (it only
 * WARNs: the role running it lacked the right, e.g. no grant option) fails the file. A migration
 * whose `revoke ... from anon` silently did nothing would leave the object exposed and pass every
 * test that does not look, so the harness refuses it, which Supabase would not.
 */
async function runFile(db: pg.Client, kind: string, file: SqlFile, strictPrivileges = false): Promise<void> {
  const noPrivilegeChange: string[] = []
  const onNotice = (n: { code?: string | undefined; message?: string | undefined }): void => {
    if (n.code !== undefined && NO_PRIVILEGE_CHANGE.has(n.code)) noPrivilegeChange.push(n.message ?? n.code)
  }
  if (strictPrivileges) db.on('notice', onNotice)
  try {
    await db.query(file.sql)
  } catch (e) {
    const err = e as Error & { position?: string }
    const pos = err.position === undefined ? undefined : Number(err.position)
    const line = pos === undefined ? '' : ` (line ${file.sql.slice(0, pos).split('\n').length})`
    throw new Error(`${kind} ${file.name}${line} failed: ${err.message}`, { cause: e })
  } finally {
    if (strictPrivileges) db.off('notice', onNotice)
  }
  if (noPrivilegeChange.length > 0) {
    throw new Error(
      `${kind} ${file.name} failed: Postgres did not apply a privilege change (${noPrivilegeChange.join('; ')}). ` +
        'The role running the migration (postgres) lacks the right to grant or revoke it.',
    )
  }
}

/** Creates the Supabase roles and gives the login roles this run's password. Once per cluster. */
async function provision(admin: pg.Client, info: ClusterInfo, files: readonly SqlFile[]): Promise<void> {
  const done = await admin.query(`select 1 from pg_roles where rolname = 'anon'`)
  if ((done.rowCount ?? 0) > 0) return
  await admin.query('begin')
  try {
    for (const f of files) await runFile(admin, 'cluster shim', f)
    for (const role of ['postgres', 'authenticator']) {
      await admin.query(`alter role ${quoteIdent(role)} password ${admin.escapeLiteral(info.password)}`)
    }
    await admin.query('commit')
  } catch (e) {
    await admin.query('rollback').catch(() => undefined)
    throw e
  }
}

/** `hb_t_<hash>`: the template database name for these files (see {@link templateDigest}). */
export function templateNameFor(parts: Parameters<typeof templateDigest>[0]): string {
  return `hb_t_${templateDigest(parts)}`
}

/** The template name for the shim and the migrations in `migrationsDir` (default supabase/migrations). */
export function templateNameOf(migrationsDir: string = MIGRATIONS_DIR): string {
  return templateNameFor({ cluster: readShimFiles(SHIM_CLUSTER_DIR), database: readShimFiles(SHIM_DATABASE_DIR), migrations: readMigrations(migrationsDir) })
}

/**
 * Makes sure the cluster has the Supabase roles and a template database for these migrations, and
 * returns the template's name. The name carries a hash of every shim file and migration, so
 * editing one builds a new template and no stale one is reused. Safe to call from several test
 * files at once (they queue on an advisory lock; the first builds, the rest find it).
 */
export async function ensureTemplate(info: ClusterInfo, options: { readonly migrationsDir?: string } = {}): Promise<string> {
  const clusterFiles = readShimFiles(SHIM_CLUSTER_DIR)
  const databaseFiles = readShimFiles(SHIM_DATABASE_DIR)
  const migrations = readMigrations(options.migrationsDir ?? MIGRATIONS_DIR)
  const name = templateNameFor({ cluster: clusterFiles, database: databaseFiles, migrations })

  return withClient(info, SUPERUSER, 'postgres', async (admin) => {
    await admin.query('select pg_advisory_lock($1)', [LOCK_BUILD])
    try {
      await provision(admin, info, clusterFiles)
      const exists = await admin.query('select 1 from pg_database where datname = $1', [name])
      if ((exists.rowCount ?? 0) > 0) return name
      await admin.query(`create database ${quoteIdent(name)}`)
      try {
        await withClient(info, SUPERUSER, name, async (db) => {
          for (const f of databaseFiles) await runFile(db, 'shim', f)
        })
        // As the Supabase CLI does: the non-superuser `postgres`, one implicit transaction per file.
        await withClient(info, 'postgres', name, async (db) => {
          for (const f of migrations) await runFile(db, 'migration', f, true)
        })
        await admin.query(`alter database ${quoteIdent(name)} is_template true`)
      } catch (e) {
        await admin.query(`drop database if exists ${quoteIdent(name)} with (force)`).catch(() => undefined)
        throw e
      }
      return name
    } finally {
      await admin.query('select pg_advisory_unlock($1)', [LOCK_BUILD]).catch(() => undefined)
    }
  })
}

/** Applies the `ALTER ROLE … SET` settings of the role, as PostgREST does per request. */
const ROLE_SETTINGS_SQL = `
select set_config(split_part(s, '=', 1), substr(s, strpos(s, '=') + 1), true)
from pg_db_role_setting r
cross join lateral unnest(r.setconfig) as s
where r.setrole = (select oid from pg_roles where rolname = $1)
  and r.setdatabase in (0, (select oid from pg_database where datname = current_database()))
order by r.setdatabase`

const REQUEST_GUCS_SQL = `
select set_config('request.jwt.claims', $1, true),
       set_config('request.headers', $2, true),
       set_config('request.method', $3, true),
       set_config('request.path', $4, true)`

/** The JWT claims PostgREST would hand the database for this context. */
export function claimsFor(ctx: RequestContext): Record<string, unknown> {
  return { role: ctx.role, ...(ctx.role === 'authenticated' ? { sub: FAKE_USER_ID } : {}), ...ctx.claims }
}

export interface TestDb {
  readonly name: string
  readonly cluster: ClusterInfo
  /** Connection URL of a login role in this database. */
  url(role: LoginRole): string
  /** Superuser (`supabase_admin`): arranging data and catalog inspection only; it bypasses every grant and RLS. */
  readonly sudo: pg.Pool
  /** `postgres`, the role migrations run as: not a superuser, bypasses RLS, owns the objects. */
  readonly owner: pg.Pool
  /** One API request: BEGIN, role settings, SET LOCAL ROLE, request.* settings, `fn`, COMMIT (or ROLLBACK). */
  request<T>(ctx: RequestContext, fn: (client: pg.PoolClient) => Promise<T>, options?: { readonly rollback?: boolean }): Promise<T>
  /** Shorthand for a single statement in one request. */
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(ctx: RequestContext, text: string, values?: unknown[]): Promise<pg.QueryResult<R>>
  /**
   * `POST /rpc/<fn>` against schema `public`: `args` is the JSON body. Resolves to what supabase-js
   * returns as `data` (the scalar, or an array of row objects for a set-returning function) and
   * rejects with the Postgres error (`.code` is the SQLSTATE: 42501 = permission denied).
   */
  rpc<T = unknown>(ctx: RequestContext, fn: string, args?: Readonly<Record<string, unknown>>): Promise<T>
  /** Closes every connection and drops the database. */
  close(): Promise<void>
}

let counter = 0

/** A fresh database cloned from the template of `options.migrationsDir` (default: supabase/migrations). */
export async function createTestDb(info: ClusterInfo, options: { readonly migrationsDir?: string } = {}): Promise<TestDb> {
  const template = await ensureTemplate(info, options)
  const name = `hb_test_${process.pid}_${++counter}_${randomBytes(3).toString('hex')}`
  await withClient(info, SUPERUSER, 'postgres', async (admin) => {
    await admin.query('select pg_advisory_lock($1)', [LOCK_CLONE])
    try {
      await admin.query(`create database ${quoteIdent(name)} template ${quoteIdent(template)}`)
      // CREATE DATABASE ... TEMPLATE copies the objects but not the database's own privileges, so
      // repeat the grant of supabase/local/database/20-privileges.sql: `postgres` can create
      // schemas and trusted extensions here as it could in the template its migrations ran in.
      await admin.query(`grant all on database ${quoteIdent(name)} to postgres`)
    } finally {
      await admin.query('select pg_advisory_unlock($1)', [LOCK_CLONE]).catch(() => undefined)
    }
  })
  return new Db(info, name)
}

class Db implements TestDb {
  private readonly pools = new Map<LoginRole, pg.Pool>()
  private closed = false

  constructor(
    readonly cluster: ClusterInfo,
    readonly name: string,
  ) {}

  url(role: LoginRole): string {
    return connectionUrl(this.cluster, role, this.name)
  }

  private pool(role: LoginRole, max: number): pg.Pool {
    let pool = this.pools.get(role)
    if (pool === undefined) {
      pool = new pg.Pool({ ...pgConfig(this.cluster, role, this.name), max, idleTimeoutMillis: 5_000 })
      pool.on('error', () => undefined)
      this.pools.set(role, pool)
    }
    return pool
  }

  get sudo(): pg.Pool {
    return this.pool(SUPERUSER, 2)
  }

  get owner(): pg.Pool {
    return this.pool('postgres', 2)
  }

  async request<T>(ctx: RequestContext, fn: (client: pg.PoolClient) => Promise<T>, options: { readonly rollback?: boolean } = {}): Promise<T> {
    if (!API_ROLES.includes(ctx.role)) throw new Error(`request(): "${String(ctx.role)}" is not an API role (${API_ROLES.join(', ')}).`)
    const client = await this.pool('authenticator', 8).connect()
    let broken = false
    try {
      await client.query('begin')
      await client.query(ROLE_SETTINGS_SQL, [ctx.role])
      await client.query(`set local role ${ctx.role}`)
      await client.query(REQUEST_GUCS_SQL, [
        JSON.stringify(claimsFor(ctx)),
        JSON.stringify(ctx.headers ?? {}),
        ctx.method ?? 'POST',
        ctx.path ?? '/rpc',
      ])
      const out = await fn(client)
      await client.query(options.rollback === true ? 'rollback' : 'commit')
      return out
    } catch (e) {
      try {
        await client.query('rollback')
      } catch {
        broken = true
      }
      throw e
    } finally {
      client.release(broken)
    }
  }

  query<R extends pg.QueryResultRow = pg.QueryResultRow>(ctx: RequestContext, text: string, values?: unknown[]): Promise<pg.QueryResult<R>> {
    return this.request(ctx, (c) => c.query<R>(text, values))
  }

  async rpc<T = unknown>(ctx: RequestContext, fn: string, args: Readonly<Record<string, unknown>> = {}): Promise<T> {
    const meta = await this.owner.query<{ names: string[] | null; types: string[]; retset: boolean; rettype: string }>(
      `select p.proargnames as names,
              array(select format_type(t, null) from unnest(p.proargtypes::oid[]) with ordinality as u(t, o) order by o) as types,
              p.proretset as retset,
              format_type(p.prorettype, null) as rettype
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`,
      [fn],
    )
    if (meta.rows.length === 0) throw new Error(`rpc: function public.${fn} does not exist`)
    if (meta.rows.length > 1) throw new Error(`rpc: public.${fn} is overloaded (${meta.rows.length} signatures); the harness calls one function per name`)
    const m = meta.rows[0] as (typeof meta.rows)[number]
    const names = m.names ?? []
    const params: RpcParam[] = m.types.map((type, i) => ({ name: names[i] ?? `$${i + 1}`, type }))
    const supplied = Object.keys(args)
    const sql = rpcCallSql('public', fn, params, supplied, { type: m.rettype })
    const rows = await this.request(ctx, (c) =>
      c.query<{ result: unknown }>(sql, supplied.length === 0 ? [] : [JSON.stringify(args)]).then((r) => r.rows.map((row) => row.result)),
    )
    return (m.retset ? rows : rows[0]) as T
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await Promise.allSettled([...this.pools.values()].map((p) => p.end()))
    await withClient(this.cluster, SUPERUSER, 'postgres', (admin) =>
      admin.query(`drop database if exists ${quoteIdent(this.name)} with (force)`),
    )
  }
}
