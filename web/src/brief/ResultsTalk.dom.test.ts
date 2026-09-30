/**
 * The results-talk helper and the reveal card in jsdom (AI.6b; requirement R-17.13): the preamble,
 * its copy button and the "never paste your save file" line are on the screen; the card appears only
 * after the save download; nothing is stored or sent. Real-browser behaviour (real clipboard, axe,
 * WebKit) is in e2e/reveal-ai.spec.ts.
 */

import { flushSync, mount, unmount, type Component } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PREAMBLE, RESULTS_TALK, REVEAL_CARD } from './results-talk'
import ResultsTalk from './ui/ResultsTalk.svelte'
import RevealCard from './ui/RevealCard.svelte'
import { ResultsTalk as ExportedTalk, RevealCard as ExportedCard } from './reveal'

let app: ReturnType<typeof mount> | undefined
const $ = <T extends Element = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel)
  if (!el) throw new Error(`not found: ${sel}`)
  return el
}
const show = (component: Component<any>, props: Record<string, unknown> = {}): void => {
  app = mount(component, { target: document.body, props })
  flushSync()
}
afterEach(() => {
  if (app) void unmount(app)
  app = undefined
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('ResultsTalk', () => {
  it('shows the question, the text to paste first, the copy button and the warning about the save file', () => {
    show(ResultsTalk)
    expect($('h3').textContent).toBe('Talking about your results with an AI?')
    expect($('[data-testid=preamble]').textContent).toBe(PREAMBLE)
    expect($('[data-testid=copy-preamble]').textContent).toBe(RESULTS_TALK.copyButton)
    expect($('[data-testid=never-paste]').textContent).toBe(RESULTS_TALK.neverPaste)
    expect(document.body.textContent).toContain('Paste this first.')
    expect(document.querySelector('[data-testid=results-talk-badge]')).toBeNull()
  })

  it('copies exactly the preamble and announces it politely, again on a second press', async () => {
    const copy = vi.fn(async () => true)
    show(ResultsTalk, { copy })
    const status = $('[data-testid=results-talk-status]')
    expect(status.getAttribute('role')).toBe('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    $<HTMLButtonElement>('[data-testid=copy-preamble]').click()
    await vi.waitFor(() => expect(status.textContent).toBe(RESULTS_TALK.copied))
    expect(copy).toHaveBeenCalledWith(PREAMBLE)
    $<HTMLButtonElement>('[data-testid=copy-preamble]').click()
    await vi.waitFor(() => expect(copy).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(status.textContent).toBe(RESULTS_TALK.copied))
  })

  it('selects the text and says so when copying is blocked', async () => {
    show(ResultsTalk, { copy: async () => false })
    $<HTMLButtonElement>('[data-testid=copy-preamble]').click()
    await vi.waitFor(() => expect($('[data-testid=results-talk-status]').textContent).toBe(RESULTS_TALK.copyFailed))
    expect(window.getSelection()?.toString()).toBe(PREAMBLE)
  })

  it('shows a badge while the text is still being checked, and offers no text when it is blocked (the warning stays)', () => {
    show(ResultsTalk, { status: 'experimental' })
    expect($('[data-testid=results-talk-badge]').textContent).toBe(RESULTS_TALK.experimental)
    expect($('[data-testid=preamble]').textContent).toBe(PREAMBLE)
    void unmount(app as ReturnType<typeof mount>)
    document.body.innerHTML = ''
    show(ResultsTalk, { status: 'blocked' })
    expect(document.querySelector('[data-testid=preamble]')).toBeNull()
    expect(document.querySelector('[data-testid=copy-preamble]')).toBeNull()
    expect($('[data-testid=results-talk-blocked]').textContent).toBe(RESULTS_TALK.blockedNote)
    expect($('[data-testid=never-paste]').textContent).toBe(RESULTS_TALK.neverPaste)
    expect(document.body.textContent).not.toContain('rough, uncertain')
  })

  it('takes the heading level it is given', () => {
    show(ResultsTalk, { level: 2 })
    expect(document.querySelectorAll('h2')).toHaveLength(1)
  })
})

describe('RevealCard', () => {
  it('renders nothing until the save has been downloaded: no card, no preamble, no link', () => {
    show(RevealCard, { saved: false, notesHref: '/humanbench/notes.html' })
    expect(document.body.innerHTML.replace(/<!---->|<!--.*?-->/g, '').trim()).toBe('')
    expect(document.body.textContent).not.toContain('rough, uncertain')
    expect(document.querySelector('a')).toBeNull()
  })

  it('appears after the save download with the card, the link to the notes page and the helper', () => {
    show(RevealCard, { saved: true, notesHref: '/humanbench/notes.html' })
    const card = $('[data-testid=reveal-card]')
    expect(card.tagName).toBe('SECTION')
    expect($('h2').textContent).toBe(REVEAL_CARD.heading)
    expect(card.getAttribute('aria-labelledby')).toBe($('h2').id)
    expect($<HTMLAnchorElement>('[data-testid=notes-link]').getAttribute('href')).toBe('/humanbench/notes.html')
    expect($('[data-testid=notes-link]').textContent).toBe(REVEAL_CARD.link)
    expect($('h3').textContent).toBe(RESULTS_TALK.heading)
    expect($('[data-testid=preamble]').textContent).toBe(PREAMBLE)
    expect($('[data-testid=never-paste]').textContent).toBe(RESULTS_TALK.neverPaste)
  })

  it('passes the copy function and the status through to the helper', async () => {
    const copy = vi.fn(async () => true)
    show(RevealCard, { saved: true, notesHref: './notes.html', copy, status: 'experimental' })
    expect(document.querySelector('[data-testid=results-talk-badge]')).not.toBeNull()
    $<HTMLButtonElement>('[data-testid=copy-preamble]').click()
    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith(PREAMBLE))
  })

  it('contains no result, no number and no storage or network use', async () => {
    const writes: string[] = []
    for (const name of ['setItem', 'removeItem', 'clear'] as const) vi.spyOn(Storage.prototype, name).mockImplementation(() => void writes.push(name))
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    show(RevealCard, { saved: true, notesHref: './notes.html' })
    $<HTMLButtonElement>('[data-testid=copy-preamble]').click()
    await Promise.resolve()
    expect(document.body.textContent).not.toMatch(/\d/)
    expect(writes).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('the barrel the reveal screens import', () => {
  it('exports the helper and the card', () => {
    expect(ExportedTalk).toBe(ResultsTalk)
    expect(ExportedCard).toBe(RevealCard)
  })
})
