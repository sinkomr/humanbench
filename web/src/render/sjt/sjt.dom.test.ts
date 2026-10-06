/**
 * Situational judgment renderer (ROADMAP M6.2; DESIGN §5.2, §5.3, §10, §13, R-5.6.2): the situation and the four
 * responses, rating each 1 to 4 or choosing the most and the least effective, what it sends (once, in display order),
 * the keys, the first-frame unlock, the skill's name and tooltip, and that nothing in the DOM depends on the key.
 */

import { flushSync } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { axisName } from '../../axis-names'
import { EMO_AXIS_NAME, EMO_TOOLTIP } from '../../copy'
import { ENTRY_COPY, FACET_NOTE, progressText, SCALE_LABELS } from '../../tasks/sjt/copy'
import { demoSjtItem } from '../../tasks/sjt/demo'
import { isMostLeast, isSjtRatings, type SjtMode, type SjtResponse, type SjtSpec } from '../../tasks/sjt/spec'
import { attributeProblems, normalizeIds } from '../common/leak'
import { buttonByText, click, fakeDisplay, pointerDown, press, render } from '../common/testing'
import SjtRenderer from './SjtRenderer.svelte'

let cleanup: (() => void)[] = []
afterEach(() => {
  for (const f of cleanup) f()
  cleanup = []
})

const SPEC: SjtSpec = {
  scenario: 'A teammate misses a deadline that delays your work.',
  question: 'How well would each response work?',
  responses: ['Raise it privately and ask what happened.', 'Tell the manager at once.', 'Say nothing and redo the work yourself.', 'Mention it in the team channel.'],
}

function mountSpec(spec: SjtSpec = SPEC, extra: Record<string, unknown> = {}, ready = true) {
  const responses: SjtResponse[] = []
  const shown: number[] = []
  const display = fakeDisplay()
  const r = render(SjtRenderer, { spec, onrespond: (x: SjtResponse) => responses.push(x), onshown: (t: number) => shown.push(t), timing: display, ...extra })
  cleanup.push(r.destroy)
  if (ready) display.advance(40)
  /** Every radio, in document order (rate mode: four per response; most/least: four for most, then four for least). */
  const radios = (): HTMLInputElement[] => [...r.container.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
  /** The four radios of response `i` (rate mode), or of the `i`th question (most/least mode: 0 = most, 1 = least). */
  const group = (i: number): HTMLInputElement[] => radios().slice(4 * i, 4 * i + 4)
  const form = r.container.querySelector('form') as HTMLFormElement
  const confirm = (): HTMLButtonElement => buttonByText(r.container, ENTRY_COPY.submit)
  const tipButton = (): HTMLButtonElement => r.container.querySelector('.tip-button') as HTMLButtonElement
  const panel = (): HTMLElement => r.container.querySelector('[role="tooltip"]') as HTMLElement
  const note = (): string => r.container.querySelector('.hb-note')?.textContent ?? ''
  /** Rate every response (levels in display order) by clicking. */
  const rateAll = (levels: number[]): void => {
    levels.forEach((level, i) => click(group(i)[level - 1]))
  }
  return { ...r, responses, shown, display, radios, group, form, confirm, tipButton, panel, note, rateAll }
}

const submitEvent = (form: HTMLFormElement): void => {
  form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
  flushSync()
}

describe('SjtRenderer, rate mode', () => {
  it('names the skill, gives the instruction, shows the situation and puts the question on the group of responses', () => {
    const m = mountSpec()
    const section = m.container.querySelector('section') as HTMLElement
    expect(section.classList.contains('hb-render') && section.classList.contains('sjt')).toBe(true)
    const title = section.querySelector('.title') as HTMLElement
    expect(title.textContent).toBe(EMO_AXIS_NAME)
    expect(title.textContent).toBe(axisName('EMO')) // the display-name layer (UX review D25)
    expect(section.getAttribute('aria-labelledby')).toBe(title.id)
    expect(m.container.querySelector('.hb-instructions')?.textContent).toBe('Read the situation, then rate how well each response would work.')
    expect(m.container.querySelector('.scenario')?.textContent).toBe(SPEC.scenario)
    expect(m.container.querySelector('fieldset.responses > legend')?.textContent).toBe(SPEC.question)
  })

  it('names the situation on a group and never puts an accessible name on the paragraph (ARIA 1.2: a paragraph has no nameable role)', () => {
    const m = mountSpec()
    const p = m.container.querySelector('.scenario') as HTMLElement
    expect(p.tagName).toBe('P')
    for (const attr of ['aria-label', 'aria-labelledby', 'title', 'role']) expect(p.hasAttribute(attr)).toBe(false)
    const group = p.parentElement as HTMLElement
    expect(group.getAttribute('role')).toBe('group')
    expect(group.getAttribute('aria-label')).toBe(ENTRY_COPY.scenarioLabel)
    expect(group.textContent?.trim()).toBe(p.textContent)
  })

  it('shows four responses A to D in spec order, each a group of four radio inputs named by the level', () => {
    const m = mountSpec()
    const sets = [...m.container.querySelectorAll('fieldset.response')]
    expect(sets).toHaveLength(4)
    expect(sets.map((s) => s.querySelector('legend')?.textContent)).toEqual(SPEC.responses.map((r, i) => `${'ABCD'[i]}. ${r}`))
    expect(m.radios()).toHaveLength(16)
    for (let i = 0; i < 4; i++) {
      expect(m.group(i).map((r) => r.value)).toEqual(['1', '2', '3', '4'])
      expect(m.group(i).map((r) => r.closest('label')?.textContent?.replace(/\s+/g, ' ').trim())).toEqual(SCALE_LABELS.map((l, j) => `${j + 1} ${l}`))
      expect(new Set(m.group(i).map((r) => r.name)).size).toBe(1)
      expect(m.group(i)[0]?.closest('fieldset')).toBe(sets[i])
    }
    expect(new Set(m.radios().map((r) => r.name)).size).toBe(4)
    expect(m.radios().every((r) => !r.checked)).toBe(true)
    expect(m.radios().every((r) => r.type === 'radio')).toBe(true)
  })

  it('keeps Confirm off until all four are rated, and counts the ratings made', () => {
    const m = mountSpec()
    expect(m.confirm().disabled).toBe(true)
    expect(m.container.querySelector('.progress')?.textContent).toBe(progressText(0, 4))
    click(m.group(0)[3])
    click(m.group(1)[0])
    click(m.group(2)[2])
    expect(m.confirm().disabled).toBe(true)
    expect(m.container.querySelector('.progress')?.textContent).toBe(progressText(3, 4))
    click(m.group(3)[1])
    expect(m.confirm().disabled).toBe(false)
    expect(m.container.querySelector('.progress')?.textContent).toBe(progressText(4, 4))
  })

  it('a rating can be changed before Confirm, and the count stays four', () => {
    const m = mountSpec()
    m.rateAll([1, 1, 1, 1])
    click(m.group(2)[3])
    expect(m.group(2).map((r) => r.checked)).toEqual([false, false, false, true])
    expect(m.container.querySelector('.progress')?.textContent).toBe(progressText(4, 4))
  })

  it('sends the four ratings in display order once, then locks', () => {
    const m = mountSpec()
    m.rateAll([3, 1, 4, 2])
    click(m.confirm())
    expect(m.responses).toEqual([[3, 1, 4, 2]])
    expect(isSjtRatings(m.responses[0])).toBe(true)
    click(m.confirm()) // a second press does nothing
    submitEvent(m.form)
    expect(m.responses).toHaveLength(1)
    expect(m.container.querySelector('fieldset.responses')?.hasAttribute('disabled')).toBe(true)
    expect(m.radios().every((r) => r.matches(':disabled'))).toBe(true)
    expect(m.confirm().disabled).toBe(true)
    expect(m.container.querySelector('.hb-status')?.textContent).toBe(ENTRY_COPY.recorded)
    expect(m.container.querySelector('.progress')).toBeNull()
  })

  it('sends the level, not its words: the same numbers for any response texts', () => {
    const m = mountSpec({ ...SPEC, responses: ['One.', 'Two.', 'Three.', 'Four.'] })
    m.rateAll([2, 2, 4, 1])
    click(m.confirm())
    expect(m.responses).toEqual([[2, 2, 4, 1]])
  })

  it('does not send until Confirm: choosing the fourth rating alone answers nothing', () => {
    const m = mountSpec()
    m.rateAll([4, 3, 2, 1])
    expect(m.responses).toEqual([])
  })

  it('never says whether the answer is right', () => {
    const m = mountSpec()
    m.rateAll([4, 4, 4, 4])
    click(m.confirm())
    expect(m.container.textContent ?? '').not.toMatch(/\b(wrong|incorrect|correct|right|mistake|score|well done)\b/i)
  })

  it('accepts no response before the first frame is drawn, and reports that frame once', () => {
    const m = mountSpec(SPEC, {}, false)
    expect(m.shown).toEqual([])
    expect(m.container.querySelector('fieldset.responses')?.hasAttribute('disabled')).toBe(true)
    click(m.group(0)[1])
    expect(m.group(0)[1]?.checked).toBe(false)
    m.display.advance(40)
    expect(m.shown).toHaveLength(1)
    expect(m.shown[0]).toBeGreaterThan(1000)
    expect(m.container.querySelector('fieldset.responses')?.hasAttribute('disabled')).toBe(false)
    m.display.advance(200)
    expect(m.shown).toHaveLength(1)
    m.rateAll([2, 3, 4, 1])
    click(m.confirm())
    expect(m.responses).toEqual([[2, 3, 4, 1]])
  })

  it('cancels its frame request when it is removed before the frame', () => {
    const m = mountSpec(SPEC, {}, false)
    expect(m.display.pending()).toBe(1)
    m.destroy()
    expect(m.display.pending()).toBe(0)
    m.display.advance(100)
    expect(m.shown).toEqual([])
  })

  it('does nothing while disabled', () => {
    const m = mountSpec(SPEC, { disabled: true })
    click(m.group(0)[0])
    expect(m.group(0)[0]?.checked).toBe(false)
    submitEvent(m.form)
    expect(m.responses).toEqual([])
  })

  describe('keys (while focus is on a radio of the form)', () => {
    it('1 to 4 rate the response whose group has focus, and focus stays on the chosen level', () => {
      const m = mountSpec()
      m.group(1)[0]?.focus()
      press('3')
      expect(m.group(1).map((r) => r.checked)).toEqual([false, false, true, false])
      expect(document.activeElement).toBe(m.group(1)[2])
      expect(m.group(0).every((r) => !r.checked)).toBe(true)
      press('1')
      expect(m.group(1).map((r) => r.checked)).toEqual([true, false, false, false])
      expect(document.activeElement).toBe(m.group(1)[0])
      m.group(3)[0]?.focus()
      press('4')
      expect(m.group(3)[3]?.checked).toBe(true)
      expect(m.responses).toEqual([])
    })

    it('a whole answer by the keyboard: a number in each group, then Enter', () => {
      const m = mountSpec()
      const levels = [2, 4, 1, 3]
      levels.forEach((level, i) => {
        m.group(i)[0]?.focus()
        press(String(level))
      })
      expect(m.confirm().disabled).toBe(false)
      press('Enter')
      expect(m.responses).toEqual([levels])
      press('Enter') // answered once
      expect(m.responses).toHaveLength(1)
    })

    it('Enter does nothing while a response is unrated, and never submits natively', () => {
      const m = mountSpec()
      click(m.group(0)[0])
      m.group(0)[0]?.focus()
      const ev = press('Enter')
      expect(ev.defaultPrevented).toBe(true)
      expect(m.responses).toEqual([])
    })

    it('ignores a key with a modifier, a level that does not exist, letters and any other key', () => {
      const m = mountSpec()
      m.group(0)[0]?.focus()
      press('2', undefined, { ctrlKey: true })
      press('2', undefined, { metaKey: true })
      press('2', undefined, { altKey: true })
      press('5')
      press('0')
      press('a')
      press('z')
      expect(m.radios().every((r) => !r.checked)).toBe(true)
      expect(m.responses).toEqual([])
    })

    it('do not act when focus is outside the radios (WCAG 2.1.4)', () => {
      const m = mountSpec()
      press('2', document.body)
      press('2', m.container.querySelector('.scenario'))
      press('2', m.confirm())
      expect(m.radios().every((r) => !r.checked)).toBe(true)
    })

    it('do not act before the first frame, after the answer or while disabled', () => {
      const early = mountSpec(SPEC, {}, false)
      early.group(0)[0]?.focus()
      press('2')
      expect(early.radios().every((r) => !r.checked)).toBe(true)
      const done = mountSpec()
      done.rateAll([1, 1, 1, 1])
      click(done.confirm())
      done.group(0)[0]?.focus()
      press('4')
      expect(done.group(0)[3]?.checked).toBe(false)
      expect(done.responses).toEqual([[1, 1, 1, 1]])
    })
  })

  describe('the tooltip (R-5.6.2, DESIGN §5.2, §5.3)', () => {
    it('is a button that names the skill, with the sentence of R-5.6.2 word for word and then the note of this facet', () => {
      const m = mountSpec()
      expect(m.tipButton().textContent?.trim()).toBe(ENTRY_COPY.tipButton)
      expect(m.tipButton().getAttribute('aria-label')).toBe(`${ENTRY_COPY.tipButton}: ${EMO_AXIS_NAME}`)
      const text = m.panel().querySelector('.text')?.textContent ?? ''
      expect(text).toBe(`${EMO_TOOLTIP} ${FACET_NOTE}`)
      expect(text.startsWith('Measures agreement with appraisal-theory and consensus keys. Not a diagnostic or clinical measure;')).toBe(true)
      expect(text).toContain('typical and expert judgments')
      expect(text).toContain('rewards conventional choices')
      expect(text).toContain('overlaps with reading and vocabulary skills')
      expect(m.tipButton().getAttribute('aria-describedby')).toBe(m.panel().id)
      expect(m.tipButton().getAttribute('aria-controls')).toBe(m.panel().id)
    })

    it('is closed to start, the button opens and closes it, and Escape or a press outside closes it', () => {
      const m = mountSpec()
      expect(m.panel().hidden).toBe(true)
      expect(m.tipButton().getAttribute('aria-expanded')).toBe('false')
      click(m.tipButton())
      expect(m.panel().hidden).toBe(false)
      expect(m.tipButton().getAttribute('aria-expanded')).toBe('true')
      click(m.tipButton())
      expect(m.panel().hidden).toBe(true)
      click(m.tipButton())
      press('Escape', document.body)
      expect(m.panel().hidden).toBe(true)
      click(m.tipButton())
      pointerDown(m.panel().querySelector('.text'))
      expect(m.panel().hidden).toBe(false)
      pointerDown(m.container.querySelector('.scenario'))
      expect(m.panel().hidden).toBe(true)
    })

    it('opening it does not lock the question', () => {
      const m = mountSpec()
      click(m.tipButton())
      m.rateAll([4, 3, 2, 1])
      click(m.confirm())
      expect(m.responses).toEqual([[4, 3, 2, 1]])
    })
  })
})

describe('SjtRenderer, most/least mode', () => {
  const mountMostLeast = (ready = true) => mountSpec(SPEC, { mode: 'most_least' satisfies SjtMode }, ready)

  it('gives its own instruction and legend, and two questions of four responses each, in spec order', () => {
    const m = mountMostLeast()
    expect(m.container.querySelector('.hb-instructions')?.textContent).toBe(ENTRY_COPY.instructionsMostLeast)
    expect(m.container.querySelector('fieldset.responses > legend')?.textContent).toBe(ENTRY_COPY.legendMostLeast)
    const sets = [...m.container.querySelectorAll('fieldset.response')]
    expect(sets.map((s) => s.querySelector('legend')?.textContent)).toEqual([ENTRY_COPY.most, ENTRY_COPY.least])
    expect(m.radios()).toHaveLength(8)
    for (const g of [0, 1]) {
      expect(m.group(g).map((r) => r.value)).toEqual(['0', '1', '2', '3'])
      expect(m.group(g).map((r) => r.closest('label')?.textContent?.replace(/\s+/g, ' ').trim())).toEqual(SPEC.responses.map((r, i) => `${'ABCD'[i]}. ${r}`))
      expect(new Set(m.group(g).map((r) => r.name)).size).toBe(1)
    }
    expect(m.group(0)[0]?.name).not.toBe(m.group(1)[0]?.name)
    expect(m.container.querySelector('.progress')).toBeNull()
  })

  it('keeps Confirm off until both are chosen, and sends the two display positions once', () => {
    const m = mountMostLeast()
    expect(m.confirm().disabled).toBe(true)
    click(m.group(0)[2])
    expect(m.confirm().disabled).toBe(true)
    click(m.group(1)[0])
    expect(m.confirm().disabled).toBe(false)
    click(m.confirm())
    expect(m.responses).toEqual([{ most: 2, least: 0 }])
    expect(isMostLeast(m.responses[0])).toBe(true)
    click(m.confirm())
    submitEvent(m.form)
    expect(m.responses).toHaveLength(1)
    expect(m.radios().every((r) => r.matches(':disabled'))).toBe(true)
    expect(m.container.querySelector('.hb-status')?.textContent).toBe(ENTRY_COPY.recorded)
  })

  it('says so, in a live region, and keeps Confirm off when one response is chosen for both; choosing another clears it', () => {
    const m = mountMostLeast()
    expect(m.note()).toBe('')
    expect(m.container.querySelector('.hb-note')?.getAttribute('aria-live')).toBe('polite')
    click(m.group(0)[1])
    expect(m.note()).toBe('')
    click(m.group(1)[1])
    expect(m.note()).toBe(ENTRY_COPY.mostLeastSame)
    expect(m.confirm().disabled).toBe(true)
    submitEvent(m.form)
    expect(m.responses).toEqual([])
    click(m.group(1)[3])
    expect(m.note()).toBe('')
    expect(m.confirm().disabled).toBe(false)
    click(m.confirm())
    expect(m.responses).toEqual([{ most: 1, least: 3 }])
  })

  it('keys 1 to 4 and A to D choose a response in the group that has focus', () => {
    const m = mountMostLeast()
    m.group(0)[0]?.focus()
    press('3')
    expect(m.group(0)[2]?.checked).toBe(true)
    expect(document.activeElement).toBe(m.group(0)[2])
    press('d')
    expect(m.group(0)[3]?.checked).toBe(true)
    m.group(1)[0]?.focus()
    press('B')
    expect(m.group(1)[1]?.checked).toBe(true)
    expect(m.group(0)[1]?.checked).toBe(false)
    press('e') // there is no fifth response
    press('5')
    expect(m.group(1)[1]?.checked).toBe(true)
    expect(m.responses).toEqual([])
    press('Enter')
    expect(m.responses).toEqual([{ most: 3, least: 1 }])
  })

  it('Enter does nothing while both responses are the same', () => {
    const m = mountMostLeast()
    m.group(0)[0]?.focus()
    press('2')
    m.group(1)[0]?.focus()
    press('2')
    press('Enter')
    expect(m.responses).toEqual([])
  })

  it('accepts nothing before the first frame', () => {
    const m = mountMostLeast(false)
    click(m.group(0)[0])
    expect(m.group(0)[0]?.checked).toBe(false)
    m.display.advance(40)
    click(m.group(0)[0])
    expect(m.group(0)[0]?.checked).toBe(true)
    expect(m.shown).toHaveLength(1)
  })

  it('has the same skill tooltip', () => {
    const m = mountMostLeast()
    expect(m.panel().querySelector('.text')?.textContent).toBe(`${EMO_TOOLTIP} ${FACET_NOTE}`)
  })
})

/** The markup with the generated ids and the radio groups' generated names erased (`normalizeIds` covers both: the names start with the id prefix). */
const markup = (root: HTMLElement): string => normalizeIds(root)

/** The markup with the situation and the response texts taken out: what is left must not depend on the item. */
function withoutTexts(root: HTMLElement, spec: SjtSpec): string {
  let html = markup(root)
  for (const text of [spec.scenario, ...spec.responses]) {
    expect(html, text).toContain(text)
    html = html.replaceAll(text, '')
  }
  return html
}

const SEEDS = Array.from({ length: 300 }, (_v, i) => i)

describe.each(['rate', 'most_least'] as const)('nothing in the DOM depends on the key (%s mode)', (mode) => {
  const answer = (m: ReturnType<typeof mountSpec>): void => {
    if (mode === 'rate') m.rateAll([3, 1, 4, 2])
    else {
      click(m.group(0)[1])
      click(m.group(1)[3])
    }
    click(m.confirm())
  }

  it('has no data attribute and no attribute that names an answer, before and after answering', () => {
    const m = mountSpec(SPEC, { mode })
    expect(attributeProblems(m.container)).toEqual([])
    answer(m)
    expect(attributeProblems(m.container)).toEqual([])
  })

  it('renders the same markup for any 300 demo situations, apart from the situation and the response words, before and after the answer', () => {
    let before: string | undefined
    let after: string | undefined
    for (const seed of SEEDS) {
      const item = demoSjtItem(seed)
      const m = mountSpec(item.spec, { mode })
      const b = withoutTexts(m.container, item.spec)
      answer(m)
      const a = withoutTexts(m.container, item.spec)
      if (before === undefined || after === undefined) {
        before = b
        after = a
      } else {
        expect(b, `before, seed ${seed}`).toBe(before)
        expect(a, `after, seed ${seed}`).toBe(after)
      }
      expect(attributeProblems(m.container), String(seed)).toEqual([])
      m.destroy()
    }
    expect(before).not.toBe(after)
  })

  it('marks no response as the best rated, before or after the response: the markup does not differ with the position of the best or the worst', () => {
    const byBest = new Map<number, string>()
    const byWorst = new Map<number, string>()
    for (const seed of SEEDS) {
      const item = demoSjtItem(seed)
      const m = mountSpec(item.spec, { mode })
      const before = withoutTexts(m.container, item.spec)
      answer(m)
      const html = `${before}\n${withoutTexts(m.container, item.spec)}`
      byBest.set(item.ratings.indexOf(Math.max(...item.ratings)), html)
      byWorst.set(item.ratings.indexOf(Math.min(...item.ratings)), html)
      m.destroy()
    }
    expect(byBest.size).toBe(4)
    expect(new Set(byBest.values()).size).toBe(1)
    expect(byWorst.size).toBe(4)
    expect(new Set(byWorst.values()).size).toBe(1)
  })

  it('does not contain the demo explanation, and no figure with a decimal point (the demo ratings have them)', () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const item = demoSjtItem(seed)
      const m = mountSpec(item.spec, { mode })
      expect(m.container.innerHTML).not.toContain(item.explanation)
      expect(m.container.textContent ?? '').not.toMatch(/\d\.\d/)
      m.destroy()
    }
  })

  it('shows every option identically: the markup of the options of a response differs only by its text and level', () => {
    const m = mountSpec(demoSjtItem(3).spec, { mode })
    const labels = [...m.container.querySelectorAll('label')]
    expect(labels.length).toBe(mode === 'rate' ? 16 : 8)
    const signature = (el: Element): string => {
      const clone = el.cloneNode(true) as Element
      for (const node of [clone, ...clone.querySelectorAll('*')]) for (const a of [...node.attributes]) if (a.name === 'value' || a.name === 'name') node.removeAttribute(a.name)
      const walker = clone.ownerDocument.createTreeWalker(clone, 4)
      const texts: Text[] = []
      while (walker.nextNode()) texts.push(walker.currentNode as Text)
      for (const t of texts) t.data = ''
      return clone.outerHTML
    }
    expect(new Set(labels.map(signature)).size).toBe(1)
  })
})
