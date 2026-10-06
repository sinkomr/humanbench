/**
 * The dev-only unusual uses page (`#/dev/aut`; ROADMAP M6.4, DESIGN §5.4, §8): the scorer's load button and what it shows
 * while the model downloads and when that fails, the round scored as soon as there are both a round and a scorer, the
 * results panel, and that the page itself makes no request. The model loader is replaced, so nothing is downloaded.
 */

import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, click, typeInto } from '../render/common/testing'
import { ENTRY_COPY, EXPERIMENTAL_NOTE, OCSAI_COPY, RESULT_LABELS, SCORER_COPY } from '../tasks/aut/copy'
import { createMockEmbedder, EmbedderLoadError, type Embedder, type LoadProgress } from '../tasks/aut/embedder'
import AutDemo from './AutDemo.svelte'

interface Load {
  readonly onProgress?: (p: LoadProgress) => void
  readonly signal?: AbortSignal
  resolve(e: Embedder): void
  reject(error: unknown): void
}

const h = vi.hoisted(() => ({ loads: [] as Load[] }))

vi.mock('../tasks/aut/minilm', () => ({
  loadMiniLmEmbedder: vi.fn((opts: { onProgress?: (p: LoadProgress) => void; signal?: AbortSignal } = {}) => {
    return new Promise<Embedder>((resolve, reject) => {
      h.loads.push({ ...opts, resolve, reject })
    })
  }),
}))

let cleanup: (() => void)[] = []
beforeEach(() => {
  h.loads.length = 0
})
afterEach(() => {
  for (const f of cleanup) f()
  cleanup = []
  vi.restoreAllMocks()
})

function mountDemo(query: string) {
  const r = render(AutDemo, { params: new URLSearchParams(query) })
  cleanup.push(r.destroy)
  const text = (id: string): string | null => r.container.querySelector(`[data-testid="${id}"]`)?.textContent ?? null
  const byTestId = (id: string): HTMLElement | null => r.container.querySelector(`[data-testid="${id}"]`)
  const loadButton = (): HTMLButtonElement | null => byTestId('aut-load') as HTMLButtonElement | null
  const phase = (): string | null => r.container.querySelector('section.aut')?.getAttribute('data-phase') ?? null
  /** Start the round, add ideas, press Done. The jsdom display runs real animation frames. */
  const playRound = async (ideas: string[]): Promise<void> => {
    const start = [...r.container.querySelectorAll('button')].find((b) => b.textContent?.trim() === ENTRY_COPY.start)
    click(start)
    await vi.waitFor(() => expect(phase()).toBe('running'))
    for (const idea of ideas) {
      typeInto(r.container.querySelector('input'), idea)
      r.container.querySelector('form')?.requestSubmit()
      flushSync()
    }
    click([...r.container.querySelectorAll('button')].find((b) => b.textContent?.trim() === ENTRY_COPY.done))
  }
  return { ...r, text, byTestId, loadButton, phase, playRound }
}

describe('the demo page with the test scorer (?embedder=mock)', () => {
  it('has the markers of the scaffold: the heading, the practice id and the root of the renderer', () => {
    const m = mountDemo('seed=3&embedder=mock&seconds=5')
    expect(m.container.querySelector('h1')?.textContent).toBe('Unusual uses entry demo (development only)')
    expect(m.text('aut-practice-id')).toBe('Practice id demo:aut:3')
    expect(m.container.querySelector('main.hb-render.demo')).not.toBeNull()
    expect(m.container.querySelector('section.hb-render.aut')).not.toBeNull()
    expect(m.text('aut-practice-note')).toBe('A practice object for this page.')
  })

  it('shows the scorer note, the test scorer in use and no load button, and never asks the model loader', () => {
    const m = mountDemo('embedder=mock&seconds=5')
    expect(m.container.textContent).toContain(SCORER_COPY.note)
    expect(m.text('aut-scorer-state')).toBe(SCORER_COPY.mock)
    expect(m.loadButton()).toBeNull()
    expect(h.loads).toHaveLength(0)
  })

  it('shows the outside scoring service as a notice only', () => {
    const m = mountDemo('embedder=mock')
    expect(m.text('ocsai-note')).toBe(OCSAI_COPY.off)
    expect(m.container.querySelector('input[type="checkbox"]')).toBeNull()
  })

  it('scores a finished round at once: the three measures, the experimental note, and a button for another object', async () => {
    const m = mountDemo('seed=1&embedder=mock&seconds=5')
    expect(m.byTestId('aut-results')).toBeNull()
    await m.playRound(['prop open a door', 'garden edging'])
    await vi.waitFor(() => expect(m.byTestId('aut-count')).not.toBeNull())
    const panel = m.byTestId('aut-results') as HTMLElement
    for (const label of Object.values(RESULT_LABELS)) expect(panel.textContent).toContain(label)
    expect(m.text('aut-experimental')).toBe(EXPERIMENTAL_NOTE)
    expect(m.byTestId('aut-waiting')).toBeNull()
    expect(m.byTestId('aut-another')).not.toBeNull()
  })

  it('starts again with another object and no results', async () => {
    const m = mountDemo('seed=1&embedder=mock&seconds=5')
    await m.playRound(['garden edging'])
    await vi.waitFor(() => expect(m.byTestId('aut-count')).not.toBeNull())
    click(m.byTestId('aut-another'))
    expect(m.byTestId('aut-results')).toBeNull()
    expect(m.text('aut-practice-id')).toBe('Practice id demo:aut:2')
    expect(m.phase()).toBe('ready')
  })

  it('keeps the practice id and the round length of the query, and falls back to 90 s for a bad ?seconds', () => {
    expect(mountDemo('seed=7&embedder=mock&seconds=30').container.querySelector('.length')?.textContent).toBe('You have 30 seconds.')
    expect(mountDemo('embedder=mock&seconds=2').container.querySelector('.length')?.textContent).toBe('You have 5 seconds.')
    expect(mountDemo('embedder=mock&seconds=abc').container.querySelector('.length')?.textContent).toBe('You have 90 seconds.')
    expect(mountDemo('embedder=mock').container.querySelector('.length')?.textContent).toBe('You have 90 seconds.')
  })
})

describe('the demo page with the model', () => {
  it('offers a button to load the scorer and loads nothing until it is pressed', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const m = mountDemo('seconds=5')
    expect(m.loadButton()?.textContent?.trim()).toBe('Load the scorer (about 25 MB)')
    expect(m.container.textContent).toContain(SCORER_COPY.note)
    expect(m.byTestId('aut-scorer-state')).toBeNull()
    expect(m.container.querySelector('progress')).toBeNull()
    expect(h.loads).toHaveLength(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('shows the download as a progress bar with its size, then "preparing", then the scorer is ready', async () => {
    const m = mountDemo('seconds=5')
    click(m.loadButton())
    expect(h.loads).toHaveLength(1)
    expect(m.loadButton()).toBeNull()
    const bar = (): HTMLProgressElement => m.container.querySelector('progress') as HTMLProgressElement
    expect(bar()).not.toBeNull()
    expect(bar().hasAttribute('value')).toBe(false)
    expect(m.text('aut-scorer-state')).toBe('Downloading the scorer')
    expect(bar().getAttribute('aria-labelledby')).toBe(m.byTestId('aut-scorer-state')?.id)
    const load = h.loads[0] as Load
    load.onProgress?.({ loadedBytes: 5_000_000, totalBytes: 23_700_000 })
    flushSync()
    expect(m.text('aut-scorer-state')).toBe('Downloading the scorer: 5.0 of 23.7 MB')
    expect(bar().value).toBe(5_000_000)
    expect(bar().max).toBe(23_700_000)
    load.onProgress?.({ loadedBytes: 8_000_000, totalBytes: null })
    flushSync()
    expect(m.text('aut-scorer-state')).toBe('Downloading the scorer: 8.0 MB')
    expect(bar().hasAttribute('value')).toBe(false)
    load.onProgress?.({ loadedBytes: 23_700_000, totalBytes: 23_700_000 })
    flushSync()
    expect(m.text('aut-scorer-state')).toBe('Preparing the scorer')
    load.resolve(createMockEmbedder())
    await vi.waitFor(() => expect(m.text('aut-scorer-state')).toBe('The scorer is ready.'))
    expect(m.container.querySelector('progress')).toBeNull()
    expect(m.loadButton()).toBeNull()
  })

  it('asks the loader for one load at a time', () => {
    const m = mountDemo('seconds=5')
    const button = m.loadButton() as HTMLButtonElement
    click(button)
    button.click()
    flushSync()
    expect(h.loads).toHaveLength(1)
  })

  it('says so when the download fails, keeps the ideas, and tries again on a press', async () => {
    const m = mountDemo('seconds=5')
    click(m.loadButton())
    ;(h.loads[0] as Load).reject(new EmbedderLoadError('offline'))
    await vi.waitFor(() => expect(m.byTestId('aut-scorer-error')).not.toBeNull())
    expect(m.text('aut-scorer-error')).toBe(SCORER_COPY.failed)
    expect(m.byTestId('aut-scorer-error')?.getAttribute('role')).toBe('alert')
    expect(m.loadButton()?.textContent?.trim()).toBe('Try again')
    click(m.loadButton())
    expect(h.loads).toHaveLength(2)
    expect(m.byTestId('aut-scorer-error')).toBeNull()
    ;(h.loads[1] as Load).resolve(createMockEmbedder())
    await vi.waitFor(() => expect(m.text('aut-scorer-state')).toBe('The scorer is ready.'))
  })

  it('waits for the scorer after a round, keeps the experimental note in view, and scores as soon as the scorer is loaded', async () => {
    const m = mountDemo('seed=1&seconds=5')
    await m.playRound(['prop open a door', 'garden edging'])
    await vi.waitFor(() => expect(m.byTestId('aut-waiting')).not.toBeNull())
    expect(m.text('aut-waiting')).toBe(SCORER_COPY.waiting)
    expect(m.text('aut-experimental')).toBe(EXPERIMENTAL_NOTE)
    expect(m.byTestId('aut-count')).toBeNull()
    click(m.loadButton())
    ;(h.loads[0] as Load).resolve(createMockEmbedder())
    await vi.waitFor(() => expect(m.byTestId('aut-count')).not.toBeNull())
    expect(m.byTestId('aut-waiting')).toBeNull()
    expect(m.container.querySelector('.scorer-line')?.textContent).toMatch(/test scorer/)
  })

  it('cancels a download in progress when the page goes away, and a cancelled load is not an error', async () => {
    const m = mountDemo('seconds=5')
    click(m.loadButton())
    const load = h.loads[0] as Load
    expect(load.signal?.aborted).toBe(false)
    m.destroy()
    expect(load.signal?.aborted).toBe(true)
    load.reject(new DOMException('aborted', 'AbortError'))
    await Promise.resolve()
  })
})
