/**
 * The app shell with a server (ROADMAP M2.7; DESIGN §13; ROADMAP AI.26): the privacy notice describes
 * what is sent and says the notes settings stay on the device, the footer links the notice and the page
 * about data on the server, `#/data` shows that page, and the static fallback has none of it.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App.svelte'
import { SERVER_PRIVACY_SECTIONS } from './backend/copy'
import { FakeTransport, fakeBackend } from './backend/testing'
import { buttonByText, click, fakeDisplay } from './render/common/testing'
import { fakeEnv } from './session/dom-support'
import { PRIVACY_SECTIONS } from './session/copy'

let app: ReturnType<typeof mount> | undefined
afterEach(() => {
  if (app) unmount(app)
  app = undefined
  document.body.innerHTML = ''
  location.hash = ''
})

function mountApp(server: boolean): void {
  const env = fakeEnv(fakeDisplay(), { backend: server ? fakeBackend(new FakeTransport()) : null }).env
  app = mount(App, { target: document.body, props: { env } })
  flushSync()
}
const go = (hash: string): void => {
  location.hash = hash
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  flushSync()
}

describe('the privacy notice with a server', () => {
  it('is the online notice: no personally identifiable information, what is sent, that notes settings stay on the device, how to delete, and no placeholder', () => {
    location.hash = '#/privacy'
    mountApp(true)
    const text = document.querySelector('.flow + main')?.textContent ?? ''
    for (const s of SERVER_PRIVACY_SECTIONS) expect(text).toContain(s.heading)
    expect(text).toContain('Your notes settings stay on your device')
    expect(text).toContain('They are never sent to the server, they are left out of the server backup')
    // Owner decision 2026-10-05 (UX-REVIEW D1), worded so that every sentence is true of the server as built.
    expect(text).toContain('HumanBench collects no personally identifiable information, and all responses are anonymous.')
    expect(text).toContain('hashed')
    expect(text).toContain('at most 24 months')
    expect(text).toContain('consent')
    expect(text).not.toMatch(/TODO|Controller:|Contact:|to be confirmed|draft/i)
    expect(text).not.toContain('Nothing is sent to a server.')
    expect(text).not.toContain('In this version everything stays in your browser')
    expect(document.querySelector('.flow + main a[href="#/data"]')).not.toBeNull()
  })

  it('the static notice is unchanged without a server', () => {
    location.hash = '#/privacy'
    mountApp(false)
    const text = document.querySelector('.flow + main')?.textContent ?? ''
    for (const s of PRIVACY_SECTIONS) expect(text).toContain(s.heading)
    expect(text).not.toMatch(/TODO/)
    expect(text).not.toContain('notes settings')
    expect(document.querySelector('.flow + main a[href="#/data"]')).toBeNull()
  })
})

describe('no placeholder with a server (UX-REVIEW D1)', () => {
  it('renders no "TODO" on the welcome, the gate, the privacy notice or the data page', () => {
    mountApp(true)
    const text = (): string => document.body.textContent ?? ''
    expect(text()).not.toMatch(/TODO/)
    click(buttonByText(document.body, 'Start'))
    flushSync()
    expect(document.querySelector('.flow h1')?.textContent).toBe('Before you start')
    expect(text()).not.toMatch(/TODO/)
    for (const hash of ['#/privacy', '#/data']) {
      go(hash)
      expect(document.querySelector('.flow + main h1')).not.toBeNull()
      expect(text(), hash).not.toMatch(/TODO/)
    }
  })
})

describe('the footer and the data page', () => {
  it('with a server the footer links the notice and the data page; without one only the notice', () => {
    const footerLinks = (): (string | null)[] => [...document.querySelectorAll('footer a')].map((a) => a.getAttribute('href'))
    mountApp(true)
    // The welcome screen has its own notice link under Start, so the footer has only the data page there (VER-02).
    expect(footerLinks()).toEqual(['#/data'])
    click(buttonByText(document.body, 'Start'))
    flushSync()
    expect(footerLinks()).toEqual(['#/privacy', '#/data'])
    unmount(app!)
    document.body.innerHTML = ''
    mountApp(false)
    // The notice is linked from every screen but the welcome, with or without a server (UX-011); the data page only has a point with one.
    expect(footerLinks()).toEqual([])
    click(buttonByText(document.body, 'Start'))
    flushSync()
    expect(footerLinks()).toEqual(['#/privacy'])
    expect(document.querySelectorAll('footer p.disclaimer')).toHaveLength(1)
  })

  it('#/data shows the page for the data on the server, keeps the flow mounted behind it, and goes back', () => {
    mountApp(true)
    go('#/data')
    expect(document.querySelector('.flow + main h1')?.textContent).toBe('Your data on the server')
    expect(document.querySelector('.flow')?.hasAttribute('hidden')).toBe(true)
    expect(document.querySelectorAll('.flow + main form')).toHaveLength(2)
    go('')
    expect(document.querySelector('.flow')?.hasAttribute('hidden')).toBe(false)
    expect(document.querySelector('.flow + main')).toBeNull()
  })

  it('#/data in the static fallback only says that nothing is kept on a server', () => {
    mountApp(false)
    go('#/data')
    const page = document.querySelector('.flow + main')!
    expect(page.textContent).toContain('keeps nothing on a server')
    expect(page.querySelector('form')).toBeNull()
  })
})
