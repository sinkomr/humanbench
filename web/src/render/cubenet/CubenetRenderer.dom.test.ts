/**
 * Cube-net renderer in jsdom (DESIGN §3 row 7, §4.2, §11.6, §13; ROADMAP A18): what it draws, its
 * complete and neutral text alternatives, keyboard and pointer responding (only after the onset),
 * the response contract with `cubenet.score()`, the onset callback, and no key in the DOM (the
 * DOM is a function of the spec, and each option's markup is a function of that option alone).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cubenet } from '../../tasks/cubenet'
import type { CubeView, CubenetSpec, NetSquare } from '../../tasks/cubenet/spec'
import { CONFIRM_LABEL, optionLetter } from '../choice/keys'
import { click, mountInto, nextFrame, optionInputs, press, settle, stableHtml, type Mounted } from '../dom-testing'
import { CUBENET_STEM, CUBENET_VIEW_NOTE, MARK_NAMES, cubenetOptionName, netAlt } from './copy'
import CubenetRenderer from './CubenetRenderer.svelte'
import CubeSvg from './CubeSvg.svelte'
import { MARK_PARTS } from './draw'

const mounts: Mounted[] = []
afterEach(() => {
  for (const m of mounts.splice(0)) m.destroy()
})

function mountSpec(spec: CubenetSpec, extra: { disabled?: boolean; onshown?: (t: number) => void } = {}) {
  const onrespond = vi.fn<(r: number) => void>()
  const m = mountInto(CubenetRenderer, { spec, onrespond, ...extra })
  mounts.push(m)
  return { onrespond, root: m.target }
}

function render(seed: string, extra: { disabled?: boolean; onshown?: (t: number) => void } = {}) {
  const item = cubenet.generate(seed)
  return { item, ...mountSpec(item.spec, extra) }
}

async function renderShown(seed: string, extra: { disabled?: boolean } = {}) {
  const r = render(seed, extra)
  await settle()
  return r
}

const confirmButton = (root: HTMLElement): HTMLButtonElement => {
  const b = [...root.querySelectorAll('button')].find((x) => x.textContent?.trim() === CONFIRM_LABEL)
  if (!b) throw new Error('no confirm button')
  return b
}

describe('cube-net copy', () => {
  it('describes the net row by row, with runs of joined squares', () => {
    const net: NetSquare[] = [
      { r: 0, c: 1, mark: 'ring' },
      { r: 1, c: 0, mark: 'plus' },
      { r: 1, c: 1, mark: 'disc' },
      { r: 1, c: 2, mark: 'cross' },
      { r: 1, c: 3, mark: 'dots' },
      { r: 2, c: 1, mark: 'square' },
    ]
    expect(netAlt(net)).toMatch(
      /Row 1: column 2: ring\. Row 2: columns 1 to 4: plus sign, filled circle, x-cross, four dots\. Row 3: column 2: filled square\.$/,
    )
    const stairs: NetSquare[] = [
      { r: 0, c: 0, mark: 'ring' },
      { r: 0, c: 1, mark: 'plus' },
      { r: 1, c: 1, mark: 'disc' },
      { r: 1, c: 2, mark: 'cross' },
      { r: 2, c: 2, mark: 'dots' },
      { r: 2, c: 3, mark: 'square' },
    ]
    expect(netAlt(stairs)).toMatch(/Row 1: columns 1 and 2: ring, plus sign\. Row 2: columns 2 and 3: filled circle, x-cross\. Row 3: columns 3 and 4: four dots, filled square\.$/)
  })

  it('names every option by the same three faces', () => {
    const v: CubeView = { top: 'ring', left: 'plus', right: 'dots' }
    expect(cubenetOptionName('A', v)).toBe('Option A: top face: ring; front left face: plus sign; front right face: four dots.')
    expect(new Set(Object.values(MARK_NAMES)).size).toBe(8)
  })
})

describe('CubenetRenderer', () => {
  it('draws the stem, the net as one image with its full text alternative, the note and four cubes', async () => {
    const { item, root } = await renderShown('cubenet-dom-1')
    expect(root.querySelector('.stem')?.textContent).toBe(CUBENET_STEM)
    expect(root.querySelector('.note')?.textContent).toBe(CUBENET_VIEW_NOTE)
    const net = root.querySelector('svg.net') as SVGSVGElement
    expect(net.getAttribute('role')).toBe('img')
    expect(net.getAttribute('aria-label')).toBe(netAlt(item.spec.net))
    for (const q of item.spec.net) expect(net.getAttribute('aria-label')).toContain(MARK_NAMES[q.mark])
    expect(net.querySelectorAll('rect')).toHaveLength(6)
    // A net is a tree of 6 squares: 5 joined sides (fold lines) and 24 − 10 = 14 outside sides.
    expect(net.querySelectorAll('line.fold')).toHaveLength(5)
    expect(net.querySelectorAll('line:not(.fold)')).toHaveLength(14)
    const parts = item.spec.net.reduce((a, q) => a + MARK_PARTS[q.mark].length, 0)
    expect(net.querySelectorAll('path')).toHaveLength(parts)
    const cubes = [...root.querySelectorAll('svg.cube')]
    expect(cubes).toHaveLength(4)
    cubes.forEach((svg, i) => {
      const v = item.spec.options[i] as CubeView
      expect(svg.getAttribute('aria-hidden')).toBe('true')
      expect(svg.querySelectorAll('polygon')).toHaveLength(6)
      expect(svg.querySelectorAll('path')).toHaveLength(MARK_PARTS[v.top].length + MARK_PARTS[v.left].length + MARK_PARTS[v.right].length)
    })
  })

  it('shows the four options in spec.options order, each named by its letter and its faces', async () => {
    const { item, root } = await renderShown('cubenet-dom-2')
    const inputs = optionInputs(root)
    expect(inputs.map((x) => x.getAttribute('aria-label'))).toEqual(item.spec.options.map((v, i) => cubenetOptionName(optionLetter(i), v)))
    expect(inputs.map((x) => x.value)).toEqual(['0', '1', '2', '3'])
    expect(inputs.every((x) => !x.checked)).toBe(true)
  })

  it('picks with number and letter keys, and Enter responds once with the display position', async () => {
    const { item, onrespond, root } = await renderShown('cubenet-dom-3')
    const inputs = optionInputs(root)
    inputs[0]?.focus()
    press(document.activeElement as Element, '3')
    expect(inputs[2]?.checked).toBe(true)
    press(document.activeElement as Element, 'b')
    expect(inputs[1]?.checked).toBe(true)
    press(document.activeElement as Element, '7')
    expect(inputs[1]?.checked).toBe(true)
    expect(onrespond).not.toHaveBeenCalled()
    press(document.activeElement as Element, 'Enter')
    expect(onrespond).toHaveBeenCalledExactlyOnceWith(1)
    expect(cubenet.score(item, 1).correct).toBe(item.key.index === 1 ? 1 : 0)
    press(document.activeElement as Element, 'Enter')
    click(confirmButton(root))
    expect(onrespond).toHaveBeenCalledTimes(1)
  })

  it('responds by pointer: click an option card, then Confirm', async () => {
    const { onrespond, root } = await renderShown('cubenet-dom-4')
    const confirm = confirmButton(root)
    expect(confirm.disabled).toBe(true)
    click(optionInputs(root)[3] as HTMLInputElement)
    click(confirm)
    expect(onrespond).toHaveBeenCalledExactlyOnceWith(3)
  })

  it('ignores keys and clicks while disabled', async () => {
    const { onrespond, root } = await renderShown('cubenet-dom-5', { disabled: true })
    const inputs = optionInputs(root)
    expect(inputs.every((x) => x.matches(':disabled'))).toBe(true)
    press(inputs[0] as HTMLInputElement, '2')
    click(confirmButton(root))
    expect(onrespond).not.toHaveBeenCalled()
  })

  it('accepts no choice before the onset, and reports the onset once from an animation frame', async () => {
    const onshown = vi.fn<(t: number) => void>()
    const { onrespond, root } = render('cubenet-dom-6', { onshown })
    const inputs = optionInputs(root)
    expect(onshown).not.toHaveBeenCalled()
    expect(inputs.every((x) => x.matches(':disabled'))).toBe(true)
    click(inputs[2] as HTMLInputElement)
    click(confirmButton(root))
    expect(onrespond).not.toHaveBeenCalled()
    const frame = await nextFrame()
    await settle()
    expect(onshown).toHaveBeenCalledTimes(1)
    expect(onshown.mock.calls[0]?.[0] as number).toBeLessThanOrEqual(frame)
    click(inputs[2] as HTMLInputElement)
    click(confirmButton(root))
    expect(onrespond).toHaveBeenCalledExactlyOnceWith(2)
  })
})

describe('no key in the cube-net DOM (M1.13)', () => {
  const HINT_WORDS = /key|correct|answer|solution|index|score|right_|wrong|mirror|opposite|valid/i

  it('the DOM is a function of the spec, and each option is a function of its own view (200 items)', () => {
    const problems: string[] = []
    const markupOf = new Map<string, string>()
    const strip = (html: string): string => html.replace(/<!---->/g, '')
    for (let s = 0; s < 200; s++) {
      const item = cubenet.generate(`leak-cubenet-${s}`, { stratum: ((s % 5) + 1) as 1 | 2 | 3 | 4 | 5 })
      const { root } = mountSpec(item.spec)
      const html = root.innerHTML
      for (const secret of [JSON.stringify(item.key), item.item_id, item.family_id, item.seed, JSON.stringify(item.structural_params)]) {
        if (html.includes(secret)) problems.push(`${item.item_id}: ${secret} in the DOM`)
      }
      for (const el of root.querySelectorAll('*')) {
        for (const a of el.attributes) {
          if (a.name.startsWith('data-') || a.name === 'tabindex') problems.push(`${item.item_id}: ${a.name} on <${el.localName}>`)
          if (['id', 'class', 'name', 'value', 'for', 'role', 'style'].includes(a.name) && HINT_WORDS.test(a.value)) problems.push(`${item.item_id}: ${a.name}="${a.value}"`)
        }
      }
      const labels = [...root.querySelectorAll('label')]
      const shapes = new Set<string>()
      labels.forEach((label, i) => {
        const view = item.spec.options[i] as CubeView
        const figure = strip(label.querySelector('.figure')?.innerHTML ?? '')
        const k = JSON.stringify([view.top, view.left, view.right])
        const before = markupOf.get(k)
        if (before !== undefined && before !== figure) problems.push(`${item.item_id}: option ${i} drawn differently for the same view`)
        markupOf.set(k, figure)
        const clone = label.cloneNode(true) as HTMLElement
        const input = clone.querySelector('input') as HTMLInputElement
        input.setAttribute('aria-label', '(name)')
        input.setAttribute('value', '(position)')
        input.setAttribute('name', '(group)')
        ;(clone.querySelector('.letter') as HTMLElement).textContent = '(letter)'
        ;(clone.querySelector('.figure') as HTMLElement).innerHTML = '(figure)'
        shapes.add(clone.outerHTML)
      })
      if (shapes.size !== 1) problems.push(`${item.item_id}: options differ in markup beyond position and content`)
      // A copy of the spec renders the same DOM.
      const again = mountSpec(structuredClone(item.spec))
      if (stableHtml(again.root) !== stableHtml(root)) problems.push(`${item.item_id}: DOM is not a function of the spec`)
      for (const m of mounts.splice(0)) m.destroy()
    }
    expect(problems).toEqual([])
  })

  it('a cube option drawn alone is the same markup as inside the option group', async () => {
    const { item, root } = await renderShown('cubenet-dom-7')
    const v = item.spec.options[0] as CubeView
    const m = mountInto(CubeSvg, { view: v })
    mounts.push(m)
    const figure = root.querySelector('label .figure')?.innerHTML.replace(/<!---->/g, '')
    expect(figure).toBe(m.target.innerHTML.replace(/<!---->/g, ''))
  })
})
