import { flushSync } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buttonByText, click, render } from '../render/common/testing'
import ConfirmPanel from './ConfirmPanel.svelte'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function open(over: Record<string, unknown> = {}): { c: HTMLElement; yes: ReturnType<typeof vi.fn>; no: ReturnType<typeof vi.fn> } {
  const yes = vi.fn()
  const no = vi.fn()
  const r = render(ConfirmPanel, { heading: 'Skip Spatial?', text: 'It will show as not measured.', yes: 'Skip Spatial', no: 'Keep going', onyes: yes, onno: no, ...over })
  cleanup = r.destroy
  return { c: r.container, yes, no }
}

/** A touch or mouse press as the browser sends it first (jsdom has no PointerEvent). */
function press(target: Element, type: 'touch' | 'mouse', at: [number, number]): void {
  const ev = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: at[0], clientY: at[1] })
  Object.defineProperty(ev, 'pointerType', { value: type })
  target.dispatchEvent(ev)
  flushSync()
}

describe('ConfirmPanel (M1.15)', () => {
  it('takes focus on its heading and answers with its two buttons', () => {
    const { c, yes, no } = open()
    expect(document.activeElement).toBe(c.querySelector('h2'))
    click(buttonByText(c, 'Skip Spatial'))
    expect(yes).toHaveBeenCalledTimes(1)
    click(buttonByText(c, 'Keep going'))
    expect(no).toHaveBeenCalledTimes(1)
  })

  it('Escape does what "Keep going" does, and goes no further (a running block must not take it as a key) (UX-005a)', () => {
    const { c, yes, no } = open()
    const outside = vi.fn()
    window.addEventListener('keydown', outside)
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    c.querySelector('h2')!.dispatchEvent(esc)
    window.removeEventListener('keydown', outside)
    expect(no).toHaveBeenCalledTimes(1)
    expect(yes).not.toHaveBeenCalled()
    expect(esc.defaultPrevented).toBe(true)
    expect(outside).not.toHaveBeenCalled()
    // Other keys are left alone.
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    c.querySelector('h2')!.dispatchEvent(enter)
    expect(enter.defaultPrevented).toBe(false)
    expect(no).toHaveBeenCalledTimes(1)
  })

  it('the second tap of a double tap, on the same spot a moment later, does nothing; a click from a mouse or the keyboard always counts (UX-005a)', () => {
    let now = 10_000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const { c, yes, no } = open()
    // The first tap went down on the header button, which is outside the panel ...
    press(document.body, 'touch', [200, 90])
    // ... and 80 ms later, in the same place, a tap lands on "Keep going", under which the panel has scrolled.
    now += 80
    const keep = buttonByText(c, 'Keep going')
    press(keep, 'touch', [201, 91])
    click(keep)
    expect(no).not.toHaveBeenCalled()
    expect(yes).not.toHaveBeenCalled()
    // A tap on the same button a second later is a decision.
    now += 1000
    press(keep, 'touch', [201, 91])
    click(keep)
    expect(no).toHaveBeenCalledTimes(1)
    // A tap elsewhere right after another tap is not a repeat.
    now += 50
    press(document.body, 'touch', [20, 20])
    now += 50
    press(buttonByText(c, 'Skip Spatial'), 'touch', [250, 400])
    click(buttonByText(c, 'Skip Spatial'))
    expect(yes).toHaveBeenCalledTimes(1)
    // A mouse is never held back, even on the same spot at once; nor is a click with no press (the keyboard).
    now += 10
    press(document.body, 'mouse', [250, 400])
    now += 10
    press(buttonByText(c, 'Keep going'), 'mouse', [250, 400])
    click(buttonByText(c, 'Keep going'))
    expect(no).toHaveBeenCalledTimes(2)
    now += 10
    press(document.body, 'touch', [5, 5])
    now += 10
    press(keep, 'touch', [6, 6])
    now += 5_000
    click(keep) // a key press activating the button, long after the last touch
    expect(no).toHaveBeenCalledTimes(3)
  })

  it('primary="no" puts the safe answer first and in the primary style (the leave panel, UX-005b)', () => {
    const { c } = open({ primary: 'no', yes: 'Leave anyway', no: 'Stay and save' })
    const buttons = [...c.querySelectorAll('button')]
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Stay and save', 'Leave anyway'])
    expect(buttons[0]!.classList.contains('hb-primary')).toBe(true)
    expect(buttons[1]!.classList.contains('hb-primary')).toBe(false)
  })

  it('by default the yes-button is first and primary', () => {
    const { c } = open()
    const buttons = [...c.querySelectorAll('button')]
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Skip Spatial', 'Keep going'])
    expect(buttons[0]!.classList.contains('hb-primary')).toBe(true)
  })

  describe('the Skip and Finish panels of the session: "Keep going" is the primary (UX-REVIEW D27, provisional default)', () => {
    it('with primary="no" the safe answer is first and the only primary, and the heading still takes focus', () => {
      const { c, yes, no } = open({ primary: 'no' })
      const buttons = [...c.querySelectorAll('button')]
      expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Keep going', 'Skip Spatial'])
      expect(c.querySelectorAll('button.hb-primary')).toHaveLength(1)
      expect(buttons[0]!.classList.contains('hb-primary')).toBe(true)
      expect(document.activeElement).toBe(c.querySelector('h2'))
      click(buttons[1]!)
      expect(yes).toHaveBeenCalledTimes(1)
      click(buttons[0]!)
      expect(no).toHaveBeenCalledTimes(1)
    })

    it('Escape keeps meaning "Keep going" there: onno, not onyes', () => {
      const { c, yes, no } = open({ primary: 'no' })
      const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      c.querySelector('h2')!.dispatchEvent(esc)
      expect(no).toHaveBeenCalledTimes(1)
      expect(yes).not.toHaveBeenCalled()
      expect(esc.defaultPrevented).toBe(true)
    })

    it('the double-tap guard holds back the second tap on the primary "Keep going" as it does with the other order, and a later press is a decision', () => {
      let now = 10_000
      vi.spyOn(performance, 'now').mockImplementation(() => now)
      const { c, yes, no } = open({ primary: 'no' })
      press(document.body, 'touch', [200, 90])
      now += 80
      const keep = buttonByText(c, 'Keep going')
      press(keep, 'touch', [201, 91])
      click(keep)
      expect(no).not.toHaveBeenCalled()
      expect(yes).not.toHaveBeenCalled()
      now += 1000
      click(keep)
      expect(no).toHaveBeenCalledTimes(1)
    })
  })
})
