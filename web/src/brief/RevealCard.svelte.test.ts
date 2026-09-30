/**
 * The "Working with AI" card follows the save download (AI.6b): hidden while `saved` is false,
 * shown when it turns true, and hidden again if it turns false. Runes are only available in
 * `.svelte.ts` files, hence the name.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import RevealCard from './ui/RevealCard.svelte'

let app: ReturnType<typeof mount> | undefined
afterEach(() => {
  if (app) void unmount(app)
  app = undefined
  document.body.innerHTML = ''
})

describe('RevealCard', () => {
  it('reacts to the download: hidden, then shown when `saved` turns true, then hidden again', () => {
    const props = $state({ saved: false, notesHref: './notes.html' })
    app = mount(RevealCard, { target: document.body, props })
    flushSync()
    expect(document.querySelector('[data-testid=reveal-card]')).toBeNull()
    props.saved = true
    flushSync()
    expect(document.querySelector('[data-testid=reveal-card]')).not.toBeNull()
    expect(document.querySelector('[data-testid=preamble]')).not.toBeNull()
    props.saved = false
    flushSync()
    expect(document.querySelector('[data-testid=reveal-card]')).toBeNull()
    expect(document.querySelector('[data-testid=preamble]')).toBeNull()
  })
})
