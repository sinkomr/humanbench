/**
 * The cluster reaper and the binary setup of the local database engine (ROADMAP M2.0), without
 * starting a database: a killed test run must not leave postmasters or directories behind, and the
 * reaper must never touch anything that is not a dead run's `hb-pg-*` directory.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CLUSTER_DIR_PREFIX, MARKER_FILE, binaryPackage, hydrateLinks, isAlive, prepareBinaries, reapStaleClusters } from './engine'
import { spawnGuard } from './guard'

let base: string
const children: ChildProcess[] = []

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'hb-reap-test-'))
})
afterEach(() => {
  for (const c of children.splice(0)) c.kill('SIGKILL')
  rmSync(base, { recursive: true, force: true })
})

/** A pid that was alive and is not any more. */
function deadPid(): number {
  const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' })
  return Number(r.stdout)
}

function clusterDir(name: string, marker: unknown): string {
  const dir = join(base, `${CLUSTER_DIR_PREFIX}${name}`)
  mkdirSync(join(dir, 'data'), { recursive: true })
  if (marker !== undefined) writeFileSync(join(dir, MARKER_FILE), typeof marker === 'string' ? marker : JSON.stringify(marker))
  return dir
}

describe('reapStaleClusters', () => {
  it('has nothing to do in a missing or empty directory', async () => {
    expect(await reapStaleClusters(join(base, 'absent'))).toEqual({ reaped: [], kept: [] })
    expect(await reapStaleClusters(base)).toEqual({ reaped: [], kept: [] })
  })

  it('removes the directory of a run whose owner is dead', async () => {
    const dir = clusterDir('dead01', { ownerPid: deadPid() })
    writeFileSync(join(dir, 'data', 'PG_VERSION'), '17\n')
    const result = await reapStaleClusters(base)
    expect(result.reaped).toEqual([dir])
    expect(existsSync(dir)).toBe(false)
  })

  it('keeps the directory of a run whose owner is alive', async () => {
    const dir = clusterDir('live01', { ownerPid: process.pid })
    const result = await reapStaleClusters(base)
    expect(result.reaped).toEqual([])
    expect(result.kept).toEqual([{ dir, reason: `owner ${process.pid} is alive` }])
    expect(existsSync(dir)).toBe(true)
  })

  it('never touches a directory without a readable marker, with a marker that names no pid, or with another prefix', async () => {
    const noMarker = clusterDir('nomark', undefined)
    const broken = clusterDir('broken', '{not json')
    const noPid = clusterDir('nopid01', { startedAt: 'yesterday' })
    const stringPid = clusterDir('strpid1', { ownerPid: '1234' })
    const other = join(base, 'somebody-elses-dir')
    mkdirSync(other)
    const result = await reapStaleClusters(base)
    expect(result.reaped).toEqual([])
    expect(result.kept.map((k) => k.dir).sort()).toEqual([noMarker, broken, noPid, stringPid].sort())
    for (const d of [noMarker, broken, noPid, stringPid, other]) expect(existsSync(d), d).toBe(true)
  })

  it('does not signal a process just because a dead run\'s postmaster.pid names it', async () => {
    // pid reuse: the old postmaster's pid now belongs to an unrelated process. Only a process
    // whose command line says postgres is ever stopped.
    const bystander = spawn('sleep', ['30'], { stdio: 'ignore' })
    children.push(bystander)
    const dir = clusterDir('reuse01', { ownerPid: deadPid() })
    writeFileSync(join(dir, 'data', 'postmaster.pid'), `${bystander.pid}\n/some/data\n`)
    const result = await reapStaleClusters(base)
    expect(result.reaped).toEqual([dir])
    expect(existsSync(dir)).toBe(false)
    expect(isAlive(bystander.pid as number)).toBe(true)
  })

  it('reaps several dead runs and leaves a live one in the same directory', async () => {
    const a = clusterDir('dead0a', { ownerPid: deadPid() })
    const b = clusterDir('dead0b', { ownerPid: deadPid() })
    const live = clusterDir('live0c', { ownerPid: process.pid })
    const result = await reapStaleClusters(base)
    expect(result.reaped.sort()).toEqual([a, b].sort())
    expect(existsSync(live)).toBe(true)
  })
})

describe('importing the engine', () => {
  it('leaves the process exit code alone (the embedded-postgres wrapper forces it to 0)', () => {
    // A failing vitest run sets process.exitCode = 1 and exits when the event loop drains. A
    // dependency that calls process.exit(0) on beforeExit would turn that into a green run.
    const WEB = fileURLToPath(new URL('../../', import.meta.url))
    const result = spawnSync(process.execPath, ['--import', 'tsx', '-e', `await import('./scripts/db/engine.ts'); await import('./scripts/db/harness.ts'); process.exitCode = 3`], {
      cwd: WEB,
      encoding: 'utf8',
    })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(3)
  })
})

describe('isAlive', () => {
  it('is true for this process and false for one that has exited', () => {
    expect(isAlive(process.pid)).toBe(true)
    expect(isAlive(deadPid())).toBe(false)
  })
})

describe('hydrateLinks', () => {
  it('creates the missing relative symlinks, once, and leaves what exists alone', () => {
    mkdirSync(join(base, 'native', 'lib'), { recursive: true })
    writeFileSync(join(base, 'native', 'lib', 'libx.3.dylib'), 'real library')
    writeFileSync(join(base, 'native', 'lib', 'libother.dylib'), 'a regular file already there')
    const links = [
      { source: 'native/lib/libx.3.dylib', target: 'native/lib/libx.dylib' },
      { source: 'native/lib/libx.3.dylib', target: 'native/lib/libother.dylib' },
    ]
    expect(hydrateLinks(base, links)).toEqual(['native/lib/libx.dylib'])
    expect(readlinkSync(join(base, 'native', 'lib', 'libx.dylib'))).toBe('libx.3.dylib')
    expect(readFileSync(join(base, 'native', 'lib', 'libx.dylib'), 'utf8')).toBe('real library')
    expect(lstatSync(join(base, 'native', 'lib', 'libother.dylib')).isSymbolicLink()).toBe(false)
    expect(hydrateLinks(base, links)).toEqual([])
  })
})

describe('prepareBinaries', () => {
  it('finds executable initdb and postgres binaries and every shared-library symlink', () => {
    const b = prepareBinaries()
    for (const exe of [b.initdb, b.postgres]) expect(existsSync(exe), exe).toBe(true)
    const root = dirname(b.root)
    const links = JSON.parse(readFileSync(join(root, 'native', 'pg-symlinks.json'), 'utf8')) as { source: string; target: string }[]
    expect(links.length).toBeGreaterThan(0)
    for (const { target } of links) expect(lstatSync(join(root, target)).isSymbolicLink(), target).toBe(true)
  })

  it('is a package of the platform this test runs on', () => {
    expect(binaryPackage()).toMatch(/^@embedded-postgres\/(darwin|linux)-(arm64|x64)$/)
  })
})

describe('the guard (what cleans up after a SIGKILL)', () => {
  /** A stand-in for a postmaster: a shell script named `postgres`, so its command line says postgres. */
  function fakePostmaster(): ChildProcess {
    mkdirSync(join(base, 'fake-bin'), { recursive: true })
    const exe = join(base, 'fake-bin', 'postgres')
    writeFileSync(exe, '#!/bin/sh\nwhile true; do sleep 1; done\n')
    chmodSync(exe, 0o755)
    const child = spawn(exe, [], { stdio: 'ignore' })
    children.push(child)
    return child
  }

  /** A process that stands for the run that owns the cluster. */
  function fakeOwner(): ChildProcess {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    children.push(child)
    return child
  }

  async function waitFor(what: string, done: () => boolean, ms = 10_000): Promise<void> {
    for (let waited = 0; waited < ms; waited += 50) {
      if (done()) return
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error(`still waiting for: ${what}`)
  }

  function guard(owner: ChildProcess, dir: string): ChildProcess {
    const g = spawnGuard({ ownerPid: owner.pid as number, dir, prefix: CLUSTER_DIR_PREFIX, marker: MARKER_FILE, intervalMs: 50 })
    expect(g).toBeDefined()
    children.push(g as ChildProcess)
    return g as ChildProcess
  }

  it('when its owner dies: stops the postmaster, removes the directory, and exits', async () => {
    const owner = fakeOwner()
    const postmaster = fakePostmaster()
    const dir = clusterDir('guard01', { ownerPid: owner.pid })
    writeFileSync(join(dir, 'data', 'postmaster.pid'), `${postmaster.pid}\n${join(dir, 'data')}\n`)
    const g = guard(owner, dir)
    const guardExited = new Promise<void>((r) => g.once('exit', () => r()))
    await new Promise((r) => setTimeout(r, 300))
    expect(existsSync(dir)).toBe(true)
    expect(isAlive(postmaster.pid as number)).toBe(true)

    owner.kill('SIGKILL')
    await waitFor('the directory to be removed', () => !existsSync(dir))
    await waitFor('the postmaster to stop', () => !isAlive(postmaster.pid as number))
    await guardExited
  })

  it('exits by itself, touching nothing, once the directory is gone while the owner lives (a normal stop())', async () => {
    const owner = fakeOwner()
    const postmaster = fakePostmaster()
    const dir = clusterDir('guard02', { ownerPid: owner.pid })
    const g = guard(owner, dir)
    const guardExited = new Promise<void>((r) => g.once('exit', () => r()))
    rmSync(dir, { recursive: true, force: true })
    await guardExited
    expect(isAlive(owner.pid as number)).toBe(true)
    expect(isAlive(postmaster.pid as number)).toBe(true)
  })

  it('does not signal a pid from postmaster.pid unless its command line says postgres', async () => {
    const owner = fakeOwner()
    const bystander = spawn('sleep', ['60'], { stdio: 'ignore' })
    children.push(bystander)
    const dir = clusterDir('guard03', { ownerPid: owner.pid })
    writeFileSync(join(dir, 'data', 'postmaster.pid'), `${bystander.pid}\n${join(dir, 'data')}\n`)
    guard(owner, dir)
    owner.kill('SIGKILL')
    await waitFor('the directory to be removed', () => !existsSync(dir))
    expect(isAlive(bystander.pid as number)).toBe(true)
  })

  it('never touches a directory whose marker names another owner, that has no marker, or that is not a cluster directory', async () => {
    const owner = fakeOwner()
    const other = fakeOwner()
    const wrongOwner = clusterDir('guard04', { ownerPid: other.pid })
    const noMarker = clusterDir('guard05', undefined)
    const foreign = join(base, 'somebody-elses-dir')
    mkdirSync(foreign)
    writeFileSync(join(foreign, MARKER_FILE), JSON.stringify({ ownerPid: owner.pid }))
    const guards = [guard(owner, wrongOwner), guard(owner, noMarker), guard(owner, foreign)]
    const exits = guards.map((g) => new Promise<void>((r) => g.once('exit', () => r())))
    owner.kill('SIGKILL')
    await Promise.all(exits)
    for (const d of [wrongOwner, noMarker, foreign]) expect(existsSync(d), d).toBe(true)
  })

  it('is off with HB_PG_GUARD=0', () => {
    const before = process.env.HB_PG_GUARD
    process.env.HB_PG_GUARD = '0'
    try {
      expect(spawnGuard({ ownerPid: process.pid, dir: base, prefix: CLUSTER_DIR_PREFIX, marker: MARKER_FILE })).toBeUndefined()
    } finally {
      if (before === undefined) delete process.env.HB_PG_GUARD
      else process.env.HB_PG_GUARD = before
    }
  })
})
