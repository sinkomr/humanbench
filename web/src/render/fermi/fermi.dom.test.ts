/**
 * Fermi renderer (ROADMAP M5.1; DESIGN §3 rows 11–12, §4.2, §10, §13): the magnitude + unit entry with its
 * 80% range, what it sends, what it says about a slip, and that nothing in the DOM depends on the key.
 */

import { flushSync } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { demoFermiItem } from '../../tasks/fermi/demo'
import { ENTRY_COPY, ENTRY_NOTES, MAGNITUDE_NOTES } from '../../tasks/fermi/copy'
import { formatMagnitude } from '../../tasks/fermi/magnitude'
import { parseTrueValue, scoreFermi, type FermiResponse } from '../../tasks/fermi/scoring'
import type { FermiSpec } from '../../tasks/fermi/spec'
import { log10Between, unitsOf } from '../../tasks/fermi/units'
import { attributeProblems, normalizeIds } from '../common/leak'
import { buttonByText, click, fakeDisplay, render, typeInto } from '../common/testing'
import FermiRenderer from './FermiRenderer.svelte'

let cleanup: (() => void)[] = []
afterEach(() => {
  for (const f of cleanup) f()
  cleanup = []
})

const SPEC: FermiSpec = { stem: 'About how many seconds are there in 3 weeks?', dimension: 'time', units: ['s', 'min', 'h', 'day'], interval_pct: 80 }

function mountSpec(spec: FermiSpec, extra: Record<string, unknown> = {}) {
  const responses: FermiResponse[] = []
  const pastes: number[] = []
  const display = fakeDisplay()
  const r = render(FermiRenderer, { spec, onrespond: (x: FermiResponse) => responses.push(x), onpaste: (e: { t_ms: number }) => pastes.push(e.t_ms), timing: display, ...extra })
  cleanup.push(r.destroy)
  const input = (label: string): HTMLInputElement => {
    const el = [...r.container.querySelectorAll('label')].find((l) => l.textContent?.trim() === label)
    if (!el) throw new Error(`no label ${label}`)
    return r.container.querySelector(`#${el.htmlFor}`) as HTMLInputElement
  }
  const select = r.container.querySelector('select') as HTMLSelectElement | null
  const choose = (value: string): void => {
    if (!select) throw new Error('no select')
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
  }
  const fill = (value: string, low: string, high: string): void => {
    typeInto(input(ENTRY_COPY.value), value)
    typeInto(input(ENTRY_COPY.low), low)
    typeInto(input(ENTRY_COPY.high), high)
  }
  const submit = (): void => click(buttonByText(r.container, ENTRY_COPY.submit))
  const notes = (): string[] => [...r.container.querySelectorAll('.hb-note')].map((n) => n.textContent?.trim() ?? '').filter(Boolean)
  return { ...r, responses, pastes, display, input, select, choose, fill, submit, notes }
}

describe('FermiRenderer', () => {
  it('shows the stem, three labelled boxes, a unit box that starts unchosen, and the range hint', () => {
    const m = mountSpec(SPEC)
    expect(m.container.querySelector('.stem')?.textContent).toBe(SPEC.stem)
    for (const label of [ENTRY_COPY.value, ENTRY_COPY.low, ENTRY_COPY.high]) expect(m.input(label)).toBeInstanceOf(HTMLInputElement)
    expect(m.select?.value).toBe('')
    const options = [...(m.select?.options ?? [])]
    expect(options.map((o) => o.value)).toEqual(['', 's', 'min', 'h', 'day'])
    expect(options[0]?.disabled).toBe(true)
    expect(options.slice(1).map((o) => o.textContent)).toEqual(['seconds (s)', 'minutes (min)', 'hours (h)', 'days (day)'])
    expect(m.container.textContent).toContain(ENTRY_COPY.rangeHint)
    expect(m.container.textContent).toContain(ENTRY_COPY.unitHint)
  })

  it('sends the typed numbers and the chosen unit once, as a response the scorer accepts', () => {
    const m = mountSpec(SPEC)
    m.fill('1.8e6', '1,000,000', '3 × 10^6')
    m.choose('s')
    m.submit()
    expect(m.responses).toEqual([{ value: 1.8e6, unit: 's', low: 1e6, high: 3e6 }])
    m.submit() // a second press does nothing
    expect(m.responses).toHaveLength(1)
    expect(m.container.querySelector('.hb-status')?.textContent).toBe(ENTRY_COPY.recorded)
    for (const el of m.container.querySelectorAll('input')) expect(el.readOnly).toBe(true)
    expect(m.select?.disabled).toBe(true)
    expect(m.container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
  })

  it('shows how each number was read, in the chosen unit', () => {
    const m = mountSpec(SPEC)
    typeInto(m.input(ENTRY_COPY.value), '3.2e6')
    const reads = (): string[] => [...m.container.querySelectorAll('.reads')].map((p) => p.querySelector('[aria-hidden="true"]')?.textContent ?? '')
    expect(reads()[0]).toBe('Reads as 3.2 × 10⁶')
    m.choose('min')
    expect(reads()[0]).toBe('Reads as 3.2 × 10⁶ min')
    const spoken = m.container.querySelector('.reads .hb-sr-only')?.textContent
    expect(spoken).toBe('Reads as 3.2 times 10 to the 6 minutes')
    typeInto(m.input(ENTRY_COPY.value), '5 km')
    expect(reads()[0]).toBe('')
  })

  it('points each box at its preview, its note and the instructions', () => {
    const m = mountSpec(SPEC)
    for (const label of [ENTRY_COPY.value, ENTRY_COPY.low, ENTRY_COPY.high]) {
      const ids = (m.input(label).getAttribute('aria-describedby') ?? '').split(' ')
      expect(ids).toHaveLength(3)
      for (const id of ids) expect(m.container.querySelector(`#${id}`), id).not.toBeNull()
    }
    const unitIds = (m.select?.getAttribute('aria-describedby') ?? '').split(' ')
    for (const id of unitIds) expect(m.container.querySelector(`#${id}`), id).not.toBeNull()
  })

  it('asks for what is missing, per box, and sends nothing', () => {
    const m = mountSpec(SPEC)
    m.submit()
    expect(m.responses).toEqual([])
    expect(m.notes()).toEqual([MAGNITUDE_NOTES.empty, MAGNITUDE_NOTES.empty, MAGNITUDE_NOTES.empty, ENTRY_NOTES.unit])
    expect(m.input(ENTRY_COPY.value).getAttribute('aria-invalid')).toBe('true')
    expect(m.select?.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(m.input(ENTRY_COPY.value))
  })

  it('names a slip by what it is, never by right or wrong', () => {
    const m = mountSpec(SPEC)
    m.fill('3 million', '2,5', '-4')
    m.choose('s')
    m.submit()
    expect(m.notes()).toEqual([MAGNITUDE_NOTES.has_unit, MAGNITUDE_NOTES.decimal_comma, MAGNITUDE_NOTES.negative])
    expect(m.notes().join(' ')).not.toMatch(/\b(wrong|incorrect|correct|right|mistake)\b/i)
  })

  it('clears a box\'s note when it is typed in, and a range note when any box is', () => {
    const m = mountSpec(SPEC)
    m.fill('abc', '1', '2')
    m.choose('s')
    m.submit()
    expect(m.notes()).toEqual([MAGNITUDE_NOTES.unreadable])
    typeInto(m.input(ENTRY_COPY.value), '1.5')
    expect(m.notes()).toEqual([])
    m.fill('9', '1', '2') // guess above the high end
    m.submit()
    expect(m.notes()).toEqual([ENTRY_NOTES.order])
    expect(m.container.querySelector('[role="alert"]')?.textContent).toBe(ENTRY_NOTES.order)
    typeInto(m.input(ENTRY_COPY.value), '1.5')
    expect(m.notes()).toEqual([])
    m.submit()
    expect(m.responses).toEqual([{ value: 1.5, unit: 's', low: 1, high: 2 }])
  })

  it('refuses a range that is too wide', () => {
    const m = mountSpec(SPEC)
    m.fill('1', '1e-5', '1e5')
    m.choose('s')
    m.submit()
    expect(m.notes()).toEqual([ENTRY_NOTES.tooWide])
    expect(m.responses).toEqual([])
  })

  it('with one unit on offer, that unit is the choice and there is no placeholder', () => {
    const m = mountSpec({ stem: 'About how many people live in a big city?', dimension: 'count', units: ['count'], interval_pct: 80 })
    expect(m.select?.value).toBe('count')
    expect([...(m.select?.options ?? [])].map((o) => o.textContent)).toEqual(['(plain number)'])
    m.fill('2e6', '1e6', '5e6')
    m.submit()
    expect(m.responses).toEqual([{ value: 2e6, unit: 'count', low: 1e6, high: 5e6 }])
  })

  it('does nothing while disabled', () => {
    const m = mountSpec(SPEC, { disabled: true })
    expect(m.input(ENTRY_COPY.value).disabled).toBe(true)
    expect(m.select?.disabled).toBe(true)
    expect(m.container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
    m.container.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
    flushSync()
    expect(m.responses).toEqual([])
  })

  it('reports a paste with the clock time, and the first drawn frame once', () => {
    const frames: number[] = []
    const m = mountSpec(SPEC, { onshown: (t: number) => frames.push(t) })
    m.display.advance(40)
    expect(frames).toHaveLength(1)
    expect(frames[0]).toBeGreaterThan(1000)
    m.display.advance(100)
    expect(frames).toHaveLength(1)
    const at = m.display.now()
    m.input(ENTRY_COPY.value).dispatchEvent(new Event('paste', { bubbles: true }))
    expect(m.pastes).toEqual([at])
  })

  it('reads every number format and unit of the entry the same way the scorer needs (property of the demo items)', () => {
    for (let seed = 0; seed < 40; seed++) {
      const item = demoFermiItem(seed)
      const truth = parseTrueValue(item.truth.true_value)
      const m = mountSpec(item.spec)
      const unit = item.spec.units[seed % item.spec.units.length] as string
      const v = 10 ** log10Between(truth, item.truth.unit, unit)
      const text = [String(v), formatMagnitude(v).replace(/,/g, '')][seed % 2] as string
      m.fill(text, String(v * 0.8), String(v * 1.25))
      m.choose(unit)
      m.submit()
      expect(m.responses, text).toHaveLength(1)
      const score = scoreFermi(m.responses[0] as FermiResponse, item.truth)
      expect(score.abs_error_dex).toBeLessThan(1e-4)
      expect(score.hit).toBe(true)
      m.destroy()
    }
  })
})

describe('nothing in the DOM depends on the key', () => {
  it('has no data attribute and no attribute that names an answer', () => {
    const m = mountSpec(SPEC)
    expect(attributeProblems(m.container)).toEqual([])
    m.fill('1', '1', '1')
    m.choose('s')
    m.submit()
    expect(attributeProblems(m.container)).toEqual([])
  })

  it('renders the same markup for two items of one shape, apart from the stem and the offered units (300 demo items)', () => {
    const units = (spec: FermiSpec): string => spec.units.join(',')
    const byShape = new Map<string, string>()
    for (let seed = 0; seed < 300; seed++) {
      const item = demoFermiItem(seed)
      const m = mountSpec(item.spec)
      const html = normalizeIds(m.container).replace(/<p class="stem[^"]*"[^>]*>[^<]*<\/p>/, '<p class="stem"></p>')
      const shape = `${item.spec.dimension}|${units(item.spec)}`
      const seen = byShape.get(shape)
      if (seen === undefined) byShape.set(shape, html)
      else expect(html, `${seed} ${shape}`).toBe(seen)
      m.destroy()
    }
    expect(byShape.size).toBeGreaterThan(2)
  })

  it('never contains the truth, in any unit or format, before or after an answer (300 demo items)', () => {
    for (let seed = 0; seed < 300; seed++) {
      const item = demoFermiItem(seed)
      const truth = parseTrueValue(item.truth.true_value)
      const m = mountSpec(item.spec)
      const unit = item.spec.units[0] as string
      m.fill('1', '1', '1')
      m.choose(unit)
      for (const phase of ['before', 'after']) {
        const html = m.container.innerHTML
        const text = m.container.textContent ?? ''
        for (const u of unitsOf(item.spec.dimension)) {
          const w = 10 ** log10Between(truth, item.truth.unit, u.symbol)
          for (const form of [String(w), formatMagnitude(w), w.toLocaleString('en-US')]) {
            if (form.replace(/\D/g, '').length < 3) continue
            expect(html.includes(form), `${seed} ${phase} html ${form}`).toBe(false)
            expect(text.includes(form), `${seed} ${phase} text ${form}`).toBe(false)
          }
        }
        if (phase === 'before') m.submit()
      }
      m.destroy()
    }
  })
})
