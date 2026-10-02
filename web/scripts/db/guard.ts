/**
 * The guard (ROADMAP M2.0): the one thing that cleans up after a SIGKILL.
 *
 * `process.on('exit')` and the signal handlers in engine.ts cover every way a run ends that the
 * process can see. SIGKILL (the workflow watchdog, `kill -9`, the OOM killer) it cannot. So each
 * cluster gets a small detached watcher: a separate node process, in its own session, that polls
 * its owner and, once the owner is gone, stops the postmaster (SIGQUIT, then SIGKILL) and removes
 * the cluster directory (and any initdb still working in it). It also exits by itself as soon as the
 * directory is gone, which is what a normal `stop()` leaves behind. The code is guard-run.cjs.
 *
 * It is a second line before `reapStaleClusters()` (which still runs at the start of every cluster
 * and in `npm run db:reap`, for the case that the guard died with the rest of the process tree) and
 * it takes the same precautions: it only touches a directory whose name starts with the cluster
 * prefix and whose marker names this owner, and it signals a pid from `postmaster.pid` only if that
 * process's command line says `postgres`.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** The watcher: a plain CommonJS file, so `node` runs it directly, with no loader. */
export const GUARD_SCRIPT = fileURLToPath(new URL('./guard-run.cjs', import.meta.url))

export interface GuardOptions {
  /** The process whose death triggers the cleanup. */
  readonly ownerPid: number
  /** The cluster directory, `<tmp>/hb-pg-XXXXXX`. */
  readonly dir: string
  /** The prefix every cluster directory name starts with. */
  readonly prefix: string
  /** The marker file in the directory that names its owner. */
  readonly marker: string
  /** Poll interval. Default 500 ms. */
  readonly intervalMs?: number
}

/**
 * Starts the watcher, detached from this process (own session, no stdio, unref'd), so it survives
 * whatever kills the owner and does not keep the owner alive. Returns undefined if it could not
 * start or `HB_PG_GUARD=0` turns it off (the reaper tests need an orphan to be left alone).
 */
export function spawnGuard(options: GuardOptions): ChildProcess | undefined {
  if (process.env.HB_PG_GUARD === '0') return undefined
  try {
    const child = spawn(
      process.execPath,
      [GUARD_SCRIPT, String(options.ownerPid), options.dir, options.prefix, options.marker, String(options.intervalMs ?? 500)],
      { detached: true, stdio: 'ignore' },
    )
    child.on('error', () => undefined)
    child.unref()
    return child
  } catch {
    return undefined
  }
}
