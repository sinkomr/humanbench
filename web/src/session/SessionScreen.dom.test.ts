import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isOwnKey } from '../render/common/focus'
import { buttonByText, click, fakeDisplay, press } from '../render/common/testing'
import { settle } from '../render/dom-testing'
import { fakeEnv } from './dom-support'
import SessionScreen from './SessionScreen.svelte'
import { BackendError } from '../backend/errors'
import type { ServedItem } from '../backend/items'
import type { CatAnswer, CatNext, CatSource } from '../backend/session'
import type { AxisCode } from '../engine/axes'
import { Bot, TEST_DEVICE } from './bot'
import { SessionRun } from './run'
import { BREAK_OFFER_TEXT, INTERSTITIAL_CLOCK } from './copy'
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
    expect(h1()).toBe('Up next: Reaction Time')
    expect(host.textContent).toMatch(/About \d+ minutes?\./)
    expect(host.textContent).toContain('Respond as fast as you can')
    expect(document.activeElement?.tagName).toBe('H1')
    click(buttonByText(host, 'Start'))
    flushSync()
    expect(bot.view().phase).toBe('block')
    expect(h1()).toBe('Reaction Time')
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

  it('Continue on a slider that was never moved records the answer as not rated, and counts it (UX-063)', async () => {
    const bot = new Bot({ sessionId: 's_UISESSION00022', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    open(bot)
    click(buttonByText(host, 'Start'))
    await settle(3)
    const full = bot.fullItem(bot.view().item!.item_id)
    bot.run.itemResponded(full.options_count === undefined ? '1' : 0)
    flushSync()
    expect(host.querySelector('input[type="range"]')).not.toBeNull()
    click(buttonByText(host, 'Continue')) // straight away: the default is allowed, but it is no rating
    const st = bot.run.sessionState()
    expect(st.responses[0]![5]).toBeNull()
    expect(st.flags.confidence_untouched_n).toBe(1)
    expect(bot.run.result().calibration).toBeNull()
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

  it('suggests a break between two parts, at the half-way one; taking it pauses, resuming goes on to the next "Up next" screen', () => {
    // breakAtS 5: the boundary nearest is the first one, before Matrix & Series.
    const bot = new Bot({ sessionId: 's_UISESSION00006', breakAtS: 5 })
    open(bot)
    bot.run.startSegment()
    bot.wait(10)
    bot.run.skipAxis() // reaction time ends: the boundary
    flushSync()
    expect(h1()).toBe('Time for a break?')
    expect(host.textContent).toContain(BREAK_OFFER_TEXT)
    expect(host.textContent).not.toMatch(/30 minutes|sharp|help you/i)
    bot.wait(300) // the clock waits on the offer too
    expect(bot.view().elapsedS).toBeCloseTo(10, 3)
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

  it('every "Up next" screen says that the clock waits until Start, and it does (UX-066)', () => {
    const bot = new Bot({ sessionId: 's_UISESSION00021', breakAtS: 1e9 })
    open(bot)
    const note = (): string => host.querySelector('[data-clock-note]')?.textContent ?? ''
    expect(note()).toBe(INTERSTITIAL_CLOCK)
    bot.wait(500)
    bot.run.tick()
    expect(bot.view().elapsedS).toBe(0)
    bot.run.skipAxis() // Skip on the interstitial: the next one, the clock still waiting
    flushSync()
    expect(h1()).toBe('Up next: Matrix & Series')
    expect(note()).toBe(INTERSTITIAL_CLOCK)
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('0')
    click(buttonByText(host, 'Start'))
    expect(host.querySelector('[data-clock-note]')).toBeNull()
  })

  it('declining the break carries on where it was', () => {
    const bot = new Bot({ sessionId: 's_UISESSION00007', breakAtS: 5 })
    open(bot)
    bot.run.startSegment()
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
    // Passing the half-way part (Working Memory) brings the one break offer first (UX-066).
    expect(bot.view().phase).toBe('break_offer')
    bot.run.declineBreak()
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
    // Three parts, the break before the third: the skip leads straight to the next "Up next" screen.
    const bot = new Bot({ sessionId: 's_UISESSION00018', skipped: ['WM', 'PS', 'QR'] })
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
    early.run.startSegment() // the clock waits on "Up next" screens: past the target inside a part
    early.wait(120)
    open(early)
    const ring = (): string => host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext') ?? ''
    expect(ring()).toBe('Over the planned time')
    unmount(app!)
    host.remove()
    const last = new Bot({ sessionId: 's_UISESSION00020', targetS: 60, skipped: ['RT', 'MAT', 'SPA', 'WM', 'QR'] })
    last.run.startSegment()
    last.wait(120)
    open(last)
    expect(h1()).toBe('Processing & Reading Speed')
    expect(ring()).toBe('Almost there')
  })
})

describe('focus on a new screen (UX-REVIEW D21, a provisional default, option B; WCAG 2.4.3, 4.1.3)', () => {
  const region = (): HTMLElement => host.querySelector<HTMLElement>('.item-region')!
  const active = (): Element | null => document.activeElement

  /** Answer the question on screen, rate it, and wait for what follows. */
  async function answerAndRate(bot: Bot): Promise<void> {
    const full = bot.fullItem(bot.view().item!.item_id)
    bot.run.itemResponded(full.options_count === undefined ? '1' : 0)
    flushSync()
    expect(active()).toBe(host.querySelector('input[type="range"]')) // the slider takes focus, as before
    click(buttonByText(host, 'Continue'))
    await settle(2)
  }

  /** Matrix & Series and Spatial are the parts of this plan: Reaction Time, Working Memory, Quantitative and Speed are skipped. */
  function twoParts(id: string): Bot {
    return new Bot({ sessionId: id, skipped: ['RT', 'WM', 'PS', 'QR'] })
  }

  it('the first question of a part takes the heading, and the question has a region of its own that is not a tab stop', async () => {
    const bot = twoParts('s_UISESSION00030')
    open(bot)
    click(buttonByText(host, 'Start'))
    await settle(2)
    expect(bot.view().phase).toBe('item')
    expect(active()).toBe(host.querySelector('h1'))
    const r = region()
    expect(r.getAttribute('role')).toBe('group')
    expect(r.getAttribute('aria-label')).toBe('Question 1')
    // A script target (focusable by `focus()`), not in the tab order; the question is inside it, the heading is not.
    expect(r.getAttribute('tabindex')).toBe('-1')
    expect(r.tabIndex).toBe(-1)
    expect(r.contains(host.querySelector('form.choice, form.entry'))).toBe(true)
    expect(r.contains(host.querySelector('h1'))).toBe(false)
    // The first thing Tab reaches after the region's start is inside it (the answer), so one Tab from the region still gets there.
    const stops = [...host.querySelectorAll<HTMLElement>('main a[href], main button, main input, main select, main textarea, main [tabindex]')].filter((el) => el.tabIndex >= 0 && !el.closest('[hidden]'))
    expect(stops.length).toBeGreaterThan(0)
    expect(r.contains(stops[0]!)).toBe(true)
  })

  it('a later question of the same part takes its region, "Question 2", "Question 3": the part is not named again, and the tab and heading still name it', async () => {
    const bot = twoParts('s_UISESSION00031')
    open(bot)
    click(buttonByText(host, 'Start'))
    await settle(2)
    const first = bot.view().item!.item_id
    expect(active()).toBe(host.querySelector('h1'))
    for (const n of [2, 3]) {
      await answerAndRate(bot)
      expect(bot.view().phase).toBe('item')
      expect(bot.view().item!.item_id).not.toBe(first)
      expect(active()).toBe(region())
      expect(region().getAttribute('aria-label')).toBe(`Question ${n}`)
      expect(active()).not.toBe(host.querySelector('h1'))
      expect(h1()).toBe('Matrix & Series')
      expect(document.title).toBe('Matrix & Series · HumanBench')
      expect(host.querySelectorAll('.item-region')).toHaveLength(1)
    }
  })

  it('the confidence panel keeps the question and its region: the slider has focus there, and the next question goes to its region, not back to the slider or the heading', async () => {
    const bot = twoParts('s_UISESSION00032')
    open(bot)
    click(buttonByText(host, 'Start'))
    await settle(2)
    const full = bot.fullItem(bot.view().item!.item_id)
    const before = region()
    bot.run.itemResponded(full.options_count === undefined ? '1' : 0)
    flushSync()
    expect(bot.view().phase).toBe('confidence')
    expect(region()).toBe(before) // the same screen: nothing was remounted, and the region holds the slider
    expect(region().contains(host.querySelector('input[type="range"]'))).toBe(true)
    expect(active()).toBe(host.querySelector('input[type="range"]'))
    click(buttonByText(host, 'Continue'))
    await settle(2)
    expect(host.querySelector('input[type="range"]')).toBeNull()
    expect(active()).toBe(region())
    expect(region()).not.toBe(before)
  })

  it('after a skip the next part opens at its heading: its "Up next" screen and its first question both take the heading, and the numbering starts again', async () => {
    const bot = twoParts('s_UISESSION00033')
    open(bot)
    click(buttonByText(host, 'Start'))
    await settle(2)
    await answerAndRate(bot)
    expect(active()).toBe(region())
    expect(region().getAttribute('aria-label')).toBe('Question 2')
    // Skip the rest of Matrix & Series (the one break is offered between the two parts: decline it).
    click(buttonByText(host, 'Skip Matrix & Series'))
    click(buttonByText(host.querySelector<HTMLElement>('section.confirm')!, 'Skip Matrix & Series'))
    flushSync()
    expect(bot.view().phase).toBe('break_offer')
    expect(h1()).toBe('Time for a break?')
    expect(active()).toBe(host.querySelector('h1'))
    click(buttonByText(host, 'Keep going'))
    expect(h1()).toBe('Up next: Spatial')
    expect(active()).toBe(host.querySelector('h1'))
    click(buttonByText(host, 'Start'))
    await settle(2)
    expect(bot.view().item?.axis).toBe('SPA')
    expect(h1()).toBe('Spatial')
    expect(active()).toBe(host.querySelector('h1'))
    expect(region().getAttribute('aria-label')).toBe('Question 1')
  })

  it('after a skip that leads straight to the next "Up next" screen: the heading again, and the part after it starts its numbering at 1', async () => {
    const bot = new Bot({ sessionId: 's_UISESSION00038', skipped: ['RT'] })
    open(bot)
    click(buttonByText(host, 'Start'))
    await settle(2)
    await answerAndRate(bot)
    expect(active()).toBe(region())
    click(buttonByText(host, 'Skip Matrix & Series'))
    click(buttonByText(host.querySelector<HTMLElement>('section.confirm')!, 'Skip Matrix & Series'))
    flushSync()
    expect(bot.view().phase).toBe('interstitial') // the break is not offered until further on
    expect(h1()).toBe('Up next: Spatial')
    expect(active()).toBe(host.querySelector('h1'))
    expect(host.querySelector('.item-region')).toBeNull()
    click(buttonByText(host, 'Start'))
    await settle(2)
    expect(active()).toBe(host.querySelector('h1'))
    expect(region().getAttribute('aria-label')).toBe('Question 1')
  })

  it('after the break offer: the offer, the "Up next" screen and the part\'s first question all take the heading, however many questions came before', async () => {
    // Two parts: the one boundary between them is where the break is offered (UX-066).
    const bot = twoParts('s_UISESSION00034')
    open(bot)
    click(buttonByText(host, 'Start'))
    await settle(2)
    await answerAndRate(bot)
    await answerAndRate(bot)
    expect(region().getAttribute('aria-label')).toBe('Question 3')
    expect(active()).toBe(region())
    bot.run.skipAxis('MAT')
    flushSync()
    expect(bot.view().phase).toBe('break_offer')
    expect(h1()).toBe('Time for a break?')
    expect(active()).toBe(host.querySelector('h1'))
    click(buttonByText(host, 'Take a break'))
    expect(h1()).toBe('Break')
    expect(active()).toBe(host.querySelector('h1'))
    click(buttonByText(host, 'Resume'))
    expect(h1()).toBe('Up next: Spatial')
    expect(active()).toBe(host.querySelector('h1'))
    click(buttonByText(host, 'Start'))
    await settle(2)
    expect(active()).toBe(host.querySelector('h1'))
    expect(host.querySelector('.item-region')).not.toBeNull()
  })

  it('a block or an "Up next" screen takes the heading as before, and has no question region', async () => {
    const bot = new Bot({ sessionId: 's_UISESSION00035', skipped: ['MAT', 'SPA', 'QR', 'PS', 'WM'] })
    open(bot)
    expect(active()).toBe(host.querySelector('h1'))
    expect(host.querySelector('.item-region')).toBeNull()
    click(buttonByText(host, 'Start'))
    await settle(2)
    expect(bot.view().phase).toBe('block')
    expect(h1()).toBe('Reaction Time')
    expect(host.querySelector('.item-region')).toBeNull()
    expect(document.title).toBe('Reaction Time · HumanBench')
  })

  it('a later question that cannot be drawn keeps its region on screen with the panel inside it, so focus is not lost with the parked renderer', async () => {
    const bot = twoParts('s_UISESSION00036')
    open(bot)
    click(buttonByText(host, 'Start'))
    await settle(2)
    await answerAndRate(bot)
    expect(active()).toBe(region())
    bot.run.itemUnavailable()
    flushSync()
    const r = region()
    expect(host.querySelector('.stage-host')!.hasAttribute('hidden')).toBe(true)
    expect(r.closest('[hidden]')).toBeNull()
    expect(r.contains(host.querySelector('.unavailable'))).toBe(true)
    expect(active()).toBe(r)
  })

  it('a later question whose region cannot take focus falls back to the heading (nothing is lost)', async () => {
    const bot = twoParts('s_UISESSION00037')
    open(bot)
    click(buttonByText(host, 'Start'))
    await settle(2)
    expect(active()).toBe(host.querySelector('h1'))
    // The region of the next question is not focusable here (its tabindex is taken away as the screen is built).
    const original = HTMLElement.prototype.focus
    const spy = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      if (this.classList.contains('item-region')) return
      original.call(this, options)
    })
    try {
      await answerAndRate(bot)
    } finally {
      spy.mockRestore()
    }
    expect(active()).toBe(host.querySelector('h1'))
  })
})

describe('one primary action per screen: the Skip and Finish panels (UX-REVIEW D27, a provisional default, option A)', () => {
  const panel = (): HTMLElement => host.querySelector<HTMLElement>('section.confirm')!
  const names = (): string[] => [...panel().querySelectorAll('button')].map((b) => b.textContent!.trim())
  const primary = (): string[] => [...panel().querySelectorAll('button.hb-primary')].map((b) => b.textContent!.trim())

  it('the Skip panel on a question: "Keep going" first and the only primary, the skip a plain button that still skips', async () => {
    const bot = new Bot({ sessionId: 's_UISESSION00040', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    open(bot)
    click(buttonByText(host, 'Start'))
    await settle(2)
    click(buttonByText(host, 'Skip Matrix & Series'))
    expect(names()).toEqual(['Keep going', 'Skip Matrix & Series'])
    expect(primary()).toEqual(['Keep going'])
    click(buttonByText(panel(), 'Skip Matrix & Series'))
    expect(bot.view().skipped).toContain('MAT')
  })

  it('the Skip panel on an "Up next" screen is the same', () => {
    const bot = new Bot({ sessionId: 's_UISESSION00041' })
    open(bot)
    click(buttonByText(host, 'Skip this part'))
    expect(names()).toEqual(['Keep going', 'Skip Reaction Time'])
    expect(primary()).toEqual(['Keep going'])
  })

  it('the Finish panel: "Keep going" first and the only primary, "Finish now" plain and still finishes', async () => {
    const bot = new Bot({ sessionId: 's_UISESSION00042', skipped: ['RT', 'WM', 'PS', 'SPA', 'QR'] })
    open(bot)
    click(buttonByText(host, 'Start'))
    await settle(2)
    click(buttonByText(host, 'Finish early'))
    expect(host.querySelector('section.confirm h2')?.textContent).toBe('Finish now?')
    expect(names()).toEqual(['Keep going', 'Finish now'])
    expect(primary()).toEqual(['Keep going'])
    click(buttonByText(panel(), 'Finish now'))
    expect(bot.view().phase).toBe('finished')
  })

  it('Escape keeps meaning "Keep going" with the panels built this way, and the first button (the primary) is it', async () => {
    const bot = new Bot({ sessionId: 's_UISESSION00043' })
    open(bot)
    const skip = buttonByText(host, 'Skip this part')
    click(skip)
    press('Escape', document.activeElement)
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    expect(host.querySelector('section.confirm')).toBeNull()
    expect(document.activeElement).toBe(skip)
    expect(bot.view().skipped).toEqual([])
    click(skip)
    click(panel().querySelector<HTMLElement>('button.hb-primary'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    expect(host.querySelector('section.confirm')).toBeNull()
    expect(bot.view().skipped).toEqual([])
  })

  it('the "cannot be shown" panel keeps its own primary: the skip it offers (a question that cannot be drawn has no other way on)', async () => {
    const bot = new Bot({ sessionId: 's_UISESSION00044', skipped: ['RT', 'MAT', 'WM', 'PS', 'QR'] })
    open(bot)
    click(buttonByText(host, 'Start'))
    await settle(2)
    bot.run.itemUnavailable()
    flushSync()
    const unavailable = host.querySelector<HTMLElement>('.unavailable')!
    expect([...unavailable.querySelectorAll('button.hb-primary')].map((b) => b.textContent!.trim())).toEqual(['Skip Spatial'])
  })
})

describe('focus in a served part, which waits between its questions (UX-REVIEW D21; ROADMAP M2.7)', () => {
  const item = (n: number): ServedItem => ({ seq: n, item_id: `i:series:1.0.0:${n}`, item_type: 'series', family: 'series', spec: { input_format: 'integer', terms: [1, 2, 3] }, time_limit_s: 120, supported: true })

  /** A fake server that answers `next` from a script; 'hang' leaves the question on its way until the test hands it over. */
  class Scripted implements CatSource {
    readonly sessionId = 's_SERVERSESSION01'
    steps: (CatNext | Error | 'hang')[] = []
    private hung: ((r: CatNext) => void)[] = []
    next(_axes: readonly AxisCode[]): Promise<CatNext> {
      const step = this.steps.shift()
      if (step === undefined) return Promise.resolve({ kind: 'done', reason: 'axes_done' })
      if (step === 'hang') return new Promise((resolve) => this.hung.push(resolve))
      if (step instanceof Error) return Promise.reject(step)
      return Promise.resolve(step)
    }
    release(r: CatNext): void {
      this.hung.shift()?.(r)
    }
    answer(_a: CatAnswer): Promise<void> {
      return Promise.resolve()
    }
  }

  const flushPromises = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
    await settle(2)
    flushSync()
  }

  function openServed(cat: Scripted): SessionRun {
    const run = new SessionRun({ sessionId: 's_LOCALSESSION002', startedMs: 1_790_000_000_000, now: () => 0, device: TEST_DEVICE, rtInput: 'keyboard', cat })
    run.skipAxis('RT')
    display = fakeDisplay()
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(SessionScreen, { target: host, props: { env: fakeEnv(display).env, run, autosave: 'ok' as AutosaveStatus } })
    flushSync()
    return run
  }

  /** Answer the question on screen as far as its confidence form, and press Continue: the run asks the server for the next one. */
  async function rate(run: SessionRun): Promise<void> {
    run.itemShown(0)
    run.itemResponded('4')
    flushSync()
    click(buttonByText(host, 'Continue'))
    await flushPromises()
  }

  it('the first wait of a part and the first question take the heading; the wait between two questions takes nothing, the question after it takes its region', async () => {
    const cat = new Scripted()
    cat.steps = ['hang', 'hang']
    const run = openServed(cat)
    click(buttonByText(host, 'Start'))
    await flushPromises()
    expect(run.view().phase).toBe('loading')
    expect(host.querySelector('[data-loading]')).not.toBeNull()
    expect(document.activeElement).toBe(host.querySelector('h1')) // nothing of the part is up yet: a screen of its own, as before
    cat.release({ kind: 'item', item: item(1) })
    await flushPromises()
    expect(run.view().phase).toBe('item')
    expect(document.activeElement).toBe(host.querySelector('h1'))
    expect(region().getAttribute('aria-label')).toBe('Question 1')
    await rate(run)
    expect(run.view().phase).toBe('loading')
    expect(host.querySelector('[data-loading]')).not.toBeNull()
    expect(document.activeElement).not.toBe(host.querySelector('h1')) // the wait between two questions does not name the part again
    expect(h1()).toBe('Matrix & Series')
    cat.release({ kind: 'item', item: item(2) })
    await flushPromises()
    expect(run.view().phase).toBe('item')
    expect(document.activeElement).toBe(region())
    expect(region().getAttribute('aria-label')).toBe('Question 2')
  })

  it('a wait that failed takes the heading (the alert and "Try again" are a screen to be told about); after it the question goes to its region', async () => {
    const cat = new Scripted()
    cat.steps = [{ kind: 'item', item: item(1) }, new BackendError('network', 'network_error'), { kind: 'item', item: item(2) }]
    const run = openServed(cat)
    click(buttonByText(host, 'Start'))
    await flushPromises()
    expect(run.view().phase).toBe('item')
    await rate(run)
    expect(run.view().phase).toBe('loading')
    expect(run.view().problem).not.toBeNull()
    expect(host.querySelector('[data-loading-problem]')).not.toBeNull()
    expect(document.activeElement).toBe(host.querySelector('h1'))
    click(buttonByText(host, 'Try again'))
    await flushPromises()
    expect(run.view().phase).toBe('item')
    expect(document.activeElement).toBe(region())
    expect(region().getAttribute('aria-label')).toBe('Question 2')
  })

  const region = (): HTMLElement => host.querySelector<HTMLElement>('.item-region')!
})
