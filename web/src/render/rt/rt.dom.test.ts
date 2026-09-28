/**
 * RT renderer (ROADMAP M1.10, M1.13, A10; DESIGN §7.1, §11.6, §13): the target appears in the first
 * frame at or after trial start + foreperiod, RT = performance.now() at the press − that frame's
 * timestamp, early presses are anticipations (negative RT), silence is a miss, choice keys map to
 * positions, touch mode taps positions, practice trials come first, and the response is a
 * well-formed `RtResponse` that the family's score() turns into its observation; plus snapshots.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { rtChoice4, rtResponseProblems, rtSimple, type RtItem } from '../../tasks/rt'
import type { RtResponse } from '../../tasks/rt/types'
import { normalizeIds } from '../common/leak'
import { buttonByText, click, fakeDisplay, pointerDown, press, render, type FakeDisplay } from '../common/testing'
import { CHOICE_KEYS, RT_EARLY_ITI_MS, RT_ITI_MS, positionOfKey, responseWindowMs, type RtInputMode } from './keys'
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
  const props: Record<string, unknown> = { spec: item.spec, onrespond: (x: RtResponse) => responses.push(x), timing: display, oninputmode: (m: RtInputMode) => modes.push(m) }
  if (inputMode) props.inputMode = inputMode
  const r = render(RtRenderer, props as never)
  cleanup.push(r.destroy)
  return { ...r, display, responses, modes }
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
