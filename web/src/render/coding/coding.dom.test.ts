/**
 * Coding renderer (ROADMAP M1.11, M1.13, A10; DESIGN §3 row 10, §7.1, §11.6): the legend in spec
 * order with text alternatives, one glyph at a time, digit keys and keypad record {digit, t_ms}
 * from the frame that drew the first glyph, the 90 s window closes the block, and score() takes
 * the response; the glyph drawings are distinct and none is text; plus a snapshot.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { coding, codingOutcome } from '../../tasks/coding'
import { CODING_SYMBOLS, type CodingItem, type CodingResponses, type CodingSymbol } from '../../tasks/coding/config'
import { normalizeIds } from '../common/leak'
import { buttonByText, click, fakeDisplay, press, render } from '../common/testing'
import CodingRenderer from './CodingRenderer.svelte'
import { GLYPHS } from './glyphs'

const FRAME = 1000 / 60

let cleanup: (() => void)[] = []
afterEach(() => {
  for (const f of cleanup) f()
  cleanup = []
})

function mountCoding(item: CodingItem) {
  const display = fakeDisplay()
  const responses: CodingResponses[] = []
  const r = render(CodingRenderer, { spec: item.spec, onrespond: (x: CodingResponses) => responses.push(x), timing: display })
  cleanup.push(r.destroy)
  return { ...r, display, responses }
}

const currentName = (root: HTMLElement): string | null => root.querySelector('.stage svg')?.getAttribute('aria-label') ?? null
const symbolOfName = (name: string | null): CodingSymbol | undefined => CODING_SYMBOLS.find((s) => GLYPHS[s].name === name)

describe('coding glyphs', () => {
  it('has a distinct drawing and name for each of the 9 symbols, and no text', () => {
    const names = CODING_SYMBOLS.map((s) => GLYPHS[s].name)
    expect(new Set(names).size).toBe(9)
    const drawings = CODING_SYMBOLS.map((s) => JSON.stringify(GLYPHS[s].shapes))
    expect(new Set(drawings).size).toBe(9)
    for (const s of CODING_SYMBOLS) for (const n of GLYPHS[s].name.split(/\W+/)) expect(n).not.toMatch(/^\d+$/)
  })
})

describe('CodingRenderer', () => {
  it('shows the legend in spec order, each glyph with its name and digit', () => {
    const item = coding.generate('render-coding-legend')
    const m = mountCoding(item)
    const cells = [...m.container.querySelectorAll('.legend .cell')]
    expect(cells.map((c) => c.querySelector('.legend-digit')?.textContent)).toEqual(item.spec.legend.map((c) => String(c.digit)))
    expect(cells.map((c) => c.querySelector('.hb-sr-only')?.textContent)).toEqual(item.spec.legend.map((c) => `${GLYPHS[c.symbol].name}:`))
  })

  it('times a key press from the event timestamp, not from when the handler ran (§11.6)', () => {
    const item = coding.generate('render-coding-evts')
    const m = mountCoding(item)
    click(buttonByText(m.container, 'Start'))
    m.display.advance(FRAME)
    const t0 = m.display.now()
    m.display.advance(650) // the handler runs 650 ms after the first glyph...
    const first = item.spec.legend.find((c) => c.symbol === item.spec.sequence[0])?.digit ?? 1
    press(String(first), null, {}, t0 + 640) // ...for an event stamped 640 ms after it (10 ms dispatch lag)
    m.display.advance(90_000)
    expect((m.responses[0] as CodingResponses)[0]?.t_ms).toBeCloseTo(640, 6)
  })

  it('answers glyph by glyph from the keyboard and keypad, timed from the first glyph frame, and score() counts them', () => {
    const item = coding.generate('render-coding-run')
    const m = mountCoding(item)
    click(buttonByText(m.container, 'Start'))
    expect(currentName(m.container)).toBeNull()
    m.display.advance(FRAME)
    const t0 = m.display.now()
    const legend = new Map(item.spec.legend.map((c) => [c.symbol, c.digit]))
    for (let k = 0; k < 40; k++) {
      expect(symbolOfName(currentName(m.container))).toBe(item.spec.sequence[k])
      m.display.advance(700)
      const digit = legend.get(item.spec.sequence[k] as CodingSymbol) ?? 0
      const wrong = k % 10 === 9
      const d = wrong ? (digit % 9) + 1 : digit
      if (k % 2 === 0) press(String(d))
      else click(buttonByText(m.container.querySelector('.keypad') as HTMLElement, String(d)))
    }
    expect(m.responses).toEqual([])
    m.display.advance(90_000)
    expect(m.responses).toHaveLength(1)
    const r = m.responses[0] as CodingResponses
    expect(r).toHaveLength(40)
    r.forEach((x, k) => expect(x.t_ms).toBeCloseTo((k + 1) * 700, 6))
    expect(t0).toBeGreaterThan(0)
    const outcome = codingOutcome(item, r)
    expect(outcome).toMatchObject({ attempted: 40, correct: 36, errors: 4, late: 0 })
    expect(coding.score(item, r).observation?.kind).toBe('gaussian')
    expect(m.container.textContent).toContain('Time is up')
  })

  it('closes the window at duration_s after the first glyph frame, not later', () => {
    const item = coding.generate('render-coding-window')
    const m = mountCoding(item)
    click(buttonByText(m.container, 'Start'))
    m.display.advance(FRAME)
    const t0 = m.display.now()
    let t = 0
    while (m.responses.length === 0 && t < 100_000) {
      m.display.advance(FRAME)
      t += FRAME
    }
    expect(m.display.now() - t0).toBeGreaterThanOrEqual(item.spec.duration_s * 1000 - 1e-6)
    expect(m.display.now() - t0).toBeLessThan(item.spec.duration_s * 1000 + FRAME + 1e-6)
    expect(m.responses[0]).toEqual([])
    expect(coding.score(item, []).reasons).toEqual(['no_correct_responses'])
  })

  it('digit 0 is recorded (never right), other keys are ignored', () => {
    const item = coding.generate('render-coding-zero')
    const m = mountCoding(item)
    click(buttonByText(m.container, 'Start'))
    m.display.advance(FRAME)
    press('a')
    press('0')
    m.display.advance(91_000)
    expect(m.responses[0]?.map((r) => r.digit)).toEqual([0])
  })

  it('keeps one polite status line and, when the block ends, focus on it inside the renderer (WCAG 2.4.3, 4.1.3)', () => {
    // Ended by the clock.
    const timed = mountCoding(coding.generate('render-coding-focus-time'))
    const status = timed.container.querySelector('.hb-status')
    expect(status?.getAttribute('aria-live')).toBe('polite')
    click(buttonByText(timed.container, 'Start'))
    expect(document.activeElement?.classList.contains('stage')).toBe(true)
    timed.display.advance(FRAME)
    timed.display.advance(91_000)
    expect(timed.responses).toHaveLength(1)
    expect(timed.container.querySelector('.hb-status')).toBe(status)
    expect(status?.textContent).toBe('Time is up. Thank you.')
    expect(document.activeElement).toBe(status)
    timed.destroy()

    // Ended by answering every glyph (from the keypad, which is then removed).
    const item = coding.generate('render-coding-focus-all')
    const all = mountCoding(item)
    click(buttonByText(all.container, 'Start'))
    all.display.advance(FRAME)
    for (let k = 0; k < item.spec.sequence.length; k++) {
      all.display.advance(50)
      click(buttonByText(all.container.querySelector('.keypad') as HTMLElement, '1'))
    }
    expect(all.responses).toHaveLength(1)
    expect(all.container.querySelector('.keypad')).toBeNull()
    const done = all.container.querySelector('.hb-status')
    expect(done?.textContent).toBe('You answered every shape. Thank you.')
    expect(document.activeElement).toBe(done)
    expect(all.container.contains(document.activeElement)).toBe(true)
  })

  it('names the table and the shapes in one noun and shows the table as a reference strip, not as keys (UX-002, UX-025)', () => {
    const m = mountCoding(coding.generate('render-coding-names'))
    expect(m.container.querySelector('.title')?.textContent).toBe('Shape to digit')
    const legend = m.container.querySelector('ul.legend')
    expect(legend?.getAttribute('aria-label')).toBe('Shape-to-digit table')
    expect(legend?.querySelectorAll('li')).toHaveLength(9)
    // Nothing in the table can be pressed or mistaken for an answer key.
    expect(legend?.querySelector('button, [role="button"], [tabindex]')).toBeNull()
    const intro = m.container.querySelector('.hb-instructions')?.textContent?.replace(/\s+/g, ' ') ?? ''
    expect(intro).toContain('Each shape in the table above has a digit.')
    expect(intro).toContain('on-screen keypad or the number keys on your keyboard')
    expect(intro).not.toContain('key above')
  })

  it('scrolls the table to the top of the screen when the block starts, then focuses the stage without scrolling (UX-002)', () => {
    const scrolled = vi.fn()
    const had = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrolled, configurable: true, writable: true })
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    try {
      const m = mountCoding(coding.generate('render-coding-scroll'))
      expect(scrolled).not.toHaveBeenCalled()
      click(buttonByText(m.container, 'Start'))
      expect(scrolled).toHaveBeenCalledTimes(1)
      expect(scrolled).toHaveBeenCalledWith({ block: 'start' })
      expect(scrolled.mock.contexts[0]).toBe(m.container.querySelector('ul.legend'))
      const stage = m.container.querySelector('.stage')
      expect(document.activeElement).toBe(stage)
      const call = focus.mock.calls.findIndex((_, k) => focus.mock.contexts[k] === stage)
      expect(focus.mock.calls[call]?.[0]).toEqual({ preventScroll: true })
      // The table is scrolled to before the stage takes focus.
      expect(scrolled.mock.invocationCallOrder[0]).toBeLessThan(focus.mock.invocationCallOrder[call] as number)
    } finally {
      focus.mockRestore()
      if (had) Object.defineProperty(Element.prototype, 'scrollIntoView', had)
      else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('the stage that holds focus is a named group, the keypad is one row of nine, and the countdown is not translated (UX-002, UX-022)', () => {
    const m = mountCoding(coding.generate('render-coding-a11y'))
    click(buttonByText(m.container, 'Start'))
    const stage = m.container.querySelector('.stage')
    expect(stage?.getAttribute('role')).toBe('group')
    expect(stage?.getAttribute('aria-label')).toBe('Shapes: type the digit for each shape')
    expect(m.container.querySelector('[role="timer"]')?.getAttribute('translate')).toBe('no')
    const keypad = m.container.querySelector('.keypad') as HTMLElement
    expect(keypad.getAttribute('aria-label')).toBe('Digit keypad')
    expect(keypad.classList.contains('fixed')).toBe(true)
    expect(keypad.style.getPropertyValue('--cols')).toBe('9')
    expect(keypad.querySelectorAll('button')).toHaveLength(9)
  })

  it('matches its snapshots (intro and running)', () => {
    const item = coding.generate('render-coding-snap')
    const m = mountCoding(item)
    expect(normalizeIds(m.container)).toMatchSnapshot()
    click(buttonByText(m.container, 'Start'))
    m.display.advance(FRAME)
    expect(normalizeIds(m.container)).toMatchSnapshot()
  })
})
