/**
 * The local Postgres engine (ROADMAP M2.0, A6; the decision is in supabase/README.md): a throw-away
 * PostgreSQL 17 cluster from the real native binaries that the npm packages `@embedded-postgres/*`
 * carry (pinned to 17.10 in package.json), started on a free loopback port in a temp directory,
 * with a random password. No Docker, no brew, no cloud.
 *
 * Only the binaries are used, not the `embedded-postgres` wrapper package: importing it registers
 * `async-exit-hook`, whose `beforeExit` handler calls `process.exit(0)` and so turns a failing
 * vitest run into exit code 0 (found while building this). Starting `initdb` and `postgres` takes
 * the few lines below.
 *
 * This module is process management only: start, stop, and reaping clusters a killed run left
 * behind. The Supabase shim, templates and test databases are in harness.ts.
 *
 * Why a reaper: the workflow watchdog kills a stalled run without letting it clean up, and a
 * SIGKILLed test process leaves its postmaster running. Every cluster directory carries a marker
 * with its owner's pid; the next start (and `npm run db:reap`) stops the postmasters whose owner
 * is dead and removes their directories. Only `hb-pg-*` directories with a marker are touched.
 */

import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import net from 'node:net'
import { arch, platform, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

/** Cluster directories are `<tmp>/hb-pg-XXXXXX`; the reaper only ever touches this prefix. */
export const CLUSTER_DIR_PREFIX = 'hb-pg-'
/** Written into each cluster directory at once: who owns it. */
export const MARKER_FILE = 'hb-harness.json'
/** The cluster superuser: Supabase's superuser is `supabase_admin`, and `postgres` is not one. */
export const SUPERUSER = 'supabase_admin'
/** Supabase's default major version (the npm packages are pinned to this major). */
export const PG_MAJOR = 17
export const HOST = '127.0.0.1'

/** What a client needs to reach a cluster; plain data, so vitest can `provide` it to test files. */
export interface ClusterInfo {
  readonly host: string
  readonly port: number
  /** Random per run; the superuser and the shim's login roles all use it. */
  readonly password: string
  readonly dir: string
}

export interface Cluster extends ClusterInfo {
  /** Stops the postmaster and deletes the cluster directory. Idempotent. */
  stop(): Promise<void>
  /** The last lines the server and initdb printed, for error messages. */
  logTail(): string
}

export interface StartOptions {
  /** Where `hb-pg-*` directories go. Default: the OS temp directory. */
  readonly baseDir?: string
  /** Fixed port instead of a free one (no retry). */
  readonly port?: number
  /** Reap clusters of dead owners first. Default true. */
  readonly reap?: boolean
}

/** `postgres://user:password@host:port/database`; user, password and database are percent-encoded. */
export function connectionUrl(info: ClusterInfo, user: string, database = 'postgres'): string {
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(info.password)}@${info.host}:${info.port}/${encodeURIComponent(database)}`
}

/** The npm package that holds the Postgres binaries for this machine (`@embedded-postgres/<name>`). */
export function binaryPackage(os: string = platform(), cpu: string = arch()): string {
  const names: Record<string, string | undefined> = {
    'darwin-arm64': 'darwin-arm64',
    'darwin-x64': 'darwin-x64',
    'linux-arm64': 'linux-arm64',
    'linux-x64': 'linux-x64',
  }
  const name = names[`${os}-${cpu}`]
  if (name === undefined) throw new Error(`No Postgres binaries are wired for ${os} ${cpu} (macOS and Linux, arm64 and x64; see optionalDependencies in web/package.json).`)
  return `@embedded-postgres/${name}`
}

export interface Binaries {
  /** `<package>/native`: bin/, lib/, share/. */
  readonly root: string
  readonly initdb: string
  readonly postgres: string
}

let binaries: Binaries | undefined

/**
 * Creates the symlinks of `links` (`target` -> `source`, both relative to `packageRoot`, as in the
 * package's `pg-symlinks.json`) that do not exist yet, as relative links in the target's directory.
 * Returns the targets it created.
 */
export function hydrateLinks(packageRoot: string, links: readonly { source: string; target: string }[]): string[] {
  const created: string[] = []
  for (const { source, target } of links) {
    const linkPath = join(packageRoot, target)
    try {
      lstatSync(linkPath)
    } catch {
      symlinkSync(basename(source), linkPath)
      created.push(target)
    }
  }
  return created
}

/**
 * Locates the binaries and prepares them once per process:
 * - the packages ship their shared-library symlinks as a JSON list and create them in a
 *   `postinstall` script; npm is moving to block unreviewed install scripts, so any missing link is
 *   created here (the same links, the same way; existing ones are left alone);
 * - the executables get their exec bit if an extraction lost it.
 */
export function prepareBinaries(): Binaries {
  if (binaries !== undefined) return binaries
  let entry: string
  try {
    entry = createRequire(import.meta.url).resolve(binaryPackage())
  } catch (e) {
    throw new Error(`The Postgres binaries are not installed (${binaryPackage()}). Run \`npm ci\` in web/.`, { cause: e })
  }
  const packageRoot = dirname(dirname(entry)) // <package>/dist/index.js
  const list = join(packageRoot, 'native', 'pg-symlinks.json')
  if (existsSync(list)) hydrateLinks(packageRoot, JSON.parse(readFileSync(list, 'utf8')) as { source: string; target: string }[])
  const root = join(packageRoot, 'native')
  const initdb = join(root, 'bin', 'initdb')
  const postgres = join(root, 'bin', 'postgres')
  for (const exe of [initdb, postgres]) {
    try {
      accessSync(exe, constants.X_OK)
    } catch {
      chmodSync(exe, 0o755)
    }
  }
  binaries = { root, initdb, postgres }
  return binaries
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.unref()
    s.on('error', reject)
    s.listen(0, HOST, () => {
      const { port } = s.address() as net.AddressInfo
      s.close(() => resolve(port))
    })
  })
}

/** Whether a process with this pid exists (a process we may not signal still counts). */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function isPostgresProcess(pid: number): boolean {
  try {
    return /postgres/.test(execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }))
  } catch {
    return false
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** The postmaster pid in `<data>/postmaster.pid` (its first line), or undefined. */
function postmasterPid(dataDir: string): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(join(dataDir, 'postmaster.pid'), 'utf8').split('\n')[0] ?? '', 10)
    return Number.isInteger(pid) && pid > 1 ? pid : undefined
  } catch {
    return undefined
  }
}

/** Fast shutdown (SIGINT), then immediate shutdown (SIGQUIT) if it has not exited in `graceMs`. */
async function stopPostmaster(dataDir: string, graceMs = 15_000): Promise<void> {
  const pid = postmasterPid(dataDir)
  if (pid === undefined || !isAlive(pid) || !isPostgresProcess(pid)) return
  process.kill(pid, 'SIGINT')
  for (let waited = 0; isAlive(pid) && waited < graceMs; waited += 100) await sleep(100)
  if (isAlive(pid)) {
    process.kill(pid, 'SIGQUIT')
    for (let waited = 0; isAlive(pid) && waited < 5_000; waited += 100) await sleep(100)
  }
}

export interface ReapResult {
  /** Directories of dead owners that were stopped and removed. */
  readonly reaped: string[]
  /** `hb-pg-*` directories left alone, with the reason. */
  readonly kept: { dir: string; reason: string }[]
}

/**
 * Stops and removes the clusters of runs that died without cleaning up. A directory is reaped only
 * if it is `<baseDir>/hb-pg-*`, has a marker, and the marker's owner pid is no longer alive. A live
 * owner (another test run) or a directory without a marker is never touched.
 */
export async function reapStaleClusters(baseDir: string = tmpdir()): Promise<ReapResult> {
  const result: { reaped: string[]; kept: { dir: string; reason: string }[] } = { reaped: [], kept: [] }
  if (!existsSync(baseDir)) return result
  for (const name of readdirSync(baseDir)) {
    if (!name.startsWith(CLUSTER_DIR_PREFIX)) continue
    const dir = join(baseDir, name)
    let owner: unknown
    try {
      owner = (JSON.parse(readFileSync(join(dir, MARKER_FILE), 'utf8')) as { ownerPid?: unknown }).ownerPid
    } catch {
      result.kept.push({ dir, reason: 'no readable marker' })
      continue
    }
    if (typeof owner !== 'number' || !Number.isInteger(owner)) {
      result.kept.push({ dir, reason: 'marker without an owner pid' })
    } else if (isAlive(owner)) {
      result.kept.push({ dir, reason: `owner ${owner} is alive` })
    } else {
      await stopPostmaster(join(dir, 'data'))
      await rm(dir, { recursive: true, force: true })
      result.reaped.push(dir)
    }
  }
  return result
}

/** The settings that make the cluster fast, loopback-only and deterministic (see supabase/README.md). */
const POSTGRES_FLAGS = [
  // Loopback TCP only, no Unix socket: nothing on the machine but this host's processes can connect.
  ['listen_addresses', HOST],
  ['unix_socket_directories', ''],
  // Throw-away data: skip durability.
  ['fsync', 'off'],
  ['synchronous_commit', 'off'],
  ['full_page_writes', 'off'],
  ['autovacuum', 'off'],
  ['wal_level', 'minimal'],
  ['max_wal_senders', '0'],
  ['shared_buffers', '32MB'],
  ['max_connections', '100'],
  // Supabase runs in UTC.
  ['TimeZone', 'UTC'],
  ['log_timezone', 'UTC'],
].flatMap(([k, v]) => ['-c', `${k}=${v}`])

/** English messages, whatever the user's locale (the readiness and port-clash checks read them). */
const CHILD_ENV = { ...process.env, LC_ALL: 'C', LANG: 'C' }

const MAX_LINES = 200

class LogBuffer {
  private readonly lines: string[] = []
  push(chunk: unknown): void {
    for (const line of String(chunk).split('\n')) {
      if (line.trim() === '') continue
      this.lines.push(line)
      if (this.lines.length > MAX_LINES) this.lines.shift()
    }
  }
  tail(n = 40): string {
    return this.lines.slice(-n).join('\n')
  }
}

function runInitdb(initdb: string, args: string[], log: LogBuffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(initdb, args, { env: CHILD_ENV, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (d) => log.push(d))
    child.stderr.on('data', (d) => log.push(d))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`initdb exited with code ${code}`))))
  })
}

/** Starts the postmaster and resolves when it accepts connections. */
function startPostmaster(postgres: string, dataDir: string, port: number, log: LogBuffer, timeoutMs = 60_000): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(postgres, ['-D', dataDir, '-p', String(port), ...POSTGRES_FLAGS], { env: CHILD_ENV, stdio: ['ignore', 'pipe', 'pipe'] })
    let settled = false
    const done = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      child.kill('SIGQUIT')
      done(() => reject(new Error(`postgres did not accept connections within ${timeoutMs / 1000} s`)))
    }, timeoutMs)
    const onData = (d: unknown): void => {
      log.push(d)
      if (String(d).includes('database system is ready to accept connections')) done(() => resolve(child))
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', (e) => done(() => reject(e)))
    child.on('exit', (code, signal) => done(() => reject(new Error(`postgres exited before it was ready (${signal ?? `code ${code}`})`))))
  })
}

/**
 * Starts a fresh cluster. Throws with the server's last log lines if it does not come up. Call
 * `stop()` when done; if the process is killed instead, the next `startCluster` reaps it.
 */
export async function startCluster(options: StartOptions = {}): Promise<Cluster> {
  const baseDir = options.baseDir ?? tmpdir()
  if (options.reap !== false) await reapStaleClusters(baseDir).catch(() => undefined)
  const { initdb, postgres } = prepareBinaries()

  const dir = mkdtempSync(join(baseDir, CLUSTER_DIR_PREFIX))
  writeFileSync(join(dir, MARKER_FILE), JSON.stringify({ ownerPid: process.pid, startedAt: new Date().toISOString() }))
  const dataDir = join(dir, 'data')
  const password = randomBytes(18).toString('base64url')
  const log = new LogBuffer()

  let child: ChildProcess | undefined
  let port = 0
  try {
    const pwFile = join(dir, 'pwfile')
    writeFileSync(pwFile, `${password}\n`, { mode: 0o600 })
    try {
      await runInitdb(
        initdb,
        ['-D', dataDir, '-U', SUPERUSER, '--auth=scram-sha-256', `--pwfile=${pwFile}`, '--encoding=UTF8', '--locale=C', '--no-sync'],
        log,
      )
    } finally {
      rmSync(pwFile, { force: true })
    }
    for (let attempt = 1; child === undefined; attempt++) {
      port = options.port ?? (await freePort())
      try {
        child = await startPostmaster(postgres, dataDir, port, log)
      } catch (e) {
        // A port taken between our probe and the server's bind: try another one.
        if (options.port === undefined && attempt < 4 && /address already in use/i.test(log.tail())) continue
        throw e
      }
    }
  } catch (e) {
    await stopPostmaster(dataDir).catch(() => undefined)
    await rm(dir, { recursive: true, force: true })
    throw new Error(`Local Postgres failed to start: ${e instanceof Error ? e.message : String(e)}\n${log.tail()}`, { cause: e })
  }

  const running = child
  let stopped = false
  // Last resort when the process ends without stop() (a crash, process.exit): the data is
  // throw-away, so an immediate shutdown (SIGQUIT) and a synchronous delete are fine.
  const onExit = (): void => {
    if (running.exitCode === null && running.signalCode === null) running.kill('SIGQUIT')
    rmSync(dir, { recursive: true, force: true })
  }
  process.once('exit', onExit)

  return {
    host: HOST,
    port,
    password,
    dir,
    logTail: () => log.tail(),
    async stop() {
      if (stopped) return
      stopped = true
      process.removeListener('exit', onExit)
      try {
        if (running.exitCode === null && running.signalCode === null) {
          const exited = new Promise<void>((resolve) => running.once('exit', () => resolve()))
          running.kill('SIGINT')
          const timeout = sleep(30_000).then(() => 'timeout' as const)
          if ((await Promise.race([exited, timeout])) === 'timeout') {
            running.kill('SIGQUIT')
            await Promise.race([exited, sleep(5_000)])
          }
        }
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  }
}
