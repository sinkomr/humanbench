/**
 * Emotion vignette renderer (ROADMAP M6.1; DESIGN §5.1, §10, §13, R-5.6.2): the situation and the five
 * feelings, the skill's name and its tooltip (the R-5.6.2 sentence, word for word), what it sends, the
 * keys, and that nothing in the DOM depends on the key.
 */

import { flushSync } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { EMO_AXIS_NAME, EMO_TOOLTIP } from '../../copy'
import { ENTRY_COPY } from '../../tasks/emotion/copy'
import { demoEmotionItem } from '../../tasks/emotion/demo'
import { type EmotionSpec } from '../../tasks/emotion/spec'
import { CONFIRM_LABEL } from '../choice/keys'
import { attributeProblems, normalizeIds } from '../common/leak'
import { buttonByText, click, fakeDisplay, pointerDown, press, render } from '../common/testing'
import EmotionRenderer from './EmotionRenderer.svelte'

let cleanup: (() => void)[] = []
afterEach(() => {
  for (const f of cleanup) f()
  cleanup = []
})

const SPEC: EmotionSpec = {
  stem: 'Ada has been waiting by the window for a parcel. The courier hands over a box with exactly the kite she ordered. How is Ada most likely to feel?',
  options: ['Anger', 'Joy', 'Pride', 'Fear', 'Sadness'],
}

function mountSpec(spec: EmotionSpec = SPEC, extra: Record<string, unknown> = {}, ready = true) {
  const responses: number[] = []
  const shown: number[] = []
  const display = fakeDisplay()
  const r = render(EmotionRenderer, { spec, onrespond: (x: number) => responses.push(x), onshown: (t: number) => shown.push(t), timing: display, ...extra })
  cleanup.push(r.destroy)
  if (ready) display.advance(40)
  const radios = (): HTMLInputElement[] => [...r.container.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
  const form = r.container.querySelector('form') as HTMLFormElement
  const confirm = (): HTMLButtonElement => buttonByText(r.container, CONFIRM_LABEL)
  const tipButton = (): HTMLButtonElement => r.container.querySelector('.tip-button') as HTMLButtonElement
  const panel = (): HTMLElement => r.container.querySelector('[role="tooltip"]') as HTMLElement
  return { ...r, responses, shown, display, radios, form, confirm, tipButton, panel }
}

describe('EmotionRenderer', () => {
  it('names the skill, gives the instruction, shows the situation and labels the options with the question', () => {
    const m = mountSpec()
    const section = m.container.querySelector('section') as HTMLElement
    const title = section.querySelector('.title') as HTMLElement
    expect(title.textContent).toBe(EMO_AXIS_NAME)
    expect(section.getAttribute('aria-labelledby')).toBe(title.id)
    expect(m.container.querySelector('.hb-instructions')?.textContent).toBe(ENTRY_COPY.instructions)
    expect(m.container.querySelector('.scenario')?.textContent).toBe('Ada has been waiting by the window for a parcel. The courier hands over a box with exactly the kite she ordered.')
    expect(m.container.querySelector('legend')?.textContent).toBe('How is Ada most likely to feel?')
    expect(m.container.querySelector('fieldset')).not.toBeNull()
  })

  it('names the situation on a group and never puts an accessible name on the paragraph (ARIA 1.2: a paragraph has no nameable role)', () => {
    const m = mountSpec()
    const p = m.container.querySelector('.scenario') as HTMLElement
    expect(p.tagName).toBe('P')
    for (const attr of ['aria-label', 'aria-labelledby', 'title', 'role']) expect(p.hasAttribute(attr)).toBe(false)
    const group = p.parentElement as HTMLElement
    expect(group.getAttribute('role')).toBe('group')
    expect(group.getAttribute('aria-label')).toBe(ENTRY_COPY.scenarioLabel)
    // the scenario is still the first thing read after the instruction, and the only text in its group
    expect(group.textContent?.trim()).toBe(p.textContent)
  })

  it('offers the five options as radio inputs in spec order, named by their words, none chosen', () => {
    const m = mountSpec()
    expect(m.radios()).toHaveLength(5)
    expect(m.radios().map((r) => r.value)).toEqual(['0', '1', '2', '3', '4'])
    expect(m.radios().map((r) => r.closest('label')?.textContent?.trim())).toEqual([...SPEC.options])
    expect(m.radios().every((r) => !r.checked)).toBe(true)
    expect(new Set(m.radios().map((r) => r.name)).size).toBe(1)
    expect(m.confirm().disabled).toBe(true)
  })

  it('falls back to a generic label when the stem has no closing question', () => {
    const m = mountSpec({ ...SPEC, stem: 'Ada waits by the window.' })
    expect(m.container.querySelector('legend')?.textContent).toBe(ENTRY_COPY.legendFallback)
    expect(m.container.querySelector('.scenario')?.textContent).toBe('Ada waits by the window.')
  })

  it('sends the display position of the chosen option once, then locks', () => {
    const m = mountSpec()
    click(m.radios()[2])
    expect(m.radios()[2]?.checked).toBe(true)
    expect(m.confirm().disabled).toBe(false)
    click(m.confirm())
    expect(m.responses).toEqual([2])
    click(m.confirm()) // a second press does nothing
    m.form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
    flushSync()
    expect(m.responses).toEqual([2])
    expect(m.container.querySelector('fieldset')?.disabled).toBe(true)
    expect(m.confirm().disabled).toBe(true)
    expect(m.container.querySelector('.hb-status')?.textContent).toBe(ENTRY_COPY.recorded)
  })

  it('sends a position, not the option text: the same position for any words', () => {
    const words = { ...SPEC, options: ['Hope', 'Regret', 'Relief', 'Guilt', 'Surprise'] }
    const m = mountSpec(words)
    click(m.radios()[4])
    click(m.confirm())
    expect(m.responses).toEqual([4])
  })

  it('never says whether the answer is right', () => {
    const m = mountSpec()
    click(m.radios()[0])
    click(m.confirm())
    const text = m.container.textContent ?? ''
    expect(text).not.toMatch(/\b(wrong|incorrect|correct|right|mistake|score|well done)\b/i)
  })

  it('accepts no response before the first frame is drawn, and reports that frame once', () => {
    const m = mountSpec(SPEC, {}, false)
    expect(m.shown).toEqual([])
    expect(m.container.querySelector('fieldset')?.disabled).toBe(true)
    click(m.radios()[1])
    expect(m.radios()[1]?.checked).toBe(false)
    m.display.advance(40)
    expect(m.shown).toHaveLength(1)
    expect(m.shown[0]).toBeGreaterThan(1000)
    expect(m.container.querySelector('fieldset')?.disabled).toBe(false)
    m.display.advance(200)
    expect(m.shown).toHaveLength(1)
    click(m.radios()[1])
    click(m.confirm())
    expect(m.responses).toEqual([1])
  })

  it('does nothing while disabled', () => {
    const m = mountSpec(SPEC, { disabled: true })
    expect(m.container.querySelector('fieldset')?.disabled).toBe(true)
    click(m.radios()[0])
    expect(m.radios()[0]?.checked).toBe(false)
    m.form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
    flushSync()
    expect(m.responses).toEqual([])
  })

  describe('keys (while focus is in the group)', () => {
    it('1 to 5 and A to E choose an option, and Enter on an option answers', () => {
      const m = mountSpec()
      m.radios()[0]?.focus()
      press('3')
      expect(m.radios()[2]?.checked).toBe(true)
      expect(document.activeElement).toBe(m.radios()[2])
      press('b')
      expect(m.radios()[1]?.checked).toBe(true)
      press('E')
      expect(m.radios()[4]?.checked).toBe(true)
      expect(m.responses).toEqual([])
      press('Enter')
      expect(m.responses).toEqual([4])
    })

    it('ignores a key with a modifier, a position that does not exist and any other key', () => {
      const m = mountSpec()
      m.radios()[0]?.focus()
      press('2', undefined, { ctrlKey: true })
      press('2', undefined, { metaKey: true })
      press('2', undefined, { altKey: true })
      press('7')
      press('z')
      press('Enter')
      expect(m.radios().every((r) => !r.checked)).toBe(true)
      expect(m.responses).toEqual([])
    })

    it('do not act when focus is outside the group (WCAG 2.1.4)', () => {
      const m = mountSpec()
      press('2', document.body)
      press('2', m.container.querySelector('.scenario'))
      expect(m.radios().every((r) => !r.checked)).toBe(true)
    })
  })

  describe('the tooltip (R-5.6.2)', () => {
    it('is a button that names the skill, with the sentence of DESIGN R-5.6.2 word for word in the DOM', () => {
      const m = mountSpec()
      expect(m.tipButton().textContent?.trim()).toBe(ENTRY_COPY.tipButton)
      expect(m.tipButton().getAttribute('aria-label')).toBe(`${ENTRY_COPY.tipButton}: ${EMO_AXIS_NAME}`)
      expect(m.panel().querySelector('.text')?.textContent).toBe(EMO_TOOLTIP)
      expect(m.panel().querySelector('.text')?.textContent).toBe(
        'Measures agreement with appraisal-theory and consensus keys. Not a diagnostic or clinical measure; scores are strongly affected by vocabulary, culture and test familiarity.',
      )
      expect(m.tipButton().getAttribute('aria-describedby')).toBe(m.panel().id)
      expect(m.tipButton().getAttribute('aria-controls')).toBe(m.panel().id)
    })

    it('is closed to start, and the button opens and closes it', () => {
      const m = mountSpec()
      expect(m.panel().hidden).toBe(true)
      expect(m.tipButton().getAttribute('aria-expanded')).toBe('false')
      click(m.tipButton())
      expect(m.panel().hidden).toBe(false)
      expect(m.tipButton().getAttribute('aria-expanded')).toBe('true')
      click(m.tipButton())
      expect(m.panel().hidden).toBe(true)
      expect(m.tipButton().getAttribute('aria-expanded')).toBe('false')
    })

    it('Escape closes it, and returns focus to the button when focus was inside', () => {
      const m = mountSpec()
      click(m.tipButton())
      m.tipButton().blur()
      m.panel().setAttribute('tabindex', '-1')
      m.panel().focus()
      expect(m.container.querySelector('.skill-tip')?.contains(document.activeElement)).toBe(true)
      press('Escape', document.activeElement)
      expect(m.panel().hidden).toBe(true)
      expect(document.activeElement).toBe(m.tipButton())
      press('Escape', m.tipButton()) // nothing open: nothing happens
      expect(m.panel().hidden).toBe(true)
    })

    it('Escape closes it even when focus is elsewhere (Safari does not focus a clicked button)', () => {
      const m = mountSpec()
      click(m.tipButton())
      ;(document.activeElement as HTMLElement | null)?.blur()
      expect(m.panel().hidden).toBe(false)
      press('Escape', document.body)
      expect(m.panel().hidden).toBe(true)
      expect(m.tipButton().getAttribute('aria-expanded')).toBe('false')
    })

    it('stops listening for keys once it is closed', () => {
      const m = mountSpec()
      click(m.tipButton())
      click(m.tipButton())
      const ev = press('Escape', document.body)
      expect(ev.defaultPrevented).toBe(false)
      expect(m.panel().hidden).toBe(true)
    })

    it('closes on a press outside, not on a press inside', () => {
      const m = mountSpec()
      click(m.tipButton())
      pointerDown(m.panel().querySelector('.text'))
      expect(m.panel().hidden).toBe(false)
      pointerDown(m.container.querySelector('.scenario'))
      expect(m.panel().hidden).toBe(true)
    })

    it('opens on a mouse hovering and closes when it leaves, unless it was opened by a click; a touch does not hover', () => {
      const m = mountSpec()
      const wrap = m.tipButton().closest('.skill-tip') as HTMLElement
      const hover = (type: 'pointerenter' | 'pointerleave', pointerType: string): void => {
        const ev = new MouseEvent(type, { bubbles: false })
        Object.defineProperty(ev, 'pointerType', { value: pointerType })
        wrap.dispatchEvent(ev)
        flushSync()
      }
      hover('pointerenter', 'touch')
      expect(m.panel().hidden).toBe(true)
      hover('pointerenter', 'mouse')
      expect(m.panel().hidden).toBe(false)
      hover('pointerleave', 'mouse')
      expect(m.panel().hidden).toBe(true)
      hover('pointerenter', 'mouse')
      click(m.tipButton()) // pinned open by the click
      hover('pointerleave', 'mouse')
      expect(m.panel().hidden).toBe(false)
      click(m.tipButton())
      expect(m.panel().hidden).toBe(true)
    })

    it('opening it does not move or lock the question', () => {
      const m = mountSpec()
      click(m.tipButton())
      click(m.radios()[3])
      click(m.confirm())
      expect(m.responses).toEqual([3])
    })
  })
})

/** The markup with the generated ids and the radio group's generated name erased. */
const markup = (root: HTMLElement): string => normalizeIds(root).replace(/name="[a-z]+\d+"/g, 'name="ID"')

describe('nothing in the DOM depends on the key', () => {
  it('has no data attribute and no attribute that names an answer, before and after answering', () => {
    const m = mountSpec()
    expect(attributeProblems(m.container)).toEqual([])
    click(m.radios()[1])
    click(m.confirm())
    expect(attributeProblems(m.container)).toEqual([])
  })

  it('renders the same markup for any 300 demo situations, apart from the situation and the option words', () => {
    let first: string | undefined
    for (let seed = 0; seed < 300; seed++) {
      const item = demoEmotionItem(seed)
      const m = mountSpec(item.spec)
      let html = markup(m.container)
      html = html.replace(/<p class="scenario[^"]*"[^>]*>[^<]*<\/p>/, '<p class="scenario"></p>').replace(/<legend[^>]*>[^<]*<\/legend>/, '<legend></legend>')
      html = html.replace(/<span class="word[^"]*">[^<]*<\/span>/g, '<span class="word"></span>')
      if (first === undefined) first = html
      else expect(html, String(seed)).toBe(first)
      m.destroy()
    }
  })

  it('marks no option as the intended answer, before or after the response: the markup does not differ with the answer position', () => {
    const byPosition = new Map<number, string>()
    for (let seed = 0; seed < 300; seed++) {
      const item = demoEmotionItem(seed)
      const m = mountSpec(item.spec)
      const html = markup(m.container)
        .replace(/<p class="scenario[^"]*"[^>]*>[^<]*<\/p>/, '')
        .replace(/<legend[^>]*>[^<]*<\/legend>/, '')
        .replace(/<span class="word[^"]*">[^<]*<\/span>/g, '')
      const seen = byPosition.get(item.answer_index)
      if (seen === undefined) byPosition.set(item.answer_index, html)
      m.destroy()
    }
    expect(byPosition.size).toBe(5)
    expect(new Set(byPosition.values()).size).toBe(1)
  })

  it('does not contain the demo explanation before an answer is given', () => {
    for (let seed = 0; seed < 40; seed++) {
      const item = demoEmotionItem(seed)
      const m = mountSpec(item.spec)
      expect(m.container.innerHTML).not.toContain(item.explanation)
      m.destroy()
    }
  })
})
