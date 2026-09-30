/**
 * Keeping the settings, in the builder page (AI.7; proposal §3.3 "Age gate and storage", §3.6, §5.5;
 * requirements R-17.1, R-17.12): nothing is kept until the person says they are 18 or older and asks;
 * then only the settings are kept, never what was typed; a save can be downloaded and loaded; "Remove
 * my notes settings" clears what was kept; fit notes suggest and never decide. The store is a fake.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hexToken } from './browser'
import type { BriefContextV1 } from '../save/types'
import { initialState, recordCopied, recordFit, setTopic, stateFromStored, toggleTopic } from './builder'
import { COPY } from './copy'
import NotesBuilder from './NotesBuilder.svelte'
import { copiedRecordOf } from './returning'
import type { ImportOutcome, NotesStore, StoreStatus } from './store-types'
import { fromStored, toStored, type StoredPrefs } from './stored'
import { DEFAULT_GATES } from './gates'

let app: ReturnType<typeof mount> | undefined
interface FakeStore extends NotesStore {
  writes: StoredPrefs[]
  removed: number
  downloads: (StoredPrefs | null)[]
  imports: (Blob | string)[]
  listeners: ((s: StoreStatus) => void)[]
  result: ImportOutcome
  available: boolean
}
function fakeStore(over: Partial<FakeStore> = {}): FakeStore {
  const s: FakeStore = {
    available: true,
    writes: [],
    removed: 0,
    downloads: [],
    imports: [],
    listeners: [],
    result: { ok: false, message: 'nothing set' },
    write: (p) => void s.writes.push(JSON.parse(JSON.stringify(p)) as StoredPrefs),
    flush: () => undefined,
    status: () => 'ok',
    onStatus: (l) => {
      s.listeners.push(l)
      return () => void s.listeners.splice(s.listeners.indexOf(l), 1)
    },
    download: (p) => {
      s.downloads.push(p)
      return 'humanbench-abc123-2026-11-03.hbsave.json'
    },
    importSave: async (input) => {
      s.imports.push(input)
      return s.result
    },
    remove: () => void (s.removed += 1),
    ...over,
  }
  return s
}

function open(props: Record<string, unknown> = {}): void {
  app = mount(NotesBuilder, { target: document.body, props: { asOf: '2026-11', token: 'k3f9', copy: async () => true, download: (_t: string, name: string) => name, fitId: () => 'abcdef', ...props } })
  flushSync()
}
const $ = <T extends Element = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel)
  if (!el) throw new Error(`not found: ${sel}`)
  return el
}
const button = (text: string | RegExp): HTMLButtonElement => {
  const b = [...document.querySelectorAll('button')].find((x) => (typeof text === 'string' ? (x.textContent ?? '').replace(/\s+/g, ' ').trim().includes(text) : text.test(x.textContent ?? '')))
  if (!b) throw new Error(`no button ${String(text)}`)
  return b
}
const click = (el: HTMLElement): void => {
  el.click()
  flushSync()
}
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string): void => {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}
const labelled = (text: string): HTMLInputElement => {
  const label = [...document.querySelectorAll('label')].find((l) => (l.textContent ?? '').includes(text))
  const control = label?.htmlFor ? document.getElementById(label.htmlFor) : label?.querySelector('input')
  if (!control) throw new Error(`no field labelled ${text}`)
  return control as HTMLInputElement
}
const submit = (form: HTMLFormElement): void => {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  flushSync()
}
const chip = (label: string): HTMLButtonElement => button(new RegExp(`^\\s*[+\\u2713]?\\s*${label}\\s*$`))
const pickUse = (label: string): void => {
  const radio = [...document.querySelectorAll('input[name=preset]')].find((r) => (r.closest('label')?.textContent ?? '').includes(label)) as HTMLInputElement
  click(radio)
}
const setting = (topic: string, label: string): HTMLInputElement => {
  const fieldset = [...document.querySelectorAll('fieldset')].find((f) => f.querySelector('legend')?.textContent?.trim() === topic)
  const l = [...(fieldset?.querySelectorAll('label') ?? [])].find((x) => (x.textContent ?? '').includes(label))
  return l?.querySelector('input') as HTMLInputElement
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network use'))))
})
afterEach(() => {
  if (app) void unmount(app)
  app = undefined
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('nothing is kept until the person asks (the under-18 path writes nothing)', () => {
  it('writes nothing, however much is done, and asks the 18+ question first', () => {
    const store = fakeStore()
    open({ store })
    pickUse('Coding and data')
    click(chip('Programming'))
    click(setting('Programming', 'I know this well'))
    type($<HTMLInputElement>('#custom-0'), 'Use metric units')
    click($('[data-testid=fit-too_basic]'))
    click(button('Copy the notes'))
    expect(store.writes).toEqual([])
    expect($('[data-testid=adult]').closest('label')?.textContent?.trim()).toBe(COPY.keepAdult)
    expect($('[data-testid=not-saved]').textContent).toBe(COPY.notSaved)
  })

  it('refuses to keep anything without the tick, says why, and still writes nothing', () => {
    const store = fakeStore()
    open({ store })
    click($('[data-testid=keep-button]'))
    expect($('[data-testid=adult-error]').textContent).toBe(COPY.keepNeedAdult)
    expect($('[data-testid=adult-error]').getAttribute('role')).toBe('alert')
    expect(store.writes).toEqual([])
    expect(document.querySelector('[data-testid=download-settings]')).toBeNull()
  })

  it('keeps the settings after the tick: writes at once, announces it, and offers the download', async () => {
    const store = fakeStore()
    open({ store })
    click(chip('Programming'))
    click($('[data-testid=adult]'))
    click($('[data-testid=keep-button]'))
    await tick()
    expect(store.writes).toHaveLength(1)
    expect(store.writes[0]?.contexts).toHaveLength(1)
    expect(store.writes[0]?.contexts[0]).toMatchObject({ slot: 1, preset: 'general', topics: { 'other/programming': 'ask_first' } })
    await vi.waitFor(() => expect($('[data-testid=keep-status]').textContent).toBe(COPY.keepNow))
    expect($('[data-testid=keep-state]').textContent).toBe(COPY.keepDone)
    expect($('[data-testid=download-settings]')).toBeTruthy()
    expect(document.querySelector('[data-testid=adult]')).toBeNull()
  })

  it('does not ask again when the person already confirmed elsewhere (adultKnown)', () => {
    const store = fakeStore()
    open({ store, adultKnown: true })
    expect(document.querySelector('[data-testid=adult]')).toBeNull()
    click($('[data-testid=keep-button]'))
    expect(store.writes).toHaveLength(1)
  })

  it('says so when the browser cannot keep anything, with no way to keep', () => {
    open({ store: fakeStore({ available: false }) })
    expect($('[data-testid=keep-state]').textContent).toBe(COPY.keepUnavailable)
    expect(document.querySelector('[data-testid=keep-button]')).toBeNull()
    void unmount(app as ReturnType<typeof mount>)
    document.body.innerHTML = ''
    open({ store: null })
    expect($('[data-testid=keep-state]').textContent).toBe(COPY.keepUnavailable)
  })
})

describe('what is kept, and when', () => {
  async function kept(store: FakeStore, props: Record<string, unknown> = {}): Promise<void> {
    open({ store, ...props })
    click($('[data-testid=adult]'))
    click($('[data-testid=keep-button]'))
    await tick()
    store.writes.length = 0
  }

  it('writes again on every change and never for a change that is not to the settings', async () => {
    const store = fakeStore()
    await kept(store)
    pickUse('Coding and data')
    await tick()
    expect(store.writes).toHaveLength(1)
    expect(store.writes[0]?.contexts[0]).toMatchObject({ preset: 'coding', destination: 'claude_code_skill' })
    click(chip('Programming'))
    await tick()
    expect(store.writes).toHaveLength(2)
    // what is typed, and opening things, change no setting: no write
    type($<HTMLInputElement>('#custom-0'), 'Use metric units')
    type(document.getElementById('check-input') as HTMLTextAreaElement, 'anything')
    await tick()
    expect(store.writes).toHaveLength(2)
  })

  it('never writes what was typed: no interests, no own lines, no note text', async () => {
    const store = fakeStore()
    await kept(store)
    click(chip('Statistics'))
    type(labelled('Hobbies or subjects'), 'chess and cooking')
    type($<HTMLInputElement>('#custom-0'), 'Use metric units')
    click(setting('Statistics', 'I know this well'))
    click(button('Copy the notes'))
    await tick()
    expect(store.writes.length).toBeGreaterThan(0)
    for (const w of store.writes) {
      const json = JSON.stringify(w)
      expect(json).not.toMatch(/chess|cooking|metric|units/)
      expect(json).not.toMatch(/How I like explanations|assessment of me|plainly when/)
    }
  })

  it('remembers what was copied or downloaded for the set (ids and wording versions only), and bumps its rev', async () => {
    const store = fakeStore()
    await kept(store)
    click(button('Copy the notes'))
    await vi.waitFor(() => expect(store.writes.length).toBeGreaterThan(0))
    const c = store.writes.at(-1)?.contexts[0] as { rev: number; copied?: { templates: string; month: string; lines: { id: string; v: string }[] } }
    expect(c.rev).toBeGreaterThan(0)
    expect(c.copied?.month).toBe('2026-11')
    expect(c.copied?.templates).toBe('2026.09')
    expect(c.copied?.lines.map((l) => l.id)).toEqual(expect.arrayContaining(['F1', 'F2', 'F3', 'F4']))
    expect(c.copied?.lines.every((l) => /^\d+$/.test(l.v))).toBe(true)
    expect(c.copied?.lines.some((l) => l.id === 'X1')).toBe(false)
  })

  it('does not write on load when the settings came from storage and nothing changed, and writes when they change', async () => {
    const store = fakeStore()
    let s = initialState('coding')
    s = toggleTopic(s, 'other/programming')
    s = setTopic(s, 'other/programming', 'skip')
    open({ store, initial: s, keepInitial: true })
    await tick()
    expect(store.writes).toEqual([])
    expect($('[data-testid=keep-state]').textContent).toBe(COPY.keepDone)
    expect(document.querySelector('[data-testid=adult]')).toBeNull()
    click(setting('Programming', 'New to me'))
    await tick()
    expect(store.writes).toHaveLength(1)
    expect((store.writes[0]?.contexts[0] as BriefContextV1).topics).toEqual({ 'other/programming': 'build' })
  })

  it('shows a problem from the store: a refused write says the settings could not be kept, and the download stays', async () => {
    const store = fakeStore()
    await kept(store)
    for (const l of store.listeners) l('error')
    await tick()
    expect($('[data-testid=keep-state]').textContent).toBe(COPY.keepFailed)
    expect($('[data-testid=download-settings]')).toBeTruthy()
  })
})

describe('download and load', () => {
  it('downloads the settings as a save file and announces its name', async () => {
    const store = fakeStore()
    open({ store, adultKnown: true })
    click($('[data-testid=keep-button]'))
    click(chip('Programming'))
    click($('[data-testid=download-settings]'))
    await tick()
    expect(store.downloads).toHaveLength(1)
    expect(store.downloads[0]?.contexts[0]).toMatchObject({ topics: { 'other/programming': 'ask_first' } })
    await vi.waitFor(() => expect($('[data-testid=keep-status]').textContent).toBe('Downloaded humanbench-abc123-2026-11-03.hbsave.json.'))
  })

  it('loads the settings of a pasted save over the page, keeps the typed extras of a set, and says so', async () => {
    let saved = initialState('coding')
    saved = toggleTopic(saved, 'kst/physics')
    saved = setTopic(saved, 'kst/physics', 'skip')
    const loaded = toStored({ contexts: saved.contexts, copied: saved.copied, tombstones: [], fitLog: [] }, '2026-11')
    const store = fakeStore({ result: { ok: true, prefs: loaded } })
    open({ store })
    const interests = labelled('Hobbies or subjects')
    type(interests, 'chess')
    type($<HTMLTextAreaElement>('[data-testid=load-paste]'), '{"a":"save"}')
    submit($('[data-testid=load-button]').closest('form') as HTMLFormElement)
    await vi.waitFor(() => expect($('[data-testid=load-status]').textContent).toBe(COPY.loadDone))
    expect(store.imports).toEqual(['{"a":"save"}'])
    expect($('#notes-text').textContent).toContain('Physics')
    expect(document.querySelector<HTMLInputElement>('input[name=preset][value=coding]')?.checked).toBe(true)
    expect(interests.value).toBe('chess')
    expect(store.writes).toEqual([]) // loading is not keeping
  })

  it('takes a chosen file, and says what went wrong in plain words', async () => {
    const store = fakeStore({ result: { ok: false, message: 'That save has no notes settings.', none: true } })
    open({ store })
    const file = new File(['{}'], 'save.hbsave.json', { type: 'application/json' })
    const input = $<HTMLInputElement>('[data-testid=load-file]')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    submit($('[data-testid=load-button]').closest('form') as HTMLFormElement)
    await vi.waitFor(() => expect($('[data-testid=load-status]').textContent).toBe(COPY.loadNone))
    expect(store.imports[0]).toBe(file)
    store.result = { ok: false, message: 'The save code is incomplete or damaged. Copy it again in full.' }
    input.dispatchEvent(new Event('change', { bubbles: true }))
    type($<HTMLTextAreaElement>('[data-testid=load-paste]'), 'H4sI')
    Object.defineProperty(input, 'files', { value: [], configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    submit($('[data-testid=load-button]').closest('form') as HTMLFormElement)
    await vi.waitFor(() => expect($('[data-testid=load-status]').textContent).toBe('The save code is incomplete or damaged. Copy it again in full.'))
  })

  it('asks for something to load when both are empty', () => {
    open({ store: fakeStore() })
    submit($('[data-testid=load-button]').closest('form') as HTMLFormElement)
    expect(document.body.textContent).toContain(COPY.loadEmpty)
  })
})

describe('"Remove my notes settings"', () => {
  it('clears what was kept and the page, and offers to keep again with the 18+ question', async () => {
    const store = fakeStore()
    open({ store, adultKnown: false })
    click($('[data-testid=adult]'))
    click($('[data-testid=keep-button]'))
    click(chip('Programming'))
    expect($('[data-testid=remove-text]').textContent).toBe(COPY.remove)
    click(button('Remove my notes settings'))
    await tick()
    expect(store.removed).toBe(1)
    expect(document.querySelector('[data-testid=download-settings]')).toBeNull()
    expect($('[data-testid=adult]')).toBeTruthy()
    expect($('#notes-text').textContent).not.toContain('Programming')
    store.writes.length = 0
    click(chip('Statistics'))
    await tick()
    expect(store.writes).toEqual([]) // nothing is kept again until asked
  })

  it('without a place to keep settings, says it only clears the page', () => {
    open({ store: null })
    expect($('[data-testid=remove-text]').textContent).toBe(COPY.removeStorageless)
  })
})

describe('fit notes suggest and never decide', () => {
  const fitButton = (topic: string, v: string): HTMLButtonElement => {
    const fieldset = [...document.querySelectorAll('fieldset')].find((f) => f.querySelector('legend')?.textContent?.trim() === topic)
    return fieldset?.querySelector(`[data-testid=fit-${v}]`) as HTMLButtonElement
  }

  it('suggests the next setting after two "too basic" notes, changes nothing until "Change it" is pressed, and then waits for a new note', async () => {
    open({ store: fakeStore() })
    click(chip('Programming')) // "Not sure" (ask first)
    click(fitButton('Programming', 'too_basic'))
    expect(document.querySelector('[data-testid=fit-suggestion]')).toBeNull()
    click(fitButton('Programming', 'too_basic'))
    const note = $('[data-testid=fit-suggestion]')
    expect(note.textContent).toContain('Your latest fit notes point towards "I know this well" for this topic.')
    expect(setting('Programming', 'Not sure').checked).toBe(true) // the person's setting is untouched
    click($('[data-testid=fit-apply]'))
    expect(setting('Programming', 'I know this well').checked).toBe(true)
    expect(document.querySelector('[data-testid=fit-suggestion]')).toBeNull()
    // a third note keeps the suggestion away from the top of the scale (clamped), a "too much" note brings none back
    click(fitButton('Programming', 'too_basic'))
    expect(document.querySelector('[data-testid=fit-suggestion]')).toBeNull()
  })

  it('announces each note politely, and says the fit notes only change suggestions', async () => {
    open({ store: fakeStore() })
    click(chip('Statistics'))
    click(fitButton('Statistics', 'too_much'))
    return vi.waitFor(() => {
      const live = [...document.querySelectorAll('.fit [role=status]')].map((x) => x.textContent)
      expect(live).toContain('Noted for Statistics: too much.')
      expect($('[data-testid=fit-note]').textContent).toContain(COPY.fitLog)
      expect($('[data-testid=fit-note]').textContent).toContain(COPY.fitNotKept)
    })
  })

  it('keeps fit notes only with the settings, as a topic, a verdict and a month', async () => {
    const store = fakeStore()
    open({ store, adultKnown: true })
    click(chip('Programming'))
    click(fitButton('Programming', 'too_basic'))
    await tick()
    expect(store.writes).toEqual([])
    expect($('[data-testid=fit-note]').textContent).toContain(COPY.fitNotKept)
    click($('[data-testid=keep-button]'))
    await tick()
    expect(store.writes.at(-1)?.fit_log).toEqual([{ id: '00abcdef', topic: 'other/programming', verdict: 'too_basic', month: '2026-11' }])
    expect($('[data-testid=fit-note]').textContent).not.toContain(COPY.fitNotKept)
  })

  it('brings back the fit notes of an earlier visit', () => {
    let s = toggleTopic(initialState(), 'other/programming')
    s = recordFit(recordFit(s, 'other/programming', 'too_basic', '2026-10', 'aaaaaa'), 'other/programming', 'too_basic', '2026-11', 'bbbbbb')
    open({ store: fakeStore(), initial: s, keepInitial: true })
    expect($('[data-testid=fit-suggestion]').textContent).toContain('"I know this well"')
  })

  it('has a random id source that gives six hex digits', () => {
    expect(hexToken(6)).toMatch(/^[0-9a-f]{6}$/)
    expect(hexToken(5)).toMatch(/^[0-9a-f]{5}$/)
  })
})

describe('coming back', () => {
  it('shows the notice for a copied line the gate file has since withdrawn, from the kept record', () => {
    let s = initialState('coding')
    s = recordCopied(s, copiedRecordOf([{ id: 'F1' }, { id: 'DS', topics: ['other/programming'] }], '2026-11'))
    const back = stateFromStored(fromStored(toStored({ contexts: s.contexts, copied: s.copied, tombstones: [], fitLog: [] }, '2026-11'))!)
    const blocked = { ...DEFAULT_GATES, lines: { ...DEFAULT_GATES.lines, DS: { v: '1', status: 'blocked' as const } } }
    open({ store: fakeStore(), initial: back, keepInitial: true, gates: blocked, today: '2026-12-03' })
    expect($('[data-testid=returning-message]').textContent).toBe('A line in notes you made in 2026-11 has been withdrawn. Re-copy your notes to replace it.')
    // copying again replaces the record, and the notice goes
    click(button('Copy the notes'))
    return vi.waitFor(() => expect(document.querySelector('[data-testid=returning]')).toBeNull())
  })
})
