import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buttonByText, click, fakeDisplay } from '../render/common/testing'
import { fakeEnv } from './dom-support'
import { practiceVerdict } from './copy'
import { PracticeRun } from './practice'
import PracticeScreen from './PracticeScreen.svelte'

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement

function open(practice = new PracticeRun('s_PRACTICETEST001'), ondone: () => void = () => undefined): PracticeRun {
  const fake = fakeEnv(fakeDisplay())
  host = document.createElement('div')
  document.body.appendChild(host)
  app = mount(PracticeScreen, { target: host, props: { env: fake.env, practice, ondone } })
  flushSync()
  return practice
}

afterEach(() => {
  if (app) unmount(app)
  app = undefined
  document.body.innerHTML = ''
})

const h1 = (): HTMLElement => host.querySelector('h1')!
const status = (): HTMLElement => host.querySelector('p[role="status"]')!

/** Answer the question on screen: whatever the item takes (a choice, a number or a letter). */
function answer(practice: PracticeRun): void {
  for (const response of [0, '1', 'A']) {
    practice.itemResponded(response)
    if (practice.view().phase === 'confidence') break
  }
  flushSync()
  expect(practice.view().phase).toBe('confidence')
}

describe('PracticeScreen: focus follows the practice (UX-004, WCAG 2.4.3, 4.1.3)', () => {
  it('the counter keeps its words, with the numbers left to the page translator', () => {
    open()
    const counter = [...host.querySelectorAll('p')].find((p) => (p.textContent ?? '').startsWith('Practice question'))!
    expect(counter.textContent).toBe('Practice question 1 of 4')
    expect([...counter.querySelectorAll('span')].map((s) => [s.textContent, s.getAttribute('translate')])).toEqual([
      ['1', 'no'],
      ['4', 'no'],
    ])
  })

  it('every step lands focus on the page, in the order a reader needs: heading, slider, feedback, the next heading', () => {
    const practice = open()
    const focused: string[] = []
    const note = (): void => {
      const el = document.activeElement
      expect(el === document.body || el === null, 'focus fell to the body').toBe(false)
      focused.push(`${el!.tagName.toLowerCase()}${el!.classList.contains('feedback') ? '.feedback' : ''}`)
    }
    for (let q = 1; q <= 4; q++) {
      expect(h1().textContent).toBe('Practice')
      note() // a new question: its heading
      answer(practice)
      note() // the confidence slider
      click(buttonByText(host, 'Continue'))
      note() // the feedback
      click(buttonByText(host, q < 4 ? 'Next practice question' : 'Finish practice'))
    }
    expect(focused).toEqual(['h1', 'input', 'section.feedback', 'h1', 'input', 'section.feedback', 'h1', 'input', 'section.feedback', 'h1', 'input', 'section.feedback'])
    // After the last one: the end of practice is a screen of its own, and takes focus too.
    expect(h1().textContent).toBe('Practice complete')
    expect(document.activeElement).toBe(h1())
  })

  it('the verdict is told through a status line that was on the page, empty, before the words went into it', () => {
    const practice = open()
    const line = status()
    expect(line.textContent).toBe('')
    expect(line.classList.contains('hb-sr-only')).toBe(true)
    answer(practice)
    expect(status()).toBe(line)
    expect(line.textContent).toBe('')
    click(buttonByText(host, 'Continue'))
    const feedback = practice.view().feedback!
    expect(status()).toBe(line)
    expect(line.textContent).toBe(practiceVerdict(feedback.correct, feedback.answer))
    // The visible feedback is not itself a live region any more, and it is where focus is.
    const section = host.querySelector('section.feedback')!
    expect(section.hasAttribute('aria-live')).toBe(false)
    expect(section.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(section)
    expect(section.textContent).toMatch(/That was (not )?correct\. The answer was /)
    // The hidden line does not repeat the visible words, so one search finds one element.
    expect(line.textContent).not.toMatch(/That was (not )?correct/)
  })

  it('the next question is a new screen: its heading has focus and the verdict is gone', () => {
    const practice = open()
    answer(practice)
    click(buttonByText(host, 'Continue'))
    click(buttonByText(host, 'Next practice question'))
    expect(host.textContent).toContain('Practice question 2 of 4')
    expect(document.activeElement).toBe(h1())
    expect(status().textContent).toBe('')
    expect(host.querySelector('section.feedback')).toBeNull()
  })

  it('"Stop practice" leaves in one press, from a question and from the feedback; there is no "Back"', () => {
    const done = vi.fn()
    const practice = open(undefined, done)
    expect([...host.querySelectorAll('button')].map((b) => b.textContent?.trim())).not.toContain('Back')
    click(buttonByText(host, 'Stop practice'))
    expect(done).toHaveBeenCalledTimes(1)
    // The run itself was not touched: it is dropped by the flow.
    expect(practice.view().phase).toBe('item')
    unmount(app!)
    host.remove()
    const again = vi.fn()
    const second = open(undefined, again)
    answer(second)
    click(buttonByText(host, 'Continue'))
    click(buttonByText(host, 'Stop practice'))
    expect(again).toHaveBeenCalledTimes(1)
  })

  it('"Practice complete" ends with "Continue", which goes to the ready screen', () => {
    const done = vi.fn()
    const practice = open(undefined, done)
    for (let q = 0; q < 4; q++) {
      answer(practice)
      click(buttonByText(host, 'Continue'))
      click(buttonByText(host, q < 3 ? 'Next practice question' : 'Finish practice'))
    }
    expect(h1().textContent).toBe('Practice complete')
    expect([...host.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(['Continue'])
    click(buttonByText(host, 'Continue'))
    expect(done).toHaveBeenCalledTimes(1)
  })
})
