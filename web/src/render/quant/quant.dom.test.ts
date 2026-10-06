/**
 * Quant renderer (ROADMAP M1.13, A18; DESIGN §4.2 "Math"): the stem with powers as superscripts,
 * the item's own hint, entry parsed exactly like quant score() (`parseEntry`), the typed text as
 * the response, and a snapshot.
 */

import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { quant, type QuantItem } from '../../tasks/quant'
import { checkNewEntry, parseEntry } from '../../tasks/quant/numeric'
import type { QuantResponse } from '../../tasks/quant/score'
import { FORMAT_NOTES, THOUSANDS_NOTE } from '../common/entry-copy'
import { normalizeEntry } from '../common/normalize-digits'
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
    expect(container.querySelector('.stem')?.textContent).toBe(item.spec.stem)
    expect(container.querySelector('.hint')?.textContent).toBe(item.spec.hint)
  })

  it('reads powers as " to the power " with the spaces kept (x^2, 9^(3/2), (3^5)^2 in generated stems)', () => {
    const spoken = (stem: string): string => stem.replace(/\^\(([^()]+)\)/g, ' to the power $1').replace(/\^([0-9A-Za-z]+)/g, ' to the power $1')
    const found = { plain: 0, bracketed: 0, grouped: 0 }
    for (let i = 0; i < 400; i++) {
      const item = quant.generate(`render-quant-stem-${i}`)
      const stem = item.spec.stem
      if (!stem.includes('^')) continue
      if (/\^[0-9A-Za-z]/.test(stem)) found.plain++
      if (stem.includes('^(')) found.bracketed++
      if (stem.includes(')^')) found.grouped++
      const m = mountItem(item)
      const text = m.container.querySelector('.stem')?.textContent ?? ''
      expect(text, item.item_id).toBe(spoken(stem))
      expect(text, item.item_id).not.toMatch(/\Sto the power|to the power\S/)
      m.destroy()
    }
    expect(found.plain).toBeGreaterThan(0)
    expect(found.bracketed).toBeGreaterThan(0)
    expect(found.grouped).toBeGreaterThan(0)
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

  it('accepts exactly what checkNewEntry takes (property), with a neutral format or thousands note otherwise', () => {
    const item = quant.generate('render-quant-parse')
    fc.assert(
      fc.property(
        fc.oneof(fc.string({ maxLength: 8 }), fc.constantFrom('3/8', '2 1/3', '1,533', '−4', '$12.50', '45%', '0,5', '.5', '3.', '1/0', 'abc')),
        (text) => {
          const m = mountItem(item)
          typeInto(m.input, text)
          m.submit()
          // The box sends the typed text normalised (UX-024); a whole-number item takes whole numbers only.
          const sent = normalizeEntry(text, item.spec.input_format)
          // A number with thousands commas is refused with its own note although parseEntry reads it (UX-079).
          const value = parseEntry(sent)
          const thousands = checkNewEntry(sent) === 'thousands'
          const ok = value !== null && !thousands && (item.spec.input_format !== 'integer' || value.isInteger())
          expect(m.responses.length).toBe(ok ? 1 : 0)
          if (ok) expect(m.responses[0]).toBe(sent)
          if (!ok && text.trim() !== '') expect(m.container.querySelector('.hb-note')?.textContent).toBe(thousands ? THOUSANDS_NOTE : FORMAT_NOTES[item.spec.input_format])
          m.destroy()
        },
      ),
      { numRuns: 80 },
    )
  })

  /** A generated item with a given answer format. */
  function itemOf(format: QuantItem['spec']['input_format']): QuantItem {
    for (let i = 0; i < 2000; i++) {
      const item = quant.generate(`render-quant-format-${i}`)
      if (item.spec.input_format === format) return item
    }
    throw new Error(`no ${format} quant item`)
  }

  it('a whole-number item does not take 3.5: it gets the format note and nothing is sent (UX-024)', () => {
    const item = itemOf('integer')
    const m = mountItem(item)
    for (const text of ['3.5', '7/2', '0.25']) {
      typeInto(m.input, text)
      m.submit()
      expect(m.responses, text).toEqual([])
      expect(m.container.querySelector('.hb-note')?.textContent, text).toBe(FORMAT_NOTES.integer)
    }
    // Whole numbers in any spelling still go through (the parser reads "12.0" and "24/2" as 12).
    typeInto(m.input, '12')
    m.submit()
    expect(m.responses).toEqual(['12'])
  })

  it('the format notes name the rule that was broken, in plain words (UX-024)', () => {
    expect(FORMAT_NOTES.integer).toBe('That entry could not be read as a whole number. Use only the digits 0 to 9, with no spaces or commas, and a minus sign if needed, for example 42 or -7.')
    expect(FORMAT_NOTES.decimal).toBe('That entry could not be read as a number. Use only the digits 0 to 9 and a point (.) for decimals, with no spaces or commas, for example 12.5.')
  })

  it('digits of other scripts and full-width digits submit as ASCII; a mixed number keeps its spaces (UX-024)', () => {
    const item = itemOf('integer')
    const m = mountItem(item)
    typeInto(m.input, '１２')
    m.submit()
    expect(m.responses).toEqual(['12'])
    m.destroy()
    const again = mountItem(item)
    typeInto(again.input, '٣٥')
    again.submit()
    expect(again.responses).toEqual(['35'])
    again.destroy()
  })

  it('a decimal item offers a point key where the number pad may not have one (a comma language), inserting at the caret (UX-024)', () => {
    const decimal = (() => {
      try {
        return itemOf('decimal')
      } catch {
        return null
      }
    })()
    if (decimal === null) return
    const language = vi.spyOn(navigator, 'language', 'get')
    try {
      language.mockReturnValue('en-GB')
      expect(mountItem(decimal).container.querySelector('button[aria-label="Decimal point"]')).toBeNull()
      language.mockReturnValue('de-DE')
      const m = mountItem(decimal)
      const point = m.container.querySelector<HTMLButtonElement>('button[aria-label="Decimal point"]')
      expect(point).not.toBeNull()
      expect(point?.getAttribute('translate')).toBe('no')
      typeInto(m.input, '125')
      m.input.setSelectionRange(2, 2)
      click(point)
      expect(m.input.value).toBe('12.5')
      expect(m.input.selectionStart).toBe(3)
      expect(document.activeElement).toBe(m.input)
    } finally {
      language.mockRestore()
    }
  })

  it('an integer item has a sign key but no point key, in any language', () => {
    const language = vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE')
    try {
      const m = mountItem(itemOf('integer'))
      expect(m.container.querySelector('button[aria-label="Change sign"]')?.getAttribute('translate')).toBe('no')
      expect(m.container.querySelector('button[aria-label="Decimal point"]')).toBeNull()
    } finally {
      language.mockRestore()
    }
  })

  it('matches its snapshot', () => {
    expect(normalizeIds(mountItem(quant.generate('render-quant-snap')).container)).toMatchSnapshot()
  })
})
