/**
 * The question timer on screen (owner feedback 2026-10-13; DESIGN §10, §13): always there while a question
 * waits for its answer, a warning that is not colour alone and is announced once, nothing animated.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buttonByText, click, fakeDisplay } from '../render/common/testing'
import { settle } from '../render/dom-testing'
import { Bot } from './bot'
import { ITEM_TIMER_ENTRY_HINT, ITEM_TIMER_LABEL, ITEM_TIMER_WARN } from './copy'
import { fakeEnv } from './dom-support'
import ItemTimer from './ItemTimer.svelte'
import timerSource from './ItemTimer.svelte?raw'
import SessionScreen from './SessionScreen.svelte'

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement

afterEach(() => {
  if (app) unmount(app)
  app = undefined
  document.body.innerHTML = ''
  vi.useRealTimers()
})

function show(props: { leftS: number; limitS: number; typed?: boolean }): void {
  if (app) void unmount(app)
  document.body.innerHTML = ''
  host = document.createElement('div')
  host.className = 'hb-render'
  document.body.appendChild(host)
  app = mount(ItemTimer, { target: host, props })
  flushSync()
}

const timer = (): HTMLElement => host.querySelector('[role="timer"]')!
const statusLine = (): HTMLElement => host.querySelector('[data-item-timer-status]')!

describe('ItemTimer', () => {
  it('shows the time left as m:ss with its label, and is a timer a screen reader can read on demand but is not read out as it counts', () => {
    show({ leftS: 125, limitS: 180 })
    expect(host.textContent).toContain(ITEM_TIMER_LABEL)
    expect(timer().textContent).toBe('2:05')
    expect(timer().getAttribute('aria-label')).toBe(`${ITEM_TIMER_LABEL}: 2 minutes 5 seconds`)
    expect(timer().getAttribute('aria-live')).toBeNull() // role=timer is live "off" by default: no chatter
    expect(host.querySelector('[data-item-timer]')!.getAttribute('data-warn')).toBe('false')
    expect(host.textContent).not.toContain(ITEM_TIMER_WARN)
    // the status line is there from the start, and empty
    expect(statusLine().getAttribute('role')).toBe('status')
    expect(statusLine().textContent).toBe('')
  })

  it('in the last 30 seconds it says so in words and with a mark, not with colour alone, and has the words of its one announcement', () => {
    show({ leftS: 30.2, limitS: 180 })
    expect(statusLine().textContent).toBe('')
    for (const left of [30, 29, 20.4, 10, 3, 0.2, 0]) {
      show({ leftS: left, limitS: 180 })
      expect(host.querySelector('[data-item-timer]')!.getAttribute('data-warn')).toBe('true')
      expect(host.querySelector('.flag')!.textContent).toContain(ITEM_TIMER_WARN)
      expect(host.querySelector('.mark')!.textContent).toBe('!')
      // the same words whatever is left: once it has changed from empty it does not change again
      expect(statusLine().textContent).toBe('30 seconds left for this question.')
    }
    expect(timer().textContent).toBe('0:00')
    // the mark and the words are for the eye; the announcement is the status line's
    expect(host.querySelector('.flag')!.getAttribute('aria-hidden')).toBe('true')
  })

  it('a typed-answer question also says that an answer counts only once it is entered, on screen and in the one announcement', () => {
    show({ leftS: 40, limitS: 180, typed: true })
    expect(host.textContent).not.toContain(ITEM_TIMER_ENTRY_HINT)
    show({ leftS: 25, limitS: 180, typed: true })
    expect(host.querySelector('[data-item-timer-hint]')!.textContent).toBe(ITEM_TIMER_ENTRY_HINT)
    expect(statusLine().textContent).toBe(`30 seconds left for this question. ${ITEM_TIMER_ENTRY_HINT}`)
    show({ leftS: 25, limitS: 180 })
    expect(host.querySelector('[data-item-timer-hint]')).toBeNull()
  })

  it('has no animation or transition at all, so there is nothing for reduced motion to switch off', () => {
    expect(timerSource).not.toMatch(/animation\s*:|transition\s*:|@keyframes/u)
  })
})

describe('the timer in the running session', () => {
  function open(bot: Bot): void {
    const fake = fakeEnv(fakeDisplay())
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(SessionScreen, { target: host, props: { env: fake.env, run: bot.run, autosave: 'ok' } })
    flushSync()
  }

  it('is on every question while it waits for its answer, counts down with the session’s ticks, and is gone on the slider and between parts', async () => {
    vi.useFakeTimers()
    const bot = new Bot({ sessionId: 's_UITIMER0000001', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    open(bot)
    expect(host.querySelector('[data-item-timer]')).toBeNull() // "Up next": nothing is timed
    click(buttonByText(host, 'Start'))
    flushSync()
    const limit = bot.view().item!.time_limit_s
    expect(timer().textContent).toBe(`${Math.floor(limit / 60)}:${String(limit % 60).padStart(2, '0')}`)
    // inside the question's own region, before the question
    const region = host.querySelector('.item-region')!
    expect(region.contains(timer())).toBe(true)
    expect(timer().compareDocumentPosition(region.querySelector('.stage-host')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // (the renderer reported its own onset, a frame or two after the question was handed over: the limit runs from there)
    bot.wait(bot.run.itemTime()!.leftS - 29.9)
    vi.advanceTimersByTime(250) // the screen's tick
    flushSync()
    expect(timer().textContent).toBe('0:30')
    expect(host.querySelector('[data-item-timer]')!.getAttribute('data-warn')).toBe('true')
    expect(host.querySelector('[data-item-timer-status]')!.textContent).toMatch(/^30 seconds left for this question\./u)
    // answered: the slider is not timed
    const full = bot.fullItem(bot.view().item!.item_id)
    bot.run.itemResponded(full.options_count === undefined ? '1' : 0)
    flushSync()
    expect(bot.view().phase).toBe('confidence')
    expect(host.querySelector('[data-item-timer]')).toBeNull()
    // the next question starts with a fresh timer: no warning carried over
    bot.run.confirmConfidence(bot.view().confidence!.startPct)
    flushSync()
    expect(host.querySelector('[data-item-timer]')!.getAttribute('data-warn')).toBe('false')
    expect(host.querySelector('[data-item-timer-status]')!.textContent).toBe('')
    vi.useRealTimers()
    await settle(1)
  })

  it('the time-out is never a surprise: the timer has shown the warning for 30 seconds and 0:00 before the question is taken away', () => {
    vi.useFakeTimers()
    const bot = new Bot({ sessionId: 's_UITIMER0000002', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    open(bot)
    click(buttonByText(host, 'Start'))
    flushSync()
    const id = bot.view().item!.item_id
    const limit = bot.view().item!.time_limit_s
    const shown: string[] = []
    const announced: string[] = []
    let statusEl: Element | null = null
    let warnedFor = 0
    for (let t = 0; t < limit + 2 && bot.view().item?.item_id === id; t += 0.25) {
      bot.wait(0.25)
      const before = host.querySelector('[data-item-timer]')
      if (before !== null) {
        shown.push(timer().textContent ?? '')
        if (before.getAttribute('data-warn') === 'true') warnedFor += 0.25
        const said = (host.querySelector('[data-item-timer-status]')!.textContent ?? '').replace(/ An answer counts.*$/u, '')
        if (announced.at(-1) !== said) announced.push(said)
        if (statusEl === null) statusEl = host.querySelector('[data-item-timer-status]')
        expect(host.querySelector('[data-item-timer-status]')).toBe(statusEl) // the same element throughout: a change, not new content
      }
      vi.advanceTimersByTime(250)
      flushSync()
    }
    expect(bot.view().item?.item_id).not.toBe(id)
    expect(bot.view().notice?.kind).toBe('timeout')
    // one announcement: the status line changed once, from empty to its words
    expect(announced).toEqual(['', '30 seconds left for this question.'])
    expect(warnedFor).toBeGreaterThanOrEqual(29)
    expect(shown).toContain('0:01')
    expect(shown.at(-1) === '0:00' || shown.at(-1) === '0:01').toBe(true)
  })
})
