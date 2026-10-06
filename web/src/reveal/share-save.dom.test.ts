/**
 * The save panel after the UX-review answers D17 and D19 (`web/UX-REVIEW.md` §2): the save that the results
 * page downloads, shares or copies holds the notes settings kept on this device, read when the button is
 * pressed, so that a second device that loads it gets them back (no "That save has no notes settings.");
 * and its file name carries the person's local day. The card half of the same package is in
 * `ShareCard.dom.test.ts`; the save module's own rules are in `save/io.dom.test.ts`.
 */

import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPrefsStore } from '../brief-store/persist'
import { fromStored, type StoredPrefs } from '../brief/stored'
import { buttonByText, click, render } from '../render/common/testing'
import { mergeBriefPrefs } from '../save/brief-prefs'
import { saveWithSession } from '../save/create'
import { downloadSave, saveFileName, type DownloadEnv, type ShareOutcome } from '../save/io'
import { jcs } from '../save/jcs'
import { parseSaveText } from '../save/parse'
import { TEST_CTX } from '../save/testing'
import type { BriefContextV1, SaveFileV1 } from '../save/types'
import { validateSave } from '../save/validate'
import { SAVE_HOLDS_NOTES } from './copy'
import SavePanel from './SavePanel.svelte'

const T = Date.UTC(2026, 9, 3, 17, 20, 2)
const session = {
  sessionId: 's_01J9ZK3QA',
  startedMs: T,
  durationS: 3411,
  device: { class: 'phone', input: 'touch', os_family: 'iOS', browser_family: 'Safari', refresh_hz_est: 60, timer_res_ms: 1, viewport: [390, 844] },
  flags: { paste_events: 0 },
  responses: [['i:mat:f0182:v3', 0, 'C', 1, 41250, 80]],
  seenItems: ['i:mat:f0182:v3'],
  seenFamilies: ['f:mat:0182'],
} as Parameters<typeof saveWithSession>[1]
const saveMadeAt = (createdMs: number): SaveFileV1 => saveWithSession(null, session, { ctx: TEST_CTX, createdMs, anonId: 'hb_7Q3m9Kx2Vw5rT8pL' })
const SAVE = saveMadeAt(T + 3_600_000)

const context = (slot: number, rev: number, over: Partial<BriefContextV1> = {}): BriefContextV1 => ({
  slot,
  preset: 'coding',
  destination: 'claude_code_skill',
  tier: 'T1',
  mode: 'do',
  length: 'short',
  topics: { 'other/programming': 'skip', 'other/statistics': 'ask_first' },
  lines_on: [],
  lines_off: [],
  rev,
  ...over,
})
const prefs = (...contexts: BriefContextV1[]): StoredPrefs => ({ v: 1, topics: 'topics-v1', groups: 'g1', notes_as_of: '2026-10', contexts, fit_log: [] })

/** What the notes page does when the person keeps their settings (`brief-store/persist.ts`): the prefs-only autosave in localStorage. */
function keepOnDevice(p: StoredPrefs): void {
  const s = createPrefsStore({ storage: localStorage, wallClockMs: () => T, bindHide: false, setTimer: () => 0, clearTimer: () => undefined, newAnonId: () => 'hb_7Q3m9Kx2Vw5rT8pL' })
  s.write(p)
  s.flush()
}

let cleanup: (() => void) | undefined
beforeEach(() => {
  localStorage.clear()
  vi.stubEnv('TZ', 'UTC')
})
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  document.body.innerHTML = ''
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

interface Mounted {
  readonly c: HTMLElement
  readonly downloads: SaveFileV1[]
  readonly shared: SaveFileV1[]
  readonly copied: SaveFileV1[]
}

function mountPanel(over: Record<string, unknown> = {}): Mounted {
  const downloads: SaveFileV1[] = []
  const shared: SaveFileV1[] = []
  const copied: SaveFileV1[] = []
  const r = render(SavePanel, {
    makeSave: () => SAVE,
    autosave: 'ok',
    saved: true,
    onsaved: () => undefined,
    download: (s: SaveFileV1) => (downloads.push(s), 'file.json'),
    share: async (s: SaveFileV1): Promise<ShareOutcome> => (shared.push(s), 'shared'),
    copyCode: async (s: SaveFileV1) => (copied.push(s), { code: 'CODE', copied: true }),
    canShare: true,
    ...over,
  })
  cleanup = r.destroy
  return { c: r.container, downloads, shared, copied }
}

const notesLine = (c: HTMLElement): string | undefined => c.querySelector('[data-notes-included]')?.textContent ?? undefined

describe('the notes settings kept on this device go into the save (D17)', () => {
  it('a download holds them, read from the device when the button is pressed', () => {
    const m = mountPanel()
    // Kept after the panel is on screen (the notes page in another tab): the press still sees them.
    const device = prefs(context(1, 3), context(2, 1, { preset: 'learning' }))
    keepOnDevice(device)
    click(buttonByText(m.c, 'Download save file'))
    expect(m.downloads).toHaveLength(1)
    expect(m.downloads[0]!.brief_prefs).toEqual(mergeBriefPrefs([device]))
    expect(validateSave(m.downloads[0]!).ok).toBe(true)
    // The session itself is what it was.
    expect(m.downloads[0]!.sessions).toEqual(SAVE.sessions)
    expect(m.downloads[0]!.anon_id).toBe(SAVE.anon_id)
  })

  it('follows the device from one press to the next', () => {
    const m = mountPanel()
    keepOnDevice(prefs(context(1, 1, { length: 'short' })))
    click(buttonByText(m.c, 'Download save file'))
    keepOnDevice(prefs(context(1, 4, { length: 'detailed' })))
    click(buttonByText(m.c, 'Download save file'))
    expect(m.downloads.map((s) => (s.brief_prefs?.contexts[0] as BriefContextV1).length)).toEqual(['short', 'detailed'])
  })

  it('the share sheet and the save code get the same file as the download', async () => {
    const m = mountPanel()
    keepOnDevice(prefs(context(1, 2)))
    click(buttonByText(m.c, 'Download save file'))
    click(buttonByText(m.c, 'Share or save to an app'))
    click(buttonByText(m.c, 'Copy save code'))
    await vi.waitFor(() => expect(m.shared).toHaveLength(1))
    await vi.waitFor(() => expect(m.copied).toHaveLength(1))
    expect(jcs(m.shared[0]!)).toBe(jcs(m.downloads[0]!))
    expect(jcs(m.copied[0]!)).toBe(jcs(m.downloads[0]!))
  })

  it('reaches the share sheet before any await (the click\'s user activation must still hold)', () => {
    keepOnDevice(prefs(context(1, 2)))
    let reached = false
    const m = mountPanel({
      share: (s: SaveFileV1) => {
        reached = s.brief_prefs !== undefined
        return Promise.resolve('shared' as ShareOutcome)
      },
    })
    click(buttonByText(m.c, 'Share or save to an app'))
    expect(reached).toBe(true)
  })

  it('without settings on the device, the save is handed over untouched and nothing is said about notes', () => {
    const m = mountPanel()
    click(buttonByText(m.c, 'Download save file'))
    expect(m.downloads[0]).toBe(SAVE)
    expect(notesLine(m.c)).toBeUndefined()
  })

  it('joins them with settings the save already carries: the higher edit count wins, per slot', () => {
    const carried: SaveFileV1 = { ...SAVE, brief_prefs: prefs(context(1, 7, { length: 'detailed' }), context(3, 1)) }
    keepOnDevice(prefs(context(1, 2, { length: 'short' }), context(2, 1)))
    const m = mountPanel({ makeSave: () => carried })
    click(buttonByText(m.c, 'Download save file'))
    const out = m.downloads[0]!.brief_prefs!
    expect(out.contexts.map((c) => [c.slot, c.rev])).toEqual([[1, 7], [2, 1], [3, 1]])
    expect((out.contexts[0] as BriefContextV1).length).toBe('detailed')
  })

  it('says what else is in the file, only after a save that holds settings, and only with the file saved', () => {
    keepOnDevice(prefs(context(1, 2)))
    const unsaved = mountPanel({ saved: false })
    click(buttonByText(unsaved.c, 'Download save file'))
    expect(notesLine(unsaved.c)).toBeUndefined() // the panel is told it is not saved yet: no "done" lines
    cleanup?.()
    const m = mountPanel({ saved: true })
    expect(notesLine(m.c)).toBeUndefined() // nothing downloaded yet
    click(buttonByText(m.c, 'Download save file'))
    flushSync()
    expect(notesLine(m.c)).toBe(SAVE_HOLDS_NOTES)
    expect(SAVE_HOLDS_NOTES).not.toMatch(/\bnotes? text\b/i)
  })

  it('a device whose storage is blocked still downloads the save, unchanged', () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError')
      },
    })
    try {
      const m = mountPanel()
      click(buttonByText(m.c, 'Download save file'))
      expect(m.downloads[0]).toBe(SAVE)
    } finally {
      Object.defineProperty(window, 'localStorage', real)
    }
  })

  describe('the file as downloaded, loaded on a second device', () => {
    interface Got {
      env: DownloadEnv
      blobs: Blob[]
      names: string[]
    }
    const capture = (): Got => {
      const blobs: Blob[] = []
      const names: string[] = []
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        names.push(this.download)
      })
      const env: DownloadEnv = {
        document,
        URL: { createObjectURL: (b: Blob | MediaSource) => (blobs.push(b as Blob), `blob:hb/${blobs.length}`), revokeObjectURL: () => undefined },
        setTimeout: () => undefined,
      }
      return { env, blobs, names }
    }

    const emptyDevice = () => {
      const data = new Map<string, string>()
      return {
        data,
        get length() {
          return data.size
        },
        key: (i: number) => [...data.keys()][i] ?? null,
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
        removeItem: (k: string) => void data.delete(k),
      }
    }

    it('restores the notes settings on a device that has none, and writes nothing there until the person keeps them', async () => {
      const device = prefs(context(1, 3), context(2, 2, { preset: 'reading', topics: { 'other/statistics': 'build' } }))
      keepOnDevice(device)
      const got = capture()
      const m = mountPanel({ download: (s: SaveFileV1) => downloadSave(s, got.env) })
      click(buttonByText(m.c, 'Download save file'))
      const text = await got.blobs[0]!.text()

      // A second device: nothing kept there. The notes page loads the file the way it loads any save.
      const second = emptyDevice()
      const store = createPrefsStore({ storage: second, wallClockMs: () => T, bindHide: false, setTimer: () => 0, clearTimer: () => undefined })
      const loaded = await store.importSave(text, null)
      expect(loaded.ok).toBe(true)
      if (!loaded.ok) return
      expect(loaded.prefs).toEqual(mergeBriefPrefs([device]))
      // What the notes page shows from it: both sets, with their choices.
      const read = fromStored(loaded.prefs)!
      expect(read.contexts.map((c) => [c.slot, c.preset])).toEqual([[1, 'coding'], [2, 'reading']])
      expect(read.contexts[0]!.topics['other/programming']).toBe('skip')
      expect(second.data.size).toBe(0)
      // And the whole file is a valid save with the session in it.
      const parsed = await parseSaveText(text)
      expect(parsed.ok && parsed.save.sessions).toHaveLength(1)
    })

    it('the same file without the device\'s settings is what said "That save has no notes settings."', async () => {
      const got = capture()
      const m = mountPanel({ download: (s: SaveFileV1) => downloadSave(s, got.env) })
      click(buttonByText(m.c, 'Download save file'))
      const store = createPrefsStore({ storage: emptyDevice(), wallClockMs: () => T, bindHide: false, setTimer: () => 0, clearTimer: () => undefined })
      const loaded = await store.importSave(await got.blobs[0]!.text(), null)
      expect(loaded).toMatchObject({ ok: false, none: true, message: 'That save has no notes settings.' })
    })

    it('holds only choices and ids: nothing a person typed is in the file', async () => {
      keepOnDevice(prefs(context(1, 3)))
      const got = capture()
      const m = mountPanel({ download: (s: SaveFileV1) => downloadSave(s, got.env) })
      click(buttonByText(m.c, 'Download save file'))
      const file = JSON.parse(await got.blobs[0]!.text()) as { brief_prefs: { contexts: Record<string, unknown>[] } }
      const keys = new Set(file.brief_prefs.contexts.flatMap((c) => Object.keys(c)))
      for (const k of keys) expect(['slot', 'preset', 'destination', 'form', 'tier', 'mode', 'length', 'topics', 'topics_off', 'lines_on', 'lines_off', 'phrasing', 'copied', 'rev', 'removed']).toContain(k)
      expect(file.brief_prefs).not.toHaveProperty('interests')
      expect(file.brief_prefs).not.toHaveProperty('custom')
    })
  })
})

describe('the save\'s file name carries the person\'s local day (D19)', () => {
  it('an evening save in the Americas is dated that evening, in the file and in the line that says where it went', async () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    // 2026-10-06 03:30 UTC = 8:30 pm on 5 October in Los Angeles.
    const evening = saveMadeAt(Date.UTC(2026, 9, 6, 3, 30, 0))
    expect(evening.created_utc).toBe('2026-10-06T03:30:00Z')
    const names: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download)
    })
    const env: DownloadEnv = { document, URL: { createObjectURL: () => 'blob:hb/1', revokeObjectURL: () => undefined }, setTimeout: () => undefined }
    const m = mountPanel({ makeSave: () => evening, download: (s: SaveFileV1) => downloadSave(s, env) })
    click(buttonByText(m.c, 'Download save file'))
    flushSync()
    expect(names).toEqual(['humanbench-7Q3m9K-2026-10-05.hbsave.json'])
    expect(m.c.querySelector('[data-saved-as]')?.textContent).toContain('humanbench-7Q3m9K-2026-10-05.hbsave.json')
  })

  it('a share that falls back to a download names the file the same way', async () => {
    vi.stubEnv('TZ', 'Pacific/Auckland')
    // 2026-10-05 20:30 UTC = 09:30 on 6 October in Auckland.
    const morning = saveMadeAt(Date.UTC(2026, 9, 5, 20, 30, 0))
    const m = mountPanel({ makeSave: () => morning, share: async (): Promise<ShareOutcome> => 'downloaded' })
    click(buttonByText(m.c, 'Share or save to an app'))
    await vi.waitFor(() => expect(m.c.querySelector('[data-saved-as]')?.textContent).toContain(saveFileName(morning)))
    expect(m.c.querySelector('[data-saved-as]')?.textContent).toContain('humanbench-7Q3m9K-2026-10-06.hbsave.json')
  })
})
