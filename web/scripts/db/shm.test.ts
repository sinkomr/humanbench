/**
 * The System V shared-memory shim and the choice of binaries (ROADMAP M2.0), without starting a
 * database: the macOS-only build (a C library, a re-signed copy of postgres, a wrapper), its cache,
 * and a C probe that checks the library does what Postgres asks of the four calls it replaces,
 * including that a forked child sees the same memory. `npm run test:db` starts real clusters through
 * it (shim.db.test.ts checks that the server then holds no System V segment).
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prepareBinaries } from './engine'
import { SHIM_SOURCE, WRAPPER_SCRIPT, buildShimmedBinaries, shimKey, type RealBinaries } from './shm'

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

  it('on macOS falls back to the host\'s shared memory, with a note and a warning, if the shim cannot be built; `shim` fails instead', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    // A cache "directory" below a regular file can never be created.
    const file = join(scratch, 'a-file')
    writeFileSync(file, 'not a directory')
    const unusable = [join(file, 'cache')]
    const b = prepareBinaries({ platform: 'darwin', cacheDirs: unusable })
    expect(b.shm).toBe('sysv')
    expect(b.initdb).toBe(real.initdb)
    expect(b.shmNote).toMatch(/shim could not be built.*No writable directory/)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(() => prepareBinaries({ platform: 'darwin', shm: 'shim', cacheDirs: unusable })).toThrow(/No writable directory/)
  })

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
  it('is 16 hex characters, stable, and different for another architecture', () => {
    const key = shimKey(real, 'arm64')
    expect(key).toMatch(/^[0-9a-f]{16}$/)
    expect(shimKey(real, 'arm64')).toBe(key)
    expect(shimKey(real, 'x64')).not.toBe(key)
  })

  it('reads the shim source, so editing it builds a new overlay', () => {
    expect(readFileSync(SHIM_SOURCE, 'utf8')).toContain('hb_shmget')
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
