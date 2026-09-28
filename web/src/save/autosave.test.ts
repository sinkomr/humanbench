import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import {
  AUTOSAVE_PREFIX,
  autosaveKey,
  autosaveKeys,
  bindFlushOnHide,
  browserStorage,
  clearAutosave,
  createAutosaver,
  isQuotaError,
  pruneAutosaves,
  restoreAutosaves,
  type AutosaveError,
  type StorageLike,
} from './autosave'
import { saveWithSession, type SessionState } from './create'
import { jcs } from './jcs'
import { mergeAll } from './merge'
import { arbSaveFamily, TEST_CTX } from './testing'
import type { SaveFileV1 } from './types'

const ctx = TEST_CTX
const T = Date.UTC(2026, 9, 3, 17, 20, 2)

class QuotaError extends Error {
  override name = 'QuotaExceededError'
  readonly code = 22
}

/** In-memory Web Storage with an optional size quota (UTF-16 units of keys + values) and fault modes. */
class FakeStorage implements StorageLike {
  readonly map = new Map<string, string>()
  failAll = false
  constructor(private readonly quota = Infinity) {}
  private guard(): void {
    if (this.failAll) throw Object.assign(new Error('The operation is insecure.'), { name: 'SecurityError' })
  }
  get length(): number {
    this.guard()
    return this.map.size
  }
  key(i: number): string | null {
    this.guard()
    return [...this.map.keys()][i] ?? null
  }
  getItem(k: string): string | null {
    this.guard()
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.guard()
    let used = k.length + v.length
    for (const [kk, vv] of this.map) if (kk !== k) used += kk.length + vv.length
    if (used > this.quota) throw new QuotaError('quota exceeded')
    this.map.set(k, v)
  }
  removeItem(k: string): void {
    this.guard()
    this.map.delete(k)
  }
}

/** Manual timers. */
function fakeTimers() {
  const pending = new Map<number, () => void>()
  let next = 1
  return {
    setTimer: (fn: () => void) => {
      pending.set(next, fn)
      return next++
    },
    clearTimer: (h: unknown) => void pending.delete(h as number),
    fire() {
      const fns = [...pending.values()]
      pending.clear()
      for (const f of fns) f()
    },
    get count() {
      return pending.size
    },
  }
}

const state = (sessionId: string, n: number, startedMs = T): SessionState => ({
  sessionId,
  startedMs,
  durationS: n * 40,
  device: { class: 'phone', input: 'touch', os_family: 'iOS', browser_family: 'Safari', refresh_hz_est: 60, timer_res_ms: 1, viewport: [390, 844] },
  flags: {},
  responses: Array.from({ length: n }, (_, i) => [`i:series:1.0.0:${sessionId}-${i}`, 0, String(i), 1, 9000 + i, 70] as SessionState['responses'][number]),
  seenItems: Array.from({ length: n }, (_, i) => `i:series:1.0.0:${sessionId}-${i}`),
  seenFamilies: [],
})

const build = (sessionId: string, n: number, base: SaveFileV1 | null = null): SaveFileV1 =>
  saveWithSession(base, state(sessionId, n), { ctx, createdMs: T + n * 1000, anonId: 'hb_7Q3m9Kx2Vw5rT8pL' })

describe('localStorage autosave (DESIGN §8 crash recovery)', () => {
  it('coalesces changes: one write, at most delayMs after the first change, with the latest state', () => {
    const storage = new FakeStorage()
    const timers = fakeTimers()
    const saver = createAutosaver('s_01J9ZK3QA', { storage, ...timers, delayMs: 250 })
    const builds = vi.fn((n: number) => build('s_01J9ZK3QA', n))
    saver.schedule(() => builds(1))
    saver.schedule(() => builds(2))
    saver.schedule(() => builds(3))
    expect(saver.pending).toBe(true)
    expect(timers.count).toBe(1)
    expect(storage.map.size).toBe(0)
    timers.fire()
    expect(builds).toHaveBeenCalledTimes(1)
    expect(builds).toHaveBeenCalledWith(3)
    expect(saver.pending).toBe(false)
    expect(storage.getItem(autosaveKey('s_01J9ZK3QA'))).toBe(jcs(build('s_01J9ZK3QA', 3)))
  })

  it('flush writes now and cancels the timer; cancel drops the change', () => {
    const storage = new FakeStorage()
    const timers = fakeTimers()
    const saver = createAutosaver('s_01J9ZK3QA', { storage, ...timers })
    expect(saver.flush()).toBe(true)
    saver.schedule(() => build('s_01J9ZK3QA', 1))
    expect(saver.flush()).toBe(true)
    expect(timers.count).toBe(0)
    expect(storage.map.size).toBe(1)
    saver.schedule(() => build('s_01J9ZK3QA', 2))
    saver.cancel()
    timers.fire()
    expect(storage.getItem(saver.key)).toBe(jcs(build('s_01J9ZK3QA', 1)))
  })

  it('uses real timers by default', async () => {
    const storage = new FakeStorage()
    const saver = createAutosaver('s_01J9ZK3QA', { storage, delayMs: 5 })
    saver.schedule(() => build('s_01J9ZK3QA', 1))
    await new Promise((r) => setTimeout(r, 30))
    expect(storage.map.size).toBe(1)
  })

  it('restores by merging every autosave; ignores other keys; reports unreadable entries and leaves them', () => {
    const storage = new FakeStorage()
    storage.setItem('unrelated', 'x')
    storage.setItem(autosaveKey('s_01J9ZK3QA'), jcs(build('s_01J9ZK3QA', 2)))
    storage.setItem(autosaveKey('s_01J9ZK3QB'), jcs(build('s_01J9ZK3QB', 3)))
    storage.setItem(autosaveKey('s_01J9ZK3QC'), '{"truncated": ')
    storage.setItem(autosaveKey('s_01J9ZK3QD'), JSON.stringify({ ...build('s_01J9ZK3QD', 1), schema_version: '9.0.0' }))
    const r = restoreAutosaves(ctx, storage)
    expect(r.keys).toEqual([autosaveKey('s_01J9ZK3QA'), autosaveKey('s_01J9ZK3QB')])
    expect(r.failures).toEqual([
      { key: autosaveKey('s_01J9ZK3QC'), code: 'not_a_save' },
      { key: autosaveKey('s_01J9ZK3QD'), code: 'newer_version' },
    ])
    expect(r.save?.sessions.map((s) => s.session_id)).toEqual(['s_01J9ZK3QA', 's_01J9ZK3QB'])
    expect(storage.map.size).toBe(5)
    expect(restoreAutosaves(ctx, new FakeStorage())).toEqual({ save: null, keys: [], failures: [] })
  })

  it('on a quota error, removes only autosaves the new save already holds, then retries', () => {
    const a = build('s_01J9ZK3QA', 4)
    const both = build('s_01J9ZK3QB', 4, a)
    const unrelated = build('s_01J9ZK3QC', 4)
    const storage = new FakeStorage(jcs(both).length + jcs(unrelated).length + 200)
    storage.map.set(autosaveKey('s_01J9ZK3QA'), jcs(a))
    storage.map.set(autosaveKey('s_01J9ZK3QC'), jcs(unrelated))
    const errors: AutosaveError[] = []
    const saver = createAutosaver('s_01J9ZK3QB', { storage, onError: (e) => errors.push(e) })
    saver.schedule(() => both)
    expect(saver.flush()).toBe(true)
    expect(errors).toEqual([])
    expect([...storage.map.keys()].sort()).toEqual([autosaveKey('s_01J9ZK3QB'), autosaveKey('s_01J9ZK3QC')])
    // Nothing redundant left to prune: the next overflow is reported, and no data is deleted.
    const bigger = build('s_01J9ZK3QB', 40, a)
    saver.schedule(() => bigger)
    expect(saver.flush()).toBe(false)
    expect(errors.map((e) => e.kind)).toEqual(['quota'])
    expect(storage.getItem(autosaveKey('s_01J9ZK3QC'))).toBe(jcs(unrelated))
    expect(storage.getItem(autosaveKey('s_01J9ZK3QB'))).toBe(jcs(both))
  })

  it('never throws when storage is missing, blocked or failing, or the build fails', () => {
    const errors: AutosaveError[] = []
    const onError = (e: AutosaveError) => errors.push(e)
    const none = createAutosaver('s_01J9ZK3QA', { storage: null, onError })
    none.schedule(() => build('s_01J9ZK3QA', 1))
    expect(none.flush()).toBe(false)
    const blocked = new FakeStorage()
    blocked.failAll = true
    const b = createAutosaver('s_01J9ZK3QA', { storage: blocked, onError })
    b.schedule(() => build('s_01J9ZK3QA', 1))
    expect(b.flush()).toBe(false)
    const c = createAutosaver('s_01J9ZK3QA', { storage: new FakeStorage(), onError })
    c.schedule(() => {
      throw new Error('state not ready')
    })
    expect(c.flush()).toBe(false)
    const throwingHandler = createAutosaver('s_01J9ZK3QA', { storage: null, onError: () => { throw new Error('handler bug') } })
    throwingHandler.schedule(() => build('s_01J9ZK3QA', 1))
    expect(() => throwingHandler.flush()).not.toThrow()
    expect(errors.map((e) => e.kind)).toEqual(['unavailable', 'write_failed', 'build_failed'])
    expect(autosaveKeys(blocked)).toEqual([])
    expect(restoreAutosaves(ctx, blocked)).toEqual({ save: null, keys: [], failures: [] })
    expect(clearAutosave('s_01J9ZK3QA', blocked)).toBe(false)
    expect(pruneAutosaves(build('s_01J9ZK3QA', 1), blocked)).toEqual([])
    expect(restoreAutosaves(ctx, null).save).toBeNull()
  })

  it('recognises the quota errors of every engine', () => {
    expect(isQuotaError(new QuotaError('x'))).toBe(true)
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true)
    expect(isQuotaError({ code: 22 })).toBe(true)
    expect(isQuotaError({ code: 1014 })).toBe(true)
    expect(isQuotaError(new Error('x'))).toBe(false)
    expect(isQuotaError(null)).toBe(false)
    expect(isQuotaError('QuotaExceededError')).toBe(false)
  })

  it('browserStorage() is null when localStorage is absent or its accessor throws', () => {
    const g = globalThis as Record<string, unknown>
    const had = Object.getOwnPropertyDescriptor(g, 'localStorage')
    try {
      Object.defineProperty(g, 'localStorage', { configurable: true, get: () => { throw new Error('SecurityError') } })
      expect(browserStorage()).toBeNull()
      Object.defineProperty(g, 'localStorage', { configurable: true, value: undefined })
      expect(browserStorage()).toBeNull()
      const fake = new FakeStorage()
      Object.defineProperty(g, 'localStorage', { configurable: true, value: fake })
      expect(browserStorage()).toBe(fake)
    } finally {
      if (had) Object.defineProperty(g, 'localStorage', had)
      else delete g.localStorage
    }
  })

  it('clearAutosave and pruneAutosaves remove only what they should', () => {
    const storage = new FakeStorage()
    const a = build('s_01J9ZK3QA', 2)
    const b = build('s_01J9ZK3QB', 2)
    storage.setItem(autosaveKey('s_01J9ZK3QA'), jcs(a))
    storage.setItem(autosaveKey('s_01J9ZK3QB'), jcs(b))
    storage.setItem(`${AUTOSAVE_PREFIX}junk`, 'not json')
    expect(pruneAutosaves(a, storage)).toEqual([autosaveKey('s_01J9ZK3QA')])
    expect(pruneAutosaves(build('s_01J9ZK3QA', 3, b), storage, autosaveKey('s_01J9ZK3QB'))).toEqual([])
    expect(pruneAutosaves(build('s_01J9ZK3QA', 3, b), storage)).toEqual([autosaveKey('s_01J9ZK3QB')])
    expect(clearAutosave('s_01J9ZK3QB', storage)).toBe(true)
    expect([...storage.map.keys()]).toEqual([`${AUTOSAVE_PREFIX}junk`])
  })

  it('flushes on pagehide and on hidden visibility, and unbinds', () => {
    const listeners = new Map<string, () => void>()
    const target = { addEventListener: (t: string, f: () => void) => void listeners.set(t, f), removeEventListener: (t: string) => void listeners.delete(t) }
    const doc = { ...target, visibilityState: 'visible' }
    const flush = vi.fn(() => true)
    const saver = { key: 'k', pending: true, schedule: vi.fn(), flush, cancel: vi.fn() }
    const unbind = bindFlushOnHide(saver, target, doc)
    listeners.get('visibilitychange')?.()
    expect(flush).not.toHaveBeenCalled()
    doc.visibilityState = 'hidden'
    listeners.get('visibilitychange')?.()
    listeners.get('pagehide')?.()
    expect(flush).toHaveBeenCalledTimes(2)
    unbind()
    expect(listeners.size).toBe(0)
  })

  it('restore after any sequence of per-session writes equals the merge of the last write per session (property)', () => {
    fc.assert(
      fc.property(arbSaveFamily(4), fc.array(fc.nat(3), { minLength: 1, maxLength: 8 }), (saves, order) => {
        const storage = new FakeStorage()
        const last = new Map<string, SaveFileV1>()
        for (const i of order) {
          const s = saves[i] as SaveFileV1
          const sid = `s_KEY0000${i}`
          const saver = createAutosaver(sid, { storage })
          saver.schedule(() => s)
          expect(saver.flush()).toBe(true)
          last.set(sid, s)
        }
        const r = restoreAutosaves(ctx, storage)
        expect(r.failures).toEqual([])
        expect(jcs(r.save)).toBe(jcs(mergeAll([...last.values()], ctx)))
      }),
      { numRuns: 150 },
    )
  })
})
