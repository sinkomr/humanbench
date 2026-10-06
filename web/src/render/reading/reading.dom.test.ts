/**
 * Reading renderer (ROADMAP M1.12, M1.13, A10, A14; DESIGN §14.6 ex. 13): the reading time runs
 * from the frame that draws the passage to Done (performance.now), the passage is hidden for the
 * 3 gate questions, options appear in spec order, the response scores with the family's score(),
 * the source is credited after the block, and no authoring data (evidence, rationales) is shown.
 * A paragraph of more than 150 words is drawn as display paragraphs of about 120 words, cut between
 * sentences (web/UX-REVIEW.md D11 option A, a provisional default; `split.ts`): the words, their
 * order, the word count and the reading time are the authored ones.
 */

import { flushSync } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reading, type ReadingItem } from '../../tasks/reading'
import { AUTHORED_PASSAGES } from '../../tasks/reading/authoring'
import { PASSAGES } from '../../tasks/reading/bank'
import { countPassageWords } from '../../tasks/reading/text'
import type { ReadingResponse, RenderPassage } from '../../tasks/reading/types'
import { normalizeIds } from '../common/leak'
import { buttonByText, click, fakeDisplay, press, render } from '../common/testing'
import ReadingRenderer from './ReadingRenderer.svelte'
import { LONGEST_WORDS, splitParagraphs } from './split'

const FRAME = 1000 / 60

let cleanup: (() => void)[] = []
afterEach(() => {
  for (const f of cleanup) f()
  cleanup = []
})

/** A reading block for bank passage `p` (the questions are those of whatever the seed drew: only the passage is under test). */
function itemFor(p: RenderPassage, seed: string): ReadingItem {
  const item = reading.generate(seed)
  return { ...item, spec: { ...item.spec, passage_id: p.id, paragraphs: p.paragraphs, word_count: p.word_count, source: p.source } }
}

function mountReading(item: ReadingItem) {
  const display = fakeDisplay()
  const responses: ReadingResponse[] = []
  const r = render(ReadingRenderer, { spec: item.spec, onrespond: (x: ReadingResponse) => responses.push(x), timing: display })
  cleanup.push(r.destroy)
  return { ...r, display, responses }
}

describe('ReadingRenderer', () => {
  it('times reading from the passage frame to Done, then asks the questions in spec order and scores', () => {
    for (let i = 0; i < 12; i++) {
      const item = reading.generate(`render-reading-${i}`)
      const m = mountReading(item)
      click(buttonByText(m.container, 'Show the passage'))
      expect(m.container.querySelectorAll('.passage p')).toHaveLength(splitParagraphs(item.spec.paragraphs).length)
      const done = buttonByText(m.container, 'Done reading')
      expect(done.disabled).toBe(true)
      m.display.advance(FRAME)
      const shownAt = m.display.now()
      expect(done.disabled).toBe(false)
      m.display.advance(90_000)
      click(done)
      expect(m.container.querySelector('.passage')).toBeNull()
      const fieldsets = [...m.container.querySelectorAll('fieldset')]
      expect(fieldsets).toHaveLength(item.spec.questions.length)
      fieldsets.forEach((fs, qi) => {
        const q = item.spec.questions[qi]
        expect(fs.querySelector('legend')?.textContent).toBe(`${qi + 1}. ${q?.stem}`)
        const labels = [...fs.querySelectorAll('label')].map((l) => l.textContent?.trim())
        expect(labels).toEqual(q?.options)
        const values = [...fs.querySelectorAll('input')].map((x) => x.value)
        expect(values).toEqual(q?.options.map((_, oi) => String(oi)))
      })
      // Answer the first two with the key, leave the third blank.
      item.key.indices.slice(0, 2).forEach((k, qi) => click(fieldsets[qi]?.querySelectorAll('input')[k]))
      expect(m.container.querySelector('.hb-status')?.textContent).toBe('1 question not answered yet.')
      // A blank question is recorded as blank for good: the first press asks, the second submits.
      click(buttonByText(m.container, 'Submit answers'))
      expect(m.responses).toEqual([])
      click(buttonByText(m.container, 'Submit answers'))
      expect(m.responses).toEqual([{ reading_time_ms: m.display.now() - shownAt, choices: [item.key.indices[0], item.key.indices[1], null] }])
      expect(m.responses[0]?.reading_time_ms).toBeCloseTo(90_000, 6)
      const score = reading.score(item, m.responses[0] as ReadingResponse)
      expect(score.observation?.kind).toBe('gaussian')
      expect(m.container.querySelector('.credit')?.textContent).toContain(item.spec.source.author)
      m.destroy()
    }
  })

  it('draws every passage of the bank as paragraphs of at most 150 words, with the authored words in the authored order (D11)', () => {
    expect(PASSAGES.length).toBeGreaterThanOrEqual(8)
    let cut = 0
    for (const p of PASSAGES) {
      const m = mountReading(itemFor(p, `render-reading-split-${p.id}`))
      click(buttonByText(m.container, 'Show the passage'))
      const drawn = [...m.container.querySelectorAll('.passage p')].map((el) => el.textContent ?? '')
      // The authored paragraphs are not touched: the same words, in the same order, as one text.
      expect(drawn.join(' ')).toBe(p.paragraphs.join(' '))
      expect(drawn).toEqual(splitParagraphs(p.paragraphs))
      expect(countPassageWords(drawn.join('\n\n'))).toBe(p.word_count)
      for (const text of drawn) expect(countPassageWords(text), `${p.id}: ${text.slice(0, 40)}`).toBeLessThanOrEqual(LONGEST_WORDS)
      if (drawn.length > p.paragraphs.length) cut++
      m.destroy()
    }
    // Darwin (one 363-word paragraph) is drawn as three, Dana as three, Bird as three plus the short one.
    expect(cut).toBeGreaterThanOrEqual(6)
    const darwin = PASSAGES.find((p) => p.id === 'darwin-beagle-1845') as RenderPassage
    const m = mountReading(itemFor(darwin, 'render-reading-split-darwin'))
    click(buttonByText(m.container, 'Show the passage'))
    expect([...m.container.querySelectorAll('.passage p')].map((el) => countPassageWords(el.textContent ?? ''))).toEqual([136, 111, 116])
  })

  it('times a split passage as before: from the frame that draws it to Done, whatever the number of display paragraphs', () => {
    const darwin = PASSAGES.find((p) => p.id === 'darwin-beagle-1845') as RenderPassage
    const item = itemFor(darwin, 'render-reading-split-time')
    const m = mountReading(item)
    click(buttonByText(m.container, 'Show the passage'))
    expect(m.container.querySelectorAll('.passage p')).toHaveLength(3)
    const done = buttonByText(m.container, 'Done reading')
    expect(done.disabled).toBe(true)
    m.display.advance(FRAME)
    expect(done.disabled).toBe(false)
    m.display.advance(123_456)
    click(done)
    item.spec.questions.forEach((_, qi) => click(m.container.querySelectorAll('fieldset.question')[qi]?.querySelector('input')))
    click(buttonByText(m.container, 'Submit answers'))
    expect(m.responses).toHaveLength(1)
    expect(m.responses[0]?.reading_time_ms).toBeCloseTo(123_456, 6)
    expect(m.responses[0]?.choices).toEqual([0, 0, 0])
  })

  it('never shows evidence spans or rationales from the authored bank (A14)', () => {
    for (let i = 0; i < 30; i++) {
      const item = reading.generate(`render-reading-a14-${i}`)
      const passage = AUTHORED_PASSAGES.find((p) => p.id === item.spec.passage_id)
      const m = mountReading(item)
      click(buttonByText(m.container, 'Show the passage'))
      m.display.advance(FRAME + 30_000)
      click(buttonByText(m.container, 'Done reading'))
      const html = m.container.innerHTML
      for (const q of passage?.questions ?? []) for (const r of q.option_rationales) expect(html).not.toContain(r)
      expect(html).not.toMatch(/evidence|rationale/i)
      m.destroy()
    }
  })

  /** Reading block mounted and taken to the questions. */
  function atQuestions(seed: string) {
    const item = reading.generate(seed)
    const m = mountReading(item)
    click(buttonByText(m.container, 'Show the passage'))
    m.display.advance(FRAME + 5_000)
    click(buttonByText(m.container, 'Done reading'))
    const groups = [...m.container.querySelectorAll<HTMLFieldSetElement>('fieldset.question')]
    const radios = (qi: number): HTMLInputElement[] => [...(groups[qi]?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? [])]
    const status = (): HTMLElement => m.container.querySelector('.hb-status') as HTMLElement
    return { ...m, item, groups, radios, status }
  }

  it('says "Done reading", the label of the button, in the intro (UX-019)', () => {
    const m = mountReading(reading.generate('render-reading-intro'))
    const text = m.container.querySelector('.hb-instructions')?.textContent?.replace(/\s+/g, ' ') ?? ''
    expect(text).toContain('Choose Done reading when you reach the end.')
    expect(buttonByText(m.container, 'Show the passage')).toBeTruthy()
  })

  it('Enter on an option never submits: it moves to the next question, and from the last to Submit answers (UX-019, WCAG 3.2.2)', () => {
    const m = atQuestions('render-reading-enter')
    m.radios(0)[1]?.focus()
    const first = press('Enter', m.radios(0)[1])
    expect(first.defaultPrevented).toBe(true)
    expect(m.responses).toEqual([])
    expect(document.activeElement).toBe(m.radios(1)[0])
    // A question that already has an answer is entered on that answer.
    click(m.radios(2)[2])
    m.radios(1)[0]?.focus()
    press('Enter', m.radios(1)[0])
    expect(document.activeElement).toBe(m.radios(2)[2])
    press('Enter', m.radios(2)[2])
    expect(document.activeElement).toBe(buttonByText(m.container, 'Submit answers'))
    expect(m.responses).toEqual([])
    // Enter on the button itself is the browser's own submit; the keydown is left alone there.
    const onButton = press('Enter', buttonByText(m.container, 'Submit answers'))
    expect(onButton.defaultPrevented).toBe(false)
  })

  it('Submit answers with questions left blank asks first, in an alert, and a second press submits (UX-019, WCAG 3.3.4)', () => {
    const m = atQuestions('render-reading-warn')
    click(m.radios(0)[0])
    click(buttonByText(m.container, 'Submit answers'))
    expect(m.responses).toEqual([])
    const alert = m.container.querySelector('[role="alert"]')
    expect(alert?.textContent?.replace(/\s+/g, ' ').trim()).toBe('2 questions are not answered yet. Choose Submit answers again to submit anyway, or answer them first.')
    expect(alert?.classList.contains('hb-status')).toBe(true)
    expect(m.container.querySelector('.hb-status[aria-live]')).toBeNull()
    expect(m.container.querySelector('.questions')).not.toBeNull()
    click(buttonByText(m.container, 'Submit answers'))
    expect(m.responses).toHaveLength(1)
    expect(m.responses[0]?.choices).toEqual([0, null, null])
    expect(m.container.querySelector('.credit')).not.toBeNull()
  })

  it('says it in the singular for one blank question', () => {
    const m = atQuestions('render-reading-warn-one')
    click(m.radios(0)[0])
    click(m.radios(1)[1])
    click(buttonByText(m.container, 'Submit answers'))
    expect(m.container.querySelector('[role="alert"]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('1 question is not answered yet. Choose Submit answers again to submit anyway, or answer it first.')
  })

  it('answering one more question after the warning clears it, and the next press asks again about what is still blank', () => {
    const m = atQuestions('render-reading-warn-again')
    click(buttonByText(m.container, 'Submit answers'))
    expect(m.container.querySelector('[role="alert"]')?.textContent).toContain('3 questions are not answered yet.')
    click(m.radios(0)[2])
    expect(m.container.querySelector('[role="alert"]')).toBeNull()
    expect(m.status().textContent).toBe('2 questions not answered yet.')
    click(buttonByText(m.container, 'Submit answers'))
    expect(m.responses).toEqual([])
    expect(m.container.querySelector('[role="alert"]')?.textContent).toContain('2 questions are not answered yet.')
  })

  it('all answered: one press submits, with no question in between (the shared drivers rely on it)', () => {
    const m = atQuestions('render-reading-all')
    for (let qi = 0; qi < m.groups.length; qi++) click(m.radios(qi)[qi])
    expect(m.status().textContent?.trim()).toBe('')
    click(buttonByText(m.container, 'Submit answers'))
    expect(m.responses).toHaveLength(1)
    expect(m.responses[0]?.choices).toEqual([0, 1, 2])
  })

  it('mounts the count line empty and fills it a moment later, so the first count is announced (UX-019, WCAG 4.1.3)', () => {
    vi.useFakeTimers()
    try {
      const m = atQuestions('render-reading-count')
      const line = m.status()
      expect(line.getAttribute('aria-live')).toBe('polite')
      expect(line.textContent?.trim()).toBe('')
      vi.advanceTimersByTime(200)
      flushSync()
      expect(m.container.querySelector('.hb-status')).toBe(line)
      expect(line.textContent?.trim()).toBe('3 questions not answered yet.')
      expect(line.querySelector('span')?.getAttribute('translate')).toBe('no')
    } finally {
      vi.useRealTimers()
    }
  })

  it('matches its snapshot (a long passage drawn as display paragraphs)', () => {
    const darwin = PASSAGES.find((p) => p.id === 'darwin-beagle-1845') as RenderPassage
    const m = mountReading(itemFor(darwin, 'render-reading-snap-passage'))
    click(buttonByText(m.container, 'Show the passage'))
    m.display.advance(FRAME)
    expect(normalizeIds(m.container)).toMatchSnapshot()
  })

  it('matches its snapshot (questions)', () => {
    const item = reading.generate('render-reading-snap')
    const m = mountReading(item)
    click(buttonByText(m.container, 'Show the passage'))
    m.display.advance(FRAME + 60_000)
    click(buttonByText(m.container, 'Done reading'))
    expect(normalizeIds(m.container)).toMatchSnapshot()
  })
})
