import { flushSync } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, buttonByText, click } from '../render/common/testing'
import { newAnonId } from '../save/ids'
import { saveWithSession } from '../save/create'
import { encodeSaveCode } from '../save/codec'
import { saveText } from '../save/io'
import type { SaveFileV1 } from '../save/types'
import { SAVE_CTX } from './constants'
import Checklist from './Checklist.svelte'
import Confidence from './Confidence.svelte'
import Finished from './Finished.svelte'
import Privacy from './Privacy.svelte'
import ProgressRing from './ProgressRing.svelte'
import Ready from './Ready.svelte'
import { defaultReadyState, type ReadyState } from './ready-state'
import { SpyStorage } from './bot'
import { Bot } from './bot'
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
  it('is a named progressbar in whole minutes, with the text value the ring cannot carry alone', () => {
    const c = mountIt(ProgressRing, { elapsedS: 12 * 60 + 40, targetS: 27.5 * 60 })
    const bar = c.querySelector('[role="progressbar"]')!
    expect(bar.getAttribute('aria-label')).toBe('Session time')
    expect(bar.getAttribute('aria-valuenow')).toBe('12')
    expect(bar.getAttribute('aria-valuemax')).toBe('28')
    expect(bar.getAttribute('aria-valuetext')).toBe('12 of about 28 min')
    expect(c.querySelector('.text')?.textContent).toBe('12 of about 28 min')
    expect(c.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(Number(bar.getAttribute('data-fraction'))).toBeCloseTo(760 / 1650, 3)
  })

  it('fills and stays full past the target, saying so in words', () => {
    const c = mountIt(ProgressRing, { elapsedS: 40 * 60, targetS: 27.5 * 60 })
    const bar = c.querySelector('[role="progressbar"]')!
    expect(bar.getAttribute('data-fraction')).toBe('1.000')
    expect(bar.getAttribute('aria-valuenow')).toBe('28')
    expect(bar.getAttribute('aria-valuetext')).toBe('Almost there')
  })

  it('starts empty: no arc is drawn, so no dot at the top', () => {
    const c = mountIt(ProgressRing, { elapsedS: 0, targetS: 1650 })
    expect(c.querySelector('[role="progressbar"]')?.getAttribute('data-fraction')).toBe('0.000')
    expect(c.querySelector('circle.bar')).toBeNull()
    expect(c.querySelector('circle.track')).not.toBeNull()
    expect(c.querySelector('.text')?.textContent).toBe('0 of about 28 min')
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
    ])
    expect(c.querySelector('.later')?.textContent).toContain('Verbal, Estimation, Knowledge, Social-Creative')
    expect(c.querySelector('nav')?.getAttribute('aria-label')).toBe('Session checklist')
    expect(c.querySelector('li .axes')?.textContent).toBe('Reaction Time, Processing & Reading Speed')
  })

  it('skipped, done and not-reached clusters after the session ended', () => {
    const c = mountIt(Checklist, {
      segments: [seg('rt', 'Speed', ['RT'], 'skipped'), seg('matrix_series', 'Reasoning', ['MAT'], 'done'), seg('spatial', 'Spatial/Memory', ['SPA'], 'not_reached'), seg('quant', 'Quantitative', ['QR'], 'skipped')],
    })
    expect([...c.querySelectorAll('li')].map((li) => li.getAttribute('data-status'))).toEqual(['skipped', 'done', 'not_reached', 'skipped'])
    expect([...c.querySelectorAll('.status')].map((s) => s.textContent)).toEqual(['Skipped', 'Done', 'Not reached', 'Skipped'])
  })
})

describe('Confidence', () => {
  it('runs from the floor to 100, starts where it is told, and reports whole percent', () => {
    const seen: number[] = []
    const c = mountIt(Confidence, { floorPct: 25, startPct: 63, optionsCount: 4, onconfirm: (p: number) => seen.push(p) })
    const r = c.querySelector<HTMLInputElement>('input[type="range"]')!
    expect([r.min, r.max, r.step, r.value]).toEqual(['25', '100', '1', '63'])
    expect(c.querySelector('.hint')?.textContent).toBe('25% is what pure guessing would give among 4 options. 100% means you are certain.')
    click(buttonByText(c, 'Continue'))
    expect(seen).toEqual([63])
  })

  it('typed entry has a floor of 0 and its own hint', () => {
    const c = mountIt(Confidence, { floorPct: 0, startPct: 50, optionsCount: null, onconfirm: () => undefined })
    expect(c.querySelector<HTMLInputElement>('input[type="range"]')?.min).toBe('0')
    expect(c.querySelector('.hint')?.textContent).toBe('0% means you have no idea. 100% means you are certain.')
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
    await vi.waitFor(() => expect(c.querySelector('[role="status"]')?.textContent).toContain('Choose a save file'))
    c.querySelector<HTMLTextAreaElement>('textarea')!.value = 'hello there'
    c.querySelector('textarea')!.dispatchEvent(new Event('input', { bubbles: true }))
    click(buttonByText(c, 'Load'))
    await vi.waitFor(() => expect(c.querySelector('[role="status"]')?.textContent).toContain('not a HumanBench save'))
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

  it('does not include autosaves from more than one identifier unless asked', async () => {
    const file = await savedFile()
    const restored = { save: file, keys: ['a', 'b'], failures: [], anonIds: ['hb_a', 'hb_b'] }
    const { c } = ready({ restored, choices: defaultReadyState(restored) })
    expect(c.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false)
    expect(c.textContent).toContain('more than one save identifier')
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
      autosave: 'ok',
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
    expect(c.querySelector('[role="status"]')?.textContent).toBe('Save file downloaded.')
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

  it('is the whole notice: controller and contact are TODO(user), 18+ only, in-browser storage, a way back', () => {
    const c = mountIt(Privacy, { storage: () => new SpyStorage() })
    const text = c.textContent ?? ''
    expect(text).toContain('Controller: TODO(user)')
    expect(text).toContain('Contact: TODO(user)')
    expect(text).toContain('18 or older')
    expect(text).toContain('Nothing is sent to a server')
    expect(text).toContain('retention period (draft: 24 months)')
    expect(c.querySelector('a[href="#/"]')).not.toBeNull()
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
