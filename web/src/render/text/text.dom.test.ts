/**
 * Text multiple-choice renderer (ROADMAP M3.11 phase 1; DESIGN §10, §11.6, §13, R-11.1): what it shows,
 * that the server's text is written as text and never as markup, the keys, the onset rule, what it
 * sends, and that nothing in the DOM depends on anything but the text and the positions.
 */

import { flushSync } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { CONFIRM_LABEL } from '../choice/keys'
import { attributeProblems } from '../common/leak'
import { buttonByText, click, fakeDisplay, press, render } from '../common/testing'
import { TEXT_MC_COPY } from './copy'
import { DEMO_TEXT_ITEMS } from './demo'
import { textMcSpec, type TextMcSpec } from './spec'
import TextChoiceRenderer from './TextChoiceRenderer.svelte'

let cleanup: (() => void)[] = []
afterEach(() => {
  for (const f of cleanup) f()
  cleanup = []
})

const specOf = (i: number): TextMcSpec => {
  const p = DEMO_TEXT_ITEMS[i]!.payload
  return textMcSpec({ stem: p.stem, media: p.media ?? null, options: p.options })!
}
const SHORT = specOf(0)
const ARGUMENT = specOf(1)
const STIMULUS = specOf(2)

function mountSpec(spec: TextMcSpec = SHORT, extra: Record<string, unknown> = {}, ready = true) {
  const responses: number[] = []
  const shown: number[] = []
  const display = fakeDisplay()
  const r = render(TextChoiceRenderer, { spec, onrespond: (x: number) => responses.push(x), onshown: (t: number) => shown.push(t), timing: display, ...extra })
  cleanup.push(r.destroy)
  if (ready) display.advance(40)
  flushSync()
  const radios = (): HTMLInputElement[] => [...r.container.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
  const confirm = (): HTMLButtonElement => buttonByText(r.container, CONFIRM_LABEL)
  return { ...r, responses, shown, display, radios, confirm }
}

describe('TextChoiceRenderer', () => {
  it('shows the question as the legend of the options, and each option as its letter and its text', () => {
    const m = mountSpec()
    expect(m.container.querySelector('fieldset > legend')?.textContent).toBe(SHORT.stem)
    expect(m.container.querySelector('.reading')).toBeNull()
    const labels = [...m.container.querySelectorAll('label.option')]
    expect(labels).toHaveLength(4)
    expect(labels.map((l) => l.querySelector('.words')?.textContent)).toEqual(SHORT.options)
    // The accessible name of a radio is its label's text: the letter, then the option.
    expect(labels.map((l) => l.textContent?.replace(/\s+/gu, ' ').trim())).toEqual(SHORT.options.map((o, i) => `${'ABCD'[i]}. ${o}`))
    expect(m.radios().map((r) => r.value)).toEqual(['0', '1', '2', '3'])
    expect(new Set(m.radios().map((r) => r.name)).size).toBe(1)
  })

  it('puts an argument in the stem, and a stimulus, in a named group before the question', () => {
    const a = mountSpec(ARGUMENT)
    const group = a.container.querySelector('.reading') as HTMLElement
    expect(group.getAttribute('role')).toBe('group')
    expect(group.getAttribute('aria-label')).toBe(TEXT_MC_COPY.readingLabel)
    expect([...group.querySelectorAll('p')].map((p) => p.textContent)).toEqual([ARGUMENT.stem.split('\n\n')[0]])
    expect(a.container.querySelector('legend')?.textContent).toBe(ARGUMENT.stem.split('\n\n')[1])
    const s = mountSpec(STIMULUS)
    expect([...s.container.querySelectorAll('.reading p')].map((p) => p.textContent)).toEqual(STIMULUS.stimulus)
    expect(s.radios()).toHaveLength(6)
  })

  it('writes the server’s text as text: markup in a stem, a stimulus or an option creates no element and runs nothing', () => {
    const m = mountSpec(STIMULUS)
    expect(m.container.querySelectorAll('script, img, b, i, iframe, a, style, svg')).toHaveLength(0)
    expect(m.container.querySelector('legend')?.textContent).toContain('<b>placeholder</b>')
    expect(m.container.textContent).toContain('<script>window.__hb_text_mc_injected = true</script>')
    expect(m.container.textContent).toContain('<img src=x onerror=')
    expect((globalThis as { __hb_text_mc_injected?: boolean }).__hb_text_mc_injected).toBeUndefined()
    // Every element in the renderer is one of its own.
    const tags = new Set([...m.container.querySelectorAll('.text-mc *')].map((e) => e.tagName))
    expect([...tags].sort()).toEqual(['BUTTON', 'DIV', 'FIELDSET', 'FORM', 'INPUT', 'LABEL', 'LEGEND', 'P', 'SPAN'])
  })

  it('accepts no choice before the first frame showed the question, and reports that frame once', () => {
    const m = mountSpec(SHORT, {}, false)
    expect(m.shown).toEqual([])
    expect(m.container.querySelector('fieldset')?.disabled).toBe(true)
    press('2', m.radios()[0])
    flushSync()
    expect(m.radios().some((r) => r.checked)).toBe(false)
    m.display.advance(40)
    flushSync()
    expect(m.shown).toHaveLength(1)
    expect(m.container.querySelector('fieldset')?.disabled).toBe(false)
    m.display.advance(200)
    expect(m.shown).toHaveLength(1)
  })

  it('answers once with the display position, from the Confirm button', () => {
    const m = mountSpec()
    expect(m.confirm().disabled).toBe(true)
    click(m.radios()[2])
    flushSync()
    expect(m.confirm().disabled).toBe(false)
    click(m.confirm())
    flushSync()
    expect(m.responses).toEqual([2])
    expect(m.container.querySelector('.hb-status')?.textContent).toBe(TEXT_MC_COPY.recorded)
    expect(m.container.querySelector('fieldset')?.disabled).toBe(true)
    click(m.confirm())
    expect(m.responses).toEqual([2])
  })

  it('keys 1 to 6 and A to F pick an option inside the group, Enter on an option answers, and a key for no option does nothing', () => {
    const m = mountSpec(STIMULUS)
    press('3', m.radios()[0])
    flushSync()
    expect(m.radios().map((r) => r.checked)).toEqual([false, false, true, false, false, false])
    press('f', m.radios()[2])
    flushSync()
    expect(m.radios()[5]!.checked).toBe(true)
    press('7', m.radios()[5])
    press('g', m.radios()[5])
    flushSync()
    expect(m.radios()[5]!.checked).toBe(true)
    press('b', m.radios()[5], { ctrlKey: true }) // a browser shortcut is left alone
    flushSync()
    expect(m.radios()[5]!.checked).toBe(true)
    press('Enter', m.radios()[5])
    flushSync()
    expect(m.responses).toEqual([5])
  })

  it('a key pressed outside the group picks nothing (WCAG 2.1.4)', () => {
    const m = mountSpec()
    press('1', document.body)
    flushSync()
    expect(m.radios().some((r) => r.checked)).toBe(false)
  })

  it('is locked while disabled (the confidence slider is up)', () => {
    const m = mountSpec(SHORT, { disabled: true })
    expect(m.container.querySelector('fieldset')?.disabled).toBe(true)
    expect(m.confirm().disabled).toBe(true)
  })

  it('says nothing about right or wrong, and the DOM holds nothing but the text, the positions and its own classes', () => {
    const m = mountSpec(SHORT)
    click(m.radios()[1])
    click(m.confirm())
    flushSync()
    expect(m.container.textContent).not.toMatch(/correct|incorrect|right answer|wrong|well done/iu)
    expect(attributeProblems(m.container)).toEqual([])
    expect(m.container.querySelectorAll('[data-key], [data-correct], [data-answer]')).toHaveLength(0)
  })

  it('draws the same DOM for the same text whatever a key might be: there is nothing else to draw from', () => {
    const a = mountSpec(SHORT).container.querySelector('.text-mc')!.innerHTML
    const b = mountSpec({ ...SHORT }).container.querySelector('.text-mc')!.innerHTML
    const strip = (h: string): string => h.replace(/name="[^"]*"/gu, '')
    expect(strip(a)).toBe(strip(b))
  })
})
