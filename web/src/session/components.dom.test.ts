import { flushSync } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, buttonByText, click } from '../render/common/testing'
import { newAnonId } from '../save/ids'
import { saveWithSession } from '../save/create'
import { encodeSaveCode } from '../save/codec'
import { saveText } from '../save/io'
import type { BriefContextV1, BriefPrefsV1, SaveFileV1 } from '../save/types'
import { SAVE_CTX } from './constants'
import Checklist from './Checklist.svelte'
import Confidence from './Confidence.svelte'
import Finished from './Finished.svelte'
import ConsentGate from './ConsentGate.svelte'
import Privacy from './Privacy.svelte'
import ProgressRing from './ProgressRing.svelte'
import Ready from './Ready.svelte'
import Welcome from './Welcome.svelte'
import { defaultReadyState, type ReadyState } from './ready-state'
import { SpyStorage } from './bot'
import { Bot } from './bot'
import { READY_LOAD_PREFS_NOTICE } from './copy'
import type { SegmentView } from './run'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  document.body.innerHTML = ''
})

function mountIt(component: Parameters<typeof render>[0], props: Record<string, unknown>): HTMLElement {
  const r = render(component, props)
  cleanup = r.destroy
  return r.container
}

describe('ProgressRing (DESIGN §10: time, not items)', () => {
  it('is a named progressbar in whole minutes, with the text value the ring cannot carry alone; the target reads to the nearest 5 minutes (UX-008)', () => {
    const c = mountIt(ProgressRing, { elapsedS: 12 * 60 + 40, targetS: 27.5 * 60 })
    const bar = c.querySelector('[role="progressbar"]')!
    expect(bar.getAttribute('aria-label')).toBe('Session time')
    expect(bar.getAttribute('aria-valuenow')).toBe('12')
    // 28 minutes of plan is "about 30" everywhere the person reads it (welcome, ready, ring) ...
    expect(bar.getAttribute('aria-valuemax')).toBe('30')
    expect(bar.getAttribute('aria-valuetext')).toBe('12 of about 30 min')
    expect(c.querySelector('.text')?.textContent).toBe('12 of about 30 min')
    expect(c.querySelector('.text')?.getAttribute('translate')).toBe('no')
    expect(c.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    // ... while the fill still follows the exact target.
    expect(Number(bar.getAttribute('data-fraction'))).toBeCloseTo(760 / 1650, 3)
  })

  it('a 20-minute focus session stays 20', () => {
    const c = mountIt(ProgressRing, { elapsedS: 5 * 60, targetS: 20 * 60 })
    expect(c.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext')).toBe('5 of about 20 min')
  })

  it('fills and stays full past the target, saying so in words: "Almost there" only on the last part', () => {
    const last = mountIt(ProgressRing, { elapsedS: 40 * 60, targetS: 27.5 * 60, lastPart: true })
    const bar = last.querySelector('[role="progressbar"]')!
    expect(bar.getAttribute('data-fraction')).toBe('1.000')
    expect(bar.getAttribute('aria-valuenow')).toBe('30')
    expect(bar.getAttribute('aria-valuetext')).toBe('Almost there')
    cleanup?.()
    const earlier = mountIt(ProgressRing, { elapsedS: 40 * 60, targetS: 27.5 * 60, lastPart: false })
    expect(earlier.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext')).toBe('Over the planned time')
    cleanup?.()
    // Not said either way until the target is reached.
    const before = mountIt(ProgressRing, { elapsedS: 20 * 60, targetS: 27.5 * 60, lastPart: true })
    expect(before.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext')).toBe('20 of about 30 min')
  })

  it('starts empty: no arc is drawn, so no dot at the top', () => {
    const c = mountIt(ProgressRing, { elapsedS: 0, targetS: 1650 })
    expect(c.querySelector('[role="progressbar"]')?.getAttribute('data-fraction')).toBe('0.000')
    expect(c.querySelector('circle.bar')).toBeNull()
    expect(c.querySelector('circle.track')).not.toBeNull()
    expect(c.querySelector('.text')?.textContent).toBe('0 of about 30 min')
  })
})

const seg = (id: SegmentView['id'], cluster: SegmentView['cluster'], axes: SegmentView['axes'], status: SegmentView['status']): SegmentView => ({
  id,
  title: id,
  cluster,
  axes,
  kind: 'cat',
  minutes: 5,
  status,
})

describe('Checklist (DESIGN §10: per-cluster checklist)', () => {
  it('groups by cluster in the order met, with a text status, and lists the clusters not measured yet', () => {
    const segments = [
      seg('rt', 'Speed', ['RT'], 'done'),
      seg('matrix_series', 'Reasoning', ['MAT'], 'done'),
      seg('spatial', 'Spatial/Memory', ['SPA'], 'current'),
      seg('memory', 'Spatial/Memory', ['WM'], 'upcoming'),
      seg('quant', 'Quantitative', ['QR'], 'upcoming'),
      seg('coding_reading', 'Speed', ['PS'], 'upcoming'),
    ]
    const c = mountIt(Checklist, { segments })
    const rows = [...c.querySelectorAll('li')].map((li) => [li.getAttribute('data-status'), li.querySelector('.status')?.textContent])
    expect(rows).toEqual([
      ['partial', 'Partly done'],
      ['done', 'Done'],
      ['current', 'Now'],
      ['upcoming', 'Up next'],
      // Estimation has no part of its own: the confidence slider measures it with each answer (A15).
      ['embedded', 'With each answer'],
    ])
    expect(c.querySelector('.later')?.textContent).toContain('Verbal, Knowledge, Social-Creative')
    expect(c.querySelector('.later')?.textContent).not.toContain('Estimation')
    // A named region, not a navigation landmark: nothing in it is a link (UX-007b).
    expect(c.querySelector('nav')).toBeNull()
    expect(c.querySelector('section.checklist')?.getAttribute('aria-label')).toBe('Session checklist')
    expect(c.querySelector('li .axes')?.textContent).toBe('Reaction Time, Processing & Reading Speed')
  })

  it('skipped, done and not-reached clusters after the session ended', () => {
    const c = mountIt(Checklist, {
      segments: [seg('rt', 'Speed', ['RT'], 'skipped'), seg('matrix_series', 'Reasoning', ['MAT'], 'done'), seg('spatial', 'Spatial/Memory', ['SPA'], 'not_reached'), seg('quant', 'Quantitative', ['QR'], 'skipped')],
    })
    expect([...c.querySelectorAll('li')].map((li) => li.getAttribute('data-status'))).toEqual(['skipped', 'done', 'not_reached', 'skipped', 'embedded'])
    expect([...c.querySelectorAll('.status')].map((s) => s.textContent)).toEqual(['Skipped', 'Done', 'Not reached', 'Skipped', 'With each answer'])
  })

  const allSix = (over: Partial<Record<SegmentView['id'], SegmentView['status']>> = {}): SegmentView[] => [
    seg('rt', 'Speed', ['RT'], over.rt ?? 'upcoming'),
    seg('matrix_series', 'Reasoning', ['MAT'], over.matrix_series ?? 'upcoming'),
    seg('spatial', 'Spatial/Memory', ['SPA'], over.spatial ?? 'upcoming'),
    seg('memory', 'Spatial/Memory', ['WM'], over.memory ?? 'upcoming'),
    seg('quant', 'Quantitative', ['QR'], over.quant ?? 'upcoming'),
    seg('coding_reading', 'Speed', ['PS'], over.coding_reading ?? 'upcoming'),
  ]
  const statuses = (c: HTMLElement): string[] => [...c.querySelectorAll('li .status')].map((x) => x.textContent ?? '')

  it('says "Up next" on one row only: the cluster of the part that comes next; every other cluster still to come says "Later" (UX-007a)', () => {
    // On the interstitial of the first part that part is "Now", the next part's cluster is "Up next".
    const first = mountIt(Checklist, { segments: allSix({ rt: 'current' }) })
    expect(statuses(first)).toEqual(['Now', 'Up next', 'Later', 'Later', 'With each answer'])
    expect([...first.querySelectorAll('li')].map((li) => li.getAttribute('data-status'))).toEqual(['current', 'upcoming', 'later', 'later', 'embedded'])
    cleanup?.()
    // Reaction Time skipped: Speed still has the last part ahead, but it is not next. Spatial/Memory is.
    const skipped = mountIt(Checklist, { segments: allSix({ rt: 'skipped', matrix_series: 'current' }) })
    expect(statuses(skipped)).toEqual(['Later', 'Now', 'Up next', 'Later', 'With each answer'])
    cleanup?.()
    // A cluster under way is "Now", never "Up next": the next row to start is Quantitative.
    const under = mountIt(Checklist, { segments: allSix({ rt: 'done', matrix_series: 'done', spatial: 'current' }) })
    expect(statuses(under)).toEqual(['Partly done', 'Done', 'Now', 'Up next', 'With each answer'])
    cleanup?.()
    // Nothing is current (a break between two parts): the first part still to come.
    const onBreak = mountIt(Checklist, { segments: allSix({ rt: 'done', matrix_series: 'done' }) })
    expect(statuses(onBreak)).toEqual(['Partly done', 'Done', 'Up next', 'Later', 'With each answer'])
  })

  it('a row reads aloud as a sentence ("Speed: Reaction Time, Processing & Reading Speed. Now."), and a line may break after a slash', () => {
    const c = mountIt(Checklist, { segments: allSix({ rt: 'current' }) })
    const row = c.querySelector('li')!
    const text = (row.textContent ?? '').replace(/\s+/g, ' ')
    expect(text).toContain('Speed: Reaction Time, Processing & Reading Speed')
    expect(text).toMatch(/Reading Speed\. ?Now/)
    const separators = [...row.querySelectorAll('.hb-sr-only')].map((x) => x.textContent)
    expect(separators).toEqual([': ', '. '])
    // The slash of "Spatial/Memory" is followed by a break opportunity, and the text is unchanged.
    const spatial = [...c.querySelectorAll('li .name')].find((n) => (n.textContent ?? '').startsWith('Spatial/Memory'))!
    expect(spatial.querySelector('wbr')).not.toBeNull()
    expect(spatial.textContent).toContain('Spatial/Memory')
  })

  it('every row is its mark, its name and its status in that order, whatever the size: the layout only moves them by grid areas (VER-01)', () => {
    const c = mountIt(Checklist, { segments: allSix({ rt: 'current' }) })
    const rows = [...c.querySelectorAll('li')]
    expect(rows.length).toBeGreaterThanOrEqual(5)
    for (const row of rows) expect([...row.children].map((x) => x.className.replace(/\s*svelte-\w+/g, '').trim())).toEqual(['mark', 'name', 'status'])
    // The list is still a named region, not a navigation.
    const region = c.querySelector('section.checklist')!
    expect(region.getAttribute('aria-label')).toBe('Session checklist')
    expect(c.querySelector('nav')).toBeNull()
    // The mark stays decoration; the status is plain text.
    expect(rows[0]!.querySelector('.mark')?.getAttribute('aria-hidden')).toBe('true')
    expect(rows[0]!.querySelector('.status')?.textContent).toBe('Now')
  })
})

describe('Confidence', () => {
  it('runs from the floor to 100, starts where it is told, and reports whole percent', () => {
    const seen: number[] = []
    const c = mountIt(Confidence, { floorPct: 25, startPct: 63, optionsCount: 4, onconfirm: (p: number) => seen.push(p) })
    const r = c.querySelector<HTMLInputElement>('input[type="range"]')!
    expect([r.min, r.max, r.step, r.value]).toEqual(['25', '100', '1', '63'])
    expect(c.querySelector('.hint')?.textContent).toBe('With 4 options, guessing would be right about 25% of the time. 100% means you are certain.')
    click(buttonByText(c, 'Continue'))
    expect(seen).toEqual([63])
  })

  it('says whether the slider was moved: Continue straight away is untouched, a move (even back to the start) is touched (UX-063)', () => {
    const seen: [number, boolean][] = []
    const a = mountIt(Confidence, { floorPct: 25, startPct: 63, optionsCount: 4, onconfirm: (p: number, t: boolean) => seen.push([p, t]) })
    click(buttonByText(a, 'Continue'))
    cleanup?.() // one slider at a time: the first is gone before the second is mounted
    const b = mountIt(Confidence, { floorPct: 25, startPct: 63, optionsCount: 4, onconfirm: (p: number, t: boolean) => seen.push([p, t]) })
    const r = b.querySelector<HTMLInputElement>('input[type="range"]')!
    r.value = '80'
    r.dispatchEvent(new Event('input', { bubbles: true }))
    r.value = '63'
    r.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    click(buttonByText(b, 'Continue'))
    expect(seen).toEqual([
      [63, false],
      [63, true],
    ])
  })

  it('Enter on an untouched slider (the form submit) is untouched too', () => {
    const seen: [number, boolean][] = []
    const c = mountIt(Confidence, { floorPct: 0, startPct: 50, optionsCount: null, onconfirm: (p: number, t: boolean) => seen.push([p, t]) })
    c.querySelector('form')!.requestSubmit()
    expect(seen).toEqual([[50, false]])
  })

  it('typed entry has a floor of 0 and its own hint', () => {
    const c = mountIt(Confidence, { floorPct: 0, startPct: 50, optionsCount: null, onconfirm: () => undefined })
    expect(c.querySelector<HTMLInputElement>('input[type="range"]')?.min).toBe('0')
    expect(c.querySelector('.hint')?.textContent).toBe('0% means you have no idea. 100% means you are certain.')
  })

  it('puts the whole form in view once it is laid out, Continue included, and leaves the scroll to that (UX-014)', async () => {
    const scrolled = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrolled
    try {
      const c = mountIt(Confidence, { floorPct: 25, startPct: 50, optionsCount: 4, onconfirm: () => undefined })
      expect(document.activeElement).toBe(c.querySelector('input[type="range"]'))
      await vi.waitFor(() => expect(scrolled).toHaveBeenCalledTimes(1))
      expect(scrolled.mock.contexts[0]).toBe(c.querySelector('form'))
      expect(scrolled.mock.calls[0]).toEqual([{ block: 'nearest' }])
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('an Enter that is held down or repeating does not rate the item; a fresh Enter does (UX-014)', () => {
    const seen: number[] = []
    const c = mountIt(Confidence, { floorPct: 0, startPct: 40, optionsCount: null, onconfirm: (p: number) => seen.push(p) })
    const range = c.querySelector<HTMLInputElement>('input[type="range"]')!
    const repeated = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })
    range.dispatchEvent(repeated)
    expect(repeated.defaultPrevented).toBe(true)
    const fresh = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    range.dispatchEvent(fresh)
    expect(fresh.defaultPrevented).toBe(false)
    const arrow = new KeyboardEvent('keydown', { key: 'ArrowRight', repeat: true, bubbles: true, cancelable: true })
    range.dispatchEvent(arrow)
    expect(arrow.defaultPrevented).toBe(false)
    expect(seen).toEqual([])
  })

  it('the readout is left to the page translator alone: it is a number (UX-014)', () => {
    const c = mountIt(Confidence, { floorPct: 0, startPct: 40, optionsCount: null, onconfirm: () => undefined })
    expect(c.querySelector('output')?.getAttribute('translate')).toBe('no')
  })

  it('the slider has a name (the legend), a value text and a description', () => {
    const c = mountIt(Confidence, { floorPct: 17, startPct: 58, optionsCount: 6, onconfirm: () => undefined })
    const r = c.querySelector<HTMLInputElement>('input[type="range"]')!
    expect(c.querySelector('fieldset legend')?.textContent).toBe('How sure are you that your answer is right?')
    expect(r.getAttribute('aria-valuetext')).toBe('58% sure')
    expect(r.getAttribute('aria-describedby')).toBe(c.querySelector('.hint')?.id)
    expect(document.activeElement).toBe(r)
  })
})

async function savedFile(): Promise<SaveFileV1> {
  const bot = new Bot({ sessionId: 's_READYSAVE000001', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
  bot.until((v) => v.phase === 'confidence')
  bot.run.confirmConfidence(bot.view().confidence!.startPct)
  bot.run.finishEarly()
  return saveWithSession(null, bot.run.sessionState(), { ctx: SAVE_CTX, createdMs: 1_790_000_100_000, anonId: newAnonId() })
}

describe('Ready: earlier saves (R-8.1, M1.17 UI wiring)', () => {
  const noop = (): void => undefined
  const none: ReadyState = { includeFound: false, loaded: null }

  function ready(over: Record<string, unknown> = {}): { c: HTMLElement; reported: ReadyState[] } {
    const reported: ReadyState[] = []
    const c = mountIt(Ready, { restored: null, choices: none, onchoices: (s: ReadyState) => reported.push(s), onpractice: noop, onbegin: noop, ...over })
    return { c, reported }
  }

  it('offers practice and Begin and reports nothing until the person chooses something', () => {
    const { c, reported } = ready()
    expect(buttonByText(c, 'Begin')).toBeTruthy()
    expect(buttonByText(c, 'Try practice questions first')).toBeTruthy()
    expect(reported).toEqual([])
  })

  it('loads a pasted save code and says how many earlier sessions there are', async () => {
    const file = await savedFile()
    const code = await encodeSaveCode(file)
    const { c, reported } = ready()
    c.querySelector<HTMLTextAreaElement>('textarea')!.value = code
    c.querySelector('textarea')!.dispatchEvent(new Event('input', { bubbles: true }))
    click(buttonByText(c, 'Load'))
    await vi.waitFor(() => expect(reported).toHaveLength(1))
    flushSync()
    expect(reported[0]?.loaded?.anon_id).toBe(file.anon_id)
    expect(reported[0]?.loaded?.sessions).toHaveLength(1)
    expect(c.querySelector('[role="status"]')?.textContent).toContain('Loaded 1 earlier session')
  })

  it('loads an uploaded file by content, whatever its name', async () => {
    const file = await savedFile()
    const { c, reported } = ready()
    const input = c.querySelector<HTMLInputElement>('input[type="file"]')!
    const upload = new File([saveText(file)], 'humanbench.txt', { type: 'text/plain' })
    Object.defineProperty(input, 'files', { value: [upload], configurable: true })
    click(buttonByText(c, 'Load'))
    await vi.waitFor(() => expect(reported.at(-1)?.loaded?.sessions).toHaveLength(1))
  })

  it('says plainly when the text is not a save, and reports nothing', async () => {
    const { c, reported } = ready()
    click(buttonByText(c, 'Load'))
    await vi.waitFor(() => expect(c.querySelector('[role="alert"]')?.textContent).toContain('Choose a save file'))
    c.querySelector<HTMLTextAreaElement>('textarea')!.value = 'hello there'
    c.querySelector('textarea')!.dispatchEvent(new Event('input', { bubbles: true }))
    click(buttonByText(c, 'Load'))
    await vi.waitFor(() => expect(c.querySelector('[role="alert"]')?.textContent).toContain('not a HumanBench save'))
    expect(reported).toEqual([])
  })

  it('offers the autosaves found on the device, and reports the opt-out', async () => {
    const file = await savedFile()
    const restored = { save: file, keys: ['k'], failures: [], anonIds: [file.anon_id] }
    const { c, reported } = ready({ restored, choices: defaultReadyState(restored) })
    const box = c.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(box.checked).toBe(true)
    expect(c.textContent).toContain('1 earlier session saved on this device')
    click(box)
    expect(reported.at(-1)).toEqual({ includeFound: false, loaded: null })
  })

  describe('the notes settings in a loaded file (owner decision 2026-10-01)', () => {
    const set = (preset: BriefContextV1['preset'], rev: number): BriefContextV1 => ({
      slot: 1,
      preset,
      destination: 'chatgpt_instructions',
      tier: 'T1',
      mode: 'do',
      length: 'standard',
      topics: {},
      lines_on: [],
      lines_off: [],
      rev,
    })
    const prefsOf = (c: BriefContextV1): BriefPrefsV1 => ({ v: 1, topics: 'topics-v1', groups: 'g1', notes_as_of: '2026-11', contexts: [c], fit_log: [] })

    async function loadFile(restored: unknown, file: SaveFileV1): Promise<{ c: HTMLElement; reported: ReadyState[] }> {
      const r = ready({ restored, choices: restored === null ? none : defaultReadyState(restored as never) })
      r.c.querySelector<HTMLTextAreaElement>('textarea')!.value = await encodeSaveCode(file)
      r.c.querySelector('textarea')!.dispatchEvent(new Event('input', { bubbles: true }))
      click(buttonByText(r.c, 'Load'))
      await vi.waitFor(() => expect(r.reported).toHaveLength(1))
      flushSync()
      return r
    }

    it('says the file’s settings will be used when they differ from the ones saved on the device, and not otherwise', async () => {
      const base = await savedFile()
      const onDevice = { ...base, brief_prefs: prefsOf(set('reading', 9)) }
      const restored = { save: onDevice, keys: ['k'], failures: [], anonIds: [onDevice.anon_id] }

      const different = await loadFile(restored, { ...base, brief_prefs: prefsOf(set('coding', 1)) })
      const status = different.c.querySelector('[role="status"]')?.textContent ?? ''
      expect(status).toContain('Loaded 1 earlier session. Your new session will be added to it.')
      expect(status).toContain(READY_LOAD_PREFS_NOTICE)
      cleanup?.()

      // the same settings (only the edit count differs): nothing is replaced, so nothing is said
      const same = await loadFile(restored, { ...base, brief_prefs: prefsOf(set('reading', 1)) })
      expect(same.c.querySelector('[role="status"]')?.textContent).not.toContain(READY_LOAD_PREFS_NOTICE)
      cleanup?.()

      // no settings on this device, or none in the file
      const nothingHere = await loadFile(null, { ...base, brief_prefs: prefsOf(set('coding', 1)) })
      expect(nothingHere.c.querySelector('[role="status"]')?.textContent).not.toContain(READY_LOAD_PREFS_NOTICE)
      cleanup?.()
      const noSettings = await loadFile(restored, base)
      expect(noSettings.c.querySelector('[role="status"]')?.textContent).not.toContain(READY_LOAD_PREFS_NOTICE)
    })
  })

  it('does not include autosaves from more than one identifier unless asked', async () => {
    const file = await savedFile()
    const restored = { save: file, keys: ['a', 'b'], failures: [], anonIds: ['hb_a', 'hb_b'] }
    const { c } = ready({ restored, choices: defaultReadyState(restored) })
    expect(c.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false)
    expect(c.textContent).toContain('more than one save identifier')
  })
})

describe('Ready: a 20-minute focus session for a returning person (ROADMAP M1.R)', () => {
  const noop = (): void => undefined
  const none: ReadyState = { includeFound: false, loaded: null }

  it('is offered only with earlier results and a start handler, and starts on the parts chosen', async () => {
    const file = await savedFile()
    const restored = { save: file, keys: ['k'], failures: [], anonIds: [file.anon_id] }
    const started: string[][] = []
    // Nothing to build on: no focus option.
    const bare = mountIt(Ready, { restored: null, choices: none, onchoices: noop, onpractice: noop, onbegin: noop, onfocus: (a: string[]) => started.push(a) })
    expect(bare.querySelector('details.focus')).toBeNull()
    cleanup?.()
    // Earlier results but no handler: none either.
    const noHandler = mountIt(Ready, { restored, choices: defaultReadyState(restored), onchoices: noop, onpractice: noop, onbegin: noop })
    expect(noHandler.querySelector('details.focus')).toBeNull()
    cleanup?.()
    const c = mountIt(Ready, { restored, choices: defaultReadyState(restored), onchoices: noop, onpractice: noop, onbegin: noop, onfocus: (a: string[]) => started.push(a) })
    expect(c.querySelector('details.focus summary')?.textContent).toBe('Or a 20-minute focus session')
    const boxes = [...c.querySelectorAll<HTMLInputElement>('details.focus input[type="checkbox"]')]
    expect(boxes).toHaveLength(6)
    // The part of the only skill measured has the widest range, so it starts ticked.
    expect(boxes.filter((b) => b.checked).map((b) => b.id.split('-').pop())).toEqual(['matrix_series'])
    click(buttonByText(c, 'Start a 20-minute focus session'))
    expect(started).toEqual([['MAT']])
  })

  it('leaves it out when the earlier autosaves are not included', async () => {
    const file = await savedFile()
    const restored = { save: file, keys: ['k'], failures: [], anonIds: [file.anon_id] }
    const c = mountIt(Ready, { restored, choices: { includeFound: false, loaded: null }, onchoices: noop, onpractice: noop, onbegin: noop, onfocus: noop })
    expect(c.querySelector('details.focus')).toBeNull()
  })
})

describe('Checklist in a focus session (ROADMAP M1.R)', () => {
  it('says the parts left out are "not in this session", not "not in this version"', () => {
    const segments = [seg('spatial', 'Spatial/Memory', ['SPA'], 'current')]
    expect(mountIt(Checklist, { segments }).querySelector('.later')?.textContent).toContain('Not in this version')
    cleanup?.()
    const focus = mountIt(Checklist, { segments, focus: true }).querySelector('.later')?.textContent ?? ''
    expect(focus).toContain('Not in this session')
    expect(focus).not.toContain('Not in this version')
  })
})

describe('Finished', () => {
  it('shows why it ended, the profile and the save actions; downloads through the save library', async () => {
    const bot = new Bot({ sessionId: 's_FINISHEDUI00001' }, { theta: new Array<number>(17).fill(0.5) })
    bot.finish()
    const result = bot.run.result()
    const downloads: SaveFileV1[] = []
    const c = mountIt(Finished, {
      result,
      makeSave: () => saveWithSession(null, bot.run.sessionState(), { ctx: SAVE_CTX, createdMs: 1_790_000_100_000, anonId: 'hb_' + 'a'.repeat(17) }),
      sessionId: 's_FINISHEDUI00001',
      autosave: 'ok',
      motion: 'reduce',
      onrestart: () => undefined,
      download: (s: SaveFileV1) => (downloads.push(s), 'file.json'),
    })
    expect(c.querySelector('h1')?.textContent).toBe('Session complete')
    expect(c.textContent).toContain('You finished every part.')
    expect(c.querySelector('svg.hb-blob')).not.toBeNull()
    expect(c.querySelector('table')).not.toBeNull()
    click(buttonByText(c, 'Download save file'))
    expect(downloads).toHaveLength(1)
    expect(downloads[0]!.sessions[0]!.session_id).toBe('s_FINISHEDUI00001')
    expect(c.querySelector('[data-section="save"] [role="status"]')?.textContent).toBe('Save file downloaded.')
  })

  it('offers the code by hand when the clipboard is refused', async () => {
    const bot = new Bot({ sessionId: 's_FINISHEDUI00002' })
    bot.run.finishEarly()
    const c = mountIt(Finished, {
      result: bot.run.result(),
      makeSave: () => saveWithSession(null, bot.run.sessionState(), { ctx: SAVE_CTX, createdMs: 1_790_000_100_000, anonId: 'hb_' + 'b'.repeat(17) }),
      autosave: 'unavailable',
      onrestart: () => undefined,
      copyCode: async () => ({ code: 'H4sIAAAA', copied: false }),
    })
    expect(c.textContent).toContain('Nothing was measured')
    expect(c.textContent).toContain('did not allow saving as you went')
    click(buttonByText(c, 'Copy save code'))
    await vi.waitFor(() => expect(c.querySelector('textarea')?.value).toBe('H4sIAAAA'))
    expect(c.querySelector('[role="status"]')?.textContent).toContain('could not be copied automatically')
  })
})

describe('Privacy: delete what is kept in this browser', () => {
  it('removes the consent and the autosaves, and says so', () => {
    const s = new SpyStorage()
    s.data.set('hb:consent:v1', '{}')
    s.data.set('hb:save:v1:s_A', '{}')
    s.data.set('unrelated', 'x')
    const c = mountIt(Privacy, { storage: () => s })
    click(buttonByText(c, 'Delete the data this site keeps in this browser'))
    expect(c.querySelector('[role="status"]')?.textContent).toContain('Deleted')
    expect([...s.data.keys()]).toEqual(['unrelated'])
    click(buttonByText(c, 'Delete the data this site keeps in this browser'))
    expect(c.querySelector('[role="status"]')?.textContent).toContain('holds no HumanBench data')
  })

  it('is the whole notice: no personally identifiable information, no placeholder, 18+ only, in-browser storage, a way back (UX-REVIEW D1)', () => {
    const c = mountIt(Privacy, { storage: () => new SpyStorage() })
    const text = c.textContent ?? ''
    expect(text).toContain('HumanBench collects no personally identifiable information, and all responses are anonymous.')
    expect(text).not.toMatch(/TODO|Controller:|Contact:/)
    expect(text).toContain('18 or older')
    expect(text).toContain('Nothing is sent to a server')
    expect(text).toContain('at most 24 months')
    expect(c.querySelector('a[href="#/"]')).not.toBeNull()
  })

  it('the online notice renders without a placeholder too (UX-REVIEW D1)', async () => {
    const { SERVER_PRIVACY_SECTIONS } = await import('../backend/copy')
    const c = mountIt(Privacy, { storage: () => new SpyStorage(), sections: SERVER_PRIVACY_SECTIONS, dataLink: true })
    const text = c.textContent ?? ''
    expect(text).toContain('HumanBench collects no personally identifiable information, and all responses are anonymous.')
    expect(text).not.toMatch(/TODO|Controller:|Contact:/)
    expect(c.querySelector('a[href="#/data"]')).not.toBeNull()
  })
})

describe('Stage finds a renderer for every family of the session (A15, A18)', () => {
  it('the power items and every fixed block have one, and an unknown family says so instead of failing silently', async () => {
    const { FAMILIES } = await import('../tasks/registry')
    const { default: Stage } = await import('./Stage.svelte')
    const { fakeDisplay } = await import('../render/common/testing')
    const display = fakeDisplay()
    for (const [name, family] of Object.entries(FAMILIES)) {
      const item = family.generate('stage-coverage')
      const c = mountIt(Stage, { family: name, itemId: item.item_id, spec: item.spec, block: family.kind === 'block', scale: 1, timing: display, onrespond: () => undefined })
      expect(c.querySelector('[role="alert"]'), name).toBeNull()
      expect(c.children.length, name).toBeGreaterThan(0)
      cleanup?.()
      cleanup = undefined
    }
    const c = mountIt(Stage, { family: 'nope', itemId: 'i:nope:1:x', spec: {}, scale: 1, timing: display, onrespond: () => undefined })
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('not available')
  })
})

describe('Welcome (UX-REVIEW D22, provisional default: the row for a returning visitor)', () => {
  const noop = (): void => undefined
  const row = (c: HTMLElement): HTMLElement | null => c.querySelector('[data-testid="welcome-returning"]')

  it('a first visit: the tagline, the intro, Start and the privacy link, and no row', () => {
    const onstart = vi.fn()
    const c = mountIt(Welcome, { onstart })
    expect(c.querySelector('h1')?.textContent).toBe('HumanBench')
    expect([...c.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Start'])
    expect([...c.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['#/privacy'])
    expect(row(c)).toBeNull()
    click(buttonByText(c, 'Start'))
    expect(onstart).toHaveBeenCalledTimes(1)
  })

  it('returning with nothing to offer (null, or both off) shows no row', () => {
    for (const returning of [null, { results: false, notes: false }]) {
      const c = mountIt(Welcome, { onstart: noop, returning, onresults: noop })
      expect(row(c), JSON.stringify(returning)).toBeNull()
      cleanup?.()
    }
  })

  it('"See my results" calls the flow, and Start is still the only primary button', () => {
    const onstart = vi.fn()
    const onresults = vi.fn()
    const c = mountIt(Welcome, { onstart, onresults, returning: { results: true, notes: false } })
    expect(c.querySelectorAll('.hb-primary')).toHaveLength(1)
    expect(buttonByText(c, 'Start').classList.contains('hb-primary')).toBe(true)
    const see = buttonByText(c, 'See my results')
    expect(see.classList.contains('hb-primary')).toBe(false)
    expect(row(c)?.contains(see)).toBe(true)
    click(see)
    expect(onresults).toHaveBeenCalledTimes(1)
    expect(onstart).not.toHaveBeenCalled()
  })

  it('no results button without a way to show them (the build with a server scores them there), but the notes link stays', () => {
    const c = mountIt(Welcome, { onstart: noop, returning: { results: true, notes: true } })
    expect([...c.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Start'])
    expect(c.querySelector('[data-testid="welcome-notes"]')).not.toBeNull()
  })

  it('the notes link is a link in a new tab that says so, to the page it is given', () => {
    const c = mountIt(Welcome, { onstart: noop, returning: { results: false, notes: true }, notesHref: '/hb/notes.html' })
    const a = c.querySelector<HTMLAnchorElement>('[data-testid="welcome-notes"]')!
    expect(a.getAttribute('href')).toBe('/hb/notes.html')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener')
    expect(a.textContent).toBe('Notes for your AI (opens in a new tab)')
    expect(a.classList.contains('hb-standalone-link')).toBe(true)
    expect(c.querySelector('button.hb-btn:not(.hb-primary)')).toBeNull()
  })

  it('names the row for assistive technology, and keeps the privacy link last', () => {
    const c = mountIt(Welcome, { onstart: noop, onresults: noop, returning: { results: true, notes: true } })
    const group = row(c)!
    expect(group.getAttribute('role')).toBe('group')
    expect(group.getAttribute('aria-label')).toBe('Earlier results and notes on this device')
    expect([...c.querySelectorAll('main button, main a')].map((e) => e.textContent?.trim())).toEqual(['Start', 'See my results', 'Notes for your AI (opens in a new tab)', 'Privacy and terms'])
  })

  it('reads and writes no storage itself', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    mountIt(Welcome, { onstart: noop, onresults: noop, returning: { results: true, notes: true } })
    expect(setItem).not.toHaveBeenCalled()
    expect(getItem).not.toHaveBeenCalled()
    setItem.mockRestore()
    getItem.mockRestore()
  })
})

describe('ConsentGate (UX-REVIEW D24, provisional default: a way back from the under-18 screen)', () => {
  it('the under-18 screen says what it said, and has the way back only when the flow gives one', () => {
    const without = mountIt(ConsentGate, { onagree: vi.fn(), onunder18: vi.fn(), blocked: true })
    expect(without.querySelector('h1')?.textContent).toBe('HumanBench is for adults')
    expect(without.querySelectorAll('button')).toHaveLength(0)
    cleanup?.()
    const onmistake = vi.fn()
    const withBack = mountIt(ConsentGate, { onagree: vi.fn(), onunder18: vi.fn(), onmistake, blocked: true })
    expect(withBack.querySelector('[role="status"]')?.textContent).toContain('You must be 18 or older to take part.')
    expect([...withBack.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['I chose this by mistake'])
    click(buttonByText(withBack, 'I chose this by mistake'))
    expect(onmistake).toHaveBeenCalledTimes(1)
  })

  it('taking the choice back asks nothing else of the flow: no agree, no under-18, and no storage is touched', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem')
    const onagree = vi.fn()
    const onunder18 = vi.fn()
    const onmistake = vi.fn()
    const c = mountIt(ConsentGate, { onagree, onunder18, onmistake, blocked: true })
    click(buttonByText(c, 'I chose this by mistake'))
    expect(onagree).not.toHaveBeenCalled()
    expect(onunder18).not.toHaveBeenCalled()
    for (const spy of [setItem, getItem, removeItem]) {
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    }
  })

  it('the gate itself has no such link: its box is unticked, and "I am under 18" is the choice it already had', () => {
    const onunder18 = vi.fn()
    const c = mountIt(ConsentGate, { onagree: vi.fn(), onunder18, onmistake: vi.fn() })
    expect(c.querySelector('h1')?.textContent).toBe('Before you start')
    expect(c.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false)
    expect([...c.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Continue', 'I am under 18'])
    click(buttonByText(c, 'I am under 18'))
    expect(onunder18).toHaveBeenCalledTimes(1)
  })
})
