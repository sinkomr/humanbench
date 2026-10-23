/**
 * figure2d renderer in jsdom (DESIGN §3 row 7, §4.2, §11.6, §13; ROADMAP M1.13, A18): what it draws, its text
 * alternatives, keyboard and pointer responding (only after the onset), the response contract with `figure2d.score()`,
 * the onset callback, and that nothing in the DOM depends on the key.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { figure2d, type Figure2dItem } from '../../tasks/figure2d'
import { specProblems } from '../../tasks/figure2d/spec'
import { CONFIRM_LABEL, optionLetter } from '../choice/keys'
import { click, mountInto, nextFrame, optionInputs, press, settle, stableHtml, type Mounted } from '../dom-testing'
import { MIRROR_STEM, ROTATE_STEM, describeRows, mirrorLineSentence, optionLabel, targetLabel, turnPhrase } from './copy'
import { centred, mirrorTarget, rotateBoxSide, size } from './draw'
import Figure2dRenderer from './Figure2dRenderer.svelte'

let mounted: Mounted[] = []
afterEach(() => {
  for (const m of mounted) m.destroy()
  mounted = []
})

function firstOf(task: 'rotate' | 'mirror', prefix: string): Figure2dItem {
  for (let i = 0; i < 200; i++) {
    const it = figure2d.generate(`${prefix}-${i}`)
    if (it.spec.task === task) return it
  }
  throw new Error(`no ${task} item`)
}

function render(item: Figure2dItem, extra: { disabled?: boolean; onshown?: (t: number) => void } = {}) {
  const onrespond = vi.fn<(r: number) => void>()
  const m = mountInto(Figure2dRenderer, { spec: item.spec, onrespond, ...extra })
  mounted.push(m)
  return { item, onrespond, root: m.target }
}

async function renderShown(item: Figure2dItem, extra: { disabled?: boolean } = {}) {
  const r = render(item, extra)
  await settle()
  return r
}

const confirmButton = (root: HTMLElement): HTMLButtonElement => {
  const b = [...root.querySelectorAll('button')].find((x) => x.textContent?.trim() === CONFIRM_LABEL)
  if (!b) throw new Error('no confirm button')
  return b
}

const ROT = firstOf('rotate', 'dom-rot')
const MIR = firstOf('mirror', 'dom-mir')

describe('figure2d copy', () => {
  it('describes rows and columns from 1, and turns in words', () => {
    expect(
      describeRows([
        [0, 0],
        [0, 1],
        [1, 1],
        [2, 0],
        [2, 1],
        [2, 3],
      ]),
    ).toBe('Row 1: columns 1 and 2. Row 2: column 2. Row 3: columns 1, 2 and 4.')
    expect(turnPhrase(30)).toBe('drawn turned 30° clockwise')
    expect(turnPhrase(-45)).toBe('drawn turned 45° counterclockwise')
    expect(turnPhrase(0)).toBe('drawn upright')
    expect(mirrorLineSentence('v')).toMatch(/vertical, to the right of the figure/)
  })

  it('names every option with the same kind of sentence, whichever is the key', () => {
    for (const item of [ROT, MIR]) {
      const labels = item.spec.options.map((o, i) => optionLabel(optionLetter(i), o, item.spec.task))
      const shapes = labels.map((l) => l.replace(/Option [A-D]/, 'Option X').replace(/\d+/g, 'N').replace(/(clockwise|counterclockwise|upright)/, 'W'))
      // The shape of a sentence ignores numbers and turn words; with the same tilt every option reads alike.
      const heads = shapes.map((s) => s.split('.')[0])
      expect(new Set(heads).size).toBeLessThanOrEqual(2)
      for (const l of labels) expect(l).not.toMatch(/correct|right|answer|key|target turned|mirror image/i)
    }
  })
})

describe('Figure2dRenderer', () => {
  it('matches the DOM snapshot of a fixed rotate item and a fixed mirror item', async () => {
    expect(stableHtml((await renderShown(ROT)).root)).toMatchSnapshot()
    expect(stableHtml((await renderShown(MIR)).root)).toMatchSnapshot()
  })

  it('rotate: draws the stem, the upright target with its text alternative, and four turned options', async () => {
    const { root, item } = await renderShown(ROT)
    expect(root.querySelector('.stem')?.textContent).toBe(ROTATE_STEM)
    const target = root.querySelector('.target svg') as SVGSVGElement
    expect(target.getAttribute('role')).toBe('img')
    expect(target.getAttribute('aria-label')).toBe(targetLabel(item.spec))
    expect(target.getAttribute('aria-label')).toMatch(new RegExp(`^Target figure: ${item.spec.figure.cells.length} squares\\. Row 1: `))
    expect(target.querySelectorAll('rect.square')).toHaveLength(item.spec.figure.cells.length)
    expect(target.querySelector('line')).toBeNull()
    const side = rotateBoxSide(item.spec)
    expect(target.getAttribute('viewBox')).toBe(`0 0 ${side} ${side}`)
    const inputs = optionInputs(root)
    expect(inputs.map((x) => x.getAttribute('aria-label'))).toEqual(item.spec.options.map((o, i) => optionLabel(optionLetter(i), o, 'rotate')))
    const labels = [...root.querySelectorAll('label')]
    labels.forEach((label, i) => {
      const svg = label.querySelector('svg') as SVGSVGElement
      expect(svg.getAttribute('aria-hidden')).toBe('true')
      const o = item.spec.options[i] as (typeof item.spec.options)[number]
      expect(svg.querySelectorAll('rect.square')).toHaveLength(o.cells.length)
      expect(svg.querySelector('g')?.getAttribute('transform')).toBe(centred(o.cells, side, o.angle).transform)
    })
  })

  it('rotate: every box fits its figure at any angle (side ≥ the longest diagonal)', () => {
    for (let i = 0; i < 100; i++) {
      const it = figure2d.generate(`fit-${i}`)
      if (it.spec.task !== 'rotate') continue
      const side = rotateBoxSide(it.spec)
      for (const c of [it.spec.figure.cells, ...it.spec.options.map((o) => o.cells)]) expect(Math.hypot(...size(c)) * 10).toBeLessThanOrEqual(side)
    }
  })

  it('mirror: draws the dashed line across the whole box, the figure on one side, and upright options', async () => {
    const { root, item } = await renderShown(MIR)
    expect(root.querySelector('.stem')?.textContent).toBe(MIRROR_STEM)
    const target = root.querySelector('.target svg') as SVGSVGElement
    const label = target.getAttribute('aria-label') as string
    expect(label).toBe(targetLabel(item.spec))
    expect(label.endsWith(mirrorLineSentence(item.spec.mirror_line as 'v'))).toBe(true)
    const line = target.querySelector('line.mirror-line') as SVGLineElement
    expect(line.getAttribute('stroke-dasharray')).toBeTruthy()
    const t = mirrorTarget(item.spec.figure.cells, item.spec.mirror_line as 'v')
    const ends = ['x1', 'y1', 'x2', 'y2'].map((a) => Number(line.getAttribute(a)))
    // Edge to edge: each end lies on the box edge.
    expect(ends.filter((v) => v === 0 || v === t.side).length).toBeGreaterThanOrEqual(2)
    for (const svg of [...root.querySelectorAll('label svg')]) expect(svg.querySelector('g')?.getAttribute('transform')).not.toMatch(/rotate/)
  })

  it('mirror: the figure lies wholly on one side of the line, for every line', () => {
    for (let i = 0; i < 200; i++) {
      const it = figure2d.generate(`side-${i}`)
      if (it.spec.task !== 'mirror') continue
      const line = it.spec.mirror_line as 'v' | 'h' | 'd' | 'a'
      const t = mirrorTarget(it.spec.figure.cells, line)
      const [dx, dy] = (/translate\(([-\d.]+) ([-\d.]+)\)/.exec(t.transform) as RegExpExecArray).slice(1).map(Number) as [number, number]
      for (const [r, c] of it.spec.figure.cells) {
        const corners = [
          [dx + c * 10, dy + r * 10],
          [dx + (c + 1) * 10, dy + (r + 1) * 10],
          [dx + (c + 1) * 10, dy + r * 10],
          [dx + c * 10, dy + (r + 1) * 10],
        ]
        for (const [x, y] of corners as [number, number][]) {
          if (line === 'v') expect(x).toBeLessThan(t.line.x1)
          if (line === 'h') expect(y).toBeLessThan(t.line.y1)
          if (line === 'd') expect(y).toBeGreaterThan(x)
          if (line === 'a') expect(x + y).toBeLessThan(t.side)
        }
      }
    }
  })

  it('picks with number and letter keys, and Enter responds once with the display position', async () => {
    const { item, onrespond, root } = await renderShown(ROT)
    const inputs = optionInputs(root)
    inputs[0]?.focus()
    press(document.activeElement as Element, '3')
    expect(inputs[2]?.checked).toBe(true)
    press(document.activeElement as Element, 'b')
    expect(inputs[1]?.checked).toBe(true)
    expect(onrespond).not.toHaveBeenCalled()
    press(document.activeElement as Element, 'Enter')
    expect(onrespond).toHaveBeenCalledExactlyOnceWith(1)
    expect(figure2d.score(item, 1).correct).toBe(item.key.index === 1 ? 1 : 0)
    press(document.activeElement as Element, 'Enter')
    expect(onrespond).toHaveBeenCalledTimes(1)
  })

  it('responds by pointer: click an option card, then Confirm', async () => {
    const { onrespond, root } = await renderShown(MIR)
    const confirm = confirmButton(root)
    expect(confirm.disabled).toBe(true)
    click(optionInputs(root)[3] as HTMLInputElement)
    click(confirm)
    expect(onrespond).toHaveBeenCalledExactlyOnceWith(3)
  })

  it('ignores keys and clicks while disabled', async () => {
    const { onrespond, root } = await renderShown(ROT, { disabled: true })
    const inputs = optionInputs(root)
    expect(inputs.every((x) => x.matches(':disabled'))).toBe(true)
    press(inputs[0] as HTMLInputElement, '2')
    click(confirmButton(root))
    expect(onrespond).not.toHaveBeenCalled()
  })

  it('accepts no choice before the onset, and reports the onset once from an animation frame', async () => {
    const onshown = vi.fn<(t: number) => void>()
    const { onrespond, root } = render(MIR, { onshown })
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

describe('Figure2dRenderer leaks nothing about the key', () => {
  const HINT = /key|correct|answer|solution|score|right_|wrong/i

  it('writes nothing item-level beyond the spec, no data-* attributes, no hinting names', async () => {
    for (let i = 0; i < 40; i++) {
      const item = figure2d.generate(`leak-${i}`)
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

  it('draws each option from its own spec entry only: moving the key to another position moves its markup, nothing else changes', async () => {
    for (const base of [ROT, MIR]) {
      const k = base.key.index
      const j = (k + 1) % 4
      const swapped = structuredClone(base.spec) as unknown as { options: unknown[] }
      ;[swapped.options[k], swapped.options[j]] = [swapped.options[j], swapped.options[k]]
      expect(specProblems(swapped)).toEqual([])
      const a = (await renderShown(base)).root
      const b = (await renderShown({ ...base, spec: swapped as unknown as Figure2dItem['spec'] })).root
      const figsA = [...a.querySelectorAll('label svg')].map((s) => s.outerHTML)
      const figsB = [...b.querySelectorAll('label svg')].map((s) => s.outerHTML)
      expect(figsB[j]).toBe(figsA[k])
      expect(figsB[k]).toBe(figsA[j])
      expect(a.querySelector('.target')?.outerHTML).toBe(b.querySelector('.target')?.outerHTML)
      // Every option label has the same markup once its own content and position are factored out.
      const skeleton = (root: HTMLElement) =>
        [...root.querySelectorAll('label')].map((l) =>
          l.outerHTML
            .replace(/<svg[\s\S]*<\/svg>/, '<svg/>')
            .replace(/aria-label="[^"]*"/, '')
            .replace(/value="\d"/, '')
            .replace(/>[A-D]</, '><'),
        )
      expect(new Set(skeleton(a)).size).toBe(1)
    }
  })
})
