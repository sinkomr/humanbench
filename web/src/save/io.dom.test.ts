import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPrefsStore } from '../brief-store/persist'
import { autosaveKey, type StorageLike } from './autosave'
import { briefPrefsCovered, mergeBriefPrefs, restoreBriefPrefs } from './brief-prefs'
import { saveWithSession } from './create'
import { copySaveCode, deviceBriefPrefs, downloadSave, REVOKE_AFTER_MS, saveFileName, saveText, shareSave, withDeviceBriefPrefs, type DownloadEnv, type ShareEnv } from './io'
import { jcs } from './jcs'
import { parseSaveText, readSaveFile } from './parse'
import { arbBriefPrefs, TEST_CTX } from './testing'
import type { BriefContextV1, BriefPrefsV1, SaveFileV1 } from './types'
import { validateSave } from './validate'

const T = Date.UTC(2026, 9, 3, 17, 20, 2)
const save = saveWithSession(
  null,
  {
    sessionId: 's_01J9ZK3QA',
    startedMs: T,
    durationS: 3411,
    device: { class: 'phone', input: 'touch', os_family: 'iOS', browser_family: 'Safari', refresh_hz_est: 60, timer_res_ms: 1, viewport: [390, 844] },
    flags: { paste_events: 0 },
    responses: [['i:mat:f0182:v3', 0, 'C', 1, 41250, 80]],
    seenItems: ['i:mat:f0182:v3'],
    seenFamilies: ['f:mat:0182'],
  },
  { ctx: TEST_CTX, createdMs: T + 3_600_000, anonId: 'hb_7Q3m9Kx2Vw5rT8pL' },
)

interface Captured {
  blobs: Blob[]
  clicks: HTMLAnchorElement[]
  revoked: string[]
  timers: [() => void, number][]
}

function downloadEnv(): { env: DownloadEnv; got: Captured } {
  const got: Captured = { blobs: [], clicks: [], revoked: [], timers: [] }
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.isConnected).toBe(true)
    got.clicks.push(this)
  })
  const env: DownloadEnv = {
    document,
    URL: {
      createObjectURL: (b: Blob | MediaSource) => {
        got.blobs.push(b as Blob)
        return `blob:hb/${got.blobs.length}`
      },
      revokeObjectURL: (u: string) => void got.revoked.push(u),
    },
    setTimeout: (fn, ms) => got.timers.push([fn, ms]),
  }
  return { env, got }
}

// The names carry the person's local day (D19): the tests of the fixed names run in UTC, the zone tests set their own.
beforeEach(() => {
  vi.stubEnv('TZ', 'UTC')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  document.body.innerHTML = ''
})

describe('save download / share / copy (DESIGN §8)', () => {
  it('names the file humanbench-<shortid>-<date>.hbsave.json', () => {
    expect(saveFileName(save)).toBe('humanbench-7Q3m9K-2026-10-03.hbsave.json')
  })

  it('downloads the canonical JSON through an <a download> that is removed afterwards', async () => {
    const { env, got } = downloadEnv()
    expect(downloadSave(save, env)).toBe('humanbench-7Q3m9K-2026-10-03.hbsave.json')
    expect(got.clicks).toHaveLength(1)
    const a = got.clicks[0] as HTMLAnchorElement
    expect(a.download).toBe('humanbench-7Q3m9K-2026-10-03.hbsave.json')
    expect(a.getAttribute('href')).toBe('blob:hb/1')
    expect(a.isConnected).toBe(false)
    const blob = got.blobs[0] as Blob
    expect(blob.type).toBe('application/json')
    const text = await blob.text()
    expect(text).toBe(jcs(save))
    expect(text).toBe(saveText(save))
    // The object URL outlives the click (iOS reads it later), then is revoked.
    expect(got.revoked).toEqual([])
    expect(got.timers.map(([, ms]) => ms)).toEqual([REVOKE_AFTER_MS])
    got.timers[0]?.[0]()
    expect(got.revoked).toEqual(['blob:hb/1'])
    // The downloaded bytes load back (upload by content).
    const back = await readSaveFile(blob)
    expect(back.ok && jcs(back.save)).toBe(jcs(save))
  })

  it('shares a JSON file when the platform can (Web Share API level 2)', async () => {
    const { env, got } = downloadEnv()
    const shared: ShareData[] = []
    const shareEnv: ShareEnv = { ...env, navigator: { canShare: () => true, share: async (d?: ShareData) => void shared.push(d ?? {}) } }
    expect(await shareSave(save, shareEnv)).toBe('shared')
    const file = shared[0]?.files?.[0] as File
    expect(file.name).toBe('humanbench-7Q3m9K-2026-10-03.hbsave.json')
    expect(file.type).toBe('application/json')
    expect(await file.text()).toBe(jcs(save))
    expect(got.clicks).toHaveLength(0)
  })

  it('falls back to a text/plain .txt file when only text files can be shared', async () => {
    const { env } = downloadEnv()
    const shared: File[] = []
    const shareEnv: ShareEnv = {
      ...env,
      navigator: {
        canShare: (d?: ShareData) => d?.files?.[0]?.type === 'text/plain',
        share: async (d?: ShareData) => void shared.push(...(d?.files ?? [])),
      },
    }
    expect(await shareSave(save, shareEnv)).toBe('shared')
    expect(shared[0]?.name).toBe('humanbench-7Q3m9K-2026-10-03.hbsave.txt')
    const back = await readSaveFile(shared[0] as File)
    expect(back.ok && jcs(back.save)).toBe(jcs(save))
  })

  it('a dismissed share sheet is "cancelled" and forces no download', async () => {
    const { env, got } = downloadEnv()
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' })
    const shareEnv: ShareEnv = { ...env, navigator: { canShare: () => true, share: () => Promise.reject(abort) } }
    expect(await shareSave(save, shareEnv)).toBe('cancelled')
    expect(got.clicks).toHaveLength(0)
  })

  it('downloads instead when sharing is unsupported, refused or fails', async () => {
    for (const navigator of [
      {},
      { canShare: () => false, share: async () => undefined },
      { canShare: () => { throw new TypeError('bad data') }, share: async () => undefined },
      { canShare: () => true, share: () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })) },
    ] as ShareEnv['navigator'][]) {
      const { env, got } = downloadEnv()
      expect(await shareSave(save, { ...env, navigator })).toBe('downloaded')
      expect(got.clicks).toHaveLength(1)
      vi.restoreAllMocks()
    }
  })

  it('copies the save code with a promise-valued ClipboardItem (Safari keeps the gesture)', async () => {
    const written: Record<string, Promise<Blob> | Blob | string>[] = []
    class FakeClipboardItem {
      constructor(readonly data: Record<string, Promise<Blob> | Blob | string>) {
        written.push(data)
      }
    }
    const write = vi.fn(async () => undefined)
    const r = await copySaveCode(save, { clipboard: { write }, ClipboardItem: FakeClipboardItem as unknown as typeof ClipboardItem })
    expect(r.copied).toBe(true)
    expect(write).toHaveBeenCalledTimes(1)
    const blob = await (written[0]?.['text/plain'] as Promise<Blob>)
    expect(await blob.text()).toBe(r.code)
    const back = await parseSaveText(r.code)
    expect(back.ok && jcs(back.save)).toBe(jcs(save))
  })

  it('falls back to writeText, then to returning the code uncopied', async () => {
    const writeText = vi.fn(async () => undefined)
    const refused = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    const viaText = await copySaveCode(save, { clipboard: { write: refused, writeText }, ClipboardItem: class {} as unknown as typeof ClipboardItem })
    expect(viaText.copied).toBe(true)
    expect(writeText).toHaveBeenCalledWith(viaText.code)
    const none = await copySaveCode(save, { clipboard: { writeText: refused } })
    expect(none).toEqual({ code: viaText.code, copied: false })
    expect(await copySaveCode(save, {})).toEqual({ code: viaText.code, copied: false })
  })

  it('the default environments are wired to the browser globals', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const create = vi.fn(() => 'blob:x')
    const revoke = vi.fn()
    const had = { create: Object.getOwnPropertyDescriptor(URL, 'createObjectURL'), revoke: Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL') }
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    vi.useFakeTimers()
    try {
      expect(downloadSave(save)).toMatch(/\.hbsave\.json$/)
      expect(click).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(REVOKE_AFTER_MS)
      expect(revoke).toHaveBeenCalledWith('blob:x')
      // jsdom has no Web Share API, so shareSave downloads.
      expect(await shareSave(save)).toBe('downloaded')
      expect(click).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
      for (const [name, d] of [['createObjectURL', had.create], ['revokeObjectURL', had.revoke]] as const) {
        if (d) Object.defineProperty(URL, name, d)
        else delete (URL as unknown as Record<string, unknown>)[name]
      }
    }
    const r = await copySaveCode(save)
    expect(r.code).toMatch(/^H4sI/)
  })
})

describe('the file name carries the person\'s local day (D19; §8)', () => {
  const at = (created_utc: string): SaveFileV1 => ({ ...save, created_utc })

  it('keeps the shape humanbench-<shortid>-<YYYY-MM-DD>.hbsave.json, whatever the zone', () => {
    for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Kolkata']) {
      vi.stubEnv('TZ', tz)
      expect(saveFileName(save), tz).toMatch(/^humanbench-7Q3m9K-\d{4}-\d{2}-\d{2}\.hbsave\.json$/)
    }
  })

  it('an evening save in the Americas is dated that evening\'s day, not tomorrow\'s (UTC)', () => {
    // 2026-10-06 03:30 UTC is 8:30 pm on the 5th in Los Angeles.
    const evening = at('2026-10-06T03:30:00Z')
    vi.stubEnv('TZ', 'America/Los_Angeles')
    expect(saveFileName(evening)).toBe('humanbench-7Q3m9K-2026-10-05.hbsave.json')
    vi.stubEnv('TZ', 'America/New_York')
    expect(saveFileName(evening)).toBe('humanbench-7Q3m9K-2026-10-05.hbsave.json')
    vi.stubEnv('TZ', 'UTC')
    expect(saveFileName(evening)).toBe('humanbench-7Q3m9K-2026-10-06.hbsave.json')
  })

  it('a morning save east of Greenwich is dated that morning\'s day, not yesterday\'s (UTC)', () => {
    // 2026-10-05 20:30 UTC is 09:30 on the 6th in Auckland (NZDT, UTC+13).
    vi.stubEnv('TZ', 'Pacific/Auckland')
    expect(saveFileName(at('2026-10-05T20:30:00Z'))).toBe('humanbench-7Q3m9K-2026-10-06.hbsave.json')
  })

  it('changes day at the person\'s local midnight, one second apart, on both sides of UTC', () => {
    const cases: readonly [string, string, string][] = [
      ['America/Los_Angeles', '2026-10-06T06:59:59Z', '2026-10-06T07:00:00Z'],
      ['Pacific/Auckland', '2026-10-05T10:59:59Z', '2026-10-05T11:00:00Z'],
      ['Asia/Kolkata', '2026-10-05T18:29:59Z', '2026-10-05T18:30:00Z'],
    ]
    for (const [tz, last, first] of cases) {
      vi.stubEnv('TZ', tz)
      expect(saveFileName(at(last)), `${tz} ${last}`).toBe('humanbench-7Q3m9K-2026-10-05.hbsave.json')
      expect(saveFileName(at(first)), `${tz} ${first}`).toBe('humanbench-7Q3m9K-2026-10-06.hbsave.json')
    }
  })

  it('uses the same local day as the card file name made at the same moment', async () => {
    const { cardFileName } = await import('../viz/export')
    for (const tz of ['America/Los_Angeles', 'Pacific/Auckland', 'UTC']) {
      vi.stubEnv('TZ', tz)
      const ms = Date.UTC(2026, 9, 6, 3, 30, 0)
      const day = /(\d{4}-\d{2}-\d{2})\.hbsave\.json$/.exec(saveFileName(at('2026-10-06T03:30:00Z')))![1]
      expect(cardFileName('png', new Date(ms), 'light'), tz).toBe(`humanbench-card-light-${day}.png`)
    }
  })

  it('the day is the local day of created_utc for any moment in any zone (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom('UTC', 'America/Los_Angeles', 'Asia/Kathmandu', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'), fc.integer({ min: 0, max: Date.UTC(2100, 0, 1) / 1000 }), (tz, secs) => {
        vi.stubEnv('TZ', tz)
        const d = new Date(secs * 1000)
        const iso = d.toISOString().slice(0, 19) + 'Z'
        const via = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
        expect(saveFileName(at(iso))).toBe(`humanbench-7Q3m9K-${via}.hbsave.json`)
      }),
      { numRuns: 300 },
    )
  })

  it('a created_utc that is not a real time keeps the date it says (a hand-edited file is not given a made-up day)', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    expect(saveFileName(at('2026-02-30T10:00:00Z'))).toBe('humanbench-7Q3m9K-2026-02-30.hbsave.json')
  })

  it('downloads, and shares, under the local name', async () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    const evening = at('2026-10-06T03:30:00Z')
    const { env, got } = downloadEnv()
    expect(downloadSave(evening, env)).toBe('humanbench-7Q3m9K-2026-10-05.hbsave.json')
    expect((got.clicks[0] as HTMLAnchorElement).download).toBe('humanbench-7Q3m9K-2026-10-05.hbsave.json')
    const shared: File[] = []
    const shareEnv: ShareEnv = { ...downloadEnv().env, navigator: { canShare: () => true, share: async (d?: ShareData) => void shared.push(...(d?.files ?? [])) } }
    expect(await shareSave(evening, shareEnv)).toBe('shared')
    expect(shared[0]?.name).toBe('humanbench-7Q3m9K-2026-10-05.hbsave.json')
  })
})

// -------------------------------------------------------------------------- the notes settings kept on the device (D17)

/** An in-memory Web Storage. */
function memoryStorage(seed: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed))
  return {
    map,
    get length() {
      return map.size
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

const ctxSet = (slot: number, rev: number, over: Partial<BriefContextV1> = {}): BriefContextV1 => ({
  slot,
  preset: 'coding',
  destination: 'claude_code_skill',
  tier: 'T1',
  mode: 'do',
  length: 'short',
  topics: { 'other/programming': 'skip' },
  lines_on: [],
  lines_off: [],
  rev,
  ...over,
})
const prefsOf = (...contexts: BriefContextV1[]): BriefPrefsV1 => ({ v: 1, topics: 'topics-v1', groups: 'g1', notes_as_of: '2026-10', contexts, fit_log: [] })
/** A prefs-only autosave, as the notes page keeps it (`brief-store/persist.ts`). */
const prefsAutosave = (bp: BriefPrefsV1): string => jcs({ ...save, sessions: [], seen_items: [], seen_families: [], anon_id: save.anon_id, brief_prefs: bp })

describe('the notes settings kept on this device (D17)', () => {
  const KEY = autosaveKey('prefs')

  it('reads none from an empty or a blocked storage, and never writes', () => {
    expect(deviceBriefPrefs(memoryStorage())).toBeUndefined()
    expect(deviceBriefPrefs(null)).toBeUndefined()
    const blocked: StorageLike = {
      get length(): number {
        throw new DOMException('blocked', 'SecurityError')
      },
      key: () => null,
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
      removeItem: () => undefined,
    }
    expect(deviceBriefPrefs(blocked)).toBeUndefined()
    const before = memoryStorage({ [KEY]: prefsAutosave(prefsOf(ctxSet(1, 2))) })
    const keys = [...before.map.entries()]
    deviceBriefPrefs(before)
    expect([...before.map.entries()]).toEqual(keys)
  })

  it('reads the notes page\'s prefs-only autosave', () => {
    const bp = prefsOf(ctxSet(1, 3))
    expect(deviceBriefPrefs(memoryStorage({ [KEY]: prefsAutosave(bp) }))).toEqual(mergeBriefPrefs([bp]))
  })

  it('joins every autosave of the device that holds settings, as the notes page does: the higher edit count wins per slot', () => {
    const page = prefsOf(ctxSet(1, 5, { length: 'detailed' }), ctxSet(2, 1))
    const session = prefsOf(ctxSet(1, 2, { length: 'short' }), ctxSet(3, 1, { preset: 'reading' }))
    const storage = memoryStorage({
      [KEY]: prefsAutosave(page),
      [autosaveKey('s_01J9ZK3QA')]: jcs({ ...save, brief_prefs: session }),
      [autosaveKey('s_NOTES')]: jcs({ ...save }),
    })
    const joined = deviceBriefPrefs(storage)!
    expect(joined).toEqual(mergeBriefPrefs([page, session]))
    expect(joined.contexts.map((c) => [c.slot, c.rev])).toEqual([[1, 5], [2, 1], [3, 1]])
  })

  it('skips an autosave it cannot read, and keys that are not autosaves', () => {
    const bp = prefsOf(ctxSet(1, 1))
    const storage = memoryStorage({ [KEY]: prefsAutosave(bp), [autosaveKey('s_BROKEN')]: '{not json', [autosaveKey('s_ODD')]: '[1,2]', 'hb:consent:v1': '{"brief_prefs":"x"}', other: 'x' })
    expect(deviceBriefPrefs(storage)).toEqual(mergeBriefPrefs([bp]))
  })

  it('counts the autosaves of every identifier on the device, as the notes page does (notes settings belong to the device)', () => {
    const mine = prefsOf(ctxSet(1, 2, { length: 'detailed' }))
    const other = prefsOf(ctxSet(2, 4, { preset: 'reading' }))
    const storage = memoryStorage({
      [KEY]: prefsAutosave(mine),
      [autosaveKey('s_OTHER')]: jcs({ ...save, anon_id: 'hb_0000000000000000a', brief_prefs: other }),
    })
    expect(deviceBriefPrefs(storage)).toEqual(mergeBriefPrefs([mine, other]))
    // The same join the notes page reads when it opens (its store's `load()`).
    expect(deviceBriefPrefs(storage)).toEqual(createPrefsStore({ storage, wallClockMs: () => 0, bindHide: false }).load().prefs)
  })

  it('puts them in the save that is handed over, so a restore gives them back (the second device no longer says "no notes settings")', async () => {
    const device = prefsOf(ctxSet(1, 4), ctxSet(2, 2, { preset: 'learning', topics: { 'other/statistics': 'ask_first' } }))
    expect(save.brief_prefs).toBeUndefined()
    const out = withDeviceBriefPrefs(save, deviceBriefPrefs(memoryStorage({ [KEY]: prefsAutosave(device) })))
    expect(out).not.toBe(save)
    expect(out.brief_prefs).toEqual(mergeBriefPrefs([device]))
    expect(validateSave(out).ok).toBe(true)
    // Everything else is the save's own.
    expect({ ...out, brief_prefs: undefined }).toEqual({ ...save, brief_prefs: undefined })
    // The file as downloaded loads on a device that has nothing, and restores the settings.
    const { env, got } = downloadEnv()
    downloadSave(out, env)
    const back = await readSaveFile(got.blobs[0] as Blob)
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.save.brief_prefs).toEqual(mergeBriefPrefs([device]))
    const restored = restoreBriefPrefs(undefined, back.save.brief_prefs!)
    expect(restored.changed).toBe(true)
    expect(restored.prefs).toEqual(mergeBriefPrefs([device]))
  })

  it('is the save itself when the device holds nothing, or nothing the save lacks', () => {
    expect(withDeviceBriefPrefs(save, undefined)).toBe(save)
    const bp = prefsOf(ctxSet(1, 4))
    const holding: SaveFileV1 = { ...save, brief_prefs: bp }
    expect(withDeviceBriefPrefs(holding, bp)).toBe(holding)
    expect(withDeviceBriefPrefs(holding, prefsOf(ctxSet(1, 3, { length: 'detailed' })))).toBe(holding)
  })

  it('keeps what the save already holds and lets the higher edit count win, per slot', () => {
    const mine: SaveFileV1 = { ...save, brief_prefs: prefsOf(ctxSet(1, 2, { length: 'short' }), ctxSet(4, 1, { preset: 'numbers' })) }
    const device = prefsOf(ctxSet(1, 6, { length: 'detailed' }), ctxSet(2, 1))
    const out = withDeviceBriefPrefs(mine, device)
    expect(out.brief_prefs?.contexts.map((c) => [c.slot, c.rev])).toEqual([[1, 6], [2, 1], [4, 1]])
    expect((out.brief_prefs?.contexts[0] as BriefContextV1).length).toBe('detailed')
    expect(validateSave(out).ok).toBe(true)
  })

  it('carries a removed set, so a set the person removed on the notes page is not brought back by an older copy', () => {
    const mine: SaveFileV1 = { ...save, brief_prefs: prefsOf(ctxSet(1, 2)) }
    const out = withDeviceBriefPrefs(mine, prefsOf({ slot: 1, rev: 3, removed: true } as unknown as BriefContextV1))
    expect(out.brief_prefs?.contexts).toEqual([{ slot: 1, rev: 3, removed: true }])
  })

  it('leaves the file-level signature and the sessions alone (the settings are outside the signed part, R-17.1)', () => {
    const sig = { alg: 'HMAC-SHA256' as const, kid: 'k2026a', mac: 'AAAA' }
    const signed: SaveFileV1 = { ...save, sig }
    const out = withDeviceBriefPrefs(signed, prefsOf(ctxSet(1, 1)))
    expect(out.sig).toEqual(sig)
    expect(out.sessions).toEqual(signed.sessions)
    expect(out.created_utc).toBe(signed.created_utc)
    expect(out.anon_id).toBe(signed.anon_id)
  })

  it('writes only choices and ids: no text a person typed can be in the file (property: the file stays valid under the save schema)', () => {
    fc.assert(
      fc.property(arbBriefPrefs, fc.option(arbBriefPrefs, { nil: undefined }), (device, own) => {
        const base: SaveFileV1 = own === undefined ? save : { ...save, brief_prefs: own }
        const out = withDeviceBriefPrefs(base, device)
        expect(validateSave(out).ok).toBe(true)
        // The join is the save module's: the file holds the device's settings and the save's own, and doing it again changes nothing.
        expect(briefPrefsCovered(out.brief_prefs, device)).toBe(true)
        expect(briefPrefsCovered(out.brief_prefs, base.brief_prefs)).toBe(true)
        expect(withDeviceBriefPrefs(out, device)).toBe(out)
      }),
      { numRuns: 200 },
    )
  })
})
