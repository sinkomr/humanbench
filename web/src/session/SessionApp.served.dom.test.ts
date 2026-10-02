/**
 * The session flow with a server (ROADMAP M2.7; DESIGN §8, §11.2, §13; AI.26): the gate and the ready
 * screen say what is sent, opening the session can fail and the person can go on with this device only,
 * the served part waits for the server and sends each answer, a question can be reported, closing hands
 * over the signed session and the scores, the results carry the server's check, the backup, the survey
 * and the report about notes, and a failure at any step has a way on. The server is a scripted fake
 * transport; the real one is `scripts/db/backend.db.test.ts`.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { BackendError } from '../backend/errors'
import { SERVER_GATE_POINTS, SERVER_READY_TEXT } from '../backend/copy'
import { ANON, CANNED, ScriptedTransport, SESSION_ID, fakeBackend } from '../backend/testing'
import { ANTI_COERCION, MIRROR_NOTE } from '../brief/save-copy'
import { buttonByText, click, fakeDisplay, type FakeDisplay } from '../render/common/testing'
import { settle } from '../render/dom-testing'
import { getFamily } from '../tasks/registry'
import { CONSENT_KEY, TERMS_VERSION_SERVER } from './constants'
import { fakeEnv, type FakeEnv } from './dom-support'
import SessionApp from './SessionApp.svelte'

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
const tick = async (n = 6): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0))
  flushSync()
}
const box = (label: RegExp): HTMLInputElement => {
  const l = [...document.querySelectorAll('label')].find((x) => label.test(x.textContent ?? ''))
  const el = l?.control
  if (!(el instanceof HTMLInputElement)) throw new Error(`no input for ${String(label)}`)
  return el
}

/** A served series item, as the bank stores it: the spec as `media`, the family name as `media.renderer`. */
function seriesWire(seq: number, seed: string): unknown {
  const item = getFamily('series')!.generate(seed)
  return { seq, item: { item_id: item.item_id, item_type: item.item_type, time_limit_s: 120, media: { renderer: 'series', ...(item.spec as object) } } }
}

const RESCORED = {
  ...(CANNED.rescore as object),
  sessions: [{ session_id: SESSION_ID, known: true }],
  eap: { MAT: { mean: 0.4, sd: 0.55, n: 6 } },
  facets: { MAT: { series: { mean: 0.5, sd: 0.6, n: 5 } } },
}

function setup(): { t: ScriptedTransport; fake: FakeEnv<FakeDisplay> } {
  const t = new ScriptedTransport()
  t.replies.rescore = RESCORED
  const fake = fakeEnv(fakeDisplay(), { backend: fakeBackend(t) })
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

/** Skip the reaction-time part and start the Matrix & Series part. */
async function toServedPart(fake: FakeEnv<FakeDisplay>): Promise<void> {
  click(buttonByText(host, 'Begin'))
  await tick()
  expect(h1()).toBe('Up next: Reaction time')
  click(buttonByText(host, 'Skip this part'))
  click(buttonByText(host, 'Skip Reaction Time'))
  expect(h1()).toBe('Up next: Matrix & Series')
  click(buttonByText(host, 'Start'))
  void fake
}

describe('what the screens say when answers go to a server', () => {
  it('the gate and the ready screen describe the upload, and the consent is for the online terms', async () => {
    const { fake } = setup()
    open(fake)
    click(buttonByText(host, 'Start'))
    expect([...host.querySelectorAll('ul.points li')].map((li) => li.textContent)).toEqual([...SERVER_GATE_POINTS])
    expect(host.textContent).toContain('sent to a server')
    expect(host.textContent).not.toContain('Nothing is uploaded')
    click(box(/18 or older/))
    click(buttonByText(host, 'Continue'))
    expect(JSON.parse(fake.storage.data.get(CONSENT_KEY)!)).toEqual({ v: 1, terms: TERMS_VERSION_SERVER, adult: true })
    click(box(/honour code/))
    click(buttonByText(host, 'Continue'))
    fake.display.advance(1200)
    await tick(2)
    click(buttonByText(host, 'Continue'))
    expect(host.textContent).toContain(SERVER_READY_TEXT)
    expect(host.textContent).toContain('Get a backup from the server')
  })

  it('does not honour a consent given to the static notice', () => {
    const { fake } = setup()
    fake.storage.data.set(CONSENT_KEY, JSON.stringify({ v: 1, terms: 'terms-2026-09-draft', adult: true }))
    open(fake)
    click(buttonByText(host, 'Start'))
    expect(h1()).toBe('Before you start')
  })
})

describe('opening the session', () => {
  it('asks the server for a session with the device only, then starts the first part', async () => {
    const { t, fake } = setup()
    await toReady(fake)
    click(buttonByText(host, 'Begin'))
    expect(h1()).toBe('Getting your session ready')
    await tick()
    expect(h1()).toBe('Up next: Reaction time')
    expect(t.callsOf('start_session')).toBe(1)
    expect(Object.keys(t.args('start_session'))).toEqual(['p_device'])
    expect(t.args('start_session').p_device).toMatchObject({ class: 'desktop', os_family: 'macOS' })
  })

  it('says why it could not, and offers to try again, to go back, or to use this device only', async () => {
    const { t, fake } = setup()
    t.script('start_session', new BackendError('network', 'network_error'), new BackendError('limited', 'rate_limited', { status: 429 }))
    await toReady(fake)
    click(buttonByText(host, 'Begin'))
    await tick()
    expect(h1()).toBe('Getting your session ready')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not reach the server')
    click(buttonByText(host, 'Try again'))
    await tick()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('reached a limit')
    click(buttonByText(host, 'Back'))
    expect(h1()).toBe('Ready when you are')
    expect(t.callsOf('start_session')).toBe(2)
  })

  it('going on with this device only is the static session: no more calls to the server, no served part', async () => {
    const { t, fake } = setup()
    t.script('start_session', new BackendError('network', 'network_error'))
    await toReady(fake)
    click(buttonByText(host, 'Begin'))
    await tick()
    expect(host.textContent).toContain('nothing is sent to the server')
    click(buttonByText(host, 'Use this device only'))
    expect(h1()).toBe('Up next: Reaction time')
    click(buttonByText(host, 'Skip this part'))
    click(buttonByText(host, 'Skip Reaction Time'))
    click(buttonByText(host, 'Start'))
    await settle(3)
    expect(host.querySelector('section.series, .matrix')).not.toBeNull() // an item generated here
    expect(t.callsOf('next_item')).toBe(0)
    click(buttonByText(host, 'Finish early'))
    click(buttonByText(host, 'Finish now'))
    expect(h1()).toBe('Session complete')
    expect(t.callsOf('finish')).toBe(0)
    expect(host.querySelector('[data-section="online"]')).toBeNull()
  })
})

describe('the served part', () => {
  it('waits for the server, shows the item, sends the answer with the confidence, and moves on', async () => {
    const { t, fake } = setup()
    t.script('next_item', seriesWire(1, 'a'), seriesWire(2, 'b'), { done: true, reason: 'axes_done' })
    await toReady(fake)
    await toServedPart(fake)
    expect(host.querySelector('[data-loading]')?.textContent).toContain('Getting your next question')
    await tick()
    await settle(3)
    expect(host.querySelector('form.entry')).not.toBeNull()
    expect(t.args('next_item')).toEqual({ p_token: 'hbt_ABCDEFGHIJKLMNOPQRSTUV', p_axes: ['MAT'] })
    const entry = host.querySelector<HTMLInputElement>('form.entry input[type="text"], form.entry input:not([type])')!
    entry.value = '17'
    entry.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    host.querySelector<HTMLFormElement>('form.entry')!.requestSubmit()
    flushSync()
    expect(host.querySelector('[role="slider"], input[type="range"]')).not.toBeNull()
    expect(host.textContent).not.toMatch(/correct|incorrect|wrong/i) // no verdict, ever
    click(buttonByText(host, 'Continue'))
    await tick()
    await settle(2)
    const sent = t.args('submit')
    expect(sent).toMatchObject({ p_token: 'hbt_ABCDEFGHIJKLMNOPQRSTUV', p_response: '17', p_next: false })
    expect(typeof sent.p_rt_ms).toBe('number')
    expect(typeof sent.p_confidence).toBe('number')
    // the next item is up
    expect(t.callsOf('next_item')).toBe(2)
    expect(host.querySelector('form.entry')).not.toBeNull()
  })

  it('shows a connection problem with the clock stopped, and a way to try again', async () => {
    const { t, fake } = setup()
    t.script('next_item', new BackendError('network', 'network_error'), new BackendError('network', 'network_error'), new BackendError('network', 'network_error'), seriesWire(1, 'a'))
    await toReady(fake)
    await toServedPart(fake)
    await tick()
    const problem = host.querySelector('[data-loading-problem]')
    expect(problem?.getAttribute('data-loading-problem')).toBe('offline')
    expect(problem?.textContent).toContain('the clock is stopped')
    click(buttonByText(host, 'Try again'))
    await tick()
    await settle(3)
    expect(host.querySelector('form.entry')).not.toBeNull()
  })

  it('offers "Report a problem" on the question, with six kinds, and sends the kind and the question', async () => {
    const { t, fake } = setup()
    t.script('next_item', seriesWire(1, 'a'))
    await toReady(fake)
    await toServedPart(fake)
    await tick()
    await settle(3)
    click(buttonByText(host, 'Report a problem'))
    const labels = [...host.querySelectorAll('.report fieldset label')].map((l) => l.textContent?.trim())
    expect(labels).toHaveLength(6)
    expect(labels.at(-1)).toBe('Someone asked me for my notes')
    const typo = box(/typo/)
    click(typo)
    const text = host.querySelector<HTMLTextAreaElement>('.report textarea')!
    text.value = 'The second term is missing'
    text.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    host.querySelector<HTMLFormElement>('.report form')!.requestSubmit()
    await tick()
    const sent = t.args('report_problem')
    expect(sent).toMatchObject({ p_kind: 'typo', p_detail: 'The second term is missing' })
    expect(String(sent.p_item_id)).toMatch(/^i:series:/u)
    expect(host.querySelector('.report .status')?.textContent).toContain('Thank you')
  })

  it('a question of a kind this page cannot draw says so without blaming the browser, and can be skipped', async () => {
    const { t, fake } = setup()
    t.script('next_item', { seq: 1, item: { item_id: 'i:fin:1.0.0:x', item_type: 'mc', time_limit_s: 60, stem: 'Which is larger?', options: ['a', 'b', 'c'] } })
    await toReady(fake)
    await toServedPart(fake)
    await tick()
    const note = host.querySelector('.unavailable')!
    expect(note.textContent).toContain('This kind of question cannot be shown in this version of the page yet')
    expect(note.textContent).not.toContain('3D graphics')
    expect(host.textContent).not.toContain('Which is larger?') // the page does not improvise a rendering
  })

  it('a skip releases the question on screen, so the server can serve another part', async () => {
    const { t, fake } = setup()
    t.script('next_item', seriesWire(1, 'a'))
    await toReady(fake)
    await toServedPart(fake)
    await tick()
    await settle(3)
    click(buttonByText(host, 'Skip Matrix & Series'))
    click(buttonByText(host.querySelector<HTMLElement>('section.confirm')!, 'Skip Matrix & Series')) // it asks first
    await tick()
    expect(t.args('submit')).toMatchObject({ p_response: null })
    expect(t.args('submit').p_client_flags).toEqual({ skipped: true })
    expect(h1()).toBe('Up next: Spatial')
  })
})

describe('closing and the results', () => {
  async function toResults(t: ScriptedTransport, fake: FakeEnv<FakeDisplay>): Promise<void> {
    t.script('next_item', seriesWire(1, 'a'), { done: true, reason: 'axes_done' })
    await toReady(fake)
    await toServedPart(fake)
    await tick()
    await settle(3)
    const entry = host.querySelector<HTMLInputElement>('form.entry input')!
    entry.value = '3'
    entry.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    host.querySelector<HTMLFormElement>('form.entry')!.requestSubmit()
    flushSync()
    click(buttonByText(host, 'Continue'))
    await tick()
    expect(h1()).toBe('Up next: Spatial')
    click(buttonByText(host, 'Finish early'))
    click(buttonByText(host, 'Finish now'))
  }

  it('sends the last answers, closes the session with the flags, fetches the scores, and shows what an online session adds', async () => {
    const { t, fake } = setup()
    await toResults(t, fake)
    await tick(12)
    await settle(3)
    expect(h1()).toBe('Session complete')
    expect(t.args('finish')).toEqual({ p_token: 'hbt_ABCDEFGHIJKLMNOPQRSTUV', p_flags: { visibility_hidden_s: 0, paste_events: 0, skipped_rt: true, finished_early: true } })
    // the server was asked for the scores of the signed session only, without notes settings
    const asked = t.args('rescore').p_save as { sessions: { session_id: string; sig?: unknown }[]; anon_id: string }
    expect(asked.sessions.map((s) => s.session_id)).toEqual([SESSION_ID])
    expect(asked.sessions[0]!.sig).toBeDefined()
    expect(JSON.stringify(t.calls)).not.toContain('brief_prefs')
    // the profile has the server's axis, and the panels of an online session are there
    expect(host.querySelector('[data-section="save"]')).not.toBeNull()
    expect(host.querySelector('[data-anti-coercion]')?.textContent).toBe(ANTI_COERCION)
    const panels = host.querySelector('[data-section="online"]')!
    expect(panels).not.toBeNull()
    expect(panels.querySelector('[data-section="save-check"]')?.textContent).toContain('1 session was checked by the server')
    expect(panels.querySelector('[data-mirror-note]')?.textContent).toBe(MIRROR_NOTE)
    expect(panels.querySelector('[data-section="survey"]')).not.toBeNull()
    expect(panels.querySelector('[data-section="report"]')).not.toBeNull()
    expect(host.textContent).not.toMatch(/TODO\(user\)/u) // the results page carries no placeholder
  })

  it('the backup: a recovery phrase is shown once, the notes settings are not in the file sent, and it goes away when confirmed', async () => {
    const { t, fake } = setup()
    await toResults(t, fake)
    await tick(12)
    await settle(3)
    click(buttonByText(host, 'Keep a backup on the server'))
    await tick()
    const phrase = host.querySelector('[data-recovery-phrase]')?.textContent
    expect(phrase?.split(' ')).toHaveLength(12)
    const sent = t.args('mirror_put')
    expect(sent.p_token).toBe('hbt_ABCDEFGHIJKLMNOPQRSTUV')
    expect(JSON.stringify(sent)).not.toContain('brief_prefs')
    expect((sent.p_save as { anon_id: string }).anon_id).toBe(ANON)
    const done = buttonByText(host, 'Done')
    expect(done.disabled).toBe(true)
    click(box(/kept the phrase/))
    expect(done.disabled).toBe(false)
    click(done)
    expect(host.querySelector('[data-recovery-phrase]')).toBeNull()
    expect(document.body.textContent).not.toContain(phrase!)
  })

  it('the survey sends only what was chosen, and "No thanks" sends nothing', async () => {
    const { t, fake } = setup()
    await toResults(t, fake)
    await tick(12)
    await settle(3)
    const survey = host.querySelector('[data-section="survey"]')!
    click(survey.querySelector<HTMLInputElement>('input[value="25-34"]')!)
    click(survey.querySelector<HTMLInputElement>('input[value="yes"]')!)
    survey.querySelector<HTMLFormElement>('form')!.requestSubmit()
    await tick()
    expect(t.args('submit_survey')).toEqual({ p_token: 'hbt_ABCDEFGHIJKLMNOPQRSTUV', p_age_band: '25-34', p_english_first: true })
    expect(survey.textContent).toContain('Thank you')
    expect(t.callsOf('submit_survey')).toBe(1)
  })

  it('"Someone asked me for my notes" is the one report outside a question, and carries no question and no text', async () => {
    const { t, fake } = setup()
    await toResults(t, fake)
    await tick(12)
    await settle(3)
    const section = host.querySelector('[data-section="report"]')!
    click(buttonByText(section as HTMLElement, 'Report a problem'))
    const labels = [...section.querySelectorAll('fieldset label')].map((l) => l.textContent?.trim())
    expect(labels).toEqual(['Someone asked me for my notes'])
    section.querySelector<HTMLFormElement>('form')!.requestSubmit()
    await tick()
    expect(t.args('report_problem')).toEqual({ p_token: 'hbt_ABCDEFGHIJKLMNOPQRSTUV', p_kind: 'notes_requested' })
  })

  it('when the server cannot be reached to close, the person can try again, or go on without it', async () => {
    const { t, fake } = setup()
    t.script('finish', new BackendError('network', 'network_error'), new BackendError('network', 'network_error'), new BackendError('network', 'network_error'))
    await toResults(t, fake)
    await tick(12)
    expect(h1()).toBe('Saving your answers')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not reach the server')
    click(buttonByText(host, 'Try again'))
    await tick(12)
    await settle(3)
    expect(h1()).toBe('Session complete')
    expect(t.callsOf('finish')).toBe(4)
  })

  it('going on without the server shows the session as not measured where the server scores, and keeps the answers in the file', async () => {
    const { t, fake } = setup()
    t.replies.finish = new BackendError('network', 'network_error')
    t.failures.set('finish', Array.from({ length: 12 }, () => new BackendError('network', 'network_error')))
    await toResults(t, fake)
    await tick(12)
    click(buttonByText(host, 'Continue without the server'))
    await settle(3)
    expect(h1()).toBe('Session complete')
    expect(t.callsOf('rescore')).toBe(0)
    expect(host.querySelector('[data-section="online"]')).not.toBeNull()
    expect(host.querySelector('[data-section="survey"]')).toBeNull() // nothing can be sent to a session that was not closed
    expect(host.querySelector('[data-section="report"]')).not.toBeNull()
    expect(buttonByText(host, 'Download save file')).toBeTruthy()
  })
})
