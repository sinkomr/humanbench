import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { savedAt } from './saved-at'

/** A local time (the person's), as an ISO string and epoch ms. */
const local = (y: number, mo: number, d: number, h = 0, mi = 0): { iso: string; ms: number } => {
  const t = new Date(y, mo - 1, d, h, mi, 0)
  return { iso: t.toISOString(), ms: t.getTime() }
}

describe('savedAt: when an earlier save was written, in the person’s own time (UX-012a)', () => {
  it('today, yesterday, and a date', () => {
    const now = local(2026, 10, 5, 18, 0).ms
    expect(savedAt(local(2026, 10, 5, 14, 3).iso, now)).toBe('today at 14:03')
    expect(savedAt(local(2026, 10, 5, 0, 5).iso, now)).toBe('today at 00:05')
    expect(savedAt(local(2026, 10, 4, 23, 59).iso, now)).toBe('yesterday at 23:59')
    expect(savedAt(local(2026, 10, 3, 9, 30).iso, now)).toBe('3 October at 09:30')
  })

  it('names the year only when it is not this one', () => {
    const now = local(2026, 1, 10, 12, 0).ms
    expect(savedAt(local(2025, 12, 30, 8, 0).iso, now)).toBe('30 December 2025 at 08:00')
    expect(savedAt(local(2026, 1, 2, 8, 0).iso, now)).toBe('2 January at 08:00')
  })

  it('a time that cannot be read says nothing', () => {
    expect(savedAt('not a time', 1_790_000_000_000)).toBe('')
    expect(savedAt('', 1_790_000_000_000)).toBe('')
  })

  it('property: the clock reading is always HH:MM, and the day word follows the calendar day, not 24 hours', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400 * 24 * 60 }), fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }), (minutesBefore, h, m) => {
        const now = local(2026, 6, 15, h, m).ms
        const written = new Date(now - minutesBefore * 60_000)
        const text = savedAt(written.toISOString(), now)
        expect(text).toMatch(/ at \d{2}:\d{2}$/)
        const days = Math.round((new Date(2026, 5, 15).getTime() - new Date(written.getFullYear(), written.getMonth(), written.getDate()).getTime()) / 86_400_000)
        if (days === 0) expect(text.startsWith('today at ')).toBe(true)
        else if (days === 1) expect(text.startsWith('yesterday at ')).toBe(true)
        else expect(/^\d{1,2} [A-Z][a-z]+( \d{4})? at /.test(text)).toBe(true)
      }),
      { numRuns: 200 },
    )
  })
})
