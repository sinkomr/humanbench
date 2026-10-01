/**
 * The cluster reaper and the binary setup of the local database engine (ROADMAP M2.0), without
 * starting a database: a killed test run must not leave postmasters or directories behind, and the
 * reaper must never touch anything that is not a dead run's `hb-pg-*` directory.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CLUSTER_DIR_PREFIX, MARKER_FILE, binaryPackage, hydrateLinks, isAlive, prepareBinaries, reapStaleClusters } from './engine'

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
