/**
 * No key or correctness hint in the DOM (ROADMAP M1.13 acceptance; A18; DESIGN §4.2, §12
 * `item_keys` never reach the client beyond the render payload). Many generated instances per
 * family are rendered and their serialized DOM scanned:
 *
 * - everywhere: no `data-*` attribute, and no attribute name or value naming an answer
 *   (`attributeProblems`);
 * - series, quant (the key is never shown): every letter/digit run in the DOM comes from the
 *   renderer's own copy (a structural twin: the same spec shape with sentinel values) or from the
 *   spec's values; and the key itself (its digits, fraction or decimal form, or letter) is absent
 *   whenever the spec and the copy do not already contain it, which must be most instances;
 * - span, Corsi, RT (the stimuli are the key by design, §14.6 ex. 10–12): outside the moment a
 *   stimulus is shown the DOM is byte-identical to a twin whose stimuli differ (the intro, the
 *   entry phase after a sequence, the fixation before a target), so nothing of the target survives
 *   into the DOM; the Corsi blocks and RT positions are identical apart from their fixed place;
 * - coding (the legend is the key by design, §3 row 10): apart from the legend and the current
 *   glyph, the running block is byte-identical to a twin with another legend and stream, and the
 *   keypad buttons are identical apart from their digit;
 * - reading: each question's options are in spec order, identical apart from text and position
 *   (the keyed option included), and the DOM holds only the renderer's copy and the spec's text.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { coding } from '../tasks/coding'
import { CODING_SYMBOLS, type CodingItem, type CodingSpec, type CodingSymbol } from '../tasks/coding/config'
import { quant, type QuantItem } from '../tasks/quant'
import { reading, type ReadingItem } from '../tasks/reading'
import type { ReadingSpec } from '../tasks/reading/types'
import { rtChoice4, rtSimple, type RtItem } from '../tasks/rt'
import type { RtSpec } from '../tasks/rt/types'
import { series } from '../tasks/series'
import type { SeriesItem, SeriesSpec } from '../tasks/series/types'
import { corsi, spanBwd, spanFwd } from '../tasks/span'
import type { SpanItem, SpanSpec } from '../tasks/span/config'
import CodingRenderer from './coding/CodingRenderer.svelte'
import { attributeProblems, containsWhole, leafTexts, normalizeIds, optionSignature, tokensOf } from './common/leak'
import { buttonByText, click, fakeDisplay, render, type FakeDisplay } from './common/testing'
import QuantRenderer from './quant/QuantRenderer.svelte'
import ReadingRenderer from './reading/ReadingRenderer.svelte'
import RtRenderer from './rt/RtRenderer.svelte'
import SeriesRenderer from './series/SeriesRenderer.svelte'
import { displayTerm } from './series/terms'
import CorsiRenderer from './span/CorsiRenderer.svelte'
import DigitSpanRenderer from './span/DigitSpanRenderer.svelte'

const FRAME = 1000 / 60
const noop = (): void => {}

let cleanup: (() => void)[] = []
afterEach(() => {
  for (const f of cleanup) f()
  cleanup = []
})

function mount(component: Parameters<typeof render>[0], spec: object, display: FakeDisplay = fakeDisplay(), extra: Record<string, unknown> = {}) {
  const r = render(component, { spec, onrespond: noop, timing: display, ...extra })
  cleanup.push(r.destroy)
  return { ...r, display }
}

const lower = (xs: Iterable<string>): Set<string> => new Set([...xs].map((x) => x.toLowerCase()))

function until(display: FakeDisplay, pred: () => boolean, maxMs = 20_000): void {
  let t = 0
  while (!pred()) {
    if (t > maxMs) throw new Error('condition not reached')
    display.advance(FRAME)
    t += FRAME
  }
}

describe('series: the DOM holds only the copy and the visible terms, never the key', () => {
  it('over 300 instances', () => {
    let detectable = 0
    const N = 300
    for (let i = 0; i < N; i++) {
      const item: SeriesItem = series.generate(`leak-series-${i}`)
      const twin: SeriesSpec =
        item.spec.input_format === 'letter'
          ? { input_format: 'letter', terms: item.spec.terms.map((_, k) => `Qz${k}`) }
          : { input_format: 'integer', terms: item.spec.terms.map((_, k) => 987_650 + k) }
      const real = mount(SeriesRenderer, item.spec)
      const copy = mount(SeriesRenderer, twin)
      expect(attributeProblems(real.container)).toEqual([])
      const html = normalizeIds(real.container)
      const chrome = lower(tokensOf(normalizeIds(copy.container)))
      const specTokens = lower(tokensOf(item.spec.terms.map((t) => displayTerm(t)).join(' ')))
      const extra = [...lower(tokensOf(html))].filter((t) => !chrome.has(t) && !specTokens.has(t))
      expect(extra, item.item_id).toEqual([])
      const key = ('letter' in item.key ? item.key.letter : item.key.value.replace(/^-/, '')).toLowerCase()
      if (!chrome.has(key) && !specTokens.has(key)) {
        detectable++
        expect(lower(tokensOf(html)).has(key), item.item_id).toBe(false)
      }
      real.destroy()
      copy.destroy()
    }
    expect(detectable / N).toBeGreaterThan(0.8)
  })
})

/** The forms a quant key could be written in: "p/q" (and its terminating decimal) or the integer's digits. */
function quantKeyForms(value: string): string[] {
  const abs = value.replace(/^-/, '')
  const [p, q] = abs.split('/')
  if (q === undefined) return [abs]
  const forms = [abs]
  let d = Number(q)
  let twos = 0
  let fives = 0
  while (d % 2 === 0) ((d /= 2), twos++)
  while (d % 5 === 0) ((d /= 5), fives++)
  if (d === 1) forms.push((Number(p) / Number(q)).toFixed(Math.max(twos, fives)))
  return forms
}

describe('quant: the DOM holds only the copy, the stem and the hint, never the key', () => {
  it('over 300 instances', () => {
    let detectable = 0
    const N = 300
    for (let i = 0; i < N; i++) {
      const item: QuantItem = quant.generate(`leak-quant-${i}`)
      const twin = { ...item.spec, stem: 'Zqstem zqtext^zqpow', hint: 'Zqhint' }
      const real = mount(QuantRenderer, item.spec)
      const copy = mount(QuantRenderer, twin)
      expect(attributeProblems(real.container)).toEqual([])
      const html = normalizeIds(real.container)
      const chromeHtml = normalizeIds(copy.container)
      const chrome = lower(tokensOf(chromeHtml))
      const specText = `${item.spec.stem} ${item.spec.hint}`
      const specTokens = lower(tokensOf(specText))
      const extra = [...lower(tokensOf(html))].filter((t) => !chrome.has(t) && !specTokens.has(t))
      expect(extra, item.item_id).toEqual([])
      const forms = quantKeyForms(item.key.value)
      if (forms.every((f) => !containsWhole(specText, f) && !containsWhole(chromeHtml, f))) {
        detectable++
        for (const f of forms) expect(containsWhole(html, f), `${item.item_id} shows ${f}`).toBe(false)
      }
      real.destroy()
      copy.destroy()
    }
    expect(detectable / N).toBeGreaterThan(0.6)
  })
})

/** A span spec with the same shape and other stimuli (digits 1–9 or blocks 0–8 shifted by one). */
function spanTwin(spec: SpanSpec): SpanSpec {
  const shift = spec.task === 'corsi' ? (b: number) => (b + 1) % 9 : (d: number) => (d % 9) + 1
  return { ...spec, trials: spec.trials.map((t) => t.map(shift)) }
}

const inEntry = (root: HTMLElement): boolean => /^(Enter|Selected)/.test(root.querySelector('.hb-status')?.textContent ?? '')

for (const [family, component] of [
  [spanFwd, DigitSpanRenderer],
  [spanBwd, DigitSpanRenderer],
  [corsi, CorsiRenderer],
] as const) {
  describe(`${family.name}: nothing of the targets outside the stimulus itself`, () => {
    it('over 40 instances: intro and entry DOM are identical to a twin with other stimuli', () => {
      for (let i = 0; i < 40; i++) {
        const item: SpanItem = family.generate(`leak-${family.name}-${i}`)
        const real = mount(component, item.spec)
        const copy = mount(component, spanTwin(item.spec))
        expect(normalizeIds(real.container)).toBe(normalizeIds(copy.container))
        click(buttonByText(real.container, 'Start'))
        click(buttonByText(copy.container, 'Start'))
        until(real.display, () => {
          copy.display.advance(FRAME)
          // While presenting, at most one stimulus is on view.
          expect(real.container.querySelectorAll('.block.lit').length).toBeLessThanOrEqual(1)
          return inEntry(real.container)
        })
        until(copy.display, () => inEntry(copy.container))
        expect(attributeProblems(real.container)).toEqual([])
        const html = normalizeIds(real.container)
        expect(html, item.item_id).toBe(normalizeIds(copy.container))
        real.destroy()
        copy.destroy()
      }
    })
  })
}

describe('corsi: the 9 blocks differ only in their fixed place and number', () => {
  it('block signatures are identical once position, number and focus are erased', () => {
    const item = corsi.generate('leak-corsi-sig')
    const m = mount(CorsiRenderer, item.spec)
    click(buttonByText(m.container, 'Start'))
    until(m.display, () => inEntry(m.container))
    const sigs = [...m.container.querySelectorAll('button.block')].map((b, i) => {
      const c = b.cloneNode(true) as HTMLElement
      c.removeAttribute('style')
      c.removeAttribute('tabindex')
      expect(c.getAttribute('aria-label')).toBe(`Block ${i + 1}`)
      c.removeAttribute('aria-label')
      return c.outerHTML
    })
    expect(new Set(sigs).size).toBe(1)
  })
})

function rtTwin(spec: RtSpec): RtSpec {
  const shift = (p: number): number => (p + 1) % spec.n_positions
  return { ...spec, positions: spec.positions.map(shift), practice_positions: spec.practice_positions.map(shift) }
}

for (const family of [rtSimple, rtChoice4]) {
  describe(`${family.name}: no position is marked before the target appears`, () => {
    it('over 40 instances: intro and fixation DOM are identical to a twin with other positions', () => {
      for (let i = 0; i < 40; i++) {
        const item: RtItem = family.generate(`leak-${family.name}-${i}`)
        const mode = i % 2 === 0 ? 'keyboard' : 'touch'
        const real = mount(RtRenderer, item.spec, fakeDisplay(), { inputMode: mode })
        const copy = mount(RtRenderer, rtTwin(item.spec), fakeDisplay(), { inputMode: mode })
        expect(normalizeIds(real.container)).toBe(normalizeIds(copy.container))
        click(buttonByText(real.container, 'Start practice'))
        click(buttonByText(copy.container, 'Start practice'))
        real.display.advance(2 * FRAME)
        copy.display.advance(2 * FRAME)
        expect(real.container.querySelector('.fixation')?.textContent).toBe('+')
        expect(attributeProblems(real.container)).toEqual([])
        expect(normalizeIds(real.container), item.item_id).toBe(normalizeIds(copy.container))
        const pads = [...real.container.querySelectorAll('.pad')].map((p, k) => optionSignature(p, k).replace(/aria-label="[^"]*"/, ''))
        expect(new Set(pads).size).toBe(1)
        // Once shown, exactly the spec's position carries the target.
        until(real.display, () => real.container.querySelector('.pad.on') !== null)
        const on = [...real.container.querySelectorAll('.pad')].findIndex((p) => p.classList.contains('on'))
        expect(on).toBe(item.spec.practice_positions[0])
        real.destroy()
        copy.destroy()
      }
    })
  })
}

function codingTwin(spec: CodingSpec): CodingSpec {
  const next = (s: CodingSymbol): CodingSymbol => CODING_SYMBOLS[(CODING_SYMBOLS.indexOf(s) + 4) % 9] as CodingSymbol
  return { ...spec, legend: spec.legend.map((c) => ({ digit: c.digit, symbol: next(c.symbol) })), sequence: spec.sequence.map(next) }
}

describe('coding: apart from the legend and the current glyph, nothing depends on the item', () => {
  it('over 40 instances', () => {
    for (let i = 0; i < 40; i++) {
      const item: CodingItem = coding.generate(`leak-coding-${i}`)
      const real = mount(CodingRenderer, item.spec)
      const copy = mount(CodingRenderer, codingTwin(item.spec))
      click(buttonByText(real.container, 'Start'))
      click(buttonByText(copy.container, 'Start'))
      real.display.advance(FRAME)
      copy.display.advance(FRAME)
      expect(attributeProblems(real.container)).toEqual([])
      const strip = (root: HTMLElement): string => {
        const c = root.cloneNode(true) as HTMLElement
        for (const el of c.querySelectorAll('.legend, .stage, [aria-live="assertive"]')) el.remove()
        const d = document.createElement('div')
        d.appendChild(c)
        return normalizeIds(d)
      }
      expect(strip(real.container), item.item_id).toBe(strip(copy.container))
      const keys = [...real.container.querySelectorAll('.keypad button')]
      expect(keys.map((k) => k.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
      expect(new Set(keys.map((k, n) => optionSignature(k, n))).size).toBe(1)
      real.destroy()
      copy.destroy()
    }
  })
})

function readingTwin(spec: ReadingSpec): ReadingSpec {
  return {
    ...spec,
    passage_id: 'zq-passage',
    paragraphs: spec.paragraphs.map((_, k) => `Zqpara ${k}`),
    source: { ...spec.source, title: 'Zqtitle', author: 'Zqauthor', url: 'https://www.gutenberg.org/ebooks/1' },
    questions: spec.questions.map((q, k) => ({ id: `zq#q${k}`, stem: `Zqstem${k}`, options: q.options.map((_, o) => `Zqopt${k}x${o}`) })),
  }
}

describe('reading: options in spec order, the keyed one indistinguishable, only spec text shown', () => {
  it('over 60 instances', () => {
    for (let i = 0; i < 60; i++) {
      const item: ReadingItem = reading.generate(`leak-reading-${i}`)
      const real = mount(ReadingRenderer, item.spec)
      const copy = mount(ReadingRenderer, readingTwin(item.spec))
      for (const m of [real, copy]) {
        click(buttonByText(m.container, 'Show the passage'))
        m.display.advance(FRAME + 1000)
        click(buttonByText(m.container, 'Done reading'))
      }
      expect(attributeProblems(real.container)).toEqual([])
      const fieldsets = [...real.container.querySelectorAll('fieldset')]
      fieldsets.forEach((fs, qi) => {
        const labels = [...fs.querySelectorAll('label')]
        expect(labels.map((l) => l.textContent?.trim())).toEqual(item.spec.questions[qi]?.options)
        const sigs = labels.map((l, k) => optionSignature(l, k))
        expect(new Set(sigs).size, `${item.item_id} q${qi}`).toBe(1)
      })
      const chrome = lower(tokensOf(normalizeIds(copy.container)))
      const specTokens = lower(tokensOf(leafTexts({ paragraphs: item.spec.paragraphs, q: item.spec.questions.map((q) => [q.stem, q.options]), n: item.spec.word_count }).join(' ')))
      const extra = [...lower(tokensOf(normalizeIds(real.container)))].filter((t) => !chrome.has(t) && !specTokens.has(t))
      expect(extra, item.item_id).toEqual([])
      real.destroy()
      copy.destroy()
    }
  })
})
