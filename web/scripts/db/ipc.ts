/**
 * System V IPC as the host's kernel lists it (`ipcs`), for the tests that check that the harness
 * leaves none behind (ROADMAP M2.0): on macOS the kernel's accounting of segments and semaphore sets
 * is what a killed postmaster leaks, and what the shim (shm/hb_shm_shim.c) exists to avoid.
 */

import { execFileSync } from 'node:child_process'

export type IpcKind = 'segment' | 'semaphore'

/** The keys of the System V segments or semaphore sets that exist on the host, as 32-bit unsigned numbers. */
export function sysvKeys(kind: IpcKind): number[] {
  const out = execFileSync('ipcs', [kind === 'semaphore' ? '-s' : '-m', '-a'], { encoding: 'utf8' })
  const keys: number[] = []
  for (const line of out.split('\n')) {
    const m = /^[sm]\s+\d+\s+0x([0-9a-f]+)\s/i.exec(line.trim())
    if (m !== null) keys.push(Number.parseInt(m[1] as string, 16) >>> 0)
  }
  return keys
}

/**
 * The semaphore sets on the host that a Postgres started on a data directory with this inode number
 * would own: it takes the inode as the first key and counts up from it (`sysv_sema.c`), one key per
 * set of 19 processes. `span` keys are looked at.
 */
export function semaphoreSetsOfInode(inode: number, span = 64): number[] {
  const mine = new Set(Array.from({ length: span }, (_, i) => (inode + i) >>> 0))
  return sysvKeys('semaphore').filter((k) => mine.has(k))
}
