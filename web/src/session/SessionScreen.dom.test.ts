import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { isOwnKey } from '../render/common/focus'
import { buttonByText, click, fakeDisplay, press } from '../render/common/testing'
import { settle } from '../render/dom-testing'
import { fakeEnv } from './dom-support'
import SessionScreen from './SessionScreen.svelte'
import { Bot } from './bot'
import type { AutosaveStatus } from './persist'

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement

let display: ReturnType<typeof fakeDisplay>

function open(bot: Bot, autosave: AutosaveStatus = 'ok'): void {
  display = fakeDisplay()
  const fake = fakeEnv(display)
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
    expect(host.textContent).toMatch(/About \d+ minutes?\./)
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
    expect(bar.getAttribute('aria-valuemax')).toBe('30')
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
    expect(panel.textContent).toContain('skip Spatial')
    // The panel says it once, under the heading and before the (parked) renderer; the header does not say it again (UX-017a).
    expect(status()).toBe('')
    expect(host.querySelector('h1')!.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(panel.compareDocumentPosition(host.querySelector('.rotation')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // ... and offers the way out of the whole session as well as the skip.
    expect(buttonByText(panel as HTMLElement, 'Finish early')).toBeTruthy()
    click(buttonByText(panel as HTMLElement, 'Skip Spatial'))
    expect(bot.view().skipped).toContain('SPA')
  })

  describe('a question the browser cannot draw says so once (UX-017a)', () => {
    /** The text a person sees or hears: everything outside a `hidden` subtree. */
    function shownText(root: Element): string {
      const parts: string[] = []
      const walk = (node: Node): void => {
        if (node instanceof Element && node.hasAttribute('hidden')) return
        if (node.nodeType === Node.TEXT_NODE) parts.push(node.textContent ?? '')
        for (const child of node.childNodes) walk(child)
      }
      walk(root)
      return parts.join(' ').replace(/\s+/g, ' ')
    }
    const count = (text: string, part: string): number => text.split(part).length - 1
    /** Live regions a screen reader would watch: not inside a hidden subtree, and with something in them. */
    const announcing = (): string[] =>
      [...host.querySelectorAll('[role="status"], [role="alert"], [aria-live="polite"], [aria-live="assertive"]')].filter((el) => el.closest('[hidden]') === null && (el.textContent ?? '').trim() !== '').map((el) => el.textContent!.trim())

    function openSpatial(): Bot {
      const bot = new Bot({ sessionId: 's_UISESSION00026', skipped: ['RT', 'MAT', 'WM', 'PS', 'QR'] })
      open(bot)
      click(buttonByText(host, 'Start'))
      return bot
    }

    it('the renderer stays mounted but parked out of sight and out of the accessibility tree; only the panel shows the message', async () => {
      const bot = openSpatial()
      await settle(2)
      const before = host.querySelector('.rotation')
      expect(before).not.toBeNull()
      const parkedBefore = host.querySelector('.stage-host')!
      // (jsdom has no WebGL, so the renderer may already have reported it; saying it again changes nothing.)
      bot.run.itemUnavailable()
      flushSync()
      const parked = host.querySelector('.stage-host')!
      expect(parked).toBe(parkedBefore)
      expect(parked.hasAttribute('hidden')).toBe(true)
      expect(host.querySelector('.rotation')).toBe(before) // never remounted: it reported the condition and stays alive
      expect(parked.contains(before)).toBe(true)
      const text = shownText(host)
      expect(count(text, 'cannot be shown in your browser')).toBe(1)
      expect(count(text, '3D figures could not be drawn')).toBe(0)
      expect(host.querySelector('.unavailable')!.closest('[hidden]')).toBeNull()
    })

    it('one announcement: the panel is the only live region with the message (the header line and the parked renderer say nothing)', async () => {
      const bot = openSpatial()
      await settle(2)
      bot.run.itemUnavailable()
      flushSync()
      const said = announcing()
      expect(said).toHaveLength(1)
      expect(said[0]).toContain('cannot be shown in your browser')
      expect(host.querySelector('.unavailable [role="status"]')?.textContent).toBe(said[0])
      expect(host.querySelector('.unavailable')!.getAttribute('role')).toBe('group')
    })

    it('Skip is the primary button of the panel, and Finish early is the other; no Confirm and no option is offered', async () => {
      const bot = openSpatial()
      await settle(2)
      bot.run.itemUnavailable()
      flushSync()
      const panel = host.querySelector<HTMLElement>('.unavailable')!
      expect(buttonByText(panel, 'Skip Spatial').classList.contains('hb-primary')).toBe(true)
      expect(buttonByText(panel, 'Finish early').classList.contains('hb-primary')).toBe(false)
      expect(host.querySelector('.stage-host')!.hasAttribute('hidden')).toBe(true)
      expect(shownText(host)).not.toContain('Confirm')
    })

    it('a question that can be drawn is not parked, and the wrapper changes nothing for its renderer', async () => {
      const bot = new Bot({ sessionId: 's_UISESSION00027', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
      open(bot)
      click(buttonByText(host, 'Start'))
      await settle(2)
      const parked = host.querySelector('.stage-host')!
      expect(parked.hasAttribute('hidden')).toBe(false)
      expect(host.querySelector('.unavailable')).toBeNull()
      expect(parked.children.length).toBeGreaterThan(0)
    })

    it('Skip after the panel went up leaves for the next part (the parked renderer is dropped with the screen)', async () => {
      const bot = openSpatial()
      await settle(2)
      bot.run.itemUnavailable()
      flushSync()
      click(buttonByText(host.querySelector<HTMLElement>('.unavailable')!, 'Skip Spatial'))
      flushSync()
      expect(bot.view().skipped).toContain('SPA')
      expect(host.querySelector('.stage-host')).toBeNull()
      expect(host.querySelector('.unavailable')).toBeNull()
    })
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
    const rows = (): string[] => [...host.querySelectorAll('.checklist li')].map((li) => li.getAttribute('data-status') ?? '')
    expect(rows()).toEqual(['current', 'upcoming', 'later', 'later', 'embedded'])
    // Skip reaction time from its interstitial: Speed still has processing and reading speed ahead.
    bot.run.skipAxis()
    flushSync()
    expect(rows()).toEqual(['later', 'current', 'upcoming', 'later', 'embedded'])
    // Skip Matrix & Series, Spatial, Working Memory and Quantitative too: Speed's last part is all that is left.
    for (const axis of ['MAT', 'SPA', 'WM', 'QR'] as const) bot.run.skipAxis(axis)
    flushSync()
    expect(rows()).toEqual(['current', 'skipped', 'skipped', 'skipped', 'embedded'])
    expect(host.querySelector('.checklist li[data-status="current"] .status')?.textContent).toBe('Now')
    expect(host.querySelector('.checklist li[data-status="skipped"] .status')?.textContent).toBe('Skipped')
  })

  it('Estimation is a row of its own that says it is measured with each answer, and is not listed as missing', () => {
    const bot = new Bot({ sessionId: 's_UISESSION00011' })
    open(bot)
    const row = host.querySelector('.checklist li[data-status="embedded"]')!
    expect(row.textContent).toContain('Estimation')
    expect(row.querySelector('.status')?.textContent).toBe('With each answer')
    const later = host.querySelector('.checklist .later')?.textContent ?? ''
    expect(later).toContain('Not in this version')
    expect(later).not.toContain('Estimation')
    expect(later).toContain('Verbal')
  })

  it('skipping a part from its interstitial asks first, like the skip during an item; keeping going changes nothing', async () => {
    const bot = new Bot({ sessionId: 's_UISESSION00012' })
    open(bot)
    const skip = buttonByText(host, 'Skip this part')
    click(skip)
    expect(host.querySelector('section.confirm h2')?.textContent).toBe('Skip Reaction Time?')
    expect(bot.view().skipped).toEqual([])
    expect(bot.view().phase).toBe('interstitial')
    click(buttonByText(host, 'Keep going'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    expect(host.querySelector('section.confirm')).toBeNull()
    expect(document.activeElement).toBe(skip)
    expect(bot.view().skipped).toEqual([])
    click(skip)
    click(buttonByText(host.querySelector<HTMLElement>('section.confirm')!, 'Skip Reaction Time'))
    expect(bot.view().skipped).toEqual(['RT'])
    expect(bot.view().segment?.id).toBe('matrix_series')
  })

  it('warns when the browser would not let the session be saved as it goes', () => {
    const bot = new Bot({ sessionId: 's_UISESSION00010' })
    open(bot, 'unavailable')
    expect(host.textContent).toContain('did not allow saving as you went')
  })

  it('"Keep going" in a running block hands focus to the block itself, so the very next response key counts (UX-005a)', async () => {
    const bot = new Bot({ sessionId: 's_UISESSION00013', skipped: ['RT', 'MAT', 'SPA', 'QR', 'PS'] })
    open(bot)
    click(buttonByText(host, 'Start'))
    await settle(2)
    expect(bot.view().phase).toBe('block')
    const block = host.querySelector<HTMLElement>('section.hb-render.span')!
    // The block is running: its first sequence has been shown and it waits for the digits.
    click(buttonByText(block, 'Start'))
    display.advance(6000)
    flushSync()
    const skip = buttonByText(host, 'Skip Working Memory')
    click(skip)
    expect(host.querySelector('section.confirm h2')?.textContent).toBe('Skip Working Memory?')
    click(buttonByText(host, 'Keep going'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    expect(host.querySelector('section.confirm')).toBeNull()
    const now = document.activeElement as HTMLElement
    expect(now).not.toBe(skip)
    expect(now.classList.contains('stage')).toBe(true)
    expect(block.contains(now)).toBe(true)
    // A key typed now is the block's: the renderers act on keys whose target is inside them (render/common/focus.ts), and take the digit.
    const seen: boolean[] = []
    const probe = (e: KeyboardEvent): void => void seen.push(isOwnKey(block, e))
    window.addEventListener('keydown', probe, true) // before the renderer's own handler
    const typed = press('3', now)
    expect(typed.defaultPrevented).toBe(true)
    // ... where from the Skip button it would not have been: the digit goes nowhere (and Space or Enter there opens the panel again).
    const stray = press('3', skip)
    window.removeEventListener('keydown', probe, true)
    expect(stray.defaultPrevented).toBe(false)
    expect(seen).toEqual([true, false])
  })

  it('"Keep going" on a question (no block) still returns focus to the button that opened the panel', async () => {
    const bot = new Bot({ sessionId: 's_UISESSION00014', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    open(bot)
    click(buttonByText(host, 'Start'))
    await settle(2)
    const finish = buttonByText(host, 'Finish early')
    click(finish)
    click(buttonByText(host, 'Keep going'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    expect(document.activeElement).toBe(finish)
  })

  it('Escape closes the skip panel and the finish panel, like "Keep going", and nothing else happens', async () => {
    const bot = new Bot({ sessionId: 's_UISESSION00015' })
    open(bot)
    const skip = buttonByText(host, 'Skip this part')
    click(skip)
    expect(host.querySelector('section.confirm')).not.toBeNull()
    press('Escape', document.activeElement)
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    expect(host.querySelector('section.confirm')).toBeNull()
    expect(document.activeElement).toBe(skip)
    expect(bot.view().skipped).toEqual([])
    const finish = buttonByText(host, 'Finish early')
    click(finish)
    expect(host.querySelector('section.confirm h2')?.textContent).toBe('Finish now?')
    press('Escape', document.activeElement)
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    expect(host.querySelector('section.confirm')).toBeNull()
    expect(document.activeElement).toBe(finish)
    expect(bot.view().phase).toBe('interstitial')
  })
})

describe('the header of a running session (UX-003)', () => {
  it('its buttons keep their full names, with the words after the first set apart for a narrow screen', async () => {
    const bot = new Bot({ sessionId: 's_UISESSION00016', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    open(bot)
    click(buttonByText(host, 'Start'))
    await settle(2)
    const skip = buttonByText(host, 'Skip Matrix & Series')
    const finish = buttonByText(host, 'Finish early')
    // What a screen reader and a voice-control user get is the full name (WCAG 2.5.3) ...
    expect(skip.textContent).toBe('Skip Matrix & Series')
    expect(finish.textContent).toBe('Finish early')
    // ... of which a phone shows the first word.
    expect(skip.querySelector('.narrow-hide')?.textContent).toBe(' Matrix & Series')
    expect(finish.querySelector('.narrow-hide')?.textContent).toBe(' early')
    expect(skip.firstChild?.textContent).toBe('Skip')
  })

  it('a skip and a time-out are news in the calm colour; a message that needs action keeps the warning one', async () => {
    const bot = new Bot({ sessionId: 's_UISESSION00017' })
    open(bot)
    bot.run.skipAxis()
    flushSync()
    const line = host.querySelector('p.status[role="status"]')!
    expect(line.textContent).toContain('Reaction Time skipped')
    expect(line.classList.contains('calm')).toBe(true)
    bot.run.startSegment()
    await settle(2)
    expect(bot.view().phase).toBe('item')
    expect(line.textContent).toBe('') // two screens on, it is gone
    expect(line.classList.contains('calm')).toBe(false)
  })

  it('a notice is on the screen it was raised on and the next one, and on no later screen', async () => {
    const bot = new Bot({ sessionId: 's_UISESSION00018', skipped: ['WM', 'PS', 'SPA', 'QR'] })
    open(bot)
    const line = (): string => host.querySelector('p.status[role="status"]')?.textContent ?? ''
    bot.run.skipAxis() // reaction time, from its interstitial: "Reaction Time skipped" is told on Matrix & Series' interstitial ...
    flushSync()
    expect(h1()).toBe('Up next: Matrix & Series')
    expect(line()).toContain('Reaction Time skipped')
    click(buttonByText(host, 'Start')) // ... and is gone from the first question
    await settle(2)
    expect(line()).toBe('')
  })

  it('the ring says "Almost there" past the target on the last part only; earlier it says the planned time is over', () => {
    const early = new Bot({ sessionId: 's_UISESSION00019', targetS: 60 })
    early.wait(120)
    open(early)
    const ring = (): string => host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext') ?? ''
    expect(ring()).toBe('Over the planned time')
    unmount(app!)
    host.remove()
    const last = new Bot({ sessionId: 's_UISESSION00020', targetS: 60, skipped: ['RT', 'MAT', 'SPA', 'WM', 'QR'] })
    last.wait(120)
    open(last)
    expect(h1()).toBe('Up next: Processing & Reading Speed')
    expect(ring()).toBe('Almost there')
  })
})

