/**
 * Span boards (ROADMAP M1.9, M1.13, A10; DESIGN §11.6, §14.6 ex. 10–11): rAF-locked presentation
 * at the spec's rate, keypad / keyboard / board entry, the family state machine drives the trials,
 * and the response scores with the family's score() to the expected GRM category; plus snapshots.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { corsi, spanBwd, spanFwd } from '../../tasks/span'
import type { SpanItem, SpanResponse } from '../../tasks/span/config'
import { normalizeIds } from '../common/leak'
import { buttonByText, click, fakeDisplay, press, render, type FakeDisplay } from '../common/testing'
import CorsiRenderer from './CorsiRenderer.svelte'
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
  it('places the 9 blocks at the fixed board coordinates, numbered in board order', () => {
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
      expect(parseFloat(b.style.left)).toBeCloseTo((x - s / 2) * 100, 6)
      expect(parseFloat(b.style.top)).toBeCloseTo((y - s / 2) * 100, 6)
      expect(b.getAttribute('aria-label')).toBe(`Block ${i + 1}`)
    })
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

  it('matches its snapshot (entry)', () => {
    const item = corsi.generate('render-corsi-snap')
    const m = mountSpan(item, CorsiRenderer)
    click(buttonByText(m.container, 'Start'))
    until(m.display, () => inEntry(m.container))
    expect(normalizeIds(m.container)).toMatchSnapshot()
  })
})
