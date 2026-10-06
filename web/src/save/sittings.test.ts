import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { isContinuation, sittingCount, sittingIndex, type SittingSession } from './sittings'
import { CONTINUATION_FLAG, TIMED_TASKS_ONLY_FLAG } from './types'

const s = (id: string, started: string, continuation?: unknown): SittingSession => ({
  session_id: id,
  started_utc: started,
  flags: continuation === undefined ? {} : { [CONTINUATION_FLAG]: continuation as boolean },
})

describe('sittings of a save (UX-064)', () => {
  it('a continuation is in the sitting of the session just before it in time order', () => {
    const sessions = [s('s_b', '2026-10-05T10:20:00Z', true), s('s_a', '2026-10-05T10:00:00Z'), s('s_c', '2026-10-12T09:00:00Z')]
    expect(sittingIndex(sessions)).toEqual(
      new Map([
        ['s_a', 0],
        ['s_b', 0],
        ['s_c', 1],
      ]),
    )
    expect(sittingCount(sessions)).toBe(2)
  })

  it('without continuations every session is a sitting; a flag on the first session is ignored; only true counts', () => {
    expect(sittingCount([s('s_a', '2026-10-05T10:00:00Z'), s('s_b', '2026-10-06T10:00:00Z')])).toBe(2)
    expect(sittingCount([s('s_a', '2026-10-05T10:00:00Z', true)])).toBe(1)
    expect(sittingCount([s('s_a', '2026-10-05T10:00:00Z'), s('s_b', '2026-10-06T10:00:00Z', 1)])).toBe(2)
    expect(sittingCount([s('s_a', '2026-10-05T10:00:00Z'), s('s_b', '2026-10-06T10:00:00Z', 'true')])).toBe(2)
    expect(isContinuation({ flags: { [CONTINUATION_FLAG]: true } })).toBe(true)
    expect(isContinuation({ flags: { [TIMED_TASKS_ONLY_FLAG]: true } })).toBe(false)
    expect(sittingCount([])).toBe(0)
  })

  it('counts only the sittings that hold a session it accepts, worked out over all sessions', () => {
    const sessions = [s('s_a', '2026-10-05T10:00:00Z'), s('s_b', '2026-10-05T10:30:00Z', true), s('s_c', '2026-10-12T09:00:00Z')]
    expect(sittingCount(sessions, (x) => x.session_id === 's_b')).toBe(1)
    expect(sittingCount(sessions, (x) => x.session_id !== 's_c')).toBe(1)
    expect(sittingCount(sessions, () => false)).toBe(0)
  })

  it('a tie on the start time is broken by the id, as the retest model orders sessions', () => {
    expect(sittingIndex([s('s_b', '2026-10-05T10:00:00Z', true), s('s_a', '2026-10-05T10:00:00Z')]).get('s_b')).toBe(0)
    expect(sittingIndex([s('s_a', '2026-10-05T10:00:00Z', true), s('s_b', '2026-10-05T10:00:00Z')]).get('s_b')).toBe(1)
  })

  it('property: sittings = sessions − continuations after the first, whatever the input order', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 12 }), fc.integer({ min: 0, max: 1000 }), (flags, seed) => {
        const sessions = flags.map((c, i) => s(`s_${String(i).padStart(3, '0')}`, `2026-10-${String(1 + i).padStart(2, '0')}T10:00:00Z`, c))
        const shuffled = [...sessions].sort((a, b) => ((a.session_id.charCodeAt(4) * seed) % 7) - ((b.session_id.charCodeAt(4) * seed) % 7))
        expect(sittingCount(shuffled)).toBe(flags.length - flags.slice(1).filter(Boolean).length)
      }),
    )
  })
})
