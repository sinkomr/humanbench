import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveWithSession } from './create'
import { copySaveCode, downloadSave, REVOKE_AFTER_MS, saveFileName, saveText, shareSave, type DownloadEnv, type ShareEnv } from './io'
import { jcs } from './jcs'
import { parseSaveText, readSaveFile } from './parse'
import { TEST_CTX } from './testing'

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

afterEach(() => {
  vi.restoreAllMocks()
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
