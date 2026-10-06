/**
 * The shared multiple-choice group (ROADMAP M1.13, A18; DESIGN §13; UX-021): Confirm is the session's
 * primary button, a touch tap that lands while the group is still settling selects nothing (the second
 * tap of a double tap on the previous screen's button), and mouse, pen and keyboard selection is never
 * held back.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRawSnippet, flushSync } from 'svelte'
import { CONFIRM_LABEL } from './keys'
import { click, mountInto, optionInputs, press, type Mounted } from '../dom-testing'
import OptionGroup from './OptionGroup.svelte'
import source from './OptionGroup.svelte?raw'

let mounted: Mounted | undefined
afterEach(() => {
  mounted?.destroy()
  mounted = undefined
  vi.restoreAllMocks()
})

/** A pointer press on `el` at a point (jsdom has no PointerEvent: a MouseEvent of that type with `pointerType` set). */
function tap(el: Element | undefined, pointerType: string, x: number, y: number): void {
  const e = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y })
  Object.defineProperty(e, 'pointerType', { value: pointerType })
  el?.dispatchEvent(e)
  flushSync()
}

const figure = createRawSnippet((i: () => number) => ({ render: () => `<span class="fig">figure ${i()}</span>` }))

function mountGroup(extra: Record<string, unknown> = {}) {
  const onrespond = vi.fn<(i: number) => void>()
  mounted = mountInto(OptionGroup, { count: 4, legend: 'Options', optionName: (i: number) => `Option ${'ABCD'[i]}`, option: figure, onrespond, ...extra } as never)
  const root = mounted.target
  const confirm = [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === CONFIRM_LABEL) as HTMLButtonElement
  return { root, onrespond, confirm, inputs: optionInputs(root), form: root.querySelector('form') as HTMLFormElement }
}

describe('OptionGroup', () => {
  it('Confirm is the shared primary button, disabled (and looking it) until an option is chosen', () => {
    const { confirm, inputs } = mountGroup()
    expect(confirm.className).toContain('hb-btn')
    expect(confirm.className).toContain('hb-primary')
    expect(confirm.disabled).toBe(true)
    click(inputs[1] as HTMLInputElement)
    expect(confirm.disabled).toBe(false)
  })

  it('carries the render tokens, so the shared button and focus ring rules apply even outside a session screen', () => {
    const { form } = mountGroup()
    expect(form.classList.contains('hb-render')).toBe(true)
    expect(form.classList.contains('choice')).toBe(true)
  })

  it('the second tap of a double tap, at the spot of a tap made before the group appeared, selects nothing (SKIM-15)', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(4920)
    tap(document.body, 'touch', 70, 450) // the tap on the previous screen's button
    clock.mockReturnValue(5000)
    const { inputs, confirm } = mountGroup()
    clock.mockReturnValue(5080)
    const first = inputs[0] as HTMLInputElement
    tap(first, 'touch', 72, 448) // 80 ms after the group appeared, at the same spot
    click(first)
    expect(first.checked).toBe(false)
    expect(confirm.disabled).toBe(true)
  })

  it('a tap that is only fast, somewhere else, selects (the e2e drivers tap within 200 ms of an item appearing)', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(4900)
    tap(document.body, 'touch', 70, 450)
    clock.mockReturnValue(5000)
    const { inputs } = mountGroup()
    clock.mockReturnValue(5200)
    const second = inputs[1] as HTMLInputElement
    tap(second, 'touch', 195, 331)
    click(second)
    expect(second.checked).toBe(true)
  })

  it('a touch tap with no earlier tap, or a tap at the same spot once the group has settled, selects', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(5000)
    const { inputs } = mountGroup()
    clock.mockReturnValue(5050)
    tap(inputs[0], 'touch', 10, 10)
    click(inputs[0] as HTMLInputElement)
    expect(inputs[0]?.checked).toBe(true)
    // Same spot twice on the group itself: the first tap came after it appeared, so it is not a tap of the previous screen.
    clock.mockReturnValue(5120)
    tap(inputs[0], 'touch', 10, 10)
    click(inputs[0] as HTMLInputElement)
    expect(inputs[0]?.checked).toBe(true)
    mounted?.destroy()
    clock.mockReturnValue(6000)
    tap(document.body, 'touch', 70, 450)
    const late = mountGroup()
    clock.mockReturnValue(6000 + 350)
    tap(late.inputs[2], 'touch', 70, 450)
    click(late.inputs[2] as HTMLInputElement)
    expect(late.inputs[2]?.checked).toBe(true)
  })

  it('mouse and pen are never held back, even at the spot of an earlier touch tap', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(4950)
    tap(document.body, 'touch', 70, 450)
    clock.mockReturnValue(5000)
    const { inputs } = mountGroup()
    clock.mockReturnValue(5050)
    tap(inputs[0], 'mouse', 70, 450)
    click(inputs[0] as HTMLInputElement)
    expect(inputs[0]?.checked).toBe(true)
    clock.mockReturnValue(5060)
    tap(inputs[1], 'pen', 70, 450)
    click(inputs[1] as HTMLInputElement)
    expect(inputs[1]?.checked).toBe(true)
  })

  it('a key pressed right after a touch tap picks its option (keys are not taps)', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(4950)
    tap(document.body, 'touch', 70, 450)
    clock.mockReturnValue(5000)
    const { inputs } = mountGroup()
    clock.mockReturnValue(5050)
    tap(inputs[0], 'touch', 70, 450)
    inputs[2]?.focus()
    press(inputs[2] as HTMLInputElement, '4')
    expect(inputs[3]?.checked).toBe(true)
  })

  it('a held-back tap leaves the choice exactly as it was', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(4900)
    tap(document.body, 'touch', 70, 450)
    clock.mockReturnValue(5000)
    const { inputs, confirm } = mountGroup()
    clock.mockReturnValue(5100)
    inputs[1]?.focus()
    press(inputs[1] as HTMLInputElement, '2') // chosen by key
    expect(inputs[1]?.checked).toBe(true)
    tap(inputs[0], 'touch', 70, 450)
    click(inputs[0] as HTMLInputElement)
    expect(inputs[1]?.checked).toBe(true)
    expect(inputs[0]?.checked).toBe(false)
    expect(confirm.disabled).toBe(false)
  })

  it('flush and maxWidth reach the grid (the matrices renderer sizes its options like its grid cells)', () => {
    const { root } = mountGroup({ flush: true, maxWidth: '22.5rem' })
    const options = root.querySelector('.options') as HTMLElement
    expect(options.classList.contains('flush')).toBe(true)
    expect(options.style.getPropertyValue('--max')).toBe('22.5rem')
    mounted?.destroy()
    const plain = mountGroup().root.querySelector('.options') as HTMLElement
    expect(plain.classList.contains('flush')).toBe(false)
  })

  it('takes its dark card border for screens only: paper prints with the light border, as app.css and render.css do (UX-027)', () => {
    const style = source.slice(source.indexOf('<style>'))
    // Every colour-scheme query of the sheet is the screen-only form; the plain form would darken the border on a printed page.
    const queries = [...style.matchAll(/@media[^{]*prefers-color-scheme[^{]*\{/g)].map((m) => m[0].replace(/\s+/g, ' ').trim())
    expect(queries).toEqual(['@media screen and (prefers-color-scheme: dark) {'])
    const dark = style.slice(style.indexOf(queries[0] as string))
    expect(dark.slice(0, dark.indexOf('fieldset'))).toMatch(/\.choice\s*\{\s*--hb-card-border:\s*#8d8b95;/)
  })
})
