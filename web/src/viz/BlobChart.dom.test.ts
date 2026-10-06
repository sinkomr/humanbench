/**
 * The chart's own markup for the UX review decisions D13 and D15 A (web/UX-REVIEW.md §2; provisional
 * defaults): a not-measured spoke leaves a gap in the curve, the band and the fuzz, and an × on the
 * 0 SD ring (D13 A); on a narrow layout with many of them, those spokes have no label and a line under
 * the chart names them (D13 B); a share card's named peaks are ringed and bold (D15 A). The model's
 * geometry is tested in `blob.test.ts`; this checks that the chart draws what the model says.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import BlobChart from './BlobChart.svelte'
import { buildBlob, fitLayout, type BlobModel } from './blob'
import { STUB_CAPTION, stubListText } from './copy'
import { axisEstimates, type AxisEstimate } from './profile'
import { syntheticProfile } from './synthetic'

let app: ReturnType<typeof mount> | undefined
afterEach(() => {
  if (app) unmount(app)
  app = undefined
  document.body.innerHTML = ''
})

const estimatesOf = (id: string): AxisEstimate[] => axisEstimates(syntheticProfile(id)!.input)

function draw(model: BlobModel): HTMLElement {
  const target = document.createElement('div')
  document.body.appendChild(target)
  app = mount(BlobChart, { target, props: { model, uid: 'c', title: 'Skill profile blob', description: 'd' } })
  flushSync()
  return target
}

describe('a not-measured spoke is a gap with an × on the 0 SD ring (D13 A)', () => {
  it('draws the × (over its halo) on each not-measured spoke and no gap at a measured one', () => {
    const est = estimatesOf('m1')
    const model = buildBlob(est)
    const root = draw(model)
    for (const s of model.spokes) {
      const g = root.querySelector(`g.mark[data-spoke="${s.id}"]`)!
      if (s.measured) {
        expect(g.querySelector('path.gap, path.gap-halo, line.stub'), s.id).toBeNull()
        continue
      }
      expect(g.querySelector('line.stub'), s.id).not.toBeNull()
      expect(g.querySelector('path.gap')!.getAttribute('d')).toBe(s.gapMark)
      expect(g.querySelector('path.gap-halo')!.getAttribute('d')).toBe(s.gapMark)
      // The halo first, so the × is drawn over it.
      expect([...g.children].map((c) => c.getAttribute('class')!.split(' ')[0])).toEqual(['stub', 'gap-halo', 'gap'])
    }
    expect(root.querySelectorAll('g.mark.unmeasured path.gap')).toHaveLength(est.filter((e) => !e.measured).length)
    expect(root.querySelector('circle.gap')).toBeNull()
    // Placeholders, not data: drawn under the ring labels (whose halo may cover part of an ×), the data's marks after them.
    const order = [...root.querySelector('svg.hb-blob')!.children].map((c) => (c.getAttribute('class') ?? c.localName).split(' ')[0]!)
    expect(order.indexOf('stubs')).toBe(order.indexOf('grid') + 1)
    expect(order.indexOf('ring-labels')).toBe(order.indexOf('stubs') + 1)
    expect(order.indexOf('marks')).toBeGreaterThan(order.indexOf('ring-labels'))
    expect(root.querySelectorAll('g.stubs g.mark')).toHaveLength(est.filter((e) => !e.measured).length)
    expect(root.querySelectorAll('g.marks g.mark')).toHaveLength(est.filter((e) => e.measured).length)
  })

  it('draws the crisp curve, the band and every fuzz band as the model has them (open runs, no Z on the curve)', () => {
    const model = buildBlob(estimatesOf('m1'))
    const root = draw(model)
    expect(root.querySelector('path.crisp')!.getAttribute('d')).toBe(model.crisp.d)
    expect(model.crisp.d).not.toContain('Z')
    expect(root.querySelector('path.band')!.getAttribute('d')).toBe(model.band.d)
    expect([...root.querySelectorAll('.fuzz path')].map((p) => p.getAttribute('d'))).toEqual(model.fuzz.map((c) => c.band))
  })

  it('says in the caption that the line breaks there and the × is not an estimate', () => {
    expect(STUB_CAPTION).toBe('Dashed grey spokes are skills that were not measured. The line breaks there, and a small × on the 0 SD ring marks the gap; it is not an estimate.')
    expect(STUB_CAPTION).not.toMatch(/centre/)
  })
})

describe('a narrow chart with many not-measured spokes lists them under itself (D13 B)', () => {
  it('leaves those spokes without a label and prints "Not measured: …" after the chart, as HTML text', () => {
    const est = estimatesOf('m1')
    const layout = fitLayout(est, 288)
    expect(layout.stubLabels).toBe('none')
    const model = buildBlob(est, { layout })
    const root = draw(model)
    const labels = [...root.querySelectorAll('text.label')]
    expect(labels).toHaveLength(est.filter((e) => e.measured).length)
    expect(labels.some((t) => t.textContent!.includes('not measured'))).toBe(false)
    expect(root.querySelectorAll('g.mark')).toHaveLength(17)
    const list = root.querySelector('p.stub-list')!
    const names = est.filter((e) => !e.measured).map((e) => e.name)
    expect(list.textContent!.trim()).toBe(stubListText('Not measured', names))
    expect(list.textContent!.trim()).toMatch(/^Not measured: .+\.$/)
    // After the chart, outside the image (the image is one role="img"; the list is read as text).
    const svg = root.querySelector('svg.hb-blob')!
    expect(svg.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(svg.contains(list)).toBe(false)
  })

  it('has no list where every spoke keeps its label (full width, or every skill measured)', () => {
    const wide = draw(buildBlob(estimatesOf('m1'), { layout: fitLayout(estimatesOf('m1'), 640) }))
    expect(wide.querySelector('p.stub-list')).toBeNull()
    expect([...wide.querySelectorAll('text.label')].filter((t) => t.textContent!.includes('not measured'))).toHaveLength(10)
    unmount(app!)
    app = undefined
    document.body.innerHTML = ''
    const full = estimatesOf('full')
    const narrow = draw(buildBlob(full, { layout: fitLayout(full, 288) }))
    expect(narrow.querySelector('p.stub-list')).toBeNull()
    expect(narrow.querySelectorAll('text.label')).toHaveLength(17)
  })
})

describe('named peaks of a share card are ringed and bold (D15 A)', () => {
  it('rings the marker of each named peak and sets its label bold; nothing on the page is', () => {
    const est = estimatesOf('full')
    const model = buildBlob(est, { peaks: ['KST', 'LG'] })
    const root = draw(model)
    expect([...root.querySelectorAll('g.mark.peak')].map((g) => g.getAttribute('data-spoke')).sort()).toEqual(['KST', 'LG'])
    for (const id of ['KST', 'LG']) {
      const g = root.querySelector(`g.mark[data-spoke="${id}"]`)!
      const ring = g.querySelector('circle.peak-ring')!
      const dot = g.querySelector('circle.marker')!
      expect([ring.getAttribute('cx'), ring.getAttribute('cy')]).toEqual([dot.getAttribute('cx'), dot.getAttribute('cy')])
    }
    expect(root.querySelectorAll('text.label.peak')).toHaveLength(2)
    unmount(app!)
    app = undefined
    document.body.innerHTML = ''
    const page = draw(buildBlob(est))
    expect(page.querySelector('circle.peak-ring, .peak')).toBeNull()
  })
})
