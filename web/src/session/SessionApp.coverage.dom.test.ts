/**
 * How the session flow hands earlier sessions to the run (M1.15 review; DESIGN §7.4 L584): the coverage
 * floor follows the axes that earlier saves cover, and a start that was abandoned leaves no session
 * behind. `SessionRun` is wrapped to record the config it is given; everything else is the real flow.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTOSAVE_PREFIX, autosaveKeys, restoreAutosaves } from '../save/autosave'
import { saveWithSession } from '../save/create'
import { newAnonId } from '../save/ids'
import { jcs } from '../save/jcs'
import { buttonByText, click, fakeDisplay } from '../render/common/testing'
import { encodeSaveCode } from '../save/codec'
import { Bot } from './bot'
import { CONSENT_KEY, SAVE_CTX } from './constants'
import { fakeEnv, SpyStorage, type FakeEnv } from './dom-support'
import type { RunConfig, SessionRun } from './run'
import SessionApp from './SessionApp.svelte'

const configs = vi.hoisted(() => [] as unknown[])
const runs = vi.hoisted(() => [] as unknown[])
const practices = vi.hoisted(() => [] as { familyIds(): string[] }[])

vi.mock('./run', async (importOriginal) => {
  const m = await importOriginal<typeof import('./run')>()
  return {
    ...m,
    SessionRun: class extends m.SessionRun {
      constructor(cfg: RunConfig) {
        configs.push(cfg)
        super(cfg)
        runs.push(this)
      }
    },
  }
})

vi.mock('./practice', async (importOriginal) => {
  const m = await importOriginal<typeof import('./practice')>()
  return {
    ...m,
    PracticeRun: class extends m.PracticeRun {
      constructor(seed: string) {
        super(seed)
        practices.push(this)
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
  configs.length = 0
  runs.length = 0
  practices.length = 0
})

const h1 = (): string => document.querySelector('main h1')?.textContent?.trim() ?? ''
const box = (label: RegExp): HTMLInputElement => {
  const l = [...document.querySelectorAll('label')].find((x) => label.test(x.textContent ?? ''))
  const el = l?.control
  if (!(el instanceof HTMLInputElement)) throw new Error(`no checkbox for ${String(label)}`)
  return el
}

/** Mount the app on `fake`, go through the gate (first visit) and the device check, and stop on the ready screen. */
async function toReady(fake: FakeEnv<ReturnType<typeof fakeDisplay>>, firstVisit: boolean): Promise<void> {
  host = document.createElement('div')
  document.body.appendChild(host)
  app = mount(SessionApp, { target: host, props: { env: fake.env } })
  flushSync()
  click(buttonByText(host, 'Start'))
  if (firstVisit) {
    click(box(/18 or older/))
    click(buttonByText(host, 'Continue'))
  }
  click(box(/honour code/))
  click(buttonByText(host, 'Continue'))
  fake.display.advance(1200)
  await new Promise((resolve) => setTimeout(resolve, 0))
  flushSync()
  click(buttonByText(host, 'Continue'))
  expect(h1()).toBe('Ready when you are')
}

const lastConfig = (): RunConfig => configs.at(-1) as RunConfig
const lastRun = (): SessionRun => runs.at(-1) as SessionRun

describe('what the flow tells the run about earlier sessions (coverage floor per axis)', () => {
  it('a first visit starts with no earlier items', async () => {
    const fake = fakeEnv(fakeDisplay())
    await toReady(fake, true)
    click(buttonByText(host, 'Begin'))
    expect(lastConfig().priorItemCounts).toEqual({})
    expect(lastConfig()).not.toHaveProperty('sessionNumber')
  })

  it('a start abandoned before any answer leaves no session behind: the next start is again a first look at every axis', async () => {
    const storage = new SpyStorage()
    const first = fakeEnv(fakeDisplay(), { storage })
    await toReady(first, true)
    click(buttonByText(host, 'Begin'))
    expect(h1()).toBe('Up next: Reaction time')
    // Nothing waits for a timer: no session without an answer is written, then or on leaving the page.
    await new Promise((resolve) => setTimeout(resolve, 400))
    window.dispatchEvent(new Event('pagehide'))
    expect(autosaveKeys(storage)).toEqual([])
    expect(restoreAutosaves(SAVE_CTX, storage).save).toBeNull()
    unmount(app!)
    app = undefined
    document.body.innerHTML = ''

    // The person comes back (the same browser storage): the consent is there, no earlier session is.
    const second = fakeEnv(fakeDisplay(), { storage })
    await toReady(second, false)
    expect(host.textContent).not.toContain('Earlier saves on this device')
    click(buttonByText(host, 'Begin'))
    expect(configs).toHaveLength(2)
    expect(lastConfig().priorItemCounts).toEqual({})
  })

  it('earlier saves on the device give the run the items they hold per axis', async () => {
    const bot = new Bot({ sessionId: 's_COVERAGEAPP001', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    bot.finish()
    const earlier = saveWithSession(null, bot.run.sessionState(), { ctx: SAVE_CTX, createdMs: 1_790_000_000_000, anonId: newAnonId() })
    const storage = new SpyStorage()
    storage.data.set(`${AUTOSAVE_PREFIX}${earlier.sessions[0]!.session_id}`, jcs(earlier))
    const mat = bot.run.result().itemsByAxis.MAT ?? 0
    expect(mat).toBeGreaterThanOrEqual(3)
    const fake = fakeEnv(fakeDisplay(), { storage })
    await toReady(fake, true)
    expect(host.textContent).toContain('Earlier saves on this device')
    click(buttonByText(host, 'Begin'))
    expect(lastConfig().priorItemCounts).toEqual({ MAT: mat })
    expect(lastConfig().seenFamilies).toEqual(earlier.seen_families)
  })

  it('a save loaded on the ready screen survives a trip to practice and becomes the base of the new session', async () => {
    const earlier = new Bot({ sessionId: 's_EARLIERSESSION1', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    earlier.until((v) => v.phase === 'confidence')
    earlier.run.confirmConfidence(earlier.view().confidence!.startPct)
    earlier.run.finishEarly()
    const file = saveWithSession(null, earlier.run.sessionState(), { ctx: SAVE_CTX, createdMs: 1_790_000_100_000, anonId: 'hb_' + 'q'.repeat(17) })
    const code = await encodeSaveCode(file)

    const fake = fakeEnv(fakeDisplay())
    await toReady(fake, true)
    const area = host.querySelector<HTMLTextAreaElement>('textarea')!
    area.value = code
    area.dispatchEvent(new Event('input', { bubbles: true }))
    click(buttonByText(host, 'Load'))
    await vi.waitFor(() => expect(host.querySelector('[role="status"]')?.textContent).toContain('Loaded 1 earlier session'))
    click(buttonByText(host, 'Try practice questions first'))
    click(buttonByText(host, 'Back'))
    click(buttonByText(host, 'Back'))
    expect(h1()).toBe('Ready when you are')
    click(buttonByText(host, 'Begin'))
    expect(lastConfig().priorItemCounts).toEqual({ MAT: 1 })
    // The session has no answer yet, so nothing is written; its first answer writes base ∪ session (R-8.1).
    expect(fake.storage.writes).toEqual([`set:${CONSENT_KEY}`])
    const run = lastRun()
    run.skipAxis() // reaction time, from its interstitial
    run.startSegment()
    const item = run.view().item!
    run.itemResponded(item.options_count === undefined ? '1' : 0)
    run.confirmConfidence(run.view().confidence!.startPct)
    await vi.waitFor(() => expect([...fake.storage.data.keys()].some((k) => k.startsWith('hb:save:v1:s_'))).toBe(true))
    const key = [...fake.storage.data.keys()].find((k) => k.startsWith('hb:save:v1:s_'))!
    const saved = JSON.parse(fake.storage.data.get(key)!) as { anon_id: string; sessions: { session_id: string }[] }
    expect(saved.anon_id).toBe(file.anon_id)
    expect(saved.sessions.map((x) => x.session_id)).toContain('s_EARLIERSESSION1')
    expect(saved.sessions).toHaveLength(2)
  })

  it('every practice round keeps its families out of the counted session, not only the last one', async () => {
    const fake = fakeEnv(fakeDisplay())
    await toReady(fake, true)
    for (let round = 0; round < 2; round++) {
      click(buttonByText(host, 'Try practice questions first'))
      click(buttonByText(host, 'Back'))
      click(buttonByText(host, 'Back'))
      expect(h1()).toBe('Ready when you are')
    }
    expect(practices).toHaveLength(2)
    const [a, b] = practices.map((p) => p.familyIds()) as [string[], string[]]
    expect(a.some((f) => !b.includes(f))).toBe(true) // the rounds drew different items
    click(buttonByText(host, 'Begin'))
    const seen = lastConfig().seenFamilies ?? []
    for (const f of [...a, ...b]) expect(seen, f).toContain(f)
    expect(new Set(seen).size).toBe(seen.length)
  })
})
