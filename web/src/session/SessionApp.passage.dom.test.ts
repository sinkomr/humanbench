/**
 * Served passages in the session flow (ROADMAP M3.11 phase 2; DESIGN §3 row 4, §10, §13, R-5.6.x, R-11.1;
 * owner decision 2026-10-12: the passage stays visible while its questions are answered): the "Up next"
 * screen, the passage beside its question, the page that is not rebuilt between two questions of a passage,
 * where focus goes, and the next passage as a new one. The server is a scripted fake transport with made-up
 * passages (`render/text/demo-passage.ts`); `scripts/db/passage.db.test.ts` and `e2e-db/` use the real database.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { CANNED, ScriptedTransport, fakeBackend } from '../backend/testing'
import { buttonByText, click, fakeDisplay, type FakeDisplay } from '../render/common/testing'
import { settle } from '../render/dom-testing'
import { DEMO_PASSAGES, demoPassagePayload } from '../render/text/demo-passage'
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
/** Question `q` (0-based) of made-up passage `p`, as the server sends it: the passage in `media`, the place in the set, no key. */
const passageWire = (seq: number, p: number, q: number): unknown => {
  const demo = DEMO_PASSAGES[p]!
  return { seq, item: { item_id: `i:tst:rc:p${p + 1}-q${q + 1}`, item_type: 'mc_passage', time_limit_s: q === 0 ? 300 : 180, ...demoPassagePayload(demo, q) }, set: { position: q + 1, of: demo.questions.length } }
}

function setup(): { t: ScriptedTransport; fake: FakeEnv<FakeDisplay> } {
  const t = new ScriptedTransport()
  t.replies.next_item = DONE
  t.replies.rescore = { ...(CANNED.rescore as object) }
  const fake = fakeEnv(fakeDisplay(), { backend: fakeBackend(t, ['RC']) })
  return { t, fake }
}

async function toReady(fake: FakeEnv<FakeDisplay>): Promise<void> {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = mount(SessionApp, { target: host, props: { env: fake.env } })
  flushSync()
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

/** Begin, skip Reaction Time, start Matrix & Series (the scripted server ends it at once), skip Spatial: Reading Comprehension is next. */
async function toReading(): Promise<void> {
  click(buttonByText(host, 'Begin'))
  await tick()
  click(buttonByText(host, 'Skip this part'))
  click(buttonByText(host, 'Skip Reaction Time'))
  expect(h1()).toBe('Up next: Matrix & Series')
  click(buttonByText(host, 'Start'))
  await tick()
  if (h1() === 'Time for a break?') click(buttonByText(host, 'Keep going'))
  expect(h1()).toBe('Up next: Spatial')
  click(buttonByText(host, 'Skip this part'))
  click(buttonByText(host, 'Skip Spatial'))
  await tick()
  if (h1() === 'Time for a break?') click(buttonByText(host, 'Keep going'))
  await tick()
}

/** Answers the question on screen with option `index`, sets the confidence scale's middle point and confirms: one press. */
async function answer(index: number): Promise<void> {
  await settle() // the first frame that shows the question unlocks its options
  flushSync()
  const radios = [...host.querySelectorAll<HTMLInputElement>('.text-mc .options input[type="radio"]')]
  click(radios[index])
  flushSync()
  click(host.querySelectorAll<HTMLInputElement>('fieldset[data-confidence] input[type="radio"]')[2])
  click(buttonByText(host, 'Confirm'))
  await tick()
  await settle()
  flushSync()
}

const passageNode = (): HTMLElement | null => host.querySelector<HTMLElement>('section.passage')
const position = (): string => host.querySelector('[data-set-position]')?.textContent ?? ''

describe('a Reading Comprehension part of made-up passages', () => {
  it('says what the part is, with the words about its length from the plan; the session says "up to seven parts, about 40 minutes"', async () => {
    const { t, fake } = setup()
    await toReady(fake)
    expect(host.textContent).toContain('Up to seven short parts, about 40 minutes.')
    t.script('next_item', DONE, passageWire(1, 0, 0))
    await toReading()
    expect(h1()).toBe('Up next: Reading Comprehension')
    expect(host.textContent).toContain('About 9 minutes.')
    expect(host.textContent).toContain('The passage stays on screen while you answer, so you can look back at it.')
    expect(host.querySelector('section.passage')).toBeNull() // nothing of the passage before Start
  })

  it('keeps the passage in place across its questions: the same element, not rebuilt, with focus on each later question; a new passage is a new page with focus on the passage', async () => {
    const { t, fake } = setup()
    await toReady(fake)
    t.script('next_item', DONE, passageWire(1, 0, 0), passageWire(2, 0, 1), passageWire(3, 0, 2), passageWire(4, 0, 3), passageWire(5, 1, 0), passageWire(6, 1, 1))
    await toReading()
    click(buttonByText(host, 'Start'))
    await tick()
    await settle()
    flushSync()
    expect(h1()).toBe('Reading Comprehension')

    // the first question: the passage as a named region before the question, the source line, and which question it is
    const first = passageNode()!
    const demo = DEMO_PASSAGES[0]!
    expect(first.querySelector('h2')?.textContent).toBe('Passage')
    expect([...first.querySelectorAll('.text p')].map((p) => p.textContent)).toEqual(demo.media.passage)
    expect(first.querySelector('.attribution')?.textContent).toContain(demo.media.attribution)
    expect(host.querySelector('.text-mc legend')?.textContent).toBe(demo.questions[0]!.stem)
    expect(position()).toBe('Question 1 of 4 about this passage')
    const region = host.querySelector<HTMLElement>('.item-region')!
    expect(first.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(document.querySelector('main')!.contains(first)).toBe(true)
    // the first question of the part: the heading takes focus, as for any part
    expect(document.activeElement).toBe(document.querySelector('main h1'))
    const main = document.querySelector('main')!
    ;(first as unknown as { mark: string }).mark = 'kept'
    expect(host.textContent).not.toMatch(/correct|incorrect/iu)

    // the optional confidence scale is in the question, beside the same passage; one press sends both
    await settle()
    flushSync()
    click([...host.querySelectorAll<HTMLInputElement>('.text-mc .options input[type="radio"]')][2])
    flushSync()
    expect(host.textContent).toContain('How sure are you?')
    const points = host.querySelectorAll<HTMLInputElement>('fieldset[data-confidence] input[type="radio"]')
    expect([...points].map((p) => p.value)).toEqual(['20', '40', '60', '80', '100']) // five options: a guess is 20%
    click(points[2])
    expect(passageNode()).toBe(first)
    click(buttonByText(host, 'Confirm'))
    await tick()
    await settle()
    flushSync()

    // the second question: the page was not rebuilt, the passage is the element it was, and focus is on the question
    expect(t.args('submit')).toMatchObject({ p_item_id: 'i:tst:rc:p1-q1', p_response: 2, p_confidence: 60 })
    expect(document.querySelector('main')).toBe(main)
    expect(passageNode()).toBe(first)
    expect((passageNode() as unknown as { mark?: string }).mark).toBe('kept')
    expect(host.querySelector('.text-mc legend')?.textContent).toBe(demo.questions[1]!.stem)
    expect(position()).toBe('Question 2 of 4 about this passage')
    const second = host.querySelector<HTMLElement>('.item-region')!
    expect(second.getAttribute('aria-label')).toBe('Question 2')
    expect(document.activeElement).toBe(second)

    await answer(0)
    expect(passageNode()).toBe(first)
    expect(position()).toBe('Question 3 of 4 about this passage')
    await answer(1)
    expect(passageNode()).toBe(first)
    expect(position()).toBe('Question 4 of 4 about this passage')

    // the next passage: a new page, the new text, and focus on the passage so that a screen reader starts there
    await answer(3)
    const next = passageNode()!
    expect(next).not.toBe(first)
    expect((next as unknown as { mark?: string }).mark).toBeUndefined()
    expect(next.querySelector('.title')?.textContent).toBe(DEMO_PASSAGES[1]!.media.title)
    expect(position()).toBe('Question 1 of 3 about this passage')
    expect(document.activeElement).toBe(next)
    expect(host.querySelector<HTMLElement>('.item-region')!.getAttribute('aria-label')).toBe('Question 5')
    // the server's text is text: the markup in the made-up passage made no element and ran nothing
    expect(next.textContent).toContain('<script>')
    expect(host.querySelectorAll('section.passage script, section.passage img, section.passage b, section.passage a')).toHaveLength(0)

    // four answers went out as positions, and nothing sent or shown says right or wrong
    expect(t.callsOf('submit')).toBe(4)
    expect(JSON.stringify(t.calls.filter((c) => c.fn === 'submit').map((c) => c.body))).not.toMatch(/correct|\\"key\\"/u)
    expect(host.textContent).not.toMatch(/\bincorrect\b|\bcorrect\b/iu)
  })

  it('ends the part after two passages, and the checklist shows it done', async () => {
    const { t, fake } = setup()
    await toReady(fake)
    t.script('next_item', DONE, passageWire(1, 2, 0), passageWire(2, 2, 1), passageWire(3, 2, 2), passageWire(4, 1, 0), passageWire(5, 1, 1), passageWire(6, 1, 2), passageWire(7, 0, 0))
    await toReading()
    click(buttonByText(host, 'Start'))
    await tick()
    for (let i = 0; i < 6; i++) await answer(i % 3)
    if (h1() === 'Time for a break?') click(buttonByText(host, 'Keep going'))
    await tick()
    expect(h1()).toBe('Up next: Working Memory')
    expect(passageNode()).toBeNull()
    // the seventh scripted reply (a third passage) was never asked for
    const asked = t.calls.filter((c) => c.fn === 'next_item').map((c) => (JSON.parse(c.body) as { p_axes: string[] }).p_axes.join('+'))
    expect(asked.filter((a) => a === 'RC')).toHaveLength(6)
    expect(t.callsOf('submit')).toBe(6)
  })
})
