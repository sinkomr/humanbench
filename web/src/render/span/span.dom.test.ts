/**
 * Span boards (ROADMAP M1.9, M1.13, A10; DESIGN §11.6, §14.6 ex. 10–11): rAF-locked presentation
 * at the spec's rate, keypad / keyboard / board entry, the family state machine drives the trials,
 * and the response scores with the family's score() to the expected GRM category; plus snapshots.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { corsi, spanBwd, spanFwd } from '../../tasks/span'
import { CORSI_BOARD, type SpanItem, type SpanResponse } from '../../tasks/span/config'
import { normalizeIds } from '../common/leak'
import { buttonByText, click, fakeDisplay, press, render, type FakeDisplay } from '../common/testing'
import CorsiRenderer from './CorsiRenderer.svelte'
import corsiSource from './CorsiRenderer.svelte?raw'
import DigitSpanRenderer from './DigitSpanRenderer.svelte'
import { SPAN_LEAD_MS, nearestInDirection, spanTargets } from './run'

const FRAME = 1000 / 60

let cleanup: (() => void)[] = []
afterEach(() => {
  for (const f of cleanup) f()
  cleanup = []
})

function mountSpan(item: SpanItem, component: typeof DigitSpanRenderer | typeof CorsiRenderer) {
  const display = fakeDisplay()
  const responses: SpanResponse[] = []
  const r = render(component, { spec: item.spec, onrespond: (x: SpanResponse) => responses.push(x), timing: display })
  cleanup.push(r.destroy)
  return { ...r, display, responses }
}

/** Run frames until `pred()` holds; fails after `maxMs`. */
function until(display: FakeDisplay, pred: () => boolean, maxMs = 20_000): void {
  let t = 0
  while (!pred()) {
    if (t > maxMs) throw new Error('condition not reached')
    display.advance(FRAME)
    t += FRAME
  }
}

const inEntry = (root: HTMLElement): boolean => root.querySelector('.hb-status')?.textContent?.startsWith('Enter') === true || root.querySelector('.hb-status')?.textContent?.startsWith('Selected') === true

describe('DigitSpanRenderer', () => {
  it('presents trial 1 digit by digit, each ≥ 800 ms on and ≥ 200 ms off, locked to frames', () => {
    const item = spanFwd.generate('render-span-timing')
    const m = mountSpan(item, DigitSpanRenderer)
    click(buttonByText(m.container, 'Start'))
    const events: [number, string][] = []
    let last = ''
    until(m.display, () => {
      const now = m.container.querySelector('.digit')?.textContent ?? ''
      if (now !== last) events.push([m.display.now(), now])
      last = now
      return inEntry(m.container)
    })
    const shows = events.filter(([, d]) => d !== '')
    expect(shows.map(([, d]) => Number(d))).toEqual(item.spec.trials[0])
    const start = 1000 // fakeDisplay start: Start was clicked at t = 1000
    expect(shows[0]?.[0]).toBeGreaterThanOrEqual(start + SPAN_LEAD_MS)
    expect(shows[0]?.[0]).toBeLessThan(start + SPAN_LEAD_MS + 3 * FRAME)
    for (let k = 0; k + 1 < events.length; k++) {
      const [t0, d0] = events[k] as [number, string]
      const [t1] = events[k + 1] as [number, string]
      const min = d0 === '' ? item.spec.timing.off_ms : item.spec.timing.on_ms
      expect(t1 - t0).toBeGreaterThanOrEqual(min - 1e-6)
      expect(t1 - t0).toBeLessThan(min + FRAME + 1e-6)
    }
  })

  for (const [name, family] of [
    ['forward', spanFwd],
    ['backward', spanBwd],
  ] as const) {
    it(`${name}: typing every target on the keyboard runs the whole block and scores the top category`, () => {
      const item = family.generate(`render-span-${name}`)
      const targets = spanTargets(item.spec)
      expect(targets).toEqual(item.key.sequences)
      const m = mountSpan(item, DigitSpanRenderer)
      click(buttonByText(m.container, 'Start'))
      for (let trial = 0; trial < targets.length; trial++) {
        until(m.display, () => inEntry(m.container))
        for (const d of targets[trial] ?? []) press(String(d))
        press('Enter')
      }
      expect(m.responses).toHaveLength(1)
      expect(m.responses[0]).toEqual(targets)
      const score = family.score(item, m.responses[0] as SpanResponse)
      expect(score.observation).toMatchObject({ kind: 'grm', y: item.spec.max_length - item.spec.start_length + 1 })
      expect(m.container.textContent).toContain('Block complete')
    })
  }

  it('the keypad, Delete and Backspace edit the entry; the entry stops at the sequence length', () => {
    const item = spanFwd.generate('render-span-keypad')
    const m = mountSpan(item, DigitSpanRenderer)
    click(buttonByText(m.container, 'Start'))
    until(m.display, () => inEntry(m.container))
    const slots = () => [...m.container.querySelectorAll('.slot')].map((s) => s.textContent)
    click(buttonByText(m.container, '4'))
    click(buttonByText(m.container, '7'))
    expect(slots()).toEqual(['4', '7', ''])
    press('Backspace')
    expect(slots()).toEqual(['4', '', ''])
    click(buttonByText(m.container, 'Delete'))
    for (const k of ['1', '2', '3', '5']) press(k)
    expect(slots()).toEqual(['1', '2', '3'])
    press('0')
    expect(slots()).toEqual(['1', '2', '3'])
  })

  it('failing both trials at length 3 ends the block with category 0', () => {
    const item = spanFwd.generate('render-span-fail')
    const m = mountSpan(item, DigitSpanRenderer)
    click(buttonByText(m.container, 'Start'))
    for (let trial = 0; trial < 2; trial++) {
      until(m.display, () => inEntry(m.container))
      const wrong = (item.spec.trials[trial] ?? []).map((d) => (d % 9) + 1)
      for (const d of wrong) press(String(d))
      click(buttonByText(m.container, 'Done'))
    }
    expect(m.responses).toHaveLength(1)
    expect(m.responses[0]).toHaveLength(2)
    expect(spanFwd.score(item, m.responses[0] as SpanResponse).observation).toMatchObject({ y: 0 })
  })

  it('a held key (auto-repeat) enters its digit once', () => {
    const item = spanFwd.generate('render-span-repeat')
    const m = mountSpan(item, DigitSpanRenderer)
    click(buttonByText(m.container, 'Start'))
    until(m.display, () => inEntry(m.container))
    press('6')
    press('6', null, { repeat: true })
    press('6', null, { repeat: true })
    expect([...m.container.querySelectorAll('.slot')].map((s) => s.textContent)).toEqual(['6', '', ''])
    press('Enter', null, { repeat: true })
    expect(m.container.textContent).not.toMatch(/Next sequence coming up/)
  })

  it('ignores keys meant for another element outside the renderer', () => {
    const item = spanFwd.generate('render-span-own-keys')
    const m = mountSpan(item, DigitSpanRenderer)
    click(buttonByText(m.container, 'Start'))
    until(m.display, () => inEntry(m.container))
    const outside = document.createElement('input')
    document.body.appendChild(outside)
    cleanup.push(() => outside.remove())
    press('5', outside)
    expect([...m.container.querySelectorAll('.slot')].map((s) => s.textContent)).toEqual(['', '', ''])
  })

  it('keeps one polite status line mounted from the start, empty until the block begins, so each phase is announced as a change (UX-022)', () => {
    const item = spanFwd.generate('render-span-status')
    const m = mountSpan(item, DigitSpanRenderer)
    const status = m.container.querySelector('.hb-status')
    expect(status).not.toBeNull()
    expect(status?.getAttribute('aria-live')).toBe('polite')
    expect(status?.textContent?.trim()).toBe('')
    click(buttonByText(m.container, 'Start'))
    expect(m.container.querySelector('.hb-status')).toBe(status)
    expect(status?.textContent?.trim()).toBe('Watch the digits.')
    expect(m.container.querySelectorAll('.hb-status')).toHaveLength(1)
    until(m.display, () => inEntry(m.container))
    expect(m.container.querySelector('.hb-status')).toBe(status)
    expect(status?.textContent?.trim()).toBe(`Enter ${item.spec.trials[0]?.length} digits.`)
    expect(status?.querySelector('span')?.getAttribute('translate')).toBe('no')
  })

  it('names the stage that takes focus, forward and backward, and focuses it without scrolling the keypad away (UX-002, UX-022)', () => {
    const scrolled = vi.fn()
    const had = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrolled, configurable: true, writable: true })
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    try {
      for (const [family, name] of [
        [spanFwd, 'Digits: watch them, then type them in order'],
        [spanBwd, 'Digits: watch them, then type them in reverse order'],
      ] as const) {
        const m = mountSpan(family.generate(`render-span-stage-${name.length}`), DigitSpanRenderer)
        click(buttonByText(m.container, 'Start'))
        const stage = m.container.querySelector('.stage')
        expect(stage?.getAttribute('role')).toBe('group')
        expect(stage?.getAttribute('aria-label')).toBe(name)
        expect(document.activeElement).toBe(stage)
        const call = focus.mock.contexts.indexOf(stage as HTMLElement)
        expect(focus.mock.calls[call]?.[0]).toEqual({ preventScroll: true })
        expect(scrolled).toHaveBeenLastCalledWith({ block: 'nearest' })
        expect(scrolled.mock.contexts.at(-1)).toBe(stage)
        m.destroy()
      }
    } finally {
      focus.mockRestore()
      if (had) Object.defineProperty(Element.prototype, 'scrollIntoView', had)
      else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('tells the taker that Enter finishes a sequence and Backspace removes a digit, and says the same of both directions (UX-025)', () => {
    for (const [family, direction] of [
      [spanFwd, /same order/],
      [spanBwd, /reverse order/],
    ] as const) {
      const m = mountSpan(family.generate('render-span-copy'), DigitSpanRenderer)
      const text = m.container.querySelector('.hb-instructions')?.textContent?.replace(/\s+/g, ' ') ?? ''
      expect(text).toMatch(direction)
      expect(text).toContain('Press Enter when you are done; Backspace removes the last digit.')
      expect(text).toContain('then choose Done')
      expect(text).toContain('The sequences get longer step by step.')
      m.destroy()
    }
  })

  it('matches its snapshots (intro and entry)', () => {
    const item = spanBwd.generate('render-span-snap')
    const m = mountSpan(item, DigitSpanRenderer)
    expect(normalizeIds(m.container)).toMatchSnapshot()
    click(buttonByText(m.container, 'Start'))
    until(m.display, () => inEntry(m.container))
    expect(normalizeIds(m.container)).toMatchSnapshot()
  })
})

describe('CorsiRenderer', () => {
  it('places the 9 blocks by their centres at the fixed board coordinates, numbered in board order', () => {
    const item = corsi.generate('render-corsi-board')
    const m = mountSpan(item, CorsiRenderer)
    click(buttonByText(m.container, 'Start'))
    const board = item.spec.board
    expect(board).toBeDefined()
    const blocks = [...m.container.querySelectorAll<HTMLButtonElement>('button.block')]
    expect(blocks).toHaveLength(9)
    blocks.forEach((b, i) => {
      const [x, y] = board?.blocks[i] ?? [0, 0]
      const s = board?.size ?? 0
      // The centre is the coordinate; the CSS centres the block on it and never draws it under 2.75rem.
      expect(parseFloat(b.style.getPropertyValue('--x'))).toBeCloseTo(x * 100, 6)
      expect(parseFloat(b.style.getPropertyValue('--y'))).toBeCloseTo(y * 100, 6)
      expect(parseFloat(b.style.getPropertyValue('--s'))).toBeCloseTo(s * 100, 6)
      expect(b.getAttribute('aria-label')).toBe(`Block ${i + 1}`)
    })
  })

  it('keeps one polite status line mounted from the start, empty until the block begins; its counts are not translated (UX-022)', () => {
    const item = corsi.generate('render-corsi-status')
    const m = mountSpan(item, CorsiRenderer)
    const status = m.container.querySelector('.hb-status')
    expect(status?.getAttribute('aria-live')).toBe('polite')
    expect(status?.textContent?.trim()).toBe('')
    click(buttonByText(m.container, 'Start'))
    expect(m.container.querySelector('.hb-status')).toBe(status)
    expect(status?.textContent?.trim()).toBe('Watch the blocks.')
    until(m.display, () => inEntry(m.container))
    expect(m.container.querySelector('.hb-status')).toBe(status)
    expect(status?.textContent?.trim()).toBe(`Selected 0 of ${item.spec.trials[0]?.length}.`)
    expect([...(status?.querySelectorAll('span') ?? [])].map((x) => x.getAttribute('translate'))).toEqual(['no', 'no'])
    expect(m.container.querySelectorAll('.hb-status')).toHaveLength(1)
  })

  it('lights each block of the sequence in order, one at a time', () => {
    const item = corsi.generate('render-corsi-lit')
    const m = mountSpan(item, CorsiRenderer)
    click(buttonByText(m.container, 'Start'))
    const seen: number[] = []
    let last = -1
    until(m.display, () => {
      const lit = [...m.container.querySelectorAll('button.block')].findIndex((b) => b.classList.contains('lit'))
      expect(m.container.querySelectorAll('button.block.lit').length).toBeLessThanOrEqual(1)
      if (lit !== last && lit >= 0) seen.push(lit)
      last = lit
      return inEntry(m.container)
    })
    expect(seen).toEqual(item.spec.trials[0])
  })

  it('number keys, arrow keys + Enter (click) and clicks all pick blocks; the full block scores the top category', () => {
    const item = corsi.generate('render-corsi-full')
    const m = mountSpan(item, CorsiRenderer)
    click(buttonByText(m.container, 'Start'))
    const targets = spanTargets(item.spec)
    for (let trial = 0; trial < targets.length; trial++) {
      until(m.display, () => inEntry(m.container))
      const seq = targets[trial] ?? []
      seq.forEach((b, k) => {
        if (k % 2 === 0) press(String(b + 1))
        else click(m.container.querySelectorAll('button.block')[b])
      })
      click(buttonByText(m.container, 'Done'))
    }
    expect(m.responses[0]).toEqual(targets)
    expect(corsi.score(item, m.responses[0] as SpanResponse).observation).toMatchObject({ kind: 'grm', y: 8 })
  })

  it('a held number key picks its block once; held arrows still move', () => {
    const item = corsi.generate('render-corsi-repeat')
    const m = mountSpan(item, CorsiRenderer)
    click(buttonByText(m.container, 'Start'))
    until(m.display, () => inEntry(m.container))
    press('4')
    press('4', null, { repeat: true })
    expect(m.container.textContent).toContain('Selected 1 of 3.')
    const blocks = [...m.container.querySelectorAll<HTMLButtonElement>('button.block')]
    const board = item.spec.board?.blocks ?? []
    press('ArrowRight', null, { repeat: true })
    expect(document.activeElement).toBe(blocks[nearestInDirection(board, 3, 'right')])
  })

  it('names the blocks by number for screen readers, draws no numbers, and says so accurately', () => {
    const m = mountSpan(corsi.generate('render-corsi-copy'), CorsiRenderer)
    const intro = m.container.querySelector('.hb-instructions')?.textContent ?? ''
    expect(intro).not.toMatch(/from the top/)
    expect(intro).toMatch(/screen reader/)
    click(buttonByText(m.container, 'Start'))
    const blocks = [...m.container.querySelectorAll<HTMLButtonElement>('button.block')]
    expect(blocks.map((b) => b.getAttribute('aria-label'))).toEqual(blocks.map((_, i) => `Block ${i + 1}`))
    expect(blocks.every((b) => (b.textContent ?? '').trim() === '')).toBe(true)
  })

  it('arrow keys move focus to the nearest block that way', () => {
    const item = corsi.generate('render-corsi-arrows')
    const m = mountSpan(item, CorsiRenderer)
    click(buttonByText(m.container, 'Start'))
    until(m.display, () => inEntry(m.container))
    const blocks = [...m.container.querySelectorAll<HTMLButtonElement>('button.block')]
    expect(document.activeElement).toBe(blocks[0])
    const board = item.spec.board?.blocks ?? []
    press('ArrowRight')
    expect(document.activeElement).toBe(blocks[nearestInDirection(board, 0, 'right')])
    press('ArrowDown')
    expect(blocks.filter((b) => b.tabIndex === 0)).toHaveLength(1)
  })

  it('keeps the row of Undo and Done mounted for the whole block, with the buttons only while the taker enters, so the page is as tall after Done as before it (UX-023)', () => {
    const item = corsi.generate('render-corsi-slot')
    const m = mountSpan(item, CorsiRenderer)
    expect(m.container.querySelector('.hb-actions')).toBeNull()
    click(buttonByText(m.container, 'Start'))
    const slot = m.container.querySelector('.hb-actions')
    const labels = (): string[] => [...(slot?.querySelectorAll('button') ?? [])].map((b) => b.textContent?.trim() ?? '')
    expect(slot).not.toBeNull()
    expect(m.container.querySelectorAll('.hb-actions')).toHaveLength(1)
    // While the sequence plays there is a place for the buttons and no button (Done does not exist yet).
    expect(labels()).toEqual([])
    // The row sits under the board and the status line, in the same place in every phase.
    expect([...m.container.querySelector('section')!.children].at(-1)).toBe(slot)
    const targets = spanTargets(item.spec)
    for (let trial = 0; trial < targets.length; trial++) {
      until(m.display, () => inEntry(m.container))
      expect(m.container.querySelector('.hb-actions')).toBe(slot)
      expect(labels()).toEqual(['Undo', 'Done'])
      for (const b of targets[trial] ?? []) press(String(b + 1))
      click(buttonByText(m.container, 'Done'))
      // Done is gone, its row is not: the next sequence plays on a page of the same height.
      expect(m.container.querySelector('.hb-actions')).toBe(slot)
      expect(labels()).toEqual([])
    }
    expect(m.container.textContent).toContain('Block complete')
    expect(m.container.querySelector('.hb-actions')).toBe(slot)
  })

  it('the board is never narrower than the least width that holds nine 2.75rem blocks inside it without touching, whatever the screen height (UX-023)', () => {
    const css = corsiSource.slice(corsiSource.indexOf('<style>'))
    // The floor of the board's width, in both its vh and svh declarations.
    const floors = [...css.matchAll(/width: min\(100%, max\((\d+(?:\.\d+)?)rem, min\(26rem, 52s?vh, 100s?vh - 20rem\)\)\);/g)].map((x) => Number(x[1]))
    expect(floors).toEqual([14, 14])
    const BORDER = 4 // 2px on each side; the blocks are placed in the padding box
    const BLOCK = 2.75 * 16
    /** Whether nine blocks, placed by their centres on a board `rem` wide, lie inside it and keep apart. */
    const holds = (rem: number): boolean => {
      const inner = rem * 16 - BORDER
      const side = Math.max(CORSI_BOARD.size * inner, BLOCK)
      const inside = CORSI_BOARD.blocks.every(([x, y]) => [x, y].every((c) => c * inner - side / 2 >= 0 && c * inner + side / 2 <= inner))
      const apart = CORSI_BOARD.blocks.every(([x, y], i) => CORSI_BOARD.blocks.every(([u, v], j) => j <= i || Math.max(Math.abs(x - u), Math.abs(y - v)) * inner > side))
      return inside && apart
    }
    expect(holds(floors[0] as number)).toBe(true)
    // The floor is the least, to the rem: a rem narrower, some block is outside the board or touches another.
    expect(holds((floors[0] as number) - 1)).toBe(false)
    // The cap above it never lets the floor grow past the board's own page width: the page's 100% wins.
    expect(css).toMatch(/width: min\(100%, max\(/)
  })

  it('matches its snapshot (entry)', () => {
    const item = corsi.generate('render-corsi-snap')
    const m = mountSpan(item, CorsiRenderer)
    click(buttonByText(m.container, 'Start'))
    until(m.display, () => inEntry(m.container))
    expect(normalizeIds(m.container)).toMatchSnapshot()
  })
})
