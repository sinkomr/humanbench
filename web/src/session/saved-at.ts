/**
 * "today at 14:03", "yesterday at 09:30", "3 October at 14:03": when an earlier save was last written, in
 * the person's own time, for the ready screen (UX-012a). Display only: nothing about the session's timing.
 */

const DAY_MS = 86_400_000

const pad = (n: number): string => String(n).padStart(2, '0')

/** Local midnight of the day of `d`. */
const dayStart = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** `utc` is an ISO time (`created_utc`); `nowMs` the current epoch ms. A time that cannot be read gives ''. */
export function savedAt(utc: string, nowMs: number): string {
  const d = new Date(utc)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date(nowMs)
  const days = Math.round((dayStart(now) - dayStart(d)) / DAY_MS)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (days === 0) return `today at ${time}`
  if (days === 1) return `yesterday at ${time}`
  const date = `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'long' })}${d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`}`
  return `${date} at ${time}`
}
