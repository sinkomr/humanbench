/**
 * Qdata renderer (DESIGN §3 row 6, §13; ROADMAP M1.13, A18): tables with caption and header scopes,
 * charts as an SVG image named by a hidden table of the same values (complete, with the full
 * category names), a printed label on every value, two series told apart by line style and point
 * shape, the stem and the item's hint, entry that opens on the first frame and sends the typed text,
 * and no key in the DOM (only the spec's own words and numbers and the renderer's copy).
 */

import { afterEach, describe, expect, it } from 'vitest'
import { qdata, type QdataItem } from '../../tasks/qdata'
import type { ChartExhibit, QdataSpec, TableExhibit } from '../../tasks/qdata/spec'
import { attributeProblems, containsWhole, leafTexts, normalizeIds, tokensOf } from '../common/leak'
import { buttonByText, click, fakeDisplay, render, typeInto, type FakeDisplay } from '../common/testing'
import { FORMAT_NOTES } from '../common/entry-copy'
import QdataRenderer from './QdataRenderer.svelte'
import { LABEL_MAX, chartLayout, fmt, shortLabel } from './chart'
import { QDATA_REGION_LABEL, chartTableCaption, unitLine } from './copy'

const FRAME = 1000 / 60

/** The text of every text node under `root`, joined by line breaks (so adjacent cells do not run together). */
function nodeTexts(root: Element): string {
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  const out: string[] = []
  while (walker.nextNode()) out.push((walker.currentNode as Text).data)
  return out.join('\n')
}
let cleanup: (() => void)[] = []
afterEach(() => {
  for (const f of cleanup) f()
  cleanup = []
})

function mountSpec(spec: QdataSpec, display: FakeDisplay = fakeDisplay(), extra: Record<string, unknown> = {}) {
  const responses: string[] = []
  const r = render(QdataRenderer, { spec, onrespond: (x: string) => responses.push(x), timing: display, ...extra })
  cleanup.push(r.destroy)
  const input = r.container.querySelector('input') as HTMLInputElement
  return { ...r, display, input, responses, submit: () => click(buttonByText(r.container, 'Submit')) }
}

/** A generated item whose exhibit is of `kind` (and, for a line chart, with `series` series). */
function itemWith(kind: 'table' | 'bar' | 'line' | 'none', series = 1, salt = 'r'): QdataItem {
  for (let i = 0; i < 4000; i++) {
    const it = qdata.generate(`${salt}-${kind}-${series}-${i}`)
    const x = it.spec.exhibit
    if (kind === 'none' ? x === undefined : x?.kind === kind && (x.kind === 'table' || x.series.length === series)) return it
  }
  throw new Error(`no ${kind} item`)
}

describe('QdataRenderer', () => {
  it('draws a table with its title as caption, column and row headers, and every value', () => {
    const item = itemWith('table')
    const x = item.spec.exhibit as TableExhibit
    const { container } = mountSpec(item.spec)
    const table = container.querySelector('table.data') as HTMLTableElement
    expect(table.caption?.textContent).toBe(x.title)
    expect([...table.querySelectorAll('thead th')].map((th) => [th.getAttribute('scope'), th.textContent])).toEqual(
      [x.row_header, ...x.columns].map((t) => ['col', t]),
    )
    const rows = [...table.querySelectorAll('tbody tr')]
    expect(rows.map((r) => r.querySelector('th[scope="row"]')?.textContent)).toEqual(x.rows.map((r) => r.label))
    expect(rows.map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent))).toEqual(x.rows.map((r) => r.values.map(fmt)))
    expect(container.querySelector('svg[role="img"]')).toBeNull()
  })

  it('draws a chart as an image named by a hidden table of all its values, with every value printed on it', () => {
    for (const [kind, n] of [['bar', 1], ['line', 1], ['line', 2]] as const) {
      const item = itemWith(kind, n)
      const x = item.spec.exhibit as ChartExhibit
      const { container } = mountSpec(item.spec)
      const svg = container.querySelector('svg.plot') as SVGSVGElement
      expect(svg.getAttribute('role')).toBe('img')
      const alt = container.querySelector(`#${CSS.escape(svg.getAttribute('aria-labelledby') ?? '')}`) as HTMLTableElement
      expect(alt.tagName).toBe('TABLE')
      expect(alt.parentElement?.classList.contains('hb-sr-only')).toBe(true)
      expect(alt.caption?.textContent).toBe(chartTableCaption(x.title, x.unit))
      expect([...alt.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([x.x_label, ...x.series.map((s) => s.name)])
      // Complete: every category by its full name and every value of every series.
      expect([...alt.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent))).toEqual(
        x.categories.map((c, i) => [c, ...x.series.map((s) => fmt(s.values[i] as number))]),
      )
      // Visible: the title as a heading, the unit, one value label per value, the category labels, the gridlines.
      expect(container.querySelector('h3')?.textContent).toBe(x.title)
      expect(container.querySelector('.unit')?.textContent).toBe(unitLine(x.unit))
      expect([...svg.querySelectorAll('text.value')].map((t) => t.textContent).sort()).toEqual(x.series.flatMap((s) => s.values.map(fmt)).sort())
      expect([...svg.querySelectorAll('text.cat')].map((t) => t.textContent)).toEqual(x.categories.map(shortLabel))
      expect(svg.querySelectorAll('line.grid')).toHaveLength((x.y_max - x.y_min) / x.y_step + 1)
      if (kind === 'bar') expect(svg.querySelectorAll('rect.bar')).toHaveLength(x.categories.length)
      // Two series: a legend, and the series differ by line style and point shape, not colour only.
      expect(container.querySelectorAll('.legend li')).toHaveLength(n > 1 ? 2 : 0)
      if (n > 1) {
        expect(svg.querySelectorAll('circle.mark.s0')).toHaveLength(x.categories.length)
        expect(svg.querySelectorAll('path.mark.s1')).toHaveLength(x.categories.length)
      }
    }
  })

  it('shortens only labels longer than six characters, to three letters that stay distinct', () => {
    expect(shortLabel('Wednesday')).toBe('Wed')
    expect(shortLabel('Stop A')).toBe('Stop A')
    expect(shortLabel('06:00')).toBe('06:00')
    for (let i = 0; i < 400; i++) {
      const x = qdata.generate(`labels-${i}`).spec.exhibit
      if (!x || x.kind === 'table') continue
      const shown = x.categories.map(shortLabel)
      expect(new Set(shown).size).toBe(shown.length)
      expect(shown.every((s) => s.length <= LABEL_MAX)).toBe(true)
    }
  })

  it('keeps the two-series value labels apart: the higher value above its point, the lower below', () => {
    for (let i = 0; i < 200; i++) {
      const x = qdata.generate(`two-${i}`, { stratum: 5 }).spec.exhibit
      if (!x || x.kind !== 'line' || x.series.length !== 2) continue
      const [a, b] = chartLayout(x).lines as unknown as [{ y: number; labelY: number }[], { y: number; labelY: number }[]]
      a.forEach((p, k) => {
        const q = b[k] as { y: number; labelY: number }
        if (p.y === q.y) expect(p.labelY).toBeLessThan(q.labelY)
        else expect((p.labelY < p.y) !== (q.labelY < q.y)).toBe(true)
      })
    }
  })

  it('shows the stem after the exhibit, then the hint; a word problem has no exhibit', () => {
    const wp = itemWith('none')
    const m = mountSpec(wp.spec)
    expect(m.container.querySelector('.stem')?.textContent).toBe(wp.spec.stem)
    expect(m.container.querySelector('.hint')?.textContent).toBe(wp.spec.hint)
    expect(m.container.querySelector('table, svg.plot')).toBeNull()
    const dt = itemWith('bar')
    const d = mountSpec(dt.spec)
    const section = d.container.querySelector('section.qdata') as HTMLElement
    expect(section.getAttribute('aria-label')).toBe(QDATA_REGION_LABEL)
    const order = [...section.children].map((c) => c.tagName.toLowerCase())
    expect(order.indexOf('figure')).toBeLessThan(order.indexOf('p'))
  })

  it('reports onshown once on the first frame and takes no answer before it', () => {
    const item = itemWith('table')
    const display = fakeDisplay()
    const shown: number[] = []
    const m = mountSpec(item.spec, display, { onshown: (t: number) => shown.push(t) })
    expect(m.input.disabled).toBe(true)
    typeInto(m.input, item.key.value)
    m.submit()
    expect(m.responses).toEqual([])
    display.advance(FRAME)
    expect(shown).toHaveLength(1)
    display.advance(FRAME * 3)
    expect(shown).toHaveLength(1)
    expect(m.input.disabled).toBe(false)
  })

  it('typing the key sends that text and score() marks it correct; a whole-number item refuses 3.5', () => {
    for (let i = 0; i < 60; i++) {
      const item = qdata.generate(`render-key-${i}`)
      const m = mountSpec(item.spec)
      m.display.advance(FRAME)
      typeInto(m.input, item.key.value)
      m.submit()
      expect(m.responses).toEqual([item.key.value])
      expect(qdata.score(item, m.responses[0] as string).correct).toBe(1)
      m.destroy()
    }
    const whole = Array.from({ length: 50 }, (_, i) => qdata.generate(`whole-${i}`)).find((it) => it.spec.input_format === 'integer') as QdataItem
    const m = mountSpec(whole.spec)
    m.display.advance(FRAME)
    typeInto(m.input, '3.5')
    m.submit()
    expect(m.responses).toEqual([])
    expect(m.container.querySelector('.hb-note')?.textContent).toBe(FORMAT_NOTES.integer)
  })

  it('puts nothing in the DOM but the spec, the renderer copy and the shortened labels: no key, no data attributes', () => {
    let keyAbsentWhenNotInSpec = 0
    let keyNotInSpec = 0
    for (let i = 0; i < 150; i++) {
      const item = qdata.generate(`leak-${i}`)
      const m = mountSpec(item.spec)
      m.display.advance(FRAME)
      expect(attributeProblems(m.container)).toEqual([])
      // A structural twin: every spec string replaced by a sentinel; its DOM tokens are the copy plus the numbers.
      let k = 0
      const twinOf = (v: unknown): unknown =>
        typeof v === 'string' ? `Qq${k++}` : Array.isArray(v) ? v.map(twinOf) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([a, b]) => [a, a === 'kind' ? b : twinOf(b)])) : v
      const twin = mountSpec({ ...(twinOf(item.spec) as QdataSpec), input_format: item.spec.input_format })
      const labels = item.spec.exhibit && item.spec.exhibit.kind !== 'table' ? item.spec.exhibit.categories.map(shortLabel) : []
      const allowed = new Set([...tokensOf(nodeTexts(twin.container)), ...leafTexts(item.spec).flatMap(tokensOf), ...labels.flatMap(tokensOf)])
      const text = nodeTexts(m.container)
      for (const t of tokensOf(text)) expect(allowed.has(t), `${item.item_id}: ${t}`).toBe(true)
      const inSpec = leafTexts(item.spec).some((s) => containsWhole(s, item.key.value.replace(/^-/, '')))
      if (!inSpec && item.spec.exhibit === undefined) {
        keyNotInSpec++
        if (!containsWhole(text, item.key.value.replace(/^-/, ''))) keyAbsentWhenNotInSpec++
      }
      // Rendering the same spec again gives the same DOM (nothing random, nothing per key).
      const again = mountSpec(item.spec)
      again.display.advance(FRAME)
      expect(normalizeIds(again.container)).toBe(normalizeIds(m.container))
      m.destroy()
      twin.destroy()
      again.destroy()
    }
    expect(keyNotInSpec).toBeGreaterThan(20)
    expect(keyAbsentWhenNotInSpec).toBe(keyNotInSpec)
  })
})
