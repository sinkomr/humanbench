/**
 * Continuing an unfinished session (UX-064; provisional default, UX-REVIEW D6 option B): the ready screen's offer
 * and what continuing does in the real flow. A refresh or crash mid-session is modelled by an autosave of an
 * interrupted run in storage when the page mounts. `SessionRun` is wrapped to reach the run; the rest is the real
 * flow on a fake display and a recording storage.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ScriptedTransport, fakeBackend } from '../backend/testing'
import { buttonByText, click, fakeDisplay, type FakeDisplay } from '../render/common/testing'
import { settle } from '../render/dom-testing'
import { autosaveKey, autosaveKeys } from '../save/autosave'
import { parseUtcSeconds } from '../save/clock'
import { saveWithSession } from '../save/create'
import { CONTINUATION_FLAG, type SaveFileV1 } from '../save/types'
import { Bot } from './bot'
import { CONSENT_KEY, SAVE_CTX, TERMS_VERSION, TERMS_VERSION_SERVER } from './constants'
import { READY_CONTINUE } from './copy'
import { fakeEnv, type FakeEnv } from './dom-support'
import { RESUME_WINDOW_MS } from './resume'
import type { RunConfig, SessionRun } from './run'
import SessionApp from './SessionApp.svelte'
import { resultsLoader } from './results-loader'

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

afterEach(() => {
  if (app) unmount(app)
  app = undefined
  document.body.innerHTML = ''
  runs.length = 0
})

/** The wall clock of the fake environment (`dom-support.ts`). */
const NOW_MS = 1_790_000_000_000
const ANON = 'hb_' + 'r'.repeat(17)
const INTERRUPTED = 's_RESUMEFLOW00001'

const h1 = (): string => document.querySelector('main h1')?.textContent?.trim() ?? ''
const lastRun = (): SessionRun => runs.at(-1) as SessionRun
const box = (label: RegExp): HTMLInputElement => {
  const l = [...document.querySelectorAll('label')].find((x) => label.test(x.textContent ?? ''))
  const el = l?.control
  if (!(el instanceof HTMLInputElement)) throw new Error(`no input for ${String(label)}`)
  return el
}
const offered = (): boolean => [...host.querySelectorAll('button')].some((b) => b.textContent?.trim() === READY_CONTINUE)

/** A session interrupted on the Matrix & Series "Up next" screen (reaction time done), started `agoMs` before now. */
function interruptedSave(agoMs = 3_600_000, sessionId = INTERRUPTED, anonId = ANON): SaveFileV1 {
  const bot = new Bot({ sessionId, startedMs: NOW_MS - agoMs })
  bot.until((v) => v.phase === 'interstitial' && v.segment?.id === 'matrix_series')
  return saveWithSession(null, bot.run.sessionState(), { ctx: SAVE_CTX, createdMs: NOW_MS - agoMs + 600_000, anonId })
}

function seed(fake: FakeEnv<FakeDisplay>, saves: readonly SaveFileV1[], terms: string | null = TERMS_VERSION): void {
  if (terms !== null) fake.storage.data.set(CONSENT_KEY, JSON.stringify({ v: 1, terms, adult: true }))
  for (const s of saves) fake.storage.data.set(autosaveKey(s.sessions[0]!.session_id), JSON.stringify(s))
}

/** From the welcome screen to the ready screen: the gate is shown only when no consent for these terms is kept. */
async function toReady(fake: FakeEnv<FakeDisplay>): Promise<void> {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = mount(SessionApp, { target: host, props: { env: fake.env } })
  flushSync()
  click(buttonByText(host, 'Start'))
  if (h1() === 'Before you start') {
    click(box(/18 or older/))
    click(buttonByText(host, 'Continue'))
  }
  expect(h1()).toBe('Honour code')
  click(box(/honour code/))
  click(buttonByText(host, 'Continue'))
  fake.display.advance(1200)
  await new Promise((resolve) => setTimeout(resolve, 0))
  flushSync()
  click(buttonByText(host, 'Continue'))
  expect(h1()).toBe('Ready when you are')
}

const savedOf = (fake: FakeEnv<FakeDisplay>, sessionId: string): SaveFileV1 => JSON.parse(fake.storage.data.get(autosaveKey(sessionId))!) as SaveFileV1

describe('continuing an unfinished session (UX-064)', () => {
  it('is offered on the ready screen, and starts a new session flagged as a continuation at the part that was interrupted', async () => {
    const fake = fakeEnv(fakeDisplay())
    seed(fake, [interruptedSave()])
    await toReady(fake)
    expect(offered()).toBe(true)
    expect(host.textContent).toContain('was not finished. Continue it to go on from the start of Matrix & Series')
    click(buttonByText(host, READY_CONTINUE))
    flushSync()
    const run = lastRun()
    expect(h1()).toBe('Up next: Matrix & Series')
    expect(run.view().segments.map((s) => s.status)).toEqual(['done', 'current', 'upcoming', 'upcoming', 'upcoming', 'upcoming'])
    expect(run.sessionState().flags[CONTINUATION_FLAG]).toBe(true)
    // It starts after the session it continues: now, an hour later (a return within the same second is the next test).
    const interruptedStart = NOW_MS - 3_600_000
    expect(run.sessionState().startedMs).toBe(NOW_MS)
    expect(run.sessionState().startedMs).toBeGreaterThan(interruptedStart)

    // One answer, then finish: the save holds both sessions, the second flagged, and the profile counts one session.
    run.startSegment()
    flushSync()
    await settle(2)
    const item = run.view().item!
    expect(run.view().unavailable).toBe(false)
    run.itemResponded(item.options_count === undefined ? '1' : 0)
    run.confirmConfidence(run.view().confidence!.startPct)
    run.finishEarly()
    flushSync()
    await vi.waitFor(() => expect(h1()).toBe('Session complete'))
    const save = savedOf(fake, run.sessionId)
    expect(save.sessions.map((s) => s.session_id)).toEqual([INTERRUPTED, run.sessionId])
    expect(save.sessions[1]!.flags[CONTINUATION_FLAG]).toBe(true)
    expect(save.sessions[0]!.flags[CONTINUATION_FLAG]).toBeUndefined()
    expect(parseUtcSeconds(save.sessions[1]!.started_utc)).toBeGreaterThan(parseUtcSeconds(save.sessions[0]!.started_utc))
    expect(host.textContent).not.toContain('combines')
    // The interrupted session's own autosave is held by the new one, so it is pruned.
    expect(autosaveKeys(fake.storage)).toEqual([autosaveKey(run.sessionId)])
  })

  it('a quick return in the same second still puts the continuation after the session it continues', async () => {
    const fake = fakeEnv(fakeDisplay())
    seed(fake, [interruptedSave(0)])
    await toReady(fake)
    click(buttonByText(host, READY_CONTINUE))
    expect(lastRun().sessionState().startedMs).toBe(NOW_MS + 1000)
  })

  it('Begin still starts a new session from the first part, not flagged', async () => {
    const fake = fakeEnv(fakeDisplay())
    seed(fake, [interruptedSave()])
    await toReady(fake)
    click(buttonByText(host, 'Begin'))
    flushSync()
    expect(h1()).toBe('Up next: Reaction Time')
    expect(lastRun().sessionState().flags[CONTINUATION_FLAG]).toBeUndefined()
  })

  it('is not offered for a session that started 24 hours ago or more', async () => {
    const fake = fakeEnv(fakeDisplay())
    seed(fake, [interruptedSave(RESUME_WINDOW_MS)])
    await toReady(fake)
    expect(offered()).toBe(false)
    expect(host.querySelectorAll('.hb-primary')).toHaveLength(1)
    expect(buttonByText(host, 'Begin').classList.contains('hb-primary')).toBe(true)
  })

  it('is not offered across a change of consent terms, nor when no consent was kept', async () => {
    const older = fakeEnv(fakeDisplay())
    seed(older, [interruptedSave()], 'terms-2026-09-draft')
    await toReady(older)
    expect(offered()).toBe(false)
    unmount(app!)
    app = undefined
    document.body.innerHTML = ''
    const none = fakeEnv(fakeDisplay())
    seed(none, [interruptedSave()], null)
    await toReady(none)
    expect(offered()).toBe(false)
  })

  it('is not offered when the saves found come from more than one identifier, or are not to be added to', async () => {
    const two = fakeEnv(fakeDisplay())
    seed(two, [interruptedSave(), interruptedSave(7_200_000, 's_RESUMEFLOW00002', 'hb_' + 's'.repeat(17))])
    await toReady(two)
    expect(offered()).toBe(false)
    unmount(app!)
    app = undefined
    document.body.innerHTML = ''
    const fake = fakeEnv(fakeDisplay())
    seed(fake, [interruptedSave()])
    await toReady(fake)
    expect(offered()).toBe(true)
    click(box(/Add my new session to the 1 earlier session/))
    flushSync()
    expect(offered()).toBe(false)
  })

  it('nothing changes for a person whose last session ended', async () => {
    const bot = new Bot({ sessionId: INTERRUPTED, startedMs: NOW_MS - 3_600_000 })
    bot.until((v) => v.phase === 'interstitial' && v.segment?.id === 'spatial')
    bot.run.finishEarly()
    const fake = fakeEnv(fakeDisplay())
    seed(fake, [saveWithSession(null, bot.run.sessionState(), { ctx: SAVE_CTX, createdMs: NOW_MS - 3_000_000, anonId: ANON })])
    await toReady(fake)
    expect(offered()).toBe(false)
    expect(host.textContent).not.toContain('was not finished')
  })

  it('is not offered with a server (the server would practice-adjust the two against each other)', async () => {
    const fake = fakeEnv(fakeDisplay(), { backend: fakeBackend(new ScriptedTransport()) })
    seed(fake, [interruptedSave()], TERMS_VERSION_SERVER)
    await toReady(fake)
    expect(offered()).toBe(false)
  })
})
