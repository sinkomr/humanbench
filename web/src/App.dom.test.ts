import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App.svelte'
import { HEADING } from './copy'
import { PRIVACY_SECTIONS, WELCOME_TAGLINE } from './session/copy'

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
    location.hash = ''
  })

  it('opens on the start screen: the product name and the tagline (ROADMAP M1.15)', () => {
    app = mount(App, { target: document.body })
    flushSync()

    expect(document.querySelector('h1')?.textContent).toBe('HumanBench')
    expect(HEADING).toBe('HumanBench')
    expect(document.querySelector('main')?.textContent).toContain(WELCOME_TAGLINE)
    expect([...document.querySelectorAll('button')].map((b) => b.textContent?.trim())).toContain('Start')
  })

  it('renders exactly the DESIGN §13 disclaimer in the footer', () => {
    app = mount(App, { target: document.body })
    flushSync()

    const disclaimer = document.querySelector('footer .disclaimer')
    expect(disclaimer).not.toBeNull()
    expect(disclaimer?.textContent?.trim()).toBe(DESIGN_13_DISCLAIMER)
  })

  it('exposes the disclaimer to assistive tech: nothing on its path is hidden (§13, M1.20)', () => {
    app = mount(App, { target: document.body })
    flushSync()

    const disclaimer = document.querySelector('footer .disclaimer')
    expect(disclaimer).not.toBeNull()
    for (let el: Element | null = disclaimer; el !== null; el = el.parentElement) {
      expect(el.getAttribute('aria-hidden'), el.tagName).not.toBe('true')
      expect(el.hasAttribute('hidden'), el.tagName).toBe(false)
      expect(el.hasAttribute('inert'), el.tagName).toBe(false)
    }
  })

  it('shows the privacy notice at #/privacy, with the controller placeholders marked TODO(user), and the disclaimer', () => {
    location.hash = '#/privacy'
    app = mount(App, { target: document.body })
    flushSync()

    // The flow stays mounted, hidden, behind the notice.
    const notice = document.querySelector('.flow + main')
    expect(notice?.querySelector('h1')?.textContent).toBe('Privacy and terms')
    expect(document.querySelector('.flow')?.hasAttribute('hidden')).toBe(true)
    const text = notice?.textContent ?? ''
    expect(text).toContain('Controller: TODO(user)')
    expect(text).toContain('Contact: TODO(user)')
    for (const s of PRIVACY_SECTIONS) expect(text).toContain(s.heading)
    expect(document.querySelector('footer .disclaimer')?.textContent?.trim()).toBe(DESIGN_13_DISCLAIMER)
  })

  it('goes back to the flow, where it was, when the hash leaves #/privacy', () => {
    app = mount(App, { target: document.body })
    flushSync()
    ;[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Start')?.click()
    flushSync()
    expect(document.querySelector('main h1')?.textContent).toBe('Before you start')

    location.hash = '#/privacy'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    flushSync()
    expect([...document.querySelectorAll('h1')].some((h) => h.textContent === 'Privacy and terms')).toBe(true)
    expect(document.querySelector('.flow')?.hasAttribute('hidden')).toBe(true)

    location.hash = ''
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    flushSync()
    expect(document.querySelector('.flow')?.hasAttribute('hidden')).toBe(false)
    expect(document.querySelector('main h1')?.textContent).toBe('Before you start')
  })
})
