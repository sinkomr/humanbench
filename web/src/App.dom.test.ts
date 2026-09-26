import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App.svelte'

// Literal DESIGN §13 text, deliberately not imported from ./copy, so that a change to
// the rendered copy fails this test. copy.test.ts checks copy.ts against docs/DESIGN.md.
const DESIGN_13_DISCLAIMER =
  'For curiosity and self-reflection. Not an IQ test, a clinical assessment, or a basis for decisions about education, employment, or health.'

describe('App (jsdom)', () => {
  let app: ReturnType<typeof mount> | undefined

  afterEach(() => {
    if (app) unmount(app)
    app = undefined
    document.body.innerHTML = ''
  })

  it('renders the "HumanBench — hello" heading and the tagline (ROADMAP M0.1)', () => {
    app = mount(App, { target: document.body })
    flushSync()

    expect(document.querySelector('h1')?.textContent).toBe('HumanBench — hello')
    expect(document.querySelector('main')?.textContent).toContain(
      'A jagged-blob cognitive profile — coming soon',
    )
  })

  it('renders exactly the DESIGN §13 disclaimer in the footer', () => {
    app = mount(App, { target: document.body })
    flushSync()

    const disclaimer = document.querySelector('footer .disclaimer')
    expect(disclaimer).not.toBeNull()
    expect(disclaimer?.textContent?.trim()).toBe(DESIGN_13_DISCLAIMER)
  })
})
