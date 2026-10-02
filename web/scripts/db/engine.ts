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
 * Independent of the host's System V IPC. On macOS the kernel's SysV accounting leaks when a
 * postmaster is killed, and then even `initdb` fails with "shmget: Cannot allocate memory" until a
 * reboot; the semaphore sets of a killed postmaster stay behind too. So there the binaries run
 * through shm.ts: a tiny library gives the server anonymous shared mappings in place of SysV
 * segments and semaphores. The server's other shared memory is configured not to use the host either
 * (`shared_memory_type=mmap`, `dynamic_shared_memory_type=mmap`: files in the data directory, not
 * POSIX shm objects that outlive a kill); initdb gets the same two settings (`-c`) because it writes
 * `posix` into postgresql.conf and its own `--boot` and `--single` runs read it. Linux uses the
 * binaries as they are, with the host's SysV semaphores (a SIGKILL of a whole process tree leaks
 * those there, as it does for any Postgres; the limits are large and the keys are reused).
 *
 * Cleanup, in layers, so that nothing outlives a run:
 *   1. `stop()`: the normal end.
 *   2. process `exit` (a crash, process.exit, an uncaught error) and SIGINT / SIGTERM / SIGHUP:
 *      every live cluster is stopped and deleted, then the signal is re-raised if nobody else
 *      handles it (so the exit status stays the signal's).
 *   3. SIGKILL cannot be handled. Each cluster has a detached guard process (guard.ts) that watches
 *      the owner and stops and deletes the cluster when it dies.
 *   4. The reaper below, if even the guard is gone (the whole process tree killed, a reboot): every
 *      cluster directory carries a marker with its owner's pid; the next start (and
 *      `npm run db:reap`) stops the postmasters whose owner is dead and removes their directories.
 *      Only `hb-pg-*` directories with a marker are touched.
 */

import { spawn, type ChildProcess } from 'node:child_process'
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
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import net from 'node:net'
import { arch, platform, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { spawnGuard } from './guard'
import { isAlive, isPostgresProcess, orTimeout, processesUsing, sleep, sleepSync } from './proc'
import { buildShimmedBinaries, verifyShimmed } from './shm'

export { isAlive, processesUsing }

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

/** How the server gets its System V shared memory: from the host's kernel, or from the shim (shm.ts). */
export type ShmMode = 'sysv' | 'shim'

export interface Binaries {
  /** `<package>/native`: bin/, lib/, share/ (the package's own files, never modified). */
  readonly root: string
  /** What to run: the package's executables, or the overlay's copies with the shim. */
  readonly initdb: string
  readonly postgres: string
  readonly shm: ShmMode
  /** On macOS, why the shim is not in use although it was wanted; shown when the server then fails to start. */
  readonly shmNote?: string
}

export interface PrepareOptions {
  /**
   * `auto` (default; also `HB_PG_SHM` unset): the shim on macOS, the host's System V shared memory
   * elsewhere, and on macOS the host's too if the shim cannot be built (with a note). `sysv`: always
   * the host's. `shim`: macOS only, and an error if it cannot be built.
   */
  readonly shm?: 'auto' | 'sysv' | 'shim'
  /** Where the shim overlay is cached, in order of preference. Default: `node_modules/.cache/humanbench-pg`, then `hb-pgbin-<uid>` in the temp directory. */
  readonly cacheDirs?: readonly string[]
  /** For tests. Default `os.platform()`. */
  readonly platform?: string
}

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

/** The package's own binaries, found and prepared once per process. */
interface Located extends Omit<Binaries, 'shm' | 'shmNote'> {
  readonly packageRoot: string
}

let located: Located | undefined

/**
 * Locates the binaries and prepares them once per process:
 * - the packages ship their shared-library symlinks as a JSON list and create them in a
 *   `postinstall` script; npm is moving to block unreviewed install scripts, so any missing link is
 *   created here (the same links, the same way; existing ones are left alone);
 * - the executables get their exec bit if an extraction lost it.
 */
function locateBinaries(): Located {
  if (located !== undefined) return located
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
  located = { packageRoot, root, initdb, postgres }
  return located
}

function shmModeFromEnv(): 'auto' | 'sysv' | 'shim' {
  const v = process.env.HB_PG_SHM
  if (v === undefined || v === '' || v === 'auto') return 'auto'
  if (v === 'sysv' || v === 'shim') return v
  throw new Error(`HB_PG_SHM must be auto, sysv or shim, not "${v}".`)
}

const prepared = new Map<string, Binaries>()
let warnedNoShim = false

/**
 * The binaries to run (see {@link PrepareOptions} for the shared-memory choice). Cached per
 * combination of options for the life of the process; building the shim the first time takes a few
 * seconds, and nothing after that.
 */
export function prepareBinaries(options: PrepareOptions = {}): Binaries {
  const mode = options.shm ?? shmModeFromEnv()
  const os = options.platform ?? platform()
  const real = locateBinaries()
  const cacheKey = `${mode}|${os}|${(options.cacheDirs ?? []).join(',')}`
  const cached = prepared.get(cacheKey)
  if (cached !== undefined) return cached

  const sysv = (shmNote?: string): Binaries => ({ root: real.root, initdb: real.initdb, postgres: real.postgres, shm: 'sysv', ...(shmNote === undefined ? {} : { shmNote }) })
  let result: Binaries
  if (mode === 'sysv' || os !== 'darwin') {
    if (mode === 'shim' && os !== 'darwin') throw new Error('HB_PG_SHM=shim: the shared-memory shim is for macOS; other systems use their own System V shared memory.')
    result = sysv()
  } else {
    // The temp directory is shared by every user of the machine: a name of one's own, so nobody else's directory is in the way.
    const cacheDirs = options.cacheDirs ?? [join(real.packageRoot, '..', '..', '.cache', 'humanbench-pg'), join(tmpdir(), `hb-pgbin-${process.getuid?.() ?? 'user'}`)]
    try {
      const shim = buildShimmedBinaries(real, { cacheDirs })
      // A cached overlay is not rebuilt, so check here that it runs in this process tree (a library
      // without the slice the kernel picks, a damaged copy): else `auto` falls back like it does when the build fails.
      verifyShimmed(shim)
      result = { root: real.root, initdb: shim.initdb, postgres: shim.postgres, shm: 'shim' }
    } catch (e) {
      if (mode === 'shim') throw e
      const note = `The System V shared-memory shim could not be built or does not run (${e instanceof Error ? e.message : String(e)}), so the host's System V shared memory is used.`
      if (!warnedNoShim) {
        warnedNoShim = true
        console.warn(`[db harness] ${note}`)
      }
      result = sysv(note)
    }
  }
  prepared.set(cacheKey, result)
  return result
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

/** The postmaster pid in `<data>/postmaster.pid` (its first line), or undefined. */
function postmasterPid(dataDir: string): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(join(dataDir, 'postmaster.pid'), 'utf8').split('\n')[0] ?? '', 10)
    return Number.isInteger(pid) && pid > 1 ? pid : undefined
  } catch {
    return undefined
  }
}

/** Whether the directory has not changed for `ms`. A directory that cannot be read counts as young. */
function isOlderThan(dir: string, ms: number): boolean {
  try {
    return Date.now() - statSync(dir).mtimeMs >= ms
  } catch {
    return false
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

/** A directory with no marker is left alone for this long after its last change (the marker is written within milliseconds of creating the directory, so a younger one may be a start in progress). */
export const ORPHAN_AFTER_MS = 10 * 60 * 1000

export interface ReapOptions {
  /** How old a cluster directory without a marker must be to be removed. Default {@link ORPHAN_AFTER_MS}. */
  readonly orphanAfterMs?: number
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
 * owner (another test run) is never touched, nor is a marker that cannot be read or names no pid.
 * A directory with no marker at all is what a start killed between `mkdtemp` and the marker, or a
 * guard that removed the marker and then could not remove the rest, leaves: nothing runs in it (the
 * marker is written before anything is started), so once it has not changed for `orphanAfterMs` only
 * the directory is removed.
 */
export async function reapStaleClusters(baseDir: string = tmpdir(), options: ReapOptions = {}): Promise<ReapResult> {
  const orphanAfterMs = options.orphanAfterMs ?? ORPHAN_AFTER_MS
  const result: { reaped: string[]; kept: { dir: string; reason: string }[] } = { reaped: [], kept: [] }
  if (!existsSync(baseDir)) return result
  for (const name of readdirSync(baseDir)) {
    if (!name.startsWith(CLUSTER_DIR_PREFIX)) continue
    const dir = join(baseDir, name)
    let owner: unknown
    try {
      owner = (JSON.parse(readFileSync(join(dir, MARKER_FILE), 'utf8')) as { ownerPid?: unknown }).ownerPid
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' && isOlderThan(dir, orphanAfterMs)) {
        await rm(dir, { recursive: true, force: true })
        result.reaped.push(dir)
      } else {
        result.kept.push({ dir, reason: 'no readable marker' })
      }
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
  // Shared memory that never touches the host's POSIX shared-memory table (see the header): the main
  // segment is an anonymous mmap, the dynamic segments are files in the data directory. (initdb gets
  // the same two settings; the System V segment and semaphores are the shim's business.)
  ['shared_memory_type', 'mmap'],
  ['dynamic_shared_memory_type', 'mmap'],
  // Supabase runs in UTC.
  ['TimeZone', 'UTC'],
  ['log_timezone', 'UTC'],
].flatMap(([k, v]) => ['-c', `${k}=${v}`])

/** The same two settings for `initdb`, which writes them into postgresql.conf and runs its bootstrap and single-user servers with that file. */
const INITDB_SHARED_MEMORY_FLAGS = ['-c', 'shared_memory_type=mmap', '-c', 'dynamic_shared_memory_type=mmap']

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

function runInitdb(initdb: string, args: string[], log: LogBuffer, onSpawn: (child: ChildProcess) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(initdb, args, { env: CHILD_ENV, stdio: ['ignore', 'pipe', 'pipe'] })
    onSpawn(child)
    child.stdout.on('data', (d) => log.push(d))
    child.stderr.on('data', (d) => log.push(d))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`initdb exited with code ${code}`))))
  })
}

/** Starts the postmaster and resolves when it accepts connections. */
function startPostmaster(postgres: string, dataDir: string, port: number, log: LogBuffer, onSpawn: (child: ChildProcess) => void, timeoutMs = 60_000): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(postgres, ['-D', dataDir, '-p', String(port), ...POSTGRES_FLAGS], { env: CHILD_ENV, stdio: ['ignore', 'pipe', 'pipe'] })
    onSpawn(child)
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

/** A cluster this process has started and not yet stopped: what the exit and signal hooks clean up. */
interface Live {
  readonly dir: string
  readonly dataDir: string
  /** The initdb that is creating the data directory, until it exits. */
  initdb: ChildProcess | undefined
  child: ChildProcess | undefined
  /** Set by the first `stop`; every later call waits for the same work. */
  stopping: Promise<void> | undefined
}

const live = new Set<Live>()

/** SIGKILL for every process working in this data directory: initdb, its bootstrap and single-user postgres (see {@link processesUsing}). */
function killProcessesOf(dataDir: string): void {
  for (const pid of processesUsing(dataDir)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Already gone.
    }
  }
}

/** Immediate shutdown (SIGQUIT) of the postmaster, if it is running and is one; then SIGKILL after `graceMs`. Synchronous. */
function killPostmasterSync(c: Live, graceMs: number): void {
  // An initdb still running would go on writing into the directory that is about to be removed, and
  // so would the bootstrap and single-user servers it started (they end when initdb's pipe closes,
  // but not at once).
  if (c.initdb?.pid !== undefined && c.initdb.exitCode === null && c.initdb.signalCode === null) {
    try {
      process.kill(c.initdb.pid, 'SIGKILL')
    } catch {
      // Already gone.
    }
    killProcessesOf(c.dataDir)
  }
  const pids = new Set<number>()
  if (c.child?.pid !== undefined && c.child.exitCode === null && c.child.signalCode === null) pids.add(c.child.pid)
  const fromFile = postmasterPid(c.dataDir)
  if (fromFile !== undefined && isAlive(fromFile) && isPostgresProcess(fromFile)) pids.add(fromFile)
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGQUIT')
    } catch {
      // Already gone.
    }
  }
  for (const pid of pids) {
    for (let waited = 0; isAlive(pid) && waited < graceMs; waited += 50) sleepSync(50)
    if (isAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }
  }
}

/** The last resort when the process ends without `stop()`: the data is throw-away, so no grace. */
function cleanupAllSync(): void {
  for (const c of live) {
    killPostmasterSync(c, 2_000)
    rmSync(c.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  }
  live.clear()
}

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const

function onSignal(signal: (typeof SIGNALS)[number]): void {
  // If something else (vitest, the db:up command) also handles the signal it ends the process
  // itself, after its own teardown; if we are the only handler, the default action (exit by that
  // signal) is what the signal would have done, so do it once the clusters are gone.
  const alone = process.listenerCount(signal) <= 1
  void Promise.allSettled([...live].map((c) => stopLive(c))).then(() => {
    if (!alone) return
    removeHooks()
    process.kill(process.pid, signal)
  })
}

const signalHandlers = new Map<NodeJS.Signals, () => void>()
let hooksInstalled = false

function installHooks(): void {
  if (hooksInstalled) return
  hooksInstalled = true
  process.on('exit', cleanupAllSync)
  for (const signal of SIGNALS) {
    const handler = (): void => onSignal(signal)
    signalHandlers.set(signal, handler)
    process.on(signal, handler)
  }
}

function removeHooks(): void {
  if (!hooksInstalled) return
  hooksInstalled = false
  process.removeListener('exit', cleanupAllSync)
  for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler)
  signalHandlers.clear()
}

/** Stops the postmaster (fast shutdown, then immediate) and deletes the directory. Idempotent: callers share one run. */
function stopLive(c: Live): Promise<void> {
  c.stopping ??= (async () => {
    try {
      const initdb = c.initdb
      if (initdb !== undefined && initdb.exitCode === null && initdb.signalCode === null) {
        const exited = new Promise<void>((resolve) => initdb.once('exit', () => resolve()))
        initdb.kill('SIGKILL')
        await orTimeout(exited, 5_000)
        killProcessesOf(c.dataDir)
      }
      const child = c.child
      if (child !== undefined && child.exitCode === null && child.signalCode === null) {
        const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
        child.kill('SIGINT')
        if ((await orTimeout(exited, 30_000)) === 'timeout') {
          child.kill('SIGQUIT')
          await orTimeout(exited, 5_000)
        }
      } else {
        // No child object (the start failed, or this is the only record): go by the pid file.
        await stopPostmaster(c.dataDir)
      }
    } finally {
      await rm(c.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      live.delete(c)
      if (live.size === 0) removeHooks()
    }
  })()
  return c.stopping
}

/** Added to a start failure on a host whose System V shared memory is the cause. */
function sharedMemoryHint(log: string, bins: Binaries): string {
  if (bins.shm !== 'sysv' || !/shmget|shared memory segment/i.test(log)) return ''
  return (
    "\nThe host's System V shared memory is exhausted (macOS leaks it when a Postgres is killed, and only a reboot frees it)." +
    (bins.shmNote === undefined ? ' Run without HB_PG_SHM=sysv on macOS: the harness then avoids System V shared memory.' : `\n${bins.shmNote}`)
  )
}

/**
 * Starts a fresh cluster. Throws with the server's last log lines if it does not come up. Call
 * `stop()` when done; if the process ends or is killed instead, the hooks, the guard and the reaper
 * (see the header) clean up.
 */
export async function startCluster(options: StartOptions = {}): Promise<Cluster> {
  const baseDir = options.baseDir ?? tmpdir()
  if (options.reap !== false) await reapStaleClusters(baseDir).catch(() => undefined)
  const bins = prepareBinaries()

  const dir = mkdtempSync(join(baseDir, CLUSTER_DIR_PREFIX))
  writeFileSync(join(dir, MARKER_FILE), JSON.stringify({ ownerPid: process.pid, startedAt: new Date().toISOString() }))
  const dataDir = join(dir, 'data')
  const entry: Live = { dir, dataDir, initdb: undefined, child: undefined, stopping: undefined }
  live.add(entry)
  installHooks()
  spawnGuard({ ownerPid: process.pid, dir, prefix: CLUSTER_DIR_PREFIX, marker: MARKER_FILE })

  const password = randomBytes(18).toString('base64url')
  const log = new LogBuffer()

  let child: ChildProcess | undefined
  let port = 0
  try {
    const pwFile = join(dir, 'pwfile')
    writeFileSync(pwFile, `${password}\n`, { mode: 0o600 })
    try {
      await runInitdb(
        bins.initdb,
        ['-D', dataDir, '-U', SUPERUSER, '--auth=scram-sha-256', `--pwfile=${pwFile}`, '--encoding=UTF8', '--locale=C', '--no-sync', ...INITDB_SHARED_MEMORY_FLAGS],
        log,
        (c) => (entry.initdb = c),
      )
    } finally {
      rmSync(pwFile, { force: true })
    }
    for (let attempt = 1; child === undefined; attempt++) {
      port = options.port ?? (await freePort())
      try {
        child = await startPostmaster(bins.postgres, dataDir, port, log, (c) => (entry.child = c))
      } catch (e) {
        // A port taken between our probe and the server's bind: try another one.
        if (options.port === undefined && attempt < 4 && /address already in use/i.test(log.tail())) continue
        throw e
      }
    }
  } catch (e) {
    await stopLive(entry).catch(() => undefined)
    throw new Error(`Local Postgres failed to start: ${e instanceof Error ? e.message : String(e)}\n${log.tail()}${sharedMemoryHint(log.tail(), bins)}`, { cause: e })
  }

  return {
    host: HOST,
    port,
    password,
    dir,
    logTail: () => log.tail(),
    stop: () => stopLive(entry),
  }
}
