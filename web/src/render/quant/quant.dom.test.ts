/**
 * Quant renderer (ROADMAP M1.13, A18; DESIGN §4.2 "Math"): the stem with powers as superscripts,
 * the item's own hint, entry parsed exactly like quant score() (`parseEntry`), the typed text as
 * the response, and a snapshot.
 */

import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { quant, type QuantItem } from '../../tasks/quant'
import { parseEntry } from '../../tasks/quant/numeric'
import type { QuantResponse } from '../../tasks/quant/score'
import { FORMAT_NOTES } from '../common/entry-copy'
import { normalizeIds } from '../common/leak'
import { buttonByText, click, fakeDisplay, render, typeInto } from '../common/testing'
import QuantRenderer from './QuantRenderer.svelte'
import { stemParts } from './stem'

let cleanup: (() => void)[] = []
afterEach(() => {
  for (const f of cleanup) f()
  cleanup = []
})

function mountItem(item: QuantItem) {
  const responses: QuantResponse[] = []
  const r = render(QuantRenderer, { spec: item.spec, onrespond: (x: QuantResponse) => responses.push(x), timing: fakeDisplay() })
  cleanup.push(r.destroy)
  const input = r.container.querySelector('input') as HTMLInputElement
  return { ...r, input, responses, submit: () => click(buttonByText(r.container, 'Submit')) }
}

describe('stemParts', () => {
  it('turns ^n, ^(…) and ^x into superscripts and keeps the rest', () => {
    expect(stemParts('Compute (3^5)^2 ÷ 3^8.')).toEqual([{ text: 'Compute (3' }, { sup: '5' }, { text: ')' }, { sup: '2' }, { text: ' ÷ 3' }, { sup: '8' }, { text: '.' }])
    expect(stemParts('Compute 9^(3/2).')).toEqual([{ text: 'Compute 9' }, { sup: '3/2' }, { text: '.' }])
    expect(stemParts('Solve for x: 5^(2x) = 9765625.')).toEqual([{ text: 'Solve for x: 5' }, { sup: '2x' }, { text: ' = 9765625.' }])
    expect(stemParts('No powers here.')).toEqual([{ text: 'No powers here.' }])
  })

  it('loses no character but the carets and power brackets (property over generated stems)', () => {
    for (let i = 0; i < 400; i++) {
      const stem = quant.generate(`render-quant-stem-${i}`).spec.stem
      const joined = stemParts(stem)
        .map((p) => ('sup' in p ? `^${/^[0-9A-Za-z]+$/.test(p.sup) ? p.sup : `(${p.sup})`}` : p.text))
        .join('')
      expect(joined).toBe(stem)
    }
  })
})

describe('QuantRenderer', () => {
  it('shows the stem text and the spec hint', () => {
    const item = quant.generate('render-quant-1')
    const { container } = mountItem(item)
    const stemText = (container.querySelector('.stem')?.textContent ?? '').replace(/ to the power /g, '^')
    expect(stemText.replace(/\s+/g, ' ').trim()).toBe(item.spec.stem.replace(/\^\(([^()]+)\)/g, '^$1'))
    expect(container.querySelector('.hint')?.textContent).toBe(item.spec.hint)
  })

  it('typing the key (and its decimal form) sends that text, and score() marks it correct', () => {
    for (let i = 0; i < 80; i++) {
      const item = quant.generate(`render-quant-key-${i}`)
      const m = mountItem(item)
      typeInto(m.input, item.key.value)
      m.submit()
      expect(m.responses).toEqual([item.key.value])
      expect(quant.score(item, m.responses[0] as string).correct).toBe(1)
      m.destroy()
    }
  })

  it('accepts exactly what parseEntry reads (property), with a neutral format note otherwise', () => {
    const item = quant.generate('render-quant-parse')
    fc.assert(
      fc.property(
        fc.oneof(fc.string({ maxLength: 8 }), fc.constantFrom('3/8', '2 1/3', '1,533', '−4', '$12.50', '45%', '0,5', '.5', '3.', '1/0', 'abc')),
        (text) => {
          const m = mountItem(item)
          typeInto(m.input, text)
          m.submit()
          const ok = parseEntry(text) !== null
          expect(m.responses.length).toBe(ok ? 1 : 0)
          if (!ok && text.trim() !== '') expect(m.container.querySelector('.hb-note')?.textContent).toBe(FORMAT_NOTES[item.spec.input_format])
          m.destroy()
        },
      ),
      { numRuns: 80 },
    )
  })

  it('matches its snapshot', () => {
    expect(normalizeIds(mountItem(quant.generate('render-quant-snap')).container)).toMatchSnapshot()
  })
})
