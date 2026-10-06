/**
 * RT renderer (ROADMAP M1.10, M1.13, A10; DESIGN §7.1, §11.6, §13): the target appears in the first
 * frame at or after trial start + foreperiod, RT = performance.now() at the press − that frame's
 * timestamp, early presses are anticipations (negative RT), silence is a miss, choice keys map to
 * positions, touch mode taps positions, practice trials come first, and the response is a
 * well-formed `RtResponse` that the family's score() turns into its observation; plus snapshots.
 */

import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rtChoice4, rtResponseProblems, rtSimple, type RtItem } from '../../tasks/rt'
import type { RtResponse } from '../../tasks/rt/types'
import { normalizeIds } from '../common/leak'
import { buttonByText, click, fakeDisplay, pointerDown, press, render, type FakeDisplay } from '../common/testing'
import { CHOICE_KEYS, RT_EARLY_ITI_MS, RT_ITI_MS, pointerInputType, positionOfKey, responseWindowMs, type RtInputMode, type RtInputType } from './keys'
import RtRenderer from './RtRenderer.svelte'

const FRAME = 1000 / 60

let cleanup: (() => void)[] = []
afterEach(() => {
  for (const f of cleanup) f()
  cleanup = []
})

function mountRt(item: RtItem, inputMode?: RtInputMode) {
  const display = fakeDisplay()
  const responses: RtResponse[] = []
  const modes: RtInputMode[] = []
  const types: RtInputType[] = []
  const sources: string[] = []
  const reasons: (string | undefined)[] = []
  /** Callback order: 'type' (oninputtype) must come before 'respond'. */
  const calls: string[] = []
  const props: Record<string, unknown> = {
    spec: item.spec,
    onrespond: (x: RtResponse) => (calls.push('respond'), responses.push(x)),
    timing: display,
    oninputmode: (m: RtInputMode) => modes.push(m),
    oninputtype: (x: RtInputType) => (calls.push('type'), types.push(x)),
    ontimestampsource: (s: string, reason?: string) => (calls.push('source'), sources.push(s), reasons.push(reason)),
  }
  if (inputMode) props.inputMode = inputMode
  const r = render(RtRenderer, props as never)
  cleanup.push(r.destroy)
  return { ...r, display, responses, modes, types, sources, reasons, calls }
}

const stimulusOn = (root: HTMLElement): boolean => root.querySelector('.pad.on') !== null
const fixationOn = (root: HTMLElement): boolean => (root.querySelector('.fixation')?.textContent ?? '') === '+'

function until(display: FakeDisplay, pred: () => boolean, maxMs = 10_000): void {
  let t = 0
  while (!pred()) {
    if (t > maxMs) throw new Error('condition not reached')
    display.advance(FRAME)
    t += FRAME
  }
}

/** Run one trial answered `rtMs` after onset with `key`; returns the onset frame time. */
function answerTrial(m: ReturnType<typeof mountRt>, key: string | null, rtMs: number): number {
  until(m.display, () => stimulusOn(m.container))
  const onsetTs = m.display.now()
  if (key !== null) {
    m.display.advance(rtMs)
    press(key)
  }
  return onsetTs
}

/** Run a whole tap-or-click block, each response a pointerdown of `pointerTypes(stage, i)` 300 ms after onset. */
function tapBlock(m: ReturnType<typeof mountRt>, item: RtItem, pointerTypes: (practice: boolean, i: number) => string | undefined): RtResponse {
  click(buttonByText(m.container, 'Start practice'))
  for (const practice of [true, false]) {
    const pos = practice ? item.spec.practice_positions : item.spec.positions
    for (let i = 0; i < pos.length; i++) {
      until(m.display, () => stimulusOn(m.container))
      m.display.advance(300)
      pointerDown(m.container.querySelectorAll('button.pad')[pos[i] ?? 0], pointerTypes(practice, i))
    }
    if (practice) {
      until(m.display, () => m.container.textContent?.includes('Practice done') === true)
      click(buttonByText(m.container, 'Start'))
    }
  }
  until(m.display, () => m.responses.length === 1, 20_000)
  return m.responses[0] as RtResponse
}

function keyFor(item: RtItem, practice: boolean, i: number): string {
  const p = (practice ? item.spec.practice_positions : item.spec.positions)[i] ?? 0
  return item.spec.mode === 'simple' ? ' ' : (CHOICE_KEYS[p]?.[0] ?? 'd')
}

describe('RtRenderer', () => {
  it('maps keys to positions (Space; D F J K and 1–4)', () => {
    expect(positionOfKey('simple', ' ')).toBe(0)
    expect(positionOfKey('simple', 'd')).toBeNull()
    expect(['d', 'F', 'j', 'K', '1', '4'].map((k) => positionOfKey('choice4', k))).toEqual([0, 1, 2, 3, 0, 3])
    expect(positionOfKey('choice4', ' ')).toBeNull()
  })

  it('draws the target in the first frame at or after trial start + foreperiod, and measures RT from that frame', () => {
    const item = rtSimple.generate('render-rt-onset')
    const m = mountRt(item, 'keyboard')
    click(buttonByText(m.container, 'Start practice'))
    expect(m.modes).toEqual(['keyboard'])
    // The trial starts in the next frame (the fixation frame).
    const t0 = m.display.now()
    until(m.display, () => fixationOn(m.container))
    const trialStart = t0 + FRAME
    const fp = item.spec.practice_foreperiods_ms[0] ?? 0
    until(m.display, () => stimulusOn(m.container))
    expect(m.display.now()).toBeGreaterThanOrEqual(trialStart + fp - 1e-6)
    expect(m.display.now()).toBeLessThan(trialStart + fp + FRAME + 1e-6)
  })

  it('stamps a key response with the event timestamp: RT = timeStamp − onset, not handler time − onset', () => {
    const item = rtSimple.generate('render-rt-evts')
    const m = mountRt(item, 'keyboard')
    click(buttonByText(m.container, 'Start practice'))
    until(m.display, () => stimulusOn(m.container))
    const onsetTs = m.display.now()
    m.display.advance(300) // the handler runs 300 ms after onset...
    press(' ', null, {}, onsetTs + 290) // ...for an event the browser stamped 290 ms after onset (10 ms dispatch lag)
    for (let i = 1; i < item.spec.practice_positions.length; i++) answerTrial(m, ' ', 300)
    until(m.display, () => m.container.textContent?.includes('Practice done') === true)
    click(buttonByText(m.container, 'Start'))
    for (let i = 0; i < item.spec.positions.length; i++) {
      until(m.display, () => stimulusOn(m.container))
      const on = m.display.now()
      m.display.advance(330)
      press(' ', null, {}, on + 320)
    }
    until(m.display, () => m.responses.length === 1, 20_000)
    const r = m.responses[0] as RtResponse
    expect(r.practice_rt_ms?.[0]).toBeCloseTo(290, 6)
    expect(r.practice_rt_ms?.[1]).toBeCloseTo(300, 6) // a synthetic event without a usable timeStamp falls back to the handler clock
    for (const rt of r.rt_ms) expect(rt).toBeCloseTo(320, 6)
    expect(m.sources).toEqual(['event'])
    expect(m.calls.slice(-3)).toEqual(['type', 'source', 'respond'])
  })

  it('falls back to the handler clock, and says so, when the event timestamp is unusable (zero, future)', () => {
    const item = rtSimple.generate('render-rt-evfallback')
    const m = mountRt(item, 'keyboard')
    click(buttonByText(m.container, 'Start practice'))
    for (let i = 0; i < item.spec.practice_positions.length; i++) answerTrial(m, ' ', 300)
    until(m.display, () => m.container.textContent?.includes('Practice done') === true)
    click(buttonByText(m.container, 'Start'))
    for (let i = 0; i < item.spec.positions.length; i++) {
      until(m.display, () => stimulusOn(m.container))
      const on = m.display.now()
      m.display.advance(300)
      press(' ', null, {}, i % 2 === 0 ? 0 : on + 99_999)
    }
    until(m.display, () => m.responses.length === 1, 20_000)
    for (const rt of (m.responses[0] as RtResponse).rt_ms) expect(rt).toBeCloseTo(300, 6)
    expect(m.sources).toEqual(['handler'])
  })

  /** A practice + main block where every key event is stamped `lagMs` before its handler (null = main events carry `mainLagMs`). */
  function runLagBlock(seed: string, practiceLag: number, mainLag: (i: number) => number) {
    const item = rtSimple.generate(seed)
    const m = mountRt(item, 'keyboard')
    click(buttonByText(m.container, 'Start practice'))
    for (let i = 0; i < item.spec.practice_positions.length; i++) {
      until(m.display, () => stimulusOn(m.container))
      m.display.advance(300)
      press(' ', null, {}, m.display.now() - practiceLag)
    }
    until(m.display, () => m.container.textContent?.includes('Practice done') === true)
    click(buttonByText(m.container, 'Start'))
    for (let i = 0; i < item.spec.positions.length; i++) {
      until(m.display, () => stimulusOn(m.container))
      const on = m.display.now()
      m.display.advance(300)
      press(' ', null, {}, m.display.now() - mainLag(i))
      void on
    }
    until(m.display, () => m.responses.length === 1, 20_000)
    return { m, r: m.responses[0] as RtResponse }
  }

  it('a constant 205 ms event offset (Safari) switches the whole block to the handler clock, with the reason', () => {
    const { m, r } = runLagBlock('render-rt-offset', 205, (i) => (i === 1 ? 3 : 205 + (i % 3)))
    for (const rt of r.rt_ms) expect(rt).toBeCloseTo(300, 6) // not ~95: the event clock is ignored, even for the 3 ms-lag event
    for (const rt of r.practice_rt_ms ?? []) expect(rt).toBeCloseTo(300, 6)
    expect(m.sources).toEqual(['handler'])
    expect(m.reasons).toEqual(['event_clock_offset'])
  })

  it('a consistent event clock (3 ms lag) is used for the block, without a reason; one late dispatch stays on the event clock', () => {
    const { m, r } = runLagBlock('render-rt-consistent', 3, (i) => (i === 0 ? 60 : 3))
    for (const [i, rt] of r.rt_ms.entries()) expect(rt, String(i)).toBeCloseTo(i === 0 ? 240 : 297, 6)
    expect(m.sources).toEqual(['event'])
    expect(m.reasons).toEqual([undefined])
  })

  it('an undecided block (no usable practice timestamps) applies the per-response rule and reports mixed', () => {
    const item = rtSimple.generate('render-rt-undecided')
    const m = mountRt(item, 'keyboard')
    click(buttonByText(m.container, 'Start practice'))
    for (let i = 0; i < item.spec.practice_positions.length; i++) answerTrial(m, ' ', 300) // synthetic timeStamp 0
    until(m.display, () => m.container.textContent?.includes('Practice done') === true)
    click(buttonByText(m.container, 'Start'))
    for (let i = 0; i < item.spec.positions.length; i++) {
      until(m.display, () => stimulusOn(m.container))
      m.display.advance(300)
      press(' ', null, {}, i % 2 === 0 ? m.display.now() - 4 : 0)
    }
    until(m.display, () => m.responses.length === 1, 20_000)
    expect(m.sources).toEqual(['mixed'])
  })

  it('stamps a pointer response with the event timestamp too', () => {
    const item = rtSimple.generate('render-rt-evptr')
    const m = mountRt(item, 'touch')
    click(buttonByText(m.container, 'Start practice'))
    until(m.display, () => stimulusOn(m.container))
    const onsetTs = m.display.now()
    m.display.advance(190)
    pointerDown(m.container.querySelector('button.pad'), 'touch', onsetTs + 180)
    for (let i = 1; i < item.spec.practice_positions.length; i++) {
      until(m.display, () => stimulusOn(m.container))
      m.display.advance(300)
      pointerDown(m.container.querySelector('button.pad'), 'touch')
    }
    until(m.display, () => m.container.textContent?.includes('Practice done') === true)
    click(buttonByText(m.container, 'Start'))
    for (let i = 0; i < item.spec.positions.length; i++) {
      until(m.display, () => stimulusOn(m.container))
      m.display.advance(300)
      pointerDown(m.container.querySelector('button.pad'), 'touch')
    }
    until(m.display, () => m.responses.length === 1, 20_000)
    expect((m.responses[0] as RtResponse).practice_rt_ms?.[0]).toBeCloseTo(180, 6)
    expect(m.sources).toEqual(['handler'])
  })

  it('runs 3 practice trials then the scored trials; RTs, anticipations and misses are recorded and score()d', () => {
    const item = rtSimple.generate('render-rt-full')
    const m = mountRt(item, 'keyboard')
    click(buttonByText(m.container, 'Start practice'))
    for (let i = 0; i < item.spec.practice_positions.length; i++) answerTrial(m, ' ', 300)
    until(m.display, () => m.container.textContent?.includes('Practice done') === true)
    click(buttonByText(m.container, 'Start'))
    const n = item.spec.positions.length
    for (let i = 0; i < n; i++) {
      if (i === 3) {
        // An early press: during the fixation, before the target.
        until(m.display, () => fixationOn(m.container))
        m.display.advance(200)
        press(' ')
        expect(m.container.querySelector('.hb-status')?.textContent).toMatch(/Too early/)
        continue
      }
      if (i === 5) {
        answerTrial(m, null, 0)
        until(m.display, () => !stimulusOn(m.container))
        continue
      }
      answerTrial(m, keyFor(item, false, i), 250 + 10 * i)
    }
    until(m.display, () => m.responses.length === 1, 20_000)
    const r = m.responses[0] as RtResponse
    expect(rtResponseProblems('simple', r)).toEqual([])
    expect(r.practice_rt_ms).toHaveLength(3)
    for (const rt of r.practice_rt_ms ?? []) expect(rt).toBeCloseTo(300, 6)
    expect(r.rt_ms[3]).toBeLessThan(0)
    expect(r.rt_ms[5]).toBeNull()
    expect(r.choice[5]).toBeNull()
    expect(r.rt_ms[0]).toBeCloseTo(250, 6)
    expect(r.rt_ms[10]).toBeCloseTo(350, 6)
    const obs = rtSimple.score(item, r).observation
    expect(obs?.kind).toBe('gaussian')
    expect(obs?.kind === 'gaussian' ? obs.x : Number.NaN).toBeCloseTo(median(r.rt_ms.filter((x): x is number => x !== null && x > 0).map(Math.log)), 6)
  })

  it('keeps one polite status line and, when the block ends, focus on it inside the renderer (WCAG 2.4.3, 4.1.3)', () => {
    for (const [gen, seed] of [[rtSimple, 'render-rt-focus-s'], [rtChoice4, 'render-rt-focus-c']] as const) {
      const item = gen.generate(seed)
      const m = mountRt(item, 'keyboard')
      const status = m.container.querySelector('.hb-status')
      expect(status?.getAttribute('aria-live')).toBe('polite')
      click(buttonByText(m.container, 'Start practice'))
      for (let i = 0; i < item.spec.practice_positions.length; i++) answerTrial(m, keyFor(item, true, i), 300)
      until(m.display, () => m.container.textContent?.includes('Practice done') === true)
      expect(m.container.querySelector('.hb-status')).toBe(status)
      click(buttonByText(m.container, 'Start'))
      expect(document.activeElement?.classList.contains('stage')).toBe(true)
      for (let i = 0; i < item.spec.positions.length; i++) answerTrial(m, keyFor(item, false, i), 300)
      until(m.display, () => m.responses.length === 1, 20_000)
      expect(m.container.querySelector('.hb-status')).toBe(status)
      expect(status?.textContent).toBe('Block complete. Thank you.')
      expect(document.activeElement).toBe(status)
      expect(m.container.contains(document.activeElement)).toBe(true)
      m.destroy()
    }
  })

  it('a missing response ends the trial after the response window', () => {
    const item = rtSimple.generate('render-rt-miss')
    const m = mountRt(item, 'keyboard')
    click(buttonByText(m.container, 'Start practice'))
    until(m.display, () => stimulusOn(m.container))
    const onset = m.display.now()
    until(m.display, () => !stimulusOn(m.container))
    expect(m.display.now() - onset).toBeGreaterThanOrEqual(responseWindowMs('simple') - 1e-6)
    expect(m.display.now() - onset).toBeLessThan(responseWindowMs('simple') + FRAME + 1e-6)
    expect(m.container.querySelector('.hb-status')?.textContent).toMatch(/No response/)
  })

  it('choice4 keyboard: the key pressed is the choice; wrong positions are errors', () => {
    const item = rtChoice4.generate('render-rt-choice')
    const m = mountRt(item, 'keyboard')
    click(buttonByText(m.container, 'Start practice'))
    for (let i = 0; i < 3; i++) answerTrial(m, keyFor(item, true, i), 400)
    until(m.display, () => m.container.textContent?.includes('Practice done') === true)
    click(buttonByText(m.container, 'Start'))
    const n = item.spec.positions.length
    for (let i = 0; i < n; i++) {
      const p = item.spec.positions[i] ?? 0
      const key = i === 7 ? (CHOICE_KEYS[(p + 1) % 4]?.[1] ?? '1') : keyFor(item, false, i)
      answerTrial(m, key, 450)
    }
    until(m.display, () => m.responses.length === 1, 20_000)
    const r = m.responses[0] as RtResponse
    expect(rtResponseProblems('choice4', r)).toEqual([])
    expect(r.choice.filter((c, i) => c !== item.spec.positions[i])).toHaveLength(1)
    expect(r.choice[7]).toBe(((item.spec.positions[7] ?? 0) + 1) % 4)
    expect(rtChoice4.score(item, r).observation?.kind).toBe('gaussian')
  })

  it('touch mode: tapping a position responds, keys do nothing', () => {
    const item = rtChoice4.generate('render-rt-touch')
    const m = mountRt(item, 'touch')
    click(buttonByText(m.container, 'Start practice'))
    until(m.display, () => stimulusOn(m.container))
    press('d')
    expect(stimulusOn(m.container)).toBe(true)
    m.display.advance(320)
    const p = item.spec.practice_positions[0] ?? 0
    pointerDown(m.container.querySelectorAll('button.pad')[p])
    expect(stimulusOn(m.container)).toBe(false)
    expect(m.container.querySelector('.hb-status')?.textContent).toBe('320 ms')
  })

  it('pointerInputType: mouse iff most responses were mouse; pen, unknown and ties count as touch (property)', () => {
    expect(pointerInputType([], 'mouse')).toBe('mouse')
    expect(pointerInputType([], 'touch')).toBe('touch')
    expect(pointerInputType(['mouse', 'mouse'], 'touch')).toBe('mouse')
    expect(pointerInputType(['touch'], 'mouse')).toBe('touch')
    expect(pointerInputType(['pen', ''], 'mouse')).toBe('touch')
    expect(pointerInputType(['mouse', 'touch'], 'mouse')).toBe('touch')
    fc.assert(
      fc.property(fc.array(fc.constantFrom('mouse', 'touch', 'pen', ''), { minLength: 1, maxLength: 60 }), fc.constantFrom<'mouse' | 'touch'>('mouse', 'touch'), (types, fallback) => {
        const mice = types.filter((t) => t === 'mouse').length
        expect(pointerInputType(types, fallback)).toBe(2 * mice > types.length ? 'mouse' : 'touch')
      }),
    )
  })

  it('reports the input type the responses came from, before the response (§11.6: mouse is not touch)', () => {
    const item = rtSimple.generate('render-rt-input-type')
    const mouse = mountRt(item, 'touch')
    const r = tapBlock(mouse, item, () => 'mouse')
    expect(rtResponseProblems('simple', r)).toEqual([])
    expect(mouse.modes).toEqual(['touch'])
    expect(mouse.types).toEqual(['mouse'])
    expect(mouse.calls).toEqual(['type', 'source', 'respond'])
    mouse.destroy()
    // Scored taps decide: practice with a mouse, then fingers.
    const touch = mountRt(item, 'touch')
    tapBlock(touch, item, (practice) => (practice ? 'mouse' : 'touch'))
    expect(touch.types).toEqual(['touch'])
    touch.destroy()
    const keys = mountRt(item, 'keyboard')
    click(buttonByText(keys.container, 'Start practice'))
    for (let i = 0; i < item.spec.practice_positions.length; i++) answerTrial(keys, ' ', 300)
    until(keys.display, () => keys.container.textContent?.includes('Practice done') === true)
    click(buttonByText(keys.container, 'Start'))
    for (let i = 0; i < item.spec.positions.length; i++) answerTrial(keys, ' ', 300)
    until(keys.display, () => keys.responses.length === 1, 20_000)
    expect(keys.types).toEqual(['keyboard'])
  })

  it('the taker picks the input mode on the intro when none is given', () => {
    const item = rtSimple.generate('render-rt-mode')
    const m = mountRt(item)
    const radios = [...m.container.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    expect(radios.map((r) => r.value)).toEqual(['keyboard', 'touch'])
    click(radios[1])
    click(buttonByText(m.container, 'Start practice'))
    expect(m.modes).toEqual(['touch'])
    expect(m.container.querySelectorAll('button.pad')).toHaveLength(1)
  })

  it('waits longer after an early press than after a response', () => {
    expect(RT_EARLY_ITI_MS).toBeGreaterThan(RT_ITI_MS)
  })

  it('titles the block by what is different about it, not by the session heading again (UX-026)', () => {
    expect(mountRt(rtSimple.generate('render-rt-title')).container.querySelector('.title')?.textContent).toBe('One position')
    expect(mountRt(rtChoice4.generate('render-rt-title')).container.querySelector('.title')?.textContent).toBe('Four positions')
  })

  it('the stage that takes focus when the block starts is a named group, in each input mode (UX-022)', () => {
    const cases: [RtItem, RtInputMode, string][] = [
      [rtSimple.generate('render-rt-name-1'), 'keyboard', 'Reaction stage: press Space when the target appears'],
      [rtSimple.generate('render-rt-name-2'), 'touch', 'Reaction stage: tap the target when it appears'],
      [rtChoice4.generate('render-rt-name-3'), 'keyboard', 'Reaction stage: press D, F, J or K to match the position of the target'],
      [rtChoice4.generate('render-rt-name-4'), 'touch', 'Reaction stage: tap the position where the target appears'],
    ]
    for (const [item, mode, name] of cases) {
      const m = mountRt(item, mode)
      click(buttonByText(m.container, 'Start practice'))
      const stage = m.container.querySelector('.stage')
      expect(stage?.getAttribute('role'), name).toBe('group')
      expect(stage?.getAttribute('aria-label')).toBe(name)
      expect(document.activeElement).toBe(stage)
      m.destroy()
    }
  })

  it('focuses the stage without scrolling and then brings it into view only if needed (UX-002)', () => {
    const scrolled = vi.fn()
    const had = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrolled, configurable: true, writable: true })
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    try {
      const m = mountRt(rtSimple.generate('render-rt-scroll'), 'keyboard')
      click(buttonByText(m.container, 'Start practice'))
      const stage = m.container.querySelector('.stage')
      expect(focus.mock.calls[focus.mock.contexts.indexOf(stage as HTMLElement)]?.[0]).toEqual({ preventScroll: true })
      expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' })
      expect(scrolled.mock.contexts.at(-1)).toBe(stage)
    } finally {
      focus.mockRestore()
      if (had) Object.defineProperty(Element.prototype, 'scrollIntoView', had)
      else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('key names and trial counters are marked as not to be translated (UX-022), and the texts they sit in are unchanged', () => {
    const simple = mountRt(rtSimple.generate('render-rt-translate'), 'keyboard')
    expect([...simple.container.querySelectorAll('.hb-instructions kbd')].map((k) => [k.textContent, k.getAttribute('translate')])).toEqual([['Space', 'no']])
    expect(simple.container.querySelector('.hb-instructions')?.textContent?.replace(/\s+/g, ' ')).toContain('press the Space bar.')
    const four = mountRt(rtChoice4.generate('render-rt-translate'), 'keyboard')
    expect([...four.container.querySelectorAll('.hb-instructions kbd')].map((k) => k.textContent)).toEqual(['D', 'F', 'J', 'K', '1', '4'])
    expect(four.container.querySelector('.hb-instructions')?.textContent?.replace(/\s+/g, ' ')).toContain('press D, F, J or K (or 1 to 4) for the positions from left to right.')
    click(buttonByText(simple.container, 'Start practice'))
    const progress = simple.container.querySelector('.progress')
    expect(progress?.textContent).toBe('Practice 1 of 3')
    expect([...(progress?.querySelectorAll('span') ?? [])].map((x) => x.getAttribute('translate'))).toEqual(['no', 'no'])
  })

  it('draws the fixation cross over the pads, not in a row of its own, and the target replaces it in the same frame (D12)', () => {
    for (const [item, mode] of [[rtSimple.generate('render-rt-fix'), 'keyboard'], [rtChoice4.generate('render-rt-fix'), 'touch']] as const) {
      const m = mountRt(item, mode)
      click(buttonByText(m.container, 'Start practice'))
      until(m.display, () => fixationOn(m.container))
      const fixation = m.container.querySelector('.fixation') as HTMLElement
      // A child of the pads (positioned over them by the style), so the stage has no row above the pads; nothing to hear or tap.
      expect(fixation.parentElement?.classList.contains('pads')).toBe(true)
      expect(fixation.getAttribute('aria-hidden')).toBe('true')
      expect([...(m.container.querySelector('.stage')?.children ?? [])].map((c) => c.className.replace(/\s*svelte-\w+/g, '').trim())).toEqual(
        mode === 'touch' ? ['pads'] : item.spec.mode === 'choice4' ? ['pads', 'keys'] : ['pads'],
      )
      expect(m.container.querySelectorAll('.pad')).toHaveLength(item.spec.n_positions)
      // In the frame that draws the target the cross is gone: they are never on screen together.
      until(m.display, () => stimulusOn(m.container))
      expect(fixation.textContent).toBe('')
      expect(fixationOn(m.container)).toBe(false)
    }
  })

  it('matches its snapshots (intro, choice4 fixation)', () => {
    const simple = mountRt(rtSimple.generate('render-rt-snap'))
    expect(normalizeIds(simple.container)).toMatchSnapshot()
    const m = mountRt(rtChoice4.generate('render-rt-snap'), 'keyboard')
    click(buttonByText(m.container, 'Start practice'))
    until(m.display, () => fixationOn(m.container))
    expect(normalizeIds(m.container)).toMatchSnapshot()
  })
})

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2
}
