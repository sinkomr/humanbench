/**
 * Matrices renderer in jsdom (ROADMAP M1.13, A18; DESIGN §4.2, §11.6, §13): what it draws, its
 * text alternatives, keyboard and pointer responding (only after the onset), the response
 * contract with `matrices.score()`, the onset callback, and a DOM snapshot.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { matrices } from '../../tasks/matrices'
import { CONFIRM_LABEL, optionLetter } from '../choice/keys'
import { click, mountInto, nextFrame, optionInputs, press, settle, stableHtml, type Mounted } from '../dom-testing'
import { MATRIX_GRID_LABEL, MATRIX_MISSING_LABEL, MATRIX_STEM, matrixOptionName } from './copy'
import { cellObjects, gridCellLabel } from './draw'
import MatrixRenderer from './MatrixRenderer.svelte'

let mounted: Mounted | undefined
afterEach(() => {
  mounted?.destroy()
  mounted = undefined
})

function render(seed: string, extra: { disabled?: boolean; onshown?: (t: number) => void } = {}) {
  const item = matrices.generate(seed)
  const onrespond = vi.fn<(r: number) => void>()
  mounted = mountInto(MatrixRenderer, { spec: item.spec, onrespond, ...extra })
  return { item, onrespond, root: mounted.target }
}

/** Render and wait for the onset (the options accept a choice from then on). */
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

describe('MatrixRenderer', () => {
  it('matches the DOM snapshot of a fixed item', async () => {
    const { root } = await renderShown('snapshot-matrices-1')
    expect(stableHtml(root)).toMatchSnapshot()
  })

  it('lays the options out on the same three tracks as the grid, flush, so an option is drawn at the size of a grid cell (UX-020)', async () => {
    const { root } = await renderShown('matrices-dom-scale')
    const matrix = root.querySelector('.matrix') as HTMLElement
    const options = root.querySelector('.options') as HTMLElement
    expect(matrix.style.getPropertyValue('--grid-max')).toBe('22.5rem')
    // Same width cap as the grid, three columns at every width (two rows of three), no card padding.
    expect(options.style.getPropertyValue('--max')).toBe('var(--grid-max)')
    expect(options.style.getPropertyValue('--narrow')).toBe('3')
    expect(options.style.getPropertyValue('--wide')).toBe('3')
    expect(options.classList.contains('flush')).toBe(true)
    expect(optionInputs(root)).toHaveLength(6)
  })

  it('draws the stem, the 8 visible cells in reading order with text alternatives, then the missing cell', async () => {
    const { item, root } = await renderShown('matrices-dom-1')
    expect(root.querySelector('.stem')?.textContent).toBe(MATRIX_STEM)
    const grid = root.querySelector('[role="group"]')
    expect(grid?.getAttribute('aria-label')).toBe(MATRIX_GRID_LABEL)
    const cells = [...(grid?.querySelectorAll('svg') ?? [])]
    expect(cells).toHaveLength(9)
    const expected = item.spec.grid.flatMap((row, r) => row.map((cell, c) => gridCellLabel(r + 1, c + 1, cell)))
    expect(cells.slice(0, 8).map((s) => s.getAttribute('aria-label'))).toEqual(expected)
    expect(cells[8]?.getAttribute('aria-label')).toBe(MATRIX_MISSING_LABEL)
    for (const s of cells) expect(s.getAttribute('role')).toBe('img')
    // Every object is drawn: a fill, a stripe and an outline per occupied slot.
    item.spec.grid.flat().forEach((cell, k) => {
      const svg = cells[k] as SVGSVGElement
      expect(svg.querySelectorAll('line')).toHaveLength(cellObjects(cell).length)
      expect(svg.querySelectorAll('polygon, circle')).toHaveLength(2 * cellObjects(cell).length)
    })
  })

  it('shows the six options in spec.options order, each named by its letter and its description', async () => {
    const { item, root } = await renderShown('matrices-dom-2')
    const inputs = optionInputs(root)
    expect(inputs).toHaveLength(6)
    expect(inputs.map((x) => x.getAttribute('aria-label'))).toEqual(item.spec.options.map((cell, i) => matrixOptionName(optionLetter(i), cell)))
    expect(inputs.map((x) => x.value)).toEqual(['0', '1', '2', '3', '4', '5'])
    expect(inputs.every((x) => !x.checked)).toBe(true)
    // Option figures are decorative (the radio names them) and carry the option's drawing.
    const labels = [...root.querySelectorAll('label')]
    labels.forEach((label, i) => {
      const svg = label.querySelector('svg')
      expect(svg?.getAttribute('aria-hidden')).toBe('true')
      expect(svg?.querySelectorAll('line')).toHaveLength((item.spec.options[i] as (typeof item.spec.options)[number]).positions.length)
      expect(label.textContent?.trim()).toBe(optionLetter(i))
    })
  })

  it('picks with number and letter keys, and Enter on an option responds once with the display position', async () => {
    const { item, onrespond, root } = await renderShown('matrices-dom-3')
    const inputs = optionInputs(root)
    inputs[0]?.focus()
    press(document.activeElement as Element, '3')
    expect(inputs[2]?.checked).toBe(true)
    expect(document.activeElement).toBe(inputs[2])
    press(document.activeElement as Element, 'e')
    expect(inputs[4]?.checked).toBe(true)
    press(document.activeElement as Element, '7') // no option 7: ignored
    press(document.activeElement as Element, 'g')
    expect(inputs[4]?.checked).toBe(true)
    expect(onrespond).not.toHaveBeenCalled()
    press(document.activeElement as Element, 'Enter')
    expect(onrespond).toHaveBeenCalledTimes(1)
    expect(onrespond).toHaveBeenCalledWith(4)
    expect(matrices.score(item, 4).correct).toBe(item.key.index === 4 ? 1 : 0)
    // Locked after responding: no second response, no more picking.
    press(document.activeElement as Element, 'Enter')
    press(document.activeElement as Element, '1')
    click(confirmButton(root))
    expect(onrespond).toHaveBeenCalledTimes(1)
    expect(inputs.every((x) => x.matches(':disabled'))).toBe(true)
  })

  it('responds by pointer: click an option card, then Confirm', async () => {
    const { onrespond, root } = await renderShown('matrices-dom-4')
    const confirm = confirmButton(root)
    expect(confirm.disabled).toBe(true)
    click(optionInputs(root)[5] as HTMLInputElement)
    expect(confirm.disabled).toBe(false)
    click(confirm)
    expect(onrespond).toHaveBeenCalledExactlyOnceWith(5)
  })

  it('ignores keys and clicks while disabled', async () => {
    const { onrespond, root } = await renderShown('matrices-dom-5', { disabled: true })
    const inputs = optionInputs(root)
    expect(inputs.every((x) => x.matches(':disabled'))).toBe(true)
    press(inputs[0] as HTMLInputElement, '2')
    expect(inputs.some((x) => x.checked)).toBe(false)
    click(confirmButton(root))
    expect(onrespond).not.toHaveBeenCalled()
  })

  it('accepts no choice before the onset: options locked at mount, unlocked from the onset frame', async () => {
    const onshown = vi.fn<(t: number) => void>()
    const { onrespond, root } = render('matrices-dom-7', { onshown })
    const inputs = optionInputs(root)
    expect(inputs.every((x) => x.matches(':disabled'))).toBe(true)
    click(inputs[2] as HTMLInputElement)
    press(inputs[2] as HTMLInputElement, '3')
    click(confirmButton(root))
    expect(inputs.some((x) => x.checked)).toBe(false)
    expect(onrespond).not.toHaveBeenCalled()
    await settle()
    expect(onshown).toHaveBeenCalledTimes(1)
    expect(inputs.some((x) => x.matches(':disabled'))).toBe(false)
    click(inputs[2] as HTMLInputElement)
    click(confirmButton(root))
    expect(onrespond).toHaveBeenCalledExactlyOnceWith(2)
  })

  it('reports the onset once, from an animation frame rather than at mount (§11.6)', async () => {
    const onshown = vi.fn<(t: number) => void>()
    render('matrices-dom-6', { onshown })
    expect(onshown).not.toHaveBeenCalled()
    const frame = await nextFrame()
    await nextFrame()
    expect(onshown).toHaveBeenCalledTimes(1)
    // The argument is the rAF timestamp (jsdom's rAF clock; in browsers, performance.now()'s).
    const t = onshown.mock.calls[0]?.[0] as number
    expect(Number.isFinite(t)).toBe(true)
    expect(t).toBeLessThanOrEqual(frame)
  })
})
