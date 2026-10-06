/**
 * Word links renderer (ROADMAP M6.3; DESIGN §3 row 17, §5.4, §10, §13): the three cues, the typed answer and what it
 * sends, the empty and over-long entries, the first-frame unlock, the paste report, and that nothing in the DOM depends
 * on the key (a scan over every practice puzzle in every cue order).
 */

import { flushSync } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { ENTRY_COPY } from '../../tasks/rat/copy'
import { DEMO_PUZZLES, demoRatItem } from '../../tasks/rat/demo'
import { MAX_ANSWER_CHARS, type RatSpec } from '../../tasks/rat/spec'
import { attributeProblems, containsWhole, normalizeIds, tokensOf } from '../common/leak'
import { buttonByText, click, fakeDisplay, press, render, typeInto } from '../common/testing'
import RatRenderer from './RatRenderer.svelte'

let cleanup: (() => void)[] = []
afterEach(() => {
  for (const f of cleanup) f()
  cleanup = []
})

const SPEC: RatSpec = { cues: ['cottage', 'swiss', 'cake'] }

function mountSpec(spec: RatSpec = SPEC, extra: Record<string, unknown> = {}, ready = true) {
  const responses: string[] = []
  const shown: number[] = []
  const pastes: { t_ms: number }[] = []
  const display = fakeDisplay()
  const r = render(RatRenderer, {
    spec,
    onrespond: (x: string) => responses.push(x),
    onshown: (t: number) => shown.push(t),
    onpaste: (e: { t_ms: number }) => pastes.push(e),
    timing: display,
    ...extra,
  })
  cleanup.push(r.destroy)
  if (ready) display.advance(40)
  const input = (): HTMLInputElement => r.container.querySelector('input') as HTMLInputElement
  const form = r.container.querySelector('form') as HTMLFormElement
  const confirm = (): HTMLButtonElement => buttonByText(r.container, ENTRY_COPY.submit)
  const note = (): HTMLElement => r.container.querySelector('.hb-note') as HTMLElement
  const status = (): string => r.container.querySelector('.hb-status')?.textContent ?? ''
  /** What Enter in the box does in a browser: submits the form (jsdom has no implicit submission). */
  const enter = (): void => {
    form.requestSubmit()
    flushSync()
  }
  return { ...r, responses, shown, pastes, display, input, form, confirm, note, status, enter }
}

describe('RatRenderer', () => {
  it('names the entry, gives the instruction, and shows the three cues as a list in the order of the spec', () => {
    const m = mountSpec()
    const section = m.container.querySelector('section') as HTMLElement
    expect(section.classList.contains('hb-render')).toBe(true)
    expect(section.classList.contains('rat')).toBe(true)
    const title = section.querySelector('.title') as HTMLElement
    expect(title.textContent).toBe('Word links')
    expect(section.getAttribute('aria-labelledby')).toBe(title.id)
    expect(m.container.querySelector('.hb-instructions')?.textContent).toBe(ENTRY_COPY.instructions)
    const list = m.container.querySelector('ul') as HTMLElement
    expect(list.getAttribute('role')).toBe('list')
    expect(list.getAttribute('aria-label')).toBe(ENTRY_COPY.cuesLabel)
    expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['cottage', 'swiss', 'cake'])
  })

  it('has one labelled text box that asks for no help from the browser, and a Confirm button', () => {
    const m = mountSpec()
    expect(m.container.querySelectorAll('input')).toHaveLength(1)
    const input = m.input()
    const label = m.container.querySelector(`label[for="${input.id}"]`)
    expect(label?.textContent).toBe('Linking word')
    expect(input.type).toBe('text')
    expect(input.getAttribute('autocomplete')).toBe('off')
    expect(input.getAttribute('autocorrect')).toBe('off')
    expect(input.getAttribute('autocapitalize')).toBe('off')
    expect(input.getAttribute('spellcheck')).toBe('false')
    expect(input.maxLength).toBe(MAX_ANSWER_CHARS)
    expect(input.value).toBe('')
    expect(m.confirm().type).toBe('submit')
    expect(m.confirm().closest('form')).toBe(m.form)
  })

  it('sends the typed text, trimmed, once, and then locks', () => {
    const m = mountSpec()
    typeInto(m.input(), '  Cheese-Cake ')
    click(m.confirm())
    expect(m.responses).toEqual(['Cheese-Cake'])
    click(m.confirm()) // a second press does nothing
    m.enter()
    typeInto(m.input(), 'brush')
    m.enter()
    expect(m.responses).toEqual(['Cheese-Cake'])
    expect(m.input().readOnly).toBe(true)
    expect(m.confirm().disabled).toBe(true)
    expect(m.status()).toBe(ENTRY_COPY.recorded)
    expect(m.note().textContent).toBe('')
  })

  it('sends the text as typed: no case folding, no spelling change (the server compares it with the key)', () => {
    const m = mountSpec()
    typeInto(m.input(), 'Chéese')
    m.enter()
    expect(m.responses).toEqual(['Chéese'])
  })

  it('answers when Enter is pressed in the box (a form submit)', () => {
    const m = mountSpec()
    typeInto(m.input(), 'cheese')
    m.enter()
    expect(m.responses).toEqual(['cheese'])
  })

  it('does not send an empty or blank entry: a note says so, the box is marked and named by it, and focus returns to the box', () => {
    const m = mountSpec()
    for (const blank of ['', '   ', ' \t ']) {
      typeInto(m.input(), blank)
      m.confirm().focus()
      click(m.confirm())
      expect(m.responses).toEqual([])
      expect(m.note().textContent).toBe(ENTRY_COPY.emptyNote)
      expect(m.note().getAttribute('aria-live')).toBe('polite')
      expect(m.input().getAttribute('aria-invalid')).toBe('true')
      expect(m.input().getAttribute('aria-describedby')).toBe(m.note().id)
      expect(document.activeElement).toBe(m.input())
      expect(m.status()).toBe('')
      expect(m.input().readOnly).toBe(false)
      typeInto(m.input(), 'x') // typing clears the note
      expect(m.note().textContent).toBe('')
      expect(m.input().hasAttribute('aria-invalid')).toBe(false)
    }
    typeInto(m.input(), 'cheese')
    m.enter()
    expect(m.responses).toEqual(['cheese'])
  })

  it('keeps the box described by its note when there is no note', () => {
    const m = mountSpec()
    expect(m.input().getAttribute('aria-describedby')).toBe(m.note().id)
    expect(m.note().textContent).toBe('')
    expect(m.input().hasAttribute('aria-invalid')).toBe(false)
  })

  it('does not send more than the longest answer, if a value that long gets past maxlength', () => {
    const m = mountSpec()
    typeInto(m.input(), 'x'.repeat(MAX_ANSWER_CHARS + 1))
    m.enter()
    expect(m.responses).toEqual([])
    expect(m.note().textContent).toBe(ENTRY_COPY.longNote)
    expect(m.input().getAttribute('aria-invalid')).toBe('true')
    typeInto(m.input(), 'x'.repeat(MAX_ANSWER_CHARS))
    m.enter()
    expect(m.responses).toEqual(['x'.repeat(MAX_ANSWER_CHARS)])
  })

  it('never says whether the answer is right', () => {
    const m = mountSpec()
    typeInto(m.input(), 'brush')
    m.enter()
    expect(m.responses).toEqual(['brush'])
    const text = m.container.textContent ?? ''
    expect(text).not.toMatch(/\b(wrong|incorrect|correct|right|mistake|score|well done)\b/i)
  })

  it('accepts no response before the first frame is drawn, and reports that frame once', () => {
    const m = mountSpec(SPEC, {}, false)
    expect(m.shown).toEqual([])
    expect(m.input().disabled).toBe(true)
    expect(m.confirm().disabled).toBe(true)
    m.input().value = 'cheese'
    m.enter()
    expect(m.responses).toEqual([])
    m.display.advance(40)
    expect(m.shown).toHaveLength(1)
    expect(m.shown[0]).toBeGreaterThan(1000)
    expect(m.input().disabled).toBe(false)
    expect(m.confirm().disabled).toBe(false)
    m.display.advance(200)
    expect(m.shown).toHaveLength(1)
    typeInto(m.input(), 'cheese')
    click(m.confirm())
    expect(m.responses).toEqual(['cheese'])
  })

  it('asks for a frame at mount and gives it back when it is unmounted first', () => {
    const m = mountSpec(SPEC, {}, false)
    expect(m.display.pending()).toBe(1)
    m.destroy()
    expect(m.display.pending()).toBe(0)
    m.display.advance(100)
    expect(m.shown).toEqual([])
  })

  it('does nothing while disabled, and works once it is not', () => {
    const m = mountSpec(SPEC, { disabled: true })
    expect(m.input().disabled).toBe(true)
    expect(m.confirm().disabled).toBe(true)
    m.input().value = 'cheese'
    m.enter()
    expect(m.responses).toEqual([])
    expect(m.status()).toBe('')
  })

  it('reports each paste into the box, at the time of the clock', () => {
    const m = mountSpec()
    m.display.clock.set(2345)
    m.input().dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }))
    m.display.clock.set(2400)
    m.input().dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }))
    expect(m.pastes).toEqual([{ t_ms: 2345 }, { t_ms: 2400 }])
    expect(m.responses).toEqual([])
  })

  it('is fine without an onshown or an onpaste', () => {
    const r = render(RatRenderer, { spec: SPEC, onrespond: () => undefined, timing: fakeDisplay() })
    cleanup.push(r.destroy)
    expect(r.container.querySelector('input')).not.toBeNull()
  })

  describe('keys', () => {
    it('Enter that ends an IME composition is not a submit; a plain Enter is left to the form', () => {
      const m = mountSpec()
      const composing = press('Enter', m.input(), { isComposing: true })
      expect(composing.defaultPrevented).toBe(true)
      const safari = press('Enter', m.input(), { keyCode: 229 })
      expect(safari.defaultPrevented).toBe(true)
      const plain = press('Enter', m.input())
      expect(plain.defaultPrevented).toBe(false)
      const letter = press('a', m.input())
      expect(letter.defaultPrevented).toBe(false)
    })

    it('has no key shortcuts: letters and digits are for typing (WCAG 2.1.4)', () => {
      const m = mountSpec()
      for (const k of ['1', '2', '3', 'a', 'b', 'c']) expect(press(k, m.input()).defaultPrevented, k).toBe(false)
      press('Enter', document.body)
      expect(m.responses).toEqual([])
    })
  })

  describe('the DOM does not depend on the key', () => {
    const SEEDS = Array.from({ length: 300 }, (_v, i) => i)

    it('holds no data attribute and no attribute that names an answer, over every practice puzzle', () => {
      for (const seed of SEEDS) {
        const item = demoRatItem(seed)
        const m = mountSpec(item.spec)
        expect(attributeProblems(m.container), String(seed)).toEqual([])
        m.destroy()
      }
    })

    it('never has the word, its accepted spellings or a compound in the text or the markup, before or after an answer', () => {
      for (const seed of SEEDS) {
        const item = demoRatItem(seed)
        const m = mountSpec(item.spec)
        const check = (when: string): void => {
          const html = normalizeIds(m.container)
          const tokens = tokensOf(m.container.textContent ?? '')
          for (const a of item.accept) {
            expect(tokens, `${seed} ${when}: ${a}`).not.toContain(a)
            expect(containsWhole(html.toLowerCase(), a), `${seed} ${when}: ${a} in the markup`).toBe(false)
          }
          for (const c of item.compounds) expect(m.container.textContent?.toLowerCase(), `${seed} ${when}: ${c}`).not.toContain(c.toLowerCase())
        }
        check('before')
        typeInto(m.input(), 'wrong guess')
        m.enter()
        check('after')
        m.destroy()
      }
    })

    it('is the same markup for every puzzle but the three cue texts', () => {
      const skeleton = (spec: RatSpec): string => {
        const m = mountSpec(spec)
        let html = normalizeIds(m.container)
        for (const cue of spec.cues) html = html.replace(`>${cue}<`, '>CUE<')
        m.destroy()
        return html
      }
      const reference = skeleton(demoRatItem(0).spec)
      expect(reference).toContain('>CUE<')
      for (const p of DEMO_PUZZLES) {
        for (const spec of [{ cues: [...p.cues] as RatSpec['cues'] }, { cues: [p.cues[2], p.cues[0], p.cues[1]] as RatSpec['cues'] }]) expect(skeleton(spec)).toBe(reference)
      }
    })

    it('draws nothing from a field of the spec but its cues', () => {
      const spec = { cues: SPEC.cues, answer: 'cheese', accept: ['cheese'], solution: 'cheese', hint: 'a dairy product' } as unknown as RatSpec
      const m = mountSpec(spec)
      expect(m.container.innerHTML.toLowerCase()).not.toMatch(/cheese|dairy/)
      expect(normalizeIds(m.container)).toBe(normalizeIds(mountSpec(SPEC).container)) // the markup of the plain spec, ids apart
    })
  })
})
