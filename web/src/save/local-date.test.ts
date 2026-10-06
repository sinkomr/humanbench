/**
 * The local calendar day in a file name (D19; DESIGN §8 file name, §9.9 card name): `localDateStamp` formats the
 * `Date` it is given in the process's time zone and reads no clock. The zone is set with `vi.stubEnv('TZ')`.
 */

import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { utcSeconds } from './clock'
import { localDateStamp } from './io'

afterEach(() => vi.unstubAllEnvs())

const ZONES = ['UTC', 'America/Los_Angeles', 'America/New_York', 'Europe/London', 'Asia/Kolkata', 'Asia/Kathmandu', 'Pacific/Auckland', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'] as const

/** The same day by another route: Intl in that zone (en-CA writes YYYY-MM-DD). */
const viaIntl = (tz: string, d: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

describe('localDateStamp', () => {
  it('is the calendar day on the person\'s wall clock, in any zone (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ZONES), fc.integer({ min: 0, max: Date.UTC(2100, 0, 1) }), (tz, ms) => {
        vi.stubEnv('TZ', tz)
        expect(localDateStamp(new Date(ms))).toBe(viaIntl(tz, new Date(ms)))
      }),
      { numRuns: 500 },
    )
  })

  it('is YYYY-MM-DD with a zero-padded month and day', () => {
    vi.stubEnv('TZ', 'UTC')
    expect(localDateStamp(new Date(Date.UTC(2026, 0, 5, 12)))).toBe('2026-01-05')
    expect(localDateStamp(new Date(Date.UTC(2026, 11, 31, 23, 59, 59)))).toBe('2026-12-31')
    expect(localDateStamp(new Date(Date.UTC(1970, 0, 1)))).toBe('1970-01-01')
  })

  it('turns over at local midnight, which is not UTC midnight', () => {
    // 8 pm on 5 October in Los Angeles is 03:00 UTC on the 6th: the person\'s day is still the 5th.
    const evening = new Date(Date.UTC(2026, 9, 6, 3, 0, 0))
    vi.stubEnv('TZ', 'America/Los_Angeles')
    expect(localDateStamp(evening)).toBe('2026-10-05')
    vi.stubEnv('TZ', 'UTC')
    expect(localDateStamp(evening)).toBe('2026-10-06')
    vi.stubEnv('TZ', 'Pacific/Auckland')
    expect(localDateStamp(evening)).toBe('2026-10-06')
    // One second either side of Los Angeles' midnight (07:00 UTC while the clocks are on daylight time).
    vi.stubEnv('TZ', 'America/Los_Angeles')
    expect(localDateStamp(new Date(Date.UTC(2026, 9, 6, 6, 59, 59)))).toBe('2026-10-05')
    expect(localDateStamp(new Date(Date.UTC(2026, 9, 6, 7, 0, 0)))).toBe('2026-10-06')
  })

  it('follows the clocks going back and forward (the repeated and the skipped hour keep one day each)', () => {
    vi.stubEnv('TZ', 'America/New_York')
    // Clocks went back at 02:00 EDT on 1 November 2026 (06:00 UTC): 01:30 happened twice, both on the 1st.
    expect(localDateStamp(new Date(Date.UTC(2026, 10, 1, 5, 30)))).toBe('2026-11-01')
    expect(localDateStamp(new Date(Date.UTC(2026, 10, 1, 6, 30)))).toBe('2026-11-01')
    expect(localDateStamp(new Date(Date.UTC(2026, 10, 2, 4, 59)))).toBe('2026-11-01')
    expect(localDateStamp(new Date(Date.UTC(2026, 10, 2, 5, 0)))).toBe('2026-11-02')
  })

  it('refuses a time that is not a real time, rather than naming a file "NaN-NaN-NaN"', () => {
    expect(() => localDateStamp(new Date(Number.NaN))).toThrow(RangeError)
  })

  it('does not touch the UTC stamp of the file itself (created_utc stays UTC)', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    expect(utcSeconds(Date.UTC(2026, 9, 6, 3, 0, 0))).toBe('2026-10-06T03:00:00Z')
  })
})
