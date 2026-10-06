/**
 * The results of an unusual-uses round (ROADMAP M6.4; DESIGN §5.4, §10, R-5.6.x): the three labelled measures, the
 * experimental note, what was done with each idea, and nothing that reads as a total, a percentile or a verdict.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { EXPERIMENTAL_NOTE, RESULT_COPY, STATUS_LABELS } from '../../tasks/aut/copy'
import { createMockEmbedder } from '../../tasks/aut/embedder'
import { scoreResponses } from '../../tasks/aut/run'
import type { AutScore } from '../../tasks/aut/scoring'
import { render } from '../common/testing'
import AutResults from './AutResults.svelte'

let cleanup: (() => void)[] = []
afterEach(() => {
  for (const f of cleanup) f()
  cleanup = []
})

async function mountScore(object: string, ideas: string[], modelId = 'mock') {
  const score: AutScore = await scoreResponses(createMockEmbedder(), object, ideas)
  const r = render(AutResults, { score, modelId })
  cleanup.push(r.destroy)
  const measure = (label: string): HTMLElement | null => [...r.container.querySelectorAll('dt')].find((d) => d.textContent === label)?.closest('.measure') ?? null
  return { ...r, score, measure }
}

describe('AutResults', () => {
  it('labels the three measures as the spec does, with the numbers of the score', async () => {
    const m = await mountScore('brick', ['prop open a door', 'crush it into red pigment', 'bookend for paperbacks'])
    expect([...m.container.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Ideas counted', 'Distance score (experimental)', 'Idea groups'])
    expect(m.container.querySelector('[data-testid="aut-count"]')?.textContent).toBe(String(m.score.fluency))
    expect(m.container.querySelector('[data-testid="aut-groups"]')?.textContent).toBe(String(m.score.flexibility))
    const distance = m.container.querySelector('[data-testid="aut-distance"]')?.textContent
    expect(distance).toBe((m.score.originality as number).toFixed(2))
    expect(m.container.querySelector('dl')).not.toBeNull()
    expect(m.measure('Idea groups')?.textContent).toContain(RESULT_COPY.groupsHint)
  })

  it('carries the experimental note, word for word', async () => {
    const m = await mountScore('brick', ['doorstop'])
    expect(m.container.querySelector('[data-testid="aut-experimental"]')?.textContent).toBe(EXPERIMENTAL_NOTE)
  })

  it('lists each idea with what was done with it, in the order given, in words about counting', async () => {
    const m = await mountScore('brick', ['doorstop', 'doorstop', 'write to jo@example.com'])
    const rows = [...m.container.querySelectorAll('.idea')].map((li) => [li.querySelector('.idea-text')?.textContent, li.querySelector('.idea-status')?.textContent])
    expect(rows).toEqual([
      ['doorstop', STATUS_LABELS.scored],
      ['doorstop', STATUS_LABELS.duplicate],
      ['write to [removed]', STATUS_LABELS.personal_info],
    ])
    expect(m.container.textContent).not.toContain('jo@example.com')
    expect(m.container.textContent).toContain(RESULT_COPY.personalInfo)
  })

  it('says the distance is not available when nothing was counted, and shows no list for no ideas', async () => {
    const m = await mountScore('brick', [])
    expect(m.container.querySelector('[data-testid="aut-count"]')?.textContent).toBe('0')
    expect(m.container.querySelector('[data-testid="aut-distance"]')?.textContent).toBe('Not available')
    expect(m.container.querySelector('.ideas')).toBeNull()
  })

  it('notes that fewer than three counted ideas is even rougher', async () => {
    const few = await mountScore('brick', ['doorstop'])
    expect(few.container.textContent).toContain(RESULT_COPY.fewIdeas)
  })

  it('names the scorer, and calls the test scorer a test', async () => {
    const mock = await mountScore('brick', ['doorstop'])
    expect(mock.container.querySelector('.scorer-line')?.textContent).toBe(RESULT_COPY.scorerLine('mock', 'aut-v0'))
    expect(mock.container.querySelector('.scorer-line')?.textContent).toMatch(/test scorer/)
    const real = await mountScore('brick', ['doorstop'], 'Xenova/all-MiniLM-L6-v2')
    expect(real.container.querySelector('.scorer-line')?.textContent).toBe('Scored on this device with Xenova/all-MiniLM-L6-v2 (aut-v0).')
  })

  it('has no total, percentile, grade or verdict, and no id that is shared when two are on a page', async () => {
    const a = await mountScore('brick', ['prop open a door', 'bookend for paperbacks'])
    const b = await mountScore('paperclip', ['pick a lock'])
    expect(a.container.textContent ?? '').not.toMatch(/\b(total|percentile|rank|grade|wrong|incorrect|correct|right|mistake|well done|good|bad)\b/i)
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(b.container.querySelector('.ideas')?.getAttribute('aria-labelledby')).not.toBe(a.container.querySelector('.ideas')?.getAttribute('aria-labelledby'))
  })
})
