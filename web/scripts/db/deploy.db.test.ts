/**
 * The deploy tool against a real database (ROADMAP M2.6): a database with the Supabase shim and no
 * migration, as a new project is. Applies the real `supabase/migrations`, twice, and a broken set.
 */

import pg from 'pg'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LEDGER_SCHEMA, LEDGER_TABLE, deploy, planDeploy, readLedger } from './deploy'
import { ANON, type TestDb } from './harness'
import { readMigrations, type SqlFile } from './sql'
import { TOKEN_RE, startSession } from './rpc-support'
import { PERMISSION_DENIED, openTestDb, rejectedWith } from './vitest'

const EMPTY = fileURLToPath(new URL('./fixtures/migrations-empty', import.meta.url))
const files = readMigrations()

async function asOwner<T>(db: TestDb, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: db.url('postgres') })
  client.on('error', () => undefined)
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

describe('deploying the migrations to an empty project', () => {
  let db: TestDb
  beforeAll(async () => { db = await openTestDb({ migrationsDir: EMPTY }) })
  afterAll(async () => { await db.close() })

  it('starts with nothing: no ledger, every file pending, and reading that creates nothing', async () => {
    await asOwner(db, async (c) => {
      const plan = planDeploy(files, await readLedger(c))
      expect(plan.pending.map((f) => f.name)).toEqual(files.map((f) => f.name))
      expect((await c.query(`select to_regnamespace('${LEDGER_SCHEMA}') as s, to_regnamespace('hb') as hb`)).rows[0]).toEqual({ s: null, hb: null })
    })
  })

  it('applies every file in order and records each', async () => {
    const log: string[] = []
    const result = await asOwner(db, (c) => deploy(c, files, (l) => log.push(l)))
    expect(result.applied.map((a) => a.name)).toEqual(files.map((f) => f.name))
    expect(result.skipped).toEqual([])
    expect(log).toHaveLength(files.length)
    const ledger = await db.owner.query<{ version: string; name: string; n: number }>(`select version, name, cardinality(statements) as n from ${LEDGER_SCHEMA}.${LEDGER_TABLE} order by version`)
    expect(ledger.rows.map((r) => `${r.version}_${r.name}.sql`)).toEqual(files.map((f) => f.name))
    expect(ledger.rows.every((r) => r.n === 1)).toBe(true)
    // The schema is there and works as the API sees it.
    expect((await startSession(db)).token).toMatch(TOKEN_RE)
  })

  it('applies nothing the second time', async () => {
    const before = await db.owner.query(`select count(*)::int as n from public.app_config`)
    const result = await asOwner(db, (c) => deploy(c, files))
    expect(result.applied).toEqual([])
    expect(result.skipped).toEqual(files.map((f) => f.name))
    expect((await db.owner.query(`select count(*)::int as n from public.app_config`)).rows).toEqual(before.rows)
  })

  it('keeps the ledger from the API roles', async () => {
    expect(await rejectedWith(db.query(ANON, `select * from ${LEDGER_SCHEMA}.${LEDGER_TABLE}`))).toBe(PERMISSION_DENIED)
    const rls = await db.owner.query<{ rls: boolean }>(`select relrowsecurity as rls from pg_class where oid = '${LEDGER_SCHEMA}.${LEDGER_TABLE}'::regclass`)
    expect(rls.rows[0]?.rls).toBe(true)
  })

  it('refuses to run when an applied file has changed, and changes nothing', async () => {
    const edited = files.map((f, i): SqlFile => (i === 0 ? { name: f.name, sql: `${f.sql}\n-- edited` } : f))
    await expect(asOwner(db, (c) => deploy(c, edited))).rejects.toThrow(/has changed since it was applied/)
  })
})

describe('a file that fails', () => {
  let db: TestDb
  beforeAll(async () => { db = await openTestDb({ migrationsDir: EMPTY }) })
  afterAll(async () => { await db.close() })

  const good: SqlFile = { name: '20260101000100_good.sql', sql: 'create table public.hb_deploy_t1 (id int primary key);\nalter table public.hb_deploy_t1 enable row level security;' }
  const bad: SqlFile = { name: '20260101000200_bad.sql', sql: 'create table public.hb_deploy_t2 (id int primary key);\nselect 1/0;' }
  const never: SqlFile = { name: '20260101000300_never.sql', sql: 'create table public.hb_deploy_t3 (id int primary key);' }
  const tables = async (): Promise<string[]> => (await db.owner.query<{ t: string }>(`select relname as t from pg_class where relname like 'hb_deploy_t%' and relkind = 'r' order by 1`)).rows.map((r) => r.t)

  it('stops there: the file is rolled back whole, the earlier one stays applied and recorded, the later one is not tried', async () => {
    await expect(asOwner(db, (c) => deploy(c, [good, bad, never]))).rejects.toThrow(/migration 20260101000200_bad\.sql failed: division by zero/)
    expect(await tables()).toEqual(['hb_deploy_t1'])
    expect((await asOwner(db, readLedger)).map((r) => r.version)).toEqual(['20260101000100'])
  })

  it('continues from there once the file is fixed', async () => {
    const fixed: SqlFile = { name: bad.name, sql: 'create table public.hb_deploy_t2 (id int primary key);' }
    const result = await asOwner(db, (c) => deploy(c, [good, fixed, never]))
    expect(result.applied.map((a) => a.name)).toEqual([fixed.name, never.name])
    expect(await tables()).toEqual(['hb_deploy_t1', 'hb_deploy_t2', 'hb_deploy_t3'])
  })

  it('fails a file whose revoke Postgres only warns about, and records nothing for it', async () => {
    const noop: SqlFile = { name: '20260101000400_noop_revoke.sql', sql: 'grant usage on schema auth to authenticated;' }
    await expect(asOwner(db, (c) => deploy(c, [good, { name: bad.name, sql: 'create table public.hb_deploy_t2 (id int primary key);' }, never, noop]))).rejects.toThrow(/did not apply a privilege change/)
    expect((await asOwner(db, readLedger)).map((r) => r.version)).not.toContain('20260101000400')
  })
})
