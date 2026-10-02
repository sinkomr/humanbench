/**
 * `npm run db:up` and the reaper, end to end (ROADMAP M2.0): the CLI starts its own cluster with the
 * shim and the migrations and prints URLs another client (the bank's Python, M2.5) can connect with;
 * Ctrl-C removes everything; and when the process is killed instead (the workflow watchdog does
 * that), the next start reaps the orphaned postmaster and its directory. Needs `npm run test:db`.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import { reapStaleClusters } from './engine'

const WEB = fileURLToPath(new URL('../../', import.meta.url))
const running: ChildProcess[] = []

afterEach(() => {
  for (const c of running.splice(0)) c.kill('SIGKILL')
})

interface Cli {
  readonly child: ChildProcess
  readonly urls: Record<'HB_DB_URL' | 'HB_DB_URL_AUTHENTICATOR' | 'HB_DB_URL_SUPERUSER', string>
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
}

/** Runs `db:up` as its own process (node + tsx, so one pid) and waits for the three URLs. */
function startCli(env: Readonly<Record<string, string>> = {}): Promise<Cli> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/db/cli.ts', 'up'], { cwd: WEB, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    running.push(child)
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((r) => child.once('exit', (code, signal) => r({ code, signal })))
    let out = ''
    let err = ''
    const timer = setTimeout(() => reject(new Error(`db:up printed no URLs within 90 s.\nstdout: ${out}\nstderr: ${err}`)), 90_000)
    child.stderr.on('data', (d) => (err += String(d)))
    child.stdout.on('data', (d) => {
      out += String(d)
      const lines = Object.fromEntries(
        out
          .split('\n')
          .filter((l) => l.startsWith('HB_DB_URL'))
          .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
      )
      if (lines.HB_DB_URL !== undefined && lines.HB_DB_URL_AUTHENTICATOR !== undefined && lines.HB_DB_URL_SUPERUSER !== undefined) {
        clearTimeout(timer)
        resolve({ child, urls: lines as Cli['urls'], exited })
      }
    })
    void exited.then(({ code, signal }) => {
      clearTimeout(timer)
      reject(new Error(`db:up exited early (${signal ?? code}).\nstdout: ${out}\nstderr: ${err}`))
    })
  })
}

async function query<R extends pg.QueryResultRow>(url: string, sql: string): Promise<R[]> {
  const client = new pg.Client({ connectionString: url })
  client.on('error', () => undefined)
  await client.connect()
  try {
    return (await client.query<R>(sql)).rows
  } finally {
    await client.end().catch(() => undefined)
  }
}

/** Whether something accepts connections at the URL's port. */
async function accepts(url: string): Promise<boolean> {
  try {
    await query(url, 'select 1')
    return true
  } catch {
    return false
  }
}

/** The cluster directory (`…/hb-pg-XXXXXX`) behind a URL. */
async function clusterDirOf(url: string): Promise<string> {
  const [row] = await query<{ dir: string }>(url, `select current_setting('data_directory') as dir`)
  return dirname(row?.dir as string)
}

describe('npm run db:up', () => {
  it('starts a database with the shim and prints URLs for the owner, PostgREST and the superuser', async () => {
    const cli = await startCli()
    const [owner] = await query<{ u: string; super: string }>(cli.urls.HB_DB_URL, `select current_user as u, current_setting('is_superuser') as super`)
    expect(owner).toEqual({ u: 'postgres', super: 'off' })
    const [pgrst] = await query<{ u: string; n: number }>(
      cli.urls.HB_DB_URL_AUTHENTICATOR,
      `select session_user as u, (select count(*)::int from pg_roles where rolname in ('anon', 'authenticated', 'service_role')) as n`,
    )
    expect(pgrst).toEqual({ u: 'authenticator', n: 3 })
    const [admin] = await query<{ super: string }>(cli.urls.HB_DB_URL_SUPERUSER, `select current_setting('is_superuser') as super`)
    expect(admin).toEqual({ super: 'on' })
    expect(cli.urls.HB_DB_URL).toMatch(/^postgres:\/\/postgres:[^@]+@127\.0\.0\.1:\d+\/hb_test_/)
    cli.child.kill('SIGINT')
    await cli.exited
  })

  it('on Ctrl-C stops the server and deletes its directory, and exits 0', async () => {
    const cli = await startCli()
    const dir = await clusterDirOf(cli.urls.HB_DB_URL_SUPERUSER)
    expect(existsSync(dir)).toBe(true)
    cli.child.kill('SIGINT')
    expect(await cli.exited).toEqual({ code: 0, signal: null })
    expect(existsSync(dir)).toBe(false)
    expect(await accepts(cli.urls.HB_DB_URL)).toBe(false)
  })

  it('after a kill -9 leaves an orphan (guard off), the reaper stops the postmaster and removes the directory', async () => {
    // HB_PG_GUARD=0: the guard (guard.ts, tested in cleanup.db.test.ts) would remove the orphan by itself.
    const cli = await startCli({ HB_PG_GUARD: '0' })
    const dir = await clusterDirOf(cli.urls.HB_DB_URL_SUPERUSER)
    cli.child.kill('SIGKILL')
    await cli.exited
    // The CLI is gone but its postmaster is not: that is what the reaper is for.
    expect(await accepts(cli.urls.HB_DB_URL)).toBe(true)
    expect(existsSync(dir)).toBe(true)

    const { reaped } = await reapStaleClusters()
    expect(reaped).toContain(dir)
    expect(existsSync(dir)).toBe(false)
    expect(await accepts(cli.urls.HB_DB_URL)).toBe(false)
  })
})
