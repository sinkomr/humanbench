import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buttonByText, click, fakeDisplay, type FakeDisplay } from '../render/common/testing'
import { settle } from '../render/dom-testing'
import { CONSENT_KEY, TERMS_VERSION } from './constants'
import { DESKTOP, fakeEnv, type FakeEnv } from './dom-support'
import SessionApp from './SessionApp.svelte'
import { resultsLoader } from './results-loader'

// The results code is its own chunk (UX-100); loaded here once, so the flow shows the results at once as it does
// when the ready screen has fetched them.
beforeAll(async () => {
  await resultsLoader.load()
}, 90_000)

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement

function open(fake: FakeEnv<FakeDisplay>): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = mount(SessionApp, { target: host, props: { env: fake.env } })
  flushSync()
}

afterEach(() => {
  if (app) unmount(app)
  app = undefined
  document.body.innerHTML = ''
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
    // Nothing more to do on that screen: no way forward.
    expect(host.querySelectorAll('button')).toHaveLength(0)
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
