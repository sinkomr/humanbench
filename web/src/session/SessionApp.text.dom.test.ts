/**
 * The served text parts in the session flow (ROADMAP M3.11 phase 1; DESIGN §7.4, §10, §11.2, §13, R-5.6.x,
 * R-11.1): the words about the session's length before it starts, a text part the server has questions
 * for (the "Up next" screen, the question as text, the optional confidence scale, "Report a problem"), and a
 * server without them, where the flow is the six-part one. The server is a scripted fake transport;
 * `scripts/db/text-mc.db.test.ts` and `e2e-db/` use the real database.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SERVER_READY_TEXT, serverReadyText } from '../backend/copy'
import { CANNED, ScriptedTransport, fakeBackend } from '../backend/testing'
import type { AxisCode } from '../engine/axes'
import { TEXT_AXES, longestOutline, servedPartAxes, sessionOutline } from '../engine/plan-table'
import { buttonByText, click, fakeDisplay, type FakeDisplay } from '../render/common/testing'
import { settle } from '../render/dom-testing'
import { DEMO_TEXT_ITEMS } from '../render/text/demo'
import { WELCOME_INTRO, WELCOME_INTRO_PENDING, welcomeIntro } from './copy'
import { fakeEnv, type FakeEnv } from './dom-support'
import SessionApp from './SessionApp.svelte'
import { resultsLoader } from './results-loader'
import { runtimeLoader } from './runtime-loader'

beforeAll(async () => {
  await resultsLoader.load()
  // The session runtime is its own chunk too (UX-100, `runtime.ts`); loaded here once, as the welcome screen would.
  await runtimeLoader.load()
}, 90_000)

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement

function open(fake: FakeEnv<FakeDisplay>): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = mount(SessionApp, { target: host, props: { env: fake.env } })
  flushSync()
}

/** Mounts the app and lets the server's list of skills arrive (`live_axes`, asked when the page loads). */
async function openAndHear(fake: FakeEnv<FakeDisplay>): Promise<void> {
  open(fake)
  await tick()
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
  it('a server that has no text questions: six parts, about 30 minutes, word for word as before, once it has said so', async () => {
    const { fake } = setup([])
    open(fake)
    // before the server's list arrives: no count and no length (the static shell says the same, vite.config.ts)
    expect(host.textContent).toContain(WELCOME_INTRO_PENDING)
    await tick()
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

  it('a server with every served skill: the parts take turns (ROTATION), and the welcome states the longest of the turns, "up to ten parts, about 45 minutes", and the ready screen this session\'s, "up to eight"', async () => {
    const { fake } = setup(TEXT_AXES)
    await openAndHear(fake)
    // the longest turn by typical time (re-measured without the follow-up confidence step, owner decision 2026-10-13) is
    // the one with Fermi, Emotion Reading, word links and Arts & Practical: ten parts
    const longest = longestOutline([...TEXT_AXES])
    expect([0, 1, 2].map((i) => sessionOutline(servedPartAxes([...TEXT_AXES], i))).some((o) => o.typical_s > longest.typical_s)).toBe(false)
    expect(longest.parts).toBe(10)
    expect(host.textContent).toContain('The session has up to ten parts and takes about 45 minutes.')
    expect(host.textContent).toContain(welcomeIntro(longest))
    // the ready screen states this session's own turn: the first, Logical Reasoning and Reading Comprehension
    const first = sessionOutline(servedPartAxes([...TEXT_AXES], 0))
    expect(host.textContent).not.toContain('six parts')
    if (app) unmount(app)
    app = undefined
    document.body.innerHTML = ''
    await toReady(fake)
    expect(host.textContent).toContain(serverReadyText(first))
    expect(host.textContent).toContain('Up to eight short parts, about 45 minutes.')
  })

  it('a server with the five text skills of phase 1: the longest turn of the rotation is said, up to nine parts, about 35 minutes', async () => {
    const five: readonly AxisCode[] = ['LR', 'VOC', 'KST', 'KHU', 'KAP']
    const { fake } = setup(five)
    await openAndHear(fake)
    expect(host.textContent).toContain('The session has up to nine parts and takes about 35 minutes.')
    expect(host.textContent).toContain(welcomeIntro(longestOutline(five)))
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

  it('listed but with nothing left for this person: the same screens follow, no text part is ever announced, and the checklist ends up as the six-part one', async () => {
    const { t, fake } = setup(TEXT_AXES)
    await toReady(fake)
    await pastMatrix()
    // the first turn of the rotation: Logical Reasoning was asked for, one call, and had nothing: straight to Spatial.
    expect(h1()).toBe('Up next: Spatial')
    expect(axesAsked(t)).toEqual(['MAT', 'LR'])
    expect(host.textContent).not.toContain('Logical Reasoning skipped')
    expect(host.querySelector('header .status')?.textContent ?? '').toBe('')
    const checklist = host.querySelector('.checklist')?.textContent ?? ''
    expect(checklist).not.toContain('Logical Reasoning')
    expect(checklist).not.toContain('STEM Knowledge')
    // the first turn's typical 45 minutes less the part that was not there (Reading Comprehension is still to come)
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext')).toMatch(/of about 40 min$/u)
  })
})

describe('a text part the server has questions for', () => {
  it('is announced, shows the question as text with its options and the optional scale of a four-option question, and can be reported', async () => {
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

    const radios = [...host.querySelectorAll<HTMLInputElement>('.text-mc .options input[type="radio"]')]
    click(radios[1])
    flushSync()
    // The optional scale of a four-option question, inside its form, before Confirm: from 25%, a guess, to 100%.
    expect(host.textContent).toContain('How sure are you?')
    expect(host.textContent).toContain('With 4 options a guess is right about 25% of the time.')
    const points = [...host.querySelectorAll<HTMLInputElement>('.text-mc fieldset[data-confidence] input[type="radio"]')]
    expect(points.map((p) => p.value)).toEqual(['25', '44', '63', '81', '100'])
    click(points[3])
    click(buttonByText(host, 'Confirm'))
    await tick()
    const sent = t.args('submit')
    expect(sent).toMatchObject({ p_item_id: 'i:tst:text:1', p_response: 1, p_confidence: 81, p_next: false })
    expect(JSON.stringify(sent)).not.toMatch(/correct|"key"/u)
    // The next question of the part: a text to read first and six options, markup shown as characters.
    await settle()
    flushSync()
    expect(host.querySelectorAll('.text-mc .options input[type="radio"]')).toHaveLength(6)
    expect(host.querySelectorAll('.text-mc script, .text-mc img, .text-mc b, .text-mc i')).toHaveLength(0)
    expect(host.querySelector('.text-mc .reading')?.textContent).toContain('<script>')
  })
})
