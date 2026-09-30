/**
 * The RT block inside the session screen (ROADMAP M1.15, A18; DESIGN §11.6, §13): the renderer's
 * input type reaches the block's record (`RtDevice.input_type`, "normed separately"), the device
 * input mode chosen in the device check fixes the renderer's control scheme, and the block's
 * response is scored by the family into the Gaussian observation.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { buttonByText, click, fakeDisplay, pointerDown, press, type FakeDisplay } from '../render/common/testing'
import { fakeEnv } from './dom-support'
import SessionScreen from './SessionScreen.svelte'
import { Bot } from './bot'

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement

afterEach(() => {
  if (app) unmount(app)
  app = undefined
  document.body.innerHTML = ''
})

const FRAME = 1000 / 60

function until(display: FakeDisplay, pred: () => boolean, maxMs = 20_000): void {
  let t = 0
  while (!pred()) {
    if (t > maxMs) throw new Error('condition not reached')
    display.advance(FRAME)
    t += FRAME
  }
}

const stimulusOn = (): boolean => host.querySelector('.pad.on') !== null

/** Play the whole block: every trial answered 300 ms after its onset by `respond(position)`. */
function playBlock(display: FakeDisplay, bot: Bot, respond: (position: number) => void): void {
  const item = bot.fullItem(bot.view().block!.item_id)
  const spec = item.spec as { mode: 'simple' | 'choice4'; positions: number[]; practice_positions: number[] }
  buttonByText(host, 'Start practice').click()
  flushSync()
  for (const practice of [true, false]) {
    const pos = practice ? spec.practice_positions : spec.positions
    for (let i = 0; i < pos.length; i++) {
      until(display, stimulusOn)
      display.advance(300)
      respond(pos[i] ?? 0)
    }
    if (practice) {
      until(display, () => host.textContent?.includes('Practice done') === true)
      click(buttonByText(host, 'Start'))
    }
  }
}

describe('RT inside the session (A18)', () => {
  it('touch mode: no mode choice on screen, taps are scored, and the input type reaches the record', () => {
    const fake = fakeEnv(fakeDisplay())
    const bot = new Bot({ sessionId: 's_RTWIRING000001', rtInput: 'touch', skipped: ['MAT', 'SPA', 'WM', 'QR', 'PS'] })
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(SessionScreen, { target: host, props: { env: fake.env, run: bot.run, autosave: 'ok' } })
    flushSync()
    click(buttonByText(host, 'Start'))
    expect(bot.view().phase).toBe('block')
    expect(host.querySelector('fieldset.modes')).toBeNull() // fixed by the device check
    expect(host.textContent).toContain('tap or click the box')
    playBlock(fake.display, bot, () => pointerDown(host.querySelector('button.pad'), 'touch'))
    // The simple block is scored; the 4-choice block follows.
    until(fake.display, () => bot.run.sessionState().responses.length >= 1)
    const t = bot.run.sessionState().responses[0]!
    expect(t[0]).toMatch(/^i:rt_simple:/)
    expect(t[3]).toBeNull()
    expect(t[6]).toMatchObject({ input_type: 'touch', device_class: 'desktop' })
    expect(bot.run.sessionState().device.input).toBe('touch')
    expect(bot.run.result().observations).toHaveLength(1)
    expect(bot.run.result().observations[0]).toMatchObject({ kind: 'gaussian', axis: 'RT' })
  })

  it('a mouse click in tap-or-click mode is a mouse response, not touch (§11.6)', () => {
    const fake = fakeEnv(fakeDisplay())
    const bot = new Bot({ sessionId: 's_RTWIRING000002', rtInput: 'touch', skipped: ['MAT', 'SPA', 'WM', 'QR', 'PS'] })
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(SessionScreen, { target: host, props: { env: fake.env, run: bot.run, autosave: 'ok' } })
    flushSync()
    click(buttonByText(host, 'Start'))
    playBlock(fake.display, bot, () => pointerDown(host.querySelector('button.pad'), 'mouse'))
    until(fake.display, () => bot.run.sessionState().responses.length >= 1)
    expect(bot.run.sessionState().responses[0]![6]).toMatchObject({ input_type: 'mouse' })
    expect(bot.run.sessionState().device.input).toBe('mouse')
  })

  it('keyboard mode: Space is scored as keyboard', () => {
    const fake = fakeEnv(fakeDisplay())
    const bot = new Bot({ sessionId: 's_RTWIRING000003', rtInput: 'keyboard', skipped: ['MAT', 'SPA', 'WM', 'QR', 'PS'] })
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(SessionScreen, { target: host, props: { env: fake.env, run: bot.run, autosave: 'ok' } })
    flushSync()
    click(buttonByText(host, 'Start'))
    expect(host.textContent).toContain('press the Space bar')
    playBlock(fake.display, bot, () => press(' ', document.body))
    until(fake.display, () => bot.run.sessionState().responses.length >= 1)
    expect(bot.run.sessionState().responses[0]![6]).toMatchObject({ input_type: 'keyboard' })
  })
})
