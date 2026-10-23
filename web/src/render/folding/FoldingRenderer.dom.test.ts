/**
 * Paper-folding renderer in jsdom (DESIGN §3 row 7, §11.6, §13; ROADMAP A18): what it draws (a panel
 * per fold plus the punch panel, five option sheets), its complete text alternative, keyboard and
 * pointer responding (only after the onset), the response contract with `folding.score()`, the onset
 * callback, and that nothing in the DOM depends on which option is the key.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { folding, type FoldingItem } from '../../tasks/folding'
import { CONFIRM_LABEL, optionLetter } from '../choice/keys'
import { click, mountInto, nextFrame, optionInputs, press, settle, stableHtml, type Mounted } from '../dom-testing'
import { FOLDING_FIGURE_LABEL, FOLDING_STEM, foldText, optionName, punchText, sheetText } from './copy'
import FoldingRenderer from './FoldingRenderer.svelte'

let mounted: Mounted[] = []
afterEach(() => {
  for (const m of mounted) m.destroy()
  mounted = []
})

function mountSpec(spec: FoldingItem['spec'], extra: { disabled?: boolean; onshown?: (t: number) => void } = {}) {
  const onrespond = vi.fn<(r: number) => void>()
  const m = mountInto(FoldingRenderer, { spec, onrespond, ...extra })
  mounted.push(m)
  return { onrespond, root: m.target }
}

function render(seed: string, extra: { disabled?: boolean; onshown?: (t: number) => void; stratum?: number } = {}) {
  const { stratum, ...props } = extra
  const item = stratum === undefined ? folding.generate(seed) : folding.generate(seed, { stratum })
  return { item, ...mountSpec(item.spec, props) }
}

async function renderShown(seed: string, extra: { disabled?: boolean; stratum?: number } = {}) {
  const r = render(seed, extra)
  await settle()
  return r
}

const confirmButton = (root: HTMLElement): HTMLButtonElement => {
  const b = [...root.querySelectorAll('button')].find((x) => x.textContent?.trim() === CONFIRM_LABEL)
  if (!b) throw new Error('no confirm button')
  return b
}

describe('FoldingRenderer', () => {
  it('matches the DOM snapshot of a fixed item', async () => {
    const { root } = await renderShown('snapshot-folding-1', { stratum: 4 })
    expect(stableHtml(root)).toMatchSnapshot()
  })

  it('draws one panel per fold and the punch panel, each fold with its moving half, fold line and arrow', async () => {
    for (const stratum of [1, 3, 5, 6]) {
      const { item, root } = await renderShown(`folding-dom-panels-${stratum}`, { stratum })
      const panels = root.querySelectorAll('figure.panel')
      expect(panels).toHaveLength(item.spec.folds.length + 1)
      expect(root.querySelectorAll('line.fold')).toHaveLength(item.spec.folds.length)
      expect(root.querySelectorAll('path.arrow')).toHaveLength(item.spec.folds.length)
      expect(root.querySelectorAll('polygon.moving')).toHaveLength(item.spec.folds.length)
      const last = panels[panels.length - 1] as Element
      expect(last.querySelectorAll('circle.hole')).toHaveLength(item.spec.punches.length)
      expect(last.querySelector('polygon.outline')).not.toBeNull()
      // Panels are decorative: the ordered list is the text alternative.
      expect(root.querySelector('.panels')?.getAttribute('aria-hidden')).toBe('true')
      for (const m of mounted) m.destroy()
      mounted = []
    }
  })

  it('describes the whole stimulus in an ordered list: the sheet, every fold, the punches', async () => {
    const { item, root } = await renderShown('folding-dom-text', { stratum: 5 })
    expect(root.querySelector('.stem')?.textContent).toBe(FOLDING_STEM)
    const group = root.querySelector('[role="group"]')
    expect(group?.getAttribute('aria-label')).toBe(FOLDING_FIGURE_LABEL)
    const items = [...(group?.querySelectorAll('ol li') ?? [])].map((li) => li.textContent)
    expect(items).toEqual([sheetText(item.spec.grid), ...item.spec.folds.map((f, k) => foldText(k + 1, f)), punchText(item.spec.punches)])
    expect(items[1]).toMatch(/^Step 1: the sheet is folded in half along /)
    expect(group?.querySelector('ol')?.classList.contains('hb-sr-only')).toBe(true)
    expect(foldText(1, { line: 'v', moving: 'right' })).toBe('Step 1: the sheet is folded in half along its vertical centre line; the right half is folded over onto the left half.')
    expect(punchText([{ row: 2, col: 1 }])).toBe('Then a hole is punched through every layer at row 2, column 1 of the sheet.')
  })

  it('shows the five options in spec.options order, each named by its holes in the same format', async () => {
    const { item, root } = await renderShown('folding-dom-options')
    const inputs = optionInputs(root)
    expect(inputs).toHaveLength(5)
    expect(inputs.map((x) => x.getAttribute('aria-label'))).toEqual(item.spec.options.map((o, i) => optionName(optionLetter(i), o.holes)))
    expect(inputs.map((x) => x.value)).toEqual(['0', '1', '2', '3', '4'])
    for (const name of inputs.map((x) => x.getAttribute('aria-label') ?? '')) expect(name).toMatch(/^Option [A-E]: holes? at row \d, column \d(; row \d, column \d)*$/)
    const labels = [...root.querySelectorAll('label')]
    labels.forEach((label, i) => {
      const svg = label.querySelector('svg')
      expect(svg?.getAttribute('aria-hidden')).toBe('true')
      expect(svg?.querySelectorAll('circle.hole')).toHaveLength(item.spec.options[i]?.holes.length ?? -1)
      expect(svg?.querySelectorAll('circle.slot')).toHaveLength(item.spec.grid ** 2)
    })
  })

  it('renders the same DOM whichever option is the key (only the spec reaches it)', async () => {
    const item = folding.generate('folding-dom-leak', { stratum: 3 })
    const a = mountSpec(item.spec).root
    const b = mountSpec(JSON.parse(JSON.stringify(item.spec)) as FoldingItem['spec']).root
    await settle()
    const uids = (h: string): string => h.replace(/\bc\d+-/g, 'UID-').replace(/"c\d+"/g, '"UID"')
    expect(uids(stableHtml(a))).toBe(uids(stableHtml(b)))
    const html = a.innerHTML
    expect(html).not.toMatch(/data-|key|correct|answer|solution/i)
    // Every option's markup differs only in its holes and its letter/value/name.
    const cards = [...a.querySelectorAll('label')].map((l, i) =>
      l.outerHTML
        .replace(/<circle class="hole[^>]*>(<\/circle>)?/g, '')
        .replace(new RegExp(`value="${i}"`), '')
        .replace(/aria-label="[^"]*"/, '')
        .replace(/>[A-E]</, '><'),
    )
    expect(new Set(cards.map((c) => c.replace(/id="[^"]*"|for="[^"]*"|name="[^"]*"/g, ''))).size).toBe(1)
  })

  it('picks with number and letter keys, and Enter on an option responds once with the display position', async () => {
    const { item, onrespond, root } = await renderShown('folding-dom-keys')
    const inputs = optionInputs(root)
    inputs[0]?.focus()
    press(document.activeElement as Element, '3')
    expect(inputs[2]?.checked).toBe(true)
    press(document.activeElement as Element, 'e')
    expect(inputs[4]?.checked).toBe(true)
    expect(onrespond).not.toHaveBeenCalled()
    press(document.activeElement as Element, 'Enter')
    expect(onrespond).toHaveBeenCalledExactlyOnceWith(4)
    expect(folding.score(item, 4).correct).toBe(item.key.index === 4 ? 1 : 0)
    press(document.activeElement as Element, 'Enter')
    click(confirmButton(root))
    expect(onrespond).toHaveBeenCalledTimes(1)
  })

  it('responds by pointer: click an option card, then Confirm', async () => {
    const { onrespond, root } = await renderShown('folding-dom-pointer')
    click(optionInputs(root)[1] as HTMLInputElement)
    click(confirmButton(root))
    expect(onrespond).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('ignores input while disabled and before the onset; reports the onset once from a frame', async () => {
    const d = await renderShown('folding-dom-disabled', { disabled: true })
    expect(optionInputs(d.root).every((x) => x.matches(':disabled'))).toBe(true)
    click(confirmButton(d.root))
    expect(d.onrespond).not.toHaveBeenCalled()

    const onshown = vi.fn<(t: number) => void>()
    const { onrespond, root } = render('folding-dom-onset', { onshown })
    const inputs = optionInputs(root)
    expect(inputs.every((x) => x.matches(':disabled'))).toBe(true)
    click(inputs[2] as HTMLInputElement)
    click(confirmButton(root))
    expect(onrespond).not.toHaveBeenCalled()
    expect(onshown).not.toHaveBeenCalled()
    await nextFrame()
    await settle()
    expect(onshown).toHaveBeenCalledTimes(1)
    expect(Number.isFinite(onshown.mock.calls[0]?.[0])).toBe(true)
    click(inputs[2] as HTMLInputElement)
    click(confirmButton(root))
    expect(onrespond).toHaveBeenCalledExactlyOnceWith(2)
  })
})
