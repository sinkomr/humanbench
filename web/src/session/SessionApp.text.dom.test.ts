/**
 * The served text parts in the session flow (ROADMAP M3.11 phase 1; DESIGN §7.4, §10, §11.2, §13, R-5.6.x,
 * R-11.1): the words about the session's length before it starts, a text part the server has questions
 * for (the "Up next" screen, the question as text, the confidence slider, "Report a problem"), and a
 * server without them, where the flow is the six-part one. The server is a scripted fake transport;
 * `scripts/db/text-mc.db.test.ts` and `e2e-db/` use the real database.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SERVER_READY_TEXT, serverReadyText } from '../backend/copy'
import { CANNED, ScriptedTransport, fakeBackend } from '../backend/testing'
import type { AxisCode } from '../engine/axes'
import { TEXT_AXES, sessionOutline } from '../engine/plan-table'
import { buttonByText, click, fakeDisplay, type FakeDisplay } from '../render/common/testing'
import { settle } from '../render/dom-testing'
import { DEMO_TEXT_ITEMS } from '../render/text/demo'
import { WELCOME_INTRO, welcomeIntro } from './copy'
import { fakeEnv, type FakeEnv } from './dom-support'
import SessionApp from './SessionApp.svelte'
import { resultsLoader } from './results-loader'

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
const tick = async (n = 8): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0))
  flushSync()
}
const box = (label: RegExp): HTMLInputElement => {
  const l = [...document.querySelectorAll('label')].find((x) => label.test(x.textContent ?? ''))
  const el = l?.control
  if (!(el instanceof HTMLInputElement)) throw new Error(`no input for ${String(label)}`)
  return el
}

const DONE = { done: true, reason: 'no_items' }
/** A made-up text question as the server's `item_view` sends one: a stem and options, no media, no key. */
const textWire = (seq: number, demo = 0): unknown => ({ seq, item: { item_id: `i:tst:text:${seq}`, item_type: 'mc_text', time_limit_s: 180, ...DEMO_TEXT_ITEMS[demo]!.payload } })

function setup(textAxes: readonly AxisCode[]): { t: ScriptedTransport; fake: FakeEnv<FakeDisplay> } {
  const t = new ScriptedTransport()
  t.replies.next_item = DONE
  t.replies.rescore = { ...(CANNED.rescore as object) }
  const fake = fakeEnv(fakeDisplay(), { backend: fakeBackend(t, textAxes) })
  return { t, fake }
}

async function toReady(fake: FakeEnv<FakeDisplay>): Promise<void> {
  open(fake)
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

/** Begin, skip the reaction-time part, start Matrix & Series (which the scripted server ends at once). */
async function pastMatrix(): Promise<void> {
  click(buttonByText(host, 'Begin'))
  await tick()
  expect(h1()).toBe('Up next: Reaction Time')
  click(buttonByText(host, 'Skip this part'))
  click(buttonByText(host, 'Skip Reaction Time'))
  expect(h1()).toBe('Up next: Matrix & Series')
  click(buttonByText(host, 'Start'))
  await tick()
}

const axesAsked = (t: ScriptedTransport): string[] => t.calls.filter((c) => c.fn === 'next_item').map((c) => (JSON.parse(c.body) as { p_axes: string[] }).p_axes.join('+'))

describe('the words about the session before it starts', () => {
  it('a server that is not asked for text parts: six parts, about 30 minutes, word for word as before', async () => {
    const { fake } = setup([])
    open(fake)
    expect(host.textContent).toContain(WELCOME_INTRO)
    expect(WELCOME_INTRO).toContain('The session has six parts and takes about 30 minutes.')
    await (async () => {
      document.body.innerHTML = ''
      if (app) unmount(app)
      app = undefined
    })()
    await toReady(fake)
    expect(host.textContent).toContain(SERVER_READY_TEXT)
    expect(SERVER_READY_TEXT.startsWith('Six short parts, about 30 minutes. ')).toBe(true)
  })

  it('a server asked for every text part: up to twelve parts, about 55 minutes, on the welcome and the ready screen', async () => {
    const { fake } = setup(TEXT_AXES)
    open(fake)
    const outline = sessionOutline(TEXT_AXES)
    expect(host.textContent).toContain('The session has up to twelve parts and takes about 55 minutes.')
    expect(host.textContent).toContain(welcomeIntro(outline))
    expect(host.textContent).not.toContain('six parts')
    if (app) unmount(app)
    app = undefined
    document.body.innerHTML = ''
    await toReady(fake)
    expect(host.textContent).toContain(serverReadyText(outline))
    expect(host.textContent).toContain('Up to twelve short parts, about 55 minutes.')
  })

  it('a server asked for the five text skills of phase 1: up to eleven parts, about 45 minutes (what such a session typically takes)', async () => {
    const five: readonly AxisCode[] = ['LR', 'VOC', 'KST', 'KHU', 'KAP']
    const { fake } = setup(five)
    open(fake)
    expect(host.textContent).toContain('The session has up to eleven parts and takes about 45 minutes.')
    expect(host.textContent).toContain(welcomeIntro(sessionOutline(five)))
  })
})

describe('a server with no text questions (the live site today)', () => {
  it('not asked for them: after Matrix & Series comes Spatial, and the server hears of no text skill', async () => {
    const { t, fake } = setup([])
    await toReady(fake)
    await pastMatrix()
    expect(h1()).toBe('Up next: Spatial')
    expect(axesAsked(t)).toEqual(['MAT'])
    expect(host.querySelector('.checklist')?.textContent).toContain('Not in this version')
    expect(host.querySelector('.checklist')?.textContent).not.toContain('Logical Reasoning')
  })

  it('asked for them: the same screens follow, no text part is ever announced, and the checklist ends up as the six-part one', async () => {
    const { t, fake } = setup(TEXT_AXES)
    await toReady(fake)
    await pastMatrix()
    // Logical Reasoning and STEM Knowledge were asked for, one call each, and neither exists: straight to Spatial.
    expect(h1()).toBe('Up next: Spatial')
    expect(axesAsked(t)).toEqual(['MAT', 'LR', 'KST'])
    expect(host.textContent).not.toContain('Logical Reasoning skipped')
    expect(host.querySelector('header .status')?.textContent ?? '').toBe('')
    const checklist = host.querySelector('.checklist')?.textContent ?? ''
    expect(checklist).not.toContain('Logical Reasoning')
    expect(checklist).not.toContain('STEM Knowledge')
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext')).toMatch(/of about 45 min$/u) // the twelve parts' typical 54 minutes less the two parts that were not there
  })
})

describe('a text part the server has questions for', () => {
  it('is announced, shows the question as text with its options, then the slider of a four-option question, and can be reported', async () => {
    const { t, fake } = setup(['LR'])
    await toReady(fake)
    t.script('next_item', DONE, textWire(1), textWire(2, 2)) // Matrix & Series has nothing; the first LR question is asked for once, before "Up next"
    await pastMatrix()
    expect(h1()).toBe('Up next: Logical Reasoning')
    expect(host.textContent).toContain('About 6 minutes.')
    expect(host.textContent).toContain('Read a short argument and pick the answer that best fits the question about it.')
    click(buttonByText(host, 'Start'))
    await tick()
    await settle() // the first frame that shows the question unlocks its options
    flushSync()
    expect(h1()).toBe('Logical Reasoning')
    const demo = DEMO_TEXT_ITEMS[0]!.payload
    expect(host.querySelector('.text-mc legend')?.textContent).toBe(demo.stem)
    expect([...host.querySelectorAll('.text-mc .words')].map((e) => e.textContent)).toEqual(demo.options)
    expect(buttonByText(host, 'Report a problem')).toBeTruthy()
    expect(host.textContent).not.toMatch(/correct|incorrect/iu)

    const radios = [...host.querySelectorAll<HTMLInputElement>('.text-mc input[type="radio"]')]
    click(radios[1])
    flushSync()
    click(buttonByText(host, 'Confirm'))
    flushSync()
    expect(host.textContent).toContain('How sure are you that your answer is right?')
    expect(host.textContent).toContain('With 4 options, guessing would be right about 25% of the time.')
    const slider = host.querySelector<HTMLInputElement>('.confidence input[type="range"]')!
    expect(slider.min).toBe('25')
    slider.value = '70'
    slider.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    click(buttonByText(host, 'Continue'))
    await tick()
    const sent = t.args('submit')
    expect(sent).toMatchObject({ p_item_id: 'i:tst:text:1', p_response: 1, p_confidence: 70, p_next: false })
    expect(JSON.stringify(sent)).not.toMatch(/correct|"key"/u)
    // The next question of the part: a text to read first and six options, markup shown as characters.
    await settle()
    flushSync()
    expect(host.querySelectorAll('.text-mc input[type="radio"]')).toHaveLength(6)
    expect(host.querySelectorAll('.text-mc script, .text-mc img, .text-mc b, .text-mc i')).toHaveLength(0)
    expect(host.querySelector('.text-mc .reading')?.textContent).toContain('<script>')
  })
})
