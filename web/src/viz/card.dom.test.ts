/**
 * The share card in jsdom (ROADMAP M1.18; DESIGN §9.9): the SVG is well-formed XML (an SVG file and
 * an `<img>` source must parse), and the blob inside it draws exactly what the on-page chart
 * (`BlobChart.svelte`) draws for the same model, element by element, so the two cannot drift apart.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { AXIS_CODES } from '../engine/axes'
import BlobChart from './BlobChart.svelte'
import { buildCard, CARD_H, CARD_W, cardSvg, PNG_SCALE } from './card'
import { axisEstimates, type AxisEstimate } from './profile'
import { syntheticProfile } from './synthetic'

let app: ReturnType<typeof mount> | undefined
afterEach(() => {
  if (app) unmount(app)
  app = undefined
  document.body.innerHTML = ''
})

const estimatesOf = (id: string): AxisEstimate[] => axisEstimates(syntheticProfile(id)!.input)

function parse(svg: string): Document {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  expect(doc.getElementsByTagName('parsererror'), 'the SVG must be well-formed XML').toHaveLength(0)
  return doc
}

/** A normalised description of an element: what is drawn, not how the framework named it. */
interface Node {
  readonly tag: string
  readonly attrs: Record<string, string>
  readonly text: string
  readonly children: Node[]
}

const DROP_ATTR = /^(data-|aria-|role$|id$|xmlns)/

function describe_(el: Element, uidPrefix: string): Node {
  const attrs: Record<string, string> = {}
  for (const name of el.getAttributeNames().sort()) {
    if (DROP_ATTR.test(name)) continue
    let value = el.getAttribute(name)!
    if (name === 'class') {
      // Svelte adds a scoping class; class order is not meaning.
      value = value
        .split(/\s+/)
        .filter((c) => c !== '' && !c.startsWith('svelte-'))
        .sort()
        .join(' ')
      if (value === '') continue
    }
    // The clip-path and pattern ids differ by prefix.
    attrs[name] = value.replaceAll(uidPrefix, 'ID').replaceAll('hb-card', 'ID')
  }
  const children = [...el.children].map((c) => describe_(c, uidPrefix))
  return { tag: el.localName, attrs, text: children.length === 0 ? (el.textContent ?? '').trim() : '', children }
}

describe('the card is well-formed SVG', () => {
  it('parses as XML for every profile, both schemes and both sizes, with the right root', () => {
    for (const id of ['m1', 'full', 'skipped', 'sparse']) {
      for (const theme of ['light', 'dark'] as const) {
        const card = buildCard({ estimates: estimatesOf(id), sessions: 2, theme })
        for (const scale of [1, PNG_SCALE]) {
          const doc = parse(scale === 1 ? card.svg : cardSvg(card, scale))
          const root = doc.documentElement
          expect(root.localName).toBe('svg')
          expect(root.namespaceURI).toBe('http://www.w3.org/2000/svg')
          expect(root.getAttribute('width')).toBe(String(CARD_W * scale))
          expect(root.getAttribute('height')).toBe(String(CARD_H * scale))
          expect(root.getAttribute('viewBox')).toBe(`0 0 ${CARD_W} ${CARD_H}`)
        }
      }
    }
  })

  it('has a title and a description, the description naming the shown skills only', () => {
    const est = estimatesOf('m1')
    const card = buildCard({ estimates: est, hidden: ['QR'], sessions: 1 })
    const doc = parse(card.svg)
    expect(doc.querySelector('title')!.textContent).toBe('My skill profile')
    const desc = doc.querySelector('desc')!.textContent!
    expect(desc).toContain(est.find((e) => e.code === 'MAT')!.name)
    expect(desc).not.toContain('Quantitative Reasoning')
    expect(doc.documentElement.getAttribute('aria-labelledby')).toBe('hb-card-title hb-card-desc')
  })

  it('escapes what needs escaping: "Matrix & Series" survives as text, no stray markup', () => {
    const doc = parse(buildCard({ estimates: estimatesOf('m1'), sessions: 1 }).svg)
    const labels = [...doc.querySelectorAll('text.label')].map((t) => t.textContent!.replace(/ [○◇]/g, '').replace(/\s+/g, ' ').trim())
    expect(labels.some((l) => l.includes('Matrix &'))).toBe(true)
    expect(doc.querySelectorAll('script, image, foreignObject, a')).toHaveLength(0)
  })

  it('has no external reference: no href, no url() other than its own ids', () => {
    const svg = buildCard({ estimates: estimatesOf('full'), sessions: 1 }).svg
    expect(svg).not.toMatch(/href=|@import|src=/i)
    for (const m of svg.matchAll(/url\(([^)]*)\)/g)) expect(m[1]).toMatch(/^#hb-card-/)
    expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', '')).not.toMatch(/https?:/i)
  })
})

describe('the blob on the card is the blob on the page', () => {
  it.each(['m1', 'full', 'skipped', 'sparse'])('%s: the same elements with the same numbers, in the same order', (id) => {
    const est = estimatesOf(id)
    const card = buildCard({ estimates: est, sessions: 1 })
    // The page's chart for exactly the card's model.
    const target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(BlobChart, { target, props: { model: card.placement.model, uid: 'page-chart', title: 't', description: 'd' } })
    flushSync()
    const page = target.querySelector('svg.hb-blob')!
    const pageNodes = [...page.children].filter((c) => !['title', 'desc'].includes(c.localName)).map((c) => describe_(c, 'page-chart'))

    const doc = parse(card.svg)
    const group = doc.querySelector('g.blob')!
    const cardNodes = [...group.children].map((c) => describe_(c, 'hb-card'))

    expect(cardNodes).toEqual(pageNodes)
    expect(cardNodes.length).toBeGreaterThan(5)
  })

  it('a hidden skill\'s spoke is gone from the card\'s blob, and the rest are re-spread', () => {
    const est = estimatesOf('full')
    const all = buildCard({ estimates: est, sessions: 1 })
    const fewer = buildCard({ estimates: est, hidden: ['LG', 'CRE'], sessions: 1 })
    const spokes = (svg: string): number => parse(svg).querySelectorAll('line.spoke').length
    expect(spokes(all.svg)).toBe(AXIS_CODES.length)
    expect(spokes(fewer.svg)).toBe(AXIS_CODES.length - 2)
    // It is the blob of the remaining skills, not the full one with two gaps.
    expect(fewer.placement.model.spokes.map((s) => s.id)).toEqual(all.shown.filter((c) => c !== 'LG' && c !== 'CRE'))
  })
})
