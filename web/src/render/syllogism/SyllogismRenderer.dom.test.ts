/**
 * syllogism renderer in jsdom (DESIGN §3 row 2, §11.6, §13; ROADMAP M1.13, A18): what it draws (the intro, the
 * statements as a named numbered list, the question as the legend, five text options), keyboard and pointer responding
 * (only after the onset), the response contract with `syllogism.score()`, the onset callback, and that nothing in the
 * DOM depends on the key.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { syllogism, type SyllogismItem } from '../../tasks/syllogism'
import { specProblems } from '../../tasks/syllogism/spec'
import { CONFIRM_LABEL, optionLetter } from '../choice/keys'
import { click, mountInto, nextFrame, optionInputs, press, settle, type Mounted } from '../dom-testing'
import { STATEMENTS_LABEL, optionName } from './copy'
import SyllogismRenderer from './SyllogismRenderer.svelte'

let mounted: Mounted[] = []
afterEach(() => {
  for (const m of mounted) m.destroy()
  mounted = []
})

function firstOf(template: string, prefix: string): SyllogismItem {
  for (let i = 0; i < 400; i++) {
    const it = syllogism.generate(`${prefix}-${i}`, { stratum: (i % 6) + 1 })
    if (it.difficulty.features.template === template) return it
  }
  throw new Error(`no ${template} item`)
}

function render(item: SyllogismItem, extra: { disabled?: boolean; onshown?: (t: number) => void } = {}) {
  const onrespond = vi.fn<(r: number) => void>()
  const m = mountInto(SyllogismRenderer, { spec: item.spec, onrespond, ...extra })
  mounted.push(m)
  return { item, onrespond, root: m.target }
}

async function renderShown(item: SyllogismItem, extra: { disabled?: boolean } = {}) {
  const r = render(item, extra)
  await settle()
  return r
}

const confirmButton = (root: HTMLElement): HTMLButtonElement => {
  const b = [...root.querySelectorAll('button')].find((x) => x.textContent?.trim() === CONFIRM_LABEL)
  if (!b) throw new Error('no confirm button')
  return b
}

const CAT = firstOf('categorical', 'dom-cat')
const CHAIN = firstOf('chain', 'dom-chain')
const COND = firstOf('conditional', 'dom-cond')

describe('SyllogismRenderer', () => {
  it('draws the intro, the statements as a named numbered list, the question as the legend and five text options', async () => {
    for (const item of [CAT, CHAIN, COND]) {
      const { root } = await renderShown(item)
      const intro = root.querySelector('.intro')
      if (item.spec.intro === undefined) expect(intro).toBeNull()
      else expect(intro?.textContent).toBe(item.spec.intro)
      const list = root.querySelector('ol') as HTMLOListElement
      expect(list.getAttribute('aria-label')).toBe(STATEMENTS_LABEL)
      expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual(item.spec.premises)
      expect(root.querySelector('legend')?.textContent).toBe(item.spec.question)
      const inputs = optionInputs(root)
      expect(inputs).toHaveLength(5)
      expect(inputs.map((x) => x.getAttribute('aria-label'))).toEqual(item.spec.options.map((o, i) => optionName(optionLetter(i), o)))
      expect([...root.querySelectorAll('.words')].map((w) => w.textContent)).toEqual(item.spec.options)
    }
  })

  it('writes the text as text, never as markup', async () => {
    const spec = { ...CAT.spec, premises: ['<b>All</b> blickets are florps.', CAT.spec.premises[1] as string] }
    const { root } = await renderShown({ ...CAT, spec })
    expect(root.querySelector('b')).toBeNull()
    expect(root.querySelector('li')?.textContent).toBe('<b>All</b> blickets are florps.')
  })

  it('picks with number and letter keys, and Enter responds once with the display position', async () => {
    const { item, onrespond, root } = await renderShown(COND)
    const inputs = optionInputs(root)
    inputs[0]?.focus()
    press(document.activeElement as Element, '5')
    expect(inputs[4]?.checked).toBe(true)
    press(document.activeElement as Element, 'b')
    expect(inputs[1]?.checked).toBe(true)
    expect(onrespond).not.toHaveBeenCalled()
    press(document.activeElement as Element, 'Enter')
    expect(onrespond).toHaveBeenCalledExactlyOnceWith(1)
    expect(syllogism.score(item, 1).correct).toBe(item.key.index === 1 ? 1 : 0)
    press(document.activeElement as Element, 'Enter')
    expect(onrespond).toHaveBeenCalledTimes(1)
  })

  it('responds by pointer: click an option, then Confirm', async () => {
    const { onrespond, root } = await renderShown(CHAIN)
    const confirm = confirmButton(root)
    expect(confirm.disabled).toBe(true)
    click(optionInputs(root)[3] as HTMLInputElement)
    click(confirm)
    expect(onrespond).toHaveBeenCalledExactlyOnceWith(3)
  })

  it('ignores keys and clicks while disabled', async () => {
    const { onrespond, root } = await renderShown(CAT, { disabled: true })
    const inputs = optionInputs(root)
    expect(inputs.every((x) => x.matches(':disabled'))).toBe(true)
    press(inputs[0] as HTMLInputElement, '2')
    click(confirmButton(root))
    expect(onrespond).not.toHaveBeenCalled()
  })

  it('accepts no choice before the onset, and reports the onset once from an animation frame', async () => {
    const onshown = vi.fn<(t: number) => void>()
    const { onrespond, root } = render(CAT, { onshown })
    const inputs = optionInputs(root)
    expect(inputs.every((x) => x.matches(':disabled'))).toBe(true)
    click(inputs[2] as HTMLInputElement)
    click(confirmButton(root))
    expect(onrespond).not.toHaveBeenCalled()
    expect(onshown).not.toHaveBeenCalled()
    const frame = await nextFrame()
    await settle()
    expect(onshown).toHaveBeenCalledTimes(1)
    expect(onshown.mock.calls[0]?.[0]).toBeLessThanOrEqual(frame)
    click(inputs[2] as HTMLInputElement)
    click(confirmButton(root))
    expect(onrespond).toHaveBeenCalledExactlyOnceWith(2)
  })
})

describe('SyllogismRenderer leaks nothing about the key', () => {
  const HINT = /key|correct|answer|solution|score|right_|wrong/i

  it('writes nothing item-level beyond the spec, no data-* attributes, no hinting names', async () => {
    for (let i = 0; i < 30; i++) {
      const item = syllogism.generate(`leak-${i}`)
      const { root } = await renderShown(item)
      const html = root.innerHTML
      for (const s of [item.item_id, item.family_id, item.seed, JSON.stringify(item.key), JSON.stringify(item.structural_params)]) expect(html).not.toContain(s)
      for (const el of [...root.querySelectorAll('*')]) {
        for (const a of [...el.attributes]) {
          expect(a.name.startsWith('data-')).toBe(false)
          if (a.name !== 'aria-label') expect(`${a.name}=${a.value}`).not.toMatch(HINT)
        }
      }
      for (const m of mounted) m.destroy()
      mounted = []
    }
  })

  it('draws each option from its own text only: moving the key to another position moves its markup, nothing else changes', async () => {
    for (const base of [CAT, CHAIN, COND]) {
      const k = base.key.index
      const j = (k + 1) % 5
      const options = [...base.spec.options]
      ;[options[k], options[j]] = [options[j] as string, options[k] as string]
      const swapped = { ...base.spec, options }
      expect(specProblems(swapped)).toEqual([])
      const a = (await renderShown(base)).root
      const b = (await renderShown({ ...base, spec: swapped })).root
      const labelsA = [...a.querySelectorAll('form label')].map((l) => l.querySelector('.words')?.outerHTML)
      const labelsB = [...b.querySelectorAll('form label')].map((l) => l.querySelector('.words')?.outerHTML)
      expect(labelsB[j]).toBe(labelsA[k])
      expect(labelsB[k]).toBe(labelsA[j])
      expect(a.querySelector('ol')?.outerHTML).toBe(b.querySelector('ol')?.outerHTML)
      // Every option label has the same markup once its own text and position are factored out.
      const skeleton = (root: HTMLElement) =>
        [...root.querySelectorAll('form label')].map((l) =>
          l.outerHTML
            .replace(/<span class="words[^"]*">[^<]*<\/span>/, '')
            .replace(/aria-label="[^"]*"/, '')
            .replace(/value="\d"/, '')
            .replace(/>[A-E]</, '><'),
        )
      expect(new Set(skeleton(a)).size).toBe(1)
    }
  })
})
