import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App.svelte'
import { HEADING } from './copy'
import { buttonByText, click, fakeDisplay } from './render/common/testing'
import { HONOUR_LEAD, HONOUR_TEXT, HONOUR_TOOLS, PRIVACY_SECTIONS, WELCOME_INTRO, WELCOME_TAGLINE } from './session/copy'
import { fakeEnv } from './session/dom-support'

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

  it('renders no "TODO" on any screen it can reach without a run: welcome, gate, honour, device, ready, privacy, data (UX-REVIEW D1)', async () => {
    const fake = fakeEnv(fakeDisplay())
    app = mount(App, { target: document.body, props: { env: fake.env } })
    flushSync()
    const seen: string[] = []
    const look = (): void => {
      const text = document.body.textContent ?? ''
      seen.push(document.querySelector('.flow:not([hidden]) h1, .flow + main h1')?.textContent ?? '')
      expect(text, seen.at(-1)).not.toMatch(/TODO/)
    }
    look()
    expect(document.body.textContent).toContain(WELCOME_TAGLINE)
    expect(document.body.textContent).toContain(WELCOME_INTRO)
    click(buttonByText(document.body, 'Start'))
    look()
    for (const label of [/18 or older/, /honour code/]) {
      const box = [...document.querySelectorAll('label')].find((l) => label.test(l.textContent ?? ''))!.control as HTMLInputElement
      if (label.source === 'honour code') {
        // The honour screen: the lead-in, the §13 sentence and the paper and tools rule, in that order (UX-REVIEW D10, D26).
        const paras = [...document.querySelectorAll('main p')].map((p) => p.textContent)
        expect(paras.indexOf(HONOUR_LEAD)).toBeGreaterThanOrEqual(0)
        expect(paras.indexOf(HONOUR_TEXT)).toBe(paras.indexOf(HONOUR_LEAD) + 1)
        expect(paras.indexOf(HONOUR_TOOLS)).toBe(paras.indexOf(HONOUR_TEXT) + 1)
      }
      click(box)
      click(buttonByText(document.body, 'Continue'))
      look()
    }
    fake.display.advance(1200)
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    look()
    click(buttonByText(document.body, 'Continue'))
    flushSync()
    look()
    for (const hash of ['#/privacy', '#/data']) {
      location.hash = hash
      window.dispatchEvent(new HashChangeEvent('hashchange'))
      flushSync()
      look()
    }
    expect(seen).toEqual(['HumanBench', 'Before you start', 'Honour code', 'Check your device', 'Check your device', 'Ready when you are', 'Privacy and terms', 'Your data on the server'])
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

  it('shows the privacy notice at #/privacy: no personally identifiable information, no placeholder, and the disclaimer', () => {
    location.hash = '#/privacy'
    app = mount(App, { target: document.body })
    flushSync()

    // The flow stays mounted, hidden, behind the notice.
    const notice = document.querySelector('.flow + main')
    expect(notice?.querySelector('h1')?.textContent).toBe('Privacy and terms')
    expect(document.querySelector('.flow')?.hasAttribute('hidden')).toBe(true)
    const text = notice?.textContent ?? ''
    // Owner decision 2026-10-05 (UX-REVIEW D1): the notice says it plainly and names no controller or contact.
    expect(text).toContain('HumanBench collects no personally identifiable information, and all responses are anonymous.')
    expect(text).not.toContain('TODO')
    expect(text).not.toContain('Controller:')
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

  it('the footer links the privacy notice from every screen but the welcome, as a link in this tab (UX-011, VER-02)', () => {
    app = mount(App, { target: document.body })
    flushSync()
    // The welcome has its own link under Start; a second one in the footer would be the same link twice.
    expect(document.querySelectorAll('footer a')).toHaveLength(0)
    expect(document.querySelector('footer .links')).toBeNull()
    const own = [...document.querySelectorAll('a')].filter((a) => a.textContent?.trim() === 'Privacy and terms')
    expect(own).toHaveLength(1)
    expect(own[0]!.closest('main')).not.toBeNull()
    expect(own[0]!.getAttribute('href')).toBe('#/privacy')
    click(buttonByText(document.body, 'Start'))
    flushSync()
    expect(document.querySelector('main h1')?.textContent).toBe('Before you start')
    const link = document.querySelector<HTMLAnchorElement>('footer a')!
    expect(link.getAttribute('href')).toBe('#/privacy')
    expect(link.textContent?.trim()).toBe('Privacy and terms')
    expect(link.hasAttribute('target')).toBe(false)
    expect([...document.querySelectorAll('a')].filter((a) => a.textContent?.trim() === 'Privacy and terms' && a.closest('main') !== null && !a.closest('.flow')?.hasAttribute('hidden'))).toHaveLength(0)
    // The disclaimer is still its own, exact paragraph.
    expect(document.querySelector('footer .disclaimer')?.textContent?.trim()).toBe(DESIGN_13_DISCLAIMER)
  })

  it('the footer link is there on the welcome while the notice itself is open, and goes again when it is closed (VER-02)', () => {
    app = mount(App, { target: document.body })
    flushSync()
    expect(document.querySelectorAll('footer a')).toHaveLength(0)
    location.hash = '#/privacy'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    flushSync()
    expect([...document.querySelectorAll('footer a')].map((a) => a.getAttribute('href'))).toEqual(['#/privacy'])
    location.hash = ''
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    flushSync()
    expect(document.querySelectorAll('footer a')).toHaveLength(0)
  })

  it('while a run is under way the footer link opens a new tab, says so, and the run is never hidden by the notice', async () => {
    const fake = fakeEnv(fakeDisplay())
    app = mount(App, { target: document.body, props: { env: fake.env } })
    flushSync()
    const clickBtn = (name: string): void => click(buttonByText(document.body, name))
    const tick1 = async (): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      flushSync()
    }
    clickBtn('Start')
    for (const label of [/18 or older/, /honour code/]) {
      const box = [...document.querySelectorAll('label')].find((l) => label.test(l.textContent ?? ''))!.control as HTMLInputElement
      click(box)
      clickBtn('Continue')
    }
    fake.display.advance(1200)
    await tick1()
    clickBtn('Continue')
    const before = document.querySelector<HTMLAnchorElement>('footer a')!
    expect(before.hasAttribute('target')).toBe(false)
    clickBtn('Begin')
    await tick()
    flushSync()
    const link = document.querySelector<HTMLAnchorElement>('footer a[href="#/privacy"]')!
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.textContent?.replace(/\s+/g, ' ').trim()).toBe('Privacy and terms (opens in a new tab)')
    // All of its name is visible, as on the notes page and the results: no hidden part (WCAG 2.5.3).
    expect(link.children).toHaveLength(0)
    // Finishing the run puts the plain link back.
    clickBtn('Finish early')
    clickBtn('Finish now')
    flushSync()
    expect(document.querySelector('footer a[href="#/privacy"]')?.hasAttribute('target')).toBe(false)
  })

  it('"Back" on a notice opened from a link here goes back by the history; opened directly it goes to the start (UX-011)', () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined)
    app = mount(App, { target: document.body })
    flushSync()
    location.hash = '#/privacy'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    flushSync()
    const link = [...document.querySelectorAll('a')].find((a) => a.textContent === 'Back')!
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(ev)
    expect(back).toHaveBeenCalledTimes(1)
    expect(ev.defaultPrevented).toBe(true)
    unmount(app)
    document.body.innerHTML = ''
    // Opened directly (a typed address, a shared link): there is no screen to go back to.
    location.hash = '#/privacy'
    app = mount(App, { target: document.body })
    flushSync()
    const direct = [...document.querySelectorAll('a')].find((a) => a.textContent === 'Back')!
    const ev2 = new MouseEvent('click', { bubbles: true, cancelable: true })
    direct.dispatchEvent(ev2)
    expect(back).toHaveBeenCalledTimes(1)
    expect(ev2.defaultPrevented).toBe(true)
    expect(location.hash).toBe('#/')
    back.mockRestore()
  })

  it('returning from the notice puts focus on the screen’s heading and the screen’s name in the tab (UX-006)', async () => {
    app = mount(App, { target: document.body })
    flushSync()
    ;[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Start')?.click()
    flushSync()
    expect(document.title).toBe('Before you start · HumanBench')
    location.hash = '#/privacy'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    flushSync()
    expect(document.title).toBe('Privacy and terms · HumanBench')
    location.hash = ''
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    flushSync()
    await tick()
    await tick()
    const heading = document.querySelector('.flow h1')!
    expect(heading.textContent).toBe('Before you start')
    expect(document.activeElement).toBe(heading)
    expect(document.title).toBe('Before you start · HumanBench')
  })
})

