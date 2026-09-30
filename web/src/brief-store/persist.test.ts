/**
 * Keeping the settings (AI.7; proposal §5.5; requirements R-17.1, R-17.12): the store writes nothing
 * until it is asked to (the under-18 path), keeps a prefs-only save under one autosave key, joins it
 * with the saves on the device, strips it from them on removal, and reads a save the person loads.
 */

import { describe, expect, it, vi } from 'vitest'
import type { StoredPrefs } from '../brief/stored'
import { AUTOSAVE_PREFIX, autosaveKey, type StorageLike } from '../save/autosave'
import { jcs } from '../save/jcs'
import { saveFileName, type DownloadEnv } from '../save/io'
import { mergeBriefPrefs } from '../save/brief-prefs'
import { parseSaveText } from '../save/parse'
import type { BriefContextV1, SaveFileV1 } from '../save/types'
import { validateSave } from '../save/validate'
import { PREFS_AUTOSAVE_ID, STATIC_SAVE_CTX, createPrefsStore, prefsOnlySave } from './persist'

/** An in-memory Storage that counts its writes. */
function fakeStorage(seed: Record<string, string> = {}): StorageLike & { data: Map<string, string>; writes: string[] } {
  const data = new Map(Object.entries(seed))
  const writes: string[] = []
  return {
    data,
    writes,
    get length() {
      return data.size
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      writes.push(`set ${k}`)
      data.set(k, v)
    },
    removeItem: (k) => {
      writes.push(`remove ${k}`)
      data.delete(k)
    },
  }
}

const NOW = Date.UTC(2026, 10, 3, 10, 0, 0)
const context = (slot: number, rev: number, over: Partial<BriefContextV1> = {}): BriefContextV1 => ({ slot, preset: 'coding', destination: 'claude_code_skill', tier: 'T1', mode: 'do', length: 'short', topics: { 'other/programming': 'skip' }, lines_on: [], lines_off: [], rev, ...over })
const prefs = (over: Partial<StoredPrefs> = {}): StoredPrefs => ({ v: 1, topics: 'topics-v1', groups: 'g1', notes_as_of: '2026-11', contexts: [context(1, 3)], fit_log: [], ...over })
const KEY = autosaveKey(PREFS_AUTOSAVE_ID)
const ANON = 'hb_7Q3m9Kx2Vw5rT8pL'

/** A store with timers under the test's control. */
function store(storage: StorageLike | null, over: Record<string, unknown> = {}) {
  const timers: (() => void)[] = []
  const s = createPrefsStore({ storage, wallClockMs: () => NOW, newAnonId: () => ANON, setTimer: (fn) => timers.push(fn), clearTimer: () => undefined, bindHide: false, ...over })
  return { s, fire: (): void => void timers.splice(0).forEach((f) => f()) }
}

const sessionSave = (bp?: StoredPrefs): SaveFileV1 => ({
  schema_version: '1.0.0',
  bank_version: 'm1-static',
  anon_id: 'hb_0000000000000000a',
  created_utc: '2026-11-01T10:00:00Z',
  sessions: [
    {
      session_id: 's_01J9ZK3QA',
      started_utc: '2026-11-01T09:00:00Z',
      duration_s: 60,
      device: { class: 'desktop', input: 'mouse', os_family: 'macOS', browser_family: 'Safari', refresh_hz_est: 120, timer_res_ms: 0.1, viewport: [1512, 861] },
      flags: {},
      responses: [],
    },
  ],
  seen_items: [],
  seen_families: [],
  ...(bp === undefined ? {} : { brief_prefs: bp }),
})

describe('nothing is written before the first write (the under-18 path)', () => {
  it('creating the store, loading and asking about status write nothing', () => {
    const storage = fakeStorage()
    const { s } = store(storage)
    expect(s.available).toBe(true)
    expect(s.load()).toEqual({ prefs: null, save: null })
    expect(s.status()).toBe('ok')
    s.flush()
    expect(storage.writes).toEqual([])
    expect(storage.data.size).toBe(0)
  })

  it('a write is scheduled, not made, until the timer fires or the page is flushed', () => {
    const storage = fakeStorage()
    const { s, fire } = store(storage)
    s.write(prefs())
    expect(storage.writes).toEqual([])
    fire()
    expect(storage.writes).toEqual([`set ${KEY}`])
  })
})

describe('the prefs-only save', () => {
  it('is stored under one autosave key as a valid save with no sessions, and read back by a new store', () => {
    const storage = fakeStorage()
    const a = store(storage)
    a.s.write(prefs())
    a.fire()
    const saved = JSON.parse(storage.data.get(KEY) as string) as SaveFileV1
    expect(KEY).toBe(`${AUTOSAVE_PREFIX}prefs`)
    expect(validateSave(saved).ok).toBe(true)
    expect(saved.sessions).toEqual([])
    expect(saved.seen_items).toEqual([])
    expect(saved.anon_id).toBe(ANON)
    expect(saved.created_utc).toBe('2026-11-03T10:00:00Z')
    expect(saved.brief_prefs).toEqual(mergeBriefPrefs([prefs()]))
    expect(storage.data.get(KEY)).toBe(jcs(saved))
    const b = store(storage)
    expect(b.s.load().prefs).toEqual(mergeBriefPrefs([prefs()]))
  })

  it('takes the anon_id of the saves already on the device instead of minting a second one', () => {
    const storage = fakeStorage({ [autosaveKey('s_01J9ZK3QA')]: jcs(sessionSave()) })
    const { s, fire } = store(storage, { newAnonId: () => 'hb_ZZZZZZZZZZZZZZZZZ' })
    s.load()
    s.write(prefs())
    fire()
    expect((JSON.parse(storage.data.get(KEY) as string) as SaveFileV1).anon_id).toBe('hb_0000000000000000a')
  })

  it('rewrites the one save on each change and keeps the newest', () => {
    const storage = fakeStorage()
    const { s, fire } = store(storage)
    s.write(prefs({ contexts: [context(1, 1)] }))
    s.write(prefs({ contexts: [context(1, 2, { mode: 'learn' })] }))
    fire()
    expect(storage.writes).toEqual([`set ${KEY}`])
    expect(((JSON.parse(storage.data.get(KEY) as string) as SaveFileV1).brief_prefs?.contexts[0] as BriefContextV1).mode).toBe('learn')
  })

  it('joins with the settings inside a session autosave: the higher rev wins per set', () => {
    const older = prefs({ contexts: [context(1, 2, { mode: 'do' }), context(2, 1, { preset: 'reading' })] })
    const storage = fakeStorage({ [autosaveKey('s_01J9ZK3QA')]: jcs(sessionSave(older)) })
    const a = store(storage)
    a.s.write(prefs({ contexts: [context(1, 5, { mode: 'learn' })] }))
    a.fire()
    const b = store(storage).s.load()
    const cs = b.prefs?.contexts as BriefContextV1[]
    expect(cs.map((c) => [c.slot, c.rev])).toEqual([[1, 5], [2, 1]])
    expect(cs[0]?.mode).toBe('learn')
    expect(b.save?.sessions).toHaveLength(1)
  })

  it('builds a valid save for any settings', () => {
    const save = prefsOnlySave(prefs(), ANON, NOW)
    expect(validateSave(save).ok).toBe(true)
    expect(save.bank_version).toBe(STATIC_SAVE_CTX.bank_version)
  })
})

describe('when the browser will not keep it', () => {
  it('reports "unavailable" without a storage, and still lets the person download', async () => {
    const { s } = store(null)
    const seen: string[] = []
    s.onStatus((x) => seen.push(x))
    expect(s.available).toBe(false)
    s.write(prefs())
    expect(s.status()).toBe('unavailable')
    expect(seen).toEqual(['unavailable'])
    const env = downloadEnv()
    const { s: t } = store(null, { downloadEnv: env.env })
    const name = t.download(prefs())
    await vi.waitFor(() => expect(env.saved().brief_prefs).toEqual(mergeBriefPrefs([prefs()])))
    expect(name).toBe(saveFileName(env.saved()))
  })

  it('reports an error, once, when a write is refused, and "ok" again after one lands', () => {
    const storage = fakeStorage()
    let refuse = true
    const set = storage.setItem
    storage.setItem = (k, v) => {
      if (refuse) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' })
      set(k, v)
    }
    const { s, fire } = store(storage)
    const seen: string[] = []
    const stop = s.onStatus((x) => seen.push(x))
    s.write(prefs())
    fire()
    expect(seen).toEqual(['error'])
    expect(s.status()).toBe('error')
    refuse = false
    s.write(prefs({ contexts: [context(1, 4)] }))
    fire()
    expect(seen).toEqual(['error', 'ok'])
    stop()
    s.write(prefs({ contexts: [context(1, 5)] }))
    fire()
    expect(seen).toEqual(['error', 'ok'])
  })
})

function downloadEnv(): { env: DownloadEnv; saved: () => SaveFileV1 } {
  let body = ''
  const env: DownloadEnv = {
    document: { createElement: () => ({ click: () => undefined, remove: () => undefined, style: {} }) as unknown as HTMLElement, body: { appendChild: () => undefined } as unknown as HTMLElement } as never,
    URL: {
      createObjectURL: (b: Blob | MediaSource) => {
        void (b as Blob).text().then((t) => (body = t))
        return 'blob:x'
      },
      revokeObjectURL: () => undefined,
    },
    setTimeout: () => undefined,
  }
  return { env, saved: () => JSON.parse(body) as SaveFileV1 }
}

describe('download', () => {
  it('puts the settings, and any sessions on the device, in one valid save file named as saves are named', async () => {
    const storage = fakeStorage({ [autosaveKey('s_01J9ZK3QA')]: jcs(sessionSave()) })
    const d = downloadEnv()
    const { s } = store(storage, { downloadEnv: d.env })
    const name = s.download(prefs())
    await vi.waitFor(() => expect(d.saved().brief_prefs).toBeDefined())
    const file = d.saved()
    expect(name).toBe(saveFileName(file))
    expect(name).toMatch(/^humanbench-[0-9A-Za-z]{6}-2026-11-03\.hbsave\.json$/)
    expect(validateSave(file).ok).toBe(true)
    expect(file.sessions).toHaveLength(1)
    expect(file.brief_prefs).toEqual(mergeBriefPrefs([prefs()]))
    expect(storage.writes).toEqual([]) // a download is not storage
  })

  it('refuses nothing to download', () => {
    expect(() => store(fakeStorage()).s.download(null)).toThrow(RangeError)
  })
})

describe('importSave', () => {
  const saveText = (bp?: StoredPrefs): string => jcs(sessionSave(bp))

  it('merges the settings of a pasted save into the current ones, keeping the higher rev per set', async () => {
    const { s } = store(fakeStorage())
    const r = await s.importSave(saveText(prefs({ contexts: [context(1, 9, { mode: 'learn' }), context(3, 1)] })), prefs({ contexts: [context(1, 2), context(2, 4)] }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.prefs.contexts.map((c) => [c.slot, c.rev])).toEqual([[1, 9], [2, 4], [3, 1]])
  })

  it('reads a file too, whatever its name', async () => {
    const { s } = store(fakeStorage())
    const file = new File([saveText(prefs())], 'humanbench-x.hbsave.txt', { type: 'text/plain' })
    const r = await s.importSave(file, null)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.prefs).toEqual(mergeBriefPrefs([prefs()]))
  })

  it('says so when a save has no settings, and gives a plain message for anything that is not a save', async () => {
    const { s } = store(fakeStorage())
    expect(await s.importSave(saveText(), null)).toEqual({ ok: false, message: 'That save has no notes settings.', none: true })
    for (const bad of ['', 'hello', '{"a":1}', '{oops', 'H4sIAAAA']) {
      const r = await s.importSave(bad, null)
      expect(r.ok, bad).toBe(false)
      if (!r.ok) expect(r.message.length, bad).toBeGreaterThan(5)
    }
    const damaged = JSON.parse(saveText(prefs())) as { brief_prefs: { contexts: { destination: string }[] } }
    damaged.brief_prefs.contexts[0]!.destination = 'I am not good at maths'
    const r = await s.importSave(JSON.stringify(damaged), null)
    expect(r.ok).toBe(false)
    expect((await parseSaveText(JSON.stringify(damaged))).ok).toBe(false)
  })
})

describe('remove', () => {
  it('deletes the settings save and strips the settings from the other saves, leaving their sessions', () => {
    const other = autosaveKey('s_01J9ZK3QA')
    const storage = fakeStorage({ [other]: jcs(sessionSave(prefs())), unrelated: 'keep me' })
    const { s, fire } = store(storage)
    s.write(prefs())
    fire()
    expect(storage.data.has(KEY)).toBe(true)
    s.remove()
    expect(storage.data.has(KEY)).toBe(false)
    const rest = JSON.parse(storage.data.get(other) as string) as SaveFileV1
    expect(rest.brief_prefs).toBeUndefined()
    expect(rest.sessions).toHaveLength(1)
    expect(validateSave(rest).ok).toBe(true)
    expect(storage.data.get('unrelated')).toBe('keep me')
    expect(store(storage).s.load().prefs).toBeNull()
  })

  it('cancels a write that has not happened yet, and leaves saves without settings and unreadable keys alone', () => {
    const plain = autosaveKey('s_01J9ZK3QB')
    const junk = autosaveKey('s_01J9ZK3QC')
    const storage = fakeStorage({ [plain]: jcs(sessionSave()), [junk]: '{not json' })
    const { s, fire } = store(storage)
    s.write(prefs())
    s.remove()
    fire()
    expect(storage.data.has(KEY)).toBe(false)
    expect(storage.data.get(plain)).toBe(jcs(sessionSave()))
    expect(storage.data.get(junk)).toBe('{not json')
    expect(storage.writes).toEqual([])
  })

  it('does nothing when there is no storage', () => {
    expect(() => store(null).s.remove()).not.toThrow()
  })
})

describe('the module', () => {
  it('names no network API, reads no clock of its own, and stays out of scoring and rendering', () => {
    const src = import.meta.glob<string>('./persist.ts', { query: '?raw', import: 'default', eager: true })['./persist.ts'] ?? ''
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/\b(fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|navigator\.share|Date\.now|new Date\b|Math\.random|performance\.)/)
    const imports = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1] as string)
    expect(imports.filter((i) => /engine|tasks|render|viz/.test(i))).toEqual([])
  })
})
