/**
 * The System V shared-memory and semaphore shim and the choice of binaries (ROADMAP M2.0), without
 * starting a database: the macOS-only build (a C library with a slice for every architecture of
 * postgres, a re-signed copy of postgres, a wrapper), its cache and what it trusts, and C probes that
 * check the library does what Postgres asks of the seven calls it replaces, including that a forked
 * child sees the same memory, in both architectures where the machine can run them. `npm run test:db`
 * starts real clusters through it (shim.db.test.ts checks that the server then holds no System V
 * segment and no semaphore set).
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prepareBinaries } from './engine'
import { semaphoreSetsOfInode, sysvKeys } from './ipc'
import { SHIM_SOURCE, WRAPPER_SCRIPT, buildShimmedBinaries, machoArchs, parseMachoArchs, shimKey, type RealBinaries } from './shm'

const WEB = fileURLToPath(new URL('../../', import.meta.url))
const darwin = platform() === 'darwin'

let scratch: string
let real: RealBinaries

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'hb-shm-test-'))
  real = prepareBinaries({ shm: 'sysv' })
})
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

/** A cache directory of its own for one test. */
function cache(name: string): string {
  return join(scratch, name)
}

/** A pid that was alive and is not any more. */
function deadPid(): number {
  return Number(execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }))
}

describe('prepareBinaries: which binaries run', () => {
  const originalEnv = process.env.HB_PG_SHM
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.HB_PG_SHM
    else process.env.HB_PG_SHM = originalEnv
    vi.restoreAllMocks()
  })

  it('runs the package binaries as they are on Linux, with the host\'s System V shared memory', () => {
    const b = prepareBinaries({ platform: 'linux' })
    expect(b).toEqual({ root: real.root, initdb: real.initdb, postgres: real.postgres, shm: 'sysv' })
  })

  it('runs them as they are anywhere when HB_PG_SHM=sysv', () => {
    process.env.HB_PG_SHM = 'sysv'
    expect(prepareBinaries({ platform: 'darwin' })).toMatchObject({ initdb: real.initdb, postgres: real.postgres, shm: 'sysv' })
  })

  it('refuses an HB_PG_SHM it does not know, and `shim` where there is nothing to shim', () => {
    process.env.HB_PG_SHM = 'maybe'
    expect(() => prepareBinaries({ platform: 'darwin' })).toThrow(/HB_PG_SHM must be auto, sysv or shim, not "maybe"/)
    delete process.env.HB_PG_SHM
    expect(() => prepareBinaries({ platform: 'linux', shm: 'shim' })).toThrow(/macOS/)
  })

  // Building the shim needs the macOS toolchain; elsewhere it fails before the directory check.
  it.skipIf(process.platform !== 'darwin')('on macOS falls back to the host\'s shared memory, with a note and a warning, if the shim cannot be built; `shim` fails instead', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    // A cache "directory" below a regular file can never be created.
    const file = join(scratch, 'a-file')
    writeFileSync(file, 'not a directory')
    const unusable = [join(file, 'cache')]
    const b = prepareBinaries({ platform: 'darwin', cacheDirs: unusable })
    expect(b.shm).toBe('sysv')
    expect(b.initdb).toBe(real.initdb)
    expect(b.shmNote).toMatch(/shim could not be built.*No usable directory/)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(() => prepareBinaries({ platform: 'darwin', shm: 'shim', cacheDirs: unusable })).toThrow(/No usable directory/)
  })

  it.skipIf(!darwin)('on macOS also falls back, with the note, when a cached overlay is there but does not run; `shim` fails instead', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const dir = cache('does-not-run')
    const built = buildShimmedBinaries(real, { cacheDirs: [dir] })
    // The kind of damage the architecture mismatch made: dyld cannot load the inserted library.
    writeFileSync(built.dylib, 'not a library')
    chmodSync(built.dylib, 0o755)
    const b = prepareBinaries({ platform: 'darwin', cacheDirs: [dir] })
    expect(b.shm).toBe('sysv')
    expect(b.initdb).toBe(real.initdb)
    expect(b.shmNote).toMatch(/does not run.*Running the shimmed postgres failed/s)
    expect(() => prepareBinaries({ platform: 'darwin', shm: 'shim', cacheDirs: [dir] })).toThrow(/Running the shimmed postgres failed/)
  }, 120_000)

  it.skipIf(!darwin)('on macOS builds the shim by default and runs the overlay\'s initdb and postgres', () => {
    delete process.env.HB_PG_SHM
    const b = prepareBinaries()
    expect(b.shm).toBe('shim')
    expect(b.shmNote).toBeUndefined()
    expect(b.root).toBe(real.root)
    expect(b.initdb).toMatch(/humanbench-pg\/[0-9a-f]{16}\/bin\/initdb$/)
    expect(b.postgres).toMatch(/humanbench-pg\/[0-9a-f]{16}\/bin\/postgres$/)
    expect(prepareBinaries()).toBe(b)
  })
})

describe('the wrapper script', () => {
  it('is valid shell, sets the library with env (the /bin/sh that initdb uses would strip it) and keeps the pid', () => {
    const file = join(scratch, 'wrapper.sh')
    writeFileSync(file, WRAPPER_SCRIPT)
    execFileSync('/bin/sh', ['-n', file])
    expect(WRAPPER_SCRIPT.startsWith('#!/bin/sh\n')).toBe(true)
    expect(WRAPPER_SCRIPT).toMatch(/^exec \/usr\/bin\/env "DYLD_INSERT_LIBRARIES=\$\{here%\/bin\}\/libhbshm\.dylib" "\$here\/postgres\.real" "\$@"$/m)
  })
})

describe('shimKey', () => {
  it('is 16 hex characters, stable, independent of the order of the architectures, and different for another set', () => {
    const key = shimKey(real, ['arm64', 'x86_64'])
    expect(key).toMatch(/^[0-9a-f]{16}$/)
    expect(shimKey(real, ['arm64', 'x86_64'])).toBe(key)
    expect(shimKey(real, ['x86_64', 'arm64'])).toBe(key)
    expect(shimKey(real, ['arm64'])).not.toBe(key)
    expect(shimKey(real, ['x86_64'])).not.toBe(key)
  })

  it('by default uses the architectures of the postgres binary', () => {
    if (darwin) expect(shimKey(real)).toBe(shimKey(real, machoArchs(real.postgres)))
    else expect(shimKey(real, ['arm64'])).toMatch(/^[0-9a-f]{16}$/)
  })

  it('reads the shim source, so editing it builds a new overlay', () => {
    expect(readFileSync(SHIM_SOURCE, 'utf8')).toContain('hb_shmget')
  })
})

/** A Mach-O header: thin (little endian, 64-bit) or universal (big endian) with one entry per cpu type. */
function machoHeader(kind: 'thin' | 'fat' | 'fat64', cpus: readonly [number, number][]): Buffer {
  const b = Buffer.alloc(4096)
  if (kind === 'thin') {
    b.writeUInt32LE(0xfeedfacf, 0)
    b.writeInt32LE((cpus[0] as [number, number])[0], 4)
    b.writeInt32LE((cpus[0] as [number, number])[1], 8)
    return b
  }
  b.writeUInt32BE(kind === 'fat' ? 0xcafebabe : 0xcafebabf, 0)
  b.writeUInt32BE(cpus.length, 4)
  const size = kind === 'fat' ? 20 : 32
  cpus.forEach(([type, sub], i) => {
    b.writeInt32BE(type, 8 + i * size)
    b.writeInt32BE(sub, 12 + i * size)
  })
  return b
}

const X86_64 = 0x01000007
const ARM64 = 0x0100000c

describe('parseMachoArchs', () => {
  it('lists the slices of a universal file and the one architecture of a thin file, sorted', () => {
    expect(parseMachoArchs(machoHeader('fat', [[X86_64, 3], [ARM64, 0]]))).toEqual(['arm64', 'x86_64'])
    expect(parseMachoArchs(machoHeader('fat', [[ARM64, 0], [X86_64, 3]]))).toEqual(['arm64', 'x86_64'])
    expect(parseMachoArchs(machoHeader('fat64', [[ARM64, 0]]))).toEqual(['arm64'])
    expect(parseMachoArchs(machoHeader('thin', [[X86_64, 3]]))).toEqual(['x86_64'])
    expect(parseMachoArchs(machoHeader('thin', [[ARM64, 0]]))).toEqual(['arm64'])
  })

  it('refuses what the shim cannot be built for, and what is not Mach-O', () => {
    expect(() => parseMachoArchs(machoHeader('thin', [[ARM64, 2]]), 'pg')).toThrow(/pg has a slice .* cannot be built for/)
    expect(() => parseMachoArchs(machoHeader('fat', [[X86_64, 3], [0x0c, 9]]))).toThrow(/cannot be built for/)
    expect(() => parseMachoArchs(Buffer.from('#!/bin/sh\n'))).toThrow(/not a 64-bit Mach-O/)
    expect(() => parseMachoArchs(Buffer.alloc(0))).toThrow(/not a 64-bit Mach-O/)
    const absurd = machoHeader('fat', [])
    absurd.writeUInt32BE(5000, 4)
    expect(() => parseMachoArchs(absurd)).toThrow(/unreadable universal header/)
  })

  it.skipIf(!darwin)('reads the real binary, which is universal on the npm packages for macOS', () => {
    const archs = machoArchs(real.postgres)
    expect(archs.length).toBeGreaterThanOrEqual(1)
    expect(archs).toEqual(execFileSync('lipo', ['-archs', real.postgres], { encoding: 'utf8' }).trim().split(/\s+/).sort())
    expect(machoArchs(real.initdb)).toEqual(archs)
  })
})

describe.skipIf(!darwin)('buildShimmedBinaries (macOS)', () => {
  it('builds the overlay: the library, a copy of initdb, the wrapper, the re-signed postgres, and links to lib and share', () => {
    const dir = cache('layout')
    const out = buildShimmedBinaries(real, { cacheDirs: [dir] })
    expect(out.built).toBe(true)
    expect(out.dir.startsWith(dir)).toBe(true)
    for (const f of ['libhbshm.dylib', 'READY', 'bin/initdb', 'bin/postgres', 'bin/postgres.real']) expect(existsSync(join(out.dir, f)), f).toBe(true)
    for (const exe of ['bin/initdb', 'bin/postgres', 'bin/postgres.real']) expect(statSync(join(out.dir, exe)).mode & 0o111, exe).not.toBe(0)
    for (const link of ['lib', 'share']) expect(lstatSync(join(out.dir, link)).isSymbolicLink(), link).toBe(true)
    expect(readFileSync(out.postgres, 'utf8')).toBe(WRAPPER_SCRIPT)
    // The package's own files are untouched: still the vendor's signature, with the hardened runtime.
    const signature = (file: string): string => spawnSync('/usr/bin/codesign', ['-dv', file], { encoding: 'utf8' }).stderr
    expect(signature(real.postgres)).toContain('(runtime)')
    expect(signature(real.postgres)).not.toContain('adhoc')
    expect(signature(join(out.dir, 'bin', 'postgres.real'))).toContain('adhoc')
    expect(signature(join(out.dir, 'bin', 'postgres.real'))).not.toContain('(runtime)')
  }, 120_000)

  it('runs: the wrapper starts the copy, also behind /bin/sh as initdb does', () => {
    const out = buildShimmedBinaries(real, { cacheDirs: [cache('layout')] })
    expect(execFileSync(out.postgres, ['-V'], { encoding: 'utf8' })).toMatch(/^postgres \(PostgreSQL\) 17\./)
    expect(execFileSync('/bin/sh', ['-c', `"${out.postgres}" -V`], { encoding: 'utf8' })).toMatch(/^postgres \(PostgreSQL\) 17\./)
    expect(execFileSync(out.initdb, ['--version'], { encoding: 'utf8' })).toMatch(/^initdb \(PostgreSQL\) 17\./)
  })

  it('builds the library for every architecture of postgres, and each of them runs (also under Rosetta, where there is one)', () => {
    const out = buildShimmedBinaries(real, { cacheDirs: [cache('layout')] })
    const archs = machoArchs(real.postgres)
    expect(execFileSync('lipo', ['-archs', out.dylib], { encoding: 'utf8' }).trim().split(/\s+/).sort()).toEqual(archs)
    expect(execFileSync('lipo', ['-archs', join(out.dir, 'bin', 'postgres.real')], { encoding: 'utf8' }).trim().split(/\s+/).sort()).toEqual(archs)
    // The kernel picks the slice of a universal binary by the architecture preference of the process above:
    // start the wrapper under each of them that this machine can run.
    let ran = 0
    for (const arch of archs) {
      const name = arch === 'x86_64' ? 'x86_64' : 'arm64'
      if (spawnSync('/usr/bin/arch', [`-${name}`, '/usr/bin/true']).status !== 0) continue
      expect(execFileSync('/usr/bin/arch', [`-${name}`, out.postgres, '-V'], { encoding: 'utf8' }), name).toMatch(/PostgreSQL\) 17\./)
      expect(execFileSync('/usr/bin/arch', [`-${name}`, '/bin/sh', '-c', `"${out.postgres}" -V`], { encoding: 'utf8' }), name).toMatch(/PostgreSQL\) 17\./)
      ran++
    }
    expect(ran).toBeGreaterThanOrEqual(1)
  }, 120_000)

  it('never keeps an overlay whose library lacks the slice that this process tree starts: the build fails with what dyld said', () => {
    const dir = cache('one-arch')
    // The architecture a universal program gets here (the kernel's choice, which a Rosetta shell above can change), and the other one.
    const started = execFileSync('/usr/bin/uname', ['-m'], { encoding: 'utf8' }).trim()
    const other = started === 'arm64' ? 'x86_64' : 'arm64'
    if (!machoArchs(real.postgres).includes(other)) return
    expect(() => buildShimmedBinaries(real, { cacheDirs: [dir], archs: [other] })).toThrow(/Running the shimmed postgres failed.*(incompatible architecture|could not be loaded)/s)
    expect(readdirSync(dir)).toEqual([])
  }, 120_000)

  it('reuses what is built, replaces a damaged overlay, and sweeps the leftovers of dead builders', () => {
    const dir = cache('reuse')
    const first = buildShimmedBinaries(real, { cacheDirs: [dir] })
    expect(first.built).toBe(true)
    expect(buildShimmedBinaries(real, { cacheDirs: [dir] })).toEqual({ ...first, built: false })

    rmSync(join(first.dir, 'READY'))
    const dead = join(dir, `.build-${deadPid()}-abcd`)
    const alive = join(dir, `.build-${process.pid}-abcd`)
    mkdirSync(dead)
    mkdirSync(alive)
    const again = buildShimmedBinaries(real, { cacheDirs: [dir] })
    expect(again).toEqual({ ...first, built: true })
    expect(existsSync(join(again.dir, 'READY'))).toBe(true)
    expect(existsSync(dead)).toBe(false)
    expect(existsSync(alive)).toBe(true)
    expect(readdirSync(dir).filter((n) => n.startsWith('.build-') && n !== `.build-${process.pid}-abcd`)).toEqual([])
  }, 120_000)

  it('does not run what is not its own: a group- or world-writable file, a symlink, or a cache directory others can write to is replaced or skipped', () => {
    const dir = cache('trust')
    const first = buildShimmedBinaries(real, { cacheDirs: [dir] })
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(statSync(first.dir).mode & 0o022).toBe(0)
    for (const f of ['libhbshm.dylib', 'READY', 'bin/initdb', 'bin/postgres', 'bin/postgres.real']) expect(statSync(join(first.dir, f)).mode & 0o022, f).toBe(0)

    // A file somebody else could have changed: the overlay is not trusted, so it is built again.
    chmodSync(first.postgres, 0o777)
    const second = buildShimmedBinaries(real, { cacheDirs: [dir] })
    expect(second.built).toBe(true)
    expect(statSync(second.postgres).mode & 0o022).toBe(0)

    // A symbolic link in place of a file (a planted program): the same.
    rmSync(second.postgres)
    symlinkSync('/usr/bin/true', second.postgres)
    const third = buildShimmedBinaries(real, { cacheDirs: [dir] })
    expect(third.built).toBe(true)
    expect(lstatSync(third.postgres).isSymbolicLink()).toBe(false)
    expect(readFileSync(third.postgres, 'utf8')).toBe(WRAPPER_SCRIPT)

    // A cache directory others can write to is never used: the next one is.
    chmodSync(dir, 0o777)
    const next = buildShimmedBinaries(real, { cacheDirs: [dir, cache('trust-next')] })
    expect(next.dir.startsWith(cache('trust-next'))).toBe(true)
    expect(() => buildShimmedBinaries(real, { cacheDirs: [dir] })).toThrow(/No usable directory/)
    chmodSync(dir, 0o700)
    // ... nor one that is a symbolic link to somewhere.
    symlinkSync(dir, cache('trust-link'))
    expect(() => buildShimmedBinaries(real, { cacheDirs: [cache('trust-link')] })).toThrow(/No usable directory/)
  }, 180_000)

  it('removes overlays of other keys once they are old, and nothing else', () => {
    const dir = cache('prune')
    mkdirSync(dir, { mode: 0o700 })
    const longAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000)
    const old = join(dir, '0123456789abcdef')
    const young = join(dir, 'fedcba9876543210')
    const unfinished = join(dir, 'aaaaaaaaaaaaaaaa')
    const unrelated = join(dir, 'notes')
    for (const d of [old, young, unfinished, unrelated]) mkdirSync(d)
    for (const d of [old, young]) writeFileSync(join(d, 'READY'), 'x')
    utimesSync(join(old, 'READY'), longAgo, longAgo)
    const out = buildShimmedBinaries(real, { cacheDirs: [dir] })
    expect(out.built).toBe(true)
    expect(existsSync(old)).toBe(false)
    for (const kept of [young, unfinished, unrelated, out.dir]) expect(existsSync(kept), kept).toBe(true)
  }, 120_000)

  it('moves on to the next cache directory when the first cannot be created', () => {
    const file = join(scratch, 'blocker')
    writeFileSync(file, 'x')
    const out = buildShimmedBinaries(real, { cacheDirs: [join(file, 'cache'), cache('second')] })
    expect(out.dir.startsWith(cache('second'))).toBe(true)
  }, 120_000)

  it('names the fix when there is no C compiler', () => {
    const before = process.env.CC
    process.env.CC = '/nonexistent/cc'
    try {
      expect(() => buildShimmedBinaries(real, { cacheDirs: [cache('no-cc')] })).toThrow(/xcode-select --install/)
      expect(readdirSync(cache('no-cc')).filter((n) => n.startsWith('.build-'))).toEqual([])
    } finally {
      if (before === undefined) delete process.env.CC
      else process.env.CC = before
    }
  })

  it('survives several processes building the same overlay at once: one result, no leftovers', async () => {
    const dir = cache('race')
    const script = `
      const { buildShimmedBinaries } = await import('./scripts/db/shm.ts')
      const { prepareBinaries } = await import('./scripts/db/engine.ts')
      const out = buildShimmedBinaries(prepareBinaries({ shm: 'sysv' }), { cacheDirs: [process.argv[1]] })
      console.log(JSON.stringify(out))
    `
    const runs = await Promise.all(
      Array.from(
        { length: 4 },
        () =>
          new Promise<{ dir: string; built: boolean }>((resolve, reject) => {
            const child = spawn(process.execPath, ['--import', 'tsx', '-e', script, dir], { cwd: WEB, stdio: ['ignore', 'pipe', 'pipe'] })
            let out = ''
            let err = ''
            child.stdout.on('data', (d) => (out += String(d)))
            child.stderr.on('data', (d) => (err += String(d)))
            child.on('exit', (code) => (code === 0 ? resolve(JSON.parse(out) as { dir: string; built: boolean }) : reject(new Error(`builder exited ${code}: ${err}`))))
          }),
      ),
    )
    expect(new Set(runs.map((r) => r.dir)).size).toBe(1)
    expect(runs.some((r) => r.built)).toBe(true)
    expect(readdirSync(dir).filter((n) => n.startsWith('.build-'))).toEqual([])
    expect(readdirSync(dir)).toHaveLength(1)
    expect(execFileSync(join(runs[0]?.dir as string, 'bin', 'postgres'), ['-V'], { encoding: 'utf8' })).toContain('PostgreSQL')
  }, 180_000)
})

/** What Postgres asks of the four calls, as a C program. It first checks that the shim is loaded, so it never reaches the kernel's own. */
const PROBE = String.raw`
#include <dlfcn.h>
#include <errno.h>
#include <stdio.h>
#include <sys/ipc.h>
#include <sys/shm.h>
#include <sys/wait.h>
#include <unistd.h>

int main(void) {
  if (dlsym(RTLD_DEFAULT, "hb_shm_shim_loaded") == NULL) { puts("shim not loaded"); return 10; }
  key_t key = 0x48420001;
  int id = shmget(key, 100, IPC_CREAT | IPC_EXCL | 0600);
  if (id < 0) { printf("shmget failed: errno %d\n", errno); return 1; }
  if (shmget(key, 100, IPC_CREAT | IPC_EXCL | 0600) != -1 || errno != EEXIST) { puts("IPC_EXCL on a taken key must be EEXIST"); return 2; }
  if (shmget(key + 1, 64, 0) != -1 || errno != ENOENT) { puts("a key nobody created must be ENOENT"); return 3; }
  if (shmget(key, 64, 0) != id) { puts("a lookup by key must find the segment"); return 4; }
  char *p = shmat(id, NULL, 0);
  if (p == (void *)-1) { puts("shmat failed"); return 5; }
  struct shmid_ds ds;
  if (shmctl(id, IPC_STAT, &ds) != 0 || ds.shm_nattch != 1 || ds.shm_segsz < 100 || ds.shm_perm.uid != geteuid()) { puts("IPC_STAT: size, attach count or owner wrong"); return 6; }
  p[0] = 1;
  pid_t child = fork();
  if (child < 0) { puts("fork failed"); return 7; }
  if (child == 0) { p[0] = 42; _exit(0); }
  int status = 0;
  waitpid(child, &status, 0);
  if (p[0] != 42) { puts("a forked child must share the memory"); return 8; }
  if (shmctl(id, IPC_RMID, NULL) != 0) { puts("IPC_RMID failed"); return 9; }
  if (shmget(key, 64, 0) != -1 || errno != ENOENT) { puts("a removed segment must not be found by key"); return 11; }
  p[1] = 2;
  if (shmdt(p) != 0) { puts("shmdt failed"); return 12; }
  if (shmdt(p) != -1 || errno != EINVAL) { puts("a second shmdt must be EINVAL"); return 13; }
  if (shmat(id, NULL, 0) != (void *)-1) { puts("a removed and detached id must be gone"); return 14; }
  if (shmctl(id, IPC_RMID, NULL) != -1) { puts("an id that is gone must fail"); return 15; }
  puts("ok");
  return 0;
}
`

describe.skipIf(!darwin)('the shim, as Postgres uses it (C probe)', () => {
  it('creates, looks up, attaches, shares across fork, stats, removes and detaches segments', () => {
    const out = buildShimmedBinaries(real, { cacheDirs: [cache('layout')] })
    const dir = mkdtempSync(join(scratch, 'probe-'))
    writeFileSync(join(dir, 'probe.c'), PROBE)
    execFileSync(process.env.CC ?? 'cc', ['-Wall', '-Werror', '-o', join(dir, 'probe'), join(dir, 'probe.c')])
    const run = execFileSync(join(dir, 'probe'), [], { encoding: 'utf8', env: { ...process.env, DYLD_INSERT_LIBRARIES: out.dylib } })
    expect(run.trim()).toBe('ok')
  }, 60_000)
})

/** What Postgres asks of semget, semop and semctl, as a C program (it also runs under Rosetta: it is compiled for both architectures). */
const SEM_PROBE = String.raw`
#include <dlfcn.h>
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <sys/ipc.h>
#include <sys/sem.h>
#include <sys/time.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

static double now(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return ts.tv_sec + ts.tv_nsec / 1e9;
}

static int op(int id, int num, int n, int flags) {
  struct sembuf b = {(unsigned short)num, (short)n, (short)flags};
  return semop(id, &b, 1);
}

static void on_alarm(int sig) { (void)sig; }

int main(void) {
  if (dlsym(RTLD_DEFAULT, "hb_shm_shim_loaded") == NULL) { puts("shim not loaded"); return 10; }
  union semun arg;
  key_t key = 0x48420101;
  int id = semget(key, 3, IPC_CREAT | IPC_EXCL | 0600);
  if (id < 0) { printf("semget failed: errno %d\n", errno); return 1; }
  if (semget(key, 3, IPC_CREAT | IPC_EXCL | 0600) != -1 || errno != EEXIST) { puts("IPC_EXCL on a taken key must be EEXIST"); return 2; }
  if (semget(key + 1, 3, 0) != -1 || errno != ENOENT) { puts("a key nobody created must be ENOENT"); return 3; }
  if (semget(key, 3, 0) != id || semget(key, 2, 0) != id) { puts("a lookup by key must find the set"); return 4; }
  if (semget(key, 4, 0) != -1 || errno != EINVAL) { puts("a lookup asking for more semaphores must be EINVAL"); return 5; }

  arg.val = 1;
  if (semctl(id, 0, SETVAL, arg) != 0 || semctl(id, 0, GETVAL, arg) != 1) { puts("SETVAL / GETVAL"); return 6; }
  if (semctl(id, 0, GETPID, arg) != getpid()) { puts("SETVAL must record the pid"); return 7; }
  if (op(id, 0, 1, 0) != 0 || semctl(id, 0, GETVAL, arg) != 2) { puts("semop +1"); return 8; }
  if (op(id, 0, -2, 0) != 0 || semctl(id, 0, GETVAL, arg) != 0) { puts("semop -2"); return 9; }
  if (op(id, 1, -1, IPC_NOWAIT) != -1 || errno != EAGAIN) { puts("IPC_NOWAIT on zero must be EAGAIN"); return 11; }
  if (op(id, 3, 1, 0) != -1 || errno != EFBIG) { puts("a semaphore number past the end must be EFBIG"); return 12; }
  struct semid_ds ds;
  arg.buf = &ds;
  if (semctl(id, 0, IPC_STAT, arg) != 0 || ds.sem_nsems != 3) { puts("IPC_STAT"); return 13; }

  /* A forked child posts after a while; the parent blocks, then gets it, and GETPID names the last one to touch it. */
  pid_t child = fork();
  if (child < 0) { puts("fork failed"); return 14; }
  if (child == 0) { usleep(150000); op(id, 1, 1, 0); _exit(0); }
  double t0 = now();
  if (op(id, 1, -1, 0) != 0) { puts("a blocked semop must succeed once posted"); return 15; }
  double waited = now() - t0;
  if (waited < 0.1 || waited > 5) { printf("waited %f s\n", waited); return 16; }
  if (semctl(id, 1, GETPID, arg) != getpid()) { puts("GETPID after the parent's own semop"); return 17; }
  waitpid(child, NULL, 0);

  /* A signal that arrives while it waits ends the wait with EINTR (a repeating timer, so one of them finds it asleep). */
  struct sigaction sa;
  sa.sa_handler = on_alarm;
  sigemptyset(&sa.sa_mask);
  sa.sa_flags = 0;
  sigaction(SIGALRM, &sa, NULL);
  struct itimerval it = {{0, 20000}, {0, 20000}};
  setitimer(ITIMER_REAL, &it, NULL);
  int r = op(id, 2, -1, 0);
  int e = errno;
  struct itimerval off = {{0, 0}, {0, 0}};
  setitimer(ITIMER_REAL, &off, NULL);
  if (r != -1 || e != EINTR) { puts("a signal must interrupt the wait with EINTR"); return 18; }

  /* Many posters, one consumer. */
  arg.val = 0;
  semctl(id, 2, SETVAL, arg);
  for (int c = 0; c < 4; c++) {
    pid_t p = fork();
    if (p == 0) { for (int i = 0; i < 500; i++) if (op(id, 2, 1, 0) != 0) _exit(1); _exit(0); }
  }
  for (int i = 0; i < 2000; i++) if (op(id, 2, -1, 0) != 0) { puts("consumer"); return 19; }
  int status = 0, bad = 0;
  while (wait(&status) > 0) if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) bad = 1;
  if (bad || semctl(id, 2, GETVAL, arg) != 0) { puts("2000 posts, 2000 waits, 0 left"); return 20; }

  /* Removing a set wakes whoever waits on it, with EIDRM. */
  child = fork();
  if (child == 0) { usleep(150000); semctl(id, 0, IPC_RMID, arg); _exit(0); }
  if (op(id, 2, -1, 0) != -1 || errno != EIDRM) { printf("removal must give EIDRM, got errno %d\n", errno); return 21; }
  waitpid(child, NULL, 0);
  if (semget(key, 3, 0) != -1 || errno != ENOENT) { puts("a removed set must not be found by key"); return 22; }
  if (op(id, 0, 1, 0) != -1 || errno != EINVAL) { puts("a removed id must be EINVAL"); return 23; }
  int again = semget(key, 3, IPC_CREAT | IPC_EXCL | 0600);
  if (again < 0 || again == id) { puts("a new set gets a new id"); return 24; }
  if (op(id, 0, 1, 0) != -1) { puts("the old id must stay dead"); return 25; }
  if (semctl(again, 0, GETVAL, arg) != 0) { puts("a new set starts at zero"); return 26; }
  semctl(again, 0, IPC_RMID, arg);
  int priv = semget(IPC_PRIVATE, 2, IPC_CREAT | 0600);
  int priv2 = semget(IPC_PRIVATE, 2, IPC_CREAT | 0600);
  if (priv < 0 || priv2 < 0 || priv == priv2) { puts("IPC_PRIVATE makes a new set each time"); return 27; }
  puts("ok");
  return 0;
}
`

/** Compiles a probe for every architecture of postgres and runs it with the shim loaded, once per architecture this machine can run. */
function runProbe(name: string, source: string): string[] {
  const out = buildShimmedBinaries(real, { cacheDirs: [cache('layout')] })
  const archs = machoArchs(real.postgres)
  const dir = mkdtempSync(join(scratch, `${name}-`))
  writeFileSync(join(dir, 'probe.c'), source)
  execFileSync(process.env.CC ?? 'cc', ['-Wall', '-Werror', ...archs.flatMap((a) => ['-arch', a]), '-o', join(dir, 'probe'), join(dir, 'probe.c')])
  const results: string[] = []
  for (const arch of archs) {
    if (spawnSync('/usr/bin/arch', [`-${arch}`, '/usr/bin/true']).status !== 0) continue
    // `arch` and `env` are protected programs, which drop DYLD_* from their own environment but pass on what `env` is given.
    const run = execFileSync('/usr/bin/arch', [`-${arch}`, '/usr/bin/env', `DYLD_INSERT_LIBRARIES=${out.dylib}`, join(dir, 'probe')], { encoding: 'utf8' })
    results.push(`${arch}: ${run.trim()}`)
  }
  return results
}

describe.skipIf(!darwin)('the shim, as Postgres uses it, under every architecture of postgres (C probes)', () => {
  it('shared memory: the probe above passes under each architecture too', () => {
    const results = runProbe('shm-arch', PROBE)
    expect(results.length).toBeGreaterThanOrEqual(1)
    for (const r of results) expect(r).toMatch(/: ok$/)
  }, 120_000)

  it('semaphores: creates, looks up, sets, waits for a post from a forked process, is interrupted by a signal, survives 2000 posts from four processes, and wakes waiters with EIDRM when removed', () => {
    const results = runProbe('sem', SEM_PROBE)
    expect(results.length).toBeGreaterThanOrEqual(1)
    for (const r of results) expect(r).toMatch(/: ok$/)
  }, 180_000)
})

describe.skipIf(!darwin)('ipc.ts: the host\'s own System V IPC, as the tests that check for leaks see it', () => {
  it('lists a real kernel semaphore set by its key, and the sets near an inode number', () => {
    const dir = mkdtempSync(join(scratch, 'kernel-set-'))
    writeFileSync(
      join(dir, 'make.c'),
      '#include <stdio.h>\n#include <sys/ipc.h>\n#include <sys/sem.h>\nint main(void) { int id = semget(0x48420f01, 1, IPC_CREAT | 0600); printf("%d", id); return id < 0; }\n',
    )
    execFileSync(process.env.CC ?? 'cc', ['-o', join(dir, 'make'), join(dir, 'make.c')])
    // No DYLD_INSERT_LIBRARIES here: this one is the kernel's.
    const id = execFileSync(join(dir, 'make'), [], { encoding: 'utf8' }).trim()
    try {
      expect(sysvKeys('semaphore')).toContain(0x48420f01)
      expect(semaphoreSetsOfInode(0x48420f01 - 1, 8)).toEqual([0x48420f01])
      expect(semaphoreSetsOfInode(0x48420f01 + 1, 8)).toEqual([])
    } finally {
      execFileSync('ipcrm', ['-s', id])
    }
    expect(sysvKeys('semaphore')).not.toContain(0x48420f01)
    expect(Array.isArray(sysvKeys('segment'))).toBe(true)
  }, 60_000)
})
