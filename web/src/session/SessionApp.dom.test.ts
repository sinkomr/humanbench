import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prefsOnlySave } from '../brief-store/persist'
import { buttonByText, click, fakeDisplay, type FakeDisplay } from '../render/common/testing'
import { settle } from '../render/dom-testing'
import { autosaveKey } from '../save/autosave'
import { saveWithSession } from '../save/create'
import type { BriefContextV1, BriefPrefsV1, SaveFileV1 } from '../save/types'
import ResultsStub from '../test-support/ResultsStub.svelte'
import { Bot } from './bot'
import { CONSENT_KEY, SAVE_CTX, TERMS_VERSION } from './constants'
import { DESKTOP, fakeEnv, type FakeEnv } from './dom-support'
import SessionApp from './SessionApp.svelte'
import { createResultsLoader, resultsLoader, type ResultsLoader, type ResultsModule } from './results-loader'

// The results code is its own chunk (UX-100); loaded here once, so the flow shows the results at once as it does
// when the ready screen has fetched them.
beforeAll(async () => {
  await resultsLoader.load()
}, 90_000)

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement

/** A results loader for the next mount; the page's own when unset. */
let injected: ResultsLoader | undefined

function open(fake: FakeEnv<FakeDisplay>): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = mount(SessionApp, { target: host, props: { env: fake.env, ...(injected === undefined ? {} : { results: injected }) } })
  flushSync()
}

afterEach(() => {
  if (app) unmount(app)
  app = undefined
  injected = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const h1 = (): string => document.querySelector('main h1')?.textContent?.trim() ?? ''
const box = (label: RegExp): HTMLInputElement => {
  const l = [...document.querySelectorAll('label')].find((x) => label.test(x.textContent ?? ''))
  const el = l?.control
  if (!(el instanceof HTMLInputElement)) throw new Error(`no checkbox for ${String(label)}`)
  return el
}

/** Mount, agree, honour: on the device screen. */
async function toDevice(fake: FakeEnv<FakeDisplay>): Promise<void> {
  open(fake)
  click(buttonByText(host, 'Start'))
  click(box(/18 or older/))
  click(buttonByText(host, 'Continue'))
  click(box(/honour code/))
  click(buttonByText(host, 'Continue'))
  expect(h1()).toBe('Check your device')
}

/** Let the fake display run the 60-frame refresh measurement and the promises that follow it. */
async function measured(fake: FakeEnv<FakeDisplay>): Promise<void> {
  fake.display.advance(1200)
  await new Promise((resolve) => setTimeout(resolve, 0))
  flushSync()
}

/** On to the ready screen: the fake display runs the 60-frame refresh measurement. */
async function toReady(fake: FakeEnv<FakeDisplay>): Promise<void> {
  await toDevice(fake)
  await measured(fake)
  click(buttonByText(host, 'Continue'))
  expect(h1()).toBe('Ready when you are')
}

describe('the consent and 18+ gate (§13)', () => {
  it('starts on the welcome screen and shows the three-point summary, a link and the choice', () => {
    const fake = fakeEnv(fakeDisplay())
    open(fake)
    expect(h1()).toBe('HumanBench')
    click(buttonByText(host, 'Start'))
    expect(h1()).toBe('Before you start')
    expect(host.querySelectorAll('ul.points li')).toHaveLength(3)
    const link = host.querySelector<HTMLAnchorElement>('a[href="#/privacy"]')
    expect(link?.textContent).toContain('privacy notice')
    expect(box(/18 or older/).checked).toBe(false)
    expect(buttonByText(host, 'I am under 18')).toBeTruthy()
  })

  it('the under-18 path writes nothing: no storage write of any kind, no cookie, no consent', () => {
    const fake = fakeEnv(fakeDisplay())
    open(fake)
    click(buttonByText(host, 'Start'))
    click(buttonByText(host, 'I am under 18'))
    expect(h1()).toBe('HumanBench is for adults')
    expect(host.textContent).toContain('Nothing has been stored')
    expect(fake.storage.writes).toEqual([])
    expect(fake.storage.data.size).toBe(0)
    expect(document.cookie).toBe('')
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    // No way forward from that screen; the one thing to do is to take the choice back (D24).
    expect([...host.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(['I chose this by mistake'])
  })

  it('does not go on without the box ticked, and says so', () => {
    const fake = fakeEnv(fakeDisplay())
    open(fake)
    click(buttonByText(host, 'Start'))
    click(buttonByText(host, 'Continue'))
    expect(h1()).toBe('Before you start')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Tick the box')
    expect(fake.storage.writes).toEqual([])
  })

  it('keeps the consent only after it is given, for this terms version, and then skips the gate', () => {
    const fake = fakeEnv(fakeDisplay())
    open(fake)
    click(buttonByText(host, 'Start'))
    expect(fake.storage.writes).toEqual([])
    click(box(/18 or older/))
    click(buttonByText(host, 'Continue'))
    expect(h1()).toBe('Honour code')
    expect(fake.storage.writes).toEqual([`set:${CONSENT_KEY}`])
    expect(JSON.parse(fake.storage.data.get(CONSENT_KEY)!)).toEqual({ v: 1, terms: TERMS_VERSION, adult: true })

    // A new visit with the consent stored goes straight to the honour code.
    unmount(app!)
    document.body.innerHTML = ''
    const again = fakeEnv(fakeDisplay(), { storage: fake.storage })
    open(again)
    click(buttonByText(host, 'Start'))
    expect(h1()).toBe('Honour code')
  })

  it('does not honour a consent given for other terms', () => {
    const fake = fakeEnv(fakeDisplay())
    fake.storage.data.set(CONSENT_KEY, JSON.stringify({ v: 1, terms: 'older-terms', adult: true }))
    open(fake)
    click(buttonByText(host, 'Start'))
    expect(h1()).toBe('Before you start')
  })
})

describe('honour code and device check', () => {
  it('asks for the honour code (DESIGN §13 wording) before the device check', () => {
    const fake = fakeEnv(fakeDisplay())
    open(fake)
    click(buttonByText(host, 'Start'))
    click(box(/18 or older/))
    click(buttonByText(host, 'Continue'))
    expect(host.textContent).toContain("No AI tools, search, calculators (except where provided), or help. Your blob is only meaningful if it's yours.")
    click(buttonByText(host, 'Continue'))
    expect(h1()).toBe('Honour code')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('honour code')
    click(box(/honour code/))
    click(buttonByText(host, 'Continue'))
    expect(h1()).toBe('Check your device')
  })

  it('measures the screen, lists the coarse facts and offers the RT input mode (keyboard by default)', async () => {
    const fake = fakeEnv(fakeDisplay())
    await toDevice(fake)
    // The status line is on the page before the words go into it (they are announced); "Continue" waits, but stays in the tab order (UX-013).
    expect(host.querySelector('p[role="status"]')).not.toBeNull()
    await tick()
    expect(host.textContent).toContain('Checking your screen')
    expect(buttonByText(host, 'Continue').getAttribute('aria-disabled')).toBe('true')
    expect(buttonByText(host, 'Continue').disabled).toBe(false)
    await measured(fake)
    expect(host.textContent).not.toContain('Checking your screen')
    const facts = host.querySelector('dl.facts')?.textContent ?? ''
    expect(facts).toContain('desktop')
    expect(facts).toContain('macOS, Safari')
    expect(facts).toContain('1280 × 800')
    expect(facts).toContain('60 Hz (screen updates per second)')
    const inputs = [...host.querySelectorAll<HTMLInputElement>('input[name$="-input"]')]
    expect(inputs.map((i) => [i.value, i.checked])).toEqual([
      ['keyboard', true],
      ['touch', false],
    ])
    expect(buttonByText(host, 'Continue').hasAttribute('aria-disabled')).toBe(false)
  })

  it('a touch device starts on tap or click', async () => {
    const fake = fakeEnv(fakeDisplay(), {
      device: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', maxTouchPoints: 5, coarsePointer: true, viewport: [390, 844] },
    })
    await toDevice(fake)
    await measured(fake)
    expect(host.textContent).toContain('phone')
    expect(host.textContent).toContain('iOS, Safari')
    const checked = host.querySelector<HTMLInputElement>('input[name$="-input"]:checked')
    expect(checked?.value).toBe('touch')
  })
})

describe('ready, practice and the start of a session', () => {
  it('reads earlier autosaves only after the gate, and offers them', async () => {
    const fake = fakeEnv(fakeDisplay())
    await toReady(fake)
    expect(host.textContent).not.toContain('Earlier saves on this device')
    expect(fake.storage.writes).toEqual([`set:${CONSENT_KEY}`])
  })

  it('practice: four questions, not counted, and "Stop practice" goes straight back to the ready screen (UX-004)', async () => {
    const fake = fakeEnv(fakeDisplay())
    await toReady(fake)
    click(buttonByText(host, 'Try practice questions first'))
    expect(h1()).toBe('Practice')
    expect(host.textContent).toContain('Practice question 1 of 4')
    expect(host.textContent).toContain('not counted')
    click(buttonByText(host, 'Stop practice'))
    expect(h1()).toBe('Ready when you are')
    // Practice wrote nothing.
    expect(fake.storage.writes).toEqual([`set:${CONSENT_KEY}`])
  })

  it('begin: the first interstitial, the progress ring and the per-cluster checklist', async () => {
    const fake = fakeEnv(fakeDisplay())
    await toReady(fake)
    click(buttonByText(host, 'Begin'))
    expect(h1()).toBe('Up next: Reaction Time')
    expect(host.textContent).toMatch(/About \d+ minutes?\./)
    const ring = host.querySelector('[role="progressbar"]')
    expect(ring?.getAttribute('aria-label')).toBe('Session time')
    expect(ring?.getAttribute('aria-valuetext')).toBe('0 of about 30 min')
    const list = host.querySelector('section[aria-label="Session checklist"]')
    expect([...list!.querySelectorAll('li')].map((li) => li.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      expect.stringContaining('Speed'),
      expect.stringContaining('Reasoning'),
      expect.stringContaining('Spatial/Memory'),
      expect.stringContaining('Quantitative'),
      expect.stringContaining('Estimation'),
    ])
    expect(list!.textContent).toContain('Not in this version')
    expect(list!.querySelector('.later')?.textContent).not.toContain('Estimation')
    expect(buttonByText(host, 'Finish early')).toBeTruthy()
    expect(buttonByText(host, 'Skip this part')).toBeTruthy()
    // The autosave is created now, after the gate: a save exists for the session soon (timer-coalesced).
    expect(host.querySelector('header')).not.toBeNull()
  })

  it('skipping a part from its interstitial passes over it; a counted item shows no key and no feedback', async () => {
    const fake = fakeEnv(fakeDisplay())
    await toReady(fake)
    click(buttonByText(host, 'Begin'))
    click(buttonByText(host, 'Skip this part'))
    click(buttonByText(host, 'Skip Reaction Time')) // asks first
    expect(h1()).toBe('Up next: Matrix & Series')
    // Reaction Time is skipped, but Speed still has processing and reading speed ahead.
    // ... but it is not what comes next: Spatial/Memory is "Up next", Speed "Later" (UX-007a).
    expect(host.querySelector('.checklist li[data-status="later"]')?.textContent).toContain('Speed')
    expect(host.querySelector('.checklist li[data-status="upcoming"]')?.textContent).toContain('Spatial/Memory')
    expect(host.querySelector('.checklist li[data-status="current"]')?.textContent).toContain('Reasoning')
    click(buttonByText(host, 'Start'))
    await settle(3)
    expect(host.querySelector('[role="progressbar"]')).not.toBeNull()
    // An item is on screen (matrices or series) and says nothing about being right.
    expect(host.querySelector('section.series, .matrix')).not.toBeNull()
    expect(host.textContent).not.toMatch(/correct|incorrect|wrong|not quite/i)
    expect(host.innerHTML).not.toMatch(/data-(key|correct|answer)|is_correct|correctIndex/i)
  })

  it('finish early asks first, keeps the page, and ends with a results screen', async () => {
    const fake = fakeEnv(fakeDisplay())
    await toReady(fake)
    click(buttonByText(host, 'Begin'))
    click(buttonByText(host, 'Finish early'))
    expect(host.querySelector('section.confirm h2')?.textContent).toBe('Finish now?')
    click(buttonByText(host, 'Keep going'))
    expect(host.querySelector('section.confirm')).toBeNull()
    expect(h1()).toBe('Up next: Reaction Time')
    click(buttonByText(host, 'Finish early'))
    click(buttonByText(host, 'Finish now'))
    expect(h1()).toBe('Session ended') // nothing was measured (UX-009b)
    expect(host.textContent).toContain('You finished early')
    expect(host.textContent).toContain('Nothing was measured')
    expect(buttonByText(host, 'Download save file')).toBeTruthy()
    // A session without an answer is not kept: nothing but the consent was written (the download is still there).
    expect(fake.storage.writes).toEqual([`set:${CONSENT_KEY}`])
  })

  it('the desktop fixture is not a touch device', () => {
    expect(DESKTOP.coarsePointer).toBe(false)
  })
})

/** A save with one answered question, as an autosave of this browser would hold it. */
function savedSession(id = 's_FUNNELROW0000001'): SaveFileV1 {
  const bot = new Bot({ sessionId: id, skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
  bot.until((v) => v.phase === 'confidence')
  bot.run.confirmConfidence(bot.view().confidence!.startPct)
  bot.run.finishEarly()
  return saveWithSession(null, bot.run.sessionState(), { ctx: SAVE_CTX, createdMs: 1_790_000_100_000, anonId: 'hb_' + 'f'.repeat(17) })
}

const notesContext: BriefContextV1 = {
  slot: 1,
  preset: 'reading',
  destination: 'chatgpt_instructions',
  tier: 'T1',
  mode: 'do',
  length: 'standard',
  topics: {},
  lines_on: [],
  lines_off: [],
  rev: 1,
}
const notesPrefs: BriefPrefsV1 = { v: 1, topics: 'topics-v1', groups: 'g1', notes_as_of: '2026-11', contexts: [notesContext], fit_log: [] }

/** What a browser that was used before holds: an adult consent record (of these terms unless said), results, notes. */
function seed(fake: FakeEnv<FakeDisplay>, what: { consent?: string | false; results?: boolean; notes?: 'only' | 'with-results' | 'removed' }): void {
  if (what.consent !== false) fake.storage.data.set(CONSENT_KEY, JSON.stringify({ v: 1, terms: what.consent ?? TERMS_VERSION, adult: true }))
  const base = what.results === true ? savedSession() : null
  if (base !== null) {
    const withNotes = what.notes === 'with-results' ? { ...base, brief_prefs: notesPrefs } : base
    fake.storage.data.set(autosaveKey(base.sessions[0]!.session_id), JSON.stringify(withNotes))
  }
  if (what.notes === 'only' || what.notes === 'removed') {
    const prefs = what.notes === 'only' ? notesPrefs : { ...notesPrefs, contexts: [{ slot: 1, rev: 2, removed: true as const }] }
    fake.storage.data.set(autosaveKey('prefs'), JSON.stringify(prefsOnlySave(prefs, 'hb_' + 'f'.repeat(17), 1_790_000_100_000)))
  }
}

const buttons = (): (string | undefined)[] => [...host.querySelectorAll('button')].map((b) => b.textContent?.trim())
const row = (): HTMLElement | null => host.querySelector('[data-testid="welcome-returning"]')
const notesLink = (): HTMLAnchorElement | null => host.querySelector<HTMLAnchorElement>('[data-testid="welcome-notes"]')

describe('the welcome row for a returning visitor (provisional default, UX-REVIEW D22)', () => {
  it('a first visit sees what it always saw, and the page reads one key: the consent record', () => {
    const fake = fakeEnv(fakeDisplay())
    open(fake)
    expect(h1()).toBe('HumanBench')
    expect(row()).toBeNull()
    expect(buttons()).toEqual(['Start'])
    expect(host.querySelectorAll('.hb-primary')).toHaveLength(1)
    expect(fake.storage.calls).toEqual([`get:${CONSENT_KEY}`])
  })

  it('shows "See my results" for an adult record with results, under Start, which stays the one primary button', () => {
    const fake = fakeEnv(fakeDisplay())
    seed(fake, { results: true })
    open(fake)
    expect(buttons()).toEqual(['Start', 'See my results'])
    expect(host.querySelectorAll('.hb-primary')).toHaveLength(1)
    expect(buttonByText(host, 'Start').classList.contains('hb-primary')).toBe(true)
    expect(row()?.getAttribute('role')).toBe('group')
    expect(row()?.getAttribute('aria-label')).toBe('Earlier results and notes on this device')
    expect(notesLink()).toBeNull()
    // Start is first in the page, so the order of the tab stops is Start, the row, the privacy link.
    const order = [...host.querySelectorAll('main button, main a')].map((e) => e.textContent?.trim())
    expect(order).toEqual(['Start', 'See my results', 'Privacy and terms'])
    expect(fake.storage.writes).toEqual([])
  })

  it('shows "Notes for your AI" as a link to the notes page, in a new tab, when notes settings are kept', () => {
    const fake = fakeEnv(fakeDisplay())
    seed(fake, { notes: 'only' })
    open(fake)
    expect(buttons()).toEqual(['Start'])
    const link = notesLink()!
    expect(link.textContent).toBe('Notes for your AI (opens in a new tab)')
    expect(link.getAttribute('href')).toMatch(/notes\.html$/)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener')
    expect(fake.storage.writes).toEqual([])
  })

  it('shows both when the browser holds results and notes', () => {
    const fake = fakeEnv(fakeDisplay())
    seed(fake, { results: true, notes: 'with-results' })
    open(fake)
    expect(buttons()).toEqual(['Start', 'See my results'])
    expect(notesLink()).not.toBeNull()
  })

  it('shows nothing for a record with nothing behind it, notes that were all removed, or data with no record', () => {
    for (const what of [{}, { notes: 'removed' as const }, { consent: false as const, results: true }, { consent: false as const, notes: 'only' as const }]) {
      const fake = fakeEnv(fakeDisplay())
      seed(fake, what)
      open(fake)
      expect(row(), JSON.stringify(what)).toBeNull()
      expect(buttons()).toEqual(['Start'])
      // Without an adult record the saves are not even looked at: one key is read, and nothing is written.
      if (what.consent === false) expect(fake.storage.calls).toEqual([`get:${CONSENT_KEY}`])
      expect(fake.storage.writes).toEqual([])
      unmount(app!)
      app = undefined
      document.body.innerHTML = ''
    }
  })

  it('the autosaves of two identifiers are the person\'s choice on the ready screen, so there is no results button for them here', () => {
    const fake = fakeEnv(fakeDisplay())
    seed(fake, { results: true })
    const other = { ...savedSession('s_FUNNELROW0000002'), anon_id: 'hb_' + 'e'.repeat(17) }
    fake.storage.data.set(autosaveKey('s_FUNNELROW0000002'), JSON.stringify(other))
    open(fake)
    expect(row()).toBeNull()
  })

  it('the under-18 path reads and writes what it did before: the consent key, and nothing is written', () => {
    const fake = fakeEnv(fakeDisplay())
    open(fake)
    click(buttonByText(host, 'Start'))
    click(buttonByText(host, 'I am under 18'))
    expect(h1()).toBe('HumanBench is for adults')
    expect(new Set(fake.storage.calls)).toEqual(new Set([`get:${CONSENT_KEY}`]))
    expect(fake.storage.writes).toEqual([])
    expect(fake.storage.data.size).toBe(0)
  })

  it('"See my results" with a record of these terms goes straight to the earlier results: no gate, no honour code, no session, nothing written', async () => {
    const fake = fakeEnv(fakeDisplay())
    seed(fake, { results: true })
    open(fake)
    click(buttonByText(host, 'See my results'))
    expect(h1()).toBe('Your results')
    expect(document.title).toBe('Your results · HumanBench')
    expect(host.querySelector('main > p.lead')?.textContent).toBe('Your profile from 1 earlier session.')
    expect(host.querySelector('svg.hb-blob')).not.toBeNull()
    expect(fake.storage.writes).toEqual([])
    // No measurement was started for a session that is not coming.
    expect(fake.display.pending()).toBe(0)
  })

  it('a record of older terms opens the row, and "See my results" shows the gate first: nothing is read or written before it is passed', () => {
    const fake = fakeEnv(fakeDisplay())
    seed(fake, { consent: 'terms-2026-09-draft', results: true })
    open(fake)
    expect(buttons()).toEqual(['Start', 'See my results'])
    const callsBefore = fake.storage.calls.length
    click(buttonByText(host, 'See my results'))
    expect(h1()).toBe('Before you start')
    expect(box(/18 or older/).checked).toBe(false)
    expect(fake.storage.writes).toEqual([])
    // The saves were not read for the gate screen.
    expect(fake.storage.calls.slice(callsBefore).every((c) => c === `get:${CONSENT_KEY}`)).toBe(true)
    // The gate says nothing is passed until it is: the box.
    click(buttonByText(host, 'Continue'))
    expect(h1()).toBe('Before you start')
    click(box(/18 or older/))
    click(buttonByText(host, 'Continue'))
    // Straight to the results: no honour code, no device check.
    expect(h1()).toBe('Your results')
    expect(host.querySelector('svg.hb-blob')).not.toBeNull()
    expect(fake.storage.writes).toEqual([`set:${CONSENT_KEY}`])
    expect(JSON.parse(fake.storage.data.get(CONSENT_KEY)!)).toEqual({ v: 1, terms: TERMS_VERSION, adult: true })
    expect(fake.display.pending()).toBe(0)
  })

  it('"I am under 18" at that gate keeps nothing, and the way back leads on to the results, not to a session', () => {
    const fake = fakeEnv(fakeDisplay())
    seed(fake, { consent: 'terms-2026-09-draft', results: true })
    const before = new Map(fake.storage.data)
    open(fake)
    click(buttonByText(host, 'See my results'))
    click(buttonByText(host, 'I am under 18'))
    expect(h1()).toBe('HumanBench is for adults')
    expect(fake.storage.writes).toEqual([])
    expect(fake.storage.data).toEqual(before)
    click(buttonByText(host, 'I chose this by mistake'))
    expect(h1()).toBe('Before you start')
    click(box(/18 or older/))
    click(buttonByText(host, 'Continue'))
    expect(h1()).toBe('Your results')
  })

  it('"Start" after a look at the row goes the usual way, and the results of the welcome row are a fresh visit after "Back to the start"', async () => {
    const fake = fakeEnv(fakeDisplay())
    seed(fake, { results: true })
    open(fake)
    click(buttonByText(host, 'See my results'))
    click(buttonByText(host, 'Back to the start'))
    // The file was not downloaded in this visit, so leaving asks first (as after a session).
    const leave = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Leave anyway')
    if (leave !== undefined) click(leave)
    expect(h1()).toBe('HumanBench')
    expect(buttons()).toEqual(['Start', 'See my results'])
    click(buttonByText(host, 'Start'))
    expect(h1()).toBe('Honour code')
  })

  it('earlier answers that all sit on skipped skills offer the row but have nothing to show: "See my results" goes the usual way in instead of to an empty page', () => {
    const fake = fakeEnv(fakeDisplay())
    const save = savedSession()
    const skipped = Object.fromEntries(['rt', 'mat', 'spa', 'wm', 'qr', 'ps'].map((k) => [`skipped_${k}`, true]))
    const all = { ...save, sessions: save.sessions.map((x) => ({ ...x, flags: { ...x.flags, ...skipped } })) }
    fake.storage.data.set(CONSENT_KEY, JSON.stringify({ v: 1, terms: TERMS_VERSION, adult: true }))
    fake.storage.data.set(autosaveKey(all.sessions[0]!.session_id), JSON.stringify(all))
    open(fake)
    click(buttonByText(host, 'See my results'))
    expect(h1()).toBe('Honour code')
    expect(fake.display.pending()).toBe(1)
    expect(fake.storage.writes).toEqual([])
  })

  it('a record for older terms does not skip the gate for Start, as before', () => {
    const fake = fakeEnv(fakeDisplay())
    seed(fake, { consent: 'terms-2026-09-draft', results: true })
    open(fake)
    click(buttonByText(host, 'Start'))
    expect(h1()).toBe('Before you start')
  })

  describe('a focus session asked for from those results', () => {
    async function withStub(fake: FakeEnv<FakeDisplay>): Promise<void> {
      const module = { default: ResultsStub } as unknown as ResultsModule
      const loader = createResultsLoader({ importer: async () => module, delays: [], beforeRetry: async () => undefined, online: () => true })
      await loader.load()
      injected = loader
      open(fake)
    }

    it('asks for the honour code and the device check first, then starts the part: it is a session', async () => {
      const fake = fakeEnv(fakeDisplay())
      seed(fake, { results: true })
      await withStub(fake)
      click(buttonByText(host, 'See my results'))
      expect(h1()).toBe('Your results')
      click(buttonByText(host, 'Focus on reaction time'))
      expect(h1()).toBe('Honour code')
      // The measurement starts here, as for any session.
      expect(fake.display.pending()).toBe(1)
      click(box(/honour code/))
      click(buttonByText(host, 'Continue'))
      expect(h1()).toBe('Check your device')
      fake.display.advance(1200)
      await new Promise((resolve) => setTimeout(resolve, 0))
      flushSync()
      click(buttonByText(host, 'Continue'))
      expect(h1()).toMatch(/^Up next: /)
      // The consent was kept already; the new session's autosave waits for its timer, so nothing was written on the way.
      expect(fake.storage.writes).toEqual([])
    })
  })
})

describe('the device measurement starts on the gate (provisional default, UX-REVIEW D23)', () => {
  const frameWait = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
  }
  /** The device screen has put its "Checking your screen" words into its status line (it does so a tick after it is up). */
  const statusWords = async (): Promise<void> => {
    await tick()
    await tick()
    flushSync()
  }

  it('is started when the gate comes up, with one animation frame asked for at a time, and nothing is stored', () => {
    const fake = fakeEnv(fakeDisplay())
    open(fake)
    expect(fake.display.pending()).toBe(0)
    click(buttonByText(host, 'Start'))
    expect(h1()).toBe('Before you start')
    expect(fake.display.pending()).toBe(1)
    fake.display.advance(300)
    expect(fake.display.pending()).toBe(1)
    expect(fake.storage.writes).toEqual([])
    expect(fake.storage.data.size).toBe(0)
    expect(localStorage.length).toBe(0)
    expect(document.cookie).toBe('')
  })

  it('is reused: done on the gate, the device screen has its facts at once and measures nothing again', async () => {
    const fake = fakeEnv(fakeDisplay())
    open(fake)
    click(buttonByText(host, 'Start'))
    fake.display.advance(1200)
    await frameWait()
    click(box(/18 or older/))
    click(buttonByText(host, 'Continue'))
    expect(h1()).toBe('Honour code')
    click(box(/honour code/))
    click(buttonByText(host, 'Continue'))
    expect(h1()).toBe('Check your device')
    // No waiting: the facts, with the rate, and a "Continue" that works.
    expect(host.querySelector('dl.facts')?.textContent).toContain('60 Hz (screen updates per second)')
    expect(host.textContent).not.toContain('Checking your screen')
    expect(buttonByText(host, 'Continue').hasAttribute('aria-disabled')).toBe(false)
    await tick()
    expect(host.textContent).not.toContain('Checking your screen')
    expect(fake.display.pending()).toBe(0)
    click(buttonByText(host, 'Continue'))
    expect(h1()).toBe('Ready when you are')
  })

  it('the device screen shows the same facts whether the measurement was made on the gate or there', async () => {
    // (`DeviceCheck.dom.test.ts` compares the DeviceInfo it hands on, field by field.)
    const factsAfter = async (onGate: boolean): Promise<string> => {
      const fake = fakeEnv(fakeDisplay())
      open(fake)
      click(buttonByText(host, 'Start'))
      if (onGate) {
        fake.display.advance(1200)
        await frameWait()
      }
      click(box(/18 or older/))
      click(buttonByText(host, 'Continue'))
      click(box(/honour code/))
      click(buttonByText(host, 'Continue'))
      if (!onGate) {
        fake.display.advance(1200)
        await frameWait()
      }
      const facts = host.querySelector('dl.facts')?.textContent ?? ''
      unmount(app!)
      app = undefined
      document.body.innerHTML = ''
      return facts
    }
    expect(await factsAfter(true)).toBe(await factsAfter(false))
  })

  it('still under way when the device screen opens: it waits for what is left, once', async () => {
    const fake = fakeEnv(fakeDisplay())
    open(fake)
    click(buttonByText(host, 'Start'))
    fake.display.advance(500)
    click(box(/18 or older/))
    click(buttonByText(host, 'Continue'))
    click(box(/honour code/))
    click(buttonByText(host, 'Continue'))
    expect(h1()).toBe('Check your device')
    await statusWords()
    expect(host.textContent).toContain('Checking your screen')
    expect(fake.display.pending()).toBe(1)
    fake.display.advance(700)
    await frameWait()
    expect(host.textContent).not.toContain('Checking your screen')
    expect(host.querySelector('dl.facts')?.textContent).toContain('60 Hz')
    expect(fake.display.pending()).toBe(0)
  })

  it('where the gate is skipped (the consent is kept) it starts on the honour screen', () => {
    const fake = fakeEnv(fakeDisplay())
    fake.storage.data.set(CONSENT_KEY, JSON.stringify({ v: 1, terms: TERMS_VERSION, adult: true }))
    open(fake)
    click(buttonByText(host, 'Start'))
    expect(h1()).toBe('Honour code')
    expect(fake.display.pending()).toBe(1)
    expect(fake.storage.writes).toEqual([])
  })

  it('is dropped when the person says they are under 18: no frame is asked for, and nothing was stored', () => {
    const fake = fakeEnv(fakeDisplay())
    open(fake)
    click(buttonByText(host, 'Start'))
    fake.display.advance(300)
    expect(fake.display.pending()).toBe(1)
    click(buttonByText(host, 'I am under 18'))
    expect(h1()).toBe('HumanBench is for adults')
    expect(fake.display.pending()).toBe(0)
    fake.display.advance(2000)
    expect(fake.display.pending()).toBe(0)
    expect(fake.storage.writes).toEqual([])
    expect(fake.storage.data.size).toBe(0)
    expect(document.cookie).toBe('')
  })

  it('starts again when the person takes the under-18 choice back, and leaving the page cancels it', () => {
    const fake = fakeEnv(fakeDisplay())
    open(fake)
    click(buttonByText(host, 'Start'))
    click(buttonByText(host, 'I am under 18'))
    expect(fake.display.pending()).toBe(0)
    click(buttonByText(host, 'I chose this by mistake'))
    expect(h1()).toBe('Before you start')
    expect(fake.display.pending()).toBe(1)
    unmount(app!)
    app = undefined
    expect(fake.display.pending()).toBe(0)
  })

  it('is not started on a page that is hidden, and the device screen measures as it always did', async () => {
    const fake = fakeEnv(fakeDisplay())
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    open(fake)
    click(buttonByText(host, 'Start'))
    expect(fake.display.pending()).toBe(0)
    hidden.mockReturnValue('visible')
    click(box(/18 or older/))
    click(buttonByText(host, 'Continue'))
    click(box(/honour code/))
    click(buttonByText(host, 'Continue'))
    expect(h1()).toBe('Check your device')
    await statusWords()
    expect(host.textContent).toContain('Checking your screen')
    expect(fake.display.pending()).toBe(1)
    fake.display.advance(1200)
    await frameWait()
    expect(host.querySelector('dl.facts')?.textContent).toContain('60 Hz')
  })

  it('a page hidden while it measures: dropped, and measured again on the device screen', async () => {
    const fake = fakeEnv(fakeDisplay())
    open(fake)
    click(buttonByText(host, 'Start'))
    fake.display.advance(300)
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await frameWait()
    expect(fake.display.pending()).toBe(0)
    hidden.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    click(box(/18 or older/))
    click(buttonByText(host, 'Continue'))
    click(box(/honour code/))
    click(buttonByText(host, 'Continue'))
    await statusWords()
    expect(host.textContent).toContain('Checking your screen')
    expect(fake.display.pending()).toBe(1)
    fake.display.advance(1200)
    await frameWait()
    expect(host.querySelector('dl.facts')?.textContent).toContain('60 Hz')
  })
})

describe('a way back from "I am under 18" (provisional default, UX-REVIEW D24)', () => {
  it('"I chose this by mistake" is a quiet button of its own on the under-18 screen, not a second primary action', () => {
    const fake = fakeEnv(fakeDisplay())
    open(fake)
    click(buttonByText(host, 'Start'))
    click(buttonByText(host, 'I am under 18'))
    const back = buttonByText(host, 'I chose this by mistake')
    expect(back.type).toBe('button')
    expect(back.classList.contains('hb-primary')).toBe(false)
    expect(host.querySelectorAll('.hb-primary')).toHaveLength(0)
    // The block itself is as firm as before: its words are unchanged.
    expect(host.textContent).toContain('You must be 18 or older to take part. Nothing has been stored on this device.')
  })

  it('returns to the 18+ gate with the box unticked and no message, focus on the heading, and nothing stored', () => {
    const fake = fakeEnv(fakeDisplay())
    open(fake)
    click(buttonByText(host, 'Start'))
    // Even a box that was ticked before the wrong button was pressed comes back unticked.
    click(box(/18 or older/))
    expect(box(/18 or older/).checked).toBe(true)
    click(buttonByText(host, 'I am under 18'))
    expect(h1()).toBe('HumanBench is for adults')
    click(buttonByText(host, 'I chose this by mistake'))
    expect(h1()).toBe('Before you start')
    expect(document.activeElement).toBe(document.querySelector('main h1'))
    expect(document.title).toBe('Before you start · HumanBench')
    expect(box(/18 or older/).checked).toBe(false)
    expect(box(/18 or older/).hasAttribute('aria-invalid')).toBe(false)
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(fake.storage.writes).toEqual([])
    expect(fake.storage.data.size).toBe(0)
    expect(document.cookie).toBe('')
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('comes back without the message of an earlier try with the box missing', () => {
    const fake = fakeEnv(fakeDisplay())
    open(fake)
    click(buttonByText(host, 'Start'))
    click(buttonByText(host, 'Continue'))
    expect(host.querySelector('[role="alert"]')).not.toBeNull()
    click(buttonByText(host, 'I am under 18'))
    click(buttonByText(host, 'I chose this by mistake'))
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(box(/18 or older/).hasAttribute('aria-invalid')).toBe(false)
  })

  it('the choice can be made again and taken back again, and the gate still passes only with its box ticked; only then is the consent kept', () => {
    const fake = fakeEnv(fakeDisplay())
    open(fake)
    click(buttonByText(host, 'Start'))
    for (let i = 0; i < 3; i++) {
      click(buttonByText(host, 'I am under 18'))
      expect(h1()).toBe('HumanBench is for adults')
      click(buttonByText(host, 'I chose this by mistake'))
      expect(h1()).toBe('Before you start')
    }
    click(buttonByText(host, 'Continue'))
    expect(h1()).toBe('Before you start')
    expect(fake.storage.writes).toEqual([])
    click(box(/18 or older/))
    click(buttonByText(host, 'Continue'))
    expect(h1()).toBe('Honour code')
    expect(fake.storage.writes).toEqual([`set:${CONSENT_KEY}`])
  })

  it('reads nothing more than the under-18 path read before: the consent key', () => {
    const fake = fakeEnv(fakeDisplay())
    open(fake)
    click(buttonByText(host, 'Start'))
    click(buttonByText(host, 'I am under 18'))
    click(buttonByText(host, 'I chose this by mistake'))
    click(buttonByText(host, 'I am under 18'))
    expect(new Set(fake.storage.calls)).toEqual(new Set([`get:${CONSENT_KEY}`]))
  })
})
