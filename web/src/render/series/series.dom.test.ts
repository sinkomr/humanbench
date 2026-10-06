/**
 * Series renderer (ROADMAP M1.13, A18; DESIGN §4.2): terms in spec order, typed entry parsed exactly
 * like series score(), the typed text is a response score() takes, neutral format notes, keyboard
 * submit, paste and onset callbacks, and a snapshot.
 */

import fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import { series } from '../../tasks/series'
import { parseIntegerResponse, parseLetterResponse } from '../../tasks/series/score'
import type { SeriesItem, SeriesResponse } from '../../tasks/series/types'
import { FORMAT_NOTES } from '../common/entry-copy'
import { normalizeEntry } from '../common/normalize-digits'
import { normalizeIds } from '../common/leak'
import { buttonByText, click, fakeDisplay, render, typeInto } from '../common/testing'
import SeriesRenderer from './SeriesRenderer.svelte'
import { displayTerm } from './terms'

let cleanup: (() => void)[] = []
afterEach(() => {
  for (const f of cleanup) f()
  cleanup = []
})

function mountItem(item: SeriesItem, extra: Record<string, unknown> = {}) {
  const responses: SeriesResponse[] = []
  const r = render(SeriesRenderer, { spec: item.spec, onrespond: (x: SeriesResponse) => responses.push(x), timing: fakeDisplay(), ...extra })
  cleanup.push(r.destroy)
  const input = r.container.querySelector('input') as HTMLInputElement
  const submit = () => click(buttonByText(r.container, 'Submit'))
  return { ...r, input, submit, responses }
}

const keyText = (item: SeriesItem): string => ('letter' in item.key ? item.key.letter : item.key.value)

function findItem(pred: (i: SeriesItem) => boolean): SeriesItem {
  for (let i = 0; i < 5000; i++) {
    const item = series.generate(`render-series-${i}`)
    if (pred(item)) return item
  }
  throw new Error('no such item')
}

describe('SeriesRenderer', () => {
  it('shows the terms in spec order and a blank for the next one', () => {
    const item = series.generate('render-series-order')
    const { container } = mountItem(item)
    const shown = [...container.querySelectorAll('.term:not(.next)')].map((li) => li.textContent)
    expect(shown).toEqual(item.spec.terms.map((t) => displayTerm(t)))
    expect(container.querySelector('.term.next')?.textContent).toContain('?')
  })

  it('typing the key and submitting sends that text, and score() marks it correct', () => {
    for (let i = 0; i < 60; i++) {
      const item = series.generate(`render-series-key-${i}`)
      const m = mountItem(item)
      typeInto(m.input, keyText(item))
      m.submit()
      expect(m.responses).toEqual([keyText(item)])
      expect(series.score(item, m.responses[0] as SeriesResponse).correct).toBe(1)
      m.destroy()
    }
  })

  it('accepts exactly what the series parser reads (property), with a neutral format note otherwise', () => {
    const intItem = findItem((i) => i.spec.input_format === 'integer')
    const letterItem = findItem((i) => i.spec.input_format === 'letter')
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 6 }), fc.integer({ min: -999, max: 999 }).map(String), fc.constantFrom('−7', ' 42 ', '+3', '3.5', 'k', 'K ', 'ab', '')), (text) => {
        for (const [item, parse] of [
          [intItem, parseIntegerResponse],
          [letterItem, parseLetterResponse],
        ] as const) {
          const m = mountItem(item)
          typeInto(m.input, text)
          m.submit()
          // What the box sends is the typed text with its digits and spacing normalised (UX-024); the parser reads that.
          const sent = normalizeEntry(text, item.spec.input_format)
          const ok = parse(sent) !== undefined
          expect(m.responses.length).toBe(ok ? 1 : 0)
          if (ok) expect(m.responses[0]).toBe(sent)
          if (ok) expect(() => series.score(item, m.responses[0] as SeriesResponse)).not.toThrow()
          else {
            const note = m.container.querySelector('.hb-note')?.textContent ?? ''
            if (text.trim() !== '') expect(note).toBe(FORMAT_NOTES[item.spec.input_format])
            expect(note).not.toMatch(/correct|wrong|right|incorrect/i)
          }
          m.destroy()
        }
      }),
      { numRuns: 60 },
    )
  })

  it('submits once, from the keyboard too (Enter submits the form), then locks', () => {
    const item = findItem((i) => i.spec.input_format === 'integer')
    const m = mountItem(item)
    typeInto(m.input, '12')
    m.input.form?.requestSubmit()
    typeInto(m.input, '13')
    m.input.form?.requestSubmit()
    expect(m.responses).toEqual(['12'])
    expect(m.input.readOnly).toBe(true)
  })

  it('disabled: no typing or submitting (the session is paused)', () => {
    const item = findItem((i) => i.spec.input_format === 'integer')
    const m = mountItem(item, { disabled: true })
    expect(m.input.disabled).toBe(true)
    expect(buttonByText(m.container, 'Submit').disabled).toBe(true)
    m.input.form?.requestSubmit()
    expect(m.responses).toEqual([])
  })

  it('the ± button flips the sign of an integer entry', () => {
    const item = findItem((i) => i.spec.input_format === 'integer')
    const m = mountItem(item)
    typeInto(m.input, '15')
    click(m.container.querySelector('button[aria-label="Change sign"]'))
    expect(m.input.value).toBe('-15')
    click(m.container.querySelector('button[aria-label="Change sign"]'))
    expect(m.input.value).toBe('15')
  })

  it('reads digits of other scripts and full-width digits as the digits they are, and sends plain ASCII (UX-024)', () => {
    const item = findItem((i) => i.spec.input_format === 'integer')
    for (const [typed, sent] of [
      ['٣٥', '35'],
      ['۱۲', '12'],
      ['१२', '12'],
      ['１２', '12'],
      ['1 2', '12'],
      ['1\u00a02', '12'],
      ['1\u202f2', '12'],
      ['−٣٥', '−35'],
    ] as const) {
      const m = mountItem(item)
      typeInto(m.input, typed)
      m.submit()
      expect(m.responses, typed).toEqual([sent])
      expect(() => series.score(item, m.responses[0] as SeriesResponse)).not.toThrow()
      m.destroy()
    }
  })

  it('names one noun for the whole item: the number items say number, the letter items say letter (UX-025)', () => {
    for (const [format, noun] of [
      ['integer', 'number'],
      ['letter', 'letter'],
    ] as const) {
      const item = findItem((i) => i.spec.input_format === format)
      const { container } = mountItem(item)
      expect(container.querySelector('section')?.getAttribute('aria-label')).toBe('Number or letter sequence')
      expect(container.querySelector('.prompt')?.textContent).toBe(`Which ${noun} comes next in this sequence?`)
      expect(container.querySelector('label.label')?.textContent).toBe(`Next ${noun}`)
      expect(container.querySelector('input')?.labels?.[0]?.textContent).toBe(`Next ${noun}`)
      expect(container.querySelector('.term.next .hb-sr-only')?.textContent).toBe(`missing next ${noun}`)
      expect(container.querySelector('ol.terms')?.getAttribute('aria-label')).toBe(`Sequence, ${item.spec.terms.length} terms shown, then the missing next ${noun}`)
      expect(container.textContent).not.toMatch(/next term/i)
    }
  })

  it('reports the onset frame and pastes on the performance.now() timeline', () => {
    const item = series.generate('render-series-onset')
    const display = fakeDisplay()
    const shown: number[] = []
    const pastes: number[] = []
    const m = mountItem(item, { timing: display, onshown: (t: number) => shown.push(t), onpaste: (e: { t_ms: number }) => pastes.push(e.t_ms) })
    expect(shown).toEqual([])
    display.advance(20)
    expect(shown).toHaveLength(1)
    expect(shown[0]).toBeCloseTo(1000 + 1000 / 60, 6)
    display.advance(500)
    m.input.dispatchEvent(new Event('paste', { bubbles: true }))
    expect(pastes).toEqual([display.now()])
  })

  it('matches its snapshot (integer and letter)', () => {
    const intItem = series.generate('render-series-snap')
    const letterItem = findItem((i) => i.spec.input_format === 'letter')
    expect(normalizeIds(mountItem(intItem).container)).toMatchSnapshot()
    expect(normalizeIds(mountItem(letterItem).container)).toMatchSnapshot()
  })
})
