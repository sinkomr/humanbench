/**
 * `npm run db:up` / `npm run db:reap` (ROADMAP M2.0): the local database outside vitest, for the
 * parts of M2 that connect with another client (the bank's Python `hb load push`, `calibrate` and
 * the backup round trip, M2.5) and for poking at a migration by hand.
 *
 *   npm run db:up [-- --migrations <dir>]   start a throw-away cluster with the Supabase shim and the
 *                                           migrations, print the connection URLs, run until Ctrl-C
 *   npm run db:reap                         stop and remove clusters whose process died without cleanup
 *
 * `db:up` prints `KEY=value` lines on stdout (a caller reads them) and everything else on stderr:
 *   HB_DB_URL                owner / migration role `postgres` (what SUPABASE_DB_URL is on Supabase)
 *   HB_DB_URL_AUTHENTICATOR  PostgREST's login role (SET ROLE anon | authenticated | service_role)
 *   HB_DB_URL_SUPERUSER      supabase_admin, for inspection
 * The passwords are random per run and die with the cluster. Nothing here is a secret.
 */

import { reapStaleClusters, startCluster } from './engine'
import { createTestDb } from './harness'

const USAGE = `usage: npm run db:up [-- --migrations <dir>]
       npm run db:reap`

async function up(args: readonly string[]): Promise<number> {
  const at = args.indexOf('--migrations')
  const migrationsDir = at === -1 ? undefined : args[at + 1]
  if (at !== -1 && migrationsDir === undefined) {
    console.error(USAGE)
    return 2
  }
  const cluster = await startCluster()
  try {
    const db = await createTestDb(cluster, migrationsDir === undefined ? {} : { migrationsDir })
    console.log(`HB_DB_URL=${db.url('postgres')}`)
    console.log(`HB_DB_URL_AUTHENTICATOR=${db.url('authenticator')}`)
    console.log(`HB_DB_URL_SUPERUSER=${db.url('supabase_admin')}`)
    console.error(`Local PostgreSQL 17 with the Supabase shim, database ${db.name}, on ${cluster.host}:${cluster.port}. Ctrl-C stops it and deletes its data.`)

    await new Promise<void>((resolve) => {
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(signal, () => resolve())
    })
    await db.close().catch(() => undefined)
  } finally {
    await cluster.stop()
  }
  return 0
}

async function reap(): Promise<number> {
  const { reaped, kept } = await reapStaleClusters()
  for (const dir of reaped) console.log(`reaped ${dir}`)
  for (const { dir, reason } of kept) console.error(`kept ${dir}: ${reason}`)
  if (reaped.length === 0) console.error('Nothing to reap.')
  return 0
}

const [command, ...rest] = process.argv.slice(2)
const code = command === 'up' ? await up(rest) : command === 'reap' ? await reap() : (console.error(USAGE), 2)
process.exit(code)
