/**
 * Nothing outlives a run (ROADMAP M2.0): whichever way the process that owns a cluster ends, the
 * postmaster is stopped and the `hb-pg-*` directory is gone. Each case starts a real cluster in a
 * child process (so the tests can end it the hard ways), waits for it to be ready, ends the child,
 * and checks the host. Needs `npm run test:db`.
 *
 *   normal end            stop() twice, then a normal exit
 *   process.exit(), throw the process `exit` hook
 *   SIGINT, SIGTERM, SIGHUP  the signal hooks, which re-raise the signal so the exit status is kept
 *   SIGKILL               the guard process (guard.ts); the reaper is tested in cli.db.test.ts
 *   any of them while initdb is still running (the directory has no postmaster yet)
 */

import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { isAlive } from './engine'

const WEB = fileURLToPath(new URL('../../', import.meta.url))
const running: ChildProcess[] = []
const bases: string[] = []

// Not afterEach: the cases run concurrently, and one's cleanup must not kill another's child.
afterAll(() => {
  for (const c of running.splice(0)) c.kill('SIGKILL')
  for (const b of bases.splice(0)) rmSync(b, { recursive: true, force: true })
})

/** What the child does after it printed READY. */
type Mode = 'hold' | 'exit' | 'throw' | 'stop-twice'

const CHILD = `
import { readFileSync } from 'node:fs'
const mode = process.argv[1]
const { startCluster } = await import('./scripts/db/engine.ts')
// A start that fails because a signal stopped it is not what is under test: the signal decides how the process ends.
const cluster = await startCluster(process.argv[2] ? { baseDir: process.argv[2] } : {}).catch((e) => void console.error('start failed: ' + e.message))
if (cluster !== undefined) {
  const postmaster = readFileSync(cluster.dir + '/data/postmaster.pid', 'utf8').split('\\n')[0]
  console.log('READY ' + postmaster + ' ' + cluster.dir)
  if (mode === 'exit') process.exit(7)
  if (mode === 'throw') setTimeout(() => { throw new Error('boom') }, 10)
  if (mode === 'stop-twice') {
    await Promise.all([cluster.stop(), cluster.stop()])
    await cluster.stop()
    console.log('STOPPED')
    process.exit(0)
  }
}
setInterval(() => {}, 1000)
`

interface Launched {
  readonly child: ChildProcess
  readonly dir: string
  /** The postmaster's pid, read from its pid file by the child before it does anything else. */
  readonly postmaster: number
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  readonly stdout: () => string
}

function launch(mode: Mode): Promise<Launched> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '-e', CHILD, mode], { cwd: WEB, stdio: ['ignore', 'pipe', 'pipe'] })
    running.push(child)
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((r) => child.once('exit', (code, signal) => r({ code, signal })))
    let out = ''
    let err = ''
    const timer = setTimeout(() => reject(new Error(`the child printed no READY within 90 s.\nstdout: ${out}\nstderr: ${err}`)), 90_000)
    child.stderr.on('data', (d) => (err += String(d)))
    child.stdout.on('data', (d) => {
      out += String(d)
      const ready = /^READY (\d+) (.+)$/m.exec(out)
      if (ready === null) return
      clearTimeout(timer)
      resolve({ child, dir: ready[2] as string, postmaster: Number(ready[1]), exited, stdout: () => out })
    })
    void exited.then(({ code, signal }) => {
      clearTimeout(timer)
      reject(new Error(`the child exited early (${signal ?? code}).\nstdout: ${out}\nstderr: ${err}`))
    })
  })
}

async function waitFor(what: string, done: () => boolean, ms: number): Promise<void> {
  for (let waited = 0; waited < ms; waited += 100) {
    if (done()) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`still waiting for: ${what}`)
}

/** The cluster is gone from the host: no directory, no postmaster. */
async function expectGone(l: Launched, ms = 20_000): Promise<void> {
  await waitFor(`the postmaster ${l.postmaster} to exit and ${l.dir} to be removed`, () => !isAlive(l.postmaster) && !existsSync(l.dir), ms)
}

describe('a cluster does not outlive its process', () => {
  it.concurrent('after stop(), called twice at once and again, and a normal exit', async () => {
    const l = await launch('stop-twice')
    expect(await l.exited).toEqual({ code: 0, signal: null })
    expect(l.stdout()).toContain('STOPPED')
    await expectGone(l, 5_000)
  })

  it.concurrent('after process.exit()', async () => {
    const l = await launch('exit')
    expect((await l.exited).code).toBe(7)
    await expectGone(l)
  })

  it.concurrent('after an uncaught error', async () => {
    const l = await launch('throw')
    expect((await l.exited).code).toBe(1)
    await expectGone(l)
  })

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    it.concurrent(`after ${signal}, and the process still ends by that signal`, async () => {
      const l = await launch('hold')
      l.child.kill(signal)
      expect(await l.exited).toEqual({ code: null, signal })
      await expectGone(l)
    })
  }

  it.concurrent('after SIGKILL, which no hook can see: the guard stops the postmaster and removes the directory', async () => {
    const l = await launch('hold')
    expect(isAlive(l.postmaster)).toBe(true)
    l.child.kill('SIGKILL')
    await l.exited
    await expectGone(l)
  })
})

/** Starts a child that begins to start a cluster in a base directory of its own, and returns once the cluster's directory exists. */
async function launchStarting(): Promise<{ child: ChildProcess; base: string; dir: string; exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }> }> {
  const base = mkdtempSync(join(tmpdir(), 'hb-cleanup-test-'))
  bases.push(base)
  const child = spawn(process.execPath, ['--import', 'tsx', '-e', CHILD, 'hold', base], { cwd: WEB, stdio: 'ignore' })
  running.push(child)
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((r) => child.once('exit', (code, signal) => r({ code, signal })))
  let dir: string | undefined
  await waitFor('the child to create its cluster directory', () => {
    dir = readdirSync(base).find((n) => n.startsWith('hb-pg-') && existsSync(join(base, n, 'hb-harness.json')))
    return dir !== undefined
  }, 60_000)
  return { child, base, dir: join(base, dir as string), exited }
}

/** Whether any process has this path on its command line (initdb, its bootstrap postgres, the postmaster). */
function usesPath(path: string): boolean {
  return execFileSync('ps', ['-ax', '-o', 'command='], { encoding: 'utf8' }).includes(path)
}

describe('a cluster does not outlive its process, even if that ends while initdb is running', () => {
  it.concurrent('SIGTERM: the hook kills initdb and removes the directory', async () => {
    const l = await launchStarting()
    l.child.kill('SIGTERM')
    expect(await l.exited).toEqual({ code: null, signal: 'SIGTERM' })
    await waitFor('the directory to be removed', () => !existsSync(l.dir), 20_000)
    await waitFor('every process of the directory to be gone', () => !usesPath(l.dir), 20_000)
    expect(readdirSync(l.base)).toEqual([])
  })

  it.concurrent('SIGKILL: the guard kills initdb and removes the directory, marker last', async () => {
    const l = await launchStarting()
    l.child.kill('SIGKILL')
    await l.exited
    await waitFor('the directory to be removed', () => !existsSync(l.dir), 30_000)
    await waitFor('every process of the directory to be gone', () => !usesPath(l.dir), 20_000)
    expect(readdirSync(l.base)).toEqual([])
  })
})
