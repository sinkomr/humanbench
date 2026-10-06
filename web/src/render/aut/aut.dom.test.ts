/**
 * Unusual uses renderer (ROADMAP M6.4; DESIGN §5.4, §8, §10, §13): the warning before any typing, the Start button and the
 * round's onset frame, the countdown and its coarse announcements, adding (Add, Enter) and removing ideas, the personal-info
 * block, time up and Done each ending the round once, and what the response holds. Time is a fake display (rAF + clock), so
 * a 90 s round runs in milliseconds.
 */

import fc from 'fast-check'
import { flushSync } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { ENTRY_COPY, secondsNote } from '../../tasks/aut/copy'
import { AUT_MAX_IDEAS, isAutResponse, type AutResponse, type AutSpec } from '../../tasks/aut/spec'
import { cleanResponse, personalInfo } from '../../tasks/aut/text'
import { buttonByText, click, fakeDisplay, press, render, typeInto } from '../common/testing'
import AutRenderer from './AutRenderer.svelte'

let cleanup: (() => void)[] = []
afterEach(() => {
  for (const f of cleanup) f()
  cleanup = []
})

const SPEC: AutSpec = { object: 'brick', seconds: 90 }

function mountSpec(spec: AutSpec = SPEC, extra: Record<string, unknown> = {}) {
  const responses: AutResponse[] = []
  const shown: number[] = []
  const starts: number[] = []
  const pastes: { t_ms: number }[] = []
  const display = fakeDisplay()
  const r = render(AutRenderer, {
    spec,
    onrespond: (x: AutResponse) => responses.push(x),
    onshown: (t: number) => shown.push(t),
    onstart: (t: number) => starts.push(t),
    onpaste: (e: { t_ms: number }) => pastes.push(e),
    timing: display,
    ...extra,
  })
  cleanup.push(r.destroy)
  const root = r.container.querySelector('section') as HTMLElement
  const input = (): HTMLInputElement | null => r.container.querySelector('input')
  const form = (): HTMLFormElement | null => r.container.querySelector('form')
  const startButton = (): HTMLButtonElement => buttonByText(r.container, ENTRY_COPY.start)
  const addButton = (): HTMLButtonElement => buttonByText(r.container, ENTRY_COPY.add)
  const doneButton = (): HTMLButtonElement => buttonByText(r.container, ENTRY_COPY.done)
  const note = (): string => r.container.querySelector('.hb-note')?.textContent ?? ''
  const status = (): string => r.container.querySelector('.hb-status')?.textContent ?? ''
  const clock = (): string => r.container.querySelector('.clock-time')?.textContent ?? ''
  const phase = (): string => root.getAttribute('data-phase') ?? ''
  const ideas = (): string[] => [...r.container.querySelectorAll('.idea-text')].map((e) => e.textContent ?? '')
  /** Press Start and run the frame that begins the round. */
  const begin = (): void => {
    click(startButton())
    display.advance(20)
  }
  /** Type an idea and add it as Enter does in a browser (jsdom has no implicit submission). */
  const add = (text: string): void => {
    typeInto(input(), text)
    ;(form() as HTMLFormElement).requestSubmit()
    flushSync()
  }
  return { ...r, root, responses, shown, starts, pastes, display, input, form, startButton, addButton, doneButton, note, status, clock, phase, ideas, begin, add }
}

describe('AutRenderer before the round', () => {
  it('draws the root the sweep expects, named by the title with the experimental label', () => {
    const m = mountSpec()
    expect(m.root.classList.contains('hb-render')).toBe(true)
    expect(m.root.classList.contains('aut')).toBe(true)
    const title = m.root.querySelector('.title') as HTMLElement
    expect(m.root.getAttribute('aria-labelledby')).toBe(title.id)
    expect(title.textContent?.replace(/\s+/g, ' ').trim()).toBe('Unusual uses Experimental')
    expect(m.root.querySelector('.hb-instructions')?.textContent).toBe('List as many unusual uses for the object as you can. Short answers work best.')
  })

  it('shows the warning on mount, before any input exists, word for word', () => {
    const m = mountSpec()
    expect(m.input()).toBeNull()
    expect(m.form()).toBeNull()
    const group = m.root.querySelector('[role="group"]') as HTMLElement
    expect(group.querySelector('.warning-title')?.textContent).toBe("Don't type personal info")
    expect(group.querySelector('.warning-body')?.textContent).toBe(
      'No names, addresses, phone numbers or emails. Your answers are kept in your save file, and anything that looks like contact details is left out.',
    )
    expect(group.getAttribute('aria-labelledby')).toBe(group.querySelector('.warning-title')?.id)
  })

  it('names the object and the length of the round, and offers a Start button', () => {
    const m = mountSpec()
    expect(m.root.querySelector('.object-word')?.textContent).toBe('brick')
    expect(m.root.querySelector('.length')?.textContent).toBe('You have 90 seconds.')
    expect(m.startButton().disabled).toBe(false)
    expect(m.phase()).toBe('ready')
    expect(m.root.querySelector('[role="timer"]')).toBeNull()
  })

  it('says the length of a round that is not 90 s, and falls back to 90 when the spec has no usable length', () => {
    expect(mountSpec({ object: 'paperclip', seconds: 45 }).root.querySelector('.length')?.textContent).toBe(secondsNote(45))
    expect(mountSpec({ object: 'paperclip', seconds: Number.NaN }).root.querySelector('.length')?.textContent).toBe('You have 90 seconds.')
  })

  it('starts nothing before Start: no response, no onset, no pending frame but the one for the first drawn frame', () => {
    const m = mountSpec()
    m.display.advance(500)
    expect(m.responses).toEqual([])
    expect(m.starts).toEqual([])
    expect(m.shown).toHaveLength(1)
    expect(m.display.pending()).toBe(0)
  })

  it('reports the first drawn frame once, as the other entries do', () => {
    const m = mountSpec()
    expect(m.shown).toEqual([])
    m.display.advance(40)
    expect(m.shown).toHaveLength(1)
    expect(m.shown[0]).toBeGreaterThan(1000)
    m.display.advance(200)
    expect(m.shown).toHaveLength(1)
  })

  it('does nothing while disabled', () => {
    const m = mountSpec(SPEC, { disabled: true })
    expect(m.startButton().disabled).toBe(true)
    m.startButton().click()
    flushSync()
    expect(m.phase()).toBe('ready')
  })

  it('writes nothing but a phase to a data attribute, and never says whether an idea is right', () => {
    const m = mountSpec()
    m.begin()
    m.add('doorstop')
    const attrs = [m.root, ...m.root.querySelectorAll('*')].flatMap((e) => [...e.attributes].map((a) => a.name)).filter((a) => a.startsWith('data-'))
    expect(new Set(attrs)).toEqual(new Set(['data-phase']))
    expect(m.root.textContent ?? '').not.toMatch(/\b(wrong|incorrect|correct|right|mistake|score|well done|good|bad)\b/i)
  })
})

describe('AutRenderer: the onset', () => {
  it('draws the entry at the press and starts the round at the first frame after it', () => {
    const m = mountSpec()
    m.display.advance(40)
    click(m.startButton())
    expect(m.phase()).toBe('starting')
    expect(m.input()).not.toBeNull()
    expect(document.activeElement).toBe(m.input())
    expect(m.starts).toEqual([])
    expect(m.display.pending()).toBe(1)
    m.display.advance(20)
    expect(m.phase()).toBe('running')
    expect(m.starts).toHaveLength(1)
    expect(m.starts[0]).toBeGreaterThan(m.shown[0] as number)
    expect(m.starts[0]).toBeLessThanOrEqual(m.display.now())
  })

  it('takes no idea before the onset frame, and takes ideas from it', () => {
    const m = mountSpec()
    click(m.startButton())
    expect(m.addButton().disabled).toBe(true)
    typeInto(m.input(), 'doorstop')
    ;(m.form() as HTMLFormElement).requestSubmit()
    flushSync()
    expect(m.ideas()).toEqual([])
    m.display.advance(20)
    expect(m.addButton().disabled).toBe(false)
    ;(m.form() as HTMLFormElement).requestSubmit()
    flushSync()
    expect(m.ideas()).toEqual(['doorstop'])
  })

  it('ignores a second press of Start (the button is gone) and reports the onset once', () => {
    const m = mountSpec()
    m.begin()
    expect(() => buttonByText(m.container, ENTRY_COPY.start)).toThrow()
    m.display.advance(2000)
    expect(m.starts).toHaveLength(1)
  })
})

describe('AutRenderer: the countdown', () => {
  it('shows the time left as m:ss in a timer that is not a live region, counting down by the clock', () => {
    const m = mountSpec()
    m.begin()
    const timer = m.root.querySelector('[role="timer"]') as HTMLElement
    expect(timer).not.toBeNull()
    expect(timer.closest('[aria-live]')).toBeNull()
    expect(timer.hasAttribute('aria-live')).toBe(false)
    expect(m.clock()).toBe('1:30')
    m.display.advance(1100)
    expect(m.clock()).toBe('1:29')
    m.display.advance(29_000)
    expect(m.clock()).toBe('1:00')
    m.display.advance(50_000)
    expect(m.clock()).toBe('0:10')
    expect(m.root.querySelector('time')?.getAttribute('datetime')).toBe('PT10S')
  })

  it('announces only at 60, 30 and 10 seconds left and at the end, each once, in one polite region', () => {
    const m = mountSpec()
    m.begin()
    // while the round runs: the status and the note about the box, both polite, nothing assertive, and no ticking region
    const live = [...m.root.querySelectorAll('[aria-live]')]
    expect(live.map((e) => e.getAttribute('aria-live'))).toEqual(['polite', 'polite'])
    const seen: string[] = []
    for (let i = 0; i < 95 * 20; i++) {
      m.display.advance(50)
      if (seen[seen.length - 1] !== m.status()) seen.push(m.status())
    }
    expect(seen).toEqual(['', '60 seconds left.', '30 seconds left.', '10 seconds left.', ENTRY_COPY.timeUp])
  })

  it('announces only the steps below the length of a shorter round', () => {
    const seen = (seconds: number): string[] => {
      const m = mountSpec({ object: 'brick', seconds })
      m.begin()
      const out: string[] = []
      for (let i = 0; i < (seconds + 5) * 20; i++) {
        m.display.advance(50)
        if (out[out.length - 1] !== m.status()) out.push(m.status())
      }
      return out
    }
    expect(seen(45)).toEqual(['', '30 seconds left.', '10 seconds left.', ENTRY_COPY.timeUp])
    expect(seen(20)).toEqual(['', '10 seconds left.', ENTRY_COPY.timeUp])
    expect(seen(5)).toEqual(['', ENTRY_COPY.timeUp])
  })

  it('says only the latest step when one frame jumps over several (a hidden tab)', () => {
    const m = mountSpec()
    m.begin()
    m.display.advance(500)
    // one frame far later: the display advances in frames, so run it as one big step of the clock and one frame
    const jump = m.display.clock
    jump.set(jump.now() + 85_000)
    m.display.advance(20)
    expect(m.status()).toBe('10 seconds left.')
  })

  it('stops its frames when the component goes away', () => {
    const m = mountSpec()
    m.begin()
    m.display.advance(1000)
    expect(m.display.pending()).toBe(1)
    m.destroy()
    expect(m.display.pending()).toBe(0)
  })
})

describe('AutRenderer: adding and removing ideas', () => {
  it('adds an idea with Enter (the form submit) and with the Add button, in order, cleaned', () => {
    const m = mountSpec()
    m.begin()
    m.add('  prop open a door  ')
    expect(m.ideas()).toEqual(['prop open a door'])
    expect(m.input()?.value).toBe('')
    expect(document.activeElement).toBe(m.input())
    typeInto(m.input(), 'garden​   edging')
    click(m.addButton())
    expect(m.ideas()).toEqual(['prop open a door', 'garden edging'])
    expect(m.root.querySelector('.ideas-title')?.textContent).toBe('Your ideas (2)')
  })

  it('says there are none yet, and an empty box gets a note and adds nothing', () => {
    const m = mountSpec()
    m.begin()
    expect(m.root.querySelector('.none')?.textContent).toBe('No ideas yet.')
    m.add('   ')
    expect(m.note()).toBe(ENTRY_COPY.emptyNote)
    expect(m.ideas()).toEqual([])
    expect(m.input()?.value).toBe('')
  })

  it('removes the idea whose button was pressed, and gives the box focus again', () => {
    const m = mountSpec()
    m.begin()
    for (const t of ['one', 'two', 'three']) m.add(t)
    const buttons = [...m.container.querySelectorAll<HTMLButtonElement>('button.remove')]
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Remove one', 'Remove two', 'Remove three'])
    expect(buttons.every((b) => b.textContent === 'Remove')).toBe(true)
    click(buttons[1])
    expect(m.ideas()).toEqual(['one', 'three'])
    expect(m.root.querySelector('.ideas-title')?.textContent).toBe('Your ideas (2)')
    expect(document.activeElement).toBe(m.input())
  })

  it('keeps at most the cap, with a note for the next one', () => {
    const m = mountSpec()
    m.begin()
    for (let i = 0; i < AUT_MAX_IDEAS; i++) m.add(`idea number ${i}`)
    expect(m.ideas()).toHaveLength(AUT_MAX_IDEAS)
    m.add('one more')
    expect(m.ideas()).toHaveLength(AUT_MAX_IDEAS)
    expect(m.note()).toBe(ENTRY_COPY.fullNote)
    click(m.container.querySelector('button.remove'))
    m.add('one more')
    expect(m.ideas()).toHaveLength(AUT_MAX_IDEAS)
    expect(m.ideas().at(-1)).toBe('one more')
  })

  it('does not add on the Enter that ends an IME composition', () => {
    const m = mountSpec()
    m.begin()
    typeInto(m.input(), 'ka')
    const ev = press('Enter', m.input(), { isComposing: true })
    expect(ev.defaultPrevented).toBe(true)
    const plain = press('Enter', m.input())
    expect(plain.defaultPrevented).toBe(false)
  })

  it('reports each paste into the box', () => {
    const m = mountSpec()
    m.begin()
    m.input()?.dispatchEvent(new Event('paste', { bubbles: true }))
    expect(m.pastes).toHaveLength(1)
    expect(m.pastes[0]?.t_ms).toBeGreaterThan(1000)
  })
})

describe('AutRenderer: personal information', () => {
  const FLAGGED = ['mail me at jo.smith@example.com', 'call 555 123 4567', 'see www.example.com', 'follow @someone', 'lives at 221 Baker Street', 'my number is 12345']

  it('does not add an idea that looks like contact details, says so in an accessible note, and keeps the text to edit', () => {
    for (const text of FLAGGED) {
      const m = mountSpec()
      m.begin()
      m.add(text)
      expect(m.ideas(), text).toEqual([])
      expect(m.note(), text).toBe(ENTRY_COPY.personalInfoNote)
      expect(m.input()?.value, text).toBe(text)
      expect(m.input()?.getAttribute('aria-invalid'), text).toBe('true')
      const noteEl = m.root.querySelector('.hb-note') as HTMLElement
      expect(m.input()?.getAttribute('aria-describedby')).toBe(noteEl.id)
      expect(noteEl.getAttribute('aria-live')).toBe('polite')
      expect(document.activeElement).toBe(m.input())
    }
  })

  it('takes the note away when the person types again, and adds the idea once the details are out', () => {
    const m = mountSpec()
    m.begin()
    m.add('send it to jo.smith@example.com')
    expect(m.note()).not.toBe('')
    typeInto(m.input(), 'send it to jo')
    expect(m.note()).toBe('')
    expect(m.input()?.hasAttribute('aria-invalid')).toBe(false)
    ;(m.form() as HTMLFormElement).requestSubmit()
    flushSync()
    expect(m.ideas()).toEqual(['send it to jo'])
  })

  it('never puts a flagged idea in the response, whatever else is added', () => {
    const m = mountSpec()
    m.begin()
    m.add('doorstop')
    m.add('email bob@example.org')
    m.add('paperweight')
    click(m.doneButton())
    expect(m.responses).toHaveLength(1)
    expect(m.responses[0]?.responses).toEqual(['doorstop', 'paperweight'])
  })
})

describe('AutRenderer: the end of the round', () => {
  it('calls onrespond once when time is up, with the ideas and the full length, then locks', () => {
    const m = mountSpec({ object: 'brick', seconds: 5 })
    m.begin()
    m.add('doorstop')
    m.add('bookend')
    m.display.advance(4000)
    expect(m.responses).toEqual([])
    m.display.advance(1500)
    expect(m.responses).toEqual([{ responses: ['doorstop', 'bookend'], elapsedMs: 5000 }])
    m.display.advance(10_000)
    expect(m.responses).toHaveLength(1)
    expect(m.phase()).toBe('done')
    expect(m.status()).toBe(ENTRY_COPY.timeUp)
    expect(m.clock()).toBe('0:00')
    expect(m.form()).toBeNull()
    expect(m.container.querySelector('button.remove')).toBeNull()
    expect(m.ideas()).toEqual(['doorstop', 'bookend'])
    expect(m.display.pending()).toBe(0)
  })

  it('does not keep what was typed but not added when time runs out', () => {
    const m = mountSpec({ object: 'brick', seconds: 5 })
    m.begin()
    m.add('doorstop')
    typeInto(m.input(), 'half a thought')
    m.display.advance(6000)
    expect(m.responses[0]?.responses).toEqual(['doorstop'])
  })

  it('calls onrespond once when Done is pressed, with the time since the onset, then locks', () => {
    const m = mountSpec()
    m.begin()
    m.add('doorstop')
    m.display.advance(12_000)
    const expected = m.display.now() - (m.starts[0] as number)
    click(m.doneButton())
    expect(m.responses).toHaveLength(1)
    expect(m.responses[0]?.responses).toEqual(['doorstop'])
    expect(m.responses[0]?.elapsedMs).toBeCloseTo(expected, 6)
    expect(m.responses[0]?.elapsedMs).toBeGreaterThan(11_900)
    expect(m.status()).toBe(ENTRY_COPY.finished)
    m.display.advance(120_000)
    expect(m.responses).toHaveLength(1)
    expect(m.phase()).toBe('done')
  })

  it('never reports more than the length of the round', () => {
    const m = mountSpec({ object: 'brick', seconds: 5 })
    m.begin()
    m.display.clock.set(m.display.now() + 60_000)
    m.display.advance(20)
    expect(m.responses).toHaveLength(1)
    expect(m.responses[0]?.elapsedMs).toBe(5000)
  })

  it('adds what is still in the box when Done is pressed, unless it looks like contact details', () => {
    const a = mountSpec()
    a.begin()
    a.add('doorstop')
    typeInto(a.input(), 'bookend')
    click(a.doneButton())
    expect(a.responses[0]?.responses).toEqual(['doorstop', 'bookend'])

    const b = mountSpec()
    b.begin()
    b.add('doorstop')
    typeInto(b.input(), 'ask jo@example.com')
    click(b.doneButton())
    expect(b.responses).toEqual([])
    expect(b.phase()).toBe('running')
    expect(b.note()).toBe(ENTRY_COPY.personalInfoNote)
    typeInto(b.input(), '')
    click(b.doneButton())
    expect(b.responses[0]?.responses).toEqual(['doorstop'])
  })

  it('can end with no ideas at all', () => {
    const m = mountSpec()
    m.begin()
    click(m.doneButton())
    expect(m.responses[0]?.responses).toEqual([])
    expect(isAutResponse(m.responses[0])).toBe(true)
  })

  it('moves focus to the list of ideas when the round ends with focus inside, and leaves it alone otherwise', () => {
    const a = mountSpec({ object: 'brick', seconds: 5 })
    a.begin()
    expect(document.activeElement).toBe(a.input())
    a.display.advance(6000)
    expect(document.activeElement).toBe(a.root.querySelector('.ideas-title'))

    const b = mountSpec({ object: 'brick', seconds: 5 })
    b.begin()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    cleanup.push(() => outside.remove())
    outside.focus()
    b.display.advance(6000)
    expect(document.activeElement).toBe(outside)
  })
})

describe('AutRenderer: what the response holds (property tests)', () => {
  it('holds exactly the cleaned, contact-free ideas that were typed, in order, up to the cap, and passes isAutResponse', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 40 }), { maxLength: 30 }), fc.boolean(), (typed, byDone) => {
        const m = mountSpec({ object: 'brick', seconds: 5 })
        m.begin()
        const expected: string[] = []
        for (const t of typed) {
          typeInto(m.input(), t)
          const value = m.input()?.value ?? ''
          ;(m.form() as HTMLFormElement).requestSubmit()
          flushSync()
          const idea = cleanResponse(value)
          if (idea !== '' && personalInfo(idea).length === 0 && expected.length < AUT_MAX_IDEAS) expected.push(idea)
        }
        if (byDone) {
          typeInto(m.input(), '') // what is left in the box is added by Done, or stops it when it looks like contact details
          click(m.doneButton())
        } else m.display.advance(6000)
        m.destroy()
        expect(m.responses).toHaveLength(1)
        const response = m.responses[0] as AutResponse
        expect(response.responses).toEqual(expected)
        expect(isAutResponse(response)).toBe(true)
        expect(response.elapsedMs).toBeGreaterThanOrEqual(0)
        expect(response.elapsedMs).toBeLessThanOrEqual(5000)
      }),
      { numRuns: 60 },
    )
  })
})
