/**
 * Reading renderer (ROADMAP M1.12, M1.13, A10, A14; DESIGN §14.6 ex. 13): the reading time runs
 * from the frame that draws the passage to Done (performance.now), the passage is hidden for the
 * 3 gate questions, options appear in spec order, the response scores with the family's score(),
 * the source is credited after the block, and no authoring data (evidence, rationales) is shown.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { reading, type ReadingItem } from '../../tasks/reading'
import { AUTHORED_PASSAGES } from '../../tasks/reading/authoring'
import type { ReadingResponse } from '../../tasks/reading/types'
import { normalizeIds } from '../common/leak'
import { buttonByText, click, fakeDisplay, render } from '../common/testing'
import ReadingRenderer from './ReadingRenderer.svelte'

const FRAME = 1000 / 60

let cleanup: (() => void)[] = []
afterEach(() => {
  for (const f of cleanup) f()
  cleanup = []
})

function mountReading(item: ReadingItem) {
  const display = fakeDisplay()
  const responses: ReadingResponse[] = []
  const r = render(ReadingRenderer, { spec: item.spec, onrespond: (x: ReadingResponse) => responses.push(x), timing: display })
  cleanup.push(r.destroy)
  return { ...r, display, responses }
}

describe('ReadingRenderer', () => {
  it('times reading from the passage frame to Done, then asks the questions in spec order and scores', () => {
    for (let i = 0; i < 12; i++) {
      const item = reading.generate(`render-reading-${i}`)
      const m = mountReading(item)
      click(buttonByText(m.container, 'Show the passage'))
      expect(m.container.querySelectorAll('.passage p')).toHaveLength(item.spec.paragraphs.length)
      const done = buttonByText(m.container, 'Done reading')
      expect(done.disabled).toBe(true)
      m.display.advance(FRAME)
      const shownAt = m.display.now()
      expect(done.disabled).toBe(false)
      m.display.advance(90_000)
      click(done)
      expect(m.container.querySelector('.passage')).toBeNull()
      const fieldsets = [...m.container.querySelectorAll('fieldset')]
      expect(fieldsets).toHaveLength(item.spec.questions.length)
      fieldsets.forEach((fs, qi) => {
        const q = item.spec.questions[qi]
        expect(fs.querySelector('legend')?.textContent).toBe(`${qi + 1}. ${q?.stem}`)
        const labels = [...fs.querySelectorAll('label')].map((l) => l.textContent?.trim())
        expect(labels).toEqual(q?.options)
        const values = [...fs.querySelectorAll('input')].map((x) => x.value)
        expect(values).toEqual(q?.options.map((_, oi) => String(oi)))
      })
      // Answer the first two with the key, leave the third blank.
      item.key.indices.slice(0, 2).forEach((k, qi) => click(fieldsets[qi]?.querySelectorAll('input')[k]))
      expect(m.container.querySelector('.hb-status')?.textContent).toBe('1 of 3 not answered yet.')
      click(buttonByText(m.container, 'Submit answers'))
      expect(m.responses).toEqual([{ reading_time_ms: m.display.now() - shownAt, choices: [item.key.indices[0], item.key.indices[1], null] }])
      expect(m.responses[0]?.reading_time_ms).toBeCloseTo(90_000, 6)
      const score = reading.score(item, m.responses[0] as ReadingResponse)
      expect(score.observation?.kind).toBe('gaussian')
      expect(m.container.querySelector('.credit')?.textContent).toContain(item.spec.source.author)
      m.destroy()
    }
  })

  it('never shows evidence spans or rationales from the authored bank (A14)', () => {
    for (let i = 0; i < 30; i++) {
      const item = reading.generate(`render-reading-a14-${i}`)
      const passage = AUTHORED_PASSAGES.find((p) => p.id === item.spec.passage_id)
      const m = mountReading(item)
      click(buttonByText(m.container, 'Show the passage'))
      m.display.advance(FRAME + 30_000)
      click(buttonByText(m.container, 'Done reading'))
      const html = m.container.innerHTML
      for (const q of passage?.questions ?? []) for (const r of q.option_rationales) expect(html).not.toContain(r)
      expect(html).not.toMatch(/evidence|rationale/i)
      m.destroy()
    }
  })

  it('matches its snapshot (questions)', () => {
    const item = reading.generate('render-reading-snap')
    const m = mountReading(item)
    click(buttonByText(m.container, 'Show the passage'))
    m.display.advance(FRAME + 60_000)
    click(buttonByText(m.container, 'Done reading'))
    expect(normalizeIds(m.container)).toMatchSnapshot()
  })
})
