/**
 * Postgres without the host's System V IPC (ROADMAP M2.0, A6).
 *
 * The problem. A Postgres server asks the kernel for System V IPC even when its real shared memory is
 * an anonymous mmap: one 56-byte segment that locks the data directory, and, on macOS, its process
 * semaphores. macOS leaks the kernel's accounting of those objects when a postmaster is killed
 * (`ipcs` shows nothing for the segments, but `kern.sysv.shmall` stays used up; the semaphore sets
 * stay listed for good, because their keys come from the data directory's inode, new for every run),
 * after which every `shmget()` fails with ENOMEM and so does `initdb`, until the machine reboots. The
 * workflow watchdog kills runs with SIGKILL, so on an autonomous Mac that is a matter of time; and
 * `shmmni` is only 32 segments for all the runs at once. Setting `shared_memory_type=mmap` does not
 * help (checked: `shmget(key, size=56)` still fails), and raising the limits needs root and a reboot.
 * PGlite has no `statement_timeout` and one session, so it cannot run the suite (supabase/README.md,
 * ADR M2.0).
 *
 * The fix, macOS only. The server gets its seven System V calls (shmget, shmat, shmdt, shmctl, semget,
 * semop, semctl) from a tiny library (shm/hb_shm_shim.c) that backs them with anonymous shared
 * mappings, which the kernel releases when the process dies. It is loaded with
 * `DYLD_INSERT_LIBRARIES`, and macOS honours that only for binaries without the hardened runtime, so
 * a COPY of `postgres` is re-signed ad hoc (the npm package's own files are never changed). `initdb`
 * starts `postgres` through `/bin/sh`, which strips `DYLD_*` from the environment, so the copy sits
 * behind a two-line wrapper script that sets the variable itself with `env`. The result is an overlay
 * of the package's `native/` directory:
 *
 *   <cache>/<key>/libhbshm.dylib     the shim, built with the system `cc` (Xcode command line tools),
 *                                    with a slice for every architecture the `postgres` binary has
 *   <cache>/<key>/bin/initdb         a copy (its signature stays valid; it needs no shim itself)
 *   <cache>/<key>/bin/postgres       the wrapper: initdb finds `postgres` next to itself
 *   <cache>/<key>/bin/postgres.real  the re-signed copy
 *   <cache>/<key>/lib, share         symlinks into the package
 *
 * Every slice, because the binaries are universal (x86_64 and arm64) and the kernel, not this code,
 * picks the slice: a process started under Rosetta (an x86_64 python or shell above the test run)
 * starts the x86_64 slice of `postgres`, which cannot load an arm64-only library.
 *
 * `<key>` hashes the shim source, the architectures and the binaries (size, mtime, package version),
 * so an upgrade or an edit builds a new overlay. Builds go to a temp directory and are renamed into
 * place, so concurrent runs (several agents, several test processes) never see half an overlay.
 *
 * What is run is trusted only if it is ours: the cache directory and everything in the overlay must be
 * owned by the current user and not writable by anyone else, and not be symbolic links. Otherwise the
 * directory is skipped (cache) or rebuilt (overlay). Overlays of other keys that are a week old are
 * removed after a build.
 *
 * Linux has none of this problem (large kernel limits, nothing leaks), so nothing is built there.
 */

import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync, type Stats } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAlive } from './proc'

/** The C source of the shared-memory shim. */
export const SHIM_SOURCE = fileURLToPath(new URL('./shm/hb_shm_shim.c', import.meta.url))

/** Bump when the build recipe below changes, so old overlays are not reused. */
const RECIPE = 'v2'
const READY = 'READY'
const DYLIB = 'libhbshm.dylib'
const BUILD_PREFIX = '.build-'
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** The package's own `native/` directory: what the overlay is made from. */
export interface RealBinaries {
  readonly root: string
  readonly initdb: string
  readonly postgres: string
}

export interface ShimmedBinaries {
  /** The overlay directory (`<cache>/<key>`). */
  readonly dir: string
  readonly initdb: string
  /** The wrapper script: run this, not `postgres.real`. */
  readonly postgres: string
  readonly dylib: string
  /** False when an overlay that was already there is reused. */
  readonly built: boolean
}

export interface ShimOptions {
  /** Where overlays are cached, in order of preference; the first one that can be used is used. */
  readonly cacheDirs: readonly string[]
  /** The architectures to build the library for (`arm64`, `x86_64`). Default: every slice of the `postgres` binary. */
  readonly archs?: readonly string[]
  /** Overlays of other keys whose build is older than this are removed after a build. Default one week. */
  readonly pruneAfterMs?: number
}

/**
 * What `postgres` becomes inside the overlay. It sets the variable itself, with `env`, because the
 * `/bin/sh` that `initdb` starts it through removes `DYLD_*` from its own environment (System
 * Integrity Protection) but does pass what is on a command line; `exec` keeps the pid, so the
 * postmaster's pid file and signals are the real server's.
 */
export const WRAPPER_SCRIPT = `#!/bin/sh
# Generated by web/scripts/db/shm.ts: runs the re-signed postgres with the System V shared-memory shim.
here=$(cd "$(dirname "$0")" && pwd -P) || exit 127
exec /usr/bin/env "DYLD_INSERT_LIBRARIES=\${here%/bin}/${DYLIB}" "$here/postgres.real" "$@"
`

const CPU_TYPE_X86_64 = 0x01000007
const CPU_TYPE_ARM64 = 0x0100000c
const CPU_SUBTYPE_MASK = 0x00ffffff
const CPU_SUBTYPE_ARM64E = 2

function archOf(cpuType: number, cpuSubtype: number, file: string): string {
  if (cpuType === CPU_TYPE_X86_64) return 'x86_64'
  if (cpuType === CPU_TYPE_ARM64 && (cpuSubtype & CPU_SUBTYPE_MASK) !== CPU_SUBTYPE_ARM64E) return 'arm64'
  throw new Error(`${file} has a slice (cpu type 0x${(cpuType >>> 0).toString(16)}, subtype ${cpuSubtype & CPU_SUBTYPE_MASK}) that the shared-memory shim cannot be built for; it supports x86_64 and arm64.`)
}

/**
 * The architectures in the header of a Mach-O file, as the C compiler names them (`arm64`,
 * `x86_64`), sorted: a universal ("fat") file lists one per slice, a thin one has one. Throws for
 * anything else.
 */
export function parseMachoArchs(head: Buffer, file = 'the binary'): string[] {
  const archs: string[] = []
  if (head.length >= 8 && (head.readUInt32BE(0) === 0xcafebabe || head.readUInt32BE(0) === 0xcafebabf)) {
    const wide = head.readUInt32BE(0) === 0xcafebabf
    const size = wide ? 32 : 20
    const count = head.readUInt32BE(4)
    if (count < 1 || count > 16 || 8 + count * size > head.length) throw new Error(`${file} has an unreadable universal header (${count} slices).`)
    for (let i = 0; i < count; i++) archs.push(archOf(head.readInt32BE(8 + i * size), head.readInt32BE(12 + i * size), file))
  } else if (head.length >= 12 && head.readUInt32LE(0) === 0xfeedfacf) {
    archs.push(archOf(head.readInt32LE(4), head.readInt32LE(8), file))
  } else {
    throw new Error(`${file} is not a 64-bit Mach-O file.`)
  }
  return [...new Set(archs)].sort()
}

/** {@link parseMachoArchs} of a file on disk. */
export function machoArchs(file: string): string[] {
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(4096)
    return parseMachoArchs(buf.subarray(0, readSync(fd, buf, 0, buf.length, 0)), file)
  } finally {
    closeSync(fd)
  }
}

/** The cache key for these binaries (16 hex characters). */
export function shimKey(real: RealBinaries, archs: readonly string[] = machoArchs(real.postgres)): string {
  const h = createHash('sha256')
  h.update(RECIPE).update('\0').update([...archs].sort().join(',')).update('\0').update(readFileSync(SHIM_SOURCE))
  for (const file of [real.postgres, real.initdb]) {
    const s = statSync(file)
    h.update('\0').update(`${file}:${s.size}:${Math.round(s.mtimeMs)}`)
  }
  try {
    h.update('\0').update(readFileSync(join(real.root, '..', 'package.json')))
  } catch {
    // The package.json only adds to the key.
  }
  return h.digest('hex').slice(0, 16)
}

function overlayAt(dir: string, built: boolean): ShimmedBinaries {
  return { dir, initdb: join(dir, 'bin', 'initdb'), postgres: join(dir, 'bin', 'postgres'), dylib: join(dir, DYLIB), built }
}

/**
 * Whether this path is a real directory or regular file (not a symbolic link) that belongs to the
 * current user and that nobody else can write to. What is run from the cache has to pass this.
 */
function isOurs(path: string, kind: 'dir' | 'file'): boolean {
  let st: Stats
  try {
    st = lstatSync(path)
  } catch {
    return false
  }
  if (kind === 'dir' ? !st.isDirectory() : !st.isFile()) return false
  const uid = process.getuid?.()
  if (uid !== undefined && st.uid !== uid) return false
  return (st.mode & 0o022) === 0
}

function isBuilt(dir: string): boolean {
  const files = [READY, DYLIB, join('bin', 'initdb'), join('bin', 'postgres'), join('bin', 'postgres.real')]
  return isOurs(dir, 'dir') && isOurs(join(dir, 'bin'), 'dir') && files.every((f) => isOurs(join(dir, f), 'file')) && existsSync(join(dir, 'lib')) && existsSync(join(dir, 'share'))
}

function exists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/** Makes the cache directory if needed (private to the user) and refuses one that is not ours. */
function prepareCacheDir(dir: string): void {
  mkdirSync(dirname(dir), { recursive: true })
  try {
    mkdirSync(dir, { mode: 0o700 })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
  }
  if (!isOurs(dir, 'dir')) throw new Error(`cache directory ${dir} is not a directory of yours, or somebody else can write to it`)
}

function run(file: string, args: readonly string[], what: string): string {
  try {
    return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 })
  } catch (e) {
    const err = e as Error & { stderr?: string; code?: string }
    const detail = (err.stderr ?? '').trim() || err.message
    if (err.code === 'ENOENT') throw new Error(`${what}: \`${file}\` was not found. On macOS install the command line tools: xcode-select --install`, { cause: e })
    throw new Error(`${what} failed: ${detail}`, { cause: e })
  }
}

/** Removes `.build-<pid>-…` directories whose builder died. */
function sweepStaleBuilds(cacheDir: string): void {
  for (const name of readdirSync(cacheDir)) {
    if (!name.startsWith(BUILD_PREFIX)) continue
    const pid = Number.parseInt(name.slice(BUILD_PREFIX.length), 10)
    if (Number.isInteger(pid) && !isAlive(pid)) rmSync(join(cacheDir, name), { recursive: true, force: true })
  }
}

/** Removes finished overlays of other keys (an older package version, an older shim) once they are `olderThanMs` old. */
function pruneOldOverlays(cacheDir: string, keep: string, olderThanMs: number): void {
  for (const name of readdirSync(cacheDir)) {
    if (name === keep || !/^[0-9a-f]{16}$/.test(name)) continue
    const dir = join(cacheDir, name)
    try {
      if (!isOurs(dir, 'dir') || Date.now() - lstatSync(join(dir, READY)).mtimeMs < olderThanMs) continue
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Another process got there first, or it is not a finished overlay: leave it.
    }
  }
}

function assemble(dir: string, real: RealBinaries, archs: readonly string[]): void {
  mkdirSync(join(dir, 'bin'), { mode: 0o755 })
  const cc = process.env.CC ?? 'cc'
  run(cc, ['-O2', '-Wall', '-Wextra', '-dynamiclib', ...archs.flatMap((a) => ['-arch', a]), '-o', join(dir, DYLIB), SHIM_SOURCE], 'Building the shared-memory shim')

  copyFileSync(real.initdb, join(dir, 'bin', 'initdb'))
  copyFileSync(real.postgres, join(dir, 'bin', 'postgres.real'))
  // Explicit modes, so that the umask of whoever builds cannot make anything group-writable.
  for (const exe of ['bin/initdb', 'bin/postgres.real', DYLIB]) chmodSync(join(dir, exe), 0o755)
  // Ad hoc, without the hardened runtime the npm package's signature carries: only then does macOS
  // honour DYLD_INSERT_LIBRARIES for this binary.
  run('/usr/bin/codesign', ['--force', '--sign', '-', join(dir, 'bin', 'postgres.real')], 'Re-signing the postgres copy')

  symlinkSync(join(real.root, 'lib'), join(dir, 'lib'))
  symlinkSync(join(real.root, 'share'), join(dir, 'share'))
  writeFileSync(join(dir, 'bin', 'postgres'), WRAPPER_SCRIPT, { mode: 0o755 })
  chmodSync(join(dir, 'bin', 'postgres'), 0o755)

  verifyShimmed({ dir, initdb: join(dir, 'bin', 'initdb'), postgres: join(dir, 'bin', 'postgres'), dylib: join(dir, DYLIB), built: true })
  writeFileSync(join(dir, READY), `${new Date().toISOString()}\n`, { mode: 0o644 })
  chmodSync(join(dir, READY), 0o644)
}

/**
 * Starts the overlay's `postgres` once (`-V`) the way the server will be started, in this process's
 * environment (this process's architecture preference included), and throws with what dyld or the
 * shell said if it does not run: a library that cannot be loaded, a missing slice, a damaged copy.
 */
export function verifyShimmed(shim: ShimmedBinaries): void {
  const version = run(shim.postgres, ['-V'], 'Running the shimmed postgres')
  if (!version.includes('PostgreSQL')) throw new Error(`Running the shimmed postgres printed ${JSON.stringify(version)}`)
}

/**
 * Builds the overlay for these binaries, or returns the one already built. Safe to call from
 * several processes at once. Throws, with the compiler's or codesign's message, if it cannot.
 */
export function buildShimmedBinaries(real: RealBinaries, options: ShimOptions): ShimmedBinaries {
  const archs = [...new Set(options.archs ?? machoArchs(real.postgres))].sort()
  const key = shimKey(real, archs)
  let cannotCreate: unknown
  for (const cacheDir of options.cacheDirs) {
    // DYLD_INSERT_LIBRARIES is a colon-separated list.
    if (cacheDir.includes(':')) {
      cannotCreate = new Error(`cache directory ${cacheDir} contains a colon`)
      continue
    }
    const final = join(cacheDir, key)
    let tmp: string
    try {
      prepareCacheDir(cacheDir)
      if (isBuilt(final)) return overlayAt(final, false)
      sweepStaleBuilds(cacheDir)
      tmp = join(cacheDir, `${BUILD_PREFIX}${process.pid}-${randomBytes(4).toString('hex')}`)
      mkdirSync(tmp, { mode: 0o755 })
    } catch (e) {
      cannotCreate = e
      continue
    }
    try {
      assemble(tmp, real, archs)
      // The cache directory is ours alone, so whatever sits under this key without being a finished,
      // trusted overlay (damaged, or planted) is ours to replace.
      if (exists(final) && !isBuilt(final)) rmSync(final, { recursive: true, force: true })
      try {
        renameSync(tmp, final)
      } catch (e) {
        // Another process renamed its identical build first.
        if (!isBuilt(final)) throw e
        rmSync(tmp, { recursive: true, force: true })
        return overlayAt(final, false)
      }
      pruneOldOverlays(cacheDir, key, options.pruneAfterMs ?? WEEK_MS)
      return overlayAt(final, true)
    } catch (e) {
      rmSync(tmp, { recursive: true, force: true })
      throw e
    }
  }
  throw new Error(`No usable directory for the shared-memory shim (tried ${options.cacheDirs.join(', ')}).`, { cause: cannotCreate })
}
