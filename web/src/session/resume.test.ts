import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { SegmentId } from '../engine/selector'
import { saveWithSession } from '../save/create'
import { mergeAll } from '../save/merge'
import { parseUtcSeconds, utcSeconds } from '../save/clock'
import { CONTINUATION_FLAG, TIMED_TASKS_ONLY_FLAG, type SaveFileV1, type SaveSession, type SessionFlags } from '../save/types'
import { Bot } from './bot'
import { SAVE_CTX } from './constants'
import {
  COMPLETED_FLAG,
  continuationStartMs,
  doneFlag,
  findUnfinished,
  FOCUS_SESSION_FLAG,
  isProgressFlag,
  partsFinished,
  RESUME_WINDOW_MS,
  segmentOfItem,
  sessionEnded,
} from './resume'
import type { RunConfig, RunView } from './run'

const START_MS = 1_790_000_000_000
const ANON = 'hb_RESUMETEST0000001'
const ORDER: readonly SegmentId[] = ['rt', 'matrix_series', 'spatial', 'memory', 'quant', 'coding_reading']

/** A run played by the bot until `stop` holds: its session as the save library takes it. */
function played(stop: (v: RunView) => boolean, cfg: Partial<RunConfig> = {}): Bot {
  const bot = new Bot({ sessionId: 's_RESUMETEST00001', startedMs: START_MS, ...cfg })
  bot.until(stop)
  return bot
}

const atInterstitial = (id: SegmentId) => (v: RunView) => v.phase === 'interstitial' && v.segment?.id === id

function saveOf(bot: Bot, base: SaveFileV1 | null = null): SaveFileV1 {
  return saveWithSession(base, bot.run.sessionState(), { ctx: SAVE_CTX, createdMs: START_MS + 60_000, anonId: ANON })
}

/** The save with each session's flags changed by `edit` (an older autosave, a session of another kind). */
function withFlags(save: SaveFileV1, edit: (f: SessionFlags, s: SaveSession) => SessionFlags): SaveFileV1 {
  return { ...save, sessions: save.sessions.map((s) => ({ ...s, flags: edit({ ...s.flags }, s) })) }
}

/** As an autosave written before this change: no `done_` flags and no `completed`. */
const legacy = (save: SaveFileV1): SaveFileV1 => withFlags(save, (f) => Object.fromEntries(Object.entries(f).filter(([k]) => !k.startsWith('done_') && k !== COMPLETED_FLAG)))

describe('how far a session got: the flags a run writes (UX-064)', () => {
  it('a finished session has every part done and `completed`; the progress flags are not sent to the server', () => {
    const bot = new Bot({ sessionId: 's_RESUMEFULL00001' })
    bot.finish()
    const f = bot.run.sessionState().flags
    for (const id of ORDER) expect(f[doneFlag(id)]).toBe(true)
    expect(f[COMPLETED_FLAG]).toBe(true)
    expect(sessionEnded({ flags: f })).toBe(true)
    const server = bot.run.serverFlags()
    expect(Object.keys(server).filter(isProgressFlag)).toEqual([])
    expect(server).not.toHaveProperty(COMPLETED_FLAG)
  })

  it('an interrupted session has its finished parts done, no end, and nothing for the part it was in', () => {
    const bot = played((v) => v.phase === 'item' && v.segment?.id === 'spatial')
    const f = bot.run.sessionState().flags
    expect(f[doneFlag('rt')]).toBe(true)
    expect(f[doneFlag('matrix_series')]).toBe(true)
    expect(f[doneFlag('spatial')]).toBeUndefined()
    expect(sessionEnded({ flags: f })).toBe(false)
  })

  it('a skipped part is not done; finishing early or at the time limit is an end of its own', () => {
    const bot = new Bot({ sessionId: 's_RESUMESKIP00001' })
    bot.run.skipAxis('RT')
    bot.until(atInterstitial('spatial'))
    bot.run.finishEarly()
    const f = bot.run.sessionState().flags
    expect(f[doneFlag('rt')]).toBeUndefined()
    expect(f.skipped_rt).toBe(true)
    expect(f[doneFlag('matrix_series')]).toBe(true)
    expect(f[COMPLETED_FLAG]).toBeUndefined()
    expect(sessionEnded({ flags: f })).toBe(true)
    expect(sessionEnded({ flags: { hard_stop: true } })).toBe(true)
    expect(sessionEnded({ flags: { finished_early: false } })).toBe(false)
  })

  it('a focus session says so', () => {
    const bot = new Bot({ sessionId: 's_RESUMEFOCUS0001', focus: ['QR'] })
    expect(bot.run.sessionState().flags[FOCUS_SESSION_FLAG]).toBe(true)
    expect(new Bot().run.sessionState().flags[FOCUS_SESSION_FLAG]).toBeUndefined()
  })

  it('names the progress flags and places a response in its part', () => {
    expect(['done_rt', 'done_coding_reading', COMPLETED_FLAG, FOCUS_SESSION_FLAG, CONTINUATION_FLAG].every(isProgressFlag)).toBe(true)
    expect(['skipped_rt', 'finished_early', 'hard_stop', 'breaks', 'paste_events', TIMED_TASKS_ONLY_FLAG].some(isProgressFlag)).toBe(false)
    const bot = played(atInterstitial('memory'))
    const parts = new Set(bot.run.sessionState().responses.map(([id]) => segmentOfItem(id)))
    expect([...parts].sort()).toEqual(['matrix_series', 'rt', 'spatial'])
    expect(segmentOfItem('not an id')).toBeUndefined()
  })
})

describe('finding the unfinished session (UX-064)', () => {
  it('offers the newest session when it has answers, no end and started less than 24 hours ago', () => {
    const bot = played((v) => v.phase === 'item' && v.segment?.id === 'spatial')
    const u = findUnfinished(saveOf(bot), START_MS + 3_600_000)
    expect(u).toEqual({ sessionId: 's_RESUMETEST00001', startedUtc: utcSeconds(START_MS), done: ['rt', 'matrix_series'], skipped: [], next: 'spatial' })
  })

  it('the 24-hour boundary: offered up to the last second before it, not at it; a clock set back does not hide it', () => {
    const save = saveOf(played(atInterstitial('spatial')))
    const start = parseUtcSeconds(save.sessions[0]!.started_utc)
    expect(findUnfinished(save, start + RESUME_WINDOW_MS - 1)).not.toBeNull()
    expect(findUnfinished(save, start + RESUME_WINDOW_MS)).toBeNull()
    expect(findUnfinished(save, start + 3 * RESUME_WINDOW_MS)).toBeNull()
    expect(findUnfinished(save, start - 60_000)).not.toBeNull()
    expect(findUnfinished(save, start - RESUME_WINDOW_MS)).toBeNull()
    expect(findUnfinished(save, Number.NaN)).toBeNull()
  })

  it('not for a session that ended, in any of the three ways', () => {
    // Nothing answered yet (the flow writes no autosave then; a loaded file may hold such a session).
    expect(findUnfinished(saveOf(new Bot({ sessionId: 's_RESUMEEMPTY0001', startedMs: START_MS })), START_MS)).toBeNull()
    const full = new Bot({ sessionId: 's_RESUMEFULL00002', startedMs: START_MS })
    full.finish()
    expect(findUnfinished(saveOf(full), START_MS + 60_000)).toBeNull()
    const early = played(atInterstitial('spatial'))
    early.run.finishEarly()
    expect(findUnfinished(saveOf(early), START_MS + 60_000)).toBeNull()
    const interrupted = saveOf(played(atInterstitial('spatial')))
    expect(findUnfinished(withFlags(interrupted, (f) => ({ ...f, hard_stop: true })), START_MS + 60_000)).toBeNull()
  })

  it('not when a newer session ended, even if an older one did not', () => {
    const old = saveOf(played(atInterstitial('spatial')))
    const later = new Bot({ sessionId: 's_RESUMETEST00002', startedMs: START_MS + 3_600_000 })
    later.finish()
    const save = saveOf(later, old)
    expect(save.sessions).toHaveLength(2)
    expect(findUnfinished(save, START_MS + 4_000_000)).toBeNull()
  })

  it('not for a focus session, a session of the online version or a signed one, nor without a save', () => {
    const save = saveOf(played(atInterstitial('spatial')))
    const now = START_MS + 60_000
    expect(findUnfinished(save, now)).not.toBeNull()
    expect(findUnfinished(withFlags(save, (f) => ({ ...f, [FOCUS_SESSION_FLAG]: true })), now)).toBeNull()
    expect(findUnfinished(withFlags(save, (f) => ({ ...f, [TIMED_TASKS_ONLY_FLAG]: true })), now)).toBeNull()
    const signed = { ...save, sessions: save.sessions.map((s) => ({ ...s, sig: { alg: 'HMAC-SHA256', kid: 'k', mac: 'x' } })) } as unknown as SaveFileV1
    expect(findUnfinished(signed, now)).toBeNull()
    expect(findUnfinished(null, now)).toBeNull()
    expect(findUnfinished({ ...save, sessions: [] }, now)).toBeNull()
  })

  it('a part skipped in the interrupted session stays skipped and is not where it goes on from', () => {
    const bot = new Bot({ sessionId: 's_RESUMETEST00001', startedMs: START_MS })
    bot.until(atInterstitial('spatial'))
    bot.run.skipAxis('SPA') // from its interstitial, on to Working Memory
    bot.until((v) => v.phase === 'block' && v.segment?.id === 'memory')
    const u = findUnfinished(saveOf(bot), START_MS + 60_000)!
    expect(u.done).toEqual(['rt', 'matrix_series'])
    expect(u.skipped).toEqual(['SPA'])
    expect(u.next).toBe('memory')
  })

  it('nothing left to run (every part done or skipped, no end recorded): no offer', () => {
    const bot = new Bot({ sessionId: 's_RESUMETEST00001', startedMs: START_MS })
    bot.finish()
    const noEnd = withFlags(saveOf(bot), (f) => Object.fromEntries(Object.entries(f).filter(([k]) => k !== COMPLETED_FLAG)))
    expect(findUnfinished(noEnd, START_MS + 60_000)).toBeNull()
  })
})

describe('older autosaves without done_ flags (UX-064)', () => {
  it('a part counts as finished when a later part has answers', () => {
    const bot = played((v) => v.phase === 'confidence' && v.segment?.id === 'spatial')
    bot.step() // the rating: the first Spatial answer is recorded
    const save = legacy(saveOf(bot))
    const u = findUnfinished(save, START_MS + 60_000)!
    expect(u.done).toEqual(['rt', 'matrix_series'])
    expect(u.next).toBe('spatial')
  })

  it('a part of timed tasks counts as finished when each of its tasks has its answer, the last part included', () => {
    const rtOnly = legacy(saveOf(played(atInterstitial('matrix_series'))))
    expect(findUnfinished(rtOnly, START_MS + 60_000)?.done).toEqual(['rt'])
    const bot = new Bot({ sessionId: 's_RESUMETEST00001', startedMs: START_MS })
    bot.finish()
    // A finished session written before `completed` existed is not taken for an unfinished one.
    expect(findUnfinished(legacy(saveOf(bot)), START_MS + 60_000)).toBeNull()
  })

  it('a CAT part with no later answers is not known to be finished: it is run again from its start', () => {
    const save = legacy(saveOf(played(atInterstitial('spatial'))))
    expect(findUnfinished(save, START_MS + 60_000)?.next).toBe('matrix_series')
    // With the done_ flag the same session goes on from Spatial.
    expect(findUnfinished(saveOf(played(atInterstitial('spatial'))), START_MS + 60_000)?.next).toBe('spatial')
  })

  it('property: the flags give the part the run was in; an older autosave never goes on past it', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 260 }), fc.constantFrom('s_RESUMEPROP00001', 's_RESUMEPROP00002', 's_RESUMEPROP00003'), (steps, sessionId) => {
        const bot = new Bot({ sessionId, startedMs: START_MS })
        for (let i = 0; i < steps && bot.step(); i++) bot.run.tick()
        const v = bot.view()
        if (v.phase === 'finished' || bot.run.sessionState().responses.length === 0) return
        const save = saveOf(bot)
        const u = findUnfinished(save, START_MS + 60_000)
        const expected = v.segments.find((s) => s.status !== 'done' && s.status !== 'skipped')!.id
        expect(u?.next).toBe(expected)
        expect(u?.done).toEqual(v.segments.filter((s) => s.status === 'done').map((s) => s.id))
        const old = findUnfinished(legacy(save), START_MS + 60_000)
        expect(ORDER.indexOf(old!.next)).toBeLessThanOrEqual(ORDER.indexOf(expected))
        for (const id of old!.done) expect(u!.done).toContain(id)
      }),
      { numRuns: 30 },
    )
  })
})

describe('a sitting picked up more than once (UX-064)', () => {
  it('the parts finished are those of the whole sitting', () => {
    const first = played((v) => v.phase === 'item' && v.segment?.id === 'spatial')
    const base = saveOf(first)
    const u1 = findUnfinished(base, START_MS + 60_000)!
    const cont = new Bot({ sessionId: 's_RESUMETEST00002', startedMs: START_MS + 120_000, continues: { done: u1.done, skipped: u1.skipped } })
    cont.until((v) => v.phase === 'block' && v.segment?.id === 'memory')
    const save = saveOf(cont, base)
    const byId = (id: string): SaveSession => save.sessions.find((s) => s.session_id === id)!
    expect(byId('s_RESUMETEST00001').flags[CONTINUATION_FLAG]).toBeUndefined()
    expect(byId('s_RESUMETEST00002').flags[CONTINUATION_FLAG]).toBe(true)
    // The continuation's own flag says Spatial; the parts before it count as finished too (a later part has answers),
    // which is true of its sitting: a continuation never runs a part its sitting finished, nor one it skipped.
    expect(byId('s_RESUMETEST00002').flags[doneFlag('spatial')]).toBe(true)
    expect(byId('s_RESUMETEST00002').flags[doneFlag('rt')]).toBeUndefined()
    expect(partsFinished(byId('s_RESUMETEST00002')).done).toEqual(new Set(['rt', 'matrix_series', 'spatial']))
    const u2 = findUnfinished(save, START_MS + 180_000)!
    expect(u2.sessionId).toBe('s_RESUMETEST00002')
    expect(u2.done).toEqual(['rt', 'matrix_series', 'spatial'])
    expect(u2.next).toBe('memory')
    // Merged with itself (the autosave and a file of the same sitting), nothing changes.
    expect(findUnfinished(mergeAll([save, base], SAVE_CTX), START_MS + 180_000)).toEqual(u2)
  })
})

describe('the start time of a continuation (metadata only)', () => {
  it('is now when now is a later second than the interrupted start, else one second after it', () => {
    const utc = utcSeconds(START_MS)
    expect(continuationStartMs(START_MS + 5_000, utc)).toBe(START_MS + 5_000)
    expect(continuationStartMs(START_MS + 999, utc)).toBe(START_MS + 1_000)
    expect(continuationStartMs(START_MS, utc)).toBe(START_MS + 1_000)
    expect(continuationStartMs(START_MS - 86_400_000, utc)).toBe(START_MS + 1_000)
    expect(continuationStartMs(START_MS + 1_500.7, utc)).toBe(START_MS + 1_500)
    expect(continuationStartMs(START_MS, 'not a time')).toBe(START_MS)
  })
})
