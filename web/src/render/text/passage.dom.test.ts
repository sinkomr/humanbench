/**
 * The passage beside its question (ROADMAP M3.11 phase 2; DESIGN §3 row 4, §10, §13, R-11.1): what the
 * layout shows, that the server's text is written as text and never as markup, the region's name, the
 * source line, and the button that lifts the height limit on a narrow screen. The made-up passages are
 * those of `demo-passage.ts`.
 */

import { createRawSnippet, flushSync } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { buttonByText, click, render } from '../common/testing'
import { PASSAGE_COPY } from './copy'
import { DEMO_PASSAGES, demoPassagePayload } from './demo-passage'
import { passageSpec, passageTextOf, type PassageText } from './passage'
import PassageLayout from './PassageLayout.svelte'

let cleanup: (() => void)[] = []
afterEach(() => {
  for (const f of cleanup) f()
  cleanup = []
})

const textOf = (i: number): PassageText => passageTextOf(passageSpec(demoPassagePayload(DEMO_PASSAGES[i]!, 0))!)
const question = createRawSnippet(() => ({ render: () => '<p data-question>the question goes here</p>' }))

function mountLayout(passage: PassageText, extra: Record<string, unknown> = {}) {
  const r = render(PassageLayout, { passage, children: question, ...extra })
  cleanup.push(r.destroy)
  const region = r.container.querySelector('section.passage') as HTMLElement
  return { ...r, region }
}

describe('PassageLayout', () => {
  it('shows the passage as a named region with a heading, before the question, each paragraph as a paragraph', () => {
    const passage = textOf(0)
    const m = mountLayout(passage)
    const heading = m.region.querySelector('h2')!
    expect(heading.textContent).toBe(PASSAGE_COPY.heading)
    expect(m.region.getAttribute('aria-labelledby')).toBe(heading.id)
    expect([...m.region.querySelectorAll('.text p')].map((p) => p.textContent)).toEqual(passage.passage)
    const q = m.container.querySelector('[data-question]')!
    expect(m.region.compareDocumentPosition(q) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(m.region.contains(q)).toBe(false)
    expect(m.region.dataset.passage).toBe(passage.passageKey)
  })

  it('can be scrolled by keyboard: the frame takes focus, and a caller can name it to move focus there', () => {
    const m = mountLayout(textOf(0), { regionId: 'the-passage' })
    expect(m.region.tabIndex).toBe(0)
    expect(m.region.id).toBe('the-passage')
    m.region.focus()
    expect(document.activeElement).toBe(m.region)
    expect(mountLayout(textOf(2)).region.id).not.toBe('')
  })

  it('shows the source line under the text, quietly, with a word for a screen reader that says what it is; and nothing when there is none', () => {
    const passage = textOf(0)
    const m = mountLayout(passage)
    const line = m.region.querySelector('.attribution')!
    expect(line.textContent).toBe(`${PASSAGE_COPY.sourcePrefix}${passage.attribution}`)
    expect(line.querySelector('.hb-sr-only')?.textContent).toBe(PASSAGE_COPY.sourcePrefix)
    expect(m.region.querySelector('.text')!.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(mountLayout(textOf(2)).region.querySelector('.attribution')).toBeNull()
  })

  it('writes the passage, its title and its source line as text: markup in them makes no element, and an address is not a link', () => {
    const passage = textOf(1)
    const m = mountLayout(passage)
    expect(m.region.querySelector('.title')?.textContent).toBe(passage.title)
    expect(m.region.textContent).toContain('<script>window.__hb_text_passage_injected = true</script>')
    expect(m.region.textContent).toContain('<b>Snorkweavers</b>')
    expect(m.region.querySelector('.attribution')?.textContent).toContain('https://example.invalid/')
    expect(m.region.querySelectorAll('script, img, b, i, a')).toHaveLength(0)
    expect((window as unknown as { __hb_text_passage_injected?: boolean }).__hb_text_passage_injected).toBeUndefined()
    // nothing in the DOM but the heading, the button, the paragraphs and the source line
    expect([...m.region.querySelectorAll('*')].map((e) => e.tagName.toLowerCase()).filter((t) => !['div', 'h2', 'button', 'p', 'span'].includes(t))).toEqual([])
  })

  it('has one button that lifts the height limit and puts it back, and says which state it is in', () => {
    const m = mountLayout(textOf(1))
    const layout = m.container.querySelector('.passage-layout')!
    const button = buttonByText(m.container, PASSAGE_COPY.showAll)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-controls')).toBe(m.region.querySelector('.text')!.id)
    expect(layout.classList.contains('expanded')).toBe(false)
    click(button)
    flushSync()
    expect(layout.classList.contains('expanded')).toBe(true)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.textContent?.trim()).toBe(PASSAGE_COPY.showLess)
    click(button)
    flushSync()
    expect(layout.classList.contains('expanded')).toBe(false)
    expect(m.region.querySelectorAll('button')).toHaveLength(1)
  })

  it('says nothing about a right or a wrong answer, or about the reader', () => {
    const words = [PASSAGE_COPY.heading, PASSAGE_COPY.sourcePrefix, PASSAGE_COPY.showAll, PASSAGE_COPY.showLess, PASSAGE_COPY.position(2, 4)].join(' ')
    expect(words).not.toMatch(/correct|wrong|right answer|score|intelligen|ability|diagnos|disorder|deficit/iu)
    expect(PASSAGE_COPY.position(2, 4)).toBe('Question 2 of 4 about this passage')
  })
})
