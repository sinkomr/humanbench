import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { buttonByText, click, fakeDisplay } from '../render/common/testing'
import { settle } from '../render/dom-testing'
import { fakeEnv } from './dom-support'
import SessionScreen from './SessionScreen.svelte'
import { Bot } from './bot'
import type { AutosaveStatus } from './persist'

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement

function open(bot: Bot, autosave: AutosaveStatus = 'ok'): void {
  const fake = fakeEnv(fakeDisplay())
  host = document.createElement('div')
  document.body.appendChild(host)
  app = mount(SessionScreen, { target: host, props: { env: fake.env, run: bot.run, autosave } })
  flushSync()
}

afterEach(() => {
  if (app) unmount(app)
  app = undefined
  document.body.innerHTML = ''
})

const h1 = (): string => document.querySelector('main h1')?.textContent?.trim() ?? ''
const status = (): string => host.querySelector('[role="status"]')?.textContent?.trim() ?? ''

describe('the running session screen (M1.15)', () => {
  it('shows the interstitial with the minutes and what to expect, and starts the block', async () => {
    const bot = new Bot({ sessionId: 's_UISESSION00001' })
    open(bot)
    expect(h1()).toBe('Up next: Reaction time')
    expect(host.textContent).toMatch(/About \d+ min\./)
    expect(host.textContent).toContain('Respond as fast as you can')
    expect(document.activeElement?.tagName).toBe('H1')
    click(buttonByText(host, 'Start'))
    flushSync()
    expect(bot.view().phase).toBe('block')
    expect(h1()).toBe('Reaction time')
    expect(host.querySelector('section.rt')).not.toBeNull()
    expect(host.textContent).toContain('Start practice')
  })

  it('every screen has one main landmark, one h1 and the header, and the ring is a named progressbar', () => {
    const bot = new Bot({ sessionId: 's_UISESSION00002' })
    open(bot)
    expect(host.querySelectorAll('main')).toHaveLength(1)
    expect(host.querySelectorAll('h1')).toHaveLength(1)
    expect(host.querySelector('header')).not.toBeNull()
    const bar = host.querySelector('[role="progressbar"]')!
    expect(bar.getAttribute('aria-label')).toBe('Session time')
    expect(bar.getAttribute('aria-valuemax')).toBe('28')
    expect(bar.getAttribute('aria-valuenow')).toBe('0')
  })

  it('a counted item shows its confidence slider after the answer: range from the chance level to 100, no feedback', async () => {
    const bot = new Bot({ sessionId: 's_UISESSION00003', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    open(bot)
    click(buttonByText(host, 'Start'))
    await settle(3)
    const item = bot.view().item!
    expect(host.querySelector('input[type="range"]')).toBeNull()
    const full = bot.fullItem(item.item_id)
    bot.run.itemResponded(full.options_count === undefined ? '1' : 0)
    flushSync()
    const range = host.querySelector<HTMLInputElement>('input[type="range"]')!
    expect(range).not.toBeNull()
    expect(range.min).toBe(String(full.options_count === undefined ? 0 : Math.ceil(100 / full.options_count)))
    expect(range.max).toBe('100')
    expect(host.querySelector('legend')?.textContent).toBe('How sure are you that your answer is right?')
    expect(document.activeElement).toBe(range)
    expect(range.getAttribute('aria-valuetext')).toMatch(/^\d+% sure$/)
    expect(host.textContent).not.toMatch(/that was correct|not correct/i)
    // Moving the slider and continuing records that confidence.
    range.value = '77'
    range.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(host.querySelector('output')?.textContent).toBe('77%')
    click(buttonByText(host, 'Continue'))
    expect(bot.run.sessionState().responses[0]![5]).toBe(77)
    expect(host.querySelector('input[type="range"]')).toBeNull()
  })

  it('offers the skip for the axis on screen, and asks before skipping; keeping going returns focus', async () => {
    const bot = new Bot({ sessionId: 's_UISESSION00004', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    open(bot)
    click(buttonByText(host, 'Start'))
    await settle(2)
    const skip = buttonByText(host, 'Skip Matrix & Series')
    click(skip)
    expect(host.querySelector('section.confirm h2')?.textContent).toBe('Skip Matrix & Series?')
    expect(document.activeElement?.tagName).toBe('H2')
    click(buttonByText(host, 'Keep going'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    expect(host.querySelector('section.confirm')).toBeNull()
    expect(document.activeElement).toBe(skip)
    expect(bot.view().phase).toBe('item')
    click(skip)
    click(buttonByText(host.querySelector<HTMLElement>('section.confirm')!, 'Skip Matrix & Series'))
    expect(bot.view().skipped).toEqual(['RT', 'WM', 'PS', 'SPA', 'QR', 'MAT'])
    expect(bot.view().phase).toBe('finished')
  })

  it('an item the renderer cannot draw offers the skip right there, in plain words', async () => {
    const bot = new Bot({ sessionId: 's_UISESSION00005', skipped: ['RT', 'MAT', 'WM', 'PS', 'QR'] })
    open(bot)
    click(buttonByText(host, 'Start'))
    await settle(2)
    expect(bot.view().item?.axis).toBe('SPA')
    bot.run.itemUnavailable()
    flushSync()
    const panel = host.querySelector('.unavailable')!
    expect(panel.textContent).toContain('cannot be shown in your browser')
    expect(status()).toContain('Spatial')
    click(buttonByText(panel as HTMLElement, 'Skip Spatial'))
    expect(bot.view().skipped).toContain('SPA')
  })

  it('suggests a break after 30 minutes; taking it pauses, resuming goes on', () => {
    const bot = new Bot({ sessionId: 's_UISESSION00006', breakAtS: 5 })
    open(bot)
    bot.wait(10)
    bot.run.skipAxis() // a boundary
    flushSync()
    expect(h1()).toBe('Time for a break?')
    expect(host.textContent).toContain('The clock pauses while you rest')
    click(buttonByText(host, 'Take a break'))
    expect(h1()).toBe('Break')
    expect(host.textContent).toContain('paused')
    expect([...host.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(['Resume'])
    bot.wait(600)
    click(buttonByText(host, 'Resume'))
    expect(bot.view().phase).toBe('interstitial')
    expect(bot.view().elapsedS).toBeCloseTo(10, 3)
    expect(h1()).toBe('Up next: Matrix & Series')
  })

  it('declining the break carries on where it was', () => {
    const bot = new Bot({ sessionId: 's_UISESSION00007', breakAtS: 5 })
    open(bot)
    bot.wait(10)
    bot.run.skipAxis()
    flushSync()
    click(buttonByText(host, 'Keep going'))
    expect(h1()).toBe('Up next: Matrix & Series')
    expect(bot.view().phase).toBe('interstitial')
  })

  it('announces a time-out and a skip in the status line', async () => {
    const bot = new Bot({ sessionId: 's_UISESSION00008', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    open(bot)
    click(buttonByText(host, 'Start'))
    await settle(2)
    const cap = bot.view().item!.time_limit_s
    bot.wait(cap + 60) // the renderer reported its own onset (real frame time), a little after 0
    bot.run.tick()
    flushSync()
    expect(status()).toBe('That question ran out of time. It counts as not answered correctly.')
  })

  it('the checklist follows the run: the current cluster, a skipped one, the done ones', () => {
    const bot = new Bot({ sessionId: 's_UISESSION00009' })
    open(bot)
    const rows = (): string[] => [...host.querySelectorAll('nav li')].map((li) => li.getAttribute('data-status') ?? '')
    expect(rows()).toEqual(['current', 'upcoming', 'upcoming', 'upcoming'])
    // Skip reaction time from its interstitial: Speed still has processing and reading speed ahead.
    bot.run.skipAxis()
    flushSync()
    expect(rows()).toEqual(['upcoming', 'current', 'upcoming', 'upcoming'])
    // Skip Matrix & Series, Spatial, Working Memory and Quantitative too: Speed's last part is all that is left.
    for (const axis of ['MAT', 'SPA', 'WM', 'QR'] as const) bot.run.skipAxis(axis)
    flushSync()
    expect(rows()).toEqual(['current', 'skipped', 'skipped', 'skipped'])
    expect(host.querySelector('nav li[data-status="current"] .status')?.textContent).toBe('Now')
    expect(host.querySelector('nav li[data-status="skipped"] .status')?.textContent).toBe('Skipped')
  })

  it('warns when the browser would not let the session be saved as it goes', () => {
    const bot = new Bot({ sessionId: 's_UISESSION00010' })
    open(bot, 'unavailable')
    expect(host.textContent).toContain('did not allow saving as you went')
  })
})
