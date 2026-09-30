import { describe, expect, it } from 'vitest'
import { AUTOSAVE_PREFIX, autosaveKey, restoreAutosaves } from '../save/autosave'
import { sameSave } from '../save/merge'
import { SAVE_CTX } from './constants'
import { SessionPersister } from './persist'
import { Bot, SpyStorage } from './bot'
import { priorItemCounts } from './coverage'

const WALL = 1_790_000_600_000

function timers(): { setTimer: (fn: () => void) => number; clearTimer: () => void; fire: () => void; pending: () => number } {
  const q: (() => void)[] = []
  return {
    setTimer: (fn) => q.push(fn),
    clearTimer: () => q.splice(0, q.length),
    fire: () => q.splice(0, q.length).forEach((f) => f()),
    pending: () => q.length,
  }
}

function persister(bot: Bot, storage: SpyStorage | null, extra: Partial<ConstructorParameters<typeof SessionPersister>[1]> = {}) {
  const t = timers()
  const p = new SessionPersister(bot.run, { base: null, storage, wallClockMs: () => WALL, setTimer: t.setTimer, clearTimer: t.clearTimer, bindHide: false, ...extra })
  return { p, t }
}

/** Runs the bot to its first counted answer (Matrix & Series only), so the session holds one response. */
function answerOne(bot: Bot): void {
  bot.until((v) => v.phase === 'confidence')
  bot.run.confirmConfidence(bot.view().confidence!.startPct)
}

const MAT_ONLY = ['RT', 'WM', 'PS', 'SPA', 'QR'] as const

describe('autosave through the save library (M1.15, M1.17)', () => {
  it('writes the session as a complete save under its own key, coalescing changes', () => {
    const bot = new Bot({ sessionId: 's_PERSIST00000001', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    const s = new SpyStorage()
    const { p, t } = persister(bot, s)
    bot.until((v) => v.phase === 'confidence')
    bot.run.confirmConfidence(bot.view().confidence!.startPct)
    p.schedule()
    p.schedule()
    expect(s.writes).toEqual([]) // waits for the timer
    t.fire()
    expect(s.writes).toEqual([`set:${autosaveKey('s_PERSIST00000001')}`])
    const restored = restoreAutosaves(SAVE_CTX, s).save!
    expect(restored.sessions).toHaveLength(1)
    expect(restored.sessions[0]!.session_id).toBe('s_PERSIST00000001')
    expect(restored.sessions[0]!.responses).toHaveLength(1)
    expect(restored.anon_id).toBe(p.anonId)
  })

  it('the autosave is what currentSave() gives, so restoring and merging is idempotent (R-8.1)', () => {
    const bot = new Bot({ sessionId: 's_PERSIST00000002', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    const s = new SpyStorage()
    const { p } = persister(bot, s)
    bot.until((v) => v.phase === 'confidence')
    bot.run.confirmConfidence(bot.view().confidence!.startPct)
    p.schedule()
    expect(p.flush()).toBe(true)
    const restored = restoreAutosaves(SAVE_CTX, s).save!
    expect(sameSave(restored, p.currentSave())).toBe(true)
  })

  it('adds the session to the save the person started from, keeping its anon id and history', () => {
    const first = new Bot({ sessionId: 's_PERSIST00000003', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    const s1 = new SpyStorage()
    const a = persister(first, s1)
    first.until((v) => v.phase === 'confidence')
    first.run.confirmConfidence(first.view().confidence!.startPct)
    first.run.finishEarly()
    const base = a.p.currentSave()

    const second = new Bot({ sessionId: 's_PERSIST00000004', priorItemCounts: priorItemCounts(base), seenFamilies: base.seen_families, skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    const s2 = new SpyStorage()
    const b = persister(second, s2, { base })
    second.until((v) => v.phase === 'confidence')
    second.run.confirmConfidence(second.view().confidence!.startPct)
    second.run.finishEarly()
    b.p.schedule()
    b.p.flush()
    const save = restoreAutosaves(SAVE_CTX, s2).save!
    expect(save.anon_id).toBe(base.anon_id)
    expect(save.sessions.map((x) => x.session_id).sort()).toEqual(['s_PERSIST00000003', 's_PERSIST00000004'])
    expect(save.seen_families.length).toBeGreaterThan(base.seen_families.length)
  })

  it('stamps the versions of this build and the wall-clock time of the write', () => {
    const bot = new Bot({ sessionId: 's_PERSIST00000005' })
    const { p } = persister(bot, new SpyStorage())
    const save = p.currentSave()
    expect(save.bank_version).toBe(SAVE_CTX.bank_version)
    expect(save.created_utc).toBe('2026-09-21T14:23:20Z')
  })

  it('a session with no answer yet writes nothing: an abandoned start leaves no session behind', () => {
    const bot = new Bot({ sessionId: 's_PERSIST0000000A', skipped: [...MAT_ONLY] })
    const s = new SpyStorage()
    const { p, t } = persister(bot, s)
    p.schedule()
    expect(t.pending()).toBe(0)
    expect(p.flush()).toBe(true) // nothing pending
    p.dispose()
    expect(s.writes).toEqual([])
    expect(restoreAutosaves(SAVE_CTX, s).save).toBeNull()
    // The first answer makes it a session.
    answerOne(bot)
    p.schedule()
    expect(t.pending()).toBe(1)
    t.fire()
    expect(restoreAutosaves(SAVE_CTX, s).save!.sessions).toHaveLength(1)
    // The download is not affected: currentSave still holds the (empty) session.
    const empty = new Bot({ sessionId: 's_PERSIST0000000B' })
    expect(persister(empty, s).p.currentSave().sessions[0]!.responses).toEqual([])
  })

  it('reports storage that is missing or refuses, and the session goes on', () => {
    const bot = new Bot({ sessionId: 's_PERSIST00000006', skipped: [...MAT_ONLY] })
    answerOne(bot)
    const seen: string[] = []
    const none = persister(bot, null, { onStatus: (s) => seen.push(s) })
    none.p.schedule()
    none.t.fire()
    expect(none.p.status).toBe('unavailable')
    expect(seen).toEqual(['unavailable'])

    const full = new SpyStorage()
    full.setItem = () => {
      throw Object.assign(new Error('full'), { name: 'QuotaExceededError' })
    }
    const seen2: string[] = []
    const b = persister(bot, full, { onStatus: (s) => seen2.push(s) })
    b.p.schedule()
    b.t.fire()
    expect(b.p.status).toBe('error')
    expect(seen2).toEqual(['error'])
    expect(bot.run.view().phase).toBe('item') // the session goes on
  })

  it('dispose writes what is pending', () => {
    const bot = new Bot({ sessionId: 's_PERSIST00000007', skipped: [...MAT_ONLY] })
    const s = new SpyStorage()
    const { p } = persister(bot, s)
    answerOne(bot)
    p.schedule()
    p.dispose()
    expect(s.writes).toEqual([`set:${AUTOSAVE_PREFIX}s_PERSIST00000007`])
  })
})

describe('autosave hygiene', () => {
  it('exposes its key, and the flow can drop the autosaves this save already holds', async () => {
    const { pruneAutosaves, autosaveKeys } = await import('../save/autosave')
    const first = new Bot({ sessionId: 's_PERSIST00000008', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    const s = new SpyStorage()
    const a = persister(first, s)
    first.until((v) => v.phase === 'confidence')
    first.run.confirmConfidence(first.view().confidence!.startPct)
    first.run.finishEarly()
    a.p.schedule()
    a.p.flush()
    expect(a.p.key).toBe(autosaveKey('s_PERSIST00000008'))
    const base = a.p.currentSave()

    const second = new Bot({ sessionId: 's_PERSIST00000009', priorItemCounts: priorItemCounts(base), skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'], seenFamilies: base.seen_families })
    const b = persister(second, s, { base })
    second.until((v) => v.phase === 'confidence')
    second.run.confirmConfidence(second.view().confidence!.startPct)
    second.run.finishEarly()
    b.p.schedule()
    b.p.flush()
    expect(autosaveKeys(s)).toHaveLength(2)
    // The second save holds the first session, so the first autosave is redundant; its own key stays.
    expect(pruneAutosaves(b.p.currentSave(), s, b.p.key)).toEqual([a.p.key])
    expect(autosaveKeys(s)).toEqual([b.p.key])
  })
})

describe('families shown outside the session (the reveal’s worked examples, DESIGN §10, §7.7)', () => {
  it('are listed in the save’s seen_families, kept in the autosave and left out of a later session', () => {
    const bot = new Bot({ sessionId: 's_PERSISTSEEN0001', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    const s = new SpyStorage()
    const { p, t } = persister(bot, s)
    answerOne(bot)
    p.schedule()
    t.fire()
    const before = restoreAutosaves(SAVE_CTX, s).save!.seen_families
    p.addSeenFamilies(['f:worked:aaaaaaaaaaaa', 'f:worked:bbbbbbbbbbbb'])
    expect(p.currentSave().seen_families).toEqual(expect.arrayContaining([...before, 'f:worked:aaaaaaaaaaaa', 'f:worked:bbbbbbbbbbbb']))
    // Written at once: nothing is left pending on the results screen.
    expect(t.pending()).toBe(0)
    expect(restoreAutosaves(SAVE_CTX, s).save!.seen_families).toContain('f:worked:bbbbbbbbbbbb')
    // Twice is the same, and a new session started from this save excludes them.
    p.addSeenFamilies(['f:worked:aaaaaaaaaaaa'])
    expect(p.currentSave().seen_families.filter((f) => f === 'f:worked:aaaaaaaaaaaa')).toHaveLength(1)
    expect(priorItemCounts(p.currentSave()).MAT).toBeGreaterThan(0)
  })

  it('a session with no answer writes nothing, but the download still lists them', () => {
    const bot = new Bot({ sessionId: 's_PERSISTSEEN0002', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    const s = new SpyStorage()
    const { p, t } = persister(bot, s)
    p.addSeenFamilies(['f:worked:cccccccccccc'])
    t.fire()
    expect(s.writes).toEqual([])
    expect(p.currentSave().seen_families).toContain('f:worked:cccccccccccc')
  })
})
