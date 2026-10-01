/**
 * Shared by the benchmark tests (`*.bench.test.ts`; ROADMAP M1.3, M1.14, M1.16): the CI flag and a
 * judgement of a timing that does not depend on how busy the machine is.
 *
 * Wall-clock time includes the time the process waited for a core. The gate runs beside other jobs
 * (the bank's pytest, other worktrees: a load average near 100 was seen), and then a benchmark that
 * passes alone reads two or three times its budget. The CPU time the process used is not inflated by
 * waiting, and a real slowdown raises wall time and CPU time alike, so the smaller of the two is judged.
 */

type CpuUsage = { user: number; system: number }

/** The CI flag, read without Node typings (the app tsconfig has none); '', '0' and 'false' are unset. */
const CI_ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.CI
export const CI = CI_ENV !== undefined && !['', '0', 'false'].includes(CI_ENV.trim().toLowerCase())

/** This process's CPU time in ms, or null where `process.cpuUsage` is missing. */
export function cpuMs(): number | null {
  const p = (globalThis as { process?: { cpuUsage?: () => CpuUsage } }).process
  const u = p?.cpuUsage?.()
  return u === undefined ? null : (u.user + u.system) / 1000
}

/** The median of a list of timings (the mean of the middle two for an even count). */
export function median(times: readonly number[]): number {
  if (times.length === 0) throw new RangeError('no timings')
  const sorted = [...times].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * The time to judge for `runs` repetitions: the smaller of the wall-clock median and the mean CPU time per
 * run (`cpuBefore` and `cpuAfter` are {@link cpuMs} readings around the runs). Without CPU readings, the wall median.
 */
export function judgedMs(wallMedianMs: number, cpuBefore: number | null, cpuAfter: number | null, runs: number): number {
  if (cpuBefore === null || cpuAfter === null || runs <= 0) return wallMedianMs
  return Math.min(wallMedianMs, (cpuAfter - cpuBefore) / runs)
}
