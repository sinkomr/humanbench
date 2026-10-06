/**
 * The number-entry grammar in the quant entry box (UX-079; DESIGN §4.2, §7.8): a decimal comma is
 * read as a decimal point, a number written with thousands commas is refused before it is submitted
 * with a note that asks for 1500 and 1.5 (score() still reads it in saved answers), and the hints say
 * "whole number". Series, whose box shares the component, keeps its own grammar and wording.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { quant, type QuantItem } from '../../tasks/quant'
import { Fraction } from '../../tasks/quant/fraction'
import type { QuantResponse } from '../../tasks/quant/score'
import { series } from '../../tasks/series'
import type { SeriesResponse } from '../../tasks/series/types'
import { FORMAT_HINTS, FORMAT_NOTES, THOUSANDS_NOTE } from '../common/entry-copy'
import { buttonByText, click, fakeDisplay, render, typeInto } from '../common/testing'
import SeriesRenderer from '../series/SeriesRenderer.svelte'
import QuantRenderer from './QuantRenderer.svelte'

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
  const note = (): string => r.container.querySelector('.hb-note')?.textContent ?? ''
  const hint = (): string => r.container.querySelector('.hint')?.textContent ?? ''
  const enter = (text: string): void => {
    typeInto(input, text)
    click(buttonByText(r.container, 'Submit'))
  }
  return { ...r, input, responses, note, hint, enter }
}

/** A generated item with a given answer format (and, optionally, a key that passes `keyOk`). */
function itemOf(format: QuantItem['spec']['input_format'], keyOk: (key: Fraction) => boolean = () => true): QuantItem {
  for (let i = 0; i < 4000; i++) {
    const item = quant.generate(`entry-grammar-${format}-${i}`)
    if (item.spec.input_format === format && keyOk(Fraction.parseCanonical(item.key.value) as Fraction)) return item
  }
  throw new Error(`no ${format} quant item`)
}

/** The key with at most two decimal places as text with a decimal comma ("28,9"), or null. */
function commaText(key: Fraction): string | null {
  for (const places of [1, 2]) {
    const scaled = key.mul(Fraction.of(10n ** BigInt(places)))
    if (!scaled.isInteger()) continue
    const n = scaled.n < 0n ? -scaled.n : scaled.n
    const digits = n.toString().padStart(places + 1, '0')
    return `${scaled.n < 0n ? '-' : ''}${digits.slice(0, -places)},${digits.slice(-places)}`
  }
  return null
}

describe('quant entry box: decimal comma (UX-079)', () => {
  it('takes a decimal comma on a decimal or fraction item, sends it as typed, and score() reads it as the decimal', () => {
    let checked = 0
    for (const format of ['decimal', 'fraction'] as const) {
      let item: QuantItem
      try {
        item = itemOf(format, (k) => !k.isInteger() && commaText(k) !== null)
      } catch {
        continue // the templates have no such key in this format
      }
      const text = commaText(Fraction.parseCanonical(item.key.value) as Fraction) as string
      const m = mountItem(item)
      m.enter(text)
      expect(m.note(), text).toBe('')
      expect(m.responses, text).toEqual([text])
      expect(quant.score(item, text).correct, `${item.item_id} ${text}`).toBe(1)
      m.destroy()
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('takes "3,5", "0,25" and "-1,5" on a fraction item', () => {
    for (const text of ['3,5', '0,25', '-1,5']) {
      const m = mountItem(itemOf('fraction'))
      m.enter(text)
      expect(m.responses, text).toEqual([text])
      m.destroy()
    }
  })

  it('on a whole-number item "3,5" is 3.5, so it gets the whole-number note; "35,0" is 35 and goes through', () => {
    const m = mountItem(itemOf('integer'))
    m.enter('3,5')
    expect(m.responses).toEqual([])
    expect(m.note()).toBe(FORMAT_NOTES.integer)
    m.enter('35,0')
    expect(m.responses).toEqual(['35,0'])
  })
})

describe('quant entry box: thousands commas (UX-079)', () => {
  it('refuses "1,500" and its kin on every format with the thousands note, sends nothing, and takes 1500 after', () => {
    for (const format of ['integer', 'decimal', 'fraction'] as const) {
      let item: QuantItem
      try {
        item = itemOf(format)
      } catch {
        continue
      }
      const m = mountItem(item)
      for (const text of ['1,500', '12,345.5', '-1,500', '1,500%', '$1,234.50', '0,500']) {
        m.enter(text)
        expect(m.responses, `${format} ${text}`).toEqual([])
        expect(m.note(), `${format} ${text}`).toBe(THOUSANDS_NOTE)
        expect(m.input.getAttribute('aria-invalid'), `${format} ${text}`).toBe('true')
      }
      typeInto(m.input, '150')
      expect(m.note()).toBe('') // typing clears the note
      m.enter('1500')
      expect(m.responses).toEqual(['1500'])
      m.destroy()
    }
  })

  it('the thousands note is the agreed sentence and names no right or wrong answer', () => {
    expect(THOUSANDS_NOTE).toBe('Write thousands without a comma (1500) and decimals with a point (1.5).')
    expect(THOUSANDS_NOTE).not.toMatch(/correct|wrong|right|incorrect/i)
  })

  it('a saved "1,500" still scores as 1500 (results are re-scored from raw responses, §7.8)', () => {
    const item = itemOf('integer')
    const saved: QuantItem = { ...item, key: { value: '1500', tol: { abs: 0 } } }
    for (const text of ['1,500', '1500', '1,500.0']) expect(quant.score(saved, text).correct, text).toBe(1)
    expect(quant.score(saved, '1,5').correct).toBe(0)
  })
})

describe('entry hints say "whole number" (UX-079)', () => {
  it('in quant, on whole-number and fraction items', () => {
    expect(mountItem(itemOf('integer')).hint()).toBe('Enter a whole number, such as 42 or -7.')
    expect(mountItem(itemOf('fraction')).hint()).toBe('Enter a fraction such as 3/8, or a whole number.')
    for (let i = 0; i < 60; i++) expect(mountItem(quant.generate(`entry-grammar-hint-${i}`)).hint()).not.toMatch(/integer/i)
  })

  it('in series, whose box keeps its grammar: "1,500" gets the whole-number note there', () => {
    for (let i = 0; i < 200; i++) {
      const item = series.generate(`entry-grammar-series-${i}`)
      if (item.spec.input_format !== 'integer') continue
      const responses: SeriesResponse[] = []
      const r = render(SeriesRenderer, { spec: item.spec, onrespond: (x: SeriesResponse) => responses.push(x), timing: fakeDisplay() })
      cleanup.push(r.destroy)
      expect(r.container.querySelector('.hint')?.textContent).toBe(FORMAT_HINTS.integer)
      typeInto(r.container.querySelector('input'), '1,500')
      click(buttonByText(r.container, 'Submit'))
      expect(responses).toEqual([])
      expect(r.container.querySelector('.hb-note')?.textContent).toBe(FORMAT_NOTES.integer)
      return
    }
    throw new Error('no integer series item')
  })
})
