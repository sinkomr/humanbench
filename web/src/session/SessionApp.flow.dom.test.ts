/**
 * Moving about the session flow (UX-006, UX-010, UX-011): where focus and the tab title are when a screen is
 * reached again, the results of a loaded save without a new session, and the ways out of a run that has
 * answers in it (the tab asks before it is closed; the browser's Back button asks "Finish now?"). `SessionRun`
 * is wrapped to reach the run; everything else is the real flow.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { buttonByText, click, fakeDisplay } from '../render/common/testing'
import { settle } from '../render/dom-testing'
import { encodeSaveCode } from '../save/codec'
import { saveWithSession } from '../save/create'
import { newAnonId } from '../save/ids'
import { Bot } from './bot'
import { CONSENT_KEY, SAVE_CTX } from './constants'
import { fakeEnv, type FakeEnv } from './dom-support'
import type { RunConfig, SessionRun } from './run'
import SessionApp from './SessionApp.svelte'
import {
  createResultsLoader,
  RESULTS_DOWNLOAD,
  RESULTS_FAILED,
  RESULTS_PENDING_HEADING,
  RESULTS_PREPARING,
  RESULTS_RETRY,
  resultsDownloaded,
  resultsLoader,
  type ResultsLoader,
  type ResultsModule,
} from './results-loader'
import type { SaveFileV1 } from '../save/types'

// The results code is its own chunk (UX-100); loaded here once, so the flow shows the results at once as it does
// when the ready screen has fetched them.
beforeAll(async () => {
  await resultsLoader.load()
}, 90_000)

const runs = vi.hoisted(() => [] as unknown[])

vi.mock('./run', async (importOriginal) => {
  const m = await importOriginal<typeof import('./run')>()
  return {
    ...m,
    SessionRun: class extends m.SessionRun {
      constructor(cfg: RunConfig) {
        super(cfg)
        runs.push(this)
      }
    },
  }
})

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement
const phases: string[] = []

beforeEach(() => {
  phases.length = 0
})
afterEach(() => {
  if (app) unmount(app)
  app = undefined
  document.body.innerHTML = ''
  runs.length = 0
  document.title = 'HumanBench'
  vi.restoreAllMocks()
})

const h1El = (): HTMLElement => document.querySelector('main h1')!
const h1 = (): string => h1El().textContent?.trim() ?? ''
const box = (label: RegExp): HTMLInputElement => {
  const l = [...document.querySelectorAll('label')].find((x) => label.test(x.textContent ?? ''))
  const el = l?.control
  if (!(el instanceof HTMLInputElement)) throw new Error(`no checkbox for ${String(label)}`)
  return el
}
const lastRun = (): SessionRun => runs.at(-1) as SessionRun

function mountApp(fake: FakeEnv<ReturnType<typeof fakeDisplay>>): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = mount(SessionApp, { target: host, props: { env: fake.env, onphase: (p: string) => phases.push(p) } })
  flushSync()
}

async function toReady(fake: FakeEnv<ReturnType<typeof fakeDisplay>>): Promise<void> {
  mountApp(fake)
  click(buttonByText(host, 'Start'))
  click(box(/18 or older/))
  click(buttonByText(host, 'Continue'))
  click(box(/honour code/))
  click(buttonByText(host, 'Continue'))
  fake.display.advance(1200)
  await new Promise((resolve) => setTimeout(resolve, 0))
  flushSync()
  click(buttonByText(host, 'Continue'))
  expect(h1()).toBe('Ready when you are')
}

/** One answered question in the run on screen, then back at the first interstitial's neighbour: the run holds an answer. */
async function answerOne(): Promise<void> {
  const run = lastRun()
  run.skipAxis() // reaction time, from its interstitial
  run.startSegment()
  flushSync()
  await settle(2)
  const item = run.view().item!
  run.itemResponded(item.options_count === undefined ? '1' : 0)
  run.confirmConfidence(run.view().confidence!.startPct)
  flushSync()
}

/** Would the page ask the browser to confirm leaving now? */
function guarded(): boolean {
  const e = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(e)
  return e.defaultPrevented
}

describe('returning to a screen (UX-006, WCAG 2.4.2, 2.4.3)', () => {
  it('the first load leaves focus alone; the tab is named after the screen from the second on', async () => {
    const fake = fakeEnv(fakeDisplay())
    mountApp(fake)
    expect(document.activeElement).toBe(document.body)
    expect(document.title).toBe('HumanBench')
    click(buttonByText(host, 'Start'))
    expect(document.title).toBe('Before you start · HumanBench')
    click(box(/18 or older/))
    click(buttonByText(host, 'Continue'))
    expect(document.title).toBe('Honour code · HumanBench')
  })

  it('"Back to the start" lands on the welcome heading, which has focus and the plain title', async () => {
    const fake = fakeEnv(fakeDisplay())
    await toReady(fake)
    click(buttonByText(host, 'Begin'))
    click(buttonByText(host, 'Finish early'))
    click(buttonByText(host, 'Finish now'))
    expect(h1()).toBe('Session ended')
    expect(document.title).toBe('Session ended · HumanBench')
    click(buttonByText(host, 'Back to the start'))
    expect(h1()).toBe('HumanBench')
    expect(document.activeElement).toBe(h1El())
    expect(document.title).toBe('HumanBench')
    expect(h1El().getAttribute('translate')).toBe('no')
  })

  it('the gate and the honour code mark their box when it is missing', () => {
    const fake = fakeEnv(fakeDisplay())
    mountApp(fake)
    click(buttonByText(host, 'Start'))
    const agree = box(/18 or older/)
    expect(agree.hasAttribute('aria-invalid')).toBe(false)
    click(buttonByText(host, 'Continue'))
    expect(agree.getAttribute('aria-invalid')).toBe('true')
    expect(agree.getAttribute('aria-describedby')).toBe(host.querySelector('[role="alert"]')?.id)
    click(agree)
    expect(agree.hasAttribute('aria-invalid')).toBe(false)
    expect(agree.hasAttribute('aria-describedby')).toBe(false)
    click(buttonByText(host, 'Continue'))
    const honour = box(/honour code/)
    click(buttonByText(host, 'Continue'))
    expect(honour.getAttribute('aria-invalid')).toBe('true')
    expect(honour.getAttribute('aria-describedby')).toBe(host.querySelector('[role="alert"]')?.id)
  })

  it('the gate’s notice link opens the notice in this tab, so the flow underneath is where it was left', () => {
    const fake = fakeEnv(fakeDisplay())
    mountApp(fake)
    click(buttonByText(host, 'Start'))
    const link = host.querySelector<HTMLAnchorElement>('a[href="#/privacy"]')!
    expect(link.hasAttribute('target')).toBe(false)
    expect(link.hasAttribute('rel')).toBe(false)
  })
})

describe('the results of a loaded save, with no new session (UX-010)', () => {
  async function savedCode(): Promise<string> {
    const bot = new Bot({ sessionId: 's_VIEWSAVE0000001', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    bot.until((v) => v.phase === 'confidence')
    bot.run.confirmConfidence(bot.view().confidence!.startPct)
    bot.run.finishEarly()
    return encodeSaveCode(saveWithSession(null, bot.run.sessionState(), { ctx: SAVE_CTX, createdMs: 1_790_000_100_000, anonId: newAnonId() }))
  }

  it('is offered once a save is loaded, shows the profile under "Your results", and writes and starts nothing', async () => {
    const fake = fakeEnv(fakeDisplay())
    await toReady(fake)
    expect([...host.querySelectorAll('button')].map((b) => b.textContent?.trim())).not.toContain('See my results')
    const area = host.querySelector<HTMLTextAreaElement>('textarea')!
    area.value = await savedCode()
    const runsBefore = runs.length
    area.dispatchEvent(new Event('input', { bubbles: true }))
    click(buttonByText(host, 'Load'))
    await vi.waitFor(() => expect(host.textContent).toContain('Loaded 1 earlier session'))
    flushSync()
    click(buttonByText(host, 'See my results'))
    expect(h1()).toBe('Your results')
    expect(document.title).toBe('Your results · HumanBench')
    expect(document.activeElement).toBe(h1El())
    expect(host.querySelector('main > p.lead')?.textContent).toBe('Your profile from 1 earlier session.')
    expect(host.querySelector('svg.hb-blob')).not.toBeNull()
    expect(host.querySelector('[data-section="save"]')).not.toBeNull()
    // No run was made, nothing but the consent was stored.
    expect(runs).toHaveLength(runsBefore)
    expect(fake.storage.writes).toEqual([`set:${CONSENT_KEY}`])
    expect(phases.at(-1)).toBe('finished')
    // The way back leads to the start; a second look is a fresh visit.
    // (The file was not downloaded in this visit, so leaving asks first, as after a session.)
    click(buttonByText(host, 'Back to the start'))
    click(buttonByText(host, 'Leave anyway'))
    expect(h1()).toBe('HumanBench')
    expect(fake.storage.writes).toEqual([`set:${CONSENT_KEY}`])
  })
})

describe('leaving a run by accident (UX-011)', () => {
  it('the tab asks before it is closed once the run holds an answer, and not before', async () => {
    const fake = fakeEnv(fakeDisplay())
    await toReady(fake)
    click(buttonByText(host, 'Begin'))
    expect(h1()).toBe('Up next: Reaction time')
    expect(guarded()).toBe(false) // nothing to lose yet: an abandoned start leaves nothing behind
    await answerOne()
    expect(guarded()).toBe(true)
  })

  it('the browser’s Back button during a run opens "Finish now?" and stays on the page; Escape or "Keep going" carries on', async () => {
    const fake = fakeEnv(fakeDisplay())
    await toReady(fake)
    const push = vi.spyOn(history, 'pushState')
    click(buttonByText(host, 'Begin'))
    await settle(1)
    // The run has an entry of its own to land on.
    expect(push).toHaveBeenCalledTimes(1)
    expect(push.mock.calls[0]![0]).toEqual({ hb: 'run' })
    expect(host.querySelector('section.confirm')).toBeNull()
    window.dispatchEvent(new PopStateEvent('popstate'))
    flushSync()
    expect(push).toHaveBeenCalledTimes(2) // put back, so the next Back asks again
    expect(h1()).toBe('Up next: Reaction time')
    expect(host.querySelector('section.confirm h2')?.textContent).toBe('Finish now?')
    expect(document.activeElement).toBe(host.querySelector('section.confirm h2'))
    click(buttonByText(host, 'Keep going'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    expect(host.querySelector('section.confirm')).toBeNull()
    expect(document.activeElement).toBe(buttonByText(host, 'Finish early'))
    window.dispatchEvent(new PopStateEvent('popstate'))
    flushSync()
    expect(host.querySelector('section.confirm h2')?.textContent).toBe('Finish now?')
    click(buttonByText(host, 'Finish now'))
    expect(h1()).toBe('Session ended')
  })

  it('when the run ends its history entry is used up, and Back is not caught any more', async () => {
    const fake = fakeEnv(fakeDisplay())
    await toReady(fake)
    click(buttonByText(host, 'Begin'))
    await settle(1)
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined)
    click(buttonByText(host, 'Finish early'))
    click(buttonByText(host, 'Finish now'))
    expect(h1()).toBe('Session ended')
    expect(back).toHaveBeenCalledTimes(1)
    const push = vi.spyOn(history, 'pushState')
    window.dispatchEvent(new PopStateEvent('popstate'))
    flushSync()
    expect(push).not.toHaveBeenCalled()
    expect(host.querySelector('section.confirm')).toBeNull()
  })

  it('tells the page which screen it is on, so the notice can open in a new tab while a run is under way', async () => {
    const fake = fakeEnv(fakeDisplay())
    await toReady(fake)
    expect(phases).toContain('ready')
    click(buttonByText(host, 'Begin'))
    expect(phases.at(-1)).toBe('run')
    click(buttonByText(host, 'Finish early'))
    click(buttonByText(host, 'Finish now'))
    expect(phases.at(-1)).toBe('finished')
  })
})

describe('the results code comes as a chunk of its own (UX-100)', () => {
  /** A loader whose import the test settles by hand: one attempt per load, no waits between. */
  function handLoader(): {
    loader: ResultsLoader
    importer: Mock<() => Promise<ResultsModule>>
    settle: (outcome: 'resolve' | 'reject') => Promise<void>
  } {
    const pending: { resolve: (m: ResultsModule) => void; reject: (e: unknown) => void }[] = []
    const importer = vi.fn(() => new Promise<ResultsModule>((resolve, reject) => pending.push({ resolve, reject })))
    const loader = createResultsLoader({ importer, delays: [], beforeRetry: async () => undefined, online: () => true })
    return {
      loader,
      importer,
      settle: async (outcome) => {
        const module = await resultsLoader.load()
        for (const p of pending.splice(0)) {
          if (outcome === 'resolve') p.resolve(module)
          else p.reject(new Error('Failed to fetch dynamically imported module'))
        }
        // Every promise of the loader and the flow settles before the next task.
        await new Promise((resolve) => setTimeout(resolve, 0))
        flushSync()
      },
    }
  }

  function mountWith(fake: FakeEnv<ReturnType<typeof fakeDisplay>>, results: ResultsLoader, download?: (save: SaveFileV1) => string): void {
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(SessionApp, { target: host, props: { env: fake.env, onphase: (p: string) => phases.push(p), results, ...(download === undefined ? {} : { download }) } })
    flushSync()
  }

  /** From the welcome screen to the ready screen, as `toReady` does, with the app already mounted. */
  async function walkToReady(fake: FakeEnv<ReturnType<typeof fakeDisplay>>): Promise<void> {
    click(buttonByText(host, 'Start'))
    click(box(/18 or older/))
    click(buttonByText(host, 'Continue'))
    click(box(/honour code/))
    click(buttonByText(host, 'Continue'))
    fake.display.advance(1200)
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    click(buttonByText(host, 'Continue'))
    expect(h1()).toBe('Ready when you are')
  }

  const status = (): string[] => [...host.querySelectorAll('[role="status"]')].map((e) => e.textContent?.trim() ?? '')
  /** A retry waits a microtask (it first puts back failed stylesheets) before it asks for the chunk. */
  const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

  it('is fetched from the ready screen on, once, and not on the screens before it', async () => {
    const fake = fakeEnv(fakeDisplay())
    const hand = handLoader()
    mountWith(fake, hand.loader)
    click(buttonByText(host, 'Start'))
    click(box(/18 or older/))
    click(buttonByText(host, 'Continue'))
    click(box(/honour code/))
    click(buttonByText(host, 'Continue'))
    expect(h1()).toBe('Check your device')
    expect(hand.importer).not.toHaveBeenCalled()
    fake.display.advance(1200)
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    click(buttonByText(host, 'Continue'))
    expect(h1()).toBe('Ready when you are')
    expect(hand.importer).toHaveBeenCalledTimes(1)
    // Starting the run while it is still on its way does not ask for it a second time.
    click(buttonByText(host, 'Begin'))
    expect(h1()).toBe('Up next: Reaction time')
    expect(hand.importer).toHaveBeenCalledTimes(1)
    await hand.settle('resolve')
    click(buttonByText(host, 'Finish early'))
    click(buttonByText(host, 'Finish now'))
    expect(h1()).toBe('Session ended')
    expect(hand.importer).toHaveBeenCalledTimes(1)
  })

  it('still on its way when the session ends: "Preparing your results…", the tab guarded, then the results', async () => {
    const fake = fakeEnv(fakeDisplay())
    const hand = handLoader()
    mountWith(fake, hand.loader)
    await walkToReady(fake)
    click(buttonByText(host, 'Begin'))
    await answerOne()
    click(buttonByText(host, 'Finish early'))
    click(buttonByText(host, 'Finish now'))
    expect(h1()).toBe(RESULTS_PENDING_HEADING)
    expect(document.activeElement).toBe(h1El())
    expect(status()).toContain(RESULTS_PREPARING)
    expect(guarded()).toBe(true)
    expect(phases.at(-1)).toBe('finished')
    await hand.settle('resolve')
    expect(h1()).toBe('Session complete')
    expect(status()).not.toContain(RESULTS_PREPARING)
    expect(guarded()).toBe(true) // the reveal's own guard, until the save is downloaded (§10)
  })

  it('that never arrives: retried, then "Try again" and "Download my save file"; the download lifts the guard; "Try again" brings the results', async () => {
    const fake = fakeEnv(fakeDisplay())
    const hand = handLoader()
    const downloads: SaveFileV1[] = []
    mountWith(fake, hand.loader, (save) => {
      downloads.push(save)
      return 'humanbench-test.hbsave.json'
    })
    await walkToReady(fake)
    await hand.settle('reject') // the fetch from the ready screen fails: nothing shows
    expect(h1()).toBe('Ready when you are')
    click(buttonByText(host, 'Begin'))
    await nextTask()
    expect(hand.importer).toHaveBeenCalledTimes(2) // asked for again when the run starts
    await hand.settle('reject')
    await answerOne()
    click(buttonByText(host, 'Finish early'))
    click(buttonByText(host, 'Finish now'))
    await nextTask()
    expect(hand.importer).toHaveBeenCalledTimes(3) // and once more when the results are due
    expect(status()).toContain(RESULTS_PREPARING)
    await hand.settle('reject')
    expect(h1()).toBe(RESULTS_PENDING_HEADING)
    expect(status()).toContain(RESULTS_FAILED)
    expect(guarded()).toBe(true)
    // The person keeps their file: the save of this session, as the results would have handed it over.
    click(buttonByText(host, RESULTS_DOWNLOAD))
    expect(downloads).toHaveLength(1)
    expect(downloads[0]!.sessions.map((s) => s.session_id)).toEqual([lastRun().sessionId])
    expect(status()).toContain(resultsDownloaded('humanbench-test.hbsave.json'))
    expect(guarded()).toBe(false)
    click(buttonByText(host, RESULTS_RETRY))
    await nextTask()
    expect(hand.importer).toHaveBeenCalledTimes(4)
    expect(status()).toContain(RESULTS_PREPARING)
    await hand.settle('resolve')
    expect(h1()).toBe('Session complete')
  })

  it('"See my results" on the ready screen waits for it too, then shows the loaded save', async () => {
    const fake = fakeEnv(fakeDisplay())
    const hand = handLoader()
    mountWith(fake, hand.loader)
    await walkToReady(fake)
    const bot = new Bot({ sessionId: 's_VIEWSAVE0000001', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    bot.until((v) => v.phase === 'confidence')
    bot.run.confirmConfidence(bot.view().confidence!.startPct)
    bot.run.finishEarly()
    const code = await encodeSaveCode(saveWithSession(null, bot.run.sessionState(), { ctx: SAVE_CTX, createdMs: 1_790_000_100_000, anonId: newAnonId() }))
    const area = host.querySelector<HTMLTextAreaElement>('textarea')!
    area.value = code
    area.dispatchEvent(new Event('input', { bubbles: true }))
    click(buttonByText(host, 'Load'))
    await vi.waitFor(() => expect(host.textContent).toContain('Loaded 1 earlier session'))
    flushSync()
    click(buttonByText(host, 'See my results'))
    expect(status()).toContain(RESULTS_PREPARING)
    expect(guarded()).toBe(false) // nothing new to save: the results are those of the file just loaded
    await hand.settle('resolve')
    expect(h1()).toBe('Your results')
    expect(status()).not.toContain(RESULTS_PREPARING)
    expect(host.querySelector('svg.hb-blob')).not.toBeNull()
  })
})
