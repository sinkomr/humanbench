/** Small process helpers shared by the engine, the guard and the shared-memory build (ROADMAP M2.0). */

import { execFileSync } from 'node:child_process'

/** Whether a process with this pid exists (a process we may not signal still counts). */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Whether this pid's command line says `postgres`: the check before a pid read from a file is ever signalled. */
export function isPostgresProcess(pid: number): boolean {
  try {
    return /postgres/.test(execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }))
  } catch {
    return false
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** The result of `promise`, or `'timeout'` after `ms`. The timer is cleared, so it never delays the process's exit. */
export async function orTimeout<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([promise, new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), ms)))])
  } finally {
    clearTimeout(timer)
  }
}

/** Blocks the thread for `ms`. Only for the synchronous last-resort cleanup inside an `exit` handler. */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Pids of the processes that have `path` anywhere in their command line or, where `ps` can show it
 * (macOS: `ps -E`), their environment. The environment matters: `initdb` hands its data directory to
 * the `postgres --boot` and `--single` it starts through PGDATA, not on their command line. Never
 * includes this process.
 */
export function processesUsing(path: string): number[] {
  for (const args of [['-axwwE', '-o', 'pid=,command='], ['-axww', '-o', 'pid=,command=']]) {
    let table: string
    try {
      table = execFileSync('ps', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      continue
    }
    const pids: number[] = []
    for (const raw of table.split('\n')) {
      const line = raw.trim()
      const space = line.indexOf(' ')
      if (space < 1) continue
      const pid = Number(line.slice(0, space))
      if (Number.isInteger(pid) && pid !== process.pid && line.slice(space + 1).includes(path)) pids.push(pid)
    }
    return pids
  }
  return []
}
